// «Instalar Rubenchuelo.exe»: lleva dentro el programa entero (carga.rbpk, la
// prepara herramientas\construir.js) y lo instala para tu usuario, sin pedir
// permisos de administrador: carpeta, menú Inicio, escritorio y la entrada en
// «Aplicaciones instaladas» para poder desinstalarlo. Si encuentra los cerebros
// de un Rubenchuelo portátil, se los puede traer (los copia, no los mueve).
// Para probarlo sin tocar el sistema:
//   "Instalar Rubenchuelo.exe" /silencioso /destino:C:\carpeta [/accesos:C:\otra] [/clave:Software\Prueba] [/cerebros:no|C:\cerebros] [/log:archivo]

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Instalar Rubenchuelo")]
[assembly: AssemblyProduct("Rubenchuelo")]
[assembly: AssemblyDescription("Instalador de Rubenchuelo")]
[assembly: AssemblyVersion("1.1.0.0")]
[assembly: AssemblyFileVersion("1.1.0.0")]

namespace Rubenchuelo
{
    class Opciones
    {
        public string Destino;
        public bool Escritorio = true;
        public string CarpetaAccesos;      // solo para pruebas: dónde poner los accesos
        public string Clave = Comun.ClaveDesinstalar;
        public string Cerebros;            // carpeta «cerebros» de la que traerlos (o null)
        public string Whisper;             // carpeta «oido\whisper» de la que traerlo (o null)
    }

    class Resultado
    {
        public bool Actualizado;
        public List<string> Traidos = new List<string>();
        public List<string> YaEstaban = new List<string>();
        public bool WhisperCopiado, WhisperConservado;
    }

    static class Instalacion
    {
        public static string DestinoPorDefecto()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Rubenchuelo");
        }

        // Whisper de la carpeta portátil (junto al instalador): no va dentro del instalador porque pesa 1,7 GB.
        public static string BuscarWhisper()
        {
            string w = Path.Combine(Comun.CarpetaDelExe(), @"oido\whisper");
            return File.Exists(Path.Combine(w, @"programa\whisper-server.exe")) && Directory.Exists(Path.Combine(w, "modelos")) ? w : null;
        }

        public static bool EsRubenchuelo(string dir)
        {
            return File.Exists(Path.Combine(dir, @"app\servidor.js")) || File.Exists(Path.Combine(dir, "Rubenchuelo.exe"));
        }

        // null si se puede instalar ahí; si no, por qué no.
        public static string Problema(string destino)
        {
            if (string.IsNullOrWhiteSpace(destino)) return "Elige una carpeta.";
            string completo;
            try { completo = Path.GetFullPath(destino); } catch { return "Esa carpeta no es válida."; }
            if (completo.Length < 4) return "Elige una carpeta, no una unidad entera.";
            if (Comun.MismaRuta(completo, Comun.CarpetaDelExe())) return "Esa es la carpeta desde la que estás instalando. Elige otra.";
            if (File.Exists(completo)) return "Ahí hay un archivo con ese nombre.";
            if (Directory.Exists(completo) && !EsRubenchuelo(completo) && Directory.GetFileSystemEntries(completo).Length > 0)
                return "Esa carpeta ya tiene otras cosas. Elige una vacía o una nueva.";
            return null;
        }

        // Los cerebros de un Rubenchuelo portátil: junto al instalador o en el escritorio.
        public static string BuscarCerebros()
        {
            var candidatas = new List<string>();
            candidatas.Add(Path.Combine(Comun.CarpetaDelExe(), "cerebros"));
            candidatas.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), @"Rubenchuelo\cerebros"));
            foreach (string c in candidatas) if (NombresDeCerebros(c).Count > 0) return c;
            return null;
        }

        public static List<string> NombresDeCerebros(string dir)
        {
            var nombres = new List<string>();
            if (dir == null || !Directory.Exists(dir)) return nombres;
            foreach (string d in Directory.GetDirectories(dir))
            {
                string n = Path.GetFileName(d);
                if (n.StartsWith("_") || n.StartsWith(".")) continue;
                if (File.Exists(Path.Combine(d, "cerebro.json.gz")) || File.Exists(Path.Combine(d, "ajustes.json"))) nombres.Add(n);
            }
            nombres.Sort(StringComparer.CurrentCultureIgnoreCase);
            return nombres;
        }

        public static Resultado Instalar(Opciones o, Action<int, string> avance)
        {
            var r = new Resultado();
            string destino = Path.GetFullPath(o.Destino);
            string problema = Problema(destino);
            if (problema != null) throw new InvalidOperationException(problema);
            if (Comun.PuertoAbierto(destino) > 0) throw new InvalidOperationException("Rubenchuelo está abierto en esa carpeta. Ciérralo con «Guardar y salir» y vuelve a intentarlo.");

            Directory.CreateDirectory(destino);
            r.Actualizado = EsRubenchuelo(destino);
            if (r.Actualizado)
            {
                avance(2, "Quitando la versión anterior del programa (sus cerebros se quedan)…");
                // Whisper se aparta un momento y luego vuelve a su sitio (no hace falta copiarlo otra vez).
                string whisperViejo = Path.Combine(destino, @"oido\whisper"), aparte = Path.Combine(destino, "_whisper");
                if (Directory.Exists(whisperViejo) && !Directory.Exists(aparte)) Directory.Move(whisperViejo, aparte);
                foreach (string c in Comun.CarpetasPrograma)
                {
                    string ruta = Path.Combine(destino, c);
                    if (Directory.Exists(ruta)) Directory.Delete(ruta, true);
                }
                if (Directory.Exists(aparte)) { Directory.CreateDirectory(Path.Combine(destino, "oido")); r.WhisperConservado = true; }
                foreach (string a in Comun.ArchivosPrograma)
                {
                    string ruta = Path.Combine(destino, a);
                    if (File.Exists(ruta)) File.Delete(ruta);
                }
            }

            long bytes = Extraer(destino, (hecho, total) => avance(5 + (int)(70 * hecho / Math.Max(1, total)), "Copiando el programa…"));
            string whisperDestino = Path.Combine(destino, @"oido\whisper"), apartado = Path.Combine(destino, "_whisper");
            if (Directory.Exists(apartado) && !Directory.Exists(whisperDestino)) Directory.Move(apartado, whisperDestino);
            if (o.Whisper != null && Directory.Exists(o.Whisper) && !Directory.Exists(whisperDestino))
            {
                avance(76, "Copiando Whisper (1,7 GB, tarda un poco)…");
                CopiarCarpeta(o.Whisper, whisperDestino);
                r.WhisperCopiado = true;
            }

            if (o.Cerebros != null && Directory.Exists(o.Cerebros))
            {
                avance(87, "Trayendo sus cerebros…");
                string dirCerebros = Path.Combine(destino, "cerebros");
                foreach (string nombre in NombresDeCerebros(o.Cerebros))
                {
                    string a = Path.Combine(dirCerebros, nombre);
                    if (Directory.Exists(a)) { r.YaEstaban.Add(nombre); continue; }
                    CopiarCarpeta(Path.Combine(o.Cerebros, nombre), a);
                    r.Traidos.Add(nombre);
                }
                string ajustes = Path.Combine(Path.GetDirectoryName(o.Cerebros.TrimEnd('\\')), "ajustes.json");
                string ajustesDestino = Path.Combine(destino, "ajustes.json");
                if (r.Traidos.Count > 0 && File.Exists(ajustes) && !File.Exists(ajustesDestino)) File.Copy(ajustes, ajustesDestino);
            }

            avance(94, "Creando los accesos directos…");
            string exe = Path.Combine(destino, "Rubenchuelo.exe");
            const string descripcion = "Un cerebro artificial muy pequeño que aprende mientras le hablas";
            if (o.CarpetaAccesos != null)
            {
                Directory.CreateDirectory(o.CarpetaAccesos);
                Comun.CrearAcceso(Path.Combine(o.CarpetaAccesos, "Rubenchuelo (menú Inicio).lnk"), exe, descripcion, null);
                if (o.Escritorio) Comun.CrearAcceso(Path.Combine(o.CarpetaAccesos, "Rubenchuelo (escritorio).lnk"), exe, descripcion, null);
            }
            else
            {
                Comun.CrearAcceso(Comun.AccesoMenuInicio(), exe, descripcion, null);
                if (o.Escritorio) Comun.CrearAcceso(Comun.AccesoEscritorio(), exe, descripcion, null);
            }

            if (!string.IsNullOrEmpty(o.Clave))
            {
                avance(98, "Apuntándolo en «Aplicaciones instaladas»…");
                using (RegistryKey k = Registry.CurrentUser.CreateSubKey(o.Clave))
                {
                    k.SetValue("DisplayName", "Rubenchuelo");
                    k.SetValue("DisplayIcon", exe);
                    k.SetValue("DisplayVersion", "1.1");
                    k.SetValue("Publisher", "Rubenchuelo");
                    k.SetValue("InstallLocation", destino);
                    k.SetValue("UninstallString", "\"" + exe + "\" --desinstalar");
                    k.SetValue("QuietUninstallString", "\"" + exe + "\" --desinstalar --silencioso");
                    k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                    k.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, bytes / 1024), RegistryValueKind.DWord);
                    k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                }
            }
            avance(100, "Listo.");
            return r;
        }

        // carga.rbpk: «RBPK1\n», total (int64) y, por archivo: largo de la ruta (uint16),
        // ruta (UTF-8, con /), tamaño (int64), tamaño comprimido (int64) y los datos (deflate).
        static long Extraer(string destino, Action<long, long> avance)
        {
            string raiz = Path.GetFullPath(destino).TrimEnd('\\') + "\\";
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("carga.rbpk"))
            {
                if (s == null) throw new InvalidOperationException("Este instalador está incompleto: no lleva el programa dentro.");
                var br = new BinaryReader(s);
                if (Encoding.ASCII.GetString(br.ReadBytes(6)) != "RBPK1\n") throw new InvalidOperationException("Este instalador está dañado.");
                long total = br.ReadInt64();
                long hecho = 0;
                for (;;)
                {
                    int largo = br.ReadUInt16();
                    if (largo == 0) break;
                    string ruta = Encoding.UTF8.GetString(br.ReadBytes(largo)).Replace('/', '\\');
                    long tam = br.ReadInt64();
                    long comp = br.ReadInt64();
                    string archivo = Path.GetFullPath(Path.Combine(raiz, ruta));
                    if (!archivo.StartsWith(raiz, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Este instalador está dañado.");
                    Directory.CreateDirectory(Path.GetDirectoryName(archivo));
                    byte[] datos = br.ReadBytes((int)comp);
                    using (var ms = new MemoryStream(datos))
                    using (var ds = new DeflateStream(ms, CompressionMode.Decompress))
                    using (var fs = File.Create(archivo))
                    {
                        ds.CopyTo(fs);
                    }
                    hecho += tam;
                    avance(hecho, total);
                }
                return total;
            }
        }

        static void CopiarCarpeta(string de, string a)
        {
            Directory.CreateDirectory(a);
            foreach (string f in Directory.GetFiles(de))
            {
                string n = Path.GetFileName(f);
                if (n.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase) || n == "en-uso.lock") continue;
                File.Copy(f, Path.Combine(a, n), true);
            }
            foreach (string d in Directory.GetDirectories(de)) CopiarCarpeta(d, Path.Combine(a, Path.GetFileName(d)));
        }
    }

    static class ProgramaInstalador
    {
        [STAThread]
        static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var o = new Opciones();
            o.Destino = Instalacion.DestinoPorDefecto();
            bool silencioso = false;
            string log = null;
            bool cerebrosDados = false;
            bool whisperDado = false;
            foreach (string a in args)
            {
                if (a == "/silencioso") silencioso = true;
                else if (a == "/sin-escritorio") o.Escritorio = false;
                else if (a.StartsWith("/destino:")) o.Destino = a.Substring(9);
                else if (a.StartsWith("/accesos:")) o.CarpetaAccesos = a.Substring(9);
                else if (a.StartsWith("/clave:")) o.Clave = a.Substring(7);
                else if (a.StartsWith("/log:")) log = a.Substring(5);
                else if (a.StartsWith("/cerebros:")) { cerebrosDados = true; o.Cerebros = a.Substring(10) == "no" ? null : a.Substring(10); }
                else if (a.StartsWith("/whisper:")) { whisperDado = true; o.Whisper = a.Substring(9) == "no" ? null : a.Substring(9); }
            }
            if (!cerebrosDados) o.Cerebros = Instalacion.BuscarCerebros();
            if (!whisperDado) o.Whisper = Instalacion.BuscarWhisper();
            if (!silencioso)
            {
                Application.Run(new VentanaInstalador(o));
                return 0;
            }
            try
            {
                Resultado r = Instalacion.Instalar(o, (p, t) => { });
                if (log != null) File.WriteAllText(log, "ok " + (r.Actualizado ? "actualizado" : "nuevo") + " traidos=" + string.Join(",", r.Traidos.ToArray()) + " yaEstaban=" + string.Join(",", r.YaEstaban.ToArray()) + " whisper=" + (r.WhisperCopiado ? "copiado" : r.WhisperConservado ? "conservado" : "no"));
                return 0;
            }
            catch (Exception e)
            {
                if (log != null) File.WriteAllText(log, "error " + e.Message);
                return 1;
            }
        }
    }

    class VentanaInstalador : Form
    {
        readonly Opciones o;
        readonly TextBox carpeta = new TextBox();
        readonly Label aviso;
        readonly CheckBox escritorio = new CheckBox();
        readonly CheckBox cerebros = new CheckBox();
        readonly CheckBox whisper = new CheckBox();
        readonly string origenWhisper;
        readonly ProgressBar barra = new ProgressBar();
        readonly Label estado;
        readonly Button instalar, cancelar, cambiar;
        readonly string origenCerebros;
        bool terminado;

        public VentanaInstalador(Opciones o)
        {
            this.o = o;
            origenCerebros = o.Cerebros;
            origenWhisper = o.Whisper;
            AutoScaleDimensions = new SizeF(96f, 96f);
            AutoScaleMode = AutoScaleMode.Dpi;
            Text = "Instalar Rubenchuelo";
            Icon = Comun.IconoDelExe();
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Estilo.Cristal;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;
            Font = Estilo.Letra(10f);

            var cuerpo = new FlowLayoutPanel();
            cuerpo.FlowDirection = FlowDirection.TopDown;
            cuerpo.WrapContents = false;
            cuerpo.AutoSize = true;
            cuerpo.Padding = new Padding(22, 18, 22, 18);
            cuerpo.Dock = DockStyle.Fill;

            cuerpo.Controls.Add(Estilo.Texto("Se instalará solo para tu usuario, sin pedir permisos de administrador. Lo tendrás en el menú Inicio y podrás quitarlo desde «Aplicaciones instaladas».", 10f, Estilo.Tinta));

            var etiqueta = Estilo.Texto("Carpeta", 9.5f, Estilo.TintaSuave);
            etiqueta.Margin = new Padding(0, 4, 0, 4);
            cuerpo.Controls.Add(etiqueta);
            var fila = new FlowLayoutPanel();
            fila.AutoSize = true;
            fila.WrapContents = false;
            fila.Margin = new Padding(0, 0, 0, 4);
            carpeta.Text = o.Destino;
            carpeta.Width = 360;
            carpeta.Margin = new Padding(0, 3, 0, 0);
            carpeta.TextChanged += (s, e) => Revisar();
            cambiar = Estilo.Boton("Cambiar…", false);
            cambiar.Click += (s, e) => ElegirCarpeta();
            fila.Controls.Add(carpeta);
            fila.Controls.Add(cambiar);
            cuerpo.Controls.Add(fila);
            aviso = Estilo.Texto("", 9.5f, Estilo.TintaSuave);
            cuerpo.Controls.Add(aviso);

            escritorio.Text = "Poner un acceso directo en el escritorio";
            escritorio.Checked = o.Escritorio;
            escritorio.AutoSize = true;
            escritorio.ForeColor = Estilo.Tinta;
            escritorio.Margin = new Padding(0, 2, 0, 6);
            cuerpo.Controls.Add(escritorio);

            List<string> nombres = Instalacion.NombresDeCerebros(origenCerebros);
            if (nombres.Count > 0)
            {
                cerebros.Text = "Traer sus cerebros (" + string.Join(", ", nombres.ToArray()) + ")";
                cerebros.Checked = true;
                cerebros.AutoSize = true;
                cerebros.MaximumSize = new Size(460, 0);
                cerebros.ForeColor = Estilo.Tinta;
                cerebros.Margin = new Padding(0, 2, 0, 0);
                cuerpo.Controls.Add(cerebros);
                var de = Estilo.Texto("Se copian desde " + Path.GetDirectoryName(origenCerebros.TrimEnd('\\')) + ". Los de allí no se tocan.", 9f, Estilo.TintaSuave);
                de.Margin = new Padding(18, 0, 0, 6);
                cuerpo.Controls.Add(de);
            }

            if (origenWhisper != null)
            {
                whisper.Text = "Traer Whisper, para que entienda mucho mejor lo que oye (1,7 GB)";
                whisper.Checked = true;
                whisper.AutoSize = true;
                whisper.MaximumSize = new Size(460, 0);
                whisper.ForeColor = Estilo.Tinta;
                whisper.Margin = new Padding(0, 2, 0, 6);
                cuerpo.Controls.Add(whisper);
            }

            barra.Width = 460;
            barra.Height = 8;
            barra.Visible = false;
            barra.Margin = new Padding(0, 8, 0, 4);
            cuerpo.Controls.Add(barra);
            estado = Estilo.Texto("", 9.5f, Estilo.TintaSuave);
            cuerpo.Controls.Add(estado);

            var botones = new FlowLayoutPanel();
            botones.FlowDirection = FlowDirection.RightToLeft;
            botones.AutoSize = false;
            botones.Width = 460;
            botones.Height = 40;
            botones.Margin = new Padding(0, 6, 0, 0);
            instalar = Estilo.Boton("Instalar", true);
            instalar.Click += (s, e) =>
            {
                if (!terminado) { Instalar(); return; }
                try { Process.Start(Path.Combine(Path.GetFullPath(o.Destino), "Rubenchuelo.exe")); } catch { }
                Close();
            };
            cancelar = Estilo.Boton("Cancelar", false);
            cancelar.Click += (s, e) => Close();
            botones.Controls.Add(instalar);
            botones.Controls.Add(cancelar);
            cuerpo.Controls.Add(botones);

            Controls.Add(cuerpo);
            Controls.Add(Estilo.Cabecera("Instalador"));
            AcceptButton = instalar;
            Revisar();
        }

        void ElegirCarpeta()
        {
            using (var d = new FolderBrowserDialog())
            {
                d.Description = "¿Dónde instalo Rubenchuelo? Se creará dentro una carpeta «Rubenchuelo».";
                d.ShowNewFolderButton = true;
                if (d.ShowDialog(this) != DialogResult.OK) return;
                string elegida = d.SelectedPath;
                if (!string.Equals(Path.GetFileName(elegida.TrimEnd('\\')), "Rubenchuelo", StringComparison.OrdinalIgnoreCase))
                    elegida = Path.Combine(elegida, "Rubenchuelo");
                carpeta.Text = elegida;
            }
        }

        void Revisar()
        {
            if (terminado) return;
            string problema = Instalacion.Problema(carpeta.Text);
            if (problema != null)
            {
                aviso.Text = problema;
                aviso.ForeColor = Estilo.Peligro;
                instalar.Enabled = false;
                return;
            }
            instalar.Enabled = true;
            bool ya = Directory.Exists(carpeta.Text) && Instalacion.EsRubenchuelo(carpeta.Text);
            aviso.Text = ya ? "Ya está instalado ahí: se pondrá la versión nueva y se conservarán sus cerebros." : "";
            aviso.ForeColor = Estilo.TintaSuave;
        }

        void Instalar()
        {
            o.Destino = carpeta.Text.Trim();
            o.Escritorio = escritorio.Checked;
            o.Cerebros = cerebros.Checked ? origenCerebros : null;
            o.Whisper = whisper.Checked ? origenWhisper : null;
            if (Comun.PuertoAbierto(o.Destino) > 0)
            {
                if (MessageBox.Show(this, "Rubenchuelo está abierto en esa carpeta. ¿Lo guardo y lo cierro para instalar la versión nueva?",
                    "Instalar Rubenchuelo", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
                if (!Comun.CerrarYEsperar(o.Destino, 120))
                {
                    MessageBox.Show(this, "No se ha podido cerrar. Ciérralo con «Guardar y salir» y vuelve a intentarlo.", "Instalar Rubenchuelo", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
            }
            foreach (Control c in new Control[] { instalar, cancelar, cambiar, carpeta, escritorio, cerebros, whisper }) c.Enabled = false;
            barra.Visible = true;
            var hilo = new Thread(() =>
            {
                try
                {
                    Resultado r = Instalacion.Instalar(o, (p, t) => BeginInvoke((Action)(() => { barra.Value = Math.Min(100, p); estado.Text = t; })));
                    BeginInvoke((Action)(() => Terminado(r)));
                }
                catch (Exception e)
                {
                    BeginInvoke((Action)(() => Error(e.Message)));
                }
            });
            hilo.IsBackground = true;
            hilo.Start();
        }

        void Terminado(Resultado r)
        {
            terminado = true;
            barra.Visible = false;
            var sb = new StringBuilder(r.Actualizado ? "Rubenchuelo se ha actualizado." : "Rubenchuelo está instalado.");
            if (r.Traidos.Count > 0) sb.Append(" Se ha traído " + (r.Traidos.Count == 1 ? "un cerebro" : r.Traidos.Count + " cerebros") + ": " + string.Join(", ", r.Traidos.ToArray()) + ".");
            if (r.YaEstaban.Count > 0) sb.Append(" Ya tenía " + string.Join(", ", r.YaEstaban.ToArray()) + " y no se ha tocado.");
            if (r.WhisperCopiado) sb.Append(" Whisper también.");
            estado.Text = sb.ToString();
            estado.ForeColor = Estilo.Accion;
            aviso.Text = "";
            instalar.Text = "Abrir Rubenchuelo";
            instalar.Enabled = true;
            cancelar.Text = "Cerrar";
            cancelar.Enabled = true;
        }

        void Error(string mensaje)
        {
            barra.Visible = false;
            estado.Text = "No se ha podido instalar: " + mensaje;
            estado.ForeColor = Estilo.Peligro;
            foreach (Control c in new Control[] { instalar, cancelar, cambiar, carpeta, escritorio, cerebros, whisper }) c.Enabled = true;
            Revisar();
        }
    }
}
