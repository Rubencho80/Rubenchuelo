'use strict';
// El oído: qué frases oídas se aprenden y cuáles se tiran.

const test = require('node:test');
const assert = require('node:assert/strict');
const { filtrarFrase, palabrasDeWhisper, disponible, Oido } = require('../nucleo/oido');

const opciones = { confianzaPalabra: 0.5, confianzaFrase: 0.85 };

test('una frase clara se aprende entera', () => {
  const r = filtrarFrase([['toby', 0.64], ['es', 0.81], ['mi', 1], ['perro', 1], ['y', 1], ['vive', 1], ['en', 1], ['el', 1], ['jardín', 1]], opciones);
  assert.equal(r.aceptada, true);
  assert.equal(r.texto, 'toby es mi perro y vive en el jardín');
  assert.ok(r.media > 0.9);
});

test('si la seguridad media es baja, la frase se tira entera (aunque haya palabras seguras)', () => {
  // Lo que salió al oír inglés con el modelo español.
  const r = filtrarFrase([['de', 1], ['web', 0.42], ['de', 1], ['disney', 0.5], ['tu', 0.71], ['y', 1], ['andy', 0.38], ['un', 0.9], ['tubo', 0.66]], opciones);
  assert.equal(r.aceptada, false);
  assert.equal(r.motivo, 'dudosa');
  assert.ok(r.media < 0.85);
});

test('en una frase buena se quitan solo las palabras sueltas dudosas', () => {
  const r = filtrarFrase([['luna', 1], ['come', 1], ['pescado', 1], ['eh', 0.3], ['fresco', 1], ['hoy', 1]], opciones);
  assert.equal(r.aceptada, true);
  assert.equal(r.texto, 'luna come pescado fresco hoy');
  assert.equal(r.quitadas, 1);
});

test('los límites se pueden cambiar y una frase vacía no vale', () => {
  const dudosa = [['hola', 0.8], ['qué', 0.7]];
  assert.equal(filtrarFrase(dudosa, opciones).aceptada, false);
  assert.equal(filtrarFrase(dudosa, { confianzaPalabra: 0.5, confianzaFrase: 0.7 }).aceptada, true);
  assert.equal(filtrarFrase([], opciones).aceptada, false);
});

test('lo que dice Whisper se convierte en palabras con su seguridad', () => {
  // Trozo real de la respuesta de whisper-server (verbose_json): «perro» llega partido y el punto aparte.
  const respuesta = {
    language: 'spanish',
    segments: [
      {
        no_speech_prob: 0.00002,
        words: [
          { word: ' Toby', probability: 0.95 }, { word: ' es', probability: 0.9998 }, { word: ' mi', probability: 0.9999 },
          { word: ' per', probability: 0.9999 }, { word: 'ro', probability: 0.9 }, { word: '.', probability: 0.97 },
        ],
      },
      { no_speech_prob: 0.9, words: [{ word: ' Gracias', probability: 0.99 }] },   // seguramente no era voz
    ],
  };
  const p = palabrasDeWhisper(respuesta);
  assert.deepEqual(p.map(([w]) => w), ['Toby', 'es', 'mi', 'perro.']);
  assert.ok(Math.abs(p[3][1] - 0.94995) < 1e-6, 'la seguridad de «perro» es la media de sus trozos');
  const f = filtrarFrase(p, opciones);
  assert.equal(f.aceptada, true);
  assert.equal(f.texto, 'Toby es mi perro.');
});

test('si el oído está instalado, sabe decir qué micrófonos hay', { skip: !disponible() }, async () => {
  const lista = await new Oido().dispositivos();
  assert.ok(Array.isArray(lista));
  for (const d of lista) assert.ok(Number.isInteger(d.id) && typeof d.nombre === 'string');
});
