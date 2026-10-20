'use strict';
// Lectura de textos: se repasan enteros tantas veces como se pida.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Cerebro } = require('../nucleo/cerebro');
const { Lectura } = require('../nucleo/lectura');
const { validarAjustesCerebro } = require('../nucleo/ajustes');

const TEXTO = 'Toby es mi perro. Luna es mi gata. Los perros comen pienso. Las gatas comen pescado.';
const PALABRAS = 16;

async function leer(cerebro, opciones) {
  const avisos = [];
  const l = new Lectura({ cerebro, emitir: (tipo, d) => { if (tipo === 'lectura') avisos.push(d); } });
  const t = l.encolar(TEXTO, 'prueba', opciones);
  while (l.ocupada) await new Promise((r) => setTimeout(r, 5));
  return { t, fin: avisos[avisos.length - 1] };
}

test('por defecto repasa cada texto 5 veces entero', async () => {
  const c = new Cerebro(validarAjustesCerebro({}));
  const { t, fin } = await leer(c);
  assert.equal(t.repasos, 5);
  assert.equal(fin.estado, 'terminada');
  assert.equal(fin.repaso, 5);
  assert.equal(fin.palabras, PALABRAS * 5);
  assert.equal(fin.progreso, 1);
});

test('se pueden pedir los repasos que se quieran, y cada vuelta refuerza lo leído', async () => {
  const peso = async (repasos) => {
    const c = new Cerebro(validarAjustesCerebro({ lectura: { repasos } }));
    await leer(c);
    const toby = c.neuronas.get(c.lexico.get('toby'));
    return toby.asoc.get(c.lexico.get('perro'));
  };
  const una = await peso(1);
  const diez = await peso(10);
  assert.ok(diez > una * 2, `10 repasos (${diez}) deben reforzar mucho más que 1 (${una})`);
  const c = new Cerebro(validarAjustesCerebro({}));
  const { t, fin } = await leer(c, { repasos: 12 });
  assert.equal(t.repasos, 12);
  assert.equal(fin.palabras, PALABRAS * 12);
  assert.equal(validarAjustesCerebro({ lectura: { repasos: 250000 } }).lectura.repasos, 250000, 'sin un tope pequeño');
});
