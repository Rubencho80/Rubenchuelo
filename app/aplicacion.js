'use strict';
// Une el cerebro, el sueño, la lectura, el reloj y el guardado, y es lo que
// usa la API. Cada acción de la interfaz o de otra app pasa por aquí.

const crypto = require('crypto');
const { spawn } = require('child_process');
const { Cerebro } = require('./nucleo/cerebro');
const { Sueno } = require('./nucleo/sueno');
const { Lectura } = require('./nucleo/lectura');
const { Reloj } = require('./nucleo/reloj');
const { Difusor } = require('./nucleo/eventos');
const { actualizarAjustesCerebro, actualizarAjustesApp, AJUSTES_CEREBRO, AJUSTES_APP } = require('./nucleo/ajustes');
const D = require('./nucleo/disposicion');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Oido, Whisper, filtrarFrase, disponible: oidoDisponible, whisperDisponible } = require('./nucleo/oido');
const { frasesDe } = require('./nucleo/texto');

const MAX_CHAT = 300;
const r3 = (x) => Math.round(x * 1000) / 1000;
const miles = (n) => Number(n || 0).toLocaleString('es-ES');

class ErrorHttp extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

const MOTIVOS = {
  manual: 'porque se lo has pedido',
  horario: 'porque es su hora de dormir',
  temporizador: 'porque llevaba mucho rato despierto',
  agotado: 'porque estaba agotado',
  api: 'porque se lo ha pedido otra aplicación',
};

function duracionTexto(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

class Aplicacion {
  constructor({ almacen, ajustesApp }) {
    this.almacen = almacen;
    this.ajustesApp = ajustesApp;
    this.difusor = new Difusor();
    this.chat = [];
    this.sigChat = 1;
    this.actividadExterna = [];
    this.puerto = null;
    this.cerebro = null;
    this.nombreCerebro = null;
    this.ultimoGuardado = null;
    this.alSalir = () => {};
    this._guardando = null;
    this._suenoEnCurso = null;
    this._resumen = null;
    this._mapa = null;
    this._intervalos = [];
    this.oido = new Oido({ alMensaje: (m) => this._alOir(m) });
    this.whisper = new Whisper();
    this._colaOido = Promise.resolve();
    this.escucha = { quiere: false, frases: 0, descartadas: 0, error: null, sesion: null };
  }

  iniciarDifusion() {
    this._intervalos.push(setInterval(() => this._volcarCambios(), 250));
    this._intervalos.push(setInterval(() => this.difusor.emitir('estado', this.estadoPublico()), 1500));
  }

  _volcarCambios() {
    if (!this.cerebro) return;
    const { nacidas, muertas } = this.cerebro.tomarCambios();
    if (nacidas.length || muertas.length) {
      this.difusor.emitir('neuronas', { nacidas, muertas, version: this.cerebro.version });
    }
  }

  // ─────────────────────────── cerebro activo ───────────────────────────

  async cargarCerebro(nombre, { guardarAnterior = true } = {}) {
    if (this.cerebro) await this._soltarCerebro({ guardar: guardarAnterior });
    const limpio = this.almacen.validarNombre(nombre);
    if (!this.almacen.existeCerebro(limpio)) this.almacen.crearCerebro(limpio);
    this.nombreCerebro = limpio;
    this.ajustesCerebro = this.almacen.cargarAjustesCerebro(limpio);
    const opciones = { emitir: (tipo, datos) => this._eventoCerebro(tipo, datos) };
    const r = this.almacen.cargarCerebro(limpio, this.ajustesCerebro, opciones);
    let nuevo = false;
    if (r.cerebro) {
      this.cerebro = r.cerebro;
    } else {
      if (r.habiaArchivos) this.almacen.apartarRoto(limpio);
      this.cerebro = new Cerebro(this.ajustesCerebro, opciones);
      nuevo = true;
    }
    D.colocarHipocampo(this.cerebro);
    if (D.necesitaReparto(this.cerebro)) D.repartir(this.cerebro);
    this.cerebro.tomarCambios();
    this.diario = this.almacen.leerDiario(limpio);
    this.sueno = new Sueno({
      cerebro: this.cerebro,
      ajustes: () => this.ajustesCerebro,
      emitir: (t, d) => this._eventoSueno(t, d),
    });
    this.lectura = new Lectura({
      cerebro: this.cerebro,
      emitir: (t, d) => this._eventoLectura(t, d),
      puedeLeer: () => !this.sueno.activo,
    });
    this.reloj = new Reloj(this);
    this.reloj.iniciar();
    this._resumen = null;
    this.chat = [];
    if (nuevo) {
      await this.guardar();
      this.notaSistema(r.habiaArchivos
        ? 'No he podido leer el cerebro guardado (lo he apartado sin borrarlo) y he empezado uno nuevo.'
        : 'Rubenchuelo acaba de nacer: todavía no conoce ninguna palabra. Háblale con frases sencillas y luego pregúntale.', { bienvenida: true });
    } else {
      const s = this.cerebro.resumen();
      this.notaSistema(`Rubenchuelo se ha despertado con ${miles(s.neuronas)} neuronas y ${miles(s.sinapsis)} conexiones.`, { bienvenida: s.tipos.palabra < 3 });
      if (r.desde && r.desde !== 'cerebro.json.gz') this.notaSistema(`Aviso: el archivo principal estaba dañado y he cargado «${r.desde}».`);
    }
    this.difusor.emitir('cerebro', { nombre: limpio });
    return { nuevo, desde: r.desde, errores: r.errores };
  }

  async _soltarCerebro({ guardar = true } = {}) {
    if (this.escucha.quiere) this.escuchar(false);
    if (this.reloj) this.reloj.parar();
    if (this.lectura) this.lectura.detener();
    if (this.sueno && this.sueno.activo) {
      this.sueno.despertar('cambio de cerebro');
      await this._suenoEnCurso;
    }
    if (guardar) await this.guardar();
    try { this.almacen.guardarDiario(this.nombreCerebro, this.diario); } catch (e) { console.error(e.message); }
    this.cerebro = null;
  }

  // ─────────────────────────── chat ───────────────────────────

  agregarChat(entrada) {
    const e = { id: this.sigChat++, cuando: Date.now(), ...entrada };
    this.chat.push(e);
    if (this.chat.length > MAX_CHAT) this.chat.splice(0, this.chat.length - MAX_CHAT);
    this.difusor.emitir('chat', e);
    return e;
  }

  notaSistema(texto, extra = {}) {
    return this.agregarChat({ de: 'sistema', texto, ...extra });
  }

  registrarExterno(accion, detalle) {
    const e = { cuando: Date.now(), accion, detalle };
    this.actividadExterna.unshift(e);
    if (this.actividadExterna.length > 30) this.actividadExterna.pop();
    this.difusor.emitir('externo', e);
  }

  async mensaje(texto, origen = 'interfaz') {
    texto = String(texto ?? '').trim().slice(0, 4000);
    if (!texto) throw new ErrorHttp(400, 'El mensaje está vacío');
    let desperto = false;
    if (this.sueno.activo) {
      if (!this.ajustesCerebro.sueno.despertarAlHablarle) {
        this.agregarChat({ de: 'tu', texto, origen, ignorado: true });
        this.agregarChat({ de: 'rubenchuelo', texto: 'Zzz…', durmiendo: true });
        return { id: null, texto: 'Zzz…', modo: 'durmiendo', durmiendo: true };
      }
      await this.despertar('le has hablado');
      desperto = true;
    }
    const r = this.cerebro.conversar(texto);
    if (origen !== 'interfaz') this.registrarExterno('mensaje', texto.slice(0, 80));
    this.agregarChat({ de: 'tu', texto, origen, aprendido: r.oido });
    this.agregarChat({ de: 'rubenchuelo', texto: r.texto, respuesta: r.id, modo: r.modo, origen });
    return { id: r.id, texto: r.texto, modo: r.modo, aprendido: r.oido, desperto };
  }

  opinar(id, valor) {
    if (!Number.isFinite(id) || ![1, -1].includes(valor)) throw new ErrorHttp(400, 'Hace falta el id de la respuesta y valor 1 o -1');
    const r = this.cerebro.recompensar(id, valor);
    if (!r) throw new ErrorHttp(404, 'Esa respuesta ya no está en su memoria a corto plazo');
    for (const e of this.chat) {
      if (e.respuesta === id) {
        e.valor = valor;
        this.difusor.emitir('chat_valor', { id: e.id, valor });
      }
    }
    return r;
  }

  explicar(id) {
    const r = this.cerebro.explicar(id);
    if (!r) throw new ErrorHttp(404, 'Ya no recuerda por qué dijo eso (solo guarda las últimas respuestas)');
    return r;
  }

  estimular(id) {
    if (this.sueno.activo) throw new ErrorHttp(409, 'Está dormido: despiértalo para estimular neuronas');
    const r = this.cerebro.estimular(id);
    if (!r) throw new ErrorHttp(404, 'Esa neurona ya no existe');
    this.agregarChat({ de: 'rubenchuelo', texto: r.texto, estimulo: r.neurona, respuesta: r.id, modo: 'estimulo' });
    return r;
  }

  // ─────────────────────────── lectura ───────────────────────────

  aprender(texto, fuente, origen = 'interfaz', repasos) {
    const max = this.ajustesApp.maxTextoMB * 1048576;
    if (String(texto ?? '').length > max) throw new ErrorHttp(413, `El texto es demasiado grande (máximo ${this.ajustesApp.maxTextoMB} MB)`);
    const t = this.lectura.encolar(texto, fuente || (origen === 'interfaz' ? 'texto' : 'otra aplicación'), { repasos });
    if (origen !== 'interfaz') this.registrarExterno('aprender', `«${t.fuente}» · ~${miles(t.palabrasAprox)} palabras`);
    const espera = this.sueno.activo ? ' Está dormido: lo leerá al despertar.' : '';
    const vueltas = t.repasos > 1 ? ` Lo repasará entero ${miles(t.repasos)} veces.` : '';
    this.notaSistema(`📥 Le ha llegado un texto para leer: «${t.fuente}» (unas ${miles(t.palabrasAprox)} palabras).${vueltas}${espera}`);
    return t;
  }

  // ─────────────────────────── oído ───────────────────────────
  // Modo escuchar: aprende de lo que oye por el micrófono, sin contestar.

  estadoOido() {
    const e = this.escucha;
    return {
      disponible: oidoDisponible(), activo: e.quiere, oyendo: this.oido.listo,
      motor: this.whisper.listo && this.whisper.gpu ? 'whisper' : 'vosk',
      cargandoWhisper: this.whisper.activo && !this.whisper.listo, whisper: whisperDisponible(),
      frases: e.frases, descartadas: e.descartadas, error: e.error,
    };
  }

  escuchar(si) {
    if (si && !this.escucha.quiere) {
      if (!oidoDisponible()) throw new ErrorHttp(409, 'Falta el oído: la carpeta «oido» con el programa y el modelo de voz');
      this.escucha = { quiere: true, frases: 0, descartadas: 0, error: null, sesion: { palabras: 0, nuevas: 0, conceptos: 0, hipo: 0 } };
      if (!this.sueno.activo) this._arrancarOido();
      this.notaSistema(`👂 Escuchando: aprenderá de lo que oiga, sin contestar.${this.sueno.activo ? ' Ahora duerme: empezará al despertar.' : ''}`);
    } else if (!si && this.escucha.quiere) {
      this.escucha.quiere = false;
      this._pararOido();
      const e = this.escucha;
      this.notaSistema(`🔇 Ha dejado de escuchar. Ha aprendido ${miles(e.frases)} ${e.frases === 1 ? 'frase' : 'frases'}`
        + `${e.descartadas ? ` y ha descartado ${miles(e.descartadas)} que no entendió bien` : ''}.`);
      this.guardar();
    }
    this.difusor.emitir('oido', { tipo: 'estado', ...this.estadoOido() });
    return this.estadoOido();
  }

  _arrancarOido() {
    const conWhisper = this.ajustesApp.oido.motor === 'whisper' && whisperDisponible();
    try {
      this.oido.arrancar(this.ajustesApp.oido, conWhisper ? path.join(os.tmpdir(), 'rubenchuelo-oido') : null);
    } catch (e) {
      this._falloOido(e.message);
      return;
    }
    if (!conWhisper) return;
    // Whisper tarda unos segundos en cargar el modelo en la tarjeta: mientras, oye Vosk.
    this.whisper.arrancar().then((ok) => {
      if (!this.escucha.quiere) return;
      if (ok && !this.whisper.gpu) {
        this.whisper.parar();
        this.notaSistema('👂 Este ordenador no tiene una tarjeta NVIDIA para Whisper (sería demasiado lento): sigue escuchando con Vosk.');
      } else if (!ok) {
        this.notaSistema('👂 No se ha podido arrancar Whisper: sigue escuchando con Vosk.');
      }
      this.difusor.emitir('oido', { tipo: 'estado', ...this.estadoOido() });
    });
    this.difusor.emitir('oido', { tipo: 'estado', ...this.estadoOido() });
  }

  _pararOido() {
    this.oido.parar();
    this.whisper.parar();
  }

  _falloOido(mensaje) {
    this.escucha.quiere = false;
    this.escucha.error = mensaje;
    this._pararOido();
    this.notaSistema(`⚠️ No puede escuchar: ${mensaje}`);
    this.difusor.emitir('oido', { tipo: 'estado', ...this.estadoOido() });
  }

  _alOir(m) {
    switch (m.tipo) {
      case 'nivel':
      case 'parcial':
        this.difusor.emitir('oido', m, { prescindible: true });
        break;
      case 'listo':
        this.difusor.emitir('oido', { tipo: 'estado', ...this.estadoOido() });
        break;
      case 'frase':
        // Una detrás de otra: Whisper tarda un momento en cada una.
        this._colaOido = this._colaOido.then(() => this._procesarFrase(m)).catch((e) => console.error('Error en el oído:', e));
        break;
      case 'error':
        this._falloOido(m.mensaje || 'error del oído');
        break;
      case 'fin':
        // En las pruebas se oye una grabación: al acabarse, se terminan las frases pendientes.
        if (process.env.RUBENCHUELO_OIDO_ARCHIVO) this._colaOido.then(() => this.escuchar(false));
        else if (this.escucha.quiere && !this.sueno.activo) this._falloOido('el oído se ha cerrado');
        else this.difusor.emitir('oido', { tipo: 'estado', ...this.estadoOido() });
        break;
      default:
        break;
    }
  }

  // Si hay Whisper, vuelve a escuchar la frase con él; si no (o falla), vale lo de Vosk.
  async _procesarFrase(m) {
    let palabras = m.palabras;
    let motor = 'vosk';
    try {
      if (m.audio && this.whisper.activo) {
        if (!this.whisper.listo) await Promise.race([this.whisper._preparado, new Promise((r) => setTimeout(r, 20000))]);
        if (this.whisper.listo && this.whisper.gpu) {
          const r = await this.whisper.transcribir(m.audio);
          motor = 'whisper';
          palabras = r.palabras;
          if (r.idioma && !/^(spanish|es)$/i.test(r.idioma)) {
            if (this.escucha.quiere) this._descartarOido(palabras.map(([w]) => w).join(' '), 1, 'otro idioma', motor);
            return;
          }
        }
      }
    } catch (e) {
      console.warn('Whisper no ha podido con una frase; vale la de Vosk:', e.message);
      palabras = m.palabras;
      motor = 'vosk';
    } finally {
      if (m.audio) fs.promises.unlink(m.audio).catch(() => {});
    }
    if (this.escucha.quiere && this.cerebro && !this.sueno.activo) this._aprenderOido(palabras, motor);
  }

  _descartarOido(texto, media, motivo, motor) {
    this.escucha.descartadas++;
    this.difusor.emitir('oido', { tipo: 'descartada', texto, media, motivo, motor, descartadas: this.escucha.descartadas });
  }

  // Lo oído se aprende como lo leído (más despacio que charlando y sin contestar).
  // Si la seguridad media de la frase es baja, se tira entera.
  _aprenderOido(palabras, motor = 'vosk') {
    const f = filtrarFrase(palabras, this.ajustesApp.oido);
    const media = Math.round(f.media * 100) / 100;
    if (!f.aceptada) {
      if (f.motivo !== 'vacía') this._descartarOido(f.texto, media, 'dudosa', motor);
      return;
    }
    let ids = [];
    let nuevas = 0;
    for (const frase of frasesDe(f.texto)) {
      const r = this.cerebro.leerFrase(frase, this.escucha.sesion);
      ids = ids.concat(r.ids);
      nuevas += r.nuevas.length;
    }
    this.escucha.frases++;
    if (ids.length) {
      this.difusor.emitir('pensamiento', {
        origen: 'oido',
        pasos: [{ disparos: ids.map((id) => [id, 0.9]), inhib: [], senales: ids.slice(1).map((id, i) => [ids[i], id, 0.6]) }],
        ruta: [],
      }, { prescindible: true });
    }
    this.difusor.emitir('oido', { tipo: 'aprendida', texto: f.texto, media, nuevas, motor, frases: this.escucha.frases });
  }

  // ─────────────────────────── sueño ───────────────────────────

  dormir({ duracionMs, motivo = 'manual' } = {}) {
    if (!this.cerebro || this.sueno.activo) return false;
    const nombre = this.nombreCerebro;
    const p = this.sueno.dormir({ duracionMs, motivo });
    this._suenoEnCurso = p
      .then((informe) => this._alDespertar(informe, nombre))
      .then(() => { if (this.escucha.quiere && this.cerebro && !this.sueno.activo) this._arrancarOido(); })
      .catch((e) => console.error('Error durante el sueño:', e));
    return true;
  }

  dormirPeticion(cuerpo = {}, origen = 'interfaz') {
    const min = Number(cuerpo.minutos);
    const duracionMs = Number.isFinite(min) && min > 0 ? Math.min(240, Math.max(0.1, min)) * 60000 : undefined;
    const ok = this.dormir({ duracionMs, motivo: origen === 'interfaz' ? 'manual' : 'api' });
    if (origen !== 'interfaz') this.registrarExterno('dormir', ok ? 'se ha dormido' : 'ya estaba dormido');
    return { ok, sueno: this.sueno.publico() };
  }

  async despertar(motivo = 'manual') {
    if (!this.sueno.activo) return false;
    this.sueno.despertar(motivo);
    await this._suenoEnCurso;
    this.reloj.posponer(10 * 60000);
    return true;
  }

  async _alDespertar(informe, nombre) {
    if (!informe || nombre !== this.nombreCerebro) return;
    const { suenos, ...resto } = informe;
    for (const s of suenos) this.diario.suenos.push(s);
    this.diario.informes.push({ ...resto, numSuenos: suenos.length, ejemplos: suenos.slice(0, 3).map((s) => s.texto) });
    try { this.almacen.guardarDiario(nombre, this.diario); } catch (e) { console.error('No se pudo guardar el diario:', e.message); }
    const dur = duracionTexto(informe.fin - informe.inicio);
    let texto;
    if (informe.completo) {
      texto = `☀️ Se ha despertado tras ${dur} de sueño. Ha consolidado ${informe.consolidados} recuerdos (${informe.repasos} repasos), `
        + `ha soñado ${suenos.length} ${suenos.length === 1 ? 'vez' : 'veces'}, ha creado ${informe.nuevasAsociaciones} asociaciones nuevas `
        + `y ha podado ${miles(informe.podadas)} conexiones débiles.`;
    } else {
      const quedan = informe.recuerdos - informe.consolidados;
      texto = `☀️ Se ha despertado a medias (${informe.despertadoPor || 'interrumpido'}) tras ${dur}. Consolidó ${informe.consolidados} de ${informe.recuerdos} recuerdos`
        + `${quedan > 0 ? `; los otros ${quedan} siguen en el hipocampo` : ''}. Sin poda. Estará aturdido un minuto.`;
    }
    const deducciones = informe.deducciones || [];
    if (deducciones.length) {
      const ejemplos = deducciones.slice(0, 2).map((d) => `«${d.texto.replace(/\.$/, '')}»`).join(' y ');
      texto += ` 💡 Ha deducido ${deducciones.length === 1 ? 'una cosa nueva' : `${deducciones.length} cosas nuevas`}: ${ejemplos}`
        + `${deducciones.length > 2 ? '…' : '.'}`;
    }
    const categorias = informe.categorias || [];
    if (categorias.length) {
      texto += ` 🧩 Ha agrupado palabras que se usan igual: ${categorias.slice(0, 3).map((x) => x.texto).join(', ')}${categorias.length > 3 ? '…' : '.'}`;
    }
    this.notaSistema(texto, { informe: true });
    this.difusor.emitir('informe', { ...resto, suenos });
    await this.guardar();
    if (informe.completo) await this.crearCopia('sueno');
  }

  _eventoCerebro(tipo, datos) {
    if (tipo === 'pensamiento') this.difusor.emitir('pensamiento', datos, { prescindible: true });
  }

  _eventoSueno(tipo, datos) {
    switch (tipo) {
      case 'pensamiento':
        this.difusor.emitir('pensamiento', datos, { prescindible: true });
        break;
      case 'fase':
        this.difusor.emitir('sueno', datos);
        break;
      case 'dormido':
        this._pararOido();   // dormido no escucha; vuelve a escuchar al despertar
        this.notaSistema(`🌙 Se ha dormido ${MOTIVOS[datos.motivo] || ''} (${duracionTexto(datos.duracion)}). Va a repasar ${datos.recuerdos} recuerdos del hipocampo.`, { dormido: true });
        this.difusor.emitir('sueno', this.sueno.publico());
        break;
      case 'sueno':
        this.difusor.emitir('sueno_texto', datos);
        break;
      default:
        break;
    }
  }

  _eventoLectura(tipo, datos) {
    if (tipo === 'pensamiento') {
      this.difusor.emitir('pensamiento', datos, { prescindible: true });
    } else if (tipo === 'lectura') {
      this.difusor.emitir('lectura', datos);
    } else if (tipo === 'lectura_fin') {
      if (datos.estado === 'terminada') {
        this.notaSistema(`📖 Ha terminado de leer «${datos.fuente}»${datos.repasos > 1 ? ` (${miles(datos.repasos)} repasos)` : ''}: ${miles(datos.palabras)} palabras leídas, ${miles(datos.nuevas)} palabras nuevas, `
          + `${miles(datos.conceptos)} conceptos nuevos y ${datos.recuerdos} frases sorprendentes al hipocampo. Le vendría bien dormir.`);
      } else if (datos.estado === 'cancelada') {
        this.notaSistema(`Lectura de «${datos.fuente}» cancelada (lo leído hasta ahí ya está aprendido).`);
      } else if (datos.estado === 'error') {
        this.notaSistema(`⚠️ Hubo un problema leyendo «${datos.fuente}».`);
      }
      this.guardar();
    }
  }

  // ─────────────────────────── estado ───────────────────────────

  resumen() {
    const ahora = Date.now();
    if (!this._resumen || ahora - this._resumen.t > 1000) this._resumen = { t: ahora, r: this.cerebro.resumen() };
    return this._resumen.r;
  }

  // El mapa completo se calcula a ratos (sin frenar al cerebro) y se reutiliza
  // un par de segundos: si lo piden dos ventanas a la vez, se calcula una vez.
  mapaDatos(maxAristas = 6000) {
    const c = this.cerebro;
    const m = this._mapa;
    if (m && m.cerebro === c && m.maxAristas === maxAristas && (m.promesa || Date.now() - m.t < 2000)) {
      return m.promesa || Promise.resolve(m.datos);
    }
    const registro = { cerebro: c, maxAristas, t: 0, datos: null, promesa: null };
    registro.promesa = c.mapaAsincrono({ maxAristas }).then((datos) => {
      registro.datos = datos;
      registro.t = Date.now();
      registro.promesa = null;
      return datos;
    }, (e) => {
      if (this._mapa === registro) this._mapa = null;
      throw e;
    });
    this._mapa = registro;
    return registro.promesa;
  }

  estadoPublico() {
    const c = this.cerebro;
    if (!c) return { cargando: true };
    const e = c.estado;
    return {
      cerebro: this.nombreCerebro,
      despierto: !this.sueno.activo,
      sueno: this.sueno.publico(),
      presion: r3(e.presion),
      dopamina: r3(e.dopamina),
      sorpresa: r3(e.sorpresa),
      aturdido: Date.now() < e.aturdidoHasta,
      msDespierto: Math.round(e.msDespierto),
      resumen: this.resumen(),
      enMente: c.enMente(8),
      version: c.version,
      posiciones: c.epocaPosiciones || 0,
      oido: this.estadoOido(),
      lecturas: this.lectura.lista().filter((t) => ['en_cola', 'leyendo', 'en_pausa'].includes(t.estado)),
      proximo: this.reloj.proximo(),
      guardado: { ultimo: this.ultimoGuardado, pendiente: c.sucio },
      puerto: this.puerto,
    };
  }

  // ─────────────────────────── ajustes ───────────────────────────

  obtenerAjustes() {
    const { token, ...app } = this.ajustesApp;
    const { token: _t, cerebroActivo: _c, ...appDefecto } = AJUSTES_APP;
    return {
      cerebro: this.ajustesCerebro,
      app,
      defecto: { cerebro: AJUSTES_CEREBRO, app: appDefecto },
      puerto: this.puerto,
      raiz: this.almacen.raiz,
    };
  }

  actualizarAjustes(cuerpo = {}) {
    let reinicio = false;
    if (cuerpo.cerebro) {
      this.ajustesCerebro = actualizarAjustesCerebro(this.ajustesCerebro, cuerpo.cerebro);
      this.cerebro.ajustes = this.ajustesCerebro;
      this.almacen.guardarAjustesCerebro(this.nombreCerebro, this.ajustesCerebro);
    }
    if (cuerpo.app) {
      const { token, cerebroActivo, ...parcial } = cuerpo.app;
      const antes = this.ajustesApp;
      const nuevos = actualizarAjustesApp(antes, parcial);
      nuevos.token = antes.token;
      nuevos.cerebroActivo = antes.cerebroActivo;
      reinicio = nuevos.puerto !== antes.puerto || nuevos.accesoRed !== antes.accesoRed;
      this.ajustesApp = nuevos;
      this.almacen.guardarAjustesApp(nuevos);
      if (this.oido.activo && JSON.stringify(antes.oido) !== JSON.stringify(nuevos.oido)) {
        this._pararOido();
        setTimeout(() => { if (this.escucha.quiere && !this.sueno.activo) this._arrancarOido(); }, 300);
      }
    }
    return { ...this.obtenerAjustes(), reinicioNecesario: reinicio };
  }

  nuevoToken() {
    this.ajustesApp.token = crypto.randomBytes(18).toString('base64url');
    this.almacen.guardarAjustesApp(this.ajustesApp);
    return this.ajustesApp.token;
  }

  // ─────────────────────────── cerebros y copias ───────────────────────────

  listarCerebros() {
    return {
      activo: this.nombreCerebro,
      cerebros: this.almacen.listarCerebros().map((c) => ({ ...c, activo: c.nombre === this.nombreCerebro })),
    };
  }

  crearCerebro(nombre) {
    return { nombre: this.almacen.crearCerebro(nombre) };
  }

  async clonarCerebro(origen, destino) {
    if (origen === this.nombreCerebro) await this.guardar();
    return { nombre: this.almacen.clonarCerebro(origen, destino) };
  }

  async usarCerebro(nombre) {
    const limpio = this.almacen.validarNombre(nombre);
    if (!this.almacen.existeCerebro(limpio)) throw new ErrorHttp(404, `No existe el cerebro «${limpio}»`);
    if (limpio === this.nombreCerebro) return { nombre: limpio };
    await this.cargarCerebro(limpio);
    this.ajustesApp.cerebroActivo = limpio;
    this.almacen.guardarAjustesApp(this.ajustesApp);
    return { nombre: limpio };
  }

  archivarCerebro(nombre) {
    if (nombre === this.nombreCerebro) throw new ErrorHttp(409, 'No puedes archivar el cerebro que está en uso; cambia a otro primero');
    this.almacen.archivarCerebro(nombre);
    return { ok: true };
  }

  listarCopias() {
    return { copias: this.almacen.listarCopias(this.nombreCerebro) };
  }

  async crearCopia(etiqueta = 'manual') {
    await this.guardar();
    try {
      return this.almacen.crearCopia(this.nombreCerebro, etiqueta, this.ajustesApp.copiasMaximo);
    } catch (e) {
      console.error('No se pudo crear la copia:', e.message);
      return null;
    }
  }

  async restaurarCopia(archivo) {
    const nombre = this.nombreCerebro;
    await this._soltarCerebro({ guardar: true });
    this.almacen.crearCopia(nombre, 'antes-de-restaurar', this.ajustesApp.copiasMaximo + 1);
    try {
      this.almacen.restaurarCopia(nombre, archivo, this.ajustesCerebro);
    } finally {
      await this.cargarCerebro(nombre, { guardarAnterior: false });
    }
    this.notaSistema(`Se ha restaurado la copia «${archivo}». El estado anterior está guardado como copia «antes-de-restaurar».`);
    return { ok: true };
  }

  // ─────────────────────────── guardar y salir ───────────────────────────

  guardar() {
    if (!this.cerebro) return Promise.resolve(null);
    if (this._guardando) return this._guardando;
    const cerebro = this.cerebro;
    const nombre = this.nombreCerebro;
    this._guardando = (async () => {
      try {
        const r = await this.almacen.guardarCerebro(nombre, cerebro);
        this.ultimoGuardado = Date.now();
        return r;
      } catch (e) {
        console.error('No se pudo guardar el cerebro:', e.message);
        this.notaSistema(`⚠️ No se pudo guardar: ${e.message}`);
        return null;
      } finally {
        this._guardando = null;
      }
    })();
    return this._guardando;
  }

  guardarSync() {
    if (!this.cerebro) return;
    this.almacen.guardarCerebroSync(this.nombreCerebro, this.cerebro);
    this.almacen.guardarDiario(this.nombreCerebro, this.diario);
  }

  abrirCarpeta(que) {
    const ruta = que === 'raiz' ? this.almacen.raiz : this.almacen.rutaCerebro(this.nombreCerebro);
    const programa = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try {
      spawn(programa, [ruta], { detached: true, stdio: 'ignore' }).unref();
    } catch (e) {
      throw new ErrorHttp(500, `No se pudo abrir la carpeta: ${e.message}`);
    }
    return { ok: true, ruta };
  }

  cerrar() {
    this._pararOido();
    for (const i of this._intervalos) clearInterval(i);
    if (this.reloj) this.reloj.parar();
    if (this.lectura) this.lectura.detener();
    try { this.guardarSync(); } catch (e) { console.error('No se pudo guardar al salir:', e.message); }
    this.almacen.soltarCandado(process.pid);
    this.difusor.cerrar();
  }

  salir() {
    this.notaSistema('💾 Guardado. Rubenchuelo se ha ido a dormir a casa: ya puedes cerrar esta pestaña y quitar el pendrive.', { salida: true });
    this.alSalir();
    return { ok: true };
  }
}

module.exports = { Aplicacion, ErrorHttp };
