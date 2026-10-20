'use strict';
// El reloj: pasa el tiempo (cansancio, dopamina), mueve el mapa poco a poco,
// decide cuándo dormir (horario, temporizador, agotamiento) y autoguarda.

const D = require('./disposicion');

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function minutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ¿Estamos dentro de alguna ventana de sueño del horario?
function ventanaActiva(horario, fecha = new Date()) {
  const ahoraMin = fecha.getHours() * 60 + fecha.getMinutes() + fecha.getSeconds() / 60;
  const dia = fecha.getDay();
  for (let i = 0; i < horario.length; i++) {
    const v = horario[i];
    if (!v.activo) continue;
    const ini = minutos(v.inicio);
    const fin = minutos(v.fin);
    if (ini === fin) continue;
    let dentro = false;
    let diaInicio = dia;
    let restante = 0;
    if (ini < fin) {
      dentro = ahoraMin >= ini && ahoraMin < fin;
      restante = fin - ahoraMin;
    } else if (ahoraMin >= ini) {
      dentro = true;
      restante = 1440 - ahoraMin + fin;
    } else if (ahoraMin < fin) {
      dentro = true;
      diaInicio = (dia + 6) % 7;
      restante = fin - ahoraMin;
    }
    if (!dentro || !v.dias.includes(diaInicio)) continue;
    const f0 = new Date(fecha);
    if (diaInicio !== dia) f0.setDate(f0.getDate() - 1);
    return {
      indice: i,
      clave: `${i}-${f0.getFullYear()}-${f0.getMonth()}-${f0.getDate()}-${v.inicio}`,
      restanteMs: Math.round(restante * 60000),
    };
  }
  return null;
}

// Próxima vez que el horario lo mandará a dormir (para enseñarlo en pantalla).
function proximaVentana(horario, desde = new Date()) {
  let mejor = null;
  for (const v of horario) {
    if (!v.activo || !v.dias.length || v.inicio === v.fin) continue;
    for (let d = 0; d < 8; d++) {
      const f = new Date(desde);
      f.setDate(f.getDate() + d);
      const [h, m] = v.inicio.split(':').map(Number);
      f.setHours(h, m, 0, 0);
      if (f <= desde || !v.dias.includes(f.getDay())) continue;
      if (!mejor || f < mejor) mejor = f;
      break;
    }
  }
  return mejor;
}

class Reloj {
  constructor(app) {
    this.app = app;
    this.ultimo = Date.now();
    this.ventanasHechas = new Set();
    this.noAntesDe = 0;
    this.ultimoGuardado = Date.now();
    this.ultimaCopia = Date.now();
    this.ultimoReparto = Date.now();
    this.intervalo = null;
  }

  iniciar() {
    this.parar();
    this.ultimo = Date.now();
    // Si arranca dentro de una ventana de sueño, no la usa hasta la siguiente
    // vez que entre (evita dormirse nada más abrirlo).
    const v = ventanaActiva(this.app.ajustesCerebro.sueno.horario);
    if (v) this.ventanasHechas.add(v.clave);
    this.intervalo = setInterval(() => {
      try { this.tick(); } catch (e) { console.error('Error en el reloj:', e); }
    }, 1000);
  }

  parar() {
    if (this.intervalo) clearInterval(this.intervalo);
    this.intervalo = null;
  }

  posponer(ms) {
    this.noAntesDe = Date.now() + ms;
  }

  tick() {
    const app = this.app;
    const c = app.cerebro;
    if (!c) return;
    const ahora = Date.now();
    const dt = Math.min(5000, Math.max(0, ahora - this.ultimo));  // si el PC estuvo suspendido no cuenta
    this.ultimo = ahora;
    const durmiendo = app.sueno.activo;
    c.pasarTiempo(dt, !durmiendo);
    D.iterar(c, durmiendo ? 5000 : 2000);   // durmiendo se reorganiza más
    // Si se ha apiñado (por ejemplo, tras leer un libro entero), se reparte de golpe.
    if (ahora - this.ultimoReparto >= 600000) {
      this.ultimoReparto = ahora;
      if (D.necesitaReparto(c)) D.repartir(c);
    }
    if (!durmiendo) this._quizaDormir(ahora);
    this._quizaGuardar(ahora);
  }

  _quizaDormir(ahora) {
    const app = this.app;
    const aj = app.ajustesCerebro.sueno;
    const v = ventanaActiva(aj.horario, new Date(ahora));
    if (v && !this.ventanasHechas.has(v.clave)) {
      this.ventanasHechas.add(v.clave);
      if (v.restanteMs >= 30000) {
        app.dormir({ duracionMs: v.restanteMs, motivo: 'horario' });
        return;
      }
    }
    if (ahora < this.noAntesDe) return;
    const c = app.cerebro;
    if (aj.temporizador.activo && c.estado.msDespierto >= aj.temporizador.horasDespierto * 3600e3) {
      app.dormir({ motivo: 'temporizador' });
      return;
    }
    if (aj.dormirAlAgotarse && c.estado.presion >= 1 && !app.lectura.ocupada) {
      app.dormir({ motivo: 'agotado' });
    }
  }

  _quizaGuardar(ahora) {
    const app = this.app;
    const aa = app.ajustesApp;
    if (app.cerebro.sucio && ahora - this.ultimoGuardado >= aa.autoguardadoMin * 60000) {
      this.ultimoGuardado = ahora;
      app.guardar();
    }
    if (ahora - this.ultimaCopia >= aa.copiaCadaHoras * 3600e3) {
      this.ultimaCopia = ahora;
      app.crearCopia('auto');
    }
  }

  proximo() {
    const app = this.app;
    const aj = app.ajustesCerebro.sueno;
    const c = app.cerebro;
    const res = {};
    const f = proximaVentana(aj.horario);
    if (f) res.horario = { cuando: f.getTime(), dia: DIAS[f.getDay()] };
    if (aj.temporizador.activo) {
      res.temporizador = { faltaMs: Math.max(0, aj.temporizador.horasDespierto * 3600e3 - c.estado.msDespierto) };
    }
    return res;
  }
}

module.exports = { Reloj, ventanaActiva, proximaVentana };
