'use strict';
/*
 * El sueño de Rubenchuelo.
 *
 * Una noche tiene varios ciclos. Cada ciclo: fase profunda (NREM), donde se
 * repasan los recuerdos del hipocampo intercalados con recuerdos antiguos, y
 * fase REM, donde sueña mezclando cosas. Al principio de la noche domina la
 * fase profunda y al final el REM, como en las personas. Si la noche termina
 * entera: se vacía el hipocampo consolidado y se poda. Si se le despierta: la
 * consolidación queda a medias y se queda aturdido un rato.
 */

const r3 = (x) => Math.round(x * 1000) / 1000;

class Sueno {
  constructor({ cerebro, ajustes, emitir = () => {} }) {
    this.cerebro = cerebro;
    this.ajustes = ajustes;        // función: devuelve los ajustes actuales del cerebro
    this.emitir = emitir;
    this.activo = false;
    this.estado = null;
    this.minimoMs = 5000;          // duración mínima de una noche (las pruebas la bajan)
    this._interrumpir = false;
    this._timer = null;
    this._despertador = null;
    this._fin = null;
  }

  publico() {
    if (!this.activo || !this.estado) return { durmiendo: false };
    const e = this.estado;
    return {
      durmiendo: true,
      fase: e.fase,
      ciclo: e.ciclo + 1,
      ciclos: e.ciclos,
      progreso: r3(Math.min(1, (Date.now() - e.inicio) / e.duracion)),
      motivo: e.motivo,
      inicio: e.inicio,
      finPrevisto: e.inicio + e.duracion,
    };
  }

  dormir({ duracionMs, motivo = 'manual' } = {}) {
    if (this.activo) return null;
    this.activo = true;
    this._interrumpir = false;
    this._motivoDespertar = null;
    this._fin = this._noche(duracionMs, motivo).finally(() => {
      this.activo = false;
      this.estado = null;
    });
    return this._fin;
  }

  // Devuelve una promesa que se cumple cuando ya está despierto del todo.
  despertar(motivo = 'manual') {
    if (!this.activo) return Promise.resolve(null);
    this._interrumpir = true;
    this._motivoDespertar = motivo;
    clearTimeout(this._timer);
    if (this._despertador) this._despertador();
    return this._fin;
  }

  _esperar(ms) {
    return new Promise((res) => {
      this._despertador = res;
      this._timer = setTimeout(res, Math.max(0, ms));
    });
  }

  _emitirEstado() {
    this.emitir('fase', this.publico());
  }

  async _noche(duracionMs, motivo) {
    const c = this.cerebro;
    const aj = this.ajustes().sueno;
    const duracion = Math.max(this.minimoMs, duracionMs || aj.duracionMin * 60000);
    const ciclos = aj.ciclos;
    const inicio = Date.now();
    const presionAntes = c.estado.presion;
    const despiertoAntes = c.estado.msDespierto;
    const informe = {
      inicio, motivo, completo: false, presionAntes: r3(presionAntes),
      recuerdos: 0, consolidados: 0, repasos: 0, ensayos: 0, suenos: [],
      nuevasAsociaciones: 0, podadas: 0, eliminadas: 0, olvidados: 0, hipnograma: [],
      deducciones: [], categorias: [],
    };
    this.estado = { fase: 'dormirse', ciclo: 0, ciclos, inicio, duracion, motivo, presionAntes };
    c.memoriaTrabajo.clear();          // al dormirse se le va de la cabeza lo que tenía en mente
    this._vistas = new Set();          // deducciones ya hechas esta noche
    this._porAgrupar = aj.agrupar ? this._palabrasParaAgrupar() : [];
    this._porCiclo = Math.ceil(this._porAgrupar.length / ciclos);

    // Plan: cada recuerdo se repasa en tantos ciclos como importante sea.
    for (const ep of c.episodios.values()) {
      if (ep.consolidado) continue;
      const deseados = Math.max(1, Math.min(ciclos, Math.round(1 + ep.importancia * (ciclos - 1))));
      ep.planeados = ep.repasos + Math.max(1, deseados - ep.repasos);
      informe.recuerdos++;
    }
    this.emitir('dormido', { motivo, duracion, ciclos, recuerdos: informe.recuerdos });

    const msCiclo = duracion / ciclos;
    for (let i = 0; i < ciclos && !this._interrumpir; i++) {
      this.estado.ciclo = i;
      const fNrem = Math.max(0.35, 0.8 - 0.15 * i);
      await this._fase('nrem', msCiclo * fNrem, informe);
      if (this._interrumpir) break;
      await this._fase('rem', msCiclo * (1 - fNrem), informe);
    }

    const progreso = Math.min(1, (Date.now() - inicio) / duracion);
    informe.olvidados = c.olvidarConsolidados();
    if (!this._interrumpir) {
      informe.completo = true;
      this.estado.fase = 'poda';
      this._emitirEstado();
      const ajFin = this.ajustes().sueno;
      const p = c.homeostasis(ajFin.fuerzaPoda, ajFin.umbralPoda);
      informe.podadas = p.podadas;
      informe.eliminadas = p.eliminadas;
      c.estado.presion = 0;
      c.estado.msDespierto = 0;
    } else {
      c.estado.presion = presionAntes * (1 - progreso);
      c.estado.msDespierto = despiertoAntes * (1 - progreso);
      c.estado.aturdidoHasta = Date.now() + 60000;
      c.estado.bostezoPendiente = true;
      informe.despertadoPor = this._motivoDespertar;
    }
    c.contadores.suenos++;
    informe.fin = Date.now();
    informe.presionDespues = r3(c.estado.presion);
    return informe;
  }

  async _fase(fase, ms, informe) {
    const c = this.cerebro;
    const t0 = Date.now();
    this.estado.fase = fase;
    const tramo = { fase, desde: t0, hasta: t0 };
    informe.hipnograma.push(tramo);
    this._emitirEstado();

    const tareas = [];
    if (fase === 'nrem') {
      const pendientes = [...c.episodios.values()]
        .filter((ep) => !ep.consolidado && ep.repasos < ep.planeados)
        .sort((a, b) => b.importancia - a.importancia);
      for (const ep of pendientes) {
        tareas.push((visual) => this._repasar(ep, informe, visual));
        if (c.azar() < 0.5) tareas.push((visual) => this._ensayar(informe, visual));
      }
      if (!tareas.length) {
        const n = Math.max(1, Math.min(6, Math.round(ms / 5000)));
        for (let k = 0; k < n; k++) tareas.push((visual) => this._ensayar(informe, visual));
      }
    } else {
      if (this._porAgrupar.length && this.ajustes().sueno.agrupar) tareas.push((visual) => this._agrupar(informe, visual));
      const n = Math.max(1, Math.min(12, Math.round(ms / 7000)));
      for (let k = 0; k < n; k++) tareas.push((visual) => this._sonar(informe, visual));
    }

    // Reparte las tareas a lo largo de la fase. Si hay muchísimas, las agrupa
    // y solo anima la primera de cada grupo.
    const porTarea = ms / tareas.length;
    const lote = Math.max(1, Math.ceil(80 / Math.max(1, porTarea)));
    let k = 0;
    while (k < tareas.length && !this._interrumpir) {
      for (let j = 0; j < lote && k < tareas.length; j++, k++) tareas[k](j === 0);
      this._actualizarPresion();
      tramo.hasta = Date.now();
      await this._esperar(t0 + k * porTarea - Date.now());
    }
    const resto = t0 + ms - Date.now();
    if (resto > 0 && !this._interrumpir) await this._esperar(resto);
    tramo.hasta = Date.now();
    this._actualizarPresion();
  }

  _actualizarPresion() {
    const e = this.estado;
    const progreso = Math.min(1, (Date.now() - e.inicio) / e.duracion);
    this.cerebro.estado.presion = e.presionAntes * (1 - progreso);
  }

  _repasar(ep, informe, visual) {
    const r = this.cerebro.repasarEpisodio(ep);
    informe.repasos++;
    if (ep.repasos >= ep.planeados && !ep.consolidado) {
      ep.consolidado = true;
      informe.consolidados++;
    }
    if (r && visual) {
      const pasos = r.celdas.map((cel, i) => ({
        disparos: [[cel, 1], [r.ids[i], 0.85]],
        inhib: [],
        senales: [...(i > 0 ? [[r.celdas[i - 1], cel, 1]] : []), [cel, r.ids[i], 0.8]],
      }));
      this.emitir('pensamiento', { origen: 'repaso', pasos, ruta: [] });
    }
    if (r) this._deducir(r.ids, informe, visual);
  }

  _ensayar(informe, visual) {
    const r = this.cerebro.ensayarRecuerdo();
    if (!r) return;
    informe.ensayos++;
    if (visual) this.emitir('pensamiento', { origen: 'ensayo', pasos: r.registro.slice(0, 5), ruta: r.palabras });
    if (r.palabras.length) this._deducir(r.palabras, informe, visual);
  }

  // Tras repasar o recordar una frase, intenta deducir algo nuevo a partir de ella.
  _deducir(ids, informe, visual) {
    if (!this.ajustes().sueno.deducciones || informe.deducciones.length >= 12) return;
    const d = this.cerebro.deducir(ids, this._vistas);
    if (!d) return;
    informe.deducciones.push({ texto: d.texto, porque: d.porque, cuando: Date.now() });
    if (visual) {
      const cadena = (lista, x) => ({
        disparos: lista.map((i) => [i, x]),
        inhib: [],
        senales: lista.slice(1).map((i, k) => [lista[k], i, x]),
      });
      this.emitir('pensamiento', {
        origen: 'deduccion',
        pasos: [cadena(d.de, 0.8), cadena(d.sabido, 1), cadena(d.ids, 1)],
        ruta: [],
      });
    }
  }

  // Palabras que mirará esta noche para agrupar: las de los recuerdos del día y,
  // si son pocas, algunas más de las que ya conoce.
  _palabrasParaAgrupar() {
    const c = this.cerebro;
    const elegidas = new Set();
    for (const ep of c.episodios.values()) {
      for (const cel of ep.celdas) {
        const n = c.neuronas.get(cel);
        if (n) elegidas.add(n.palabra);
      }
    }
    if (elegidas.size < 40) {
      const otras = [...c.lexico.values()].filter((id) => !elegidas.has(id) && c.neuronas.get(id).frec >= 2);
      for (let i = 0; i < 60 && otras.length; i++) {
        elegidas.add(otras.splice(Math.floor(c.azar() * otras.length), 1)[0]);
      }
    }
    return [...elegidas];
  }

  _agrupar(informe, visual) {
    const lote = this._porAgrupar.splice(0, this._porCiclo || 1);
    for (const g of this.cerebro.agrupar(lote)) {
      if (!informe.categorias.some((x) => x.concepto === g.concepto) && informe.categorias.length < 10) {
        informe.categorias.push({ concepto: g.concepto, texto: g.texto, nueva: g.nueva });
      }
      if (visual) {
        this.emitir('pensamiento', {
          origen: 'categoria',
          pasos: [{
            disparos: [[g.concepto, 1], ...g.miembros.map((m) => [m, 0.9])],
            inhib: [],
            senales: g.miembros.map((m) => [g.concepto, m, 0.9]),
          }],
          ruta: [],
        });
      }
    }
  }

  _sonar(informe, visual) {
    const r = this.cerebro.sonar();
    if (!r) return;
    const sueno = { texto: r.texto, mezcla: r.mezcla, nuevas: r.nuevas, cuando: Date.now() };
    informe.suenos.push(sueno);
    informe.nuevasAsociaciones += r.nuevas.length;
    if (visual) this.emitir('pensamiento', { origen: 'sueno', pasos: r.registro, ruta: r.palabras });
    this.emitir('sueno', sueno);
  }
}

module.exports = { Sueno };
