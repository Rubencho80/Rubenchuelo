'use strict';
// Ajustes por defecto y validación. Los que llegan de fuera se mezclan con
// estos y se recortan a rangos seguros, así un ajuste raro nunca rompe el cerebro.

const AJUSTES_CEREBRO = {
  aprendizaje: {
    velocidadCorteza: 0.08,      // cuánto cambia la corteza al oír algo despierto
    velocidadSueno: 0.15,        // cuánto cambia la corteza en cada repaso durante el sueño
    vigilancia: 0.62,            // parecido mínimo para que una frase encaje en un concepto ya conocido
    capacidadHipocampo: 600,     // células de tiempo que caben en el hipocampo
    ventanaAsociacion: 5,        // distancia máxima entre palabras para asociarlas
    creatividad: 0.7,            // temperatura al elegir palabras al hablar
    longitudMaxRespuesta: 14,
    memoriaTrabajo: true,        // recuerda de qué se estaba hablando durante unos minutos
  },
  sueno: {
    duracionMin: 2,
    ciclos: 4,
    fuerzaPoda: 0.03,            // cuánto bajan todas las conexiones al final del sueño
    umbralPoda: 0.01,            // las conexiones más débiles que esto desaparecen
    temporizador: { activo: false, horasDespierto: 4 },
    horario: [{ activo: false, inicio: '03:00', fin: '03:30', dias: [0, 1, 2, 3, 4, 5, 6] }],
    dormirAlAgotarse: true,
    despertarAlHablarle: true,
    deducciones: true,           // al dormir deduce cosas nuevas («A es B» + «B es C» → «A es C»)
    agrupar: true,               // al dormir agrupa palabras que se usan igual en categorías
  },
  lectura: {
    velocidad: 0.04,
    frasesAlHipocampo: 20,       // frases más sorprendentes de cada texto que pasan al hipocampo
    presionPorMilPalabras: 0.15, // cuánto sueño le da leer
    repasos: 5,                  // veces que repasa entero cada texto que le das
  },
  dopamina: {
    fuerza: 0.25,
  },
};

const AJUSTES_APP = {
  puerto: 7777,
  abrirNavegador: true,
  cerebroActivo: 'principal',
  accesoRed: false,
  token: '',
  autoguardadoMin: 1,
  copiasMaximo: 10,
  copiaCadaHoras: 6,
  maxTextoMB: 50,
  oido: {
    motor: 'whisper',            // 'whisper' (si está y hay tarjeta NVIDIA) o 'vosk'
    dispositivo: -1,             // micrófono (-1: el que Windows tenga por defecto)
    pausaSeg: 1.2,               // silencio que marca el final de una frase
    confianzaPalabra: 0.5,       // palabras sueltas menos seguras que esto se quitan
    confianzaFrase: 0.85,        // si la seguridad media de la frase es menor, se tira entera
  },
};

// [mínimo, máximo, entero?]
const RANGOS_CEREBRO = {
  'aprendizaje.velocidadCorteza': [0.005, 0.5],
  'aprendizaje.velocidadSueno': [0.01, 0.6],
  'aprendizaje.vigilancia': [0.1, 0.95],
  'aprendizaje.capacidadHipocampo': [50, 5000, true],
  'aprendizaje.ventanaAsociacion': [1, 8, true],
  'aprendizaje.creatividad': [0.05, 2],
  'aprendizaje.longitudMaxRespuesta': [3, 40, true],
  'sueno.duracionMin': [0.25, 240],
  'sueno.ciclos': [1, 8, true],
  'sueno.fuerzaPoda': [0, 0.3],
  'sueno.umbralPoda': [0.001, 0.2],
  'sueno.temporizador.horasDespierto': [0.05, 72],
  'lectura.velocidad': [0.005, 0.3],
  'lectura.frasesAlHipocampo': [0, 200, true],
  'lectura.presionPorMilPalabras': [0, 2],
  'lectura.repasos': [1, 1000000, true],
  'dopamina.fuerza': [0, 1],
};

const RANGOS_APP = {
  puerto: [1024, 65535, true],
  autoguardadoMin: [0.5, 60],
  copiasMaximo: [1, 100, true],
  copiaCadaHoras: [0.5, 168],
  maxTextoMB: [1, 500],
  'oido.dispositivo': [-1, 63, true],
  'oido.pausaSeg': [0.4, 6],
  'oido.confianzaPalabra': [0, 1],
  'oido.confianzaFrase': [0, 1],
};

const copia = (o) => JSON.parse(JSON.stringify(o));
const esObjeto = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

// Mezcla `dado` sobre `base` respetando los tipos de `base`.
function mezclar(base, dado, rangos, prefijo = '') {
  const res = copia(base);
  if (!esObjeto(dado)) return res;
  for (const clave of Object.keys(base)) {
    if (!(clave in dado)) continue;
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    const b = base[clave];
    const v = dado[clave];
    if (Array.isArray(b)) {
      if (Array.isArray(v)) res[clave] = v;
    } else if (esObjeto(b)) {
      res[clave] = mezclar(b, v, rangos, ruta);
    } else if (typeof b === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      const r = rangos[ruta];
      let x = n;
      if (r) {
        x = Math.min(r[1], Math.max(r[0], x));
        if (r[2]) x = Math.round(x);
      }
      res[clave] = x;
    } else if (typeof b === 'boolean') {
      res[clave] = Boolean(v);
    } else if (typeof b === 'string') {
      if (typeof v === 'string') res[clave] = v.slice(0, 200);
    }
  }
  return res;
}

const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

function limpiarHorario(lista) {
  if (!Array.isArray(lista)) return copia(AJUSTES_CEREBRO.sueno.horario);
  return lista.slice(0, 8).map((v) => {
    const o = esObjeto(v) ? v : {};
    const dias = Array.isArray(o.dias)
      ? [...new Set(o.dias.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
      : [0, 1, 2, 3, 4, 5, 6];
    return {
      activo: Boolean(o.activo),
      inicio: RE_HORA.test(o.inicio) ? o.inicio : '03:00',
      fin: RE_HORA.test(o.fin) ? o.fin : '03:30',
      dias,
    };
  });
}

function validarAjustesCerebro(dado) {
  const a = mezclar(AJUSTES_CEREBRO, dado, RANGOS_CEREBRO);
  a.sueno.horario = limpiarHorario(dado && dado.sueno ? dado.sueno.horario : undefined);
  return a;
}

function validarAjustesApp(dado) {
  const a = mezclar(AJUSTES_APP, dado, RANGOS_APP);
  if (!['whisper', 'vosk'].includes(a.oido.motor)) a.oido.motor = AJUSTES_APP.oido.motor;
  return a;
}

// Aplica un cambio parcial (lo que manda la interfaz) sobre los ajustes actuales.
function actualizarAjustesCerebro(actual, parcial) {
  const combinado = mezclar(actual, parcial, RANGOS_CEREBRO);
  const horario = parcial && parcial.sueno && Array.isArray(parcial.sueno.horario)
    ? parcial.sueno.horario
    : actual.sueno.horario;
  combinado.sueno.horario = horario;
  return validarAjustesCerebro(combinado);
}

function actualizarAjustesApp(actual, parcial) {
  return validarAjustesApp(mezclar(actual, parcial, RANGOS_APP));
}

module.exports = {
  AJUSTES_CEREBRO,
  AJUSTES_APP,
  validarAjustesCerebro,
  validarAjustesApp,
  actualizarAjustesCerebro,
  actualizarAjustesApp,
  RE_HORA,
};
