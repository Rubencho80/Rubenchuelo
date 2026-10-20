'use strict';
// Pruebas del cerebro: node --test app/pruebas

const test = require('node:test');
const assert = require('node:assert/strict');
const { Cerebro } = require('../nucleo/cerebro');
const { Sueno } = require('../nucleo/sueno');
const { Lectura } = require('../nucleo/lectura');
const { trocearFrases, raiz } = require('../nucleo/texto');
const { validarAjustesCerebro, actualizarAjustesCerebro } = require('../nucleo/ajustes');
const { ventanaActiva } = require('../nucleo/reloj');
const { crearAzar } = require('../nucleo/azar');

const nuevo = (semilla = 3) => new Cerebro(validarAjustesCerebro({}), { azar: crearAzar(semilla) });

function ensenar(c) {
  for (const t of ['Toby es mi perro.', 'Luna es mi gata.', 'Toby es marrón y tiene cuatro patas.']) c.conversar(t);
}

test('el oído separa frases y reconoce preguntas', () => {
  const f = trocearFrases('Hola, Toby. ¿Qué es esto? Me gusta');
  assert.equal(f.length, 3);
  assert.deepEqual(f[0].palabras.map((p) => p.norma), ['hola', 'toby']);
  assert.equal(f[1].pregunta, true);
  assert.equal(f[2].pregunta, false);
  assert.equal(raiz('perros'), raiz('perro'));
  assert.equal(raiz('animales'), raiz('animal'));
});

test('al oír una frase nacen neuronas y conexiones', () => {
  const c = nuevo();
  const r = c.conversar('Toby es mi perro.');
  assert.equal(r.oido.nuevas, 4);
  const toby = c.neuronas.get(c.lexico.get('toby'));
  const es = c.lexico.get('es');
  assert.ok(toby.sec.get(es) > 0, 'toby → es');
  assert.ok(toby.asoc.get(c.lexico.get('perro')) > 0, 'toby ↔ perro');
  assert.equal(c.episodios.size, 1, 'un recuerdo en el hipocampo');
  assert.equal(c.resumen().tipos.hipo, 4);
  assert.ok(c.resumen().tipos.inhib >= 2, 'hay inhibidoras');
  assert.ok(c.estado.presion > 0, 'le da un poco de sueño');
});

test('las preguntas no enseñan orden ni dejan recuerdo', () => {
  const c = nuevo();
  c.conversar('¿Qué es Mercurio?');
  const m = c.neuronas.get(c.lexico.get('mercurio'));
  assert.equal(m.sec.size + m.secIn.size, 0);
  assert.equal(c.episodios.size, 0);
});

test('contesta con lo que le has enseñado', () => {
  const c = nuevo();
  ensenar(c);
  const r = c.conversar('¿Quién es Luna?');
  assert.match(r.texto, /luna/i);
  assert.match(r.texto, /gata/i);
});

test('si no conoce algo, pregunta con curiosidad', () => {
  const c = nuevo();
  ensenar(c);
  const r = c.conversar('¿Qué es Mercurio?');
  assert.equal(r.modo, 'curiosidad');
  assert.equal(r.texto, '¿Mercurio?');
});

test('la dopamina refuerza las conexiones que usó', () => {
  const c = nuevo();
  ensenar(c);
  const r = c.conversar('¿Qué es Toby?');
  const h = c.huellas.get(r.id);
  const [a, b] = h.pasos.find(([x, y]) => c.neuronas.get(x).sec && c.neuronas.get(x).sec.has(y)) || h.pasos[0];
  const antes = c.neuronas.get(a).sec.get(b) || 0;
  assert.ok(c.recompensar(r.id, 1).cambios > 0);
  assert.ok(c.neuronas.get(a).sec.get(b) > antes);
  assert.ok(c.estado.dopamina > 0);
  const despues = c.neuronas.get(a).sec.get(b);
  c.recompensar(r.id, -1);
  assert.ok(c.neuronas.get(a).sec.get(b) < despues);
});

test('estimular una neurona le hace decir algo relacionado', () => {
  const c = nuevo();
  ensenar(c);
  const r = c.estimular(c.lexico.get('gata'));
  assert.match(r.texto, /gata/i);
});

test('dormir consolida: vacía el hipocampo y refuerza la corteza', async () => {
  const c = nuevo();
  ensenar(c);
  const toby = c.neuronas.get(c.lexico.get('toby'));
  const antes = toby.sec.get(c.lexico.get('es'));
  const s = new Sueno({ cerebro: c, ajustes: () => c.ajustes });
  s.minimoMs = 10;
  const informe = await s.dormir({ duracionMs: 300 });
  assert.equal(informe.completo, true);
  assert.equal(informe.consolidados, 3);
  assert.equal(c.episodios.size, 0, 'hipocampo vacío');
  assert.equal(c.resumen().tipos.hipo, 0);
  assert.ok(toby.sec.get(c.lexico.get('es')) > antes, 'la corteza aprendió');
  assert.equal(c.estado.presion, 0);
  assert.ok(informe.suenos.length >= 1, 'ha soñado');
  assert.ok(informe.hipnograma.some((t) => t.fase === 'rem'));
  // Y lo sigue sabiendo sin hipocampo:
  assert.match(c.conversar('¿Quién es Luna?').texto, /gata/i);
});

test('si lo despiertas, la consolidación queda a medias y se queda aturdido', async () => {
  const c = nuevo();
  ensenar(c);
  const s = new Sueno({ cerebro: c, ajustes: () => c.ajustes });
  s.minimoMs = 10;
  const p = s.dormir({ duracionMs: 5000 });
  await new Promise((r) => setTimeout(r, 30));
  const informe = await s.despertar('prueba');
  assert.equal(informe, await p);
  assert.equal(informe.completo, false);
  assert.ok(c.estado.aturdidoHasta > Date.now());
  assert.match(c.conversar('Hola.').texto, /bosteza/);
  assert.ok(c.episodios.size > 0, 'quedan recuerdos sin consolidar');
});

test('la poda quita conexiones débiles y olvida palabras sueltas', () => {
  const c = nuevo();
  c.conversar('Hola amigo.');
  for (const ep of c.episodios.values()) ep.consolidado = true;
  c.olvidarConsolidados();
  const r = c.homeostasis(0.99, 0.02);
  assert.ok(r.podadas > 0);
  assert.equal(c.lexico.has('amigo'), false, 'se ha olvidado');
});

test('el hipocampo olvida lo más viejo cuando se llena', () => {
  const c = new Cerebro(validarAjustesCerebro({ aprendizaje: { capacidadHipocampo: 50 } }), { azar: crearAzar(1) });
  for (let i = 0; i < 30; i++) c.conversar(`La cosa número ${i} es bonita.`);
  assert.ok(c.resumen().celdasHipocampo <= 50);
  assert.ok(c.contadores.olvidados > 0);
});

test('guardar y cargar conserva todo el conocimiento', () => {
  const c = nuevo();
  ensenar(c);
  const datos = JSON.parse(JSON.stringify(c.aJSON()));
  const c2 = Cerebro.desdeJSON(datos, c.ajustes, { azar: crearAzar(3) });
  assert.deepEqual(c2.resumen().tipos, c.resumen().tipos);
  assert.deepEqual(c2.aJSON().sec, c.aJSON().sec);
  assert.deepEqual(c2.aJSON().asoc, c.aJSON().asoc);
  assert.match(c2.conversar('¿Quién es Luna?').texto, /gata/i);
});

test('leer un texto grande crea neuronas sin bloquear y da sueño', async () => {
  const c = nuevo();
  const frases = [];
  for (let i = 0; i < 400; i++) frases.push(`El planeta ${i % 37} gira alrededor de la estrella ${i % 11} cada ${i} días.`);
  const l = new Lectura({ cerebro: c });
  const t = l.encolar(frases.join(' '), 'prueba');
  assert.equal(t.estado, 'en_cola');
  while (l.ocupada) await new Promise((r) => setTimeout(r, 20));
  const fin = l.lista()[0];
  assert.equal(fin.estado, 'terminada');
  assert.ok(fin.palabras > 4000);
  assert.ok(c.lexico.size > 40);
  assert.ok(c.estado.presion > 0.5);
  assert.ok(c.episodios.size <= c.ajustes.lectura.frasesAlHipocampo);
});

test('la lectura espera si está dormido', async () => {
  const c = nuevo();
  let dormido = true;
  const l = new Lectura({ cerebro: c, puedeLeer: () => !dormido });
  l.encolar('Una frase. Otra frase.', 'prueba');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(c.lexico.size, 0);
  dormido = false;
  while (l.ocupada) await new Promise((r) => setTimeout(r, 20));
  assert.ok(c.lexico.size > 0);
});

test('horario de sueño, incluso cruzando la medianoche', () => {
  const h = [{ activo: true, inicio: '23:30', fin: '00:30', dias: [5] }];   // viernes noche
  const vie = new Date(2026, 9, 16, 23, 45);   // viernes 16/10/2026 23:45
  const sab = new Date(2026, 9, 17, 0, 10);    // sábado 00:10 (sigue siendo la noche del viernes)
  const sab2 = new Date(2026, 9, 17, 23, 45);  // sábado noche: no toca
  assert.ok(ventanaActiva(h, vie));
  assert.ok(ventanaActiva(h, sab));
  assert.equal(ventanaActiva(h, vie).clave, ventanaActiva(h, sab).clave);
  assert.equal(ventanaActiva(h, sab2), null);
  assert.ok(Math.abs(ventanaActiva(h, vie).restanteMs - 45 * 60000) < 1000);
});

test('los ajustes raros se recortan a valores seguros', () => {
  const a = validarAjustesCerebro({ aprendizaje: { vigilancia: 7, capacidadHipocampo: '12.7' }, sueno: { horario: [{ inicio: '25:00', dias: [9, 1] }] } });
  assert.equal(a.aprendizaje.vigilancia, 0.95);
  assert.equal(a.aprendizaje.capacidadHipocampo, 50);
  assert.equal(a.sueno.horario[0].inicio, '03:00');
  assert.deepEqual(a.sueno.horario[0].dias, [1]);
  const b = actualizarAjustesCerebro(a, { sueno: { duracionMin: 5 } });
  assert.equal(b.sueno.duracionMin, 5);
  assert.deepEqual(b.sueno.horario, a.sueno.horario, 'un cambio parcial no borra el horario');
});

// ───────────── habilidades: deducir, agrupar y memoria de trabajo ─────────────

async function dormir(c, ms = 300) {
  const s = new Sueno({ cerebro: c, ajustes: () => c.ajustes });
  s.minimoMs = 10;
  return s.dormir({ duracionMs: ms });
}

test('al dormir deduce cosas nuevas y después las sabe', async () => {
  const c = nuevo();
  c.conversar('Toby es mi perro.');
  c.conversar('Los perros son animales.');
  const informe = await dormir(c);
  const d = informe.deducciones.find((x) => /toby es un animal/i.test(x.texto));
  assert.ok(d, `debería deducir «Toby es un animal» (dedujo: ${JSON.stringify(informe.deducciones)})`);
  assert.equal(d.porque.length, 2);
  assert.match(c.conversar('¿Toby es un animal?').texto, /^Sí\. Toby es un animal/i);
});

test('con la deducción apagada no deduce nada', async () => {
  const c = new Cerebro(validarAjustesCerebro({ sueno: { deducciones: false } }), { azar: crearAzar(3) });
  c.conversar('Toby es mi perro.');
  c.conversar('Los perros son animales.');
  const informe = await dormir(c);
  assert.equal(informe.deducciones.length, 0);
});

test('al dormir agrupa en categorías las palabras que se usan igual', async () => {
  const c = nuevo();
  for (const t of ['Toby es mi perro.', 'Luna es mi gata.', 'Toby come pienso.', 'Luna come pescado.']) c.conversar(t);
  const informe = await dormir(c);
  assert.ok(informe.categorias.length >= 1);
  const categorias = [...c.conceptos].map((id) => c.neuronas.get(id)).filter((n) => n.categoria);
  const nombres = (n) => [...n.miembros.keys()].map((id) => c.neuronas.get(id).texto);
  assert.ok(categorias.some((n) => nombres(n).includes('perro') && nombres(n).includes('gata')), 'perro y gata juntos');
  assert.ok(categorias.some((n) => nombres(n).includes('toby') && nombres(n).includes('luna')), 'Toby y Luna juntos');
  assert.match(c.etiqueta(categorias[0]), /≈/);
  // Se conserva al guardar y cargar.
  const c2 = Cerebro.desdeJSON(JSON.parse(JSON.stringify(c.aJSON())), c.ajustes);
  assert.equal([...c2.conceptos].filter((id) => c2.neuronas.get(id).categoria).length, categorias.length);
});

test('con la agrupación apagada no crea categorías', async () => {
  const c = new Cerebro(validarAjustesCerebro({ sueno: { agrupar: false } }), { azar: crearAzar(3) });
  for (const t of ['Toby es mi perro.', 'Luna es mi gata.']) c.conversar(t);
  const informe = await dormir(c);
  assert.equal(informe.categorias.length, 0);
});

test('la memoria de trabajo sigue el tema aunque no lo nombres', async () => {
  let aciertos = 0;
  for (let s = 1; s <= 5; s++) {
    const c = nuevo(s);
    for (const t of ['Toby es mi perro.', 'Luna es mi gata.', 'Toby come pienso.', 'Luna come pescado.']) c.conversar(t);
    await dormir(c);
    c.conversar('¿Quién es Luna?');
    assert.ok(c.enMente().some(([, etiqueta]) => /luna/i.test(etiqueta)), 'tiene a Luna en mente');
    if (/pescado/i.test(c.conversar('¿Qué come?').texto)) aciertos++;
  }
  assert.ok(aciertos >= 3, `sigue el tema en ${aciertos} de 5`);
});

test('con la memoria de trabajo apagada no tiene nada en mente y al dormir se vacía', async () => {
  const c = new Cerebro(validarAjustesCerebro({ aprendizaje: { memoriaTrabajo: false } }), { azar: crearAzar(3) });
  c.conversar('Toby es mi perro.');
  assert.deepEqual(c.enMente(), []);
  const c2 = nuevo();
  c2.conversar('Toby es mi perro.');
  assert.ok(c2.enMente().length > 0);
  await dormir(c2);
  assert.deepEqual(c2.enMente(), []);
});
