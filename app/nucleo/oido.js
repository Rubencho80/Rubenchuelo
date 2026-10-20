'use strict';
// El oído: arranca oido/Oido.exe (micrófono + Vosk, sin internet), recibe lo que
// oye y decide qué frases valen la pena. Lo que pasa el filtro se aprende como
// cuando lee (aplicacion.js); lo dudoso se tira entero.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, execFile } = require('child_process');

const CARPETA = path.join(__dirname, '..', '..', 'oido');
const EXE = path.join(CARPETA, 'Oido.exe');

function disponible() {
  return process.platform === 'win32' && fs.existsSync(EXE)
    && fs.existsSync(path.join(CARPETA, 'motor', 'libvosk.dll')) && fs.existsSync(path.join(CARPETA, 'modelo', 'conf'));
}

// Decide si una frase oída se aprende. `palabras` son [palabra, seguridad 0…1].
// Si la seguridad media de la frase entera es baja, se descarta del todo; si no,
// solo se quitan las palabras sueltas de las que no está seguro.
function filtrarFrase(palabras, { confianzaPalabra = 0.5, confianzaFrase = 0.85 } = {}) {
  const lista = (palabras || []).filter((p) => Array.isArray(p) && typeof p[0] === 'string' && p[0]);
  if (!lista.length) return { aceptada: false, texto: '', media: 0, motivo: 'vacía' };
  const media = lista.reduce((s, [, c]) => s + (Number(c) || 0), 0) / lista.length;
  const original = lista.map(([w]) => w).join(' ');
  if (media < confianzaFrase) return { aceptada: false, texto: original, media, motivo: 'dudosa' };
  const buenas = lista.filter(([, c]) => (Number(c) || 0) >= confianzaPalabra).map(([w]) => w);
  if (!buenas.length) return { aceptada: false, texto: original, media, motivo: 'dudosa' };
  return { aceptada: true, texto: buenas.join(' '), media, quitadas: lista.length - buenas.length };
}

class Oido {
  constructor({ alMensaje = () => {} } = {}) {
    this.alMensaje = alMensaje;
    this.proc = null;
    this.listo = false;
  }

  get activo() {
    return Boolean(this.proc);
  }

  dispositivos() {
    return new Promise((resolve) => {
      if (!disponible()) { resolve([]); return; }
      execFile(EXE, ['--listar'], { windowsHide: true, timeout: 8000 }, (err, salida) => {
        try { resolve(err ? [] : JSON.parse(String(salida).trim().split('\n').pop())); } catch { resolve([]); }
      });
    });
  }

  // `audio`: carpeta donde dejar el sonido de cada frase (para Whisper).
  arrancar({ dispositivo = -1, pausaSeg = 1.2 } = {}, audio = null) {
    if (this.proc) return;
    if (!disponible()) throw new Error('Falta el oído (carpeta «oido» con Oido.exe, el motor y el modelo de voz)');
    const args = ['--dispositivo', String(dispositivo), '--pausa', String(Math.round(pausaSeg * 1000))];
    if (audio) args.push('--audio', audio);
    // Para las pruebas: oír una grabación en vez del micrófono.
    if (process.env.RUBENCHUELO_OIDO_ARCHIVO) args.push('--archivo', process.env.RUBENCHUELO_OIDO_ARCHIVO);
    const p = spawn(EXE, args, { cwd: CARPETA, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.proc = p;
    this.listo = false;
    readline.createInterface({ input: p.stdout }).on('line', (linea) => {
      let m;
      try { m = JSON.parse(linea); } catch { return; }
      if (m.tipo === 'listo') this.listo = true;
      this.alMensaje(m);
    });
    p.on('error', (e) => { if (this.proc === p) this.alMensaje({ tipo: 'error', mensaje: e.message }); });
    p.on('exit', (codigo) => {
      if (this.proc !== p) return;
      this.proc = null;
      this.listo = false;
      this.alMensaje({ tipo: 'fin', codigo });
    });
  }

  // Cerrarle la entrada es la forma amable de decirle que se vaya; si no, se le cierra.
  parar() {
    const p = this.proc;
    if (!p) return;
    this.proc = null;
    this.listo = false;
    try { p.stdin.end(); } catch { /* ya se había ido */ }
    setTimeout(() => { if (p.exitCode === null) p.kill(); }, 1500).unref();
  }
}

// ───────────────────────────── Whisper ─────────────────────────────
// Vosk oye al momento y marca dónde acaba cada frase; luego Whisper
// (oido/whisper: whisper.cpp con CUDA y el modelo large-v3-turbo) vuelve a
// escuchar esa frase con mucho más cuidado. Funciona con una tarjeta NVIDIA; sin
// ella sería demasiado lento y se queda Vosk.

const WHISPER = path.join(CARPETA, 'whisper');
const SERVIDOR_WHISPER = path.join(WHISPER, 'programa', 'whisper-server.exe');

function modeloWhisper() {
  try {
    const modelos = fs.readdirSync(path.join(WHISPER, 'modelos')).filter((f) => /^ggml-.*\.bin$/i.test(f)).sort();
    const turbo = modelos.find((f) => /large-v3-turbo/i.test(f));
    return turbo || modelos[0] ? path.join(WHISPER, 'modelos', turbo || modelos[0]) : null;
  } catch {
    return null;
  }
}

function whisperDisponible() {
  return process.platform === 'win32' && fs.existsSync(SERVIDOR_WHISPER) && Boolean(modeloWhisper());
}

// La respuesta de Whisper (verbose_json) → [palabra, seguridad]. Whisper trocea
// las palabras («per» + «ro»): se vuelven a juntar y su seguridad es la media de
// sus trozos. Los signos de puntuación se pegan a la palabra anterior. Se saltan
// los trozos que, según el propio Whisper, seguramente no eran voz.
function palabrasDeWhisper(respuesta) {
  const palabras = [];
  for (const seg of (respuesta && respuesta.segments) || []) {
    if (seg.no_speech_prob > 0.6) continue;
    for (const w of seg.words || []) {
      const t = String(w.word || '');
      if (!t.trim() || /^\[.*\]$/.test(t.trim())) continue;
      const p = Number(w.probability) || 0;
      const ultima = palabras[palabras.length - 1];
      if (/^[\s]*[.,;:!?¡¿…«»"')\]-]+$/.test(t) && ultima) { ultima[0] += t.trim(); continue; }
      if (!/^\s/.test(t) && ultima) { ultima[0] += t; ultima[2].push(p); continue; }
      palabras.push([t.trim(), 0, [p]]);
    }
  }
  return palabras.filter((p) => /[\p{L}\p{N}]/u.test(p[0])).map(([w, , ps]) => [w, ps.reduce((a, b) => a + b, 0) / ps.length]);
}

class Whisper {
  constructor() {
    this.proc = null;
    this.puerto = null;
    this.listo = false;
    this.gpu = null;          // null: aún no se sabe
    this._preparado = null;   // promesa que se cumple cuando está listo (o falla)
  }

  get activo() {
    return Boolean(this.proc);
  }

  arrancar() {
    if (this.proc) return this._preparado;
    if (!whisperDisponible()) return Promise.resolve(false);
    this._preparado = this._probar(8179);
    return this._preparado;
  }

  async _probar(puerto) {
    for (let intento = 0; intento < 8; intento++, puerto++) {
      const ok = await this._lanzar(puerto);
      if (ok !== 'puerto') return ok;
    }
    return false;
  }

  // Lanza el servidor y espera a que responda. 'puerto' si ese puerto estaba ocupado.
  _lanzar(puerto) {
    return new Promise((resolve) => {
      const args = ['-m', modeloWhisper(), '-l', 'auto', '--host', '127.0.0.1', '--port', String(puerto), '-t', '4'];
      const p = spawn(SERVIDOR_WHISPER, args, { cwd: path.dirname(SERVIDOR_WHISPER), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.proc = p;
      this.puerto = puerto;
      this.gpu = null;
      let registro = '';
      let terminado = false;
      const acabar = (r) => { if (!terminado) { terminado = true; resolve(r); } };
      const leer = (d) => {
        registro = (registro + d).slice(-20000);
        if (/using CUDA\d* backend|CUDA0 total size/.test(registro)) this.gpu = true;
      };
      p.stdout.on('data', leer);
      p.stderr.on('data', leer);
      p.on('error', () => { if (this.proc === p) this.proc = null; acabar(false); });
      p.on('exit', () => {
        if (this.proc === p) { this.proc = null; this.listo = false; }
        acabar(/bind|address|port/i.test(registro) ? 'puerto' : false);
      });
      const inicio = Date.now();
      const mirar = async () => {
        if (terminado || this.proc !== p) return;
        try {
          const r = await fetch(`http://127.0.0.1:${puerto}/`, { signal: AbortSignal.timeout(1000) });
          if (r.ok) {
            if (this.gpu === null) this.gpu = /CUDA/.test(registro);
            this.listo = true;
            acabar(true);
            return;
          }
        } catch { /* aún cargando */ }
        if (Date.now() - inicio > 90000) { this.parar(); acabar(false); return; }
        setTimeout(mirar, 300);
      };
      setTimeout(mirar, 500);
    });
  }

  // Devuelve { palabras, idioma } o lanza un error.
  async transcribir(rutaWav) {
    if (!this.listo) throw new Error('Whisper no está listo');
    const fd = new FormData();
    fd.append('file', new Blob([await fs.promises.readFile(rutaWav)], { type: 'audio/wav' }), 'frase.wav');
    fd.append('response_format', 'verbose_json');
    fd.append('temperature', '0');
    const r = await fetch(`http://127.0.0.1:${this.puerto}/inference`, { method: 'POST', body: fd, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`Whisper respondió ${r.status}`);
    const j = await r.json();
    return { palabras: palabrasDeWhisper(j), idioma: String(j.language || '') };
  }

  parar() {
    const p = this.proc;
    this.proc = null;
    this.listo = false;
    if (p && p.exitCode === null) { try { p.kill(); } catch { /* ya se había ido */ } }
  }
}

module.exports = { Oido, Whisper, filtrarFrase, palabrasDeWhisper, disponible, whisperDisponible };
