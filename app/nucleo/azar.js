'use strict';
// Números aleatorios. Con semilla, las pruebas salen siempre igual.

function crearAzar(semilla) {
  if (semilla === undefined || semilla === null) return Math.random;
  let s = semilla >>> 0;
  return function azar() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { crearAzar };
