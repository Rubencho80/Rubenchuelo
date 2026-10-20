// Lee el mapa en binario que manda el servidor (lo escribe app/nucleo/formato-mapa.js;
// los dos tienen que ir a la par). Son números seguidos: no hay nada que interpretar.

export const MAGIA_MAPA = 0x314d4252;        // 'RBM1'
export const MAGIA_POSICIONES = 0x31504252;  // 'RBP1'

const decodificador = new TextDecoder('utf-8');

export function leerMapa(buf) {
  const cab = new Uint32Array(buf, 0, 8);
  if (cab[0] !== MAGIA_MAPA) throw new Error('El mapa no tiene el formato esperado');
  const [, version, N, A, bytesEtiquetas, epoca, bytesRegiones] = cab;
  let o = 32;
  const ids = new Uint32Array(buf, o, N); o += N * 4;
  const xy = new Float32Array(buf, o, N * 2); o += N * 8;
  const a = new Uint32Array(buf, o, A); o += A * 4;
  const b = new Uint32Array(buf, o, A); o += A * 4;
  const tipos = new Uint8Array(buf, o, N); o += N;
  const tam = new Uint8Array(buf, o, N); o += N;
  const w = new Uint8Array(buf, o, A); o += A;
  const k = new Uint8Array(buf, o, A); o += A;
  const etiquetas = N ? decodificador.decode(new Uint8Array(buf, o, bytesEtiquetas)).split('\n') : [];
  o += bytesEtiquetas;
  const regiones = bytesRegiones ? JSON.parse(decodificador.decode(new Uint8Array(buf, o, bytesRegiones))) : [];
  return { version, epoca, regiones, ids, xy, tipos, tam, etiquetas, aristas: { a, b, w, k } };
}

export function leerPosiciones(buf) {
  const cab = new Uint32Array(buf, 0, 4);
  if (cab[0] !== MAGIA_POSICIONES) throw new Error('Las posiciones no tienen el formato esperado');
  const [, version, epoca, N] = cab;
  return { version, epoca, ids: new Uint32Array(buf, 16, N), xy: new Float32Array(buf, 16 + N * 4, N * 2) };
}
