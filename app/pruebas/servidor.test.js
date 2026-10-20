'use strict';
// Prueba de punta a punta: arranca el servidor en una carpeta temporal y usa la API.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function peticionCruda(puerto, ruta, cabeceras) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: puerto, path: ruta, headers: cabeceras }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('la API pide token, conversa, lee textos y guarda al salir', async (t) => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'rubenchuelo-'));
  const puerto = 7800 + Math.floor(Math.random() * 150);
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'servidor.js'), '--sin-navegador', '--puerto', String(puerto), '--raiz', raiz], { stdio: 'ignore' });
  t.after(() => {
    if (proc.exitCode === null) proc.kill();
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${puerto}`;
  let listo = false;
  for (let i = 0; i < 80 && !listo; i++) {
    try { listo = (await fetch(`${base}/api/ping`)).ok; } catch { await esperar(100); }
  }
  assert.ok(listo, 'el servidor arranca');
  const token = JSON.parse(fs.readFileSync(path.join(raiz, 'ajustes.json'), 'utf8')).token;
  const h = { 'X-Rubenchuelo-Token': token, 'Content-Type': 'application/json' };

  assert.equal((await fetch(`${base}/api/estado`)).status, 401, 'sin token no');
  assert.equal(await peticionCruda(puerto, '/api/ping', { Host: 'malo.example:80' }), 403, 'host ajeno no');

  let r = await fetch(`${base}/api/mensaje`, { method: 'POST', headers: h, body: JSON.stringify({ texto: 'Toby es mi perro.' }) });
  assert.equal(r.status, 200);
  r = await fetch(`${base}/api/mensaje`, { method: 'POST', headers: h, body: JSON.stringify({ texto: '¿Qué es Toby?' }) });
  assert.match((await r.json()).texto, /perro/i);

  // Texto en la codificación antigua de Windows (como manda PowerShell 5).
  const latin = Buffer.from(JSON.stringify({ texto: '¿Quién es Toby?' }), 'latin1');
  r = await fetch(`${base}/api/mensaje`, { method: 'POST', headers: h, body: latin });
  assert.match((await r.json()).texto, /perro/i);

  r = await fetch(`${base}/api/aprender?fuente=prueba.txt`, {
    method: 'POST',
    headers: { 'X-Rubenchuelo-Token': token, 'Content-Type': 'text/plain; charset=utf-8' },
    body: 'Luna es mi gata y vive en el jardín. '.repeat(60),
  });
  const tarea = await r.json();
  assert.equal(tarea.fuente, 'prueba.txt');
  let estado = 'en_cola';
  for (let i = 0; i < 50 && estado !== 'terminada'; i++) {
    await esperar(50);
    estado = (await (await fetch(`${base}/api/lecturas`, { headers: h })).json()).lecturas[0].estado;
  }
  assert.equal(estado, 'terminada');

  const mapa = await (await fetch(`${base}/api/mapa`, { headers: h })).json();
  assert.ok(mapa.nodos.length > 8);
  assert.ok(mapa.aristas.length > 8);

  // El mismo mapa en binario, leído con el lector de la interfaz.
  const { leerMapa, leerPosiciones } = await import(pathToFileURL(path.join(__dirname, '..', 'publico', 'js', 'formato-mapa.js')));
  const bin = leerMapa(await (await fetch(`${base}/api/mapa?formato=bin`, { headers: h })).arrayBuffer());
  assert.equal(bin.ids.length, mapa.nodos.length);
  assert.equal(bin.aristas.a.length * 4, mapa.aristas.length);
  const i = mapa.nodos.findIndex((n) => n[4] === 'luna');
  assert.ok(i >= 0, 'la palabra luna está en el mapa');
  assert.deepEqual([bin.ids[i], bin.tipos[i], bin.etiquetas[i]], [mapa.nodos[i][0], mapa.nodos[i][1], 'luna']);
  assert.ok(Math.abs(bin.xy[2 * i] - mapa.nodos[i][2]) < 0.1);
  assert.equal(bin.regiones.length, 2);
  const pos = leerPosiciones(await (await fetch(`${base}/api/mapa/posiciones`, { headers: h })).arrayBuffer());
  assert.equal(pos.ids.length, bin.ids.length);
  assert.ok(Number.isInteger((await (await fetch(`${base}/api/estado`, { headers: h })).json()).posiciones));

  r = await fetch(`${base}/api/salir`, { method: 'POST', headers: h });
  assert.equal(r.status, 200);
  await new Promise((res) => (proc.exitCode !== null ? res() : proc.on('exit', res)));
  assert.ok(fs.existsSync(path.join(raiz, 'cerebros', 'principal', 'cerebro.json.gz')), 'ha guardado el cerebro');
  assert.ok(!fs.existsSync(path.join(raiz, 'en-uso.lock')), 'ha soltado el candado');
});
