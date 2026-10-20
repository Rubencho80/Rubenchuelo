'use strict';
/*
 * Rutas HTTP: la interfaz y la API para otras aplicaciones (docs/API.md).
 * Seguridad: todas las rutas /api piden el token, y por defecto solo se
 * aceptan peticiones dirigidas a este mismo ordenador.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { ErrorHttp } = require('./aplicacion');
const { codificarMapa, codificarPosiciones, mapaComoJSON } = require('./nucleo/formato-mapa');

const PUBLICO = path.join(__dirname, 'publico');
const LIMITE_JSON = 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; "
  + "frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function enviarJSON(req, res, estado, obj) {
  const cuerpo = JSON.stringify(obj === undefined ? { ok: true } : obj);
  enviar(req, res, estado, Buffer.from(cuerpo), 'application/json; charset=utf-8');
}

// Lo grande se comprime aparte (en otro hilo) para no frenar al cerebro.
function enviar(req, res, estado, datos, tipo) {
  const cab = { 'Content-Type': tipo, 'Cache-Control': 'no-store' };
  if (datos.length > 20000 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    zlib.gzip(datos, { level: 3 }, (err, gz) => {
      if (res.headersSent || res.destroyed) return;
      if (err) {
        res.writeHead(estado, { ...cab, 'Content-Length': datos.length });
        res.end(datos);
        return;
      }
      res.writeHead(estado, { ...cab, 'Content-Encoding': 'gzip', 'Content-Length': gz.length });
      res.end(gz);
    });
    return;
  }
  res.writeHead(estado, { ...cab, 'Content-Length': datos.length });
  res.end(datos);
}

function leerCuerpo(req, limite) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let total = 0;
    let excedido = false;
    req.on('data', (t) => {
      total += t.length;
      if (total > limite) excedido = true;
      else trozos.push(t);
    });
    req.on('end', () => {
      if (excedido) reject(new ErrorHttp(413, `Demasiado grande (máximo ${Math.round(limite / 1048576)} MB)`));
      else resolve(Buffer.concat(trozos));
    });
    req.on('error', reject);
  });
}

// UTF-8 si es válido; si no, la codificación clásica de Windows (lo que mandan
// por defecto muchos programas antiguos y PowerShell 5).
function decodificar(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

function interpretarCuerpo(req, buf) {
  let texto = decodificar(buf);
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  const tipo = String(req.headers['content-type'] || '');
  if (tipo.includes('application/json') || (!tipo.startsWith('text/') && /^\s*[{[]/.test(texto))) {
    if (!texto.trim()) return {};
    try {
      const o = JSON.parse(texto);
      return o && typeof o === 'object' ? o : {};
    } catch {
      if (tipo.includes('application/json')) throw new ErrorHttp(400, 'El JSON no es válido');
    }
  }
  return { texto };
}

function iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const RUTAS = [];
function ruta(metodo, patron, h, opciones = {}) {
  RUTAS.push({ metodo, patron, h, ...opciones });
}

ruta('GET', '/api/ping', ({ app }) => ({ ok: true, app: 'Rubenchuelo', cerebro: app.nombreCerebro }), { publica: true });
ruta('GET', '/api/estado', ({ app }) => app.estadoPublico());
ruta('GET', '/api/eventos', ({ app, req, res }) => {
  app.difusor.conectar(req, res);
  res.write(`event: estado\ndata: ${JSON.stringify(app.estadoPublico())}\n\n`);
});
ruta('GET', '/api/chat', ({ app }) => ({ chat: app.chat }));
ruta('POST', '/api/mensaje', ({ app, cuerpo, origen }) => app.mensaje(cuerpo.texto ?? cuerpo.mensaje, origen));
ruta('POST', '/api/opinion', ({ app, cuerpo }) => app.opinar(Number(cuerpo.id), Number(cuerpo.valor)));
ruta('GET', /^\/api\/explicar\/(\d+)$/, ({ app, params }) => app.explicar(Number(params[0])));
ruta('POST', '/api/aprender', ({ app, cuerpo, url, origen }) => app.aprender(cuerpo.texto, cuerpo.fuente || url.searchParams.get('fuente'), origen,
  cuerpo.repasos ?? url.searchParams.get('repasos')), { grande: true });
ruta('GET', '/api/lecturas', ({ app }) => ({ lecturas: app.lectura.lista() }));
ruta('DELETE', /^\/api\/lecturas\/([\w-]+)$/, ({ app, params }) => ({ ok: app.lectura.cancelar(params[0]) }));
ruta('POST', '/api/dormir', ({ app, cuerpo, origen }) => app.dormirPeticion(cuerpo, origen));
ruta('POST', '/api/despertar', async ({ app }) => ({ ok: await app.despertar('le has despertado') }));
ruta('GET', '/api/mapa', async ({ app, url }) => {
  const maxAristas = Math.min(40000, Math.max(100, Number(url.searchParams.get('maxAristas')) || 6000));
  const datos = await app.mapaDatos(maxAristas);
  return url.searchParams.get('formato') === 'bin' ? codificarMapa(datos) : mapaComoJSON(datos);
});
ruta('GET', '/api/mapa/posiciones', ({ app }) => codificarPosiciones(app.cerebro.posiciones()));
ruta('GET', /^\/api\/neuronas\/(\d+)$/, ({ app, params }) => {
  const d = app.cerebro.detalle(Number(params[0]));
  if (!d) throw new ErrorHttp(404, 'Esa neurona ya no existe');
  return d;
});
ruta('POST', /^\/api\/neuronas\/(\d+)\/estimular$/, ({ app, params }) => app.estimular(Number(params[0])));
ruta('GET', '/api/buscar', ({ app, url }) => ({ nodo: app.cerebro.buscar(url.searchParams.get('palabra')) }));
ruta('GET', '/api/diario', ({ app }) => app.diario);
ruta('GET', '/api/oido', ({ app }) => app.estadoOido());
ruta('POST', '/api/oido', ({ app, cuerpo }) => app.escuchar(Boolean(cuerpo.activo)));
ruta('GET', '/api/oido/dispositivos', async ({ app }) => ({ dispositivos: await app.oido.dispositivos() }));
ruta('GET', '/api/ajustes', ({ app }) => app.obtenerAjustes());
ruta('PUT', '/api/ajustes', ({ app, cuerpo }) => app.actualizarAjustes(cuerpo));
ruta('POST', '/api/token', ({ app }) => ({ token: app.nuevoToken() }));
ruta('GET', '/api/cerebros', ({ app }) => app.listarCerebros());
ruta('POST', '/api/cerebros', ({ app, cuerpo }) => app.crearCerebro(cuerpo.nombre));
ruta('POST', '/api/cerebros/usar', ({ app, cuerpo }) => app.usarCerebro(cuerpo.nombre));
ruta('POST', '/api/cerebros/clonar', ({ app, cuerpo }) => app.clonarCerebro(cuerpo.origen, cuerpo.nombre));
ruta('POST', '/api/cerebros/archivar', ({ app, cuerpo }) => app.archivarCerebro(cuerpo.nombre));
ruta('GET', '/api/copias', ({ app }) => app.listarCopias());
ruta('POST', '/api/copias', async ({ app }) => ({ archivo: await app.crearCopia('manual') }));
ruta('POST', '/api/copias/restaurar', ({ app, cuerpo }) => app.restaurarCopia(cuerpo.archivo));
ruta('POST', '/api/guardar', async ({ app }) => ({ ok: Boolean(await app.guardar()) }));
ruta('POST', '/api/abrir-carpeta', ({ app, cuerpo }) => app.abrirCarpeta(cuerpo.que));
ruta('POST', '/api/salir', ({ app }) => app.salir());
ruta('GET', '/api/actividad-externa', ({ app }) => ({ actividad: app.actividadExterna }));

function buscarRuta(metodo, camino) {
  let existe = false;
  for (const r of RUTAS) {
    const m = typeof r.patron === 'string' ? (r.patron === camino ? [] : null) : camino.match(r.patron);
    if (!m) continue;
    existe = true;
    if (r.metodo === metodo) return { r, params: typeof r.patron === 'string' ? [] : m.slice(1) };
  }
  return existe ? { metodoIncorrecto: true } : null;
}

function hostPermitido(req, app) {
  if (app.ajustesApp.accesoRed) return true;
  const host = String(req.headers.host || '').toLowerCase();
  return [`127.0.0.1:${app.puerto}`, `localhost:${app.puerto}`, `[::1]:${app.puerto}`].includes(host);
}

function servirEstatico(req, res, url, app) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }
  let camino;
  try { camino = decodeURIComponent(url.pathname); } catch { camino = '/'; }
  if (camino === '/' || camino === '') camino = '/index.html';
  const ruta = path.normalize(path.join(PUBLICO, camino));
  if (!ruta.startsWith(PUBLICO + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(ruta, (err, datos) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
    }
    const ext = path.extname(ruta).toLowerCase();
    const cab = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    if (ext === '.html') {
      cab['Content-Security-Policy'] = CSP;
      cab['Referrer-Policy'] = 'no-referrer';
      // La interfaz recibe el token incrustado (otras webs no pueden leer esta página).
      datos = Buffer.from(datos.toString('utf8').replace('{{TOKEN}}', app.ajustesApp.token));
    }
    res.writeHead(200, cab);
    res.end(req.method === 'HEAD' ? undefined : datos);
  });
}

function crearManejador(app) {
  return async function manejar(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (!hostPermitido(req, app)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Host no permitido');
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      servirEstatico(req, res, url, app);
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Rubenchuelo-Token, X-Rubenchuelo-Origen');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      const encontrada = buscarRuta(req.method, url.pathname);
      if (!encontrada) throw new ErrorHttp(404, 'Esa ruta no existe (mira docs/API.md)');
      if (encontrada.metodoIncorrecto) throw new ErrorHttp(405, 'Método no permitido en esta ruta');
      const { r, params } = encontrada;
      if (!r.publica) {
        const token = req.headers['x-rubenchuelo-token'] || url.searchParams.get('token') || '';
        if (!iguales(token, app.ajustesApp.token)) {
          throw new ErrorHttp(401, 'Falta el token o no es correcto (lo tienes en la pestaña «Conexiones» de Rubenchuelo)');
        }
      }
      if (!app.cerebro && r.patron !== '/api/ping') throw new ErrorHttp(503, 'Rubenchuelo se está despertando, prueba en un momento');
      let cuerpo = {};
      if (req.method === 'POST' || req.method === 'PUT') {
        const limite = r.grande ? app.ajustesApp.maxTextoMB * 1048576 + 65536 : LIMITE_JSON;
        cuerpo = interpretarCuerpo(req, await leerCuerpo(req, limite));
      }
      const origen = req.headers['x-rubenchuelo-origen'] === 'interfaz' ? 'interfaz' : 'api';
      const resultado = await r.h({ app, req, res, url, params, cuerpo, origen });
      if (res.headersSent) return;
      if (Buffer.isBuffer(resultado)) enviar(req, res, 200, resultado, 'application/octet-stream');
      else enviarJSON(req, res, 200, resultado);
    } catch (e) {
      const estado = e.estado || 500;
      if (estado === 500) console.error('Error en', req.method, url.pathname, e);
      if (!res.headersSent) enviarJSON(req, res, estado, { error: e.message || 'Error interno' });
    }
  };
}

module.exports = { crearManejador };
