// Rubenchuelo.exe: abre Rubenchuelo como un programa normal. Arranca el cerebro
// (runtime\node.exe app\servidor.js) sin ventana negra, lo abre en una ventana
// propia (Edge o Chrome en modo aplicación) y pone un icono junto al reloj.
// Al cerrar la ventana, lo guarda todo y se cierra.
//   Rubenchuelo.exe                abrirlo
//   Rubenchuelo.exe --desinstalar  quitarlo (solo si se instaló con el instalador)

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Rubenchuelo")]
[assembly: AssemblyProduct("Rubenchuelo")]
[assembly: AssemblyDescription("Un cerebro artificial muy pequeño que aprende mientras le hablas")]
[assembly: AssemblyVersion("1.1.0.0")]
[assembly: AssemblyFileVersion("1.1.0.0")]

namespace Rubenchuelo
{
    static class Programa
    {
        [STAThread]
        static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string raiz = Comun.CarpetaDelExe();
            if (Array.IndexOf(args, "--desinstalar") >= 0) return Desinstalador.Ejecutar(raiz, args);

            bool primero;
            using (var cerrojo = new Mutex(true, @"Local\Rubenchuelo-" + Comun.Huella(raiz), out primero))
            {
                if (!primero)
                {
                    // Ya se está abriendo (doble clic dos veces): basta con otra ventana.
                    for (int i = 0; i < 300; i++)
                    {
                        int p = Comun.PuertoAbierto(raiz);
                        if (p > 0) { Ventana.Abrir(raiz, p); return 0; }
                        Thread.Sleep(300);
                    }
                    return 0;
                }
                // Abierto con Iniciar.bat u otro Rubenchuelo.exe que ya terminó de arrancar.
                int abierto = Comun.PuertoAbierto(raiz);
                if (abierto > 0)
                {
                    Ventana.Abrir(raiz, abierto);
                    return 0;
                }
                string nodo = BuscarNode(raiz);
                if (nodo == null)
                {
                    MessageBox.Show("No encuentro el motor de Rubenchuelo (runtime\\node.exe).\n\nVuelve a copiar la carpeta entera de Rubenchuelo o vuelve a instalarlo.",
                        "Rubenchuelo", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }
                if (!File.Exists(Path.Combine(raiz, @"app\servidor.js")))
                {
                    MessageBox.Show("Falta la carpeta «app» junto a Rubenchuelo.exe.\n\nRubenchuelo.exe tiene que estar dentro de la carpeta de Rubenchuelo.",
                        "Rubenchuelo", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }
                var lanzador = new Lanzador(raiz, nodo);
                Application.Run(lanzador);
                return lanzador.Codigo;
            }
        }

        static string BuscarNode(string raiz)
        {
            string propio = Path.Combine(raiz, @"runtime\node.exe");
            if (File.Exists(propio)) return propio;
            string ruta = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in ruta.Split(';'))
            {
                try
                {
                    string candidato = Path.Combine(dir.Trim().Trim('"'), "node.exe");
                    if (File.Exists(candidato)) return candidato;
                }
                catch { }
            }
            return null;
        }
    }

    // Pequeña ventana mientras se despierta (con un cerebro grande tarda unos segundos).
    class Pantallazo : Form
    {
        public Pantallazo()
        {
            AutoScaleDimensions = new SizeF(96f, 96f);
            AutoScaleMode = AutoScaleMode.Dpi;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ShowInTaskbar = true;
            Text = "Rubenchuelo";
            Icon = Comun.IconoDelExe();
            BackColor = Estilo.Campo;
            ClientSize = new Size(380, 150);
            var icono = new PictureBox();
            icono.Image = new Icon(Comun.IconoDelExe(), 64, 64).ToBitmap();
            icono.SizeMode = PictureBoxSizeMode.Zoom;
            icono.SetBounds(28, 40, 64, 64);
            var nombre = new Label();
            nombre.Text = "Rubenchuelo";
            nombre.Font = Estilo.Mano(22f);
            nombre.ForeColor = ColorTranslator.FromHtml("#e8fbff");
            nombre.AutoSize = true;
            nombre.Location = new Point(104, 34);
            var texto = new Label();
            texto.Text = "Despertando…";
            texto.Font = Estilo.Voz(11f);
            texto.ForeColor = Estilo.Palabra;
            texto.AutoSize = true;
            texto.Location = new Point(110, 82);
            Controls.Add(icono);
            Controls.Add(nombre);
            Controls.Add(texto);
        }
    }

    // El navegador en modo aplicación: una ventana sin barras, con su propio perfil
    // (así no se mezcla con tus pestañas y se sabe cuándo la cierras).
    static class Ventana
    {
        public static string Navegador()
        {
            foreach (string exe in new[] { "msedge.exe", "chrome.exe" })
            {
                foreach (RegistryKey baseK in new[] { Registry.CurrentUser, Registry.LocalMachine })
                {
                    using (RegistryKey k = baseK.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exe))
                    {
                        string ruta = k == null ? null : k.GetValue("") as string;
                        if (!string.IsNullOrEmpty(ruta) && File.Exists(ruta.Trim('"'))) return ruta.Trim('"');
                    }
                }
            }
            foreach (string ruta in new[] {
                @"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
                @"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
                @"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
                @"%LocalAppData%\Google\Chrome\Application\chrome.exe" })
            {
                string r = Environment.ExpandEnvironmentVariables(ruta);
                if (File.Exists(r)) return r;
            }
            return null;
        }

        public static string Perfil(string raiz)
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Rubenchuelo", "ventana-" + Comun.Huella(raiz));
        }

        // Devuelve el proceso del navegador que se ha lanzado (o null si se abre en el navegador normal).
        public static Process Abrir(string raiz, int puerto)
        {
            string url = "http://127.0.0.1:" + puerto + "/?ventana=1";
            string navegador = Navegador();
            if (navegador != null)
            {
                string perfil = Perfil(raiz);
                bool nuevo = !Directory.Exists(perfil);
                var a = new StringBuilder();
                a.Append("--app=\"").Append(url).Append("\" --user-data-dir=\"").Append(perfil).Append("\"");
                a.Append(" --no-first-run --no-default-browser-check --disable-sync");
                if (nuevo)
                {
                    // La primera vez, grande y centrada; luego recuerda dónde la dejaste.
                    Rectangle area = Screen.PrimaryScreen.WorkingArea;
                    int w = Math.Min(1500, area.Width * 9 / 10), h = Math.Min(960, area.Height * 9 / 10);
                    a.Append(" --window-size=").Append(w).Append(',').Append(h);
                    a.Append(" --window-position=").Append(area.Left + (area.Width - w) / 2).Append(',').Append(area.Top + (area.Height - h) / 2);
                }
                try
                {
                    var psi = new ProcessStartInfo(navegador, a.ToString());
                    psi.UseShellExecute = false;
                    return Process.Start(psi);
                }
                catch { }
            }
            try { Process.Start(url); } catch { }
            return null;
        }

        delegate bool AlEnumerar(IntPtr ventana, IntPtr dato);
        [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool EnumWindows(AlEnumerar f, IntPtr dato);
        [System.Runtime.InteropServices.DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr ventana, out uint pid);
        [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr ventana);
        [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool PostMessage(IntPtr ventana, uint mensaje, IntPtr w, IntPtr l);

        // Cierra con calma (como la X) todas las ventanas de ese navegador.
        public static void CerrarTodas(Process navegador)
        {
            if (navegador == null) return;
            uint objetivo;
            try { if (navegador.HasExited) return; objetivo = (uint)navegador.Id; } catch { return; }
            EnumWindows((v, d) =>
            {
                uint pid;
                GetWindowThreadProcessId(v, out pid);
                if (pid == objetivo && IsWindowVisible(v)) PostMessage(v, 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
                return true;
            }, IntPtr.Zero);
        }

        // El proceso principal del navegador que usa este perfil (sin «--type=»).
        public static Process Principal(string raiz)
        {
            string perfil = Perfil(raiz);
            try
            {
                using (var buscador = new ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'msedge.exe' OR Name = 'chrome.exe'"))
                {
                    foreach (ManagementObject o in buscador.Get())
                    {
                        string linea = o["CommandLine"] as string;
                        if (linea == null || linea.IndexOf(perfil, StringComparison.OrdinalIgnoreCase) < 0 || linea.Contains("--type=")) continue;
                        try { return Process.GetProcessById(Convert.ToInt32(o["ProcessId"])); } catch { }
                    }
                }
            }
            catch { }
            return null;
        }
    }

    class Lanzador : ApplicationContext
    {
        enum Fase { Arrancando, Abierto, Cerrando }

        readonly string raiz;
        readonly Process nodo;
        readonly Queue<string> registro = new Queue<string>();
        readonly System.Windows.Forms.Timer reloj = new System.Windows.Forms.Timer();
        readonly DateTime inicio = DateTime.Now;
        Pantallazo pantallazo;
        NotifyIcon bandeja;
        Process navegador;
        DateTime abierta;
        DateTime cerrandoDesde;
        bool buscado;
        int puerto;
        Fase fase = Fase.Arrancando;
        public int Codigo;

        public Lanzador(string raiz, string rutaNode)
        {
            this.raiz = raiz;
            pantallazo = new Pantallazo();
            pantallazo.Show();
            pantallazo.Refresh();

            var psi = new ProcessStartInfo(rutaNode, "\"" + Path.Combine(raiz, @"app\servidor.js") + "\" --sin-navegador");
            psi.WorkingDirectory = raiz;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            nodo = new Process();
            nodo.StartInfo = psi;
            nodo.OutputDataReceived += (s, e) => Anotar(e.Data);
            nodo.ErrorDataReceived += (s, e) => Anotar(e.Data);
            try
            {
                nodo.Start();
                nodo.BeginOutputReadLine();
                nodo.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                Fallo("No se pudo arrancar el motor: " + ex.Message);
                return;
            }
            reloj.Interval = 300;
            reloj.Tick += (s, e) => Revisar();
            reloj.Start();
        }

        void Anotar(string linea)
        {
            if (linea == null) return;
            lock (registro)
            {
                registro.Enqueue(linea);
                while (registro.Count > 40) registro.Dequeue();
            }
        }

        string UltimasLineas()
        {
            lock (registro)
            {
                var sb = new StringBuilder();
                foreach (string l in registro) if (l.Trim().Length > 0) sb.AppendLine(l.Trim());
                return sb.ToString();
            }
        }

        void Revisar()
        {
            switch (fase)
            {
                case Fase.Arrancando:
                    if (nodo.HasExited)
                    {
                        Fallo("Rubenchuelo se ha cerrado al despertar.");
                        return;
                    }
                    int pid, p;
                    if (Comun.LeerCandado(raiz, out pid, out p) && pid == nodo.Id && Comun.Responde(p))
                    {
                        puerto = p;
                        AbrirVentana();
                        MostrarBandeja();
                        if (pantallazo != null) { pantallazo.Close(); pantallazo = null; }
                        fase = Fase.Abierto;
                    }
                    else if ((DateTime.Now - inicio).TotalSeconds > 180)
                    {
                        Fallo("Rubenchuelo tarda demasiado en despertar.");
                    }
                    return;

                case Fase.Abierto:
                    if (nodo.HasExited) { Terminar(); return; }
                    // Si el navegador ya estaba abierto con este perfil, el que lanzamos
                    // se lo pasa al otro y termina: entonces se busca el de verdad.
                    if (navegador != null && navegador.HasExited && !buscado && (DateTime.Now - abierta).TotalSeconds < 6)
                    {
                        buscado = true;
                        navegador = Ventana.Principal(raiz);
                        return;
                    }
                    if (navegador != null && navegador.HasExited)
                    {
                        // Has cerrado la ventana: se guarda y se cierra, como con «Guardar y salir».
                        navegador = null;
                        EmpezarACerrar();
                    }
                    return;

                case Fase.Cerrando:
                    if (nodo.HasExited || (DateTime.Now - cerrandoDesde).TotalSeconds > 120) Terminar();
                    return;
            }
        }

        void AbrirVentana()
        {
            Process p = Ventana.Abrir(raiz, puerto);
            if (p == null) return;
            if (navegador == null || navegador.HasExited)
            {
                navegador = p;
                abierta = DateTime.Now;
                buscado = false;
            }
        }

        void MostrarBandeja()
        {
            bandeja = new NotifyIcon();
            bandeja.Icon = new Icon(Comun.IconoDelExe(), SystemInformation.SmallIconSize);
            bandeja.Text = "Rubenchuelo";
            var menu = new ContextMenuStrip();
            var abrir = menu.Items.Add("Abrir Rubenchuelo", null, (s, e) => AbrirVentana());
            abrir.Font = new Font(abrir.Font, FontStyle.Bold);
            menu.Items.Add("Abrir su carpeta", null, (s, e) => { try { Process.Start("explorer.exe", "\"" + raiz + "\""); } catch { } });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Guardar y salir", null, (s, e) => EmpezarACerrar());
            bandeja.ContextMenuStrip = menu;
            bandeja.DoubleClick += (s, e) => AbrirVentana();
            bandeja.Visible = true;
        }

        void EmpezarACerrar()
        {
            if (fase == Fase.Cerrando) return;
            fase = Fase.Cerrando;
            cerrandoDesde = DateTime.Now;
            if (bandeja != null) bandeja.Text = "Rubenchuelo: guardando…";
            Comun.PedirSalir(raiz, puerto);
        }

        void Terminar()
        {
            reloj.Stop();
            if (bandeja != null) { bandeja.Visible = false; bandeja.Dispose(); bandeja = null; }
            // Si se ha cerrado desde el icono o con «Guardar y salir», también se cierran sus ventanas.
            Ventana.CerrarTodas(navegador ?? Ventana.Principal(raiz));
            if (nodo.HasExited && nodo.ExitCode != 0 && fase != Fase.Cerrando)
            {
                Codigo = 1;
                MessageBox.Show("Rubenchuelo se ha cerrado por un error.\n\n" + UltimasLineas(), "Rubenchuelo", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            ExitThread();
        }

        void Fallo(string mensaje)
        {
            reloj.Stop();
            if (pantallazo != null) { pantallazo.Close(); pantallazo = null; }
            try { if (!nodo.HasExited) nodo.Kill(); } catch { }
            Codigo = 1;
            string lineas = UltimasLineas();
            MessageBox.Show(mensaje + (lineas.Length > 0 ? "\n\n" + lineas : ""), "Rubenchuelo", MessageBoxButtons.OK, MessageBoxIcon.Error);
            ExitThread();
        }
    }

    // Quita Rubenchuelo instalado. Sus cerebros se quedan, salvo que digas lo contrario
    // (y entonces van a la papelera, no se borran del todo).
    static class Desinstalador
    {
        public static int Ejecutar(string raiz, string[] args)
        {
            string clave = Comun.ClaveDesinstalar;
            for (int i = 0; i < args.Length - 1; i++) if (args[i] == "--clave") clave = args[i + 1];
            bool silencioso = Array.IndexOf(args, "--silencioso") >= 0;
            bool borrarCerebros = Array.IndexOf(args, "--borrar-cerebros") >= 0;
            bool sinAutoborrado = Array.IndexOf(args, "--sin-autoborrado") >= 0;

            if (!Comun.MismaRuta(Comun.CarpetaInstalada(clave), raiz))
            {
                if (!silencioso) MessageBox.Show("Esta copia de Rubenchuelo no está instalada (es la portátil).\n\nPara quitarla basta con borrar su carpeta. Antes, si quieres conservar lo que sabe, guarda la carpeta «cerebros».",
                    "Desinstalar Rubenchuelo", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 1;
            }
            if (!silencioso)
            {
                using (var d = new DialogoDesinstalar())
                {
                    if (d.ShowDialog() != DialogResult.OK) return 1;
                    borrarCerebros = d.BorrarCerebros;
                }
            }
            if (Comun.PuertoAbierto(raiz) > 0 && !Comun.CerrarYEsperar(raiz, 120))
            {
                if (!silencioso) MessageBox.Show("Rubenchuelo sigue abierto y no se ha podido cerrar. Ciérralo con «Guardar y salir» y vuelve a intentarlo.",
                    "Desinstalar Rubenchuelo", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }

            string exe = Path.Combine(raiz, "Rubenchuelo.exe");
            foreach (string acceso in new[] { Comun.AccesoMenuInicio(), Comun.AccesoEscritorio() })
            {
                if (Comun.MismaRuta(Comun.DestinoDeAcceso(acceso), exe)) { try { File.Delete(acceso); } catch { } }
            }
            try { Registry.CurrentUser.DeleteSubKeyTree(clave, false); } catch { }
            foreach (string c in Comun.CarpetasPrograma)
            {
                try { if (Directory.Exists(Path.Combine(raiz, c))) Directory.Delete(Path.Combine(raiz, c), true); } catch { }
            }
            foreach (string a in Comun.ArchivosPrograma)
            {
                if (a == "Rubenchuelo.exe") continue;
                try { File.Delete(Path.Combine(raiz, a)); } catch { }
            }
            try { File.Delete(Path.Combine(raiz, "en-uso.lock")); } catch { }
            try { if (Directory.Exists(Ventana.Perfil(raiz))) Directory.Delete(Ventana.Perfil(raiz), true); } catch { }
            if (borrarCerebros)
            {
                string cerebros = Path.Combine(raiz, "cerebros");
                try
                {
                    if (Directory.Exists(cerebros)) Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(cerebros,
                        Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
                    string ajustes = Path.Combine(raiz, "ajustes.json");
                    if (File.Exists(ajustes)) Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(ajustes,
                        Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
                }
                catch { }
            }
            // El propio .exe no puede borrarse mientras corre: lo borra cmd un momento después
            // (y la carpeta solo si ha quedado vacía).
            if (!sinAutoborrado)
            {
                var psi = new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 >nul & del /f /q \"" + exe + "\" & rd \"" + raiz + "\"");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.WorkingDirectory = Path.GetTempPath();
                try { Process.Start(psi); } catch { }
            }
            if (!silencioso)
            {
                bool quedan = !borrarCerebros && Directory.Exists(Path.Combine(raiz, "cerebros"));
                MessageBox.Show(quedan
                    ? "Rubenchuelo se ha desinstalado.\n\nSus cerebros (lo que ha aprendido) siguen en:\n" + Path.Combine(raiz, "cerebros")
                    : "Rubenchuelo se ha desinstalado.", "Desinstalar Rubenchuelo", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            return 0;
        }
    }

    class DialogoDesinstalar : Form
    {
        readonly CheckBox casilla;
        public bool BorrarCerebros { get { return casilla.Checked; } }

        public DialogoDesinstalar()
        {
            AutoScaleDimensions = new SizeF(96f, 96f);
            AutoScaleMode = AutoScaleMode.Dpi;
            Text = "Desinstalar Rubenchuelo";
            Icon = Comun.IconoDelExe();
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Estilo.Cristal;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;

            var cuerpo = new FlowLayoutPanel();
            cuerpo.FlowDirection = FlowDirection.TopDown;
            cuerpo.AutoSize = true;
            cuerpo.Padding = new Padding(22, 18, 22, 18);
            cuerpo.Dock = DockStyle.Fill;
            cuerpo.WrapContents = false;
            cuerpo.Controls.Add(Estilo.Texto("Se quitará el programa, sus accesos directos y su entrada en «Aplicaciones instaladas».", 10f, Estilo.Tinta));
            cuerpo.Controls.Add(Estilo.Texto("Sus cerebros (lo que ha aprendido) se quedan en la carpeta, salvo que marques esto:", 10f, Estilo.TintaSuave));
            casilla = new CheckBox();
            casilla.Text = "Borrar también sus cerebros (irán a la papelera)";
            casilla.Font = Estilo.Letra(10f);
            casilla.ForeColor = Estilo.Peligro;
            casilla.AutoSize = true;
            casilla.Margin = new Padding(0, 0, 0, 16);
            cuerpo.Controls.Add(casilla);
            var botones = new FlowLayoutPanel();
            botones.FlowDirection = FlowDirection.RightToLeft;
            botones.AutoSize = true;
            botones.Anchor = AnchorStyles.Right;
            botones.Width = 460;
            var si = Estilo.Boton("Desinstalar", true);
            si.DialogResult = DialogResult.OK;
            var no = Estilo.Boton("Cancelar", false);
            no.DialogResult = DialogResult.Cancel;
            botones.Controls.Add(si);
            botones.Controls.Add(no);
            cuerpo.Controls.Add(botones);
            Controls.Add(cuerpo);
            Controls.Add(Estilo.Cabecera("Desinstalar"));
            AcceptButton = si;
            CancelButton = no;
        }
    }
}
