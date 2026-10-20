'use strict';
// Bandeja de lectura: textos gigantes que llegan de otras apps o arrastrando
// un .txt. Se leen poco a poco (sin bloquear la charla) y, si está dormido,
// esperan a que despierte. Cada texto se repasa entero tantas veces como diga
// `repasos` (ajuste lectura.repasos, o lo que pida quien lo manda): cada vuelta
// refuerza un poco más lo leído.

const { frasesDe } = require('./texto');

const MAX_COLA = 20;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

class ErrorLectura extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

class Lectura {
  constructor({ cerebro, emitir = () => {}, puedeLeer = () => true }) {
    this.cerebro = cerebro;
    this.emitir = emitir;
    this.puedeLeer = puedeLeer;
    this.cola = [];
    this.actual = null;
    this.historial = [];
    this.sigId = 1;
    this._activo = false;
    this._parar = false;
  }

  get ocupada() {
    return Boolean(this.actual) || this.cola.length > 0;
  }

  encolar(texto, fuente = 'texto', { repasos } = {}) {
    texto = String(texto ?? '');
    if (!texto.trim()) throw new ErrorLectura(400, 'El texto está vacío');
    if (this.cola.length >= MAX_COLA) throw new ErrorLectura(429, 'La bandeja de lectura está llena; espera a que termine alguno');
    const tarea = {
      id: `L${Date.now().toString(36)}${this.sigId++}`,
      fuente: String(fuente || 'texto').slice(0, 120),
      texto,
      caracteres: texto.length,
      palabrasAprox: Math.round(texto.length / 6),
      estado: 'en_cola',
      recibido: Date.now(),
      progreso: 0,
      sesion: { palabras: 0, nuevas: 0, conceptos: 0, hipo: 0 },
      repasos: Math.max(1, Math.round(Number(repasos) || (this.cerebro.ajustes.lectura && this.cerebro.ajustes.lectura.repasos) || 1)),
      repaso: 0,
    };
    this.cola.push(tarea);
    this._aviso(tarea);
    setImmediate(() => this._arrancar());
    return this.publica(tarea);
  }

  cancelar(id) {
    if (this.actual && this.actual.id === id) {
      this.actual.cancelada = true;
      return true;
    }
    const i = this.cola.findIndex((t) => t.id === id);
    if (i < 0) return false;
    const [t] = this.cola.splice(i, 1);
    t.estado = 'cancelada';
    t.texto = null;
    this._archivar(t);
    this._aviso(t);
    return true;
  }

  detener() {
    this._parar = true;
    for (const t of this.cola) { t.estado = 'cancelada'; t.texto = null; }
    this.cola = [];
    if (this.actual) this.actual.cancelada = true;
  }

  lista() {
    return [...(this.actual ? [this.actual] : []), ...this.cola, ...this.historial].map((t) => this.publica(t));
  }

  publica(t) {
    return {
      id: t.id, fuente: t.fuente, estado: t.estado, progreso: Math.round(t.progreso * 1000) / 1000,
      caracteres: t.caracteres, palabrasAprox: t.palabrasAprox, recibido: t.recibido,
      inicio: t.inicio || null, fin: t.fin || null,
      palabras: t.sesion.palabras, nuevas: t.sesion.nuevas, conceptos: t.sesion.conceptos, recuerdos: t.sesion.hipo,
      repaso: t.repaso, repasos: t.repasos,
    };
  }

  _aviso(t) {
    this.emitir('lectura', this.publica(t));
  }

  _archivar(t) {
    this.historial.unshift(t);
    if (this.historial.length > 10) this.historial.pop();
  }

  async _arrancar() {
    if (this._activo) return;
    this._activo = true;
    try {
      while (this.cola.length && !this._parar) {
        const t = this.cola.shift();
        this.actual = t;
        try {
          await this._leer(t);
        } catch (e) {
          t.estado = 'error';
          t.error = e.message;
        }
        this.actual = null;
        t.texto = null;
        this._archivar(t);
        this._aviso(t);
        this.emitir('lectura_fin', this.publica(t));
      }
    } finally {
      this._activo = false;
    }
  }

  async _leer(t) {
    t.estado = 'leyendo';
    t.inicio = Date.now();
    this._aviso(t);
    t.repaso = 1;
    let frases = frasesDe(t.texto);
    let ultimoAviso = 0;
    for (;;) {
      if (t.cancelada || this._parar) { t.estado = 'cancelada'; break; }
      if (!this.puedeLeer()) {
        if (t.estado !== 'en_pausa') { t.estado = 'en_pausa'; this._aviso(t); }
        await esperar(1000);
        continue;
      }
      if (t.estado !== 'leyendo') { t.estado = 'leyendo'; this._aviso(t); }
      // Lee durante unos milisegundos y deja paso a todo lo demás.
      const limite = Date.now() + 25;
      let terminado = false;
      let ultimas = null;
      while (Date.now() < limite) {
        let sig = frases.next();
        if (sig.done && t.repaso < t.repasos) {
          // Otra vuelta al texto entero.
          t.repaso++;
          frases = frasesDe(t.texto);
          sig = frases.next();
        }
        if (sig.done) { terminado = true; break; }
        const r = this.cerebro.leerFrase(sig.value, t.sesion, { repaso: t.repaso > 1 });
        t.progreso = Math.min(1, (t.repaso - 1 + sig.value.fin / t.caracteres) / t.repasos);
        ultimas = r.ids;
      }
      if (terminado || Date.now() - ultimoAviso > 300) {
        ultimoAviso = Date.now();
        this._aviso(t);
        if (ultimas && ultimas.length) {
          this.emitir('pensamiento', {
            origen: 'lectura',
            pasos: [{ disparos: ultimas.map((id) => [id, 0.9]), inhib: [], senales: ultimas.slice(1).map((id, i) => [ultimas[i], id, 0.6]) }],
            ruta: [],
          });
        }
      }
      if (terminado) {
        t.estado = 'terminada';
        t.progreso = 1;
        this.cerebro.contadores.textosLeidos++;
        break;
      }
      await new Promise((r) => setImmediate(r));
    }
    t.fin = Date.now();
  }
}

module.exports = { Lectura, ErrorLectura };
