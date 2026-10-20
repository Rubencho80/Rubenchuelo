// Utilidades compartidas por la interfaz.

export const TIPOS = [
  { codigo: 0, clave: 'palabra', plural: 'Palabras', nombre: 'Neurona de palabra', color: '#4fd1c5', forma: 'circulo' },
  { codigo: 1, clave: 'concepto', plural: 'Conceptos', nombre: 'Neurona de concepto', color: '#c792ff', forma: 'anillo' },
  { codigo: 2, clave: 'hipo', plural: 'Hipocampo', nombre: 'Célula del hipocampo', color: '#ffc24b', forma: 'cuadrado' },
  { codigo: 3, clave: 'inhib', plural: 'Inhibidoras', nombre: 'Neurona inhibidora', color: '#ff6f6f', forma: 'triangulo' },
  { codigo: 4, clave: 'inicio', plural: 'Inicio y fin', nombre: 'Inicio de frase', color: '#8fb8ff', forma: 'rombo' },
  { codigo: 5, clave: 'fin', plural: 'Fin', nombre: 'Fin de frase', color: '#8fb8ff', forma: 'rombo' },
];
export const POR_CLAVE = Object.fromEntries(TIPOS.map((t) => [t.clave, t]));

// Crea elementos sin innerHTML (nada de lo que llega se interpreta como HTML).
export function el(etiqueta, atributos = {}, ...hijos) {
  const e = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(atributos || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'clase') e.className = v;
    else if (k === 'texto') e.textContent = v;
    else if (k === 'estilo') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'datos') Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const h of hijos.flat(Infinity)) {
    if (h === null || h === undefined || h === false) continue;
    e.append(h instanceof Node ? h : String(h));
  }
  return e;
}

const SVG = 'http://www.w3.org/2000/svg';
export function svg(etiqueta, atributos = {}, ...hijos) {
  const e = document.createElementNS(SVG, etiqueta);
  for (const [k, v] of Object.entries(atributos)) if (v !== undefined && v !== null) e.setAttribute(k, String(v));
  for (const h of hijos.flat()) if (h) e.append(h);
  return e;
}

// Pequeño icono con la forma y el color de cada tipo de neurona.
export function glifo(tipo, tam = 12) {
  const t = typeof tipo === 'number' ? TIPOS[tipo] : POR_CLAVE[tipo];
  const s = svg('svg', { width: tam, height: tam, viewBox: '0 0 12 12', 'aria-hidden': 'true' });
  const c = t ? t.color : '#999';
  switch (t ? t.forma : 'circulo') {
    case 'anillo': s.append(svg('circle', { cx: 6, cy: 6, r: 4.2, fill: 'none', stroke: c, 'stroke-width': 2 })); break;
    case 'cuadrado': s.append(svg('rect', { x: 2, y: 2, width: 8, height: 8, rx: 1, fill: c })); break;
    case 'triangulo': s.append(svg('path', { d: 'M1.5 2.5 L10.5 2.5 L6 10.5 Z', fill: c })); break;
    case 'rombo': s.append(svg('path', { d: 'M6 1 L11 6 L6 11 L1 6 Z', fill: c })); break;
    default: s.append(svg('circle', { cx: 6, cy: 6, r: 4.5, fill: c }));
  }
  return s;
}

export const num = (n, dec = 0) => Number(n || 0).toLocaleString('es-ES', { maximumFractionDigits: dec, minimumFractionDigits: 0 });
export const pct = (x) => `${Math.round((x || 0) * 100)} %`;

export function duracion(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `${Math.round(h / 24)} días`;
}

export function hace(ts) {
  if (!ts) return 'nunca';
  const d = Date.now() - ts;
  if (d < 45000) return 'hace un momento';
  return `hace ${duracion(d)}`;
}

export function hora(ts) {
  return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export function fecha(ts) {
  const f = new Date(ts);
  const hoy = new Date();
  const ayer = new Date(Date.now() - 86400000);
  const mismoDia = (a, b) => a.toDateString() === b.toDateString();
  if (mismoDia(f, hoy)) return `hoy, ${hora(ts)}`;
  if (mismoDia(f, ayer)) return `ayer, ${hora(ts)}`;
  return f.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${num(n / 1024, 0)} KB`;
  return `${num(n / 1048576, 1)} MB`;
}

export function avisar(texto, tipo = '') {
  const caja = document.getElementById('avisos');
  const a = el('div', { clase: `aviso ${tipo}`, role: tipo === 'error' ? 'alert' : 'status' }, texto);
  caja.append(a);
  setTimeout(() => a.remove(), tipo === 'error' ? 6000 : 3200);
}

// Diálogo de confirmación. Devuelve true si se acepta.
export function confirmar(titulo, texto, { aceptar = 'Aceptar', peligro = false } = {}) {
  const d = document.getElementById('dialogo');
  d.replaceChildren(
    el('h2', { texto: titulo }),
    el('p', { texto }),
    el('div', { clase: 'fila-botones' },
      el('button', { clase: 'boton boton-sobrio', value: 'no', onclick: () => d.close('no') }, 'Cancelar'),
      el('button', { clase: `boton ${peligro ? 'boton-peligro' : 'boton-accion'}`, value: 'si', onclick: () => d.close('si') }, aceptar)),
  );
  return new Promise((res) => {
    d.addEventListener('close', () => res(d.returnValue === 'si'), { once: true });
    d.returnValue = '';
    d.showModal();
  });
}

// Pide un texto con un diálogo. Devuelve el texto o null si se cancela.
export function pedirTexto(titulo, texto, { valor = '', aceptar = 'Aceptar' } = {}) {
  const d = document.getElementById('dialogo');
  const entrada = el('input', { clase: 'entrada-texto', type: 'text', value: valor, maxlength: 40, 'aria-label': titulo });
  const form = el('form', { method: 'dialog' },
    el('h2', { texto: titulo }),
    el('p', { texto }),
    el('p', {}, entrada),
    el('div', { clase: 'fila-botones' },
      el('button', { clase: 'boton boton-sobrio', type: 'button', onclick: () => d.close('') }, 'Cancelar'),
      el('button', { clase: 'boton boton-accion', type: 'submit', value: 'si' }, aceptar)));
  d.replaceChildren(form);
  return new Promise((res) => {
    d.addEventListener('close', () => res(d.returnValue === 'si' ? entrada.value.trim() : null), { once: true });
    d.returnValue = '';
    d.showModal();
    entrada.select();
  });
}

export function copiar(texto) {
  navigator.clipboard.writeText(texto).then(() => avisar('Copiado'), () => avisar('No se pudo copiar', 'error'));
}
