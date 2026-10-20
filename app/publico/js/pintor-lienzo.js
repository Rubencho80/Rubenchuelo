// Pintor clásico: dibuja el mapa entero con el lienzo 2D del navegador, como
// al principio. Se ve igual que el optimizado, pero con miles de neuronas va
// lento (el navegador tiene que trazar cada círculo y cada línea en cada cuadro).
// Se usa con «Optimizado» apagado o si el navegador no deja usar la tarjeta gráfica.

import { TIPOS } from './util.js';

export const COLOR = TIPOS.map((t) => t.color);
// Tipos de conexión: 0 secuencia, 1 asociación, 2 concepto, 3 cadena del hipocampo, 4 célula→palabra
export const COLOR_ARISTA = ['#4fd1c5', '#7f93c4', '#c792ff', '#ffc24b', '#ffc24b'];
export const ALFA_ARISTA = [0.55, 0.38, 0.5, 0.65, 0.16];
export const FUENTE_ETIQUETA = '13px Bahnschrift, "Segoe UI", sans-serif';
const ESTRELLAS = Array.from({ length: 160 }, () => [Math.random(), Math.random(), Math.random()]);

export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Fondo: campo oscuro con viñeta (de noche, más oscuro y con estrellas) y las
// regiones del cerebro. Lo usan los dos pintores.
export function pintarFondo(g, m, W, H) {
  const z = m.cam.z;
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  const fondo = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.08, W / 2, H / 2, Math.max(W, H) * 0.78);
  fondo.addColorStop(0, m.noche ? '#0a0f22' : '#141d34');
  fondo.addColorStop(1, m.noche ? '#03050c' : '#090d19');
  g.fillStyle = fondo;
  g.fillRect(0, 0, W, H);
  if (m.noche) {
    g.fillStyle = '#c9d4ff';
    for (const [ex, ey, eb] of ESTRELLAS) {
      g.globalAlpha = 0.15 + eb * 0.35;
      g.fillRect(ex * W, ey * H, eb > 0.8 ? 1.6 : 1, eb > 0.8 ? 1.6 : 1);
    }
    g.globalAlpha = 1;
  }
  g.font = '500 13px Bahnschrift, "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  for (const r of m.regiones) {
    const [cx, cy] = m.aPantalla(r.cx, r.cy);
    g.beginPath();
    g.ellipse(cx, cy, r.rx * z, r.ry * z, 0, 0, Math.PI * 2);
    g.fillStyle = r.id === 'hipocampo' ? 'rgba(255,194,75,0.035)' : 'rgba(120,150,220,0.035)';
    g.fill();
    g.setLineDash([5, 7]);
    g.strokeStyle = r.id === 'hipocampo' ? 'rgba(255,214,140,0.2)' : 'rgba(170,190,235,0.16)';
    g.lineWidth = 1;
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = r.id === 'hipocampo' ? 'rgba(255,214,140,0.55)' : 'rgba(190,205,240,0.5)';
    g.fillText(r.nombre, cx, cy - r.ry * z - 9);
  }
  g.textAlign = 'left';
}

export class PintorLienzo {
  constructor(mapa) {
    this.m = mapa;
    this.g = mapa.g;
    this.cuadro = 0;
    this.sprites = new Map();
  }

  // Lee todo del mapa en cada cuadro: no necesita enterarse de los cambios.
  alCargar() {}
  alNodos() {}
  alQuitar() {}
  alMover() {}
  alEnfocar() {}
  redimensionar() {}
  destruir() {
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.clearRect(0, 0, this.m.cv.width, this.m.cv.height);
  }

  _sprite(color) {
    let s = this.sprites.get(color);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(color, 1));
    gr.addColorStop(0.22, rgba(color, 0.6));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    this.sprites.set(color, s);
    return s;
  }

  _forma(g, t, x, y, r) {
    switch (t) {
      case 1: g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); break;
      case 2: g.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7); break;
      case 3: g.moveTo(x - r, y - r * 0.7); g.lineTo(x + r, y - r * 0.7); g.lineTo(x, y + r); g.closePath(); break;
      case 4:
      case 5: g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); break;
      default: g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2);
    }
  }

  dibujar(ahora) {
    const m = this.m;
    const g = this.g;
    const W = m.ancho, H = m.alto, z = m.cam.z, e = m.e;
    this.cuadro++;
    const cuadro = this.cuadro;
    g.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
    pintarFondo(g, m, W, H);

    const margen = 60;
    const dentro = (sx, sy) => sx > -margen && sx < W + margen && sy > -margen && sy < H + margen;
    const enfocados = m.enfocados;
    const atenuar = enfocados.size > 0;
    const pantalla = (n) => m.aPantalla(n.ox + (n.tx - n.ox) * e, n.oy + (n.ty - n.oy) * e);

    // Posición en pantalla de cada neurona visible.
    const porTipo = [[], [], [], [], [], []];
    const crecer = 0.55 + 0.45 * Math.pow(z, 0.6);
    for (const n of m.nodos.values()) {
      if (!m.visibles.has(n.t)) continue;
      const [sx, sy] = pantalla(n);
      if (!dentro(sx, sy)) continue;
      let r = Math.max(1.6, n.s * crecer);
      if (n.nace) {
        const p = (ahora - n.nace) / 600;
        if (p < 1) r *= 0.3 + 0.7 * (1 - Math.pow(1 - p, 3)) + Math.sin(p * Math.PI) * 0.35;
      }
      if (n.muere) r *= Math.max(0, 1 - (ahora - n.muere) / 700);
      n.sx = sx; n.sy = sy; n.r = r; n.f = cuadro;
      porTipo[n.t].push(n);
    }

    // Conexiones, agrupadas por tipo y fuerza para dibujar rápido.
    const lotes = new Map();
    const A = m.aristas;
    for (let j = 0; j < A.n; j++) {
      const w = A.w[j], k = A.k[j];
      if (k < 2 && w < m.pesoMin) continue;
      const na = m.nodos.get(A.a[j]), nb = m.nodos.get(A.b[j]);
      if (!na || !nb || na.f !== cuadro && nb.f !== cuadro) continue;
      if (!m.visibles.has(na.t) || !m.visibles.has(nb.t)) continue;
      const [x1, y1] = na.f === cuadro ? [na.sx, na.sy] : pantalla(na);
      const [x2, y2] = nb.f === cuadro ? [nb.sx, nb.sy] : pantalla(nb);
      const cubeta = Math.min(3, Math.floor(w * 4));
      const clave = k * 4 + cubeta;
      let l = lotes.get(clave);
      if (!l) lotes.set(clave, (l = []));
      l.push(x1, y1, x2, y2);
    }
    g.lineCap = 'round';
    const anchoBase = Math.min(1.5, Math.sqrt(z * 2));
    for (const [clave, l] of lotes) {
      const k = Math.floor(clave / 4), c = clave % 4;
      g.strokeStyle = COLOR_ARISTA[k];
      g.globalAlpha = ALFA_ARISTA[k] * (0.22 + c * 0.26) * (atenuar ? 0.28 : 1) * (m.noche ? 0.7 : 1);
      g.lineWidth = Math.max(0.5, (0.45 + c * 0.4) * anchoBase);
      g.beginPath();
      for (let j = 0; j < l.length; j += 4) { g.moveTo(l[j], l[j + 1]); g.lineTo(l[j + 2], l[j + 3]); }
      g.stroke();
    }
    g.globalAlpha = 1;

    // Conexiones de la neurona seleccionada, bien visibles.
    if (m.vecSel) {
      for (const j of m.vecSel) {
        const na = m.nodos.get(A.a[j]), nb = m.nodos.get(A.b[j]);
        if (!na || !nb) continue;
        const w = A.w[j];
        const [x1, y1] = pantalla(na), [x2, y2] = pantalla(nb);
        g.strokeStyle = COLOR_ARISTA[A.k[j]];
        g.globalAlpha = 0.35 + 0.6 * Math.min(1, w);
        g.lineWidth = 1 + 2.2 * Math.min(1, w);
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      }
      g.globalAlpha = 1;
    }
    // Camino que siguió al hablar ("¿por qué?").
    if (m.resaltado && m.resaltado.pasos.length) {
      g.strokeStyle = '#ffe9a8';
      g.lineWidth = 2.4;
      g.globalAlpha = 0.9;
      g.beginPath();
      for (const [a, b] of m.resaltado.pasos) {
        const na = m.nodos.get(a), nb = m.nodos.get(b);
        if (!na || !nb) continue;
        const [x1, y1] = pantalla(na), [x2, y2] = pantalla(nb);
        g.moveTo(x1, y1); g.lineTo(x2, y2);
      }
      g.stroke();
      g.globalAlpha = 1;
    }

    // Neuronas.
    for (let t = 0; t < 6; t++) {
      const lista = porTipo[t];
      if (!lista.length) continue;
      for (const pasada of [0, 1]) {
        g.beginPath();
        let alguna = false;
        for (const n of lista) {
          const enFoco = !atenuar || enfocados.has(n.id);
          if ((pasada === 0) === enFoco) continue;
          this._forma(g, t, n.sx, n.sy, n.r);
          alguna = true;
        }
        if (!alguna) continue;
        g.globalAlpha = (pasada === 0 ? 0.22 : 1) * (m.noche ? 0.8 : 1);
        if (t === 1) {
          g.fillStyle = rgba(COLOR[t], 0.22);
          g.fill();
          g.strokeStyle = COLOR[t];
          g.lineWidth = Math.max(1.2, 1.8 * Math.min(1.4, z));
          g.stroke();
        } else {
          g.fillStyle = COLOR[t];
          g.fill();
        }
      }
    }
    g.globalAlpha = 1;

    // Nacimientos: un anillo que se expande.
    for (const n of m.recientes) {
      if (n.f !== cuadro) continue;
      const p = (ahora - n.nace) / 1400;
      if (p >= 1) continue;
      g.strokeStyle = COLOR[n.t];
      g.globalAlpha = (1 - p) * 0.9;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(n.sx, n.sy, n.r + 4 + 22 * p, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;

    // Actividad: las neuronas que disparan brillan.
    g.globalCompositeOperation = 'lighter';
    for (const [id, a] of m.actividad) {
      const n = m.nodos.get(id);
      if (!n || n.f !== cuadro) continue;
      const R = n.r * (2.4 + 4.5 * a) + 7 * a;
      g.globalAlpha = Math.min(1, 0.2 + a * 0.9);
      g.drawImage(this._sprite(COLOR[n.t]), n.sx - R, n.sy - R, R * 2, R * 2);
      if (a > 0.35) {
        const r2 = n.r * 1.7;
        g.globalAlpha = Math.min(1, (a - 0.35) * 1.4);
        g.drawImage(this._sprite('#ffffff'), n.sx - r2, n.sy - r2, r2 * 2, r2 * 2);
      }
    }

    // Señales viajando por las conexiones.
    for (const s of m.senales) {
      const p = (ahora - s.t0) / s.dur;
      if (p >= 1) continue;
      const na = m.nodos.get(s.a), nb = m.nodos.get(s.b);
      if (!na || !nb) continue;
      const [x1, y1] = pantalla(na), [x2, y2] = pantalla(nb);
      const ep = 1 - Math.pow(1 - p, 2);
      const x = x1 + (x2 - x1) * ep, y = y1 + (y2 - y1) * ep;
      const cola = Math.max(0, ep - 0.3);
      g.globalAlpha = 0.45 * (1 - p) * Math.min(1, 0.4 + s.fuerza);
      g.strokeStyle = s.color;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(x1 + (x2 - x1) * cola, y1 + (y2 - y1) * cola);
      g.lineTo(x, y);
      g.stroke();
      const R = 3 + 5 * Math.min(1, s.fuerza);
      g.globalAlpha = 0.95 * (1 - p * 0.6);
      g.drawImage(this._sprite(s.color), x - R, y - R, R * 2, R * 2);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;

    // Anillo de la seleccionada y de la que está bajo el ratón.
    for (const id of [m.seleccion, m.encima]) {
      if (id === null) continue;
      const n = m.nodos.get(id);
      if (!n || n.f !== cuadro) continue;
      g.strokeStyle = '#ffffff';
      g.lineWidth = id === m.seleccion ? 2 : 1.2;
      g.globalAlpha = id === m.seleccion ? 0.95 : 0.6;
      g.beginPath();
      g.arc(n.sx, n.sy, n.r + 5, 0, Math.PI * 2);
      g.stroke();
    }
    // Lo que tiene en mente.
    if (m.enMente.size) {
      g.strokeStyle = '#e8fbff';
      g.lineWidth = 1.3;
      g.globalAlpha = 0.65;
      g.setLineDash([3, 4]);
      g.beginPath();
      for (const id of m.enMente) {
        const n = m.nodos.get(id);
        if (!n || n.f !== cuadro || !m.visibles.has(n.t)) continue;
        g.moveTo(n.sx + n.r + 8, n.sy);
        g.arc(n.sx, n.sy, n.r + 8, 0, Math.PI * 2);
      }
      g.stroke();
      g.setLineDash([]);
    }
    g.globalAlpha = 1;

    this._dibujarEtiquetas(enfocados, cuadro);
  }

  _dibujarEtiquetas(enfocados, cuadro) {
    const m = this.m;
    const g = this.g;
    const cands = [];
    const z = m.cam.z;
    for (const n of m.nodos.values()) {
      if (n.f !== cuadro || !n.l || n.muere || n.t === 3) continue;
      const act = m.actividad.get(n.id) || 0;
      let prioridad = 0;
      if (n.id === m.seleccion) prioridad = 1000;
      else if (n.id === m.encima) prioridad = 950;
      else if (enfocados.has(n.id)) prioridad = 800;
      else if (m.enMente.has(n.id)) prioridad = 700;
      else if (act > 0.25) prioridad = 500 + act * 100;
      else if (m.etiquetas && (n.r >= 3.4 || z > 1.3) && (n.t !== 2 || z > 1.1)) prioridad = n.r * 10 + (n.t >= 4 ? 400 : 0);
      if (prioridad > 0) cands.push([prioridad, n]);
    }
    if (!cands.length) return;
    cands.sort((a, b) => b[0] - a[0]);
    g.font = FUENTE_ETIQUETA;
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 3.5;
    g.strokeStyle = m.noche ? 'rgba(3,5,12,0.9)' : 'rgba(9,13,25,0.88)';
    // Medir texto es caro: se recuerda el ancho de cada etiqueta.
    if (!this._anchos || this._anchos.size > 60000) this._anchos = new Map();
    const anchoDe = (texto) => {
      let w = this._anchos.get(texto);
      if (w === undefined) { w = g.measureText(texto).width; this._anchos.set(texto, w); }
      return w;
    };
    // Con el zoom muy alejado caben menos etiquetas legibles.
    const maximo = z < 0.35 ? 110 : z < 0.8 ? 180 : 260;
    const ocupado = new Set();
    const CW = 24, CH = 16;
    let dibujadas = 0;
    let probadas = 0;
    for (const [prio, n] of cands) {
      if (dibujadas >= maximo || ++probadas > maximo * 6) break;
      const texto = n.l.length > 32 ? `${n.l.slice(0, 31)}…` : n.l;
      const ancho = anchoDe(texto);
      const x = n.sx + n.r + 4, y = n.sy;
      const c0 = Math.floor(x / CW), c1 = Math.floor((x + ancho) / CW), f = Math.floor(y / CH) + 1000;
      let libre = true;
      if (prio < 800) {
        for (let c = c0; c <= c1 && libre; c++) if (ocupado.has(f * 100000 + c + 1000)) libre = false;
      }
      if (!libre) continue;
      for (let c = c0; c <= c1; c++) ocupado.add(f * 100000 + c + 1000);
      const act = m.actividad.get(n.id) || 0;
      g.globalAlpha = prio >= 500 ? 1 : 0.82;
      g.strokeText(texto, x, y);
      g.fillStyle = act > 0.25 ? '#ffffff' : n.t === 0 ? '#d7f6f2' : n.t === 1 ? '#ead9ff' : n.t === 2 ? '#ffe6b0' : '#d6e4ff';
      g.fillText(texto, x, y);
      dibujadas++;
    }
    g.globalAlpha = 1;
  }
}
