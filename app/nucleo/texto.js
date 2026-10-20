'use strict';
// El "oído" de Rubenchuelo: convierte texto en frases y palabras.

const INTERROGATIVOS = new Set([
  'qué', 'quién', 'quiénes', 'cómo', 'dónde', 'adónde', 'cuándo',
  'cuál', 'cuáles', 'cuánto', 'cuánta', 'cuántos', 'cuántas', 'porqué',
]);

const MAX_PALABRAS_FRASE = 40;
const MAX_LARGO_PALABRA = 40;

function palabrasDe(fragmento) {
  const palabras = [];
  for (const m of fragmento.matchAll(/[\p{L}\p{N}]+/gu)) {
    const original = m[0];
    if (original.length > MAX_LARGO_PALABRA) continue;
    palabras.push({ norma: original.toLocaleLowerCase('es'), original });
  }
  return palabras;
}

// Recorre el texto frase a frase sin trocearlo entero en memoria
// (importante para textos gigantes). `fin` dice hasta qué carácter se ha leído.
function* frasesDe(texto) {
  const re = /[^.!?;\n]+[.!?;\n]*/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const crudo = m[0];
    const palabras = palabrasDe(crudo);
    if (!palabras.length) continue;
    const pregunta = /[?¿]/.test(crudo) || INTERROGATIVOS.has(palabras[0].norma);
    const fin = m.index + crudo.length;
    // Las frases larguísimas sin puntuación se parten en trozos manejables.
    for (let i = 0; i < palabras.length; i += MAX_PALABRAS_FRASE) {
      yield { palabras: palabras.slice(i, i + MAX_PALABRAS_FRASE), pregunta, fin };
    }
  }
}

function trocearFrases(texto) {
  return [...frasesDe(String(texto || ''))];
}

// Raíz aproximada para reconocer palabras que "suenan parecido" (perro/perros).
function raiz(palabra) {
  let r = palabra.normalize('NFD').replace(/\p{M}/gu, '');
  if (r.length < 4) return null;
  if (r.endsWith('es') && r.length > 5) r = r.slice(0, -2);
  else if (r.endsWith('s')) r = r.slice(0, -1);
  if (/[aoe]$/.test(r) && r.length > 4) r = r.slice(0, -1);
  return r.length >= 4 ? r : null;
}

function contarPalabras(texto) {
  let n = 0;
  for (const _ of String(texto).matchAll(/[\p{L}\p{N}]+/gu)) n++;
  return n;
}

module.exports = { frasesDe, trocearFrases, palabrasDe, raiz, contarPalabras, INTERROGATIVOS };
