'use strict';
// El mapa en binario para la interfaz. Con cerebros grandes el JSON pesaba
// casi 2 MB y costaba montarlo y leerlo; así son números seguidos que el
// navegador lee sin interpretar nada. El lector está en publico/js/formato-mapa.js
// (los dos tienen que ir a la par). Todo en little-endian.
//
// Mapa completo («RBM1»):
//   cabecera 32 bytes: magia, versión, nº neuronas, nº conexiones,
//                      bytes de etiquetas, época de posiciones, bytes de regiones, 0
//   ids u32[N] · xy f32[2N] · origen u32[A] · destino u32[A]
//   tipos u8[N] · tamaño×10 u8[N] · peso×255 u8[A] · clase u8[A]
//   etiquetas (UTF-8, separadas por \n) · regiones (JSON)
// Posiciones («RBP1»):
//   cabecera 16 bytes: magia, versión, época, nº neuronas · ids u32[N] · xy f32[2N]

const MAGIA_MAPA = 0x314d4252;        // 'RBM1'
const MAGIA_POSICIONES = 0x31504252;  // 'RBP1'

function codificarMapa(d) {
  const N = d.ids.length;
  const A = d.aristas.a.length;
  const etiquetas = Buffer.from(d.etiquetas.map((s) => String(s || '').replace(/\n/g, ' ')).join('\n'), 'utf8');
  const regiones = Buffer.from(JSON.stringify(d.regiones || []), 'utf8');
  const total = 32 + N * 12 + A * 8 + N * 2 + A * 2 + etiquetas.length + regiones.length;
  const ab = new ArrayBuffer(total);
  const cab = new Uint32Array(ab, 0, 8);
  cab.set([MAGIA_MAPA, d.version >>> 0, N, A, etiquetas.length, d.epoca >>> 0, regiones.length, 0]);
  let o = 32;
  new Uint32Array(ab, o, N).set(d.ids); o += N * 4;
  new Float32Array(ab, o, N * 2).set(d.xy); o += N * 8;
  new Uint32Array(ab, o, A).set(d.aristas.a); o += A * 4;
  new Uint32Array(ab, o, A).set(d.aristas.b); o += A * 4;
  new Uint8Array(ab, o, N).set(d.tipos); o += N;
  new Uint8Array(ab, o, N).set(d.tam); o += N;
  new Uint8Array(ab, o, A).set(d.aristas.w); o += A;
  new Uint8Array(ab, o, A).set(d.aristas.k); o += A;
  const bytes = Buffer.from(ab);
  etiquetas.copy(bytes, o); o += etiquetas.length;
  regiones.copy(bytes, o);
  return bytes;
}

function codificarPosiciones(d) {
  const N = d.ids.length;
  const ab = new ArrayBuffer(16 + N * 12);
  new Uint32Array(ab, 0, 4).set([MAGIA_POSICIONES, d.version >>> 0, d.epoca >>> 0, N]);
  new Uint32Array(ab, 16, N).set(d.ids);
  new Float32Array(ab, 16 + N * 4, N * 2).set(d.xy);
  return Buffer.from(ab);
}

// El mismo mapa en el JSON de siempre (para otras aplicaciones, docs/API.md).
const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;
function mapaComoJSON(d) {
  const nodos = [];
  for (let i = 0; i < d.ids.length; i++) {
    nodos.push([d.ids[i], d.tipos[i], r1(d.xy[2 * i]), r1(d.xy[2 * i + 1]), d.etiquetas[i], d.tam[i] / 10]);
  }
  const aristas = [];
  const A = d.aristas;
  for (let j = 0; j < A.a.length; j++) aristas.push(A.a[j], A.b[j], r3(A.w[j] / 255), A.k[j]);
  return { version: d.version, epoca: d.epoca, regiones: d.regiones, nodos, aristas };
}

module.exports = { codificarMapa, codificarPosiciones, mapaComoJSON, MAGIA_MAPA, MAGIA_POSICIONES };
