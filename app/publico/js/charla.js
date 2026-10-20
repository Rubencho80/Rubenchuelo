// La charla: tus mensajes, lo que dice Rubenchuelo y las notas de lo que pasa.

import { api } from './api.js';
import { el, pct, num, avisar } from './util.js';

const EJEMPLOS = [
  'Toby es mi perro.',
  'Los perros son animales.',
  'Toby es marrón y tiene cuatro patas.',
  '¿Qué es Toby?',
];

const PISTAS = {
  balbuceo: 'Balbucea: aún no sabe qué decir sobre esto.',
  curiosidad: 'No lo conoce y siente curiosidad.',
  durmiendo: 'Está dormido.',
};

export class Charla {
  constructor({ mapa, maxTextoMB = () => 50 }) {
    this.mapa = mapa;
    this.maxTextoMB = maxTextoMB;
    this.lista = document.getElementById('charla');
    this.form = document.getElementById('formEscribir');
    this.entrada = document.getElementById('entrada');
    this.boton = document.getElementById('btnEnviar');
    this.archivo = document.getElementById('archivo');
    this.barra = document.getElementById('lecturaBarra');
    this.vistos = new Set();
    this.filas = new Map();       // id de respuesta → fila
    this.lecturas = new Map();
    this._eventos();
  }

  _eventos() {
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.enviar(); });
    this.entrada.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.enviar(); }
    });
    this.entrada.addEventListener('input', () => this._ajustarAlto());
    document.getElementById('btnAdjuntar').addEventListener('click', () => this.archivo.click());
    this.archivo.addEventListener('change', () => {
      const f = this.archivo.files[0];
      this.archivo.value = '';
      if (f) this.leerArchivo(f);
    });
    // Arrastrar un archivo a cualquier parte de la ventana.
    const capa = document.getElementById('soltar');
    let profundidad = 0;
    const conArchivos = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    window.addEventListener('dragenter', (e) => { if (conArchivos(e)) { profundidad++; capa.hidden = false; } });
    window.addEventListener('dragleave', () => { profundidad = Math.max(0, profundidad - 1); if (!profundidad) capa.hidden = true; });
    window.addEventListener('dragover', (e) => { if (conArchivos(e)) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      if (!conArchivos(e)) return;
      e.preventDefault();
      profundidad = 0;
      capa.hidden = true;
      for (const f of e.dataTransfer.files) this.leerArchivo(f);
    });
  }

  _ajustarAlto() {
    this.entrada.style.height = 'auto';
    this.entrada.style.height = `${Math.min(150, this.entrada.scrollHeight + 2)}px`;
  }

  _cercaDelFinal() {
    return this.lista.scrollHeight - this.lista.scrollTop - this.lista.clientHeight < 120;
  }

  _alFinal() {
    this.lista.scrollTop = this.lista.scrollHeight;
  }

  async enviar(texto = this.entrada.value) {
    texto = texto.trim();
    if (!texto || this.boton.disabled) return;
    this.boton.disabled = true;
    this.entrada.value = '';
    this._ajustarAlto();
    try {
      await api('/api/mensaje', { metodo: 'POST', cuerpo: { texto } });
    } catch (e) {
      avisar(e.message, 'error');
      this.entrada.value = texto;
    } finally {
      this.boton.disabled = false;
      this.entrada.focus();
    }
  }

  async leerArchivo(f) {
    const max = this.maxTextoMB() * 1048576;
    if (f.size > max) { avisar(`«${f.name}» es demasiado grande (máximo ${this.maxTextoMB()} MB)`, 'error'); return; }
    if (f.size === 0) { avisar(`«${f.name}» está vacío`, 'error'); return; }
    try {
      const buf = await f.arrayBuffer();
      let texto;
      try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
      catch { texto = new TextDecoder('windows-1252').decode(buf); }   // archivos antiguos de Windows
      await api('/api/aprender', { metodo: 'POST', cuerpo: { texto, fuente: f.name } });
    } catch (e) {
      avisar(e.message, 'error');
    }
  }

  cargar(entradas) {
    this.lista.replaceChildren();
    this.vistos.clear();
    this.filas.clear();
    for (const e of entradas) this.agregar(e, false);
    this._comprobarVacio();
    this._alFinal();
  }

  _comprobarVacio() {
    const hayCharla = this.lista.querySelector('.fila-tu');
    let vacio = this.lista.querySelector('.vacio');
    if (hayCharla) { if (vacio) vacio.remove(); return; }
    if (vacio) return;
    vacio = el('div', { clase: 'vacio' },
      el('h2', { texto: 'Enséñale algo' }),
      el('p', { texto: 'Cuéntale cosas con frases cortas y sencillas, y luego pregúntale. Cada palabra nueva será una neurona nueva en el mapa.' }),
      el('div', { clase: 'ejemplos' }, EJEMPLOS.map((t) => el('button', {
        clase: 'ejemplo', type: 'button',
        onclick: () => { this.entrada.value = t; this._ajustarAlto(); this.entrada.focus(); },
      }, t))));
    this.lista.append(vacio);
  }

  agregar(e, animar = true) {
    if (this.vistos.has(e.id)) return;
    this.vistos.add(e.id);
    const abajo = this._cercaDelFinal();
    let fila;
    if (e.de === 'tu') fila = this._filaTu(e);
    else if (e.de === 'rubenchuelo') fila = this._filaEl(e);
    else fila = el('div', { clase: 'fila-sistema' }, e.texto);
    this.lista.append(fila);
    if (e.de === 'tu') this._comprobarVacio();
    if (abajo || !animar) this._alFinal();
  }

  _filaTu(e) {
    const a = e.aprendido;
    let nota = null;
    if (e.ignorado) nota = el('div', { clase: 'nota' }, 'No te ha oído: estaba dormido.');
    else if (a) {
      const partes = [];
      if (a.pregunta) partes.push('pregunta (no deja recuerdo)');
      if (a.nuevas) partes.push(el('span', { clase: 'nuevas' }, `${a.nuevas} ${a.nuevas === 1 ? 'neurona nueva' : 'neuronas nuevas'}`));
      if (a.conceptoNuevo) partes.push('un concepto nuevo');
      if (a.recuerdos) partes.push(`${a.recuerdos === 1 ? 'un recuerdo' : `${a.recuerdos} recuerdos`} en el hipocampo`);
      partes.push(`sorpresa ${pct(a.sorpresa)}`);
      const hijos = [];
      partes.forEach((p, i) => { if (i) hijos.push(', '); hijos.push(p); });
      nota = el('div', { clase: 'nota' }, hijos);
    }
    if (e.origen && e.origen !== 'interfaz') {
      return el('div', { clase: 'fila-tu' }, el('div', { clase: 'burbuja' }, e.texto), el('div', { clase: 'nota' }, 'desde otra aplicación'), nota);
    }
    return el('div', { clase: 'fila-tu' }, el('div', { clase: 'burbuja' }, e.texto), nota);
  }

  _filaEl(e) {
    const clases = ['fila-el'];
    if (e.modo) clases.push(e.modo);
    if (e.durmiendo) clases.push('durmiendo');
    const fila = el('div', { clase: clases.join(' '), datos: { entrada: e.id } });
    if (e.estimulo) fila.append(el('div', { clase: 'pista' }, `Al estimular «${e.estimulo}» le vino a la cabeza:`));
    fila.append(el('div', { clase: 'voz' }, e.texto));
    const pista = PISTAS[e.durmiendo ? 'durmiendo' : e.modo];
    if (pista) fila.append(el('div', { clase: 'pista' }, pista));
    if (e.respuesta) {
      const si = el('button', { clase: 'mini', type: 'button', 'aria-pressed': e.valor === 1 ? 'true' : 'false', title: 'Me gusta: refuerza las conexiones que ha usado' }, '👍');
      const no = el('button', { clase: 'mini', type: 'button', 'aria-pressed': e.valor === -1 ? 'true' : 'false', title: 'No me gusta: debilita las conexiones que ha usado' }, '👎');
      const porque = el('button', { clase: 'mini', type: 'button', 'aria-expanded': 'false' }, '¿Por qué?');
      const caja = el('div', { clase: 'explicacion', hidden: true });
      si.addEventListener('click', () => this._opinar(e.respuesta, 1));
      no.addEventListener('click', () => this._opinar(e.respuesta, -1));
      porque.addEventListener('click', () => this._explicar(e.respuesta, porque, caja));
      fila.append(el('div', { clase: 'msg-acciones' }, si, no, porque), caja);
      fila._botones = { si, no };
      this.filas.set(e.respuesta, fila);
    }
    return fila;
  }

  async _opinar(id, valor) {
    try {
      const r = await api('/api/opinion', { metodo: 'POST', cuerpo: { id, valor } });
      if (!r.repetido) avisar(valor > 0 ? `Dopamina: ${num(r.cambios)} conexiones reforzadas` : `Ha debilitado ${num(r.cambios)} conexiones`);
    } catch (e) {
      avisar(e.message, 'error');
    }
  }

  valor({ id, valor }) {
    // `id` es el de la entrada del chat; buscamos su fila por la respuesta.
    for (const [, fila] of this.filas) {
      if (Number(fila.dataset.entrada) === id && fila._botones) {
        fila._botones.si.setAttribute('aria-pressed', valor === 1 ? 'true' : 'false');
        fila._botones.no.setAttribute('aria-pressed', valor === -1 ? 'true' : 'false');
      }
    }
  }

  async _explicar(id, boton, caja) {
    if (!caja.hidden) {
      caja.hidden = true;
      boton.setAttribute('aria-expanded', 'false');
      this.mapa.resaltar(null);
      return;
    }
    try {
      const x = await api(`/api/explicar/${id}`);
      caja.replaceChildren(...this._explicacion(x));
      caja.hidden = false;
      boton.setAttribute('aria-expanded', 'true');
      const ids = [...x.ids.entrada, ...x.ids.salida, ...x.ids.celdas, ...x.ids.contexto.slice(0, 8)];
      this.mapa.resaltar(ids, x.ids.pasos);
    } catch (e) {
      avisar(e.message, 'error');
    }
  }

  _explicacion(x) {
    const partes = [];
    if (x.oyo.length) partes.push(el('p', {}, el('b', {}, 'Oyó: '), x.oyo.join(', ')));
    const penso = x.penso.filter((p) => p.tipo === 'palabra' || p.tipo === 'concepto').slice(0, 7);
    if (penso.length) {
      partes.push(el('p', {}, el('b', {}, 'Le vino a la cabeza: '), penso.map((p) => `${p.etiqueta} (${pct(p.actividad)})`).join(', ')));
    }
    if (x.empezo) {
      const pasos = x.transiciones.filter((t) => t.de !== 'inicio de frase' && t.a !== 'fin de frase');
      partes.push(el('p', {}, el('b', {}, 'Construyó la frase '), `desde «${x.empezo}»:`, el('br'),
        pasos.map((t) => el('span', { clase: `paso ${t.origen === 'hipocampo' ? 'h' : ''}`, title: t.origen === 'hipocampo' ? 'Siguiendo un recuerdo reciente del hipocampo' : 'Con lo que ya tiene aprendido en la corteza' }, `${t.de} → ${t.a}`))));
      partes.push(el('p', {}, `Los pasos en ámbar salen de un recuerdo reciente (hipocampo); los turquesa, de la corteza. Probó ${x.candidatas} ${x.candidatas === 1 ? 'frase' : 'frases'} y dijo la que más encajaba.`));
    } else {
      partes.push(el('p', {}, 'No encontró ninguna frase que encajara, así que repitió lo más llamativo, como hace un bebé.'));
    }
    partes.push(el('p', { clase: 'pista' }, 'En el mapa tienes resaltado lo que usó.'));
    return partes;
  }

  // Barra de lectura de textos grandes.
  lectura(t) {
    if (['terminada', 'cancelada', 'error'].includes(t.estado)) this.lecturas.delete(t.id);
    else this.lecturas.set(t.id, t);
    const activas = [...this.lecturas.values()];
    if (!activas.length) { this.barra.hidden = true; return; }
    const a = activas[0];
    const textos = {
      en_cola: 'En la bandeja, esperando',
      leyendo: `Leyendo${a.repasos > 1 ? ` (repaso ${num(a.repaso)} de ${num(a.repasos)})` : ''}, ${pct(a.progreso)}`,
      en_pausa: 'En pausa mientras duerme',
    };
    const progreso = el('div', { clase: 'progreso' }, el('div', { estilo: { width: `${Math.round(a.progreso * 100)}%` } }));
    this.barra.replaceChildren(
      el('div', { clase: 'lectura-fila' },
        el('span', {}, `📖 «${a.fuente}»: ${textos[a.estado] || a.estado}${a.palabras ? `, ${num(a.palabras)} palabras` : ''}${activas.length > 1 ? ` (y ${activas.length - 1} más)` : ''}`),
        el('button', { clase: 'mini', type: 'button', onclick: () => this._cancelar(a.id) }, 'Cancelar')),
      progreso);
    this.barra.hidden = false;
  }

  async _cancelar(id) {
    try { await api(`/api/lecturas/${encodeURIComponent(id)}`, { metodo: 'DELETE' }); } catch (e) { avisar(e.message, 'error'); }
  }
}
