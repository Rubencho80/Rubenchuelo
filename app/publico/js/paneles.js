// Pestañas de Sueños, Ajustes, Cerebros y Conexiones.

import { api, obtenerToken } from './api.js';
import { el, svg, num, pct, duracion, hace, fecha, bytes, avisar, confirmar, pedirTexto, copiar } from './util.js';

const FASES = {
  dormirse: ['quedándose dormido', 'Va cerrando los ojos…'],
  nrem: ['fase profunda', 'Repasa los recuerdos del hipocampo y los pasa a la corteza, mezclados con recuerdos antiguos para no olvidarlos.'],
  rem: ['fase REM', 'Sueña: enciende recuerdos al azar con poca inhibición y, si se encienden juntos, los une un poco.'],
  poda: ['podando', 'Debilita un poco todas las conexiones y elimina las más flojas.'],
};
const MOTIVOS = { manual: 'se lo pediste', horario: 'era su hora', temporizador: 'saltó el temporizador', agotado: 'estaba agotado', api: 'se lo pidió otra aplicación' };
const DIAS = [['L', 1, 'lunes'], ['M', 2, 'martes'], ['X', 3, 'miércoles'], ['J', 4, 'jueves'], ['V', 5, 'viernes'], ['S', 6, 'sábado'], ['D', 0, 'domingo']];

const leer = (o, ruta) => ruta.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function escribir(o, ruta, v) {
  const ks = ruta.split('.');
  let a = o;
  for (const k of ks.slice(0, -1)) a = a[k];
  a[ks[ks.length - 1]] = v;
}
const copiaProfunda = (o) => JSON.parse(JSON.stringify(o));

// ═════════════════════════════ Sueños ═════════════════════════════

export class PanelSuenos {
  constructor(raiz, { alNuevos }) {
    this.raiz = raiz;
    this.alNuevos = alNuevos;
    this.diario = { suenos: [], informes: [] };
    this.estado = null;
    this.visibles = 40;
    this.control = el('div', { clase: 'seccion' });
    this.ultimo = el('div', { clase: 'seccion' });
    this.lista = el('ul', { clase: 'lista' });
    this.mas = el('button', { clase: 'boton boton-sobrio boton-pequeno', type: 'button', onclick: () => { this.visibles += 40; this._pintarDiario(); } }, 'Ver más sueños');
    this.raiz.append(this.control, this.ultimo,
      el('div', { clase: 'seccion' },
        el('h2', { texto: 'Diario de sueños' }),
        el('p', { clase: 'explica', texto: 'Lo que dice en sueños mientras está en fase REM. Este diario es solo para ti: Rubenchuelo no lo lee nunca.' }),
        this.lista, this.mas));
  }

  async cargar() {
    try {
      this.diario = await api('/api/diario');
    } catch (e) {
      avisar(e.message, 'error');
    }
    this._pintarUltimo();
    this._pintarDiario();
  }

  // Solo se redibuja al cambiar de estado o de fase; los números se
  // actualizan en su sitio para no reiniciar los controles mientras se usan.
  ponerEstado(e) {
    this.estado = e;
    const clave = e.despierto ? 'despierto' : `durmiendo-${e.sueno.fase}-${e.sueno.ciclo}`;
    if (clave !== this._clave) {
      this._clave = clave;
      this._pintarControl();
    } else {
      this._actualizarControl();
    }
  }

  _textoDespierto(e) {
    return `Lleva ${duracion(e.msDespierto)} despierto y tiene un ${pct(Math.min(e.presion, 3))} de presión de sueño. Mientras duerme repasa lo que ha vivido, lo pasa a la corteza, sueña y poda las conexiones débiles.`;
  }

  _textoProximo(e) {
    const prox = [];
    if (e.proximo && e.proximo.horario) prox.push(`Según el horario, dormirá el ${e.proximo.horario.dia} a las ${new Date(e.proximo.horario.cuando).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.`);
    if (e.proximo && e.proximo.temporizador) prox.push(`El temporizador lo dormirá dentro de ${duracion(e.proximo.temporizador.faltaMs)}.`);
    return prox.join(' ');
  }

  _actualizarControl() {
    const e = this.estado;
    if (!e || !this._vivos) return;
    if (e.despierto) {
      this._vivos.texto.textContent = this._textoDespierto(e);
      this._vivos.proximo.textContent = this._textoProximo(e);
    } else if (this._vivos.barra) {
      this._vivos.barra.style.width = `${Math.round(e.sueno.progreso * 100)}%`;
    }
  }

  nuevoSueno(s) {
    this.diario.suenos.push(s);
    this._pintarDiario(true);
    if (this.raiz.hidden) this.alNuevos(1);
  }

  informe(i) {
    const { suenos, ...resto } = i;
    this.diario.informes.push({ ...resto, numSuenos: (suenos || []).length });
    this._pintarUltimo();
  }

  _pintarControl() {
    const e = this.estado;
    if (!e) return;
    const partes = [];
    if (e.despierto) {
      const texto = el('p', { clase: 'explica' }, this._textoDespierto(e));
      const proximo = el('p', { clase: 'detalle' }, this._textoProximo(e));
      this._vivos = { texto, proximo };
      partes.push(el('h2', { texto: 'Está despierto' }), texto);
      const sel = el('select', { 'aria-label': 'Duración del sueño' },
        el('option', { value: '' }, 'Lo que digan los ajustes'),
        [1, 2, 5, 15, 30, 60].map((m) => el('option', { value: m }, `${m} min`)));
      partes.push(el('div', { clase: 'fila-botones' }, sel,
        el('button', { clase: 'boton boton-noche', type: 'button', onclick: () => this._dormir(sel.value) }, 'Dormir ahora')));
      partes.push(proximo);
    } else {
      const s = e.sueno;
      const [nombre, explica] = FASES[s.fase] || [s.fase, ''];
      const barra = el('div', { estilo: { width: `${Math.round(s.progreso * 100)}%`, background: 'var(--concepto)' } });
      this._vivos = { barra };
      partes.push(el('h2', {}, `Durmiendo: ${nombre}`));
      partes.push(el('p', { clase: 'explica' }, `${explica} Ciclo ${s.ciclo} de ${s.ciclos}; se durmió porque ${MOTIVOS[s.motivo] || s.motivo}.`));
      partes.push(el('div', { clase: 'progreso' }, barra));
      partes.push(el('p', { clase: 'detalle' }, `Despertará solo ${s.finPrevisto ? `hacia las ${new Date(s.finPrevisto).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : 'al terminar'}. Si lo despiertas antes, la consolidación quedará a medias.`));
      partes.push(el('div', { clase: 'fila-botones' },
        el('button', { clase: 'boton boton-sobrio', type: 'button', onclick: () => this._despertar() }, 'Despertar')));
    }
    this.control.replaceChildren(...partes);
  }

  async _dormir(min) {
    try { await api('/api/dormir', { metodo: 'POST', cuerpo: min ? { minutos: Number(min) } : {} }); } catch (e) { avisar(e.message, 'error'); }
  }

  async _despertar() {
    try { await api('/api/despertar', { metodo: 'POST' }); } catch (e) { avisar(e.message, 'error'); }
  }

  _pintarUltimo() {
    const i = this.diario.informes[this.diario.informes.length - 1];
    if (!i) {
      this.ultimo.replaceChildren(el('h2', { texto: 'La última noche' }), el('p', { clase: 'explica', texto: 'Todavía no ha dormido nunca.' }));
      return;
    }
    const cifra = (n, t) => el('span', {}, el('b', {}, num(n)), t);
    this.ultimo.replaceChildren(
      el('h2', { texto: 'La última noche' }),
      el('p', { clase: 'explica' }, `${fecha(i.inicio)}, ${duracion(i.fin - i.inicio)}. ${i.completo ? 'Noche completa.' : `Le despertaron a medias (${i.despertadoPor || 'interrumpido'}).`}`),
      this._hipnograma(i),
      el('div', { clase: 'cifras' },
        cifra(i.consolidados, ` de ${num(i.recuerdos)} recuerdos consolidados`),
        cifra(i.repasos, ' repasos'),
        cifra(i.numSuenos ?? 0, ' sueños'),
        cifra(i.nuevasAsociaciones, ' asociaciones nuevas'),
        cifra(i.podadas, ' conexiones podadas'),
        cifra(i.eliminadas, ' neuronas eliminadas'),
        cifra((i.deducciones || []).length, (i.deducciones || []).length === 1 ? ' deducción' : ' deducciones'),
        cifra((i.categorias || []).length, (i.categorias || []).length === 1 ? ' categoría' : ' categorías')),
      ...this._descubrimientos(i));
  }

  // Lo que ha deducido y las palabras que ha agrupado esa noche.
  _descubrimientos(i) {
    const partes = [];
    if (i.deducciones && i.deducciones.length) {
      partes.push(el('h3', {}, 'Lo que dedujo'));
      partes.push(el('ul', { clase: 'lista' }, i.deducciones.map((d) => el('li', {},
        el('p', { clase: 'sueno-texto' }, d.texto),
        el('div', { clase: 'detalle' }, `Porque «${d.porque[0].replace(/\.$/, '')}» y «${d.porque[1].replace(/\.$/, '')}».`)))));
    }
    if (i.categorias && i.categorias.length) {
      partes.push(el('h3', {}, 'Palabras que agrupó'));
      partes.push(el('p', { clase: 'detalle' },
        i.categorias.map((x) => `${x.texto}${x.nueva ? ' (nueva)' : ''}`).join(', '),
        '. Se usan en frases parecidas, así que ahora se recuerdan unas a otras.'));
    }
    return partes;
  }

  _hipnograma(i) {
    const W = 320, H = 64;
    const t0 = i.inicio, t1 = Math.max(i.fin || Date.now(), t0 + 1);
    const x = (t) => 46 + ((t - t0) / (t1 - t0)) * (W - 50);
    const s = svg('svg', { class: 'hipnograma', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Hipnograma: fases del sueño a lo largo de la noche' });
    s.append(svg('text', { x: 0, y: 23, 'font-size': 11, fill: 'currentColor', opacity: 0.6 }, document.createTextNode('REM')));
    s.append(svg('text', { x: 0, y: 49, 'font-size': 11, fill: 'currentColor', opacity: 0.6 }, document.createTextNode('Profundo')));
    s.append(svg('line', { x1: 46, x2: W, y1: 58, y2: 58, stroke: 'currentColor', opacity: 0.2 }));
    for (const tramo of i.hipnograma || []) {
      const rem = tramo.fase === 'rem';
      s.append(svg('rect', {
        x: x(tramo.desde), y: rem ? 12 : 38, width: Math.max(1.5, x(tramo.hasta) - x(tramo.desde)), height: 16, rx: 3,
        fill: rem ? '#c792ff' : '#3a44a0',
      }));
    }
    return s;
  }

  _pintarDiario(nuevo = false) {
    const suenos = this.diario.suenos.slice(-this.visibles).reverse();
    if (!suenos.length) {
      this.lista.replaceChildren(el('li', { clase: 'detalle' }, 'Aún no ha soñado nada.'));
      this.mas.hidden = true;
      return;
    }
    this.lista.replaceChildren(...suenos.map((s, k) => el('li', { clase: `sueno ${nuevo && k === 0 ? 'nuevo' : ''}` },
      el('div', { clase: 'detalle' }, fecha(s.cuando)),
      el('p', { clase: 'sueno-texto' }, s.texto),
      s.mezcla && s.mezcla.length > 1 ? el('div', { clase: 'detalle' }, `Mezcló ${s.mezcla.join(' con ')}.`) : null,
      s.nuevas && s.nuevas.length ? el('div', { clase: 'detalle' }, `Unió: ${s.nuevas.map(([a, b]) => `${a} y ${b}`).join(', ')}.`) : null)));
    this.mas.hidden = this.diario.suenos.length <= this.visibles;
  }
}

// ═════════════════════════════ Ajustes ═════════════════════════════

const SECCIONES = [
  {
    titulo: 'Habilidades',
    explica: 'Tres capacidades extra. Ninguna gasta mucha memoria del ordenador; aun así puedes apagarlas.',
    campos: [
      ['cerebro', 'aprendizaje.memoriaTrabajo', 'Memoria de trabajo', 'Recuerda de qué estabais hablando durante unos minutos, para seguir el tema aunque no lo nombres («¿Quién es Luna?» → «¿Y qué come?»). Lo que tiene en mente lleva un anillo discontinuo en el mapa. Gasta poquísima memoria.', 'si-no'],
      ['cerebro', 'sueno.deducciones', 'Deducir mientras duerme', 'Si sabe que «Toby es mi perro» y que «los perros son animales», al dormir deduce «Toby es un animal» y luego te lo sabe decir. Lo que deduce sale en la pestaña Sueños. Gasta poquísima memoria.', 'si-no'],
      ['cerebro', 'sueno.agrupar', 'Agrupar palabras que se usan igual', 'Al dormir busca palabras que aparecen en frases parecidas (perro y gata, Toby y Luna…) y las une en una categoría como {perro ≈ gata}. Usa poca memoria; con cerebros enormes alarga un poco cada noche.', 'si-no'],
    ],
  },
  {
    titulo: 'Escuchar',
    explica: 'Con el botón del micrófono, junto a la caja de texto, aprende de todo lo que oye (sin contestar). La voz se pasa a texto en este ordenador, sin internet, y el texto no se guarda: solo lo que aprende.',
    campos: [
      ['app', 'oido.motor', 'Cómo pasa la voz a texto', 'Whisper entiende mucho mejor (nombres, acentos, ruido) y pone puntos y mayúsculas, pero necesita una tarjeta gráfica NVIDIA; mientras se carga, y en ordenadores sin ella, usa Vosk. Con Whisper, lo que no esté en español se descarta.', 'motor'],
      ['app', 'oido.dispositivo', 'Micrófono', '', 'microfono'],
      ['app', 'oido.pausaSeg', 'Pausa que cierra una frase (segundos)', 'Cuánto silencio tiene que haber para darla por terminada y aprenderla.', { min: 0.4, max: 6, paso: 0.1 }],
      ['app', 'oido.confianzaFrase', 'Seguridad media mínima de una frase', 'De 0 a 1. Si de media no está así de seguro de lo que ha oído, tira la frase entera. Con voz clara suele estar por encima de 0,9 (Whisper, casi siempre 0,95 o más); con ruido o cosas que no entiende, por debajo de 0,75.', { min: 0, max: 1, paso: 0.05 }],
      ['app', 'oido.confianzaPalabra', 'Seguridad mínima de cada palabra', 'De 0 a 1. En las frases que sí aprende, quita las palabras sueltas de las que esté menos seguro que esto.', { min: 0, max: 1, paso: 0.05 }],
    ],
  },
  {
    titulo: 'Sueño',
    explica: 'Cuándo y cómo duerme.',
    campos: [
      ['cerebro', 'sueno.duracionMin', 'Duración de una noche (minutos)', 'Cuánto dura el sueño cuando lo mandas a dormir, se agota o salta el temporizador.', { min: 0.25, max: 240, paso: 0.25 }],
      ['cerebro', 'sueno.ciclos', 'Ciclos por noche', 'Cada ciclo tiene fase profunda y REM. Los recuerdos importantes se repasan en más ciclos.', { min: 1, max: 8, paso: 1 }],
      ['cerebro', 'sueno.dormirAlAgotarse', 'Dormirse al agotarse', 'Si la presión de sueño llega al 100 %, se duerme él solo (nunca a mitad de una lectura).', 'si-no'],
      ['cerebro', 'sueno.despertarAlHablarle', 'Despertarse si le hablas', 'Si lo apagas, mientras duerme solo contesta «Zzz…» y no aprende nada.', 'si-no'],
      ['cerebro', 'sueno.temporizador.activo', 'Temporizador', 'Dormir cada cierto tiempo despierto.', 'si-no'],
      ['cerebro', 'sueno.temporizador.horasDespierto', 'Horas despierto hasta dormir', 'Con el temporizador encendido.', { min: 0.05, max: 72, paso: 0.05 }],
      ['cerebro', 'sueno.fuerzaPoda', 'Fuerza de la poda', 'Cuánto bajan todas las conexiones al final de cada noche (0,03 es un 3 %).', { min: 0, max: 0.3, paso: 0.005 }],
      ['cerebro', 'sueno.umbralPoda', 'Umbral de poda', 'Las conexiones más débiles que esto desaparecen al final de la noche.', { min: 0.001, max: 0.2, paso: 0.001 }],
    ],
    horario: true,
  },
  {
    titulo: 'Aprendizaje',
    explica: 'Cómo cambian sus conexiones y cuándo nacen neuronas.',
    campos: [
      ['cerebro', 'aprendizaje.velocidadCorteza', 'Velocidad de la corteza despierto', 'Cuánto cambian sus conexiones al oír algo. Más alto: aprende antes, pero lo anterior pesa menos.', { min: 0.005, max: 0.5, paso: 0.005 }],
      ['cerebro', 'aprendizaje.velocidadSueno', 'Velocidad de consolidación', 'Cuánto refuerza la corteza cada repaso durante el sueño.', { min: 0.01, max: 0.6, paso: 0.01 }],
      ['cerebro', 'aprendizaje.vigilancia', 'Vigilancia (cuándo nace un concepto)', 'Cuánto se tiene que parecer una frase a un concepto conocido para encajar en él. Más alto: más detallista, nacen más conceptos.', { min: 0.1, max: 0.95, paso: 0.01 }],
      ['cerebro', 'aprendizaje.capacidadHipocampo', 'Capacidad del hipocampo', 'Células de tiempo que caben. Si se llena, olvida lo más viejo que aún no haya consolidado.', { min: 50, max: 5000, paso: 10 }],
      ['cerebro', 'aprendizaje.ventanaAsociacion', 'Ventana de asociación', 'Hasta cuántas palabras de distancia se asocian dos palabras de una frase.', { min: 1, max: 8, paso: 1 }],
      ['cerebro', 'aprendizaje.creatividad', 'Creatividad', 'Más alto: frases más variadas y más disparatadas.', { min: 0.05, max: 2, paso: 0.05 }],
      ['cerebro', 'aprendizaje.longitudMaxRespuesta', 'Palabras máximas por respuesta', '', { min: 3, max: 40, paso: 1 }],
    ],
  },
  {
    titulo: 'Lectura de textos',
    explica: 'Para los textos grandes que le das o que le mandan otras aplicaciones.',
    campos: [
      ['cerebro', 'lectura.repasos', 'Veces que repasa cada texto', 'Lee el texto entero y lo vuelve a leer tantas veces como pongas: cada vuelta refuerza lo leído (no tiene tope). Con textos muy grandes y muchos repasos tarda más; lo puedes cancelar cuando quieras y lo leído hasta ahí se queda.', { min: 1, max: 1000000, paso: 1 }],
      ['cerebro', 'lectura.velocidad', 'Velocidad de aprendizaje al leer', 'Más bajo que charlando: un libro entero no debe borrar lo que ya sabía.', { min: 0.005, max: 0.3, paso: 0.005 }],
      ['cerebro', 'lectura.frasesAlHipocampo', 'Frases que pasan al hipocampo', 'No limita lo que aprende: el texto entero se aprende en la corteza en cada repaso. Esto es solo cuántas de las frases que más le sorprenden guarda además como recuerdo vivo en el hipocampo, para repasarlas al dormir.', { min: 0, max: 200, paso: 1 }],
      ['cerebro', 'lectura.presionPorMilPalabras', 'Sueño por cada mil palabras', 'Cuánta presión de sueño le da leer (0,15 es un 15 % por cada mil palabras).', { min: 0, max: 2, paso: 0.01 }],
    ],
  },
  {
    titulo: 'Dopamina',
    explica: 'Los botones 👍 y 👎 de cada respuesta.',
    campos: [
      ['cerebro', 'dopamina.fuerza', 'Fuerza del premio y el castigo', 'Cuánto cambian las conexiones que usó en una respuesta al premiarla o castigarla.', { min: 0, max: 1, paso: 0.01 }],
    ],
  },
  {
    titulo: 'Aplicación',
    explica: 'Ajustes de Rubenchuelo en este pendrive (valen para todos los cerebros).',
    campos: [
      ['app', 'abrirNavegador', 'Abrir el navegador al iniciar', '', 'si-no'],
      ['app', 'autoguardadoMin', 'Autoguardado (minutos)', 'Cada cuánto guarda si ha aprendido algo. También guarda al dormir, al leer y al salir.', { min: 0.5, max: 60, paso: 0.5 }],
      ['app', 'copiasMaximo', 'Copias de seguridad que conserva', 'Por cada cerebro. Las más antiguas se borran solas.', { min: 1, max: 100, paso: 1 }],
      ['app', 'copiaCadaHoras', 'Copia automática cada (horas)', 'Además de la copia que hace después de cada noche completa.', { min: 0.5, max: 168, paso: 0.5 }],
      ['app', 'maxTextoMB', 'Tamaño máximo de un texto (MB)', '', { min: 1, max: 500, paso: 1 }],
      ['app', 'puerto', 'Puerto', 'Se aplica la próxima vez que abras Rubenchuelo.', { min: 1024, max: 65535, paso: 1 }],
      ['app', 'accesoRed', 'Aceptar conexiones de otros dispositivos de la red', 'Solo en redes de confianza: cualquiera que abra la página tendrá el token. Se aplica la próxima vez que lo abras.', 'si-no'],
    ],
  },
];

export class PanelAjustes {
  constructor(raiz, { alCambiar }) {
    this.raiz = raiz;
    this.alCambiar = alCambiar;
    this.datos = null;
    this.copia = null;
  }

  async cargar() {
    try {
      this.datos = await api('/api/ajustes');
      this.copia = { cerebro: copiaProfunda(this.datos.cerebro), app: copiaProfunda(this.datos.app) };
      this.alCambiar(this.datos);
      this._pintar();
    } catch (e) {
      this.raiz.replaceChildren(el('p', { clase: 'explica' }, `No se pudieron cargar los ajustes: ${e.message}`));
    }
  }

  _campo([donde, ruta, etiqueta, ayuda, tipo]) {
    const id = `aj-${donde}-${ruta.replace(/\./g, '-')}`;
    const valor = leer(this.copia[donde], ruta);
    let control;
    if (tipo === 'motor') {
      const sel = el('select', { id }, el('option', { value: 'whisper' }, 'Whisper (mejor, con tarjeta NVIDIA)'), el('option', { value: 'vosk' }, 'Vosk (rápido y ligero)'));
      sel.value = String(valor);
      sel.addEventListener('change', () => escribir(this.copia[donde], ruta, sel.value));
      control = sel;
    } else if (tipo === 'microfono') {
      const sel = el('select', { id }, el('option', { value: '-1' }, 'El de Windows (predeterminado)'));
      sel.value = String(valor);
      sel.addEventListener('change', () => escribir(this.copia[donde], ruta, Number(sel.value)));
      api('/api/oido/dispositivos').then(({ dispositivos }) => {
        for (const d of dispositivos) sel.append(el('option', { value: String(d.id) }, d.nombre));
        sel.value = String(leer(this.copia[donde], ruta));
      }).catch(() => {});
      control = sel;
    } else if (tipo === 'si-no') {
      const cb = el('input', { type: 'checkbox', id, checked: Boolean(valor) });
      cb.addEventListener('change', () => escribir(this.copia[donde], ruta, cb.checked));
      control = el('label', { clase: 'interruptor', for: id }, cb, el('span', { clase: 'pista-int' }));
    } else {
      const inp = el('input', { type: 'number', id, min: tipo.min, max: tipo.max, step: tipo.paso, value: valor });
      inp.addEventListener('change', () => {
        let v = Number(inp.value);
        if (!Number.isFinite(v)) v = leer(this.copia[donde], ruta);
        v = Math.min(tipo.max, Math.max(tipo.min, v));
        inp.value = v;
        escribir(this.copia[donde], ruta, v);
      });
      control = inp;
    }
    return el('div', { clase: 'campo' },
      el('label', { for: id }, etiqueta), control,
      ayuda ? el('div', { clase: 'ayuda' }, ayuda) : null);
  }

  _horario() {
    const lista = el('div', { clase: 'franjas' });
    const pintar = () => {
      const h = this.copia.cerebro.sueno.horario;
      if (!h.length) lista.replaceChildren(el('p', { clase: 'detalle' }, 'Sin horario.'));
      else lista.replaceChildren(...h.map((f, i) => this._franja(f, i, pintar)));
    };
    pintar();
    return el('div', {},
      el('div', { clase: 'campo' }, el('label', {}, 'Horario de sueño'), el('span'),
        el('div', { clase: 'ayuda' }, 'Franjas en las que se dormirá cada día que marques. Solo funciona si Rubenchuelo está abierto a esa hora.')),
      lista,
      el('div', { clase: 'fila-botones' },
        el('button', {
          clase: 'boton boton-sobrio boton-pequeno', type: 'button',
          onclick: () => {
            this.copia.cerebro.sueno.horario.push({ activo: true, inicio: '03:00', fin: '03:30', dias: [0, 1, 2, 3, 4, 5, 6] });
            pintar();
          },
        }, 'Añadir franja')));
  }

  _franja(f, i, repintar) {
    const activo = el('input', { type: 'checkbox', id: `fr-${i}`, checked: f.activo });
    activo.addEventListener('change', () => { f.activo = activo.checked; });
    const ini = el('input', { type: 'time', value: f.inicio, 'aria-label': 'Empieza a dormir a las' });
    const fin = el('input', { type: 'time', value: f.fin, 'aria-label': 'Se despierta a las' });
    ini.addEventListener('change', () => { if (ini.value) f.inicio = ini.value; });
    fin.addEventListener('change', () => { if (fin.value) f.fin = fin.value; });
    const dias = el('div', { clase: 'dias', role: 'group', 'aria-label': 'Días' }, DIAS.map(([letra, n, nombre]) => {
      const b = el('button', { clase: 'dia', type: 'button', title: nombre, 'aria-label': nombre, 'aria-pressed': f.dias.includes(n) ? 'true' : 'false' }, letra);
      b.addEventListener('click', () => {
        if (f.dias.includes(n)) f.dias = f.dias.filter((d) => d !== n); else f.dias.push(n);
        b.setAttribute('aria-pressed', f.dias.includes(n) ? 'true' : 'false');
      });
      return b;
    }));
    return el('div', { clase: 'franja' },
      el('label', { clase: 'interruptor', for: `fr-${i}`, title: 'Activar esta franja' }, activo, el('span', { clase: 'pista-int' })),
      'de', ini, 'a', fin, dias,
      el('button', {
        clase: 'mini', type: 'button', 'aria-label': 'Quitar franja',
        onclick: () => { this.copia.cerebro.sueno.horario.splice(i, 1); repintar(); },
      }, 'Quitar'));
  }

  _pintar() {
    const partes = [];
    for (const s of SECCIONES) {
      partes.push(el('div', { clase: 'seccion' },
        el('h2', { texto: s.titulo }),
        el('p', { clase: 'explica', texto: s.explica }),
        s.campos.slice(0, s.horario ? 6 : undefined).map((c) => this._campo(c)),
        s.horario ? this._horario() : null,
        s.horario ? s.campos.slice(6).map((c) => this._campo(c)) : null));
    }
    partes.push(el('div', { clase: 'guardar-barra' },
      el('button', { clase: 'boton boton-sobrio', type: 'button', onclick: () => this._porDefecto() }, 'Valores por defecto'),
      el('button', { clase: 'boton boton-accion', type: 'button', onclick: () => this._guardar() }, 'Guardar ajustes')));
    this.raiz.replaceChildren(...partes);
  }

  _porDefecto() {
    this.copia = {
      cerebro: copiaProfunda(this.datos.defecto.cerebro),
      app: { ...copiaProfunda(this.datos.defecto.app), puerto: this.copia.app.puerto },
    };
    this._pintar();
    avisar('Valores por defecto puestos. Pulsa «Guardar ajustes» para aplicarlos.');
  }

  async _guardar() {
    try {
      const r = await api('/api/ajustes', { metodo: 'PUT', cuerpo: this.copia });
      this.datos = { ...this.datos, ...r };
      this.copia = { cerebro: copiaProfunda(r.cerebro), app: copiaProfunda(r.app) };
      this.alCambiar(this.datos);
      this._pintar();
      avisar(r.reinicioNecesario ? 'Guardado. El puerto y el acceso de red se aplicarán al volver a abrir Rubenchuelo.' : 'Ajustes guardados');
    } catch (e) {
      avisar(e.message, 'error');
    }
  }
}

// ═════════════════════════════ Cerebros ═════════════════════════════

export class PanelCerebros {
  constructor(raiz) {
    this.raiz = raiz;
    this.listaCerebros = el('ul', { clase: 'lista' });
    this.listaCopias = el('ul', { clase: 'lista' });
    const nombre = el('input', { clase: 'entrada-texto', type: 'text', maxlength: 40, placeholder: 'Nombre del cerebro nuevo', 'aria-label': 'Nombre del cerebro nuevo' });
    const crear = async () => {
      const n = nombre.value.trim();
      if (!n) { nombre.focus(); return; }
      try {
        await api('/api/cerebros', { metodo: 'POST', cuerpo: { nombre: n } });
        nombre.value = '';
        avisar(`Cerebro «${n}» creado. Pulsa «Usar» para empezar a enseñarle.`);
        this.cargar();
      } catch (e) { avisar(e.message, 'error'); }
    };
    nombre.addEventListener('keydown', (e) => { if (e.key === 'Enter') crear(); });
    this.raiz.append(
      el('div', { clase: 'seccion' },
        el('h2', { texto: 'Tus cerebros' }),
        el('p', { clase: 'explica', texto: 'Cada cerebro aprende por separado. Clonar copia todo lo que sabe uno en otro nuevo.' }),
        this.listaCerebros,
        el('div', { clase: 'fila-botones' }, nombre, el('button', { clase: 'boton boton-accion', type: 'button', onclick: crear }, 'Crear'))),
      el('div', { clase: 'seccion' },
        el('h2', { texto: 'Copias de seguridad' }),
        el('p', { clase: 'explica', texto: 'Se hace una después de cada noche completa y cada pocas horas. Restaurar vuelve a cómo estaba entonces (antes guarda una copia de cómo está ahora).' }),
        el('div', { clase: 'fila-botones' }, el('button', { clase: 'boton boton-sobrio boton-pequeno', type: 'button', onclick: () => this._copiaAhora() }, 'Hacer una copia ahora')),
        this.listaCopias),
      el('div', { clase: 'seccion' },
        el('h2', { texto: 'Llevártelo en un pendrive' }),
        el('p', { clase: 'explica', texto: 'Todo Rubenchuelo, incluido lo que sabe, está en su carpeta. Pulsa «Guardar y salir», copia la carpeta entera al pendrive y ábrelo en cualquier Windows con Iniciar.bat. No hace falta instalar nada ni tener internet.' }),
        el('div', { clase: 'fila-botones' },
          el('button', { clase: 'boton boton-sobrio boton-pequeno', type: 'button', onclick: () => this._abrir('cerebro') }, 'Abrir la carpeta de este cerebro'),
          el('button', { clase: 'boton boton-sobrio boton-pequeno', type: 'button', onclick: () => this._abrir('raiz') }, 'Abrir la carpeta de Rubenchuelo'))));
  }

  async cargar() {
    try {
      const [c, k] = await Promise.all([api('/api/cerebros'), api('/api/copias')]);
      this._pintarCerebros(c);
      this._pintarCopias(k.copias);
    } catch (e) {
      avisar(e.message, 'error');
    }
  }

  _pintarCerebros({ cerebros }) {
    this.listaCerebros.replaceChildren(...cerebros.map((c) => {
      const r = c.resumen;
      const detalle = r ? `${num(r.neuronas)} neuronas, ${num(r.sinapsis)} conexiones, ${bytes(c.bytes)}, guardado ${hace(r.guardado)}` : 'Aún vacío';
      const botones = [];
      if (!c.activo) botones.push(el('button', { clase: 'boton boton-accion boton-pequeno', type: 'button', onclick: () => this._usar(c.nombre) }, 'Usar'));
      botones.push(el('button', { clase: 'boton boton-sobrio boton-pequeno', type: 'button', onclick: () => this._clonar(c.nombre) }, 'Clonar'));
      if (!c.activo) botones.push(el('button', { clase: 'boton boton-peligro boton-pequeno', type: 'button', onclick: () => this._archivar(c.nombre) }, 'Archivar'));
      return el('li', {},
        el('div', { clase: 'lista-cabeza' }, el('strong', {}, c.nombre), c.activo ? el('span', { clase: 'etiqueta-uso' }, 'en uso') : null),
        el('div', { clase: 'detalle' }, detalle),
        el('div', { clase: 'fila-botones' }, botones));
    }));
  }

  _pintarCopias(copias) {
    if (!copias.length) { this.listaCopias.replaceChildren(el('li', { clase: 'detalle' }, 'Todavía no hay copias.')); return; }
    const nombres = { sueno: 'después de dormir', auto: 'automática', manual: 'hecha a mano', 'antes-de-restaurar': 'antes de restaurar' };
    this.listaCopias.replaceChildren(...copias.map((c) => {
      const etiqueta = (c.archivo.match(/^[\d-]+_[\d-]+-(.+)\.json\.gz$/) || [])[1] || '';
      return el('li', {},
        el('div', { clase: 'lista-cabeza' }, el('strong', {}, fecha(c.fecha)), el('span', { clase: 'detalle' }, `${nombres[etiqueta] || etiqueta}, ${bytes(c.bytes)}`)),
        el('div', { clase: 'fila-botones' }, el('button', { clase: 'boton boton-sobrio boton-pequeno', type: 'button', onclick: () => this._restaurar(c) }, 'Restaurar')));
    }));
  }

  async _usar(nombre) {
    try {
      await api('/api/cerebros/usar', { metodo: 'POST', cuerpo: { nombre } });
      avisar(`Ahora estás con «${nombre}»`);
    } catch (e) { avisar(e.message, 'error'); }
  }

  async _clonar(origen) {
    const nombre = await pedirTexto('Clonar cerebro', `Se copiará todo lo que sabe «${origen}» en un cerebro nuevo.`, { valor: `${origen} copia`.slice(0, 40), aceptar: 'Clonar' });
    if (!nombre) return;
    try {
      await api('/api/cerebros/clonar', { metodo: 'POST', cuerpo: { origen, nombre } });
      avisar(`Clonado como «${nombre}»`);
      this.cargar();
    } catch (e) { avisar(e.message, 'error'); }
  }

  async _archivar(nombre) {
    const ok = await confirmar('Archivar cerebro', `«${nombre}» dejará de aparecer aquí. No se borra: se mueve a la carpeta cerebros/_papelera, de donde puedes recuperarlo a mano.`, { aceptar: 'Archivar', peligro: true });
    if (!ok) return;
    try {
      await api('/api/cerebros/archivar', { metodo: 'POST', cuerpo: { nombre } });
      this.cargar();
    } catch (e) { avisar(e.message, 'error'); }
  }

  async _copiaAhora() {
    try {
      const r = await api('/api/copias', { metodo: 'POST' });
      avisar(r.archivo ? 'Copia hecha' : 'No se pudo hacer la copia', r.archivo ? '' : 'error');
      this.cargar();
    } catch (e) { avisar(e.message, 'error'); }
  }

  async _restaurar(c) {
    const ok = await confirmar('Restaurar copia', `El cerebro volverá a como estaba el ${fecha(c.fecha)}. Lo que ha aprendido después se guardará como copia «antes de restaurar», por si te arrepientes.`, { aceptar: 'Restaurar', peligro: true });
    if (!ok) return;
    try {
      await api('/api/copias/restaurar', { metodo: 'POST', cuerpo: { archivo: c.archivo } });
      avisar('Copia restaurada');
    } catch (e) { avisar(e.message, 'error'); }
  }

  async _abrir(que) {
    try { await api('/api/abrir-carpeta', { metodo: 'POST', cuerpo: { que } }); } catch (e) { avisar(e.message, 'error'); }
  }
}

// ═════════════════════════════ Conexiones ═════════════════════════════

export class PanelConexiones {
  constructor(raiz, { alNuevoToken }) {
    this.raiz = raiz;
    this.alNuevoToken = alNuevoToken;
    this.puerto = location.port || 7777;
    this.mostrar = false;
    this.lecturas = new Map();
    this.actividad = [];
    this.acceso = el('div', { clase: 'seccion' });
    this.ejemplos = el('div', { clase: 'seccion' });
    this.bandeja = el('ul', { clase: 'lista' });
    this.externa = el('ul', { clase: 'lista' });
    this.raiz.append(
      this.acceso,
      this.ejemplos,
      el('div', { clase: 'seccion' },
        el('h2', { texto: 'Bandeja de lectura' }),
        el('p', { clase: 'explica', texto: 'Textos que le han llegado para leer. Si está dormido, esperan a que despierte.' }),
        this.bandeja),
      el('div', { clase: 'seccion' },
        el('h2', { texto: 'Lo último que han hecho otras aplicaciones' }),
        this.externa));
  }

  async cargar() {
    this.puerto = location.port || this.puerto;
    this._pintarAcceso();
    this._pintarEjemplos();
    try {
      const [l, a] = await Promise.all([api('/api/lecturas'), api('/api/actividad-externa')]);
      this.lecturas = new Map(l.lecturas.map((t) => [t.id, t]));
      this.actividad = a.actividad;
      this._pintarBandeja();
      this._pintarExterna();
    } catch (e) {
      avisar(e.message, 'error');
    }
  }

  lectura(t) {
    this.lecturas.set(t.id, t);
    if (!this.raiz.hidden) this._pintarBandeja();
  }

  externo(e) {
    this.actividad.unshift(e);
    this.actividad = this.actividad.slice(0, 30);
    if (!this.raiz.hidden) this._pintarExterna();
  }

  _base() {
    return `http://127.0.0.1:${this.puerto}`;
  }

  _pintarAcceso() {
    const token = obtenerToken();
    const visible = this.mostrar ? token : '•'.repeat(Math.min(24, token.length));
    this.acceso.replaceChildren(
      el('h2', { texto: 'Conectar otras aplicaciones' }),
      el('p', { clase: 'explica', texto: 'Otras aplicaciones de este ordenador pueden hablar con Rubenchuelo, darle textos para leer o mandarlo a dormir. Necesitan esta dirección y el token (una contraseña para que ninguna web pueda hacerlo sin tu permiso).' }),
      el('div', { clase: 'campo' }, el('label', {}, 'Dirección'), el('span'),
        el('div', { clase: 'ayuda secreto' }, el('code', {}, this._base()), el('button', { clase: 'mini', type: 'button', onclick: () => copiar(this._base()) }, 'Copiar'))),
      el('div', { clase: 'campo' }, el('label', {}, 'Token'), el('span'),
        el('div', { clase: 'ayuda secreto' },
          el('code', {}, visible),
          el('button', { clase: 'mini', type: 'button', onclick: () => { this.mostrar = !this.mostrar; this._pintarAcceso(); this._pintarEjemplos(); } }, this.mostrar ? 'Ocultar' : 'Mostrar'),
          el('button', { clase: 'mini', type: 'button', onclick: () => copiar(token) }, 'Copiar'),
          el('button', { clase: 'mini', type: 'button', onclick: () => this._nuevoToken() }, 'Cambiar'))),
      el('p', { clase: 'detalle', texto: 'La guía completa está en docs/API.md, dentro de la carpeta de Rubenchuelo.' }));
  }

  _pintarEjemplos() {
    const real = obtenerToken();
    const t = this.mostrar ? real : 'TU_TOKEN';
    const base = this._base();
    const ejemplos = [
      ['PowerShell: darle un archivo para leer',
        (tk) => `$cuerpo = @{ texto = Get-Content -Raw -Encoding UTF8 "C:\\ruta\\libro.txt"; fuente = "libro.txt" } | ConvertTo-Json\nInvoke-RestMethod -Method Post -Uri "${base}/api/aprender" \`\n  -Headers @{ "X-Rubenchuelo-Token" = "${tk}" } \`\n  -ContentType "application/json; charset=utf-8" \`\n  -Body ([Text.Encoding]::UTF8.GetBytes($cuerpo))`],
      ['curl: darle un archivo para leer',
        (tk) => `curl -X POST ${base}/api/aprender ^\n  -H "X-Rubenchuelo-Token: ${tk}" ^\n  -H "Content-Type: text/plain; charset=utf-8" ^\n  --data-binary @libro.txt`],
      ['Python: hablarle y darle textos',
        (tk) => `import json, urllib.request\n\nURL = "${base}"\nTOKEN = "${tk}"\n\ndef rubenchuelo(ruta, datos):\n    peticion = urllib.request.Request(URL + ruta, data=json.dumps(datos).encode("utf-8"),\n        headers={"Content-Type": "application/json", "X-Rubenchuelo-Token": TOKEN})\n    with urllib.request.urlopen(peticion) as r:\n        return json.load(r)\n\nprint(rubenchuelo("/api/mensaje", {"texto": "Hola, Rubenchuelo"})["texto"])\nwith open("libro.txt", encoding="utf-8") as f:\n    rubenchuelo("/api/aprender", {"texto": f.read(), "fuente": "libro.txt"})`],
      ['JavaScript: hablarle',
        (tk) => `const r = await fetch('${base}/api/mensaje', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json', 'X-Rubenchuelo-Token': '${tk}' },\n  body: JSON.stringify({ texto: 'Hola, Rubenchuelo' }),\n});\nconsole.log((await r.json()).texto);`],
    ];
    this.ejemplos.replaceChildren(
      el('h2', { texto: 'Ejemplos listos para copiar' }),
      el('p', { clase: 'explica', texto: '«Copiar» copia el ejemplo con tu token de verdad, aunque aquí esté oculto.' }),
      ...ejemplos.flatMap(([titulo, f]) => [
        el('div', { clase: 'codigo-titulo' }, titulo, el('button', { clase: 'mini', type: 'button', onclick: () => copiar(f(real)) }, 'Copiar')),
        el('pre', { clase: 'codigo' }, f(t)),
      ]));
  }

  async _nuevoToken() {
    const ok = await confirmar('Cambiar el token', 'Las aplicaciones que usen el token de ahora dejarán de poder conectarse hasta que les pongas el nuevo. Esta página se recargará.', { aceptar: 'Cambiar token', peligro: true });
    if (!ok) return;
    try {
      await api('/api/token', { metodo: 'POST' });
      this.alNuevoToken();
    } catch (e) { avisar(e.message, 'error'); }
  }

  _pintarBandeja() {
    const lista = [...this.lecturas.values()].sort((a, b) => b.recibido - a.recibido).slice(0, 12);
    if (!lista.length) { this.bandeja.replaceChildren(el('li', { clase: 'detalle' }, 'Vacía.')); return; }
    const estados = { en_cola: 'esperando', leyendo: 'leyendo', en_pausa: 'en pausa (duerme)', terminada: 'leída', cancelada: 'cancelada', error: 'con error' };
    this.bandeja.replaceChildren(...lista.map((t) => el('li', {},
      el('div', { clase: 'lista-cabeza' }, el('strong', {}, t.fuente), el('span', { clase: 'detalle' }, `${estados[t.estado] || t.estado}, ${pct(t.progreso)}`)),
      el('div', { clase: 'detalle' }, `${num(t.palabras || t.palabrasAprox)} palabras${t.palabras ? `, ${num(t.nuevas)} nuevas, ${num(t.conceptos)} conceptos` : ''}, llegó ${hace(t.recibido)}`),
      ['en_cola', 'leyendo', 'en_pausa'].includes(t.estado)
        ? el('div', { clase: 'fila-botones' }, el('button', { clase: 'boton boton-sobrio boton-pequeno', type: 'button', onclick: () => api(`/api/lecturas/${encodeURIComponent(t.id)}`, { metodo: 'DELETE' }).catch((e) => avisar(e.message, 'error')) }, 'Cancelar'))
        : null)));
  }

  _pintarExterna() {
    if (!this.actividad.length) { this.externa.replaceChildren(el('li', { clase: 'detalle' }, 'Ninguna aplicación se ha conectado todavía.')); return; }
    const nombres = { mensaje: 'Le habló', aprender: 'Le dio un texto', dormir: 'Lo mandó a dormir' };
    this.externa.replaceChildren(...this.actividad.map((a) => el('li', {},
      el('div', { clase: 'lista-cabeza' }, el('strong', {}, nombres[a.accion] || a.accion), el('span', { clase: 'detalle' }, hace(a.cuando))),
      el('div', { clase: 'detalle' }, a.detalle))));
  }
}
