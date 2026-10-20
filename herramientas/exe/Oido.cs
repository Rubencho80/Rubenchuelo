// oido\Oido.exe: el oído de Rubenchuelo. Escucha el micrófono, lo pasa a texto
// con Vosk (oido\motor\libvosk.dll y el modelo de oido\modelo, todo sin internet)
// y, cuando hay una pausa, escribe la frase. Lo arranca el servidor (app/nucleo/oido.js)
// y habla con él por la salida estándar, una línea JSON por mensaje:
//   {"tipo":"listo"} · {"tipo":"nivel","v":0.12} · {"tipo":"parcial","texto":"…"}
//   {"tipo":"frase","texto":"…","palabras":[["hola",0.98],…]} · {"tipo":"error","mensaje":"…"}
// Con --audio CARPETA guarda además el sonido de cada frase en un .wav y lo dice
// en la frase ("audio":"…"), para que Whisper la vuelva a escuchar con más cuidado.
// Uso: Oido.exe [--dispositivo N] [--pausa MS] [--audio CARPETA] [--archivo voz.wav] | --listar
// Se cierra solo cuando se cierra su entrada estándar (si el servidor se va, él también).

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

[assembly: AssemblyTitle("Oído de Rubenchuelo")]
[assembly: AssemblyProduct("Rubenchuelo")]
[assembly: AssemblyVersion("1.2.0.0")]
[assembly: AssemblyFileVersion("1.2.0.0")]

namespace Rubenchuelo
{
    static class Vosk
    {
        const string L = "libvosk.dll";
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern void vosk_set_log_level(int nivel);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr vosk_model_new(byte[] ruta);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr vosk_recognizer_new(IntPtr modelo, float frecuencia);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern void vosk_recognizer_set_words(IntPtr rec, int si);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern int vosk_recognizer_accept_waveform(IntPtr rec, byte[] datos, int largo);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr vosk_recognizer_result(IntPtr rec);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr vosk_recognizer_partial_result(IntPtr rec);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr vosk_recognizer_final_result(IntPtr rec);

        public static string Texto(IntPtr p)
        {
            if (p == IntPtr.Zero) return "";
            int n = 0;
            while (Marshal.ReadByte(p, n) != 0) n++;
            var b = new byte[n];
            Marshal.Copy(p, b, 0, n);
            return Encoding.UTF8.GetString(b);
        }
    }

    // El micrófono con la API de siempre de Windows (winmm): 16 kHz, 16 bits, mono.
    static class Micro
    {
        [StructLayout(LayoutKind.Sequential, Pack = 2)]
        public struct Formato { public ushort wFormatTag, nChannels; public uint nSamplesPerSec, nAvgBytesPerSec; public ushort nBlockAlign, wBitsPerSample, cbSize; }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct Capacidades
        {
            public ushort wMid, wPid;
            public uint vDriverVersion;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname;
            public uint dwFormats;
            public ushort wChannels, wReserved1;
        }

        [DllImport("winmm.dll")] public static extern int waveInGetNumDevs();
        [DllImport("winmm.dll", CharSet = CharSet.Unicode)] public static extern int waveInGetDevCapsW(UIntPtr id, ref Capacidades c, int tam);
        [DllImport("winmm.dll")] public static extern int waveInOpen(out IntPtr h, uint id, ref Formato f, IntPtr cb, IntPtr inst, int flags);
        [DllImport("winmm.dll")] public static extern int waveInPrepareHeader(IntPtr h, IntPtr cab, int tam);
        [DllImport("winmm.dll")] public static extern int waveInUnprepareHeader(IntPtr h, IntPtr cab, int tam);
        [DllImport("winmm.dll")] public static extern int waveInAddBuffer(IntPtr h, IntPtr cab, int tam);
        [DllImport("winmm.dll")] public static extern int waveInStart(IntPtr h);
        [DllImport("winmm.dll")] public static extern int waveInReset(IntPtr h);
        [DllImport("winmm.dll")] public static extern int waveInClose(IntPtr h);
    }

    static class ProgramaOido
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool SetDllDirectory(string ruta);

        const int FRECUENCIA = 16000;
        const int TROZO = 3200;          // 100 ms de sonido
        const int CABECERA = 48;         // WAVEHDR en 64 bits
        static readonly object cerrojo = new object();

        static void Decir(string json)
        {
            lock (cerrojo)
            {
                Console.Out.Write(json + "\n");
                Console.Out.Flush();
            }
        }

        static string Cadena(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (char c in s ?? "")
            {
                if (c == '"' || c == '\\') sb.Append('\\').Append(c);
                else if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4"));
                else sb.Append(c);
            }
            return sb.Append('"').ToString();
        }

        static int Main(string[] args)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            string carpeta = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            Environment.CurrentDirectory = carpeta;
            int dispositivo = -1;
            int pausaMs = 1200;
            string archivo = null;
            string carpetaAudio = null;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--listar") return Listar();
                if (args[i] == "--dispositivo" && i + 1 < args.Length) dispositivo = int.Parse(args[++i]);
                else if (args[i] == "--pausa" && i + 1 < args.Length) pausaMs = Math.Max(200, int.Parse(args[++i]));
                else if (args[i] == "--archivo" && i + 1 < args.Length) archivo = args[++i];
                else if (args[i] == "--audio" && i + 1 < args.Length) carpetaAudio = args[++i];
            }
            try
            {
                SetDllDirectory(Path.Combine(carpeta, "motor"));
                Vosk.vosk_set_log_level(-1);
                // Ruta relativa: Vosk no entiende bien las rutas con letras raras.
                IntPtr modelo = Vosk.vosk_model_new(Encoding.UTF8.GetBytes("modelo\0"));
                if (modelo == IntPtr.Zero) { Decir("{\"tipo\":\"error\",\"mensaje\":\"No se pudo cargar el modelo de voz (oido\\\\modelo)\"}"); return 2; }
                var oyente = new Oyente(modelo, pausaMs, carpetaAudio);
                // Si el servidor cierra la entrada estándar (o se va), el oído también se va.
                if (archivo != null) return oyente.DesdeArchivo(archivo);
                var vigia = new Thread(() => { try { while (Console.In.Read() >= 0) { } } catch { } Environment.Exit(0); });
                vigia.IsBackground = true;
                vigia.Start();
                return oyente.DesdeMicro(dispositivo);
            }
            catch (DllNotFoundException)
            {
                Decir("{\"tipo\":\"error\",\"mensaje\":\"Falta el motor de voz (oido\\\\motor\\\\libvosk.dll)\"}");
                return 2;
            }
            catch (Exception e)
            {
                Decir("{\"tipo\":\"error\",\"mensaje\":" + Cadena(e.Message) + "}");
                return 2;
            }
        }

        static int Listar()
        {
            var sb = new StringBuilder("[");
            int n = Micro.waveInGetNumDevs();
            for (int i = 0; i < n; i++)
            {
                var c = new Micro.Capacidades();
                if (Micro.waveInGetDevCapsW(new UIntPtr((uint)i), ref c, Marshal.SizeOf(typeof(Micro.Capacidades))) != 0) continue;
                if (sb.Length > 1) sb.Append(',');
                sb.Append("{\"id\":").Append(i).Append(",\"nombre\":").Append(Cadena(c.szPname)).Append('}');
            }
            Decir(sb.Append(']').ToString());
            return 0;
        }

        class Oyente
        {
            readonly IntPtr rec;
            readonly double pausa;
            readonly List<string> palabras = new List<string>();
            readonly StringBuilder texto = new StringBuilder();
            string parcial = "";
            double reloj;          // segundos de sonido procesados
            double ultimaVoz = -1;
            double ultimoNivel;
            double nivelMax;
            // Sonido de la frase en curso (con segundo y medio de antes: Vosk tarda un poco en
            // darse cuenta de que alguien habla, y así no se corta el principio).
            readonly string carpetaAudio;
            readonly List<byte[]> sonido = new List<byte[]>();
            int numAudio;

            public Oyente(IntPtr modelo, int pausaMs, string carpetaAudio)
            {
                this.carpetaAudio = carpetaAudio;
                if (carpetaAudio != null) Directory.CreateDirectory(carpetaAudio);
                rec = Vosk.vosk_recognizer_new(modelo, FRECUENCIA);
                Vosk.vosk_recognizer_set_words(rec, 1);
                pausa = pausaMs / 1000.0;
            }

            // Cada trozo de sonido: al reconocedor, y si lleva callado lo bastante, la frase.
            void Trozo(byte[] datos, int largo)
            {
                reloj += largo / 2.0 / FRECUENCIA;
                double suma = 0;
                for (int i = 0; i + 1 < largo; i += 2)
                {
                    double s = (short)(datos[i] | (datos[i + 1] << 8)) / 32768.0;
                    suma += s * s;
                }
                nivelMax = Math.Max(nivelMax, Math.Sqrt(suma / Math.Max(1, largo / 2)));
                if (reloj - ultimoNivel >= 0.2)
                {
                    Decir("{\"tipo\":\"nivel\",\"v\":" + Math.Min(1, nivelMax * 4).ToString("0.###", CultureInfo.InvariantCulture) + "}");
                    ultimoNivel = reloj;
                    nivelMax = 0;
                }
                byte[] buf = new byte[largo];
                Array.Copy(datos, buf, largo);
                if (carpetaAudio != null)
                {
                    sonido.Add(buf);
                    bool callado = ultimaVoz < 0 && palabras.Count == 0 && parcial.Length == 0;
                    if (callado && sonido.Count > 15) sonido.RemoveRange(0, sonido.Count - 15);
                    if (sonido.Count > 600) sonido.RemoveRange(0, sonido.Count - 600);   // como mucho, el último minuto
                }
                if (Vosk.vosk_recognizer_accept_waveform(rec, buf, largo) != 0)
                {
                    Juntar(Vosk.Texto(Vosk.vosk_recognizer_result(rec)));
                    if (parcial.Length > 0) { parcial = ""; }
                }
                else
                {
                    Match m = Regex.Match(Vosk.Texto(Vosk.vosk_recognizer_partial_result(rec)), "\"partial\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
                    string p = m.Success ? m.Groups[1].Value : "";
                    if (p != parcial)
                    {
                        parcial = p;
                        if (p.Length > 0) ultimaVoz = reloj;
                        Decir("{\"tipo\":\"parcial\",\"texto\":" + Cadena((texto.ToString() + " " + p).Trim()) + "}");
                    }
                }
                if (ultimaVoz >= 0 && reloj - ultimaVoz >= pausa) Terminar();
            }

            void Juntar(string json)
            {
                foreach (Match o in Regex.Matches(json, "\\{[^{}]*\\}"))
                {
                    Match c = Regex.Match(o.Value, "\"conf\"\\s*:\\s*([0-9.eE+-]+)");
                    Match w = Regex.Match(o.Value, "\"word\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
                    if (!c.Success || !w.Success) continue;
                    palabras.Add("[\"" + w.Groups[1].Value + "\"," + double.Parse(c.Groups[1].Value, CultureInfo.InvariantCulture).ToString("0.###", CultureInfo.InvariantCulture) + "]");
                    texto.Append(texto.Length > 0 ? " " : "").Append(w.Groups[1].Value);
                    ultimaVoz = reloj;
                }
            }

            // Ha habido una pausa: lo que haya quedado a medias se da por acabado y se manda la frase.
            void Terminar()
            {
                if (parcial.Length > 0) { Juntar(Vosk.Texto(Vosk.vosk_recognizer_final_result(rec))); parcial = ""; }
                if (palabras.Count > 0)
                {
                    string audio = GuardarSonido();
                    Decir("{\"tipo\":\"frase\",\"texto\":\"" + texto + "\",\"palabras\":[" + string.Join(",", palabras.ToArray()) + "]"
                        + (audio != null ? ",\"audio\":" + Cadena(audio) : "") + "}");
                }
                sonido.Clear();
                palabras.Clear();
                texto.Clear();
                ultimaVoz = -1;
                Decir("{\"tipo\":\"parcial\",\"texto\":\"\"}");
            }

            string GuardarSonido()
            {
                if (carpetaAudio == null || sonido.Count == 0) return null;
                try
                {
                    int total = 0;
                    foreach (byte[] b in sonido) total += b.Length;
                    string ruta = Path.Combine(carpetaAudio, "frase-" + (++numAudio % 50) + ".wav");
                    using (var w = new BinaryWriter(File.Create(ruta)))
                    {
                        w.Write(Encoding.ASCII.GetBytes("RIFF")); w.Write(36 + total); w.Write(Encoding.ASCII.GetBytes("WAVEfmt "));
                        w.Write(16); w.Write((short)1); w.Write((short)1); w.Write(FRECUENCIA); w.Write(FRECUENCIA * 2); w.Write((short)2); w.Write((short)16);
                        w.Write(Encoding.ASCII.GetBytes("data")); w.Write(total);
                        foreach (byte[] b in sonido) w.Write(b);
                    }
                    return ruta;
                }
                catch
                {
                    return null;
                }
            }

            public int DesdeArchivo(string ruta)
            {
                byte[] wav = File.ReadAllBytes(ruta);
                int datos = 12;
                while (datos + 8 <= wav.Length && Encoding.ASCII.GetString(wav, datos, 4) != "data") datos += 8 + BitConverter.ToInt32(wav, datos + 4);
                datos += 8;
                Decir("{\"tipo\":\"listo\"}");
                var trozo = new byte[TROZO];
                for (int i = datos; i < wav.Length; i += TROZO)
                {
                    int n = Math.Min(TROZO, wav.Length - i);
                    Array.Copy(wav, i, trozo, 0, n);
                    Trozo(trozo, n - (n % 2));
                }
                // Silencio al final, para que salga la última frase.
                Array.Clear(trozo, 0, TROZO);
                for (int i = 0; i < (pausa + 1) * 10 && (palabras.Count > 0 || parcial.Length > 0); i++) Trozo(trozo, TROZO);
                return 0;
            }

            public int DesdeMicro(int dispositivo)
            {
                var f = new Micro.Formato { wFormatTag = 1, nChannels = 1, nSamplesPerSec = FRECUENCIA, nAvgBytesPerSec = FRECUENCIA * 2, nBlockAlign = 2, wBitsPerSample = 16 };
                IntPtr h;
                uint id = dispositivo < 0 ? 0xFFFFFFFF : (uint)dispositivo;
                if (Micro.waveInOpen(out h, id, ref f, IntPtr.Zero, IntPtr.Zero, 0) != 0)
                {
                    Decir("{\"tipo\":\"error\",\"mensaje\":\"No se puede abrir el micrófono. ¿Está conectado y con permiso en Configuración → Privacidad → Micrófono?\"}");
                    return 3;
                }
                const int N = 8;
                var cabeceras = new IntPtr[N];
                for (int i = 0; i < N; i++)
                {
                    cabeceras[i] = Marshal.AllocHGlobal(CABECERA);
                    for (int b = 0; b < CABECERA; b++) Marshal.WriteByte(cabeceras[i], b, 0);
                    Marshal.WriteIntPtr(cabeceras[i], 0, Marshal.AllocHGlobal(TROZO));
                    Marshal.WriteInt32(cabeceras[i], 8, TROZO);
                    Micro.waveInPrepareHeader(h, cabeceras[i], CABECERA);
                    Micro.waveInAddBuffer(h, cabeceras[i], CABECERA);
                }
                Micro.waveInStart(h);
                Decir("{\"tipo\":\"listo\"}");
                var datos = new byte[TROZO];
                int actual = 0;
                for (;;)
                {
                    IntPtr c = cabeceras[actual];
                    if ((Marshal.ReadInt32(c, 24) & 1) == 0) { Thread.Sleep(10); continue; }   // WHDR_DONE
                    int grabados = Marshal.ReadInt32(c, 12);
                    Marshal.Copy(Marshal.ReadIntPtr(c, 0), datos, 0, grabados);
                    Micro.waveInUnprepareHeader(h, c, CABECERA);
                    Marshal.WriteInt32(c, 24, 0);
                    Micro.waveInPrepareHeader(h, c, CABECERA);
                    Micro.waveInAddBuffer(h, c, CABECERA);
                    actual = (actual + 1) % N;
                    if (grabados > 0) Trozo(datos, grabados - (grabados % 2));
                }
            }
        }
    }
}
