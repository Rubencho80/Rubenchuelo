'use strict';
// Dónde está cada neurona en el mapa. Es solo para verlo: no afecta a lo que sabe.
// La corteza se organiza sola poco a poco (las palabras asociadas se atraen y
// todas se repelen un poco); el hipocampo se ordena en filas de recuerdos.

const REGIONES = [
  { id: 'corteza', nombre: 'Corteza', cx: 0, cy: -60, rx: 1000, ry: 600 },
  { id: 'hipocampo', nombre: 'Hipocampo', cx: 0, cy: 770, rx: 600, ry: 150 },
];
const CORTEZA = REGIONES[0];
const HIPOCAMPO = REGIONES[1];

const posicionInicio = () => ({ x: -CORTEZA.rx - 170, y: CORTEZA.cy });
const posicionFin = () => ({ x: CORTEZA.rx + 170, y: CORTEZA.cy });

function radioRelativo(region, x, y) {
  return Math.hypot((x - region.cx) / region.rx, (y - region.cy) / region.ry);
}

function puntoEnElipse(region, azar, margen = 0.9) {
  const ang = azar() * Math.PI * 2;
  const r = Math.sqrt(azar()) * margen;
  return { x: region.cx + Math.cos(ang) * r * region.rx, y: region.cy + Math.sin(ang) * r * region.ry };
}

// Las palabras nuevas nacen cerca de la palabra que acaban de oír antes.
function posicionCerca(vecino, azar) {
  if (vecino && Number.isFinite(vecino.x) && vecino.tipo === 'palabra') {
    for (let i = 0; i < 8; i++) {
      const ang = azar() * Math.PI * 2;
      const r = 25 + azar() * 45;
      const x = vecino.x + Math.cos(ang) * r;
      const y = vecino.y + Math.sin(ang) * r;
      if (radioRelativo(CORTEZA, x, y) < 0.95) return { x, y };
    }
  }
  return puntoEnElipse(CORTEZA, azar);
}

function centroide(cerebro, ids) {
  let sx = 0, sy = 0, k = 0;
  for (const id of ids) {
    const n = cerebro.neuronas.get(id);
    if (!n) continue;
    sx += n.x; sy += n.y; k++;
  }
  return k ? { x: sx / k, y: sy / k } : null;
}

function posicionConcepto(cerebro, ids, azar) {
  const c = centroide(cerebro, ids);
  if (!c) return puntoEnElipse(CORTEZA, azar, 0.8);
  return { x: c.x + (azar() - 0.5) * 30, y: c.y + (azar() - 0.5) * 30 };
}

// Cada recuerdo del hipocampo es una pequeña cadena; se colocan en filas.
function colocarHipocampo(cerebro) {
  const eps = [...cerebro.episodios.values()].sort((a, b) => a.id - b.id);
  const n = eps.length;
  if (n) {
    const cols = Math.max(1, Math.min(7, Math.ceil(Math.sqrt(n * 2))));
    const filas = Math.ceil(n / cols);
    const altoFila = Math.min(42, (HIPOCAMPO.ry * 1.6) / filas);
    eps.forEach((ep, k) => {
      const col = k % cols;
      const fila = Math.floor(k / cols);
      const cy = HIPOCAMPO.cy - ((filas - 1) * altoFila) / 2 + fila * altoFila;
      const dy = (cy - HIPOCAMPO.cy) / HIPOCAMPO.ry;
      const medioAncho = HIPOCAMPO.rx * 0.88 * Math.sqrt(Math.max(0.15, 1 - dy * dy));
      const anchoSlot = (medioAncho * 2) / cols;
      const cx = -medioAncho + anchoSlot * (col + 0.5) + HIPOCAMPO.cx;
      const L = ep.celdas.length;
      const paso = Math.min(16, (anchoSlot * 0.86) / Math.max(1, L - 1));
      ep.celdas.forEach((cid, i) => {
        const c = cerebro.neuronas.get(cid);
        if (!c) return;
        c.x = cx + (i - (L - 1) / 2) * paso;
        c.y = cy + Math.sin(i * 0.9 + ep.id) * Math.min(6, altoFila * 0.18);
      });
    });
  }
  for (const id of cerebro.inhibidoras) {
    const inh = cerebro.neuronas.get(id);
    if (inh.region !== 'hipo') continue;
    const c = centroide(cerebro, inh.grupo);
    if (c) { inh.x = c.x; inh.y = c.y - 14; }
  }
  moverEpoca(cerebro);
}

// Cada vez que algo se mueve cambia la «época»: así la interfaz sabe cuándo
// merece la pena pedir las posiciones nuevas.
function moverEpoca(cerebro) {
  cerebro.epocaPosiciones = ((cerebro.epocaPosiciones || 0) + 1) >>> 0;
}

// Rejilla gruesa de la corteza para saber dónde hay apreturas y dónde huecos.
const G = 80;
const X0 = CORTEZA.cx - CORTEZA.rx - G, Y0 = CORTEZA.cy - CORTEZA.ry - G;
const GW = Math.ceil((CORTEZA.rx * 2 + G * 2) / G), GH = Math.ceil((CORTEZA.ry * 2 + G * 2) / G);
const DENTRO = new Uint8Array(GW * GH);
for (let j = 0; j < GH; j++) {
  for (let i = 0; i < GW; i++) DENTRO[j * GW + i] = radioRelativo(CORTEZA, X0 + (i + 0.5) * G, Y0 + (j + 0.5) * G) < 0.92 ? 1 : 0;
}
const CELDAS_DENTRO = DENTRO.reduce((s, x) => s + x, 0);
const celdaDe = (x, y) => {
  const i = Math.floor((x - X0) / G), j = Math.floor((y - Y0) / G);
  return i < 0 || j < 0 || i >= GW || j >= GH ? -1 : j * GW + i;
};

const MAX_VECINAS = 48;   // vecinas que mira como mucho cada neurona en cada paso
const ATRAE = 0.05;       // cuánto se acerca cada palabra al medio de sus asociaciones
const MAX_FUERTES = 24;   // asociaciones que tiran de cada palabra
const PRESION = 4;        // fuerza con la que las apreturas empujan hacia los huecos
const MAX_PRESION = 16;
const fuertes = new WeakMap();

// Las asociaciones que más tiran de una palabra: las más fuertes, pero contando
// menos las palabras que van con todo («de», «que»…). Si no, esas pocas
// arrastran a todo el mapa hacia donde estén. Se recalculan cada medio minuto
// (los pesos cambian despacio y ordenar en cada paso costaría mucho).
function masFuertes(cerebro, n, ahora) {
  const c = fuertes.get(n);
  if (c && ahora - c.t < 30000) return c.lista;
  const lista = [];
  for (const [b, w] of n.asoc) {
    const m = cerebro.neuronas.get(b);
    if (!m) continue;
    const par = [m, w / Math.sqrt(1 + (m.asoc ? m.asoc.size : 0) / 20)];
    if (lista.length === MAX_FUERTES && par[1] <= lista[MAX_FUERTES - 1][1]) continue;
    let i = lista.length < MAX_FUERTES ? lista.length : MAX_FUERTES - 1;
    while (i > 0 && lista[i - 1][1] < par[1]) { if (i < MAX_FUERTES) lista[i] = lista[i - 1]; i--; }
    lista[i] = par;
  }
  fuertes.set(n, { t: ahora, lista });
  return lista;
}

// Un paso de la disposición por fuerzas sobre una parte de la corteza.
// `presupuesto` = cuántas neuronas se mueven como mucho en esta llamada (por
// turnos), y `msMax` el tiempo máximo, para no frenar nunca al cerebro.
function iterar(cerebro, presupuesto = 2500, msMax = 12) {
  const inicio = Date.now();
  if (cerebro._versionDisposicion !== cerebro.version || !cerebro._movibles) {
    cerebro._movibles = [];
    for (const n of cerebro.neuronas.values()) {
      if (n.tipo === 'palabra' || n.tipo === 'concepto' || (n.tipo === 'inhib' && n.region !== 'hipo')) {
        cerebro._movibles.push(n.id);
      }
    }
    cerebro._versionDisposicion = cerebro.version;
    cerebro._cursor = cerebro._cursor || 0;
  }
  const movibles = cerebro._movibles;
  const total = movibles.length;
  if (!total) return 0;

  // Con pocas neuronas se separan más para que se lean bien; con muchas, menos
  // (tienen que caber todas en la corteza: si no, se amontonan contra el borde).
  const area = Math.PI * CORTEZA.rx * CORTEZA.ry;
  const DMIN = Math.max(8, Math.min(170, Math.sqrt(area / total) * 0.6));
  // Rejilla espacial para encontrar vecinos cercanos rápido.
  const CELDA = Math.max(10, DMIN);
  const ahora = Date.now();
  const rejilla = new Map();
  const clave = (gx, gy) => (gx + 2000) * 8192 + (gy + 2000);
  const cuenta = new Float32Array(GW * GH);
  for (const id of movibles) {
    const n = cerebro.neuronas.get(id);
    const k = clave(Math.floor(n.x / CELDA), Math.floor(n.y / CELDA));
    let lista = rejilla.get(k);
    if (!lista) rejilla.set(k, (lista = []));
    lista.push(n);
    const c = celdaDe(n.x, n.y);
    if (c >= 0) cuenta[c]++;
  }
  // Presión: de las zonas abarrotadas hacia los huecos (fuera de la corteza
  // cuenta como muy lleno, para que nadie se escape).
  const objetivo = Math.max(1, total / CELDAS_DENTRO);
  const lleno = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH || !DENTRO[j * GW + i] ? objetivo * 3 : cuenta[j * GW + i]);

  const cuantos = Math.min(presupuesto, total);
  let movidas = 0;
  let k = 0;
  for (; k < cuantos; k++) {
    if ((k & 15) === 0 && Date.now() - inicio > msMax) break;
    const id = movibles[(cerebro._cursor + k) % total];
    const n = cerebro.neuronas.get(id);
    if (!n) continue;
    let fx = 0, fy = 0;
    // Se aparta de las vecinas demasiado cercanas. En zonas muy llenas no se
    // miran todas: se toma una muestra repartida al azar entre las 9 casillas
    // (y se cuenta como si fueran todas). Mirar solo las primeras empujaba a
    // todo el mapa siempre hacia el mismo lado.
    const gx = Math.floor(n.x / CELDA), gy = Math.floor(n.y / CELDA);
    const listas = [];
    let cerca = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const lista = rejilla.get(clave(gx + dx, gy + dy));
        if (lista) { listas.push(lista); cerca += lista.length; }
      }
    }
    const paso = cerca > MAX_VECINAS ? cerca / MAX_VECINAS : 1;
    let sig = paso > 1 ? Math.random() * paso : 0;
    let base = 0;
    for (const lista of listas) {
      while (sig < base + lista.length) {
        const m = lista[Math.floor(sig - base)];
        sig += paso;
        if (m === n) continue;
        let ex = n.x - m.x, ey = n.y - m.y;
        let d = Math.hypot(ex, ey);
        if (d >= DMIN) continue;
        if (d < 0.01) { ex = Math.random() - 0.5; ey = Math.random() - 0.5; d = 0.5; }
        const f = ((DMIN - d) / d) * 0.35 * paso;
        fx += ex * f; fy += ey * f;
      }
      base += lista.length;
    }
    if (n.tipo === 'palabra') {
      // Se acerca al punto medio de sus asociaciones más fuertes (no las primeras
      // que aprendió), pesado por lo fuertes que son. Ir hacia el medio, y no
      // tirar de cada una por separado, evita que las palabras muy usadas
      // arrastren a todo el mapa hacia un lado.
      let sx = 0, sy = 0, sw = 0;
      for (const [m, w] of masFuertes(cerebro, n, ahora)) {
        sx += m.x * w; sy += m.y * w; sw += w;
      }
      if (sw > 0) {
        const k = ATRAE * Math.min(1, sw * 2);
        fx += (sx / sw - n.x) * k;
        fy += (sy / sw - n.y) * k;
      }
    } else if (n.tipo === 'concepto' || n.tipo === 'inhib') {
      const ids = n.tipo === 'concepto' ? n.miembros.keys() : n.grupo;
      const c = centroide(cerebro, ids);
      if (c) { fx += (c.x - n.x) * 0.15; fy += (c.y - n.y) * 0.15; }
    }
    // Contención: nadie se sale de la corteza.
    const ex = (n.x - CORTEZA.cx) / CORTEZA.rx, ey = (n.y - CORTEZA.cy) / CORTEZA.ry;
    const r = Math.hypot(ex, ey);
    if (r > 0.95) {
      fx -= ex * (r - 0.95) * CORTEZA.rx * 0.6;
      fy -= ey * (r - 0.95) * CORTEZA.ry * 0.6;
    }
    const largo = Math.hypot(fx, fy);
    const max = 7;
    if (largo > max) { fx *= max / largo; fy *= max / largo; }
    // La presión va aparte y puede mover más: así se reparte en minutos, no en horas.
    if (n.tipo === 'palabra') {
      const i = Math.floor((n.x - X0) / G), j = Math.floor((n.y - Y0) / G);
      let px = (lleno(i - 1, j) - lleno(i + 1, j)) / objetivo * PRESION;
      let py = (lleno(i, j - 1) - lleno(i, j + 1)) / objetivo * PRESION;
      const lp = Math.hypot(px, py);
      if (lp > MAX_PRESION) { px *= MAX_PRESION / lp; py *= MAX_PRESION / lp; }
      fx += px; fy += py;
    }
    if (Math.hypot(fx, fy) < 0.2) continue;
    n.x += fx; n.y += fy;
    movidas++;
  }
  cerebro._cursor = (cerebro._cursor + k) % total;
  if (movidas) moverEpoca(cerebro);
  return movidas;
}

// ¿Están las palabras muy apiñadas? (la décima parte más llena de la corteza
// tiene casi la mitad de ellas). Pasa con cerebros que crecieron muy deprisa
// leyendo, o con los colocados por versiones anteriores.
function necesitaReparto(cerebro) {
  const cuenta = new Float32Array(GW * GH);
  let n = 0;
  for (const x of cerebro.lexico.values()) {
    const p = cerebro.neuronas.get(x);
    const c = p ? celdaDe(p.x, p.y) : -1;
    if (c >= 0) { cuenta[c]++; n++; }
  }
  if (n < 300) return false;
  const llenas = [...cuenta].sort((a, b) => b - a).slice(0, Math.ceil(CELDAS_DENTRO / 10));
  return llenas.reduce((s, x) => s + x, 0) / n > 0.45;
}

// Reparte las palabras por toda la corteza sin desordenarlas: la que estaba más
// a la izquierda sigue más a la izquierda y lo mismo de arriba abajo, así que lo
// que estaba junto sigue junto. Luego los conceptos e inhibidoras se van al
// medio de lo suyo. `mezcla` = cuánto se acerca al reparto perfecto (1 = del todo).
function repartir(cerebro, mezcla = 0.85) {
  const palabras = [];
  for (const id of cerebro.lexico.values()) { const n = cerebro.neuronas.get(id); if (n) palabras.push(n); }
  const N = palabras.length;
  if (N < 2) return;
  const rx = CORTEZA.rx * 0.88, ry = CORTEZA.ry * 0.88;
  // x: cada palabra a su sitio según su orden, con la forma de la elipse
  // (más sitio en el medio que en las puntas).
  const tabla = [];
  for (let k = 0; k <= 400; k++) {
    const t = -1 + (2 * k) / 400;
    tabla.push((Math.asin(t) + t * Math.sqrt(1 - t * t) + Math.PI / 2) / Math.PI);   // proporción a la izquierda de t
  }
  const xDeProporcion = (u) => {
    let a = 0, b = 400;
    while (b - a > 1) { const m = (a + b) >> 1; if (tabla[m] < u) a = m; else b = m; }
    const f = (u - tabla[a]) / Math.max(1e-9, tabla[b] - tabla[a]);
    return (-1 + (2 * (a + f)) / 400) * rx;
  };
  const nuevoX = new Map(), nuevoY = new Map();
  palabras.sort((a, b) => a.x - b.x);
  palabras.forEach((n, k) => nuevoX.set(n, xDeProporcion((k + 0.5) / N)));
  // y: por franjas verticales, cada una de arriba abajo según su orden.
  const franjas = Math.max(1, Math.min(60, Math.round(Math.sqrt(N / 8))));
  const ancho = Math.ceil(N / franjas);
  for (let f = 0; f < franjas; f++) {
    const franja = palabras.slice(f * ancho, (f + 1) * ancho).sort((a, b) => a.y - b.y);
    franja.forEach((n, k) => {
      const x = nuevoX.get(n);
      const h = ry * Math.sqrt(Math.max(0.02, 1 - (x / rx) ** 2));
      nuevoY.set(n, CORTEZA.cy + (2 * ((k + 0.5) / franja.length) - 1) * h);
    });
  }
  for (const n of palabras) {
    n.x += (CORTEZA.cx + nuevoX.get(n) - n.x) * mezcla;
    n.y += (nuevoY.get(n) - n.y) * mezcla;
  }
  for (const id of cerebro.conceptos) {
    const c = cerebro.neuronas.get(id);
    const m = c && centroide(cerebro, c.miembros.keys());
    if (m) { c.x = m.x; c.y = m.y; }
  }
  for (const id of cerebro.inhibidoras) {
    const inh = cerebro.neuronas.get(id);
    if (!inh || inh.region === 'hipo') continue;
    const m = centroide(cerebro, inh.grupo);
    if (m) { inh.x = m.x; inh.y = m.y; }
  }
  moverEpoca(cerebro);
}

module.exports = {
  necesitaReparto,
  repartir,
  REGIONES,
  posicionInicio,
  posicionFin,
  posicionCerca,
  posicionConcepto,
  puntoEnElipse,
  colocarHipocampo,
  iterar,
};
