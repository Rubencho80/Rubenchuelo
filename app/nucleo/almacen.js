'use strict';
/*
 * Guardado en disco, pensado para un pendrive:
 *  - Todo va dentro de la carpeta de Rubenchuelo (rutas relativas).
 *  - Escritura segura: archivo temporal → fsync → renombrar. La versión
 *    anterior se conserva como cerebro.anterior.json.gz.
 *  - Copias de seguridad en cerebros/<nombre>/copias/.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');
const { Cerebro } = require('./cerebro');
const { validarAjustesCerebro, validarAjustesApp, AJUSTES_CEREBRO } = require('./ajustes');

const gzip = promisify(zlib.gzip);
const ARCHIVO = 'cerebro.json.gz';
const ANTERIOR = 'cerebro.anterior.json.gz';
const RESERVADOS = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const RE_NOMBRE = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u;
const RE_COPIA = /^[\w-]+\.json\.gz$/;
const MAX_SUENOS = 300;
const MAX_INFORMES = 60;

class ErrorAlmacen extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

function pausaSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// En Windows el antivirus puede bloquear un archivo un instante: se reintenta.
function renombrarSync(de, a) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(de, a); return; } catch (e) {
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      pausaSync(80 * (i + 1));
    }
  }
}

async function renombrar(de, a) {
  for (let i = 0; ; i++) {
    try { await fs.promises.rename(de, a); return; } catch (e) {
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 80 * (i + 1)));
    }
  }
}

function escribirSeguroSync(ruta, datos) {
  const tmp = `${ruta}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, datos);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  renombrarSync(tmp, ruta);
}

async function escribirSeguro(ruta, datos) {
  const tmp = `${ruta}.tmp`;
  const fh = await fs.promises.open(tmp, 'w');
  try {
    await fh.writeFile(datos);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await renombrar(tmp, ruta);
}

function leerJSON(ruta, defecto) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return defecto;
  }
}

function escribirJSONSync(ruta, obj) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  escribirSeguroSync(ruta, JSON.stringify(obj, null, 2));
}

function sello(fecha = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}_${p(fecha.getHours())}-${p(fecha.getMinutes())}-${p(fecha.getSeconds())}`;
}

function crearAlmacen(raiz) {
  const dirCerebros = path.join(raiz, 'cerebros');
  const dirPapelera = path.join(dirCerebros, '_papelera');
  const rutaAjustesApp = path.join(raiz, 'ajustes.json');
  const rutaCandado = path.join(raiz, 'en-uso.lock');

  function validarNombre(nombre) {
    const n = String(nombre || '').trim();
    if (!RE_NOMBRE.test(n) || RESERVADOS.test(n) || /[ .]$/.test(n)) {
      throw new ErrorAlmacen(400, 'Nombre no válido: usa letras, números, espacios, - o _ (máximo 40)');
    }
    return n;
  }

  function rutaCerebro(nombre) {
    return path.join(dirCerebros, validarNombre(nombre));
  }

  function existeCerebro(nombre) {
    try { return fs.statSync(rutaCerebro(nombre)).isDirectory(); } catch { return false; }
  }

  // ── ajustes ──
  function cargarAjustesApp() {
    const a = validarAjustesApp(leerJSON(rutaAjustesApp, {}));
    if (!a.token || a.token.length < 16) a.token = crypto.randomBytes(18).toString('base64url');
    guardarAjustesApp(a);
    return a;
  }

  function guardarAjustesApp(a) {
    escribirJSONSync(rutaAjustesApp, a);
  }

  function cargarAjustesCerebro(nombre) {
    return validarAjustesCerebro(leerJSON(path.join(rutaCerebro(nombre), 'ajustes.json'), AJUSTES_CEREBRO));
  }

  function guardarAjustesCerebro(nombre, a) {
    escribirJSONSync(path.join(rutaCerebro(nombre), 'ajustes.json'), a);
  }

  // ── cerebros ──
  function listarCerebros() {
    if (!fs.existsSync(dirCerebros)) return [];
    return fs.readdirSync(dirCerebros, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.') && RE_NOMBRE.test(d.name))
      .map((d) => {
        const dir = path.join(dirCerebros, d.name);
        const resumen = leerJSON(path.join(dir, 'resumen.json'), null);
        let bytes = 0;
        try { bytes = fs.statSync(path.join(dir, ARCHIVO)).size; } catch { /* aún sin guardar */ }
        return { nombre: d.name, bytes, resumen };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  function crearCerebro(nombre) {
    const n = validarNombre(nombre);
    const dir = path.join(dirCerebros, n);
    if (fs.existsSync(dir)) throw new ErrorAlmacen(409, `Ya existe un cerebro llamado «${n}»`);
    fs.mkdirSync(path.join(dir, 'copias'), { recursive: true });
    guardarAjustesCerebro(n, validarAjustesCerebro({}));
    return n;
  }

  function clonarCerebro(origen, destino) {
    const de = rutaCerebro(origen);
    const n = validarNombre(destino);
    const a = path.join(dirCerebros, n);
    if (!fs.existsSync(de)) throw new ErrorAlmacen(404, `No existe el cerebro «${origen}»`);
    if (fs.existsSync(a)) throw new ErrorAlmacen(409, `Ya existe un cerebro llamado «${n}»`);
    fs.cpSync(de, a, {
      recursive: true,
      filter: (src) => !src.startsWith(path.join(de, 'copias') + path.sep) && !src.endsWith('.tmp'),
    });
    fs.mkdirSync(path.join(a, 'copias'), { recursive: true });
    return n;
  }

  // Nunca se borra nada: se mueve a cerebros/_papelera.
  function archivarCerebro(nombre) {
    const de = rutaCerebro(nombre);
    if (!fs.existsSync(de)) throw new ErrorAlmacen(404, `No existe el cerebro «${nombre}»`);
    fs.mkdirSync(dirPapelera, { recursive: true });
    const destino = path.join(dirPapelera, `${path.basename(de)}_${sello()}`);
    renombrarSync(de, destino);
    return destino;
  }

  async function guardarCerebro(nombre, cerebro) {
    const dir = rutaCerebro(nombre);
    await fs.promises.mkdir(dir, { recursive: true });
    cerebro.sucio = false;   // lo que cambie mientras se escribe se guardará la próxima vez
    try {
      const json = JSON.stringify(cerebro.aJSON());
      const resumen = cerebro.resumen();
      const datos = await gzip(json, { level: 6 });
      const ruta = path.join(dir, ARCHIVO);
      const tmp = `${ruta}.tmp`;
      const fh = await fs.promises.open(tmp, 'w');
      try {
        await fh.writeFile(datos);
        await fh.sync();
      } finally {
        await fh.close();
      }
      if (fs.existsSync(ruta)) await renombrar(ruta, path.join(dir, ANTERIOR));
      await renombrar(tmp, ruta);
      await escribirSeguro(path.join(dir, 'resumen.json'), JSON.stringify({
        neuronas: resumen.neuronas, sinapsis: resumen.sinapsis, tipos: resumen.tipos,
        creado: resumen.creado, guardado: Date.now(),
      }));
      return { bytes: datos.length };
    } catch (e) {
      cerebro.sucio = true;
      throw e;
    }
  }

  function guardarCerebroSync(nombre, cerebro) {
    const dir = rutaCerebro(nombre);
    fs.mkdirSync(dir, { recursive: true });
    const datos = zlib.gzipSync(JSON.stringify(cerebro.aJSON()), { level: 6 });
    const ruta = path.join(dir, ARCHIVO);
    const tmp = `${ruta}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, datos);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(ruta)) renombrarSync(ruta, path.join(dir, ANTERIOR));
    renombrarSync(tmp, ruta);
    const r = cerebro.resumen();
    escribirSeguroSync(path.join(dir, 'resumen.json'), JSON.stringify({
      neuronas: r.neuronas, sinapsis: r.sinapsis, tipos: r.tipos, creado: r.creado, guardado: Date.now(),
    }));
    cerebro.sucio = false;
    return { bytes: datos.length };
  }

  function leerCerebro(ruta, ajustes, opciones) {
    const datos = JSON.parse(zlib.gunzipSync(fs.readFileSync(ruta)).toString('utf8'));
    return Cerebro.desdeJSON(datos, ajustes, opciones);
  }

  // Intenta el archivo actual, luego el anterior y luego las copias.
  function cargarCerebro(nombre, ajustes, opciones = {}) {
    const dir = rutaCerebro(nombre);
    const candidatos = [path.join(dir, ARCHIVO), path.join(dir, ANTERIOR),
      ...listarCopias(nombre).map((c) => path.join(dir, 'copias', c.archivo))];
    const errores = [];
    let habiaArchivos = false;
    for (const ruta of candidatos) {
      if (!fs.existsSync(ruta)) continue;
      habiaArchivos = true;
      try {
        const cerebro = leerCerebro(ruta, ajustes, opciones);
        return { cerebro, desde: path.relative(dir, ruta), errores, habiaArchivos };
      } catch (e) {
        errores.push(`${path.relative(dir, ruta)}: ${e.message}`);
      }
    }
    return { cerebro: null, errores, habiaArchivos };
  }

  // Si el cerebro no se puede leer, se aparta (no se sobrescribe nunca).
  function apartarRoto(nombre) {
    const dir = rutaCerebro(nombre);
    const ruta = path.join(dir, ARCHIVO);
    if (fs.existsSync(ruta)) renombrarSync(ruta, path.join(dir, `cerebro.roto_${sello()}.json.gz`));
  }

  // ── diario de sueños e informes ──
  function leerDiario(nombre) {
    const d = leerJSON(path.join(rutaCerebro(nombre), 'diario.json'), {});
    return { suenos: Array.isArray(d.suenos) ? d.suenos : [], informes: Array.isArray(d.informes) ? d.informes : [] };
  }

  function guardarDiario(nombre, diario) {
    diario.suenos = diario.suenos.slice(-MAX_SUENOS);
    diario.informes = diario.informes.slice(-MAX_INFORMES);
    escribirJSONSync(path.join(rutaCerebro(nombre), 'diario.json'), diario);
  }

  // ── copias de seguridad ──
  function listarCopias(nombre) {
    const dir = path.join(rutaCerebro(nombre), 'copias');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => RE_COPIA.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { archivo: f, bytes: st.size, fecha: st.mtimeMs };
      })
      .sort((a, b) => b.fecha - a.fecha);
  }

  function crearCopia(nombre, etiqueta, maximo) {
    const dir = rutaCerebro(nombre);
    const origen = path.join(dir, ARCHIVO);
    if (!fs.existsSync(origen)) return null;
    const dirCopias = path.join(dir, 'copias');
    fs.mkdirSync(dirCopias, { recursive: true });
    const limpia = String(etiqueta || '').replace(/[^\w-]/g, '').slice(0, 30);
    const archivo = `${sello()}${limpia ? `-${limpia}` : ''}.json.gz`;
    fs.copyFileSync(origen, path.join(dirCopias, archivo));
    const todas = listarCopias(nombre);
    for (const c of todas.slice(maximo)) fs.unlinkSync(path.join(dirCopias, c.archivo));
    return archivo;
  }

  function rutaCopia(nombre, archivo) {
    if (!RE_COPIA.test(String(archivo))) throw new ErrorAlmacen(400, 'Copia no válida');
    const ruta = path.join(rutaCerebro(nombre), 'copias', archivo);
    if (!fs.existsSync(ruta)) throw new ErrorAlmacen(404, 'Esa copia no existe');
    return ruta;
  }

  function restaurarCopia(nombre, archivo, ajustes) {
    const ruta = rutaCopia(nombre, archivo);
    leerCerebro(ruta, ajustes, {});   // comprueba que se puede leer antes de tocar nada
    const destino = path.join(rutaCerebro(nombre), ARCHIVO);
    const datos = fs.readFileSync(ruta);
    escribirSeguroSync(destino, datos);
  }

  // ── candado: una sola Rubenchuelo por carpeta ──
  function leerCandado() {
    return leerJSON(rutaCandado, null);
  }

  function tomarCandado(datos) {
    escribirJSONSync(rutaCandado, { ...datos, desde: Date.now() });
  }

  function soltarCandado(pid) {
    const c = leerCandado();
    if (c && c.pid === pid) {
      try { fs.unlinkSync(rutaCandado); } catch { /* ya no estaba */ }
    }
  }

  return {
    raiz, dirCerebros,
    validarNombre, rutaCerebro, existeCerebro,
    cargarAjustesApp, guardarAjustesApp, cargarAjustesCerebro, guardarAjustesCerebro,
    listarCerebros, crearCerebro, clonarCerebro, archivarCerebro,
    guardarCerebro, guardarCerebroSync, cargarCerebro, apartarRoto,
    leerDiario, guardarDiario,
    listarCopias, crearCopia, restaurarCopia,
    leerCandado, tomarCandado, soltarCandado,
  };
}

module.exports = { crearAlmacen, ErrorAlmacen };
