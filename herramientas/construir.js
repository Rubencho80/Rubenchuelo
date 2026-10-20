'use strict';
// Crea Rubenchuelo.exe (el lanzador, junto a Iniciar.bat) e «Instalar Rubenchuelo.exe»
// (el instalador, con el programa entero dentro). Usa el compilador de C# que
// ya trae Windows, así que no hay que instalar nada. Después de cambiar el
// programa, vuelve a ejecutarlo para que el instalador lleve la versión nueva:
//   runtime\node.exe herramientas\construir.js      (o «Crear exe e instalador.bat»)

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const EXE = path.join(__dirname, 'exe');
const ICONO = path.join(EXE, 'icono.ico');
const MANIFIESTO = path.join(EXE, 'app.manifest');
const LANZADOR = path.join(RAIZ, 'Rubenchuelo.exe');
const INSTALADOR = path.join(RAIZ, 'Instalar Rubenchuelo.exe');
// Lo que va dentro del instalador. Nunca los cerebros ni ajustes.json (son tuyos), ni
// Whisper (oido/whisper, 1,7 GB): el instalador lo copia de la carpeta portátil si está.
const PROGRAMA = ['app', 'runtime', 'oido', 'docs', 'LEEME.md', 'Iniciar.bat', 'iniciar.sh', 'Rubenchuelo.exe'];
const OIDO = path.join(RAIZ, 'oido', 'Oido.exe');

function buscarCsc() {
  const win = process.env.WINDIR || 'C:\\Windows';
  for (const d of ['Framework64', 'Framework']) {
    const ruta = path.join(win, 'Microsoft.NET', d, 'v4.0.30319', 'csc.exe');
    if (fs.existsSync(ruta)) return ruta;
  }
  throw new Error('No encuentro csc.exe (.NET Framework 4). Viene con Windows 10 y 11.');
}

function compilar(salida, fuentes, extra = [], { tipo = 'winexe', plataforma = 'anycpu' } = {}) {
  const args = ['/nologo', `/target:${tipo}`, '/optimize+', `/platform:${plataforma}`, `/out:${salida}`,
    `/win32icon:${ICONO}`, `/win32manifest:${MANIFIESTO}`,
    '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Management.dll', '/r:Microsoft.VisualBasic.dll',
    ...extra, ...fuentes.map((f) => path.join(EXE, f))];
  try {
    execFileSync(buscarCsc(), args, { stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    // csc escribe los errores en la salida normal.
    throw new Error(`No se pudo compilar ${path.basename(salida)}:\n${(e.stdout || '').split('\n').filter((l) => /error/i.test(l)).join('\n') || e.message}`);
  }
}

function archivos(ruta, rel, lista) {
  const st = fs.statSync(ruta);
  if (st.isDirectory()) {
    for (const n of fs.readdirSync(ruta).sort()) archivos(path.join(ruta, n), `${rel}/${n}`, lista);
  } else if (!/\.tmp$/i.test(ruta) && path.basename(ruta) !== 'en-uso.lock' && !rel.startsWith('oido/whisper/')) {
    lista.push({ ruta, rel: rel.replace(/^\//, ''), tam: st.size });
  }
}

// carga.rbpk (lo lee Instalador.cs): «RBPK1\n», total (int64) y, por archivo:
// largo de la ruta (uint16), ruta, tamaño (int64), tamaño comprimido (int64), datos.
function empaquetar(destino) {
  const lista = [];
  for (const p of PROGRAMA) {
    const ruta = path.join(RAIZ, p);
    if (!fs.existsSync(ruta)) throw new Error(`Falta ${p}`);
    archivos(ruta, p, lista);
  }
  const total = lista.reduce((s, a) => s + a.tam, 0);
  const cab = Buffer.alloc(14);
  cab.write('RBPK1\n', 0, 'ascii');
  cab.writeBigInt64LE(BigInt(total), 6);
  const partes = [cab];
  let comprimido = 0;
  for (const a of lista) {
    const datos = zlib.deflateRawSync(fs.readFileSync(a.ruta), { level: 9 });
    const ruta = Buffer.from(a.rel, 'utf8');
    const c = Buffer.alloc(2 + ruta.length + 16);
    c.writeUInt16LE(ruta.length, 0);
    ruta.copy(c, 2);
    c.writeBigInt64LE(BigInt(a.tam), 2 + ruta.length);
    c.writeBigInt64LE(BigInt(datos.length), 10 + ruta.length);
    partes.push(c, datos);
    comprimido += datos.length;
  }
  partes.push(Buffer.alloc(2));
  fs.writeFileSync(destino, Buffer.concat(partes));
  return { archivos: lista.length, total, comprimido };
}

function principal() {
  const mb = (n) => (n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  console.log('  Compilando Rubenchuelo.exe…');
  compilar(LANZADOR, ['Comun.cs', 'Lanzador.cs']);
  // El oído usa libvosk.dll, que es de 64 bits; es de consola porque habla por la salida estándar.
  console.log('  Compilando el oído (oido\\Oido.exe)…');
  compilar(OIDO, ['Oido.cs'], [], { tipo: 'exe', plataforma: 'x64' });
  console.log('  Empaquetando el programa (tarda un poco: comprime el motor)…');
  const carga = path.join(os.tmpdir(), `rubenchuelo-carga-${process.pid}.rbpk`);
  try {
    const r = empaquetar(carga);
    console.log(`    ${r.archivos} archivos, ${mb(r.total)} → ${mb(r.comprimido)}`);
    console.log('  Compilando «Instalar Rubenchuelo.exe»…');
    compilar(INSTALADOR, ['Comun.cs', 'Instalador.cs'], [`/resource:${carga},carga.rbpk`]);
  } finally {
    fs.rmSync(carga, { force: true });
  }
  console.log(`\n  Listo:\n    ${LANZADOR} (${mb(fs.statSync(LANZADOR).size)})\n    ${INSTALADOR} (${mb(fs.statSync(INSTALADOR).size)})\n`);
}

try {
  principal();
} catch (e) {
  console.error(`\n  ${e.message}\n`);
  process.exitCode = 1;
}
