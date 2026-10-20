// Arranque de la interfaz: une el mapa, la charla, los paneles y los eventos en directo.

import { api, apiBinario, escuchar } from './api.js';
import { Mapa } from './mapa.js';
import { leerMapa, leerPosiciones } from './formato-mapa.js';
import { Charla } from './charla.js';
import { Inspector } from './inspector.js';
import { BarraOido } from './oido.js';
import { PanelSuenos, PanelAjustes, PanelCerebros, PanelConexiones } from './paneles.js';
import { el, glifo, num, pct, hace, TIPOS, avisar, confirmar } from './util.js';

const $ = (id) => document.getElementById(id);
const NOMBRES_FASE = { dormirse: 'quedándose dormido', nrem: 'fase profunda', rem: 'fase REM', poda: 'podando' };

let ajustes = null;
let ultimoEstado = null;
let saliendo = false;
let suenosSinVer = 0;

// La ventana propia que abre Rubenchuelo.exe lleva ?ventana=1.
const enVentana = new URLSearchParams(location.search).has('ventana');
let optimizadoGuardado = true;
try { optimizadoGuardado = localStorage.getItem('rubenchuelo.mapaOptimizado') !== '0'; } catch { /* sin almacenamiento */ }
const mapa = new Mapa($('lienzo'), {
  rotulo: $('rotulo'),
  alSeleccionar: (id) => inspector.abrir(id),
  optimizado: optimizadoGuardado,
});
const inspector = new Inspector($('inspector'), { mapa });
const charla = new Charla({ mapa, maxTextoMB: () => (ajustes ? ajustes.app.maxTextoMB : 50) });
const panelSuenos = new PanelSuenos($('vista-suenos'), {
  alNuevos: (n) => { suenosSinVer += n; pintarContadorSuenos(); },
});
const panelAjustes = new PanelAjustes($('vista-ajustes'), { alCambiar: (d) => { ajustes = d; } });
const oido = new BarraOido();
const panelCerebros = new PanelCerebros($('vista-cerebros'));
const panelConexiones = new PanelConexiones($('vista-conexiones'), { alNuevoToken: () => location.reload() });

// Para curiosear desde la consola del navegador (F12): rubenchuelo.mapa, rubenchuelo.api…
window.rubenchuelo = { mapa, charla, inspector, api };

// ───────────── pestañas ─────────────

const pestanas = [...document.querySelectorAll('.pestanas [role="tab"]')];

function mostrarPestana(nombre) {
  if (!pestanas.some((b) => b.dataset.pestana === nombre)) nombre = 'charla';
  for (const b of pestanas) {
    const si = b.dataset.pestana === nombre;
    b.setAttribute('aria-selected', si ? 'true' : 'false');
    b.tabIndex = si ? 0 : -1;
    $(`vista-${b.dataset.pestana}`).hidden = !si;
  }
  if (nombre === 'suenos') { suenosSinVer = 0; pintarContadorSuenos(); if (ultimoEstado) panelSuenos.ponerEstado(ultimoEstado); }
  if (nombre === 'ajustes') panelAjustes.cargar();
  if (nombre === 'cerebros') panelCerebros.cargar();
  if (nombre === 'conexiones') panelConexiones.cargar();
  if (nombre === 'charla') $('entrada').focus({ preventScroll: true });
  try { localStorage.setItem('rubenchuelo.pestana', nombre); } catch { /* sin almacenamiento */ }
}

for (const b of pestanas) b.addEventListener('click', () => mostrarPestana(b.dataset.pestana));
document.querySelector('.pestanas').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const i = pestanas.findIndex((b) => b.getAttribute('aria-selected') === 'true');
  const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + pestanas.length) % pestanas.length;
  mostrarPestana(pestanas[j].dataset.pestana);
  pestanas[j].focus();
});

function pintarContadorSuenos() {
  $('contadorSuenos').textContent = suenosSinVer ? ` ${suenosSinVer}` : '';
}

// ───────────── herramientas del mapa ─────────────

const cuentas = [];
for (const t of [0, 1, 2, 3, 4]) {
  const tipo = TIPOS[t];
  const n = el('span', { clase: 'num' }, '0');
  const chip = el('button', { clase: 'chip vidrio', type: 'button', 'aria-pressed': 'true', title: `Mostrar u ocultar: ${tipo.plural.toLocaleLowerCase('es')}` }, glifo(t), tipo.plural, n);
  chip.addEventListener('click', () => {
    const si = chip.getAttribute('aria-pressed') !== 'true';
    chip.setAttribute('aria-pressed', si ? 'true' : 'false');
    mapa.ponerVisible(t, si);
  });
  cuentas.push([t, n]);
  $('filtros').append(chip);
}

function pintarCuentas() {
  const c = mapa.contar();
  for (const [t, n] of cuentas) n.textContent = num(t === 4 ? c[4] + c[5] : c[t]);
}

$('btnEtiquetas').addEventListener('click', (e) => {
  const si = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', si ? 'true' : 'false');
  mapa.etiquetas = si;
  mapa.sucio = true;
});
$('btnEncajar').addEventListener('click', () => mapa.encajar());

// Optimizado: dibuja con la tarjeta gráfica. Apagado, vuelve al dibujo clásico.
const btnOptimizado = $('btnOptimizado');
function pintarOptimizado() {
  btnOptimizado.setAttribute('aria-pressed', mapa.optimizado ? 'true' : 'false');
}
btnOptimizado.addEventListener('click', () => {
  const quiere = !mapa.optimizado;
  const queda = mapa.ponerOptimizado(quiere);
  if (quiere && !queda) avisar('Este navegador no deja usar la tarjeta gráfica (WebGL 2): sigue el dibujo clásico.', 'error');
  try { localStorage.setItem('rubenchuelo.mapaOptimizado', queda ? '1' : '0'); } catch { /* sin almacenamiento */ }
  pintarOptimizado();
  pedirMapa(true);
});
mapa.alFallarOptimizado = () => {
  pintarOptimizado();
  avisar('La tarjeta gráfica ha fallado: el mapa vuelve al dibujo clásico.', 'error');
};
pintarOptimizado();
$('rangoPeso').addEventListener('input', (e) => {
  mapa.pesoMin = Number(e.target.value);
  $('valorPeso').textContent = mapa.pesoMin.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  mapa.sucio = true;
});

// Buscador de palabras.
const buscar = $('buscar');
const sugerencias = $('sugerencias');
let opciones = [];
let activa = -1;
function pintarSugerencias() {
  if (!opciones.length) { sugerencias.hidden = true; return; }
  sugerencias.replaceChildren(...opciones.map((n, i) => el('li', {},
    el('button', { type: 'button', clase: i === activa ? 'activa' : '', onmousedown: (e) => { e.preventDefault(); elegir(n); } }, glifo(n.t), n.l))));
  sugerencias.hidden = false;
}
function elegir(n) {
  if (!n) return;
  mapa.seleccionar(n.id, { centrar: true });
  buscar.value = n.l;
  sugerencias.hidden = true;
}
buscar.addEventListener('input', () => { opciones = mapa.buscar(buscar.value); activa = opciones.length ? 0 : -1; pintarSugerencias(); });
buscar.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!opciones.length) return;
    activa = (activa + (e.key === 'ArrowDown' ? 1 : -1) + opciones.length) % opciones.length;
    pintarSugerencias();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (opciones[activa]) elegir(opciones[activa]);
    else if (buscar.value.trim()) avisar(`No conoce «${buscar.value.trim()}»`);
  } else if (e.key === 'Escape') {
    sugerencias.hidden = true;
  }
});
buscar.addEventListener('blur', () => setTimeout(() => { sugerencias.hidden = true; }, 150));

// ───────────── refresco del mapa ─────────────

// El mapa completo (neuronas, conexiones y nombres) se pide cuando nacen o
// mueren neuronas, sin agobiar; entre medias, con el optimizado, solo las
// posiciones, que pesan muy poco. Las neuronas nuevas llegan antes por los
// eventos en directo.
let mapaOcupado = false;
let mapaTemporizador = null;
let ultimoMapa = 0;
let ultimasPosiciones = 0;

function pedirMapa(inmediato = false) {
  if (mapaTemporizador) {
    if (!inmediato) return;
    clearTimeout(mapaTemporizador);
  }
  const n = mapa.nodos.size;
  const pausa = mapa.optimizado ? 4000 + n / 2 : 2500 + Math.min(10000, n / 4);
  const espera = inmediato ? 0 : Math.max(0, ultimoMapa + pausa - performance.now());
  mapaTemporizador = setTimeout(async () => {
    mapaTemporizador = null;
    if (mapaOcupado) { pedirMapa(); return; }
    mapaOcupado = true;
    try {
      mapa.cargar(leerMapa(await apiBinario('/api/mapa?formato=bin')));
      pintarCuentas();
    } catch (e) {
      console.warn('No se pudo cargar el mapa:', e.message);
    } finally {
      mapaOcupado = false;
      ultimoMapa = ultimasPosiciones = performance.now();
    }
  }, espera);
}

async function pedirPosiciones() {
  if (mapaOcupado || !mapa.optimizado || mapa.version === null) return;
  if (performance.now() - ultimasPosiciones < 2500 + mapa.nodos.size / 12) return;
  mapaOcupado = true;
  try {
    mapa.mover(leerPosiciones(await apiBinario('/api/mapa/posiciones')));
  } catch (e) {
    console.warn('No se pudieron cargar las posiciones:', e.message);
  } finally {
    mapaOcupado = false;
    ultimasPosiciones = performance.now();
  }
}

let inspectorTemporizador = null;
function refrescarInspectorPronto() {
  clearTimeout(inspectorTemporizador);
  inspectorTemporizador = setTimeout(() => inspector.refrescar(), 700);
}

// ───────────── barra superior ─────────────

function pintarMedidor(id, fraccion, texto, { centro = false } = {}) {
  const m = $(id);
  const relleno = m.querySelector('.relleno');
  if (centro) {
    const f = Math.max(-1, Math.min(1, fraccion));
    relleno.style.left = `${f >= 0 ? 50 : 50 + f * 50}%`;
    relleno.style.width = `${Math.abs(f) * 50}%`;
    relleno.classList.toggle('negativa', f < 0);
  } else {
    relleno.style.width = `${Math.round(Math.max(0, Math.min(1, fraccion)) * 100)}%`;
  }
  m.querySelector('.valor').textContent = texto;
}

function pintarEstado(e) {
  if (!e || e.cargando) return;
  ultimoEstado = e;
  const dormido = !e.despierto;
  document.body.classList.toggle('dormido', dormido);
  mapa.modoNoche(dormido);
  document.title = dormido ? 'Rubenchuelo (durmiendo)' : 'Rubenchuelo';
  $('cerebroActivo').textContent = e.cerebro;

  let clave = 'despierto';
  let texto = 'Despierto';
  if (dormido) { clave = 'durmiendo'; texto = `Durmiendo, ${NOMBRES_FASE[e.sueno.fase] || ''}`; }
  else if (e.aturdido) { clave = 'aturdido'; texto = 'Aturdido'; }
  else if (e.lecturas.some((t) => t.estado === 'leyendo')) { clave = 'leyendo'; texto = 'Leyendo'; }
  else if (e.presion >= 1) { texto = 'Agotado'; }
  $('estado').dataset.estado = clave;
  $('estadoTexto').textContent = texto;

  pintarMedidor('medPresion', e.presion, pct(e.presion));
  $('medPresion').classList.toggle('agotado', e.presion >= 1);
  const d = e.dopamina;
  pintarMedidor('medDopamina', d, `${d > 0.005 ? '+' : ''}${d.toLocaleString('es-ES', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`, { centro: true });
  pintarMedidor('medSorpresa', e.sorpresa, pct(e.sorpresa));

  const b = $('btnDormir');
  b.textContent = dormido ? 'Despertar' : 'Dormir';
  b.className = `boton ${dormido ? 'boton-sobrio' : 'boton-noche'}`;

  const r = e.resumen;
  const c = r.contadores;
  $('mapaPie').replaceChildren(...[
    el('div', {}, `${num(r.tipos.palabra)} palabras, ${num(r.tipos.concepto)} conceptos, ${num(r.celdasHipocampo)} de ${num(r.capacidadHipocampo)} células en el hipocampo, ${num(r.tipos.inhib)} inhibidoras y ${num(r.sinapsis)} conexiones.`),
    el('div', {}, `Nació ${hace(r.creado)}. Ha oído ${num(c.palabrasOidas + c.palabrasLeidas)} palabras y ha dormido ${num(c.suenos)} ${c.suenos === 1 ? 'vez' : 'veces'}. `
      + (e.guardado.pendiente ? 'Hay cambios sin guardar.' : `Guardado ${hace(e.guardado.ultimo)}.`)),
    e.enMente && e.enMente.length
      ? el('div', {}, `Tiene en mente: ${e.enMente.slice(0, 5).map(([, etiqueta]) => etiqueta).join(', ')}.`)
      : null,
  ].filter(Boolean));

  mapa.ponerEnMente((e.enMente || []).map(([id]) => id));
  oido.poner(e.oido, { dormido });
  panelSuenos.ponerEstado(e);
  if (e.version !== mapa.version) pedirMapa();
  if (e.posiciones !== mapa.epoca) pedirPosiciones();
}

$('btnDormir').addEventListener('click', async () => {
  try {
    if (ultimoEstado && !ultimoEstado.despierto) await api('/api/despertar', { metodo: 'POST' });
    else await api('/api/dormir', { metodo: 'POST', cuerpo: {} });
  } catch (e) {
    avisar(e.message, 'error');
  }
});

$('btnSalir').addEventListener('click', async () => {
  const ok = await confirmar('Guardar y salir', 'Se guardará todo lo que sabe y se cerrará Rubenchuelo. Para volver a abrirlo, haz doble clic en Rubenchuelo.', { aceptar: 'Guardar y salir' });
  if (!ok) return;
  saliendo = true;
  try { await api('/api/salir', { metodo: 'POST' }); } catch { /* ya se estaba cerrando */ }
  eventos.cerrar();
  document.body.append(el('div', { clase: 'despedida' },
    el('div', {}, el('span', { clase: 'nombre' }, 'Rubenchuelo'),
      el('p', {}, 'Guardado. Se ha ido a dormir a casa.'),
      el('p', {}, enVentana ? 'La ventana se cerrará sola.' : 'Ya puedes cerrar esta pestaña y quitar el pendrive.'))));
  if (enVentana) setTimeout(() => window.close(), 1200);
});

// ───────────── eventos en directo ─────────────

async function recargarTodo() {
  try {
    const [chat, estado] = await Promise.all([api('/api/chat'), api('/api/estado')]);
    charla.cargar(chat.chat);
    pintarEstado(estado);
    pedirMapa(true);
    panelSuenos.cargar();
    panelAjustes.cargar();
    if (!$('vista-cerebros').hidden) panelCerebros.cargar();
    if (!$('vista-conexiones').hidden) panelConexiones.cargar();
    for (const t of estado.lecturas) charla.lectura(t);
  } catch (e) {
    avisar(e.message, 'error');
  }
}

const eventos = escuchar({
  estado: pintarEstado,
  neuronas: (d) => { mapa.nacer(d.nacidas); mapa.morir(d.muertas); pintarCuentas(); },
  pensamiento: (p) => mapa.animar(p),
  chat: (e) => { charla.agregar(e); if (e.de === 'rubenchuelo') refrescarInspectorPronto(); },
  chat_valor: (v) => charla.valor(v),
  sueno: (s) => {
    if (!ultimoEstado || !s) return;
    pintarEstado({ ...ultimoEstado, despierto: !s.durmiendo, sueno: s });
  },
  sueno_texto: (s) => panelSuenos.nuevoSueno(s),
  informe: (i) => { panelSuenos.informe(i); refrescarInspectorPronto(); },
  lectura: (t) => { charla.lectura(t); panelConexiones.lectura(t); },
  externo: (x) => panelConexiones.externo(x),
  oido: (m) => oido.evento(m),
  cerebro: () => { inspector.cerrar(false); mapa.vaciar(); recargarTodo(); },
}, {
  alAbrir: (reconexion) => { $('avisoConexion').hidden = true; if (reconexion) recargarTodo(); },
  alPerder: () => { if (!saliendo) $('avisoConexion').hidden = false; },
});

let inicial = 'charla';
try { inicial = localStorage.getItem('rubenchuelo.pestana') || 'charla'; } catch { /* sin almacenamiento */ }
mostrarPestana(inicial);
recargarTodo();
