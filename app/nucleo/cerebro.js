'use strict';
/*
 * El cerebro de Rubenchuelo.
 *
 * Todo lo que sabe está en neuronas y en el peso de sus conexiones. No guarda
 * frases ni conversaciones: las palabras solo existen como neuronas de
 * "oído/boca", y lo que sabe de ellas (qué va con qué) son pesos.
 *
 * Neuronas:
 *   palabra    sensoriales; nacen al oír una palabra nueva.
 *   concepto   corteza; agrupan palabras que suelen ir juntas. Nacen con la sorpresa.
 *   hipo       hipocampo; cada frase deja una cadena rápida de "células de tiempo".
 *   inhib      interneuronas inhibidoras; frenan a su grupo.
 *   inicio/fin dónde empiezan y acaban las frases.
 *
 * Conexiones:
 *   sec        palabra→palabra en orden (qué suele venir después).
 *   asoc       palabra↔palabra (aparecen cerca, o suenan parecido).
 *   miembro    concepto↔palabra.
 *   cadena     célula→célula dentro de un recuerdo del hipocampo, y célula→palabra.
 */

const { trocearFrases, raiz, INTERROGATIVOS } = require('./texto');
const D = require('./disposicion');

const UMBRAL_DISPARO = 0.12;
const UMBRAL_CONCEPTO = 0.3;   // un concepto solo se enciende si reconoce buena parte de su patrón
const FUGA = 0.55;
const G_ASOC = 0.6;
const G_PAL_CONC = 0.7;
const G_CONC_PAL = 0.8;
const G_PAL_HIPO = 0.8;
const G_HIPO_HIPO = 0.55;
const G_HIPO_PAL = 0.6;
const G_INHIB = 0.45;
const MAX_ACTIVAS = 220;
const MAX_SALIDAS_ASOC = 16;             // al pensar, una palabra muy conectada solo empuja a sus 16 asociaciones más suyas
const MAX_SALIDAS_CONCEPTOS = 8;         // …y a sus 8 conceptos más fuertes
const TAM_GRUPO_INHIB = 40;
const MAX_MIEMBROS = 24;
const LAMBDA_HIPO = 1.2;
const BETA = 0.2;
const UMBRAL_RESPUESTA = 0.15;
const VIDA_HIPO_MS = 24 * 3600e3;
const HORAS_VIGILIA_MAX = 16;
const MAX_HUELLAS = 60;
const UMBRAL_SABER = 0.08;               // peso mínimo para "saber" algo al deducir
const MAX_ABANICO = 200;                 // vecinos conectados a más palabras que esto no cuentan al agrupar
const MAX_MEMORIA_TRABAJO = 16;          // cosas que caben a la vez en la memoria de trabajo
const VIDA_MEMORIA_TRABAJO_MS = 180000;  // lo que tiene en mente se va a la mitad cada 3 minutos
const COPULAS = new Set(['es', 'son']);
const DETERMINANTES = new Set([
  'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'lo', 'mi', 'mis', 'tu', 'tus', 'su', 'sus',
  'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'nuestro', 'nuestra', 'nuestros', 'nuestras',
]);
// Palabras de relleno: no merece la pena tenerlas en mente ni cuentan como "tema".
const VACIAS = new Set([...DETERMINANTES, ...COPULAS,
  'de', 'del', 'al', 'a', 'en', 'con', 'por', 'para', 'sin', 'sobre', 'entre', 'y', 'e', 'o', 'u', 'ni',
  'que', 'se', 'me', 'te', 'le', 'les', 'nos', 'os', 'ya', 'muy', 'más', 'también', 'pero', 'si', 'como']);

const CODIGOS = { palabra: 0, concepto: 1, hipo: 2, inhib: 3, inicio: 4, fin: 5 };

const lim = (x, a, b) => (x < a ? a : x > b ? b : x);
const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;
const r5 = (x) => Math.round(x * 1e5) / 1e5;
const mayuscula = (s) => (s ? s.charAt(0).toLocaleUpperCase('es') + s.slice(1) : s);

function topK(mapa, k) {
  const lista = [...mapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  return new Map(lista);
}

function ordenarPorPeso(lista, k) {
  return lista.sort((a, b) => b[b.length - 1] - a[a.length - 1]).slice(0, k);
}

// Divisor de la salida según el peso total de las conexiones (normalización heterosináptica).
function reparto(mapa) {
  let s = 0;
  for (const w of mapa.values()) s += w;
  return s > 1 ? Math.pow(s, 0.75) : 1;
}

function coseno(a, b) {
  let p = 0, na = 0, nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    const w = b.get(k);
    if (w) p += v * w;
  }
  for (const v of b.values()) nb += v * v;
  return p / (Math.sqrt(na * nb) + 1e-9);
}

const sinTildes = (s) => s.normalize('NFD').replace(/\p{M}/gu, '');

class Cerebro {
  constructor(ajustes, { azar = Math.random, emitir = () => {}, vacio = false } = {}) {
    this.ajustes = ajustes;
    this.azar = azar;
    this.emitir = emitir;
    this.neuronas = new Map();
    this.lexico = new Map();      // palabra → id de su neurona
    this.raices = new Map();      // raíz → ids de palabras que suenan parecido
    this.conceptos = new Set();
    this.inhibidoras = new Set();
    this.episodios = new Map();   // recuerdos del hipocampo
    this.sigId = 1;
    this.sigEpisodio = 1;
    this.creado = Date.now();
    this.estado = {
      presion: 0,          // presión de sueño (adenosina), 1 = agotado
      dopamina: 0,         // -1..1
      sorpresa: 0,         // del último mensaje
      msDespierto: 0,
      aturdidoHasta: 0,
      bostezoPendiente: false,
    };
    this.contadores = {
      palabrasOidas: 0, mensajes: 0, suenos: 0, textosLeidos: 0, palabrasLeidas: 0,
      nacimientos: 0, muertes: 0, olvidados: 0, premios: 0, castigos: 0,
      deducciones: 0, categorias: 0,
    };
    // Memoria de trabajo: lo que tiene en mente ahora (solo en RAM; se va solo y al dormir).
    this.memoriaTrabajo = new Map();
    this._mtTiempo = Date.now();
    this.version = 0;             // cambia al nacer o morir neuronas
    this.sucio = false;           // hay cambios sin guardar
    this.huellas = new Map();     // huellas de elegibilidad de las últimas respuestas (solo RAM)
    this.sigRespuesta = 1;
    this._nacidas = [];
    this._muertas = [];
    this._abiertas = {};          // inhibidora con sitio por región
    if (!vacio) {
      this.inicio = this._crear('inicio', { etiqueta: 'inicio de frase', ...D.posicionInicio() }).id;
      this.fin = this._crear('fin', { etiqueta: 'fin de frase', ...D.posicionFin() }).id;
    }
  }

  // ───────────────────────── nacimiento y muerte ─────────────────────────

  _crear(tipo, props = {}) {
    const n = { id: this.sigId++, tipo, x: 0, y: 0, nacida: Date.now(), disparos: 0, inh: null, ...props };
    if (tipo === 'palabra' || tipo === 'inicio' || tipo === 'fin') { n.sec = new Map(); n.secIn = new Map(); }
    if (tipo === 'palabra') {
      n.asoc = new Map(); n.conceptos = new Map(); n.hipos = new Set();
      n.frec = 0; n.mayus = 0; n.medio = 0;
    }
    if (tipo === 'concepto') { n.miembros = new Map(); n.usos = 0; this.conceptos.add(n.id); }
    if (tipo === 'inhib') { n.grupo = new Set(); this.inhibidoras.add(n.id); }
    this.neuronas.set(n.id, n);
    this.version++;
    this.contadores.nacimientos++;
    this._nacidas.push(n.id);
    this.sucio = true;
    return n;
  }

  _matar(id) {
    const n = this.neuronas.get(id);
    if (!n) return;
    if (n.tipo === 'palabra') {
      for (const b of n.sec.keys()) this.neuronas.get(b)?.secIn.delete(id);
      for (const a of n.secIn.keys()) this.neuronas.get(a)?.sec.delete(id);
      for (const b of n.asoc.keys()) this.neuronas.get(b)?.asoc.delete(id);
      for (const c of n.conceptos.keys()) this.neuronas.get(c)?.miembros.delete(id);
      this.lexico.delete(n.texto);
      const r = raiz(n.texto);
      if (r) this.raices.get(r)?.delete(id);
    } else if (n.tipo === 'concepto') {
      for (const w of n.miembros.keys()) this.neuronas.get(w)?.conceptos.delete(id);
      this.conceptos.delete(id);
    } else if (n.tipo === 'hipo') {
      this.neuronas.get(n.palabra)?.hipos.delete(id);
    } else if (n.tipo === 'inhib') {
      for (const m of n.grupo) { const mm = this.neuronas.get(m); if (mm) mm.inh = null; }
      this.inhibidoras.delete(id);
    }
    if (n.inh) this.neuronas.get(n.inh)?.grupo.delete(id);
    this.neuronas.delete(id);
    this._muertas.push(id);
    this.version++;
    this.contadores.muertes++;
    this.sucio = true;
  }

  _palabra(p, alInicio, anterior) {
    let n = this.neuronas.get(this.lexico.get(p.norma));
    let nueva = false;
    if (!n) {
      n = this._crear('palabra', { texto: p.norma, ...D.posicionCerca(anterior, this.azar) });
      this.lexico.set(p.norma, n.id);
      const r = raiz(p.norma);
      if (r) {
        let grupo = this.raices.get(r);
        if (!grupo) this.raices.set(r, (grupo = new Set()));
        for (const otra of grupo) this._reforzarAsoc(n.id, otra, 0.35);  // suenan parecido
        grupo.add(n.id);
      }
      this._asignarInhibidora(n, 'corteza', anterior);
      nueva = true;
    }
    n.frec++;
    if (!alInicio) {
      n.medio++;
      if (p.original[0] !== p.norma[0]) n.mayus++;
    }
    return { n, nueva };
  }

  // Cada neurona excitadora pertenece al grupo de una inhibidora (unas 40 por grupo).
  _asignarInhibidora(n, region, vecino) {
    let inh = null;
    if (vecino && vecino.inh) {
      const c = this.neuronas.get(vecino.inh);
      if (c && c.region === region && c.grupo.size < TAM_GRUPO_INHIB) inh = c;
    }
    if (!inh) {
      const abierta = this.neuronas.get(this._abiertas[region]);
      if (abierta && abierta.grupo.size < TAM_GRUPO_INHIB) inh = abierta;
    }
    if (!inh) {
      inh = this._crear('inhib', {
        region,
        x: n.x + (this.azar() - 0.5) * 30,
        y: n.y + (this.azar() - 0.5) * 30,
      });
      this._abiertas[region] = inh.id;
    }
    inh.grupo.add(n.id);
    n.inh = inh.id;
  }

  _limpiarInhibidoras() {
    let n = 0;
    for (const id of [...this.inhibidoras]) {
      if (!this.neuronas.get(id).grupo.size) { this._matar(id); n++; }
    }
    return n;
  }

  // ───────────────────────────── sinapsis ─────────────────────────────

  _reforzarSec(a, b, eta) {
    if (a === b) return 0;
    const na = this.neuronas.get(a), nb = this.neuronas.get(b);
    if (!na || !nb || !na.sec || !nb.secIn) return 0;
    const w = na.sec.get(b) || 0;
    const nw = w + eta * (1 - w);
    na.sec.set(b, nw);
    nb.secIn.set(a, nw);
    return nw;
  }

  _debilitarSec(a, b, factor) {
    const na = this.neuronas.get(a), nb = this.neuronas.get(b);
    const w = na && na.sec ? na.sec.get(b) : undefined;
    if (w === undefined) return false;
    na.sec.set(b, w * factor);
    nb.secIn.set(a, w * factor);
    return true;
  }

  _reforzarAsoc(a, b, eta) {
    if (a === b) return 0;
    const na = this.neuronas.get(a), nb = this.neuronas.get(b);
    if (!na || !nb || !na.asoc || !nb.asoc) return 0;
    const w = na.asoc.get(b) || 0;
    const nw = w + eta * (1 - w);
    na.asoc.set(b, nw);
    nb.asoc.set(a, nw);
    return nw;
  }

  _debilitarAsoc(a, b, factor) {
    const na = this.neuronas.get(a), nb = this.neuronas.get(b);
    const w = na && na.asoc ? na.asoc.get(b) : undefined;
    if (w === undefined) return false;
    na.asoc.set(b, w * factor);
    nb.asoc.set(a, w * factor);
    return true;
  }

  _fijarMiembro(c, w, m) {
    c.miembros.set(w, m);
    this.neuronas.get(w).conceptos.set(c.id, m);
  }

  _quitarMiembro(c, w) {
    c.miembros.delete(w);
    this.neuronas.get(w)?.conceptos.delete(c.id);
  }

  // ─────────────────────────── moduladores ───────────────────────────

  // Las palabras muy oídas se "habitúan": responden y enseñan menos.
  _habituacion(n) {
    return 1 / (1 + Math.log(1 + (n.frec || 0) / 8));
  }

  _viveza(ep) {
    return Math.max(0.15, Math.exp(-(Date.now() - ep.creado) / VIDA_HIPO_MS));
  }

  _cansancio() {
    return lim((this.estado.presion - 0.8) / 0.7, 0, 1);
  }

  _modulacion(sorpresa, lectura = false) {
    const novedad = 0.5 + sorpresa;                              // noradrenalina
    const premio = 1 + 0.5 * Math.max(0, this.estado.dopamina);  // dopamina
    // Con mucho sueño aprende peor charlando. Al leer un texto largo no se le
    // aplica (si no, la segunda mitad de un libro casi no contaría): lo que
    // hace leer es darle mucho sueño.
    const p = this.estado.presion;
    const cansancio = lectura || p <= 0.8 ? 1 : Math.max(0.4, 1 - (p - 0.8) * 0.6);
    return novedad * premio * cansancio;
  }

  _cansar(x) {
    this.estado.presion = Math.min(3, this.estado.presion + x);
  }

  pasarTiempo(ms, despierto = true) {
    if (despierto) {
      this.estado.msDespierto += ms;
      this._cansar(ms / (HORAS_VIGILIA_MAX * 3600e3));
    }
    this.estado.dopamina *= Math.pow(0.5, ms / 300000);
    if (Math.abs(this.estado.dopamina) < 0.001) this.estado.dopamina = 0;
  }

  // ───────────────────────────── aprender ─────────────────────────────

  _vectorFrase(ids) {
    const v = new Map();
    for (const id of ids) v.set(id, this._habituacion(this.neuronas.get(id)));
    return v;
  }

  _mejorConcepto(vec) {
    const orden = [...vec.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const candidatos = new Set();
    for (const [id] of orden) for (const c of this.neuronas.get(id).conceptos.keys()) candidatos.add(c);
    if (!candidatos.size) return null;
    let normaV = 0;
    for (const g of vec.values()) normaV += g * g;
    normaV = Math.sqrt(normaV);
    let mejor = null;
    for (const cid of candidatos) {
      const c = this.neuronas.get(cid);
      if (c.categoria) continue;   // las categorías agrupan palabras, no frases
      let punto = 0, normaC = 0;
      for (const [w, m] of c.miembros) {
        normaC += m * m;
        const g = vec.get(w);
        if (g) punto += m * g;
      }
      const parecido = punto / (normaV * Math.sqrt(normaC) + 1e-9);
      if (!mejor || parecido > mejor.parecido) mejor = { concepto: c, parecido };
    }
    return mejor;
  }

  _aprenderSecuencia(ids, eta) {
    if (!ids.length) return;
    const v = this.ajustes.aprendizaje.ventanaAsociacion;
    this._reforzarSec(this.inicio, ids[0], eta);
    for (let i = 0; i < ids.length; i++) {
      if (i + 1 < ids.length) this._reforzarSec(ids[i], ids[i + 1], eta);
    }
    this._reforzarSec(ids[ids.length - 1], this.fin, eta);
    this._asociar(ids, eta);
    this.sucio = true;
  }

  // Hebb: las palabras que aparecen cerca se conectan (más cuanto más cerca).
  _asociar(ids, eta) {
    const v = this.ajustes.aprendizaje.ventanaAsociacion;
    for (let i = 0; i < ids.length; i++) {
      for (let d = 1; d <= v && i + d < ids.length; d++) this._reforzarAsoc(ids[i], ids[i + d], eta / Math.sqrt(d));
    }
  }

  // Teoría de resonancia adaptativa (ART): si la frase se parece lo bastante a
  // un concepto, el concepto la aprende (se generaliza); si no, sorpresa → nace
  // un concepto nuevo.
  _aprenderConcepto(ids, eta, permitirCrear, encaje) {
    const vec = this._vectorFrase(ids);
    if (vec.size < 2) return null;
    if (encaje === undefined) encaje = this._mejorConcepto(vec);
    const vig = this.ajustes.aprendizaje.vigilancia;
    if (encaje && encaje.parecido >= vig) {
      const c = encaje.concepto;
      for (const [w, g] of vec) {
        const m = c.miembros.get(w) || 0;
        this._fijarMiembro(c, w, m + eta * (g - m));
      }
      for (const [w, m] of c.miembros) if (!vec.has(w)) this._fijarMiembro(c, w, m * (1 - eta * 0.1));
      c.usos++;
      if (c.miembros.size > MAX_MIEMBROS) {
        const sobran = [...c.miembros].sort((a, b) => a[1] - b[1]).slice(0, c.miembros.size - MAX_MIEMBROS);
        for (const [w] of sobran) this._quitarMiembro(c, w);
      }
      return { concepto: c.id, nuevo: false, parecido: encaje.parecido };
    }
    if (!permitirCrear) return null;
    const c = this._crear('concepto', D.posicionConcepto(this, [...vec.keys()], this.azar));
    for (const [w, g] of vec) this._fijarMiembro(c, w, Math.max(0.08, g * 0.25));
    c.usos = 1;
    this._asignarInhibidora(c, 'conceptos');
    return { concepto: c.id, nuevo: true, parecido: encaje ? encaje.parecido : 0 };
  }

  _crearEpisodio(ids, sorpresa) {
    this._liberarHipocampo(ids.length);
    const ep = {
      id: this.sigEpisodio++,
      celdas: [],
      creado: Date.now(),
      sorpresa,
      importancia: lim(0.3 + 0.5 * sorpresa, 0, 1),
      repasos: 0,
      planeados: 0,
      consolidado: false,
    };
    let anterior = null;
    for (let i = 0; i < ids.length; i++) {
      const c = this._crear('hipo', { episodio: ep.id, pos: i, palabra: ids[i] });
      this.neuronas.get(ids[i]).hipos.add(c.id);
      ep.celdas.push(c.id);
      this._asignarInhibidora(c, 'hipo', anterior);
      anterior = c;
    }
    this.episodios.set(ep.id, ep);
    D.colocarHipocampo(this);
    return ep;
  }

  // Si no cabe un recuerdo nuevo, se olvida lo más viejo y menos importante.
  _liberarHipocampo(necesarias) {
    const cap = this.ajustes.aprendizaje.capacidadHipocampo;
    let usadas = 0;
    for (const ep of this.episodios.values()) usadas += ep.celdas.length;
    if (usadas + necesarias <= cap) return 0;
    const orden = [...this.episodios.values()]
      .sort((a, b) => a.importancia * this._viveza(a) - b.importancia * this._viveza(b));
    let olvidados = 0;
    for (const ep of orden) {
      if (usadas + necesarias <= cap) break;
      usadas -= ep.celdas.length;
      this._olvidarEpisodio(ep);
      olvidados++;
    }
    this.contadores.olvidados += olvidados;
    this._limpiarInhibidoras();
    return olvidados;
  }

  _olvidarEpisodio(ep) {
    for (const c of ep.celdas) this._matar(c);
    this.episodios.delete(ep.id);
  }

  _aprenderFrase({ palabras, pregunta }, modo, { permitirConcepto = true, contar = true } = {}) {
    const aj = this.ajustes.aprendizaje;
    const ids = [];
    const nuevas = [];
    let anterior = null;
    for (let i = 0; i < palabras.length; i++) {
      const { n, nueva } = this._palabra(palabras[i], i === 0, anterior);
      ids.push(n.id);
      if (nueva) nuevas.push(n.id);
      anterior = n;
    }
    if (contar) this.contadores.palabrasOidas += ids.length;
    const vec = this._vectorFrase(ids);
    const encaje = this._mejorConcepto(vec);
    const fraccionNuevas = nuevas.length / ids.length;
    const sorpresa = lim(Math.max(fraccionNuevas, 1 - (encaje ? encaje.parecido : 0)), 0, 1);
    const lectura = modo === 'lectura';
    const mod = this._modulacion(sorpresa, lectura);
    const eta = (lectura ? this.ajustes.lectura.velocidad : aj.velocidadCorteza) * mod;

    let concepto = null;
    let episodio = null;
    if (pregunta && !lectura) {
      // Las preguntas no enseñan el orden de las palabras (para que no conteste
      // con preguntas) ni dejan recuerdo: solo asocian un poco lo que nombran.
      this._asociar(ids, eta * 0.3);
    } else {
      this._aprenderSecuencia(ids, eta);
      const crear = permitirConcepto && (lectura ? sorpresa > 0.8 : sorpresa >= 0.5) && ids.length >= 2;
      concepto = this._aprenderConcepto(ids, eta * 1.5, crear, encaje);
      if (!lectura) episodio = this._crearEpisodio(ids, sorpresa);
    }
    const presion = lectura
      ? (ids.length * this.ajustes.lectura.presionPorMilPalabras) / 1000
      : ids.length * 0.0015 + nuevas.length * 0.002;
    this._cansar(presion);
    this.sucio = true;
    return { ids, nuevas, sorpresa, pregunta, episodio, concepto };
  }

  oir(texto, { modo = 'charla' } = {}) {
    const frases = trocearFrases(texto);
    const r = { ids: [], frases: [], nuevas: [], sorpresa: 0, pregunta: false, episodios: [], conceptos: [] };
    for (const f of frases) {
      const a = this._aprenderFrase(f, modo);
      r.frases.push(a.ids);
      for (const id of a.ids) r.ids.push(id);
      for (const id of a.nuevas) r.nuevas.push(id);
      r.sorpresa = Math.max(r.sorpresa, a.sorpresa);
      r.pregunta = a.pregunta;
      if (a.episodio) r.episodios.push(a.episodio.id);
      if (a.concepto) r.conceptos.push(a.concepto);
    }
    if (frases.length) {
      this.estado.sorpresa = r.sorpresa;
      this.contadores.mensajes++;
    }
    return r;
  }

  // Lectura de textos grandes: directo a la corteza, más despacio. Solo las
  // frases más sorprendentes pasan al hipocampo.
  // `repaso`: es otra vuelta a un texto que ya ha leído. Refuerza como leerlo de nuevo
  // (también lo «gastadas» que están sus palabras, que ayuda), pero no suma a los contadores.
  leerFrase(frase, sesion, { repaso = false } = {}) {
    const permitirConcepto = sesion ? sesion.conceptos < 5 + sesion.palabras / 60 : true;
    const r = this._aprenderFrase(frase, 'lectura', { permitirConcepto, contar: !repaso });
    if (!repaso) this.contadores.palabrasLeidas += r.ids.length;
    if (sesion) {
      sesion.palabras += r.ids.length;
      sesion.nuevas += r.nuevas.length;
      if (r.concepto && r.concepto.nuevo) sesion.conceptos++;
      if (!frase.pregunta && r.ids.length >= 4 && r.sorpresa >= 0.75
          && sesion.hipo < this.ajustes.lectura.frasesAlHipocampo) {
        this._crearEpisodio(r.ids, r.sorpresa);
        sesion.hipo++;
      }
    }
    return r;
  }

  // ───────────────────────────── pensar ─────────────────────────────

  // Propaga la actividad unos pasos. Devuelve el contexto (actividad media de
  // cada neurona) y, si `visual`, el registro de disparos para el mapa.
  // `previo`: actividad que ya traía de antes (memoria de trabajo). No se
  // mantiene sola: se apaga en pocos pasos salvo que lo nuevo la refuerce.
  pensar(entradas, { pasos = 8, ruido = 0, inhibicion = 1, excluir = null, visual = true, previo = null } = {}) {
    let act = new Map();
    if (previo) for (const [id, a] of previo) if (this.neuronas.has(id)) act.set(id, Math.min(1, a));
    const suma = new Map();
    const fatiga = new Map();
    const registro = visual ? [] : null;
    const vivezas = new Map();
    const viveza = (epId) => {
      let v = vivezas.get(epId);
      if (v === undefined) {
        const ep = this.episodios.get(epId);
        v = ep ? this._viveza(ep) : 0;
        vivezas.set(epId, v);
      }
      return v;
    };

    for (let t = 0; t < pasos; t++) {
      const externa = new Map();
      const recurrente = new Map();
      const senales = visual ? [] : null;
      const enviar = (de, a, x) => {
        if (x <= 0.002) return;
        recurrente.set(a, (recurrente.get(a) || 0) + x);
        if (senales && x > 0.05) senales.push([de, a, x]);
      };
      const fuerzaEntrada = t < 3 ? 1 : 0.4;
      for (const [id, s] of entradas) externa.set(id, s * fuerzaEntrada);

      const disparan = [];
      for (const [id, a] of act) {
        if (a < UMBRAL_DISPARO) continue;
        const n = this.neuronas.get(id);
        if (!n || (n.tipo === 'concepto' && a < UMBRAL_CONCEPTO)) continue;
        disparan.push([id, a]);
        const f = fatiga.get(id) || 0;
        let salida = a * (1 - f);
        fatiga.set(id, Math.min(0.6, f + 0.08));
        // Cada neurona reparte su salida entre sus conexiones (recursos
        // sinápticos limitados): las palabras "comodín" conectadas a todo
        // empujan poco a cada una.
        switch (n.tipo) {
          case 'palabra': {
            salida *= 0.35 + 0.65 * this._habituacion(n);
            const asoc = this._salidas(n, 'asoc');
            const kA = G_ASOC / reparto(asoc);
            for (const [b, w] of asoc) enviar(id, b, salida * w * kA);
            const kC = G_PAL_CONC / reparto(n.conceptos);
            for (const [c, w] of n.conceptos) enviar(id, c, salida * w * kC);
            for (const h of n.hipos) {
              const cel = this.neuronas.get(h);
              if (!cel || (excluir && excluir.has(cel.episodio))) continue;
              enviar(id, h, salida * G_PAL_HIPO * viveza(cel.episodio));
            }
            break;
          }
          case 'concepto': {
            const kM = G_CONC_PAL / Math.sqrt(Math.max(1, reparto(n.miembros)));
            for (const [w, m] of n.miembros) enviar(id, w, salida * m * kM);
            break;
          }
          case 'hipo': {
            const ep = this.episodios.get(n.episodio);
            if (ep) {
              const ant = ep.celdas[n.pos - 1];
              const sig = ep.celdas[n.pos + 1];
              if (ant) enviar(id, ant, salida * G_HIPO_HIPO);
              if (sig) enviar(id, sig, salida * G_HIPO_HIPO);
            }
            enviar(id, n.palabra, salida * G_HIPO_PAL);
            break;
          }
          default:
            break;
        }
      }
      // Las que no disparan se recuperan de la fatiga.
      for (const [id, f] of fatiga) {
        if ((act.get(id) || 0) >= UMBRAL_DISPARO) continue;
        const nf = f - 0.05;
        if (nf <= 0) fatiga.delete(id); else fatiga.set(id, nf);
      }

      // Inhibición: cada interneurona frena a su grupo según la actividad
      // recurrente que hay en él. Las más fuertes sobreviven.
      const sumaG = new Map();
      const cuentaG = new Map();
      for (const [id, x] of recurrente) {
        const n = this.neuronas.get(id);
        if (!n || !n.inh) continue;
        sumaG.set(n.inh, (sumaG.get(n.inh) || 0) + x);
        cuentaG.set(n.inh, (cuentaG.get(n.inh) || 0) + 1);
      }
      const freno = new Map();
      const inhibDisparan = [];
      for (const [g, s] of sumaG) {
        const media = s / cuentaG.get(g);
        const fr = media * G_INHIB * inhibicion;
        freno.set(g, fr);
        if (visual && media > 0.08) inhibDisparan.push([g, r3(Math.min(1, media))]);
      }

      const nuevo = new Map();
      const tocar = new Set(act.keys());
      for (const id of externa.keys()) tocar.add(id);
      for (const id of recurrente.keys()) tocar.add(id);
      for (const id of tocar) {
        const n = this.neuronas.get(id);
        if (!n) continue;
        let x = (act.get(id) || 0) * FUGA + (externa.get(id) || 0) + (recurrente.get(id) || 0);
        if (n.inh) x -= freno.get(n.inh) || 0;
        if (ruido) x += (this.azar() - 0.5) * ruido;
        if (x <= 0) continue;
        const a = 1 - Math.exp(-1.6 * x);
        if (a > 0.02) nuevo.set(id, a);
      }
      act = nuevo.size > MAX_ACTIVAS ? topK(nuevo, MAX_ACTIVAS) : nuevo;
      if (t > 0) for (const [id, a] of act) suma.set(id, (suma.get(id) || 0) + a);
      for (const [id] of disparan) { const n = this.neuronas.get(id); if (n) n.disparos++; }
      if (registro && disparan.length) {
        registro.push({
          disparos: ordenarPorPeso(disparan, 140).map(([id, a]) => [id, r3(a)]),
          inhib: ordenarPorPeso(inhibDisparan, 30),
          senales: ordenarPorPeso(senales, 70).map(([a, b, x]) => [a, b, r3(x)]),
        });
      }
    }
    const contexto = new Map();
    const div = Math.max(1, pasos - 1);
    for (const [id, s] of suma) contexto.set(id, s / div);
    return { contexto, registro };
  }

  // Con quién habla una palabra al pensar. Si tiene pocas conexiones, con todas.
  // Si tiene muchísimas (en un cerebro que ha leído libros enteros, «Gandalf» va
  // con casi 2.000 palabras), repartir entre todas deja a cada una tan poco que
  // no se enciende nada y la idea se apaga. Entonces solo con las que más le
  // tiran, contando menos las que van con todo («el», «de», «y»…): es lo que
  // tiene de verdad que ver con ella. Se recalcula cada medio minuto.
  _salidas(n, cual) {
    const mapa = n[cual];
    const k = cual === 'asoc' ? MAX_SALIDAS_ASOC : MAX_SALIDAS_CONCEPTOS;
    if (!mapa || mapa.size <= k) return mapa || new Map();
    if (!this._cacheSalidas) this._cacheSalidas = new WeakMap();
    const ahora = Date.now();
    let c = this._cacheSalidas.get(n);
    if (!c) this._cacheSalidas.set(n, (c = {}));
    const hecho = c[cual];
    if (hecho && ahora - hecho.t < 30000) return hecho.mapa;
    const lista = [];
    for (const [b, w] of mapa) {
      const m = this.neuronas.get(b);
      if (!m) continue;
      // Lo bien asentada que está (al cubo: una palabra vista una vez al lado no
      // cuenta como una de toda la vida) y lo poco que va con todo lo demás.
      const grado = cual === 'asoc' ? (m.asoc ? m.asoc.size : 0) : 0;
      lista.push([b, w, (w * w * w) / Math.sqrt(1 + grado / 200)]);
    }
    lista.sort((a, b) => b[2] - a[2]);
    const elegidas = new Map(lista.slice(0, k).map(([b, w]) => [b, w]));
    c[cual] = { t: ahora, mapa: elegidas };
    return elegidas;
  }

  // ───────────────────────────── hablar ─────────────────────────────

  _muestrear(lista, temperatura) {
    if (lista.length === 1) return lista[0];
    if (!temperatura || temperatura < 0.05) {
      let m = lista[0];
      for (const e of lista) if (e[1] > m[1]) m = e;
      return m;
    }
    const pot = lista.map((e) => Math.pow(e[1], 1 / temperatura));
    const total = pot.reduce((s, v) => s + v, 0);
    let r = this.azar() * total;
    for (let i = 0; i < lista.length; i++) {
      r -= pot[i];
      if (r <= 0) return lista[i];
    }
    return lista[lista.length - 1];
  }

  _celdaActiva(id, ctx, excluir) {
    const n = this.neuronas.get(id);
    if (!n || !n.hipos || !n.hipos.size) return null;
    let mejor = null;
    let mejorV = 0.15;
    for (const h of n.hipos) {
      const c = this.neuronas.get(h);
      if (!c || (excluir && excluir.has(c.episodio))) continue;
      const ep = this.episodios.get(c.episodio);
      if (!ep) continue;
      const v = (ctx.get(h) || 0) + 0.3 * this._viveza(ep);
      if (v > mejorV) { mejor = h; mejorV = v; }
    }
    return mejor;
  }

  // Camina desde una palabra hacia delante (dir=1, hasta "fin") o hacia atrás
  // (dir=-1, hasta "inicio"), siguiendo la corteza y el recuerdo que se reviva.
  _caminar(desde, ancla, ctx, dir, temperatura, max, excluir, usadas, prohibidas = null) {
    const palabras = [], pasos = [], probs = [], celdas = [];
    const meta = dir > 0 ? this.fin : this.inicio;
    let actual = desde;
    let celda = ancla;
    for (let i = 0; i <= max; i++) {
      const n = this.neuronas.get(actual);
      const salidas = dir > 0 ? n.sec : n.secIn;
      const cands = new Map();
      let total = 0;
      for (const w of salidas.values()) total += w;
      for (const [x, w] of salidas) cands.set(x, { c: w / total, h: 0, sigCelda: null });
      if (celda) {
        const cn = this.neuronas.get(celda);
        const ep = cn && this.episodios.get(cn.episodio);
        if (ep) {
          const pos = cn.pos + dir;
          const sig = pos >= 0 && pos < ep.celdas.length ? ep.celdas[pos] : null;
          const sigN = sig ? this.neuronas.get(sig) : null;
          const x = sigN ? sigN.palabra : meta;
          const fuerza = LAMBDA_HIPO * this._viveza(ep) * (0.5 + (ctx.get(celda) || 0));
          const c = cands.get(x) || { c: 0, h: 0, sigCelda: null };
          c.h = fuerza;
          c.sigCelda = sigN ? sig : null;
          cands.set(x, c);
        }
      }
      const lista = [];
      let suma = 0;
      for (const [x, c] of cands) {
        if (prohibidas && prohibidas.has(x)) continue;
        let p = c.c + c.h;
        if (x === meta) {
          p *= Math.pow(BETA + 0.3, 1.5);
        } else {
          if (i === max) continue;            // ya no caben más palabras: solo vale cerrar
          p *= Math.pow(BETA + (ctx.get(x) || 0), 1.5);   // lo que tiene en la cabeza manda
          if (usadas.has(x)) p *= 0.08;
        }
        if (p > 0) { lista.push([x, p, c]); suma += p; }
      }
      if (!lista.length) break;
      // Con palabras muy conectadas, solo cuentan las mejores opciones.
      if (lista.length > 40) {
        lista.sort((a, b) => b[1] - a[1]);
        lista.length = 40;
      }
      // Anticipación: cada opción vale más si lleva a algo que tiene en la cabeza.
      // Coherencia: y más aún si se ha oído junto a lo que ya lleva dicho en
      // esta frase (así no pega «Toby» con el pescado de Luna).
      if (lista.length > 1) {
        const dichas = [...usadas].filter((u) => !VACIAS.has(this.neuronas.get(u)?.texto));
        suma = 0;
        for (const e of lista) {
          if (e[0] !== meta) {
            e[1] *= 0.5 + this._anticipar(e[0], ctx, dir, usadas, prohibidas, meta);
            const nx = this.neuronas.get(e[0]);
            if (dichas.length && nx.asoc && !VACIAS.has(nx.texto)) {
              let afinidad = 0;
              for (const u of dichas) afinidad = Math.max(afinidad, nx.asoc.get(u) || 0);
              e[1] *= 0.5 + Math.min(1, afinidad * 3);
            }
          }
          suma += e[1];
        }
      }
      const [x, p, c] = this._muestrear(lista, temperatura);
      probs.push(p / suma);
      const origen = c.h > c.c ? 'h' : 'c';
      pasos.push(dir > 0 ? [actual, x, origen] : [x, actual, origen]);
      if (x === meta) return { palabras, pasos, probs, celdas, cerrada: true };
      palabras.push(x);
      usadas.add(x);
      if (c.sigCelda && c.h > 0) { celda = c.sigCelda; celdas.push(celda); }
      else celda = this._celdaActiva(x, ctx, excluir);
      actual = x;
    }
    return { palabras, pasos, probs, celdas, cerrada: false };
  }

  // Lo mejor que puede venir justo después de `x` (o antes, si se camina hacia
  // atrás), sin contar lo que ya ha dicho en esta frase. Las mejores opciones se
  // recuerdan durante cada hablar() porque el contexto no cambia.
  _anticipar(x, ctx, dir, usadas, prohibidas, meta) {
    const clave = dir > 0 ? x : -x;
    const cache = this._cacheAnticipar;
    let mejores = cache ? cache.get(clave) : undefined;
    if (!mejores) {
      const n = this.neuronas.get(x);
      const salidas = dir > 0 ? n.sec : n.secIn;
      let total = 0;
      for (const w of salidas.values()) total += w;
      mejores = [];
      if (total) {
        for (const [y, w] of salidas) {
          if (prohibidas && prohibidas.has(y)) continue;
          const c = w / total;
          const v = y === meta
            ? c * Math.pow(BETA + 0.3, 1.5)
            : c * Math.pow(BETA + (ctx.get(y) || 0), 1.5);
          if (mejores.length < 4 || v > mejores[3][1]) {
            mejores.push([y, v]);
            mejores.sort((a, b) => b[1] - a[1]);
            if (mejores.length > 4) mejores.pop();
          }
        }
      }
      if (cache) cache.set(clave, mejores);
    }
    let mejor = 0;
    for (const [y, v] of mejores) {
      const vv = y !== meta && usadas.has(y) ? v * 0.08 : v;
      if (vv > mejor) mejor = vv;
    }
    return mejor;
  }

  _construirFrase(pivote, ctx, { temperatura, maxLong, excluir, prohibidas }) {
    const usadas = new Set([pivote]);
    const ancla = this._celdaActiva(pivote, ctx, excluir);
    const ade = this._caminar(pivote, ancla, ctx, 1, temperatura, maxLong - 1, excluir, usadas, prohibidas);
    const resto = Math.max(0, maxLong - 1 - ade.palabras.length);
    const atr = this._caminar(pivote, ancla, ctx, -1, temperatura, resto, excluir, usadas, prohibidas);
    return {
      pivote,
      palabras: [...atr.palabras.slice().reverse(), pivote, ...ade.palabras],
      pasos: [...atr.pasos.slice().reverse(), ...ade.pasos],
      probs: [...atr.probs, ...ade.probs],
      celdas: [...(ancla ? [ancla] : []), ...atr.celdas, ...ade.celdas],
      completa: atr.cerrada && ade.cerrada,
    };
  }

  // Qué tan natural suena la frase leída hacia delante (media geométrica de
  // las probabilidades de cada paso), se haya construido como se haya construido.
  _fluidez(f) {
    if (!f.pasos.length) return 0.3;
    let suma = 0;
    for (const [a, b, origen] of f.pasos) {
      const n = this.neuronas.get(a);
      let total = 0;
      for (const w of n.sec.values()) total += w;
      let p = total ? (n.sec.get(b) || 0) / total : 0;
      if (origen === 'h') p = Math.max(p, 0.8);   // seguir un recuerdo reciente es natural
      suma += Math.log(Math.max(p, 1e-4));
    }
    return Math.exp(suma / f.pasos.length);
  }

  // Coherencia: ¿las palabras con más contenido de la frase se han oído juntas
  // alguna vez? Las frases "quimera" que pegan trozos de recuerdos distintos
  // juntan palabras que nunca se han asociado.
  _coherencia(palabras) {
    const cont = [...new Set(palabras)]
      .map((id) => [id, this._habituacion(this.neuronas.get(id))])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id]) => id);
    if (cont.length < 2) return 1;
    let suma = 0, pares = 0;
    for (let i = 0; i < cont.length; i++) {
      for (let j = i + 1; j < cont.length; j++) {
        const w = this.neuronas.get(cont[i]).asoc.get(cont[j]) || 0;
        suma += Math.min(1, w * 4);
        pares++;
      }
    }
    return suma / pares;
  }

  _puntuar(f, ctx, entrada, pregunta, eco) {
    const unicas = new Set(f.palabras);
    const L = f.palabras.length;
    // Lo nuevo solo cuenta si tiene que ver con lo que se le ha dicho (palabras
    // con contenido): así lo que tenía en mente no se cuela en cualquier respuesta.
    const tema = [...entrada].filter((id) => {
      const n = this.neuronas.get(id);
      return n && n.tipo === 'palabra' && !VACIAS.has(n.texto) && !INTERROGATIVOS.has(n.texto);
    });
    const relacionada = (id) => {
      const n = this.neuronas.get(id);
      if (!n || !n.asoc || !tema.length) return true;
      return tema.some((t) => n.asoc.has(t));
    };
    let rel = 0, nov = 0;
    for (const id of unicas) {
      const g = 0.3 + 0.7 * this._habituacion(this.neuronas.get(id));
      const a = ctx.get(id) || 0;
      rel += a * g;
      if (!entrada.has(id) && relacionada(id)) nov += a * g;
    }
    // Cobertura: cuánto de lo que se le dijo (sin contar "qué", "quién"…) sale en la frase.
    let pesoEnt = 0, cubierto = 0;
    for (const id of entrada) {
      const n = this.neuronas.get(id);
      if (!n || INTERROGATIVOS.has(n.texto)) continue;
      const g = this._habituacion(n);
      pesoEnt += g;
      if (unicas.has(id)) cubierto += g;
    }
    const cob = pesoEnt ? cubierto / pesoEnt : 0;
    const flu = this._fluidez(f);
    const raizL = Math.sqrt(L);
    let puntos;
    if (pregunta) {
      // Para contestar hay que hablar de lo que se pregunta.
      puntos = (rel / raizL + nov / raizL + 0.8 * cob) * (0.4 + flu) * (0.4 + cob);
    } else {
      puntos = (rel / raizL + 0.7 * (nov / raizL) + 0.25 * cob) * (0.4 + flu);
    }
    const coh = this._coherencia(f.palabras);
    puntos *= 0.35 + 0.65 * coh;
    if (!f.completa) puntos *= 0.6;
    if (L === 1) puntos *= 0.5;
    // Repetir una afirmación es hacer el loro; en cambio, poder construir por sí
    // mismo lo que se le pregunta («¿Toby es un animal?») es saber la respuesta,
    // siempre que el sujeto y lo que se dice de él estén conectados (Toby–animal).
    if (eco && !pregunta) puntos *= 0.3;
    if (eco && pregunta && tema.length >= 2) {
      const a = this.neuronas.get(tema[0]);
      const vinculo = a.asoc.get(tema[tema.length - 1]) || 0;
      puntos *= 1 + 0.6 * Math.min(1, vinculo * 20);
    }
    return Object.assign(f, { puntos, rel, nov, cob, flu, coh });
  }

  // Prueba varias frases empezando por lo que más tiene en la cabeza y elige la
  // que más encaja.
  hablar(ctx, {
    entrada = new Set(), excluir = null, pregunta = false, frasesEntrada = [],
    extraTemperatura = 0, intentos = 2, temperatura = null, maxPivotes = 6, umbral = UMBRAL_RESPUESTA,
    codicioso = true, prohibidas = null, enMente = [],
  } = {}) {
    const aj = this.ajustes.aprendizaje;
    const temp = (temperatura === null ? aj.creatividad : temperatura) + extraTemperatura;
    const maxLong = aj.longitudMaxRespuesta;
    const pivotes = [];
    for (const [id, a] of ctx) {
      const n = this.neuronas.get(id);
      if (!n || n.tipo !== 'palabra' || (prohibidas && prohibidas.has(id))) continue;
      if (!n.sec.size && !n.secIn.size && !n.hipos.size) continue;
      pivotes.push([id, a * (0.3 + 0.7 * this._habituacion(n)), entrada.has(id)]);
    }
    pivotes.sort((a, b) => b[1] - a[1]);
    // Ante una pregunta empieza por aquello que se pregunta; ante una
    // afirmación, por algo que ya sabía y no por lo que acaba de oír.
    let elegibles = pivotes;
    if (pregunta && entrada.size) {
      const tema = pivotes.filter((p) => p[2] && !INTERROGATIVOS.has(this.neuronas.get(p[0]).texto));
      // También prueba a empezar por lo que tiene en mente («¿Qué come?» → Luna…).
      const mente = pivotes.filter((p) => !p[2] && enMente.includes(p[0])).slice(0, 2);
      if (tema.length) elegibles = [...tema, ...mente];
    } else if (!pregunta && entrada.size) {
      const viejos = pivotes.filter((p) => !p[2]);
      if (viejos.length) elegibles = viejos;
    }
    const ecos = new Set(frasesEntrada.map((f) => f.join(',')));
    // Al elegir palabras, lo que tiene en la cabeza cuenta más si es una palabra
    // con contenido que si es una muy común (el, la, de…).
    const ctxElegir = new Map();
    for (const [id, a] of ctx) {
      const n = this.neuronas.get(id);
      ctxElegir.set(id, n && n.tipo === 'palabra' ? a * (0.3 + 0.7 * this._habituacion(n)) : a);
    }
    const vistas = new Set();
    const candidatas = [];
    this._cacheAnticipar = new Map();
    try {
      for (const [p] of elegibles.slice(0, maxPivotes)) {
        for (let k = 0; k < intentos; k++) {
          const t = k === 0 && codicioso ? 0 : temp;
          const f = this._construirFrase(p, ctxElegir, { temperatura: t, maxLong, excluir, prohibidas });
          if (!f.palabras.length) continue;
          const clave = f.palabras.join(',');
          if (vistas.has(clave)) continue;
          vistas.add(clave);
          const eco = ecos.has(clave);
          if (eco && !pregunta) continue;      // ante una afirmación no repite como un loro
          candidatas.push(this._puntuar(f, ctx, entrada, pregunta, eco));
        }
      }
    } finally {
      this._cacheAnticipar = null;
    }
    if (!candidatas.length) return null;
    candidatas.sort((a, b) => b.puntos - a.puntos);
    const mejor = candidatas[0];
    if (mejor.puntos < umbral) return null;
    // Solo duda entre frases casi empatadas (más margen cuanto más creativo).
    const margen = 1 - Math.min(0.15, 0.04 * temp);
    const buenas = candidatas.filter((c) => c.puntos >= mejor.puntos * margen).slice(0, 3);
    const elegida = buenas.length > 1 && temp > 0.3
      ? this._muestrear(buenas.map((c) => [c, c.puntos]), temp * 0.1)[0]
      : mejor;
    elegida.candidatas = candidatas.length;
    return elegida;
  }

  forma(n) {
    if (!n || n.tipo !== 'palabra') return '';
    return n.medio > 0 && n.mayus / n.medio > 0.5 ? mayuscula(n.texto) : n.texto;
  }

  _formatear(ids) {
    const texto = ids.map((id) => this.forma(this.neuronas.get(id))).join(' ');
    return mayuscula(texto) + '.';
  }

  // Cuando no sabe qué decir habla como un bebé: repite lo más llamativo
  // (lo menos oído y, a igualdad, las palabras más largas).
  _balbucear(oido, soloIds = null) {
    const unicas = [...new Set(soloIds || oido.ids)].filter((id) => this.neuronas.has(id));
    const top = unicas
      .map((id) => {
        const n = this.neuronas.get(id);
        return [id, this._habituacion(n) + 0.02 * Math.min(10, n.texto.length)];
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map((x) => x[0]);
    const formas = unicas.filter((id) => top.includes(id)).map((id) => this.forma(this.neuronas.get(id)));
    if (!formas.length) return '…';
    if (oido.pregunta) return '¿' + mayuscula(formas.join(' ')) + '?';
    return mayuscula(formas.join('… ')) + '…';
  }

  // Palabras de una pregunta de las que no sabe nada (ni orden ni recuerdos).
  _desconocidas(ids) {
    return [...new Set(ids)].filter((id) => {
      const n = this.neuronas.get(id);
      return n && n.tipo === 'palabra' && !INTERROGATIVOS.has(n.texto)
        && !n.sec.size && !n.secIn.size && !n.hipos.size;
    });
  }

  _contenido(ids, k) {
    return [...new Set(ids)]
      .filter((id) => this.neuronas.get(id)?.tipo === 'palabra')
      .map((id) => [id, this._habituacion(this.neuronas.get(id))])
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map((x) => x[0]);
  }

  _huella(id, entradaIds, ctx, elegida) {
    const top = [...ctx.entries()]
      .filter(([i]) => this.neuronas.has(i))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14);
    const celdas = elegida ? elegida.celdas : [];
    const episodios = [...new Set(celdas.map((c) => this.neuronas.get(c)?.episodio).filter(Boolean))];
    const h = {
      id,
      cuando: Date.now(),
      entrada: [...new Set(entradaIds)],
      salida: elegida ? elegida.palabras.slice() : [],
      pasos: elegida ? elegida.pasos.slice() : [],
      celdas: celdas.slice(),
      episodios,
      contexto: top.map(([i, a]) => [i, r3(a)]),
      pivote: elegida ? elegida.pivote : null,
      candidatas: elegida ? elegida.candidatas || 1 : 0,
      valor: 0,
    };
    this.huellas.set(id, h);
    if (this.huellas.size > MAX_HUELLAS) this.huellas.delete(this.huellas.keys().next().value);
    return h;
  }

  // La explicación de "¿por qué ha dicho eso?" en palabras.
  explicar(idRespuesta) {
    const h = this.huellas.get(idRespuesta);
    if (!h) return null;
    const et = (id) => this.etiqueta(this.neuronas.get(id)) || '(olvidada)';
    const tipoDe = (id) => this.neuronas.get(id)?.tipo || null;
    return {
      id: h.id,
      oyo: h.entrada.map(et),
      penso: h.contexto.map(([id, a]) => ({ id, etiqueta: et(id), tipo: tipoDe(id), actividad: a })),
      empezo: h.pivote ? et(h.pivote) : null,
      transiciones: h.pasos.map(([a, b, o]) => ({ de: et(a), a: et(b), origen: o === 'h' ? 'hipocampo' : 'corteza' })),
      recuerdos: h.episodios.length,
      candidatas: h.candidatas,
      valor: h.valor,
      ids: {
        entrada: h.entrada, salida: h.salida, celdas: h.celdas,
        contexto: h.contexto.map(([id]) => id), pasos: h.pasos.map(([a, b]) => [a, b]),
      },
    };
  }

  conversar(texto) {
    const oido = this.oir(texto, { modo: 'charla' });
    const id = this.sigRespuesta++;
    const resumenOido = {
      palabras: oido.ids.length,
      nuevas: oido.nuevas.length,
      sorpresa: r3(oido.sorpresa),
      pregunta: oido.pregunta,
      conceptoNuevo: oido.conceptos.some((c) => c.nuevo),
      recuerdos: oido.episodios.length,
    };
    if (!oido.ids.length) return { id, texto: '…', modo: 'silencio', oido: resumenOido };
    const entrada = new Set(oido.ids);
    const entradas = new Map();
    for (const pid of entrada) entradas.set(pid, 1);
    // Memoria de trabajo: lo que tenía en mente de antes arranca encendido. Si
    // nombras a alguien («¿Quién es Luna?») cuenta poco; si no («¿Qué come?»),
    // mucho: entonces se refiere a lo que se estaba hablando.
    const conMemoria = this.ajustes.aprendizaje.memoriaTrabajo;
    let previo = null;
    if (conMemoria) {
      this._decaerMemoriaTrabajo();
      const huella = this._nombraAlguien(oido.ids) ? 0.06 : 0.6;
      previo = new Map([...this.memoriaTrabajo]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([mid, a]) => [mid, a * huella]));
    }
    const excluir = new Set(oido.episodios);
    const aturdido = Date.now() < this.estado.aturdidoHasta;
    const cansancio = this._cansancio();
    const { contexto, registro } = this.pensar(entradas, { excluir, previo, ruido: aturdido ? 0.18 : cansancio * 0.12 });
    // Si le preguntas por algo que no conoce, pregunta él (curiosidad).
    const desconocidas = oido.pregunta ? this._desconocidas(oido.ids) : [];
    let elegida = null;
    if (!desconocidas.length) {
      // Ante una afirmación, lo que acaba de oír pesa menos al hablar: así
      // cuenta algo relacionado que ya sabía en vez de mezclarlo todo.
      let ctxHablar = contexto;
      if (!oido.pregunta) {
        ctxHablar = new Map(contexto);
        for (const pid of entrada) if (ctxHablar.has(pid)) ctxHablar.set(pid, ctxHablar.get(pid) * 0.35);
      }
      elegida = this.hablar(ctxHablar, {
        entrada, excluir, pregunta: oido.pregunta, frasesEntrada: oido.frases,
        extraTemperatura: aturdido ? 0.6 : cansancio * 0.5,
        // Lo que acaba de aprender en este mensaje no lo mezcla con recuerdos viejos.
        prohibidas: oido.pregunta ? null : new Set(oido.nuevas),
        enMente: conMemoria
          ? [...this.memoriaTrabajo].filter(([mid]) => this.neuronas.get(mid)?.tipo === 'palabra').sort((a, b) => b[1] - a[1]).slice(0, 3).map(([mid]) => mid)
          : [],
      });
    }
    let respuesta = elegida
      ? this._formatear(elegida.palabras)
      : this._balbucear(oido, desconocidas.length ? desconocidas : null);
    // Si lo que sabe coincide con lo que se le pregunta, es un sí.
    if (elegida && oido.pregunta && oido.frases.some((f) => f.join(',') === elegida.palabras.join(','))) {
      respuesta = `Sí. ${respuesta}`;
    }
    if (this.estado.bostezoPendiente) {
      respuesta = '*bosteza* ' + respuesta;
      this.estado.bostezoPendiente = false;
    }
    this._huella(id, oido.ids, contexto, elegida);
    if (conMemoria) this._recordar(oido.ids, elegida ? elegida.palabras : []); else this.memoriaTrabajo.clear();
    this.emitir('pensamiento', {
      origen: 'charla', respuesta: id, pasos: registro,
      ruta: elegida ? elegida.palabras : [], entrada: [...entrada],
    });
    const modo = elegida ? 'frase' : desconocidas.length ? 'curiosidad' : 'balbuceo';
    return { id, texto: respuesta, modo, oido: resumenOido };
  }

  // ─────────────────────── memoria de trabajo ───────────────────────

  // ¿Merece la pena tenerla en mente? (no las palabras de relleno ni las de pregunta)
  _memorable(n) {
    if (!n) return false;
    if (n.tipo === 'concepto') return true;
    return n.tipo === 'palabra' && !VACIAS.has(n.texto) && !INTERROGATIVOS.has(n.texto);
  }

  _decaerMemoriaTrabajo() {
    const ahora = Date.now();
    const k = Math.pow(0.5, (ahora - this._mtTiempo) / VIDA_MEMORIA_TRABAJO_MS);
    this._mtTiempo = ahora;
    for (const [id, a] of this.memoriaTrabajo) {
      const na = a * k;
      if (na < 0.05 || !this.neuronas.has(id)) this.memoriaTrabajo.delete(id);
      else this.memoriaTrabajo.set(id, na);
    }
  }

  // Tras cada mensaje, lo de antes se apaga bastante y entra lo que se acaba de
  // decir: tus palabras con contenido y, algo menos, las de su respuesta.
  // (Solo lo dicho, no todo lo que se encendió: si no, un tema viejo se
  // realimentaría solo y no dejaría paso al nuevo.)
  _recordar(dichas, respondidas = []) {
    this._decaerMemoriaTrabajo();
    for (const [id, a] of this.memoriaTrabajo) this.memoriaTrabajo.set(id, a * 0.4);
    const meter = (ids, factor) => {
      for (const id of new Set(ids)) {
        const n = this.neuronas.get(id);
        if (!this._memorable(n)) continue;
        const a = (0.3 + 0.7 * this._habituacion(n)) * factor;
        this.memoriaTrabajo.set(id, Math.min(1, Math.max(this.memoriaTrabajo.get(id) || 0, a)));
      }
    };
    meter(dichas, 1);
    meter(respondidas, 0.6);
    this.memoriaTrabajo = new Map([...this.memoriaTrabajo]
      .filter(([, a]) => a >= 0.05)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_MEMORIA_TRABAJO));
  }

  // ¿Se nombra a alguien o algo concreto? Lo sabe porque esa palabra ha empezado
  // frases antes («Luna…», «El caballo…»): suele ser de quien se habla.
  _nombraAlguien(ids) {
    const empieza = (id) => (this.neuronas.get(id)?.secIn?.get(this.inicio) || 0) > 0.05;
    return ids.some((id) => {
      const n = this.neuronas.get(id);
      if (!n || n.tipo !== 'palabra' || VACIAS.has(n.texto) || INTERROGATIVOS.has(n.texto)) return false;
      if (empieza(id)) return true;
      for (const [d, w] of n.secIn) if (w > 0.05 && this._esDet(d) && empieza(d)) return true;
      return false;
    });
  }

  // Lo que tiene en mente ahora mismo, para enseñarlo en pantalla.
  enMente(k = 10) {
    if (!this.ajustes.aprendizaje.memoriaTrabajo) return [];
    this._decaerMemoriaTrabajo();
    return [...this.memoriaTrabajo]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([id, a]) => [id, this.etiqueta(this.neuronas.get(id)), r3(a)]);
  }

  // Estimular una neurona a mano: ¿qué le viene a la cabeza?
  estimular(id) {
    const n = this.neuronas.get(id);
    if (!n) return null;
    const { contexto, registro } = this.pensar(new Map([[id, 1]]), {});
    const elegida = n.tipo === 'inhib' ? null : this.hablar(contexto, { intentos: 1, umbral: 0.02 });
    const resp = this.sigRespuesta++;
    if (elegida) this._huella(resp, [], contexto, elegida);
    if (this.ajustes.aprendizaje.memoriaTrabajo) this._recordar([id], elegida ? elegida.palabras : []);
    this.emitir('pensamiento', { origen: 'estimulo', pasos: registro, ruta: elegida ? elegida.palabras : [], entrada: [id] });
    let texto = elegida ? this._formatear(elegida.palabras) : '…';
    if (n.tipo === 'inhib') texto = '(Las inhibidoras no hablan: solo frenan a su grupo.)';
    return { id: elegida ? resp : null, texto, neurona: this.etiqueta(n), tipo: n.tipo };
  }

  // ─────────────────────────── dopamina ───────────────────────────

  // 👍 / 👎: refuerza o debilita las conexiones que usó en esa respuesta
  // (regla de tres factores: actividad previa + huella + dopamina).
  recompensar(idRespuesta, valor) {
    const h = this.huellas.get(idRespuesta);
    if (!h || !h.salida.length) return null;
    valor = valor > 0 ? 1 : -1;
    if (h.valor === valor) return { cambios: 0, repetido: true };
    h.valor = valor;
    const fuerza = this.ajustes.dopamina.fuerza;
    let cambios = 0;
    for (const [a, b] of h.pasos) {
      if (valor > 0) { if (this._reforzarSec(a, b, fuerza)) cambios++; }
      else if (this._debilitarSec(a, b, 1 - fuerza)) cambios++;
    }
    const ent = this._contenido(h.entrada, 5);
    const sal = this._contenido(h.salida, 6);
    for (const a of ent) {
      for (const b of sal) {
        if (a === b) continue;
        if (valor > 0) { if (this._reforzarAsoc(a, b, fuerza * 0.5)) cambios++; }
        else if (this._debilitarAsoc(a, b, 1 - fuerza * 0.5)) cambios++;
      }
    }
    for (const e of h.episodios) {
      const ep = this.episodios.get(e);
      if (ep) ep.importancia = lim(ep.importancia + 0.3 * valor, 0, 1);
    }
    this.estado.dopamina = lim(this.estado.dopamina + 0.4 * valor, -1, 1);
    if (valor > 0) this.contadores.premios++; else this.contadores.castigos++;
    this.sucio = true;
    this.emitir('pensamiento', {
      origen: valor > 0 ? 'premio' : 'castigo',
      pasos: [{ disparos: h.salida.map((i) => [i, 1]), inhib: [], senales: h.pasos.map(([a, b]) => [a, b, 1]) }],
      ruta: [],
    });
    return { cambios };
  }

  // ───────────────────────────── sueño ─────────────────────────────

  repasarEpisodio(ep) {
    const ids = [];
    for (const c of ep.celdas) {
      const n = this.neuronas.get(c);
      if (n && this.neuronas.has(n.palabra)) ids.push(n.palabra);
    }
    if (!ids.length) return null;
    const eta = this.ajustes.aprendizaje.velocidadSueno * (0.6 + 0.8 * ep.importancia);
    this._aprenderSecuencia(ids, eta);
    const r = this._aprenderConcepto(ids, eta, true);
    ep.repasos++;
    return { ids, celdas: ep.celdas.slice(), concepto: r ? r.concepto : null };
  }

  _alAzar(iterable) {
    const lista = Array.isArray(iterable) ? iterable : [...iterable];
    if (!lista.length) return undefined;
    return lista[Math.floor(this.azar() * lista.length)];
  }

  _miembrosFuertes(c, k) {
    return [...c.miembros].sort((a, b) => b[1] - a[1]).slice(0, k).map(([w]) => w);
  }

  // Recuerdo antiguo que se repasa entre los nuevos para no olvidarlo.
  ensayarRecuerdo() {
    if (!this.conceptos.size) return null;
    const c = this.neuronas.get(this._alAzar(this.conceptos));
    const entradas = new Map(this._miembrosFuertes(c, 3).map((w) => [w, 0.9]));
    const { contexto, registro } = this.pensar(entradas, { pasos: 6 });
    const f = this.hablar(contexto, { temperatura: 0, intentos: 1, maxPivotes: 2, umbral: 0 });
    if (f && f.completa && f.palabras.length >= 2) {
      this._aprenderSecuencia(f.palabras, this.ajustes.aprendizaje.velocidadSueno * 0.3);
    }
    return { concepto: c.id, palabras: f ? f.palabras : [], registro };
  }

  // REM: mezcla recuerdos al azar con mucho ruido y poca inhibición.
  sonar() {
    const semillas = [];
    if (this.conceptos.size >= 1) {
      const lista = [...this.conceptos];
      semillas.push(this._alAzar(lista));
      if (lista.length > 1) {
        let otra = this._alAzar(lista);
        for (let i = 0; i < 4 && otra === semillas[0]; i++) otra = this._alAzar(lista);
        if (otra !== semillas[0]) semillas.push(otra);
      }
    } else if (this.lexico.size) {
      const lista = [...this.lexico.values()];
      semillas.push(this._alAzar(lista), this._alAzar(lista));
    }
    if (!semillas.length) return null;
    const entradas = new Map();
    for (const s of semillas) {
      const n = this.neuronas.get(s);
      if (!n) continue;
      if (n.tipo === 'concepto') for (const w of this._miembrosFuertes(n, 3)) entradas.set(w, 0.8);
      else entradas.set(s, 0.9);
    }
    const { contexto, registro } = this.pensar(entradas, { pasos: 7, ruido: 0.25, inhibicion: 0.4 });
    const f = this.hablar(contexto, { temperatura: 1.3, intentos: 1, maxPivotes: 3, umbral: 0, codicioso: false });
    const top = [...contexto]
      .filter(([id]) => this.neuronas.get(id)?.tipo === 'palabra')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    // Si mezcló dos recuerdos, lo más encendido de cada uno que no estaba
    // conectado queda un poco unido (así el sueño relaciona cosas).
    const nuevas = [];
    const ca = this.neuronas.get(semillas[0]);
    const cb = this.neuronas.get(semillas[1]);
    if (ca && cb && ca.tipo === 'concepto' && cb.tipo === 'concepto') {
      const activas = (c, otro) => [...c.miembros.keys()]
        .filter((w) => !otro.miembros.has(w) && (contexto.get(w) || 0) >= 0.3)
        .sort((x, y) => contexto.get(y) - contexto.get(x))
        .slice(0, 2);
      for (const a of activas(ca, cb)) {
        for (const b of activas(cb, ca)) {
          if (nuevas.length >= 2 || this.neuronas.get(a).asoc.has(b)) continue;
          this._reforzarAsoc(a, b, 0.03);
          nuevas.push([a, b]);
        }
      }
    }
    let texto;
    if (f && f.palabras.length >= 2) texto = this._formatear(f.palabras);
    else if (top.length) texto = '…' + top.slice(0, 3).map(([id]) => this.forma(this.neuronas.get(id))).join(', ') + '…';
    else texto = '…';
    return {
      texto,
      palabras: f ? f.palabras : [],
      nuevas: nuevas.map(([a, b]) => [this.forma(this.neuronas.get(a)), this.forma(this.neuronas.get(b))]),
      mezcla: semillas.map((s) => this.etiqueta(this.neuronas.get(s))),
      registro,
    };
  }

  // ─────────────────────── deducciones (al dormir) ───────────────────────

  _esDet(id) {
    const n = this.neuronas.get(id);
    return Boolean(n && n.tipo === 'palabra' && DETERMINANTES.has(n.texto));
  }

  _esCop(id) {
    const n = this.neuronas.get(id);
    return Boolean(n && n.tipo === 'palabra' && COPULAS.has(n.texto));
  }

  // Singular de una palabra («animales» → «animal»), mejor si ya conoce esa forma.
  _singular(texto) {
    const base = sinTildes(texto);
    const r = raiz(texto);
    let conocida = null;
    for (const id of (r && this.raices.get(r)) || []) {
      const t = this.neuronas.get(id).texto;
      if (t.endsWith('s') || t.length >= texto.length) continue;
      if (base.startsWith(sinTildes(t)) && (!conocida || t.length > conocida.length)) conocida = t;
    }
    if (conocida) return conocida;
    if (texto.endsWith('ces')) return `${texto.slice(0, -3)}z`;
    if (texto.endsWith('es') && /[lrndjys]$/.test(texto.slice(0, -2))) return texto.slice(0, -2);
    return texto.slice(0, -1);
  }

  // Una palabra que se le ocurre al deducir (por ejemplo «animal» si solo había
  // oído «animales»): nace como cualquier otra, cerca de la que la inspira.
  _palabraImaginada(texto, cerca) {
    const id = this.lexico.get(texto);
    if (id) return id;
    return this._palabra({ norma: texto, original: texto }, false, this.neuronas.get(cerca)).n.id;
  }

  // Si una frase acaba en «… B» y sabe que «B es/son C», deduce «… C».
  // «Toby es mi perro» + «los perros son animales» → «Toby es un animal».
  deducir(ids, vistas = new Set()) {
    if (!ids || ids.length < 2) return null;
    const n = (id) => this.neuronas.get(id);
    if (ids.some((id) => !n(id) || n(id).tipo !== 'palabra')) return null;
    const iB = ids.length - 1;
    const B = ids[iB];
    if (this._esDet(B) || this._esCop(B)) return null;
    const conDet = iB > 0 && this._esDet(ids[iB - 1]);
    const prefijo = ids.slice(0, conDet ? iB - 1 : iB);
    if (!prefijo.some((id) => !this._esDet(id) && !this._esCop(id))) return null;

    // ¿Qué sabe la corteza de B (o de las palabras que suenan como B)?
    const r = raiz(n(B).texto);
    const formas = new Set([B, ...((r && this.raices.get(r)) || [])]);
    let mejor = null;
    for (const b of formas) {
      const nb = n(b);
      if (!nb || !nb.sec) continue;
      for (const [cop, w1] of nb.sec) {
        if (w1 < UMBRAL_SABER || !this._esCop(cop)) continue;
        for (const [x, w2] of n(cop).sec) {
          const siguientes = this._esDet(x) ? [...n(x).sec].map(([y, w3]) => [y, w1 * w2 * w3, x]) : [[x, w1 * w2, null]];
          for (const [c, peso, det] of siguientes) {
            const nc = n(c);
            if (!nc || nc.tipo !== 'palabra' || this._esDet(c) || this._esCop(c)) continue;
            if (formas.has(c) || prefijo.includes(c) || (r && raiz(nc.texto) === r)) continue;
            if (!mejor || peso > mejor.peso) mejor = { b, cop, det, c, peso };
          }
        }
      }
    }
    if (!mejor || mejor.peso < 0.004) return null;

    // Concordancia: «Toby es un animal» (singular) o «los perros son animales» (plural).
    const textos = ids.map((id) => n(id).texto);
    const singular = textos.includes('es') || (!textos.includes('son') && !n(B).texto.endsWith('s'));
    let c = mejor.c;
    if (singular && n(c).texto.endsWith('s') && n(c).texto.length > 3) {
      c = this._palabraImaginada(this._singular(n(c).texto), c);
    }
    let det = null;
    if (conDet) {
      if (singular) {
        let w = 0;
        for (const [a, wa] of n(c).secIn) {
          const t = n(a)?.texto;
          if ((t === 'un' || t === 'una') && wa > w) { det = a; w = wa; }
        }
        if (!det) det = this._palabraImaginada(n(c).texto.endsWith('a') ? 'una' : 'un', c);
      } else {
        det = ids[iB - 1];
      }
    }
    const nuevas = [...prefijo, ...(det ? [det] : []), c];
    const clave = nuevas.join(',');
    if (vistas.has(clave)) return null;
    vistas.add(clave);
    // ¿Ya lo sabía? Si la frase ya está bien unida, no hay nada que deducir.
    let minimo = Infinity;
    for (let i = 0; i + 1 < nuevas.length; i++) minimo = Math.min(minimo, n(nuevas[i]).sec.get(nuevas[i + 1]) || 0);
    if (minimo >= 0.25) return null;

    // Se aprende más flojo que algo oído: es una suposición suya.
    const eta = this.ajustes.aprendizaje.velocidadSueno * 0.6;
    this._aprenderSecuencia(nuevas, eta);
    this._aprenderConcepto(nuevas, eta, true);
    this.contadores.deducciones = (this.contadores.deducciones || 0) + 1;
    this.sucio = true;
    const sabido = [mejor.b, mejor.cop, ...(mejor.det ? [mejor.det] : []), mejor.c];
    return {
      ids: nuevas,
      de: ids.slice(),
      sabido,
      texto: this._formatear(nuevas),
      porque: [this._formatear(ids), this._formatear(sabido)],
    };
  }

  // ─────────────────── categorías: palabras que se usan igual ───────────────────

  // Cómo se usa una palabra: quién va antes (claves negativas) y quién después,
  // sin contar las palabras "comodín" que van con todo.
  _contexto(n) {
    const v = new Map();
    if (n.sec.size + n.secIn.size > 4 * MAX_ABANICO) return v;   // las comodín no se agrupan
    for (const [a, w] of n.secIn) {
      const na = this.neuronas.get(a);
      if (na && na.sec.size <= MAX_ABANICO) v.set(-a, w);
    }
    for (const [b, w] of n.sec) {
      const nb = this.neuronas.get(b);
      if (nb && nb.secIn.size <= MAX_ABANICO) v.set(b, w);
    }
    return v;
  }

  // Palabras que aparecen en frases parecidas (con los mismos vecinos) acaban en
  // una misma categoría, como {perro ≈ gato ≈ caballo}.
  // `msMax`: nunca trabaja más de eso seguido (lo que no le dé tiempo, otra noche).
  agrupar(ids, { maxGrupos = 3, msMax = 40 } = {}) {
    const inicio = Date.now();
    const grupos = [];
    const cache = new Map();
    const ctx = (id) => {
      let v = cache.get(id);
      if (!v) { v = this._contexto(this.neuronas.get(id)); cache.set(id, v); }
      return v;
    };
    const util = (nn) => nn && nn.tipo === 'palabra' && !DETERMINANTES.has(nn.texto) && !COPULAS.has(nn.texto) && !INTERROGATIVOS.has(nn.texto);
    for (const w of new Set(ids)) {
      if (grupos.length >= maxGrupos || Date.now() - inicio > msMax) break;
      if (!util(this.neuronas.get(w))) continue;
      const vw = ctx(w);
      if (vw.size < 2) continue;
      const comunes = new Map();
      for (const k of vw.keys()) {
        const vecino = this.neuronas.get(Math.abs(k));
        const otras = k < 0 ? vecino.sec : vecino.secIn;
        for (const x of otras.keys()) if (x !== w) comunes.set(x, (comunes.get(x) || 0) + 1);
      }
      // Solo las 50 que más vecinos comparten: las demás no se parecerían bastante.
      const candidatas = [...comunes].filter(([, cuantos]) => cuantos >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50);
      const similares = [];
      for (const [x] of candidatas) {
        if (!util(this.neuronas.get(x))) continue;
        const s = coseno(vw, ctx(x));
        if (s >= 0.5) similares.push([x, s]);
      }
      if (!similares.length) continue;
      similares.sort((a, b) => b[1] - a[1]);
      const top = similares.slice(0, 5);
      const parecido = top.reduce((s, [, v]) => s + v, 0) / top.length;
      grupos.push(this._reforzarCategoria([w, ...top.map(([x]) => x)], parecido));
    }
    return grupos;
  }

  _reforzarCategoria(grupo, parecido) {
    const enGrupo = new Set(grupo);
    let cat = null;
    let solape = 1;
    for (const id of grupo) {
      for (const cid of this.neuronas.get(id).conceptos.keys()) {
        const c = this.neuronas.get(cid);
        if (!c || !c.categoria) continue;
        let s = 0;
        for (const m of c.miembros.keys()) if (enGrupo.has(m)) s++;
        if (s > solape) { cat = c; solape = s; }
      }
    }
    const nueva = !cat;
    if (!cat) {
      cat = this._crear('concepto', { categoria: true, ...D.posicionConcepto(this, grupo, this.azar) });
      this._asignarInhibidora(cat, 'conceptos');
      this.contadores.categorias = (this.contadores.categorias || 0) + 1;
    }
    const objetivo = 0.3 + 0.4 * parecido;
    for (const id of grupo) {
      const m = cat.miembros.get(id) || 0;
      this._fijarMiembro(cat, id, m + 0.5 * (objetivo - m));
    }
    cat.usos++;
    if (cat.miembros.size > 12) {
      const sobran = [...cat.miembros].sort((a, b) => a[1] - b[1]).slice(0, cat.miembros.size - 12);
      for (const [w] of sobran) this._quitarMiembro(cat, w);
    }
    this.sucio = true;
    return { concepto: cat.id, nueva, miembros: [...cat.miembros.keys()], texto: this.etiqueta(cat) };
  }

  // Homeostasis sináptica: al final del sueño todo baja un poco y lo muy débil
  // desaparece. Las palabras que se quedan sin ninguna conexión se olvidan.
  homeostasis(fuerza, umbral) {
    const k = 1 - fuerza;
    let podadas = 0;
    let eliminadas = 0;
    const fuentes = [this.inicio, ...this.lexico.values()];
    for (const id of fuentes) {
      const n = this.neuronas.get(id);
      if (!n) continue;
      for (const [b, w] of n.sec) {
        const nb = this.neuronas.get(b);
        const nw = w * k;
        if (nw < umbral) { n.sec.delete(b); nb.secIn.delete(id); podadas++; }
        else { n.sec.set(b, nw); nb.secIn.set(id, nw); }
      }
      if (n.asoc) {
        for (const [b, w] of n.asoc) {
          if (b < id) continue;
          const nb = this.neuronas.get(b);
          const nw = w * k;
          if (nw < umbral) { n.asoc.delete(b); nb.asoc.delete(id); podadas++; }
          else { n.asoc.set(b, nw); nb.asoc.set(id, nw); }
        }
      }
    }
    for (const cid of [...this.conceptos]) {
      const c = this.neuronas.get(cid);
      for (const [w, m] of c.miembros) {
        const nm = m * k;
        if (nm < umbral) { this._quitarMiembro(c, w); podadas++; }
        else this._fijarMiembro(c, w, nm);
      }
      if (c.miembros.size < 2) { this._matar(cid); eliminadas++; }
    }
    for (const id of [...this.lexico.values()]) {
      const n = this.neuronas.get(id);
      if (!n.sec.size && !n.secIn.size && !n.asoc.size && !n.conceptos.size && !n.hipos.size) {
        this._matar(id);
        eliminadas++;
      }
    }
    eliminadas += this._limpiarInhibidoras();
    this.sucio = true;
    return { podadas, eliminadas };
  }

  olvidarConsolidados() {
    let n = 0;
    for (const ep of [...this.episodios.values()]) {
      if (ep.consolidado) { this._olvidarEpisodio(ep); n++; }
    }
    if (n) {
      this._limpiarInhibidoras();
      D.colocarHipocampo(this);
    }
    return n;
  }

  // ─────────────────────────── consulta ───────────────────────────

  etiqueta(n) {
    if (!n) return '';
    switch (n.tipo) {
      case 'palabra': return this.forma(n);
      case 'concepto': {
        // Un concepto es un conjunto de palabras: se nombra por las más fuertes y con más contenido.
        const top = [...n.miembros]
          .map(([w, m]) => [w, m * (0.3 + 0.7 * this._habituacion(this.neuronas.get(w)))])
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([w]) => this.forma(this.neuronas.get(w)));
        // Las categorías (palabras que se usan igual) se escriben con ≈.
        return n.categoria ? `{${top.join(' ≈ ')}}` : `{${top.join(', ')}}`;
      }
      case 'hipo': return this.forma(this.neuronas.get(n.palabra));
      case 'inhib': return 'inhibidora';
      default: return n.etiqueta || n.tipo;
    }
  }

  _tamano(n) {
    switch (n.tipo) {
      case 'palabra': return Math.min(12, 2.5 + 1.6 * Math.log(1 + n.frec));
      case 'concepto': return Math.min(14, 4 + 1.5 * Math.log(1 + n.usos + n.miembros.size));
      case 'hipo': return 2.6;
      case 'inhib': return 3.2;
      default: return 9;
    }
  }

  nodo(id) {
    const n = this.neuronas.get(id);
    if (!n) return null;
    return [n.id, CODIGOS[n.tipo], r1(n.x), r1(n.y), this.etiqueta(n), r1(this._tamano(n))];
  }

  tomarCambios() {
    const nacidas = [];
    for (const id of this._nacidas) { const nd = this.nodo(id); if (nd) nacidas.push(nd); }
    const muertas = this._muertas;
    this._nacidas = [];
    this._muertas = [];
    return { nacidas, muertas };
  }

  // El mapa para la interfaz: cada neurona (sitio, tipo, nombre y tamaño) y las
  // conexiones más fuertes. Es un generador que cede cada poco: así, con
  // cerebros grandes, mapaAsincrono() reparte el trabajo y nunca frena al cerebro.
  *_generarMapa({ maxAristas = 6000 } = {}) {
    const ids = [], xy = [], tipos = [], tam = [], etiquetas = [];
    let k = 0;
    for (const n of this.neuronas.values()) {
      ids.push(n.id); xy.push(n.x, n.y); tipos.push(CODIGOS[n.tipo]);
      tam.push(Math.round(this._tamano(n) * 10)); etiquetas.push(this._etiquetaMapa(n));
      if (++k >= 1500) { k = 0; yield; }
    }
    // Secuencia y asociación: solo las más fuertes. Solo se guardan las que
    // pasan de un suelo (sacado del corte de la vez anterior) para no llenar la
    // memoria con cientos de miles de conexiones flojas.
    const suelo = this._sueloMapa || 0;
    let cand = [];
    yield* this._candidatasMapa(suelo, cand);
    if (suelo > 0 && cand.length / 4 < maxAristas) { cand = []; yield* this._candidatasMapa(0, cand); }
    const corte = umbralPara(cand, 4, 2, maxAristas);
    this._sueloMapa = corte * 0.7;
    const a = [], b = [], w = [], clase = [];
    const poner = (x, y, peso, c) => { a.push(x); b.push(y); w.push(Math.round(Math.min(1, peso) * 255)); clase.push(c); };
    for (let i = 0; i < cand.length; i += 4) if (cand[i + 2] >= corte) poner(cand[i], cand[i + 1], cand[i + 2], cand[i + 3]);
    k = 0;
    for (const cid of this.conceptos) {
      const c = this.neuronas.get(cid);
      if (!c) continue;
      for (const [p, m] of [...c.miembros].sort((x, y) => y[1] - x[1]).slice(0, 3)) poner(cid, p, m, 2);
      if (++k >= 800) { k = 0; yield; }
    }
    for (const ep of this.episodios.values()) {
      for (let i = 0; i < ep.celdas.length; i++) {
        const c = ep.celdas[i];
        if (i + 1 < ep.celdas.length) poner(c, ep.celdas[i + 1], 1, 3);
        const n = this.neuronas.get(c);
        if (n) poner(c, n.palabra, 0.5, 4);
      }
    }
    return {
      version: this.version,
      epoca: this.epocaPosiciones || 0,
      regiones: D.REGIONES,
      ids: Uint32Array.from(ids), xy: Float32Array.from(xy), tipos: Uint8Array.from(tipos),
      tam: Uint8Array.from(tam, (x) => Math.min(255, x)), etiquetas,
      aristas: { a: Uint32Array.from(a), b: Uint32Array.from(b), w: Uint8Array.from(w), k: Uint8Array.from(clase) },
    };
  }

  *_candidatasMapa(suelo, cand) {
    let k = 0;
    for (const id of [this.inicio, ...this.lexico.values()]) {
      const n = this.neuronas.get(id);
      if (!n) continue;
      for (const [b, w] of n.sec) if (w >= suelo) cand.push(id, b, w, 0);
      if (n.asoc) for (const [b, w] of n.asoc) if (id < b && w >= suelo) cand.push(id, b, w, 1);
      if (++k >= 400) { k = 0; yield; }
    }
  }

  // El nombre de un concepto cuesta calcularlo: en el mapa vale el de hace un rato.
  _etiquetaMapa(n) {
    if (n.tipo !== 'concepto') return this.etiqueta(n);
    if (!this._etiquetasMapa) this._etiquetasMapa = new WeakMap();
    const ahora = Date.now();
    let e = this._etiquetasMapa.get(n);
    if (!e || ahora - e.t > 30000 || e.m !== n.miembros.size) {
      e = { t: ahora, m: n.miembros.size, texto: this.etiqueta(n) };
      this._etiquetasMapa.set(n, e);
    }
    return e.texto;
  }

  mapa(opciones) {
    const it = this._generarMapa(opciones);
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
    }
  }

  // Igual que mapa(), pero deja pasar al resto (charla, eventos) cada pocos milisegundos.
  async mapaAsincrono(opciones) {
    const it = this._generarMapa(opciones);
    let t = Date.now();
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
      if (Date.now() - t > 8) {
        await new Promise((res) => setImmediate(res));
        t = Date.now();
      }
    }
  }

  // Solo dónde está cada neurona: lo que más cambia y lo que menos pesa.
  posiciones() {
    const N = this.neuronas.size;
    const ids = new Uint32Array(N), xy = new Float32Array(N * 2);
    let i = 0;
    for (const n of this.neuronas.values()) {
      ids[i] = n.id; xy[2 * i] = n.x; xy[2 * i + 1] = n.y; i++;
    }
    return { version: this.version, epoca: this.epocaPosiciones || 0, ids, xy };
  }

  _infoEpisodio(ep) {
    const palabras = ep.celdas.map((c) => this.etiqueta(this.neuronas.get(c)));
    return {
      id: ep.id,
      frase: palabras.join(' '),
      viveza: r3(this._viveza(ep)),
      importancia: r3(ep.importancia),
      sorpresa: r3(ep.sorpresa),
      repasos: ep.repasos,
      creado: ep.creado,
    };
  }

  detalle(id) {
    const n = this.neuronas.get(id);
    if (!n) return null;
    const item = (b, w, clase) => {
      const m = this.neuronas.get(b);
      return { id: b, etiqueta: this.etiqueta(m), tipo: m ? m.tipo : null, peso: r3(w), clase };
    };
    const lista = (mapa, clase, k = 40) => [...mapa].sort((a, b) => b[1] - a[1]).slice(0, k).map(([b, w]) => item(b, w, clase));
    const d = {
      id, tipo: n.tipo, etiqueta: this.etiqueta(n), nacida: n.nacida, disparos: n.disparos,
      grupos: [], total: 0,
    };
    if (n.inh) {
      const inh = this.neuronas.get(n.inh);
      d.inhibidora = { id: n.inh, tamGrupo: inh ? inh.grupo.size : 0 };
    }
    switch (n.tipo) {
      case 'palabra':
        d.frec = n.frec;
        d.habituacion = r3(this._habituacion(n));
        d.grupos.push({ titulo: 'Suele ir después', clase: 'sec', total: n.sec.size, items: lista(n.sec, 'sec') });
        d.grupos.push({ titulo: 'Suele ir antes', clase: 'secIn', total: n.secIn.size, items: lista(n.secIn, 'secIn') });
        d.grupos.push({ titulo: 'Asociadas', clase: 'asoc', total: n.asoc.size, items: lista(n.asoc, 'asoc') });
        d.grupos.push({ titulo: 'En conceptos', clase: 'concepto', total: n.conceptos.size, items: lista(n.conceptos, 'concepto') });
        d.recuerdos = [...n.hipos]
          .map((h) => this.episodios.get(this.neuronas.get(h)?.episodio))
          .filter(Boolean)
          .map((ep) => this._infoEpisodio(ep));
        break;
      case 'concepto':
        d.usos = n.usos;
        d.categoria = Boolean(n.categoria);
        d.grupos.push({
          titulo: n.categoria ? 'Palabras de la categoría' : 'Palabras del concepto',
          clase: 'miembro', total: n.miembros.size, items: lista(n.miembros, 'miembro'),
        });
        break;
      case 'hipo': {
        const ep = this.episodios.get(n.episodio);
        if (ep) d.recuerdo = this._infoEpisodio(ep);
        d.posicion = n.pos;
        d.grupos.push({ titulo: 'Representa a', clase: 'palabra', total: 1, items: [item(n.palabra, 1, 'palabra')] });
        break;
      }
      case 'inhib':
        d.region = n.region;
        d.grupos.push({ titulo: 'Frena a', clase: 'inhibe', total: n.grupo.size, items: [...n.grupo].slice(0, 40).map((b) => item(b, 1, 'inhibe')) });
        break;
      case 'inicio':
        d.grupos.push({ titulo: 'Primeras palabras', clase: 'sec', total: n.sec.size, items: lista(n.sec, 'sec') });
        break;
      case 'fin':
        d.grupos.push({ titulo: 'Últimas palabras', clase: 'secIn', total: n.secIn.size, items: lista(n.secIn, 'secIn') });
        break;
      default:
        break;
    }
    return d;
  }

  buscar(texto) {
    const t = String(texto || '').trim().toLocaleLowerCase('es');
    const id = this.lexico.get(t);
    return id ? this.nodo(id) : null;
  }

  resumen() {
    const tipos = { palabra: 0, concepto: 0, hipo: 0, inhib: 0, inicio: 0, fin: 0 };
    let sec = 0, asoc = 0, miembros = 0;
    for (const n of this.neuronas.values()) {
      tipos[n.tipo]++;
      if (n.sec) sec += n.sec.size;
      if (n.asoc) asoc += n.asoc.size;
      if (n.miembros) miembros += n.miembros.size;
    }
    asoc /= 2;
    let celdas = 0;
    for (const ep of this.episodios.values()) celdas += ep.celdas.length;
    let inhib = 0;
    for (const id of this.inhibidoras) inhib += this.neuronas.get(id).grupo.size;
    return {
      neuronas: this.neuronas.size,
      tipos,
      sinapsis: Math.round(sec + asoc + miembros + celdas * 2 + inhib),
      detalleSinapsis: { secuencia: sec, asociacion: Math.round(asoc), conceptos: miembros, hipocampo: celdas * 2, inhibicion: inhib },
      recuerdos: this.episodios.size,
      celdasHipocampo: celdas,
      capacidadHipocampo: this.ajustes.aprendizaje.capacidadHipocampo,
      creado: this.creado,
      contadores: { ...this.contadores },
    };
  }

  // ─────────────────────────── guardar ───────────────────────────

  aJSON() {
    const neuronas = [];
    const sec = [], asoc = [], miembros = [];
    for (const n of this.neuronas.values()) {
      const o = { i: n.id, t: n.tipo, x: r1(n.x), y: r1(n.y), n: n.nacida };
      if (n.disparos) o.d = n.disparos;
      if (n.inh) o.h = n.inh;
      switch (n.tipo) {
        case 'palabra':
          o.p = n.texto; o.f = n.frec;
          if (n.mayus) o.m = n.mayus;
          if (n.medio) o.md = n.medio;
          break;
        case 'concepto': o.u = n.usos; if (n.categoria) o.g = 1; break;
        case 'hipo': o.e = n.episodio; o.o = n.pos; o.w = n.palabra; break;
        case 'inhib': o.r = n.region; break;
        default: o.l = n.etiqueta; break;
      }
      neuronas.push(o);
      if (n.sec) for (const [b, w] of n.sec) sec.push(n.id, b, r5(w));
      if (n.asoc) for (const [b, w] of n.asoc) if (n.id < b) asoc.push(n.id, b, r5(w));
      if (n.miembros) for (const [b, w] of n.miembros) miembros.push(n.id, b, r5(w));
    }
    const episodios = [...this.episodios.values()].map((e) => ({
      i: e.id, c: e.celdas, cr: e.creado, so: r3(e.sorpresa), im: r3(e.importancia), re: e.repasos,
    }));
    return {
      formato: 1,
      app: 'Rubenchuelo',
      creado: this.creado,
      guardado: Date.now(),
      sigId: this.sigId,
      sigEpisodio: this.sigEpisodio,
      inicio: this.inicio,
      fin: this.fin,
      estado: { ...this.estado, aturdidoHasta: 0, bostezoPendiente: false },
      contadores: this.contadores,
      neuronas, sec, asoc, miembros, episodios,
    };
  }

  static desdeJSON(d, ajustes, opciones = {}) {
    if (!d || d.formato !== 1 || !Array.isArray(d.neuronas)) throw new Error('Este archivo no parece un cerebro de Rubenchuelo');
    const c = new Cerebro(ajustes, { ...opciones, vacio: true });
    c.creado = d.creado || Date.now();
    c.sigId = d.sigId;
    c.sigEpisodio = d.sigEpisodio || 1;
    c.inicio = d.inicio;
    c.fin = d.fin;
    Object.assign(c.estado, d.estado || {});
    Object.assign(c.contadores, d.contadores || {});
    for (const o of d.neuronas) {
      const n = { id: o.i, tipo: o.t, x: o.x || 0, y: o.y || 0, nacida: o.n || Date.now(), disparos: o.d || 0, inh: o.h || null };
      switch (o.t) {
        case 'palabra': {
          Object.assign(n, {
            texto: o.p, frec: o.f || 0, mayus: o.m || 0, medio: o.md || 0,
            sec: new Map(), secIn: new Map(), asoc: new Map(), conceptos: new Map(), hipos: new Set(),
          });
          c.lexico.set(o.p, o.i);
          const r = raiz(o.p);
          if (r) {
            let g = c.raices.get(r);
            if (!g) c.raices.set(r, (g = new Set()));
            g.add(o.i);
          }
          break;
        }
        case 'concepto':
          Object.assign(n, { miembros: new Map(), usos: o.u || 0, categoria: Boolean(o.g) });
          c.conceptos.add(o.i);
          break;
        case 'hipo': Object.assign(n, { episodio: o.e, pos: o.o, palabra: o.w }); break;
        case 'inhib': Object.assign(n, { grupo: new Set(), region: o.r || 'corteza' }); c.inhibidoras.add(o.i); break;
        case 'inicio':
        case 'fin': Object.assign(n, { etiqueta: o.l, sec: new Map(), secIn: new Map() }); break;
        default: continue;
      }
      c.neuronas.set(n.id, n);
    }
    if (!c.neuronas.has(c.inicio) || !c.neuronas.has(c.fin)) throw new Error('Al cerebro le faltan las neuronas de inicio y fin');
    for (const n of c.neuronas.values()) {
      if (!n.inh) continue;
      const g = c.neuronas.get(n.inh);
      if (g && g.grupo) g.grupo.add(n.id); else n.inh = null;
    }
    const sec = d.sec || [];
    for (let i = 0; i < sec.length; i += 3) {
      const a = c.neuronas.get(sec[i]), b = c.neuronas.get(sec[i + 1]);
      if (a && b && a.sec && b.secIn) { a.sec.set(b.id, sec[i + 2]); b.secIn.set(a.id, sec[i + 2]); }
    }
    const asoc = d.asoc || [];
    for (let i = 0; i < asoc.length; i += 3) {
      const a = c.neuronas.get(asoc[i]), b = c.neuronas.get(asoc[i + 1]);
      if (a && b && a.asoc && b.asoc) { a.asoc.set(b.id, asoc[i + 2]); b.asoc.set(a.id, asoc[i + 2]); }
    }
    const mi = d.miembros || [];
    for (let i = 0; i < mi.length; i += 3) {
      const a = c.neuronas.get(mi[i]), b = c.neuronas.get(mi[i + 1]);
      if (a && b && a.miembros && b.conceptos) { a.miembros.set(b.id, mi[i + 2]); b.conceptos.set(a.id, mi[i + 2]); }
    }
    for (const e of d.episodios || []) {
      const celdas = (e.c || []).filter((id) => {
        const n = c.neuronas.get(id);
        return n && n.tipo === 'hipo' && c.neuronas.get(n.palabra)?.tipo === 'palabra';
      });
      if (!celdas.length) continue;
      celdas.forEach((id, pos) => {
        const n = c.neuronas.get(id);
        n.pos = pos;
        n.episodio = e.i;
        c.neuronas.get(n.palabra).hipos.add(id);
      });
      c.episodios.set(e.i, {
        id: e.i, celdas, creado: e.cr || Date.now(), sorpresa: e.so || 0, importancia: e.im ?? 0.5,
        repasos: e.re || 0, planeados: 0, consolidado: false,
      });
    }
    // Células sueltas (de un recuerdo que no se pudo recuperar) se eliminan.
    for (const n of [...c.neuronas.values()]) {
      if (n.tipo === 'hipo' && !c.episodios.has(n.episodio)) {
        c.neuronas.get(n.inh)?.grupo.delete(n.id);
        c.neuronas.delete(n.id);
      }
    }
    for (const id of c.inhibidoras) {
      const inh = c.neuronas.get(id);
      if (inh.grupo.size < TAM_GRUPO_INHIB) c._abiertas[inh.region] = id;
    }
    c.version = 1;
    c.sucio = false;
    c._nacidas = [];
    c._muertas = [];
    return c;
  }
}

// Peso mínimo para quedarse con como mucho `max` conexiones (histograma, O(n)).
function umbralPara(arr, paso, off, max) {
  const total = arr.length / paso;
  if (total <= max) return 0;
  const bins = new Uint32Array(200);
  for (let i = off; i < arr.length; i += paso) bins[Math.min(199, Math.floor(arr[i] * 200))]++;
  let acum = 0;
  for (let b = 199; b >= 0; b--) {
    acum += bins[b];
    if (acum > max) return (b + 1) / 200;
  }
  return 0;
}

module.exports = { Cerebro, CODIGOS };
