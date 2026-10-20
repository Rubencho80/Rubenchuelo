// El inspector: al hacer clic en una neurona enseña sus conexiones y pesos.

import { api } from './api.js';
import { el, glifo, num, pct, hace, POR_CLAVE, avisar } from './util.js';

const COLOR_CLASE = {
  sec: '#4fd1c5', secIn: '#4fd1c5', asoc: '#7f93c4', concepto: '#c792ff', miembro: '#c792ff',
  palabra: '#4fd1c5', inhibe: '#ff6f6f',
};

const REGIONES = { corteza: 'la corteza (palabras)', conceptos: 'los conceptos', hipo: 'el hipocampo' };

export class Inspector {
  constructor(raiz, { mapa }) {
    this.raiz = raiz;
    this.mapa = mapa;
    this.id = null;
    this.peticion = 0;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.id !== null && !document.querySelector('dialog[open]')) this.cerrar();
    });
  }

  async abrir(id) {
    if (id === null || id === undefined) { this.cerrar(false); return; }
    this.id = id;
    const n = ++this.peticion;
    this.raiz.hidden = false;
    try {
      const d = await api(`/api/neuronas/${id}`);
      if (n !== this.peticion) return;
      this._pintar(d);
    } catch (e) {
      if (n !== this.peticion) return;
      this.raiz.replaceChildren(this._cabeza(null, 'Esta neurona ya no existe', e.message));
    }
  }

  refrescar() {
    if (this.id !== null && !this.raiz.hidden) this.abrir(this.id);
  }

  cerrar(avisarMapa = true) {
    this.id = null;
    this.peticion++;
    this.raiz.hidden = true;
    if (avisarMapa) this.mapa.seleccionar(null, { avisar: false });
  }

  _cabeza(tipo, titulo, subtitulo) {
    return el('div', { clase: 'inspector-cabeza' },
      tipo ? glifo(tipo, 22) : el('span'),
      el('div', {}, el('h2', { texto: titulo }), el('div', { clase: 'tipo' }, subtitulo)),
      el('button', { clase: 'cerrar', type: 'button', 'aria-label': 'Cerrar', onclick: () => this.cerrar() }, '×'));
  }

  _pintar(d) {
    const t = POR_CLAVE[d.tipo];
    const subtitulo = d.categoria ? 'Categoría: palabras que se usan igual' : t ? t.nombre : d.tipo;
    const partes = [this._cabeza(d.tipo, d.etiqueta || t.nombre, subtitulo)];
    const datos = [];
    const fila = (k, v) => datos.push(el('dt', {}, k), el('dd', {}, v));
    if (d.tipo === 'palabra') {
      fila('La ha oído', `${num(d.frec)} ${d.frec === 1 ? 'vez' : 'veces'}`);
      fila('Habituación', pct(1 - d.habituacion));
    }
    if (d.tipo === 'concepto') fila('Ha encajado', `${num(d.usos)} ${d.usos === 1 ? 'vez' : 'veces'}`);
    if (d.tipo === 'inhib') fila('Frena a', `${num(d.grupos[0]?.total || 0)} neuronas de ${REGIONES[d.region] || d.region}`);
    fila('Ha disparado', `${num(d.disparos)} ${d.disparos === 1 ? 'vez' : 'veces'}`);
    fila('Nació', hace(d.nacida));
    if (d.inhibidora) fila('Su inhibidora', `frena a un grupo de ${num(d.inhibidora.tamGrupo)}`);
    partes.push(el('dl', { clase: 'datos' }, datos));

    if (d.recuerdo) partes.push(el('h3', {}, 'Recuerdo del hipocampo'), this._recuerdo(d.recuerdo));

    for (const g of d.grupos) {
      if (!g.items.length || d.tipo === 'inhib') continue;
      const mas = g.total > g.items.length ? ` (las ${g.items.length} más fuertes de ${num(g.total)})` : ` (${num(g.total)})`;
      partes.push(el('h3', {}, g.titulo, el('small', {}, mas)));
      partes.push(el('ul', { clase: 'conexiones-lista' }, g.items.map((i) => this._conexion(i))));
    }
    if (d.tipo === 'inhib' && d.grupos[0]) {
      partes.push(el('h3', {}, 'Su grupo', el('small', {}, ` (${num(d.grupos[0].total)})`)));
      partes.push(el('ul', { clase: 'conexiones-lista' }, d.grupos[0].items.map((i) => this._conexion({ ...i, peso: null }))));
    }
    if (d.recuerdos && d.recuerdos.length) {
      partes.push(el('h3', {}, 'Aparece en recuerdos de hoy', el('small', {}, ` (${d.recuerdos.length})`)));
      for (const r of d.recuerdos.slice(0, 8)) partes.push(this._recuerdo(r));
    }
    if (d.tipo === 'palabra' && !d.grupos.some((g) => g.items.length)) {
      partes.push(el('p', { clase: 'explica' }, 'Aún no tiene conexiones: solo la ha oído en preguntas.'));
    }

    partes.push(el('div', { clase: 'fila-botones' },
      el('button', { clase: 'boton-mapa vidrio', type: 'button', title: 'Le da un empujón de actividad y mira qué le viene a la cabeza', onclick: () => this._estimular(d.id) }, 'Estimular'),
      el('button', { clase: 'boton-mapa vidrio', type: 'button', onclick: () => this.mapa.seleccionar(d.id, { centrar: true, avisar: false }) }, 'Centrar')));
    this.raiz.replaceChildren(...partes);
  }

  _recuerdo(r) {
    return el('div', { clase: 'recuerdo' }, `«${r.frase}»`,
      el('small', {}, `viveza ${pct(r.viveza)}, importancia ${pct(r.importancia)}, ${r.repasos ? `repasado ${r.repasos} ${r.repasos === 1 ? 'vez' : 'veces'}` : 'aún sin repasar'}`));
  }

  _conexion(i) {
    const color = COLOR_CLASE[i.clase] || '#7f93c4';
    const boton = el('button', { type: 'button', title: `Ver ${i.etiqueta}`, onclick: () => this.mapa.seleccionar(i.id, { centrar: true }) },
      glifo(i.tipo, 10), ' ', i.etiqueta || '(sin nombre)');
    if (i.peso === null) return el('li', { clase: 'conexion' }, boton, el('span'), el('span'));
    return el('li', { clase: 'conexion' }, boton,
      el('div', { clase: 'peso-barra' }, el('div', { estilo: { width: `${Math.round(Math.min(1, i.peso) * 100)}%`, background: color } })),
      el('span', { clase: 'peso' }, i.peso.toLocaleString('es-ES', { maximumFractionDigits: 2, minimumFractionDigits: 2 })));
  }

  async _estimular(id) {
    try {
      await api(`/api/neuronas/${id}/estimular`, { metodo: 'POST' });
    } catch (e) {
      avisar(e.message, 'error');
    }
  }
}
