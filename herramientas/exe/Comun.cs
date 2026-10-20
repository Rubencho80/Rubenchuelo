// Piezas que comparten Rubenchuelo.exe (el lanzador) e «Instalar Rubenchuelo.exe».
// C# 5: se compila con el csc.exe que ya trae Windows (herramientas\construir.js).

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Rubenchuelo
{
    static class Comun
    {
        public const string Nombre = "Rubenchuelo";
        public const string ClaveDesinstalar = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Rubenchuelo";

        // Carpetas del programa (lo que se reemplaza al actualizar). Los cerebros
        // y ajustes.json son del usuario y no se tocan nunca.
        public static readonly string[] CarpetasPrograma = { "app", "runtime", "oido", "docs" };
        public static readonly string[] ArchivosPrograma = { "Rubenchuelo.exe", "LEEME.md", "Iniciar.bat", "iniciar.sh" };

        public static string CarpetaDelExe()
        {
            return Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        }

        // Una huella corta de una carpeta (para nombres únicos por instalación).
        public static string Huella(string texto)
        {
            using (var sha = SHA1.Create())
            {
                byte[] h = sha.ComputeHash(Encoding.UTF8.GetBytes(texto.ToLowerInvariant().TrimEnd('\\')));
                return BitConverter.ToString(h, 0, 4).Replace("-", "").ToLowerInvariant();
            }
        }

        // ───────────── Rubenchuelo en marcha ─────────────

        // en-uso.lock lo escribe el servidor: {"pid":1234,"puerto":7777,...}
        public static bool LeerCandado(string raiz, out int pid, out int puerto)
        {
            pid = 0;
            puerto = 0;
            try
            {
                string texto = File.ReadAllText(Path.Combine(raiz, "en-uso.lock"));
                Match a = Regex.Match(texto, "\"pid\"\\s*:\\s*(\\d+)");
                Match b = Regex.Match(texto, "\"puerto\"\\s*:\\s*(\\d+)");
                if (!a.Success || !b.Success) return false;
                pid = int.Parse(a.Groups[1].Value);
                puerto = int.Parse(b.Groups[1].Value);
                return true;
            }
            catch
            {
                return false;
            }
        }

        public static bool ProcesoVivo(int pid)
        {
            try
            {
                using (Process p = Process.GetProcessById(pid)) return !p.HasExited;
            }
            catch
            {
                return false;
            }
        }

        static HttpWebRequest Peticion(string url, string metodo, int espera)
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = metodo;
            req.Proxy = null;   // nunca por un proxy: es este mismo ordenador
            req.Timeout = espera;
            req.ReadWriteTimeout = espera;
            req.KeepAlive = false;
            return req;
        }

        public static bool Responde(int puerto)
        {
            try
            {
                using (var r = (HttpWebResponse)Peticion("http://127.0.0.1:" + puerto + "/api/ping", "GET", 1500).GetResponse())
                using (var lector = new StreamReader(r.GetResponseStream(), Encoding.UTF8))
                {
                    return r.StatusCode == HttpStatusCode.OK && lector.ReadToEnd().Contains("Rubenchuelo");
                }
            }
            catch
            {
                return false;
            }
        }

        // Si está abierto en esa carpeta, su puerto; si no, 0.
        public static int PuertoAbierto(string raiz)
        {
            int pid, puerto;
            if (LeerCandado(raiz, out pid, out puerto) && ProcesoVivo(pid) && Responde(puerto)) return puerto;
            return 0;
        }

        public static string Token(string raiz)
        {
            try
            {
                Match m = Regex.Match(File.ReadAllText(Path.Combine(raiz, "ajustes.json")), "\"token\"\\s*:\\s*\"([^\"]+)\"");
                return m.Success ? m.Groups[1].Value : "";
            }
            catch
            {
                return "";
            }
        }

        // Lo mismo que el botón «Guardar y salir».
        public static bool PedirSalir(string raiz, int puerto)
        {
            try
            {
                HttpWebRequest req = Peticion("http://127.0.0.1:" + puerto + "/api/salir", "POST", 5000);
                req.Headers.Add("X-Rubenchuelo-Token", Token(raiz));
                req.ContentLength = 0;
                using (req.GetResponse()) return true;
            }
            catch
            {
                return false;
            }
        }

        // Pide que se guarde y se cierre, y espera a que el proceso termine.
        public static bool CerrarYEsperar(string raiz, int segundos)
        {
            int pid, puerto;
            if (!LeerCandado(raiz, out pid, out puerto) || !ProcesoVivo(pid)) return true;
            PedirSalir(raiz, puerto);
            try
            {
                using (Process p = Process.GetProcessById(pid)) return p.WaitForExit(segundos * 1000);
            }
            catch
            {
                return true;
            }
        }

        // ───────────── accesos directos ─────────────

        public static void CrearAcceso(string ruta, string destino, string descripcion, string argumentos)
        {
            Type tipo = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(tipo);
            try
            {
                object acceso = tipo.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { ruta });
                Type t = acceso.GetType();
                t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, acceso, new object[] { destino });
                t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, acceso, new object[] { Path.GetDirectoryName(destino) });
                t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, acceso, new object[] { destino + ",0" });
                t.InvokeMember("Description", BindingFlags.SetProperty, null, acceso, new object[] { descripcion });
                if (!string.IsNullOrEmpty(argumentos)) t.InvokeMember("Arguments", BindingFlags.SetProperty, null, acceso, new object[] { argumentos });
                t.InvokeMember("Save", BindingFlags.InvokeMethod, null, acceso, null);
                Marshal.FinalReleaseComObject(acceso);
            }
            finally
            {
                Marshal.FinalReleaseComObject(shell);
            }
        }

        // ¿Adónde apunta un acceso directo? (para no borrar uno que no es nuestro)
        public static string DestinoDeAcceso(string ruta)
        {
            if (!File.Exists(ruta)) return null;
            Type tipo = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(tipo);
            try
            {
                object acceso = tipo.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { ruta });
                string destino = (string)acceso.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, acceso, null);
                Marshal.FinalReleaseComObject(acceso);
                return destino;
            }
            catch
            {
                return null;
            }
            finally
            {
                Marshal.FinalReleaseComObject(shell);
            }
        }

        public static string AccesoMenuInicio()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Rubenchuelo.lnk");
        }

        public static string AccesoEscritorio()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Rubenchuelo.lnk");
        }

        public static bool MismaRuta(string a, string b)
        {
            if (a == null || b == null) return false;
            try
            {
                return string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        }

        // ¿Esta carpeta es la que está instalada? (registro del desinstalador)
        public static string CarpetaInstalada(string clave)
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(clave))
            {
                return k == null ? null : k.GetValue("InstallLocation") as string;
            }
        }

        public static Icon IconoDelExe()
        {
            try
            {
                return Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
            }
            catch
            {
                return SystemIcons.Application;
            }
        }
    }

    // Los colores y letras de la interfaz de Rubenchuelo (estilos.css).
    static class Estilo
    {
        public static readonly Color Campo = ColorTranslator.FromHtml("#0d1322");
        public static readonly Color Cristal = ColorTranslator.FromHtml("#f2f4f9");
        public static readonly Color Hoja = ColorTranslator.FromHtml("#ffffff");
        public static readonly Color Tinta = ColorTranslator.FromHtml("#1c2333");
        public static readonly Color TintaSuave = ColorTranslator.FromHtml("#596279");
        public static readonly Color Linea = ColorTranslator.FromHtml("#d3d9e6");
        public static readonly Color Accion = ColorTranslator.FromHtml("#0f8f86");
        public static readonly Color Palabra = ColorTranslator.FromHtml("#4fd1c5");
        public static readonly Color VidrioTinta = ColorTranslator.FromHtml("#dce3f5");
        public static readonly Color Peligro = ColorTranslator.FromHtml("#b9413a");

        public static Font Letra(float puntos, FontStyle estilo = FontStyle.Regular)
        {
            return new Font("Segoe UI", puntos, estilo);
        }

        public static Font Voz(float puntos)
        {
            return CrearFuente(new[] { "Bahnschrift", "Segoe UI" }, puntos, FontStyle.Regular);
        }

        public static Font Mano(float puntos)
        {
            return CrearFuente(new[] { "Ink Free", "Segoe Print", "Segoe UI" }, puntos, FontStyle.Regular);
        }

        static Font CrearFuente(string[] familias, float puntos, FontStyle estilo)
        {
            foreach (string f in familias)
            {
                using (var prueba = new Font(f, puntos, estilo))
                {
                    if (string.Equals(prueba.Name, f, StringComparison.OrdinalIgnoreCase)) return new Font(f, puntos, estilo);
                }
            }
            return new Font(FontFamily.GenericSansSerif, puntos, estilo);
        }

        public static Button Boton(string texto, bool principal)
        {
            var b = new Button();
            b.Text = texto;
            b.AutoSize = true;
            b.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            b.Padding = new Padding(14, 5, 14, 5);
            b.Margin = new Padding(8, 0, 0, 0);
            b.FlatStyle = FlatStyle.Flat;
            b.Font = Voz(10.5f);
            b.Cursor = Cursors.Hand;
            b.UseVisualStyleBackColor = false;
            if (principal)
            {
                b.BackColor = Accion;
                b.ForeColor = Color.White;
                b.FlatAppearance.BorderColor = Accion;
                b.FlatAppearance.MouseOverBackColor = ColorTranslator.FromHtml("#0c7a72");
            }
            else
            {
                b.BackColor = Hoja;
                b.ForeColor = Tinta;
                b.FlatAppearance.BorderColor = Linea;
                b.FlatAppearance.MouseOverBackColor = ColorTranslator.FromHtml("#e4e8f2");
            }
            return b;
        }

        // Cabecera oscura con el icono y el nombre, como la del mapa.
        public static Panel Cabecera(string subtitulo)
        {
            var p = new Panel();
            p.Dock = DockStyle.Top;
            p.Height = 74;
            p.BackColor = Campo;
            var icono = new PictureBox();
            icono.Image = new Icon(Comun.IconoDelExe(), 48, 48).ToBitmap();
            icono.SizeMode = PictureBoxSizeMode.Zoom;
            icono.SetBounds(18, 14, 46, 46);
            var nombre = new Label();
            nombre.Text = "Rubenchuelo";
            nombre.Font = Mano(20f);
            nombre.ForeColor = ColorTranslator.FromHtml("#e8fbff");
            nombre.AutoSize = true;
            nombre.Location = new Point(72, 8);
            var sub = new Label();
            sub.Text = subtitulo;
            sub.Font = Voz(10f);
            sub.ForeColor = Palabra;
            sub.AutoSize = true;
            sub.Location = new Point(76, 46);
            p.Controls.Add(icono);
            p.Controls.Add(nombre);
            p.Controls.Add(sub);
            return p;
        }

        public static Label Texto(string texto, float puntos, Color color)
        {
            var l = new Label();
            l.Text = texto;
            l.Font = Letra(puntos);
            l.ForeColor = color;
            l.AutoSize = true;
            l.MaximumSize = new Size(460, 0);
            l.Margin = new Padding(0, 0, 0, 10);
            return l;
        }
    }
}
