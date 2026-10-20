// El mapa de neuronas: sabe dónde está cada neurona, mueve la cámara, recibe
// los disparos y las señales que viajan por las conexiones, y responde al ratón.
// Dibujarlo es cosa de un «pintor»: el optimizado usa la tarjeta gráfica
// (pintor-gl.js) y el clásico dibuja con el lienzo 2D del navegador
// (pintor-lienzo.js). Los dos leen lo mismo de aquí.

import { TIPOS } from './util.js';
import { PintorLienzo } from './pintor-lienzo.js';
import { PintorGL } from './pintor-gl.js';

const DUR_PASO = {
  charla: 120, estimulo: 120, repaso: 125, ensayo: 90, sueno: 150, lectura: 60, premio: 0, castigo: 0,
  deduccion: 260, categoria: 200, oido: 90,
};
const COLOR_SENAL = {
  charla: '#e8fbff', estimulo: '#f1e3ff', repaso: '#ffd98a', ensayo: '#bfd0ff', sueno: '#e3b8ff',
  lectura: '#b8fff4', premio: '#8cffb0', castigo: '#ff9a9a', voz: '#ffffff',
  deduccion: '#ff9ff3', categoria: '#c6ff6b', oido: '#ffc2e2',
};
const DUR_MOVER = 900;     // lo que tarda una neurona en deslizarse a su sitio nuevo
const VIDA_ANILLO = 1400;  // anillo de nacimiento
const VIDA_MUERTE = 700;

const lim = (x, a, b) => (x < a ? a : x > b ? b : x);
const sinAristas = () => ({ a: new Uint32Array(0), b: new Uint32Array(0), w: new Float32Array(0), k: new Uint8Array(0), n: 0 });

export class Mapa {
  constructor(lienzo, { rotulo = null, alSeleccionar = () => {}, optimizado = true } = {}) {
    this.cv = lienzo;
    this.g = lienzo.getContext('2d');
    this.rotulo = rotulo;
    this.alSeleccionar = alSeleccionar;
    // Cada neurona: { id, t (tipo), l (nombre), s (tamaño), ox, oy (de dónde viene),
    // tx, ty (adónde va), nace, muere }. Su sitio ahora es o + (t − o) · e.
    this.nodos = new Map();
    this.aristas = sinAristas();
    this.porTamano = [];   // las que tienen nombre, de mayor a menor (para elegir etiquetas)
    this.cuentas = [0, 0, 0, 0, 0, 0];
    this.regiones = [];
    this.cam = { x: 0, y: 100, z: 0.4 };
    this.objetivo = null;
    this.visibles = new Set([0, 1, 2, 3, 4, 5]);
    this.mascara = 0b111111;
    this.etiquetas = true;
    this.pesoMin = 0;
    this.seleccion = null;
    this.encima = null;
    this.resaltado = null;
    this.enMente = new Set();
    this.enfocados = new Set();
    this.vecSel = null;          // conexiones de la seleccionada (índices en this.aristas)
    this.actividad = new Map();
    this.senales = [];
    this.cola = [];
    this.finCola = 0;
    this.recientes = [];         // recién nacidas (para su anillo)
    this.muriendo = [];
    this.trans = 0;              // cuándo empezó a moverse todo por última vez
    this.e = 1;                  // cuánto del movimiento va hecho (0…1)
    this.noche = false;
    this.reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.ancho = 1;
    this.alto = 1;
    this.dpr = 1;
    this.sucio = true;
    this.encajado = false;
    this.version = null;
    this.epoca = null;
    this.pintor = null;
    this.optimizado = false;
    this._eventos();
    new ResizeObserver(() => this._redimensionar()).observe(lienzo.parentElement);
    this.ponerOptimizado(optimizado);
    this._ultimo = performance.now();
    requestAnimationFrame((t) => this._bucle(t));
  }

  // Cambia de pintor. Devuelve si ha quedado el optimizado (puede que el
  // navegador no deje usar la tarjeta gráfica).
  ponerOptimizado(si) {
    let nuevo = null;
    if (si) {
      try { nuevo = new PintorGL(this); } catch (e) { console.warn('El mapa no puede usar la tarjeta gráfica:', e.message); }
    }
    if (this.pintor) this.pintor.destruir();
    this.pintor = nuevo || new PintorLienzo(this);
    this.optimizado = Boolean(nuevo);
    this._redimensionar();
    this.pintor.alCargar();
    this.sucio = true;
    return this.optimizado;
  }

  // Si la tarjeta gráfica falla de golpe, se vuelve al dibujo clásico.
  _pintorFallido() {
    this.ponerOptimizado(false);
    if (this.alFallarOptimizado) this.alFallarOptimizado();
  }

  // ───────────── datos ─────────────

  x(n) { return n.ox + (n.tx - n.ox) * this.e; }
  y(n) { return n.oy + (n.ty - n.oy) * this.e; }

  _avance(ahora) {
    if (this.reducido) return 1;
    const p = Math.min(1, Math.max(0, (ahora - this.trans) / DUR_MOVER));
    return 1 - Math.pow(1 - p, 3);
  }

  // Deja cada neurona donde se ve ahora, para empezar un movimiento nuevo sin
  // saltos. Devuelve si alguna seguía de camino.
  _congelar(ahora) {
    const e = this._avance(ahora);
    let enCamino = false;
    for (const n of this.nodos.values()) {
      if (n.ox === n.tx && n.oy === n.ty) continue;
      if (e >= 1) { n.ox = n.tx; n.oy = n.ty; continue; }
      n.ox += (n.tx - n.ox) * e;
      n.oy += (n.ty - n.oy) * e;
      enCamino = true;
    }
    this.e = 0;
    return enCamino;
  }

  // El mapa completo (ver formato-mapa.js): neuronas, conexiones y regiones.
  cargar(d) {
    const ahora = performance.now();
    const seguia = this._congelar(ahora);
    const vistos = new Set();
    let movido = false;
    const { ids, xy, tipos, tam, etiquetas } = d;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      vistos.add(id);
      const x = xy[2 * i], y = xy[2 * i + 1];
      const n = this.nodos.get(id);
      if (!n) {
        this.nodos.set(id, { id, t: tipos[i], l: etiquetas[i] || '', s: tam[i] / 10, ox: x, oy: y, tx: x, ty: y, nace: 0, muere: 0 });
        continue;
      }
      n.t = tipos[i]; n.l = etiquetas[i] || ''; n.s = tam[i] / 10; n.muere = 0;
      if (Math.abs(n.tx - x) > 0.5 || Math.abs(n.ty - y) > 0.5) { n.tx = x; n.ty = y; movido = true; }
    }
    for (const [id, n] of this.nodos) {
      if (!vistos.has(id) && !(n.nace && ahora - n.nace < 6000)) this.nodos.delete(id);
    }
    this.muriendo = this.muriendo.filter((n) => n.muere && this.nodos.get(n.id) === n);
    this.recientes = this.recientes.filter((n) => this.nodos.get(n.id) === n);
    this.trans = movido || seguia ? ahora : 0;
    this.e = this._avance(ahora);
    const A = d.aristas;
    const w = new Float32Array(A.w.length);
    for (let j = 0; j < w.length; j++) w[j] = A.w[j] / 255;
    this.aristas = { a: A.a, b: A.b, w, k: A.k, n: A.a.length };
    if (d.regiones && d.regiones.length) this.regiones = d.regiones;
    this.version = d.version;
    this.epoca = d.epoca;
    this._indexar();
    this._recalcularFoco();
    if (!this.encajado) { this.encajar(false); this.encajado = true; }
    this.pintor.alCargar();
    this.sucio = true;
  }

  // Solo las posiciones nuevas (lo que más cambia): se deslizan hasta ellas.
  mover(d) {
    const ahora = performance.now();
    this.epoca = d.epoca;
    const { ids, xy } = d;
    let movido = false;
    let congelado = false;
    for (let i = 0; i < ids.length; i++) {
      const n = this.nodos.get(ids[i]);
      if (!n || n.muere) continue;
      const x = xy[2 * i], y = xy[2 * i + 1];
      if (Math.abs(n.tx - x) <= 0.5 && Math.abs(n.ty - y) <= 0.5) continue;
      if (!congelado) { this._congelar(ahora); congelado = true; }
      n.tx = x; n.ty = y; movido = true;
    }
    if (!movido) return;
    this.trans = ahora;
    this.e = 0;
    this.pintor.alMover();
    this.sucio = true;
  }

  _indexar() {
    const c = [0, 0, 0, 0, 0, 0];
    // Por tamaño de mayor a menor (en cubetas: no hace falta ordenar 100.000 cosas).
    const cubetas = Array.from({ length: 256 }, () => []);
    const extremos = [];
    for (const n of this.nodos.values()) {
      if (!n.muere) c[n.t]++;
      if (!n.l || n.t === 3) continue;
      if (n.t >= 4) extremos.push(n); else cubetas[Math.min(255, Math.round(n.s * 10))].push(n);
    }
    const lista = extremos;
    for (let i = 255; i >= 0; i--) for (const n of cubetas[i]) lista.push(n);
    this.porTamano = lista;
    this.cuentas = c;
  }

  vaciar() {
    this.nodos.clear();
    this.aristas = sinAristas();
    this.porTamano = [];
    this.cuentas = [0, 0, 0, 0, 0, 0];
    this.actividad.clear();
    this.senales = [];
    this.cola = [];
    this.recientes = [];
    this.muriendo = [];
    this.seleccion = null;
    this.resaltado = null;
    this.enfocados = new Set();
    this.vecSel = null;
    this.version = null;
    this.epoca = null;
    this.encajado = false;
    this.pintor.alCargar();
    this.sucio = true;
  }

  nacer(lista) {
    const ahora = performance.now();
    const cambiadas = [];
    for (const [id, t, x, y, l, s] of lista) {
      const n = this.nodos.get(id);
      if (n) {
        if (n.muere) { n.muere = 0; this.cuentas[n.t]++; cambiadas.push(n); }
        continue;
      }
      const nueva = { id, t, l: l || '', s, ox: x, oy: y, tx: x, ty: y, nace: this.reducido ? 0 : ahora, muere: 0 };
      this.nodos.set(id, nueva);
      this.cuentas[t]++;
      if (nueva.l && t !== 3) this.porTamano.push(nueva);
      if (!this.reducido) this.recientes.push(nueva);
      cambiadas.push(nueva);
    }
    if (cambiadas.length) this.pintor.alNodos(cambiadas);
    this.sucio = true;
  }

  morir(ids) {
    const ahora = performance.now();
    const cambiadas = [];
    const quitadas = [];
    for (const id of ids) {
      const n = this.nodos.get(id);
      if (!n || n.muere) continue;
      this.cuentas[n.t]--;
      this.actividad.delete(id);
      if (this.seleccion === id) this.seleccionar(null);
      n.muere = ahora;
      if (this.reducido) { this.nodos.delete(id); quitadas.push(n); continue; }
      this.muriendo.push(n);
      cambiadas.push(n);
    }
    if (cambiadas.length) this.pintor.alNodos(cambiadas);
    if (quitadas.length) this.pintor.alQuitar(quitadas);
    this.sucio = true;
  }

  contar() {
    return this.cuentas.slice();
  }

  buscar(texto, max = 8) {
    const t = texto.trim().toLocaleLowerCase('es');
    if (!t) return [];
    const empieza = [], contiene = [];
    for (const n of this.nodos.values()) {
      if (n.t !== 0 || n.muere) continue;
      const l = n.l.toLocaleLowerCase('es');
      if (l.startsWith(t)) empieza.push(n); else if (l.includes(t)) contiene.push(n);
    }
    const orden = (a, b) => b.s - a.s;
    return [...empieza.sort(orden), ...contiene.sort(orden)].slice(0, max);
  }

  // ───────────── animaciones ─────────────

  animar(p) {
    if (document.hidden || !p) return;
    const ahora = performance.now();
    const dur = this.reducido ? 0 : (DUR_PASO[p.origen] ?? 110);
    let t = this.finCola > ahora && this.finCola - ahora < 1800 ? this.finCola : ahora;
    for (const paso of p.pasos || []) {
      this.cola.push({ t, paso, origen: p.origen, dur });
      t += dur;
    }
    if (!this.reducido && p.ruta && p.ruta.length > 1) {
      // La "voz": recorre en orden las palabras que ha dicho.
      for (let i = 0; i < p.ruta.length; i++) {
        this.cola.push({
          t,
          paso: { disparos: [[p.ruta[i], 1]], senales: i ? [[p.ruta[i - 1], p.ruta[i], 1]] : [] },
          origen: 'voz',
          dur: 160,
        });
        t += 160;
      }
    }
    this.finCola = t;
    if (this.cola.length > 700) this.cola.splice(0, this.cola.length - 700);
    this.cola.sort((a, b) => a.t - b.t);
    this.sucio = true;
  }

  _aplicar({ paso, origen, dur }) {
    const ahora = performance.now();
    for (const [id, a] of paso.disparos || []) {
      this.actividad.set(id, Math.min(1, Math.max(this.actividad.get(id) || 0, a)));
    }
    for (const [id, a] of paso.inhib || []) {
      this.actividad.set(id, Math.min(1, Math.max(this.actividad.get(id) || 0, a * 0.8)));
    }
    if (this.reducido) return;
    const color = COLOR_SENAL[origen] || '#ffffff';
    for (const [a, b, x] of paso.senales || []) {
      if (this.senales.length > 900) break;
      this.senales.push({ a, b, t0: ahora, dur: Math.max(240, dur * 1.9), fuerza: x, color });
    }
  }

  // ───────────── cámara ─────────────

  aPantalla(x, y) {
    return [(x - this.cam.x) * this.cam.z + this.ancho / 2, (y - this.cam.y) * this.cam.z + this.alto / 2];
  }

  aMundo(sx, sy) {
    return [(sx - this.ancho / 2) / this.cam.z + this.cam.x, (sy - this.alto / 2) / this.cam.z + this.cam.y];
  }

  zoomEn(sx, sy, f) {
    const [wx, wy] = this.aMundo(sx, sy);
    this.cam.z = lim(this.cam.z * f, 0.04, 8);
    this.cam.x = wx - (sx - this.ancho / 2) / this.cam.z;
    this.cam.y = wy - (sy - this.alto / 2) / this.cam.z;
    this.objetivo = null;
    this.sucio = true;
  }

  volarA(x, y, z = this.cam.z) {
    if (this.reducido) { this.cam = { x, y, z }; this.sucio = true; return; }
    this.objetivo = { x, y, z: lim(z, 0.04, 8) };
    this.sucio = true;
  }

  _caja(ids) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) {
      const n = this.nodos.get(id);
      if (!n) continue;
      x0 = Math.min(x0, n.tx); y0 = Math.min(y0, n.ty); x1 = Math.max(x1, n.tx); y1 = Math.max(y1, n.ty);
    }
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
  }

  _encuadrar(caja, animado, zMax = 3) {
    const m = 70;
    const z = Math.min((this.ancho - m * 2) / Math.max(60, caja.x1 - caja.x0), (this.alto - m * 2 - 50) / Math.max(60, caja.y1 - caja.y0), zMax);
    const x = (caja.x0 + caja.x1) / 2;
    const y = (caja.y0 + caja.y1) / 2 - 20 / z;
    if (animado) this.volarA(x, y, z); else { this.cam = { x, y, z: lim(z, 0.04, 8) }; this.sucio = true; }
  }

  encajar(animado = true) {
    let caja = null;
    for (const r of this.regiones) {
      const c = { x0: r.cx - r.rx, y0: r.cy - r.ry, x1: r.cx + r.rx, y1: r.cy + r.ry };
      caja = caja ? { x0: Math.min(caja.x0, c.x0), y0: Math.min(caja.y0, c.y0), x1: Math.max(caja.x1, c.x1), y1: Math.max(caja.y1, c.y1) } : c;
    }
    for (const n of this.nodos.values()) {
      if (n.t < 4) continue;
      caja = caja ? { x0: Math.min(caja.x0, n.tx - 60), y0: caja.y0, x1: Math.max(caja.x1, n.tx + 60), y1: caja.y1 } : null;
    }
    if (caja) this._encuadrar(caja, animado);
  }

  // ───────────── selección ─────────────

  seleccionar(id, { centrar = false, avisar = true } = {}) {
    this.seleccion = id;
    if (id !== null) {
      const n = this.nodos.get(id);
      if (n && centrar) this.volarA(n.tx, n.ty, Math.max(this.cam.z, 1.1));
    }
    this._recalcularFoco();
    if (avisar) this.alSeleccionar(id);
    this.sucio = true;
  }

  // Resalta lo que usó para decir algo ("¿por qué?").
  resaltar(ids, pasos = []) {
    if (!ids || !ids.length) {
      this.resaltado = null;
    } else {
      this.resaltado = { nodos: new Set(ids), pasos, hasta: performance.now() + 20000 };
      const caja = this._caja(ids);
      if (caja) this._encuadrar({ x0: caja.x0 - 40, y0: caja.y0 - 40, x1: caja.x1 + 40, y1: caja.y1 + 40 }, true, 1.8);
    }
    this._recalcularFoco();
    this.sucio = true;
  }

  // Lo enfocado (la seleccionada con sus vecinas y lo resaltado) se ve fuerte;
  // el resto, atenuado.
  _recalcularFoco() {
    const enfocados = new Set();
    let vec = null;
    if (this.seleccion !== null) {
      enfocados.add(this.seleccion);
      vec = [];
      const A = this.aristas;
      const s = this.seleccion;
      for (let j = 0; j < A.n; j++) {
        if (A.a[j] === s || A.b[j] === s) { vec.push(j); enfocados.add(A.a[j]); enfocados.add(A.b[j]); }
      }
    }
    if (this.resaltado) for (const id of this.resaltado.nodos) enfocados.add(id);
    const igual = enfocados.size === this.enfocados.size && [...enfocados].every((id) => this.enfocados.has(id));
    this.enfocados = enfocados;
    this.vecSel = vec;
    if (!igual && this.pintor) this.pintor.alEnfocar();
    this.sucio = true;
  }

  modoNoche(si) {
    if (this.noche !== si) { this.noche = si; this.sucio = true; }
  }

  // Lo que tiene en mente (memoria de trabajo): anillo discontinuo.
  ponerEnMente(ids) {
    const nuevo = new Set(ids);
    if (nuevo.size === this.enMente.size && [...nuevo].every((id) => this.enMente.has(id))) return;
    this.enMente = nuevo;
    this.sucio = true;
  }

  ponerVisible(t, si) {
    const tipos = t === 4 ? [4, 5] : [t];
    for (const x of tipos) {
      if (si) this.visibles.add(x); else this.visibles.delete(x);
    }
    this.mascara = 0;
    for (const x of this.visibles) this.mascara |= 1 << x;
    this.sucio = true;
  }

  // ───────────── eventos ─────────────

  _redimensionar() {
    const caja = this.cv.parentElement.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.ancho = Math.max(1, caja.width);
    this.alto = Math.max(1, caja.height);
    this.cv.width = Math.round(this.ancho * this.dpr);
    this.cv.height = Math.round(this.alto * this.dpr);
    if (this.pintor) this.pintor.redimensionar();
    this.sucio = true;
  }

  // La neurona bajo el ratón (la más cercana a menos de su radio + 6 px).
  _neuronaEn(sx, sy) {
    const z = this.cam.z, e = this.e;
    const crecer = 0.55 + 0.45 * Math.pow(z, 0.6);
    const cx = this.cam.x, cy = this.cam.y, mx = this.ancho / 2 - sx, my = this.alto / 2 - sy;
    const mascara = this.mascara;
    let mejor = null;
    let mejorD = Infinity;
    for (const n of this.nodos.values()) {
      if (n.muere || !((mascara >> n.t) & 1)) continue;
      const dx = (n.ox + (n.tx - n.ox) * e - cx) * z + mx;
      if (dx > 50 || dx < -50) continue;
      const dy = (n.oy + (n.ty - n.oy) * e - cy) * z + my;
      if (dy > 50 || dy < -50) continue;
      const d = Math.hypot(dx, dy);
      if (d < Math.max(1.6, n.s * crecer) + 6 && d < mejorD) { mejor = n; mejorD = d; }
    }
    return mejor;
  }

  _mostrarRotulo(n, sx, sy) {
    if (!this.rotulo) return;
    if (!n) { this.rotulo.hidden = true; return; }
    this.rotulo.replaceChildren();
    const b = document.createElement('b');
    b.textContent = n.l || TIPOS[n.t].nombre;
    this.rotulo.append(b, ` ${TIPOS[n.t].nombre.toLocaleLowerCase('es')}`);
    this.rotulo.hidden = false;
    const x = Math.min(sx + 14, this.ancho - this.rotulo.offsetWidth - 8);
    const y = Math.min(sy + 14, this.alto - 34);
    this.rotulo.style.left = `${x}px`;
    this.rotulo.style.top = `${y}px`;
  }

  _eventos() {
    const cv = this.cv;
    const punteros = new Map();
    let arrastre = null;
    let pellizco = null;

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
      this.zoomEn(e.offsetX, e.offsetY, f);
    }, { passive: false });

    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      punteros.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (punteros.size === 1) {
        arrastre = { x: e.offsetX, y: e.offsetY, cx: this.cam.x, cy: this.cam.y, movido: false };
      } else if (punteros.size === 2) {
        const [a, b] = [...punteros.values()];
        pellizco = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.cam.z };
        arrastre = null;
      }
    });

    cv.addEventListener('pointermove', (e) => {
      if (punteros.has(e.pointerId)) punteros.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pellizco && punteros.size === 2) {
        const [a, b] = [...punteros.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const f = (pellizco.z * (d / Math.max(1, pellizco.d))) / this.cam.z;
        this.zoomEn((a.x + b.x) / 2, (a.y + b.y) / 2, f);
        return;
      }
      if (arrastre) {
        const dx = e.offsetX - arrastre.x;
        const dy = e.offsetY - arrastre.y;
        if (!arrastre.movido && Math.hypot(dx, dy) > 4) { arrastre.movido = true; cv.classList.add('arrastrando'); }
        if (arrastre.movido) {
          this.cam.x = arrastre.cx - dx / this.cam.z;
          this.cam.y = arrastre.cy - dy / this.cam.z;
          this.objetivo = null;
          this.sucio = true;
          this._mostrarRotulo(null);
          return;
        }
      }
      const n = this._neuronaEn(e.offsetX, e.offsetY);
      if ((n ? n.id : null) !== this.encima) { this.encima = n ? n.id : null; this.sucio = true; }
      cv.classList.toggle('sobre-neurona', Boolean(n));
      this._mostrarRotulo(n, e.offsetX, e.offsetY);
    });

    const soltar = (e) => {
      punteros.delete(e.pointerId);
      if (punteros.size < 2) pellizco = null;
      if (arrastre && !arrastre.movido && punteros.size === 0) {
        const n = this._neuronaEn(e.offsetX, e.offsetY);
        this.seleccionar(n ? n.id : null);
        if (!n) this.resaltar(null);
      }
      if (punteros.size === 0) arrastre = null;
      cv.classList.remove('arrastrando');
    };
    cv.addEventListener('pointerup', soltar);
    cv.addEventListener('pointercancel', soltar);
    cv.addEventListener('pointerleave', () => { this.encima = null; this._mostrarRotulo(null); this.sucio = true; });
    cv.addEventListener('dblclick', (e) => this.zoomEn(e.offsetX, e.offsetY, 2));

    cv.addEventListener('keydown', (e) => {
      const paso = 60 / this.cam.z;
      const acciones = {
        '+': () => this.zoomEn(this.ancho / 2, this.alto / 2, 1.25),
        '=': () => this.zoomEn(this.ancho / 2, this.alto / 2, 1.25),
        '-': () => this.zoomEn(this.ancho / 2, this.alto / 2, 0.8),
        ArrowLeft: () => { this.cam.x -= paso; },
        ArrowRight: () => { this.cam.x += paso; },
        ArrowUp: () => { this.cam.y -= paso; },
        ArrowDown: () => { this.cam.y += paso; },
        0: () => this.encajar(),
        Escape: () => { this.seleccionar(null); this.resaltar(null); },
      };
      const f = acciones[e.key];
      if (f) { e.preventDefault(); f(); this.sucio = true; }
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { this.cola = []; this.senales = []; this.sucio = true; }
    });
  }

  // ───────────── bucle ─────────────
  // Solo se dibuja si algo se mueve o ha cambiado: quieto no gasta nada.

  _bucle(ahora) {
    const dt = Math.min(100, ahora - this._ultimo);
    this._ultimo = ahora;
    let vivo = false;

    let i = 0;
    while (i < this.cola.length && this.cola[i].t <= ahora) i++;
    if (i) { for (const item of this.cola.splice(0, i)) this._aplicar(item); }
    if (this.cola.length) vivo = true;

    if (this.actividad.size) {
      const k = Math.exp(-dt / 430);
      for (const [id, a] of this.actividad) {
        const na = a * k;
        if (na < 0.02) this.actividad.delete(id); else this.actividad.set(id, na);
      }
      vivo = true;
    }

    this.e = this._avance(ahora);
    if (this.e < 1) vivo = true;

    if (this.muriendo.length) {
      const quitadas = [];
      this.muriendo = this.muriendo.filter((n) => {
        if (ahora - n.muere <= VIDA_MUERTE) return true;
        if (this.nodos.get(n.id) === n) { this.nodos.delete(n.id); quitadas.push(n); }
        return false;
      });
      if (quitadas.length) this.pintor.alQuitar(quitadas);
      vivo = true;
    }
    if (this.recientes.length) {
      this.recientes = this.recientes.filter((n) => ahora - n.nace < VIDA_ANILLO);
      vivo = true;
    }

    if (this.objetivo) {
      const k = 1 - Math.exp(-dt / 140);
      const o = this.objetivo;
      this.cam.x += (o.x - this.cam.x) * k;
      this.cam.y += (o.y - this.cam.y) * k;
      this.cam.z *= Math.pow(o.z / this.cam.z, k);
      if (Math.abs(o.x - this.cam.x) * this.cam.z < 0.5 && Math.abs(o.y - this.cam.y) * this.cam.z < 0.5 && Math.abs(o.z / this.cam.z - 1) < 0.002) {
        this.cam = { ...o };
        this.objetivo = null;
      }
      vivo = true;
    }

    if (this.resaltado && ahora > this.resaltado.hasta) { this.resaltado = null; this._recalcularFoco(); }
    if (this.senales.length) {
      this.senales = this.senales.filter((s) => ahora - s.t0 < s.dur);
      vivo = true;
    }

    if (vivo || this.sucio) {
      this.sucio = false;
      try {
        this.pintor.dibujar(ahora);
      } catch (e) {
        console.error('Error al dibujar el mapa:', e);
        if (this.optimizado) this._pintorFallido();
      }
    }
    requestAnimationFrame((t) => this._bucle(t));
  }
}
