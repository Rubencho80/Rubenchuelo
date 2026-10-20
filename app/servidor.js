'use strict';
// Punto de entrada: carga el cerebro, arranca el servidor local y abre el navegador.
//   node app/servidor.js [--sin-navegador] [--puerto 7777] [--raiz carpeta]
// --raiz cambia dónde se guardan los cerebros (por defecto, la carpeta de Rubenchuelo).

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { crearAlmacen } = require('./nucleo/almacen');
const { Aplicacion } = require('./aplicacion');
const { crearManejador } = require('./api');

const args = process.argv.slice(2);
const argumento = (nombre) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : null;
};
const sinNavegador = args.includes('--sin-navegador');
const puertoArg = argumento('--puerto') ? Number(argumento('--puerto')) : null;
const RAIZ = path.resolve(argumento('--raiz') || process.env.RUBENCHUELO_RAIZ || path.join(__dirname, '..'));

function procesoVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function responde(puerto) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: puerto, path: '/api/ping', timeout: 1500 }, (res) => {
      let datos = '';
      res.on('data', (t) => { datos += t; });
      res.on('end', () => {
        try { resolve(JSON.parse(datos).app === 'Rubenchuelo'); } catch { resolve(false); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function abrirNavegador(url) {
  const [programa, argumentos] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(programa, argumentos, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
  } catch { /* si no se puede, la dirección está en la ventana */ }
}

function escuchar(servidor, puerto, host) {
  return new Promise((resolve, reject) => {
    let intentos = 0;
    const probar = (p) => {
      const alFallar = (e) => {
        if (e.code === 'EADDRINUSE' && intentos++ < 15) probar(p + 1);
        else reject(e);
      };
      servidor.once('error', alFallar);
      servidor.listen(p, host, () => {
        servidor.removeListener('error', alFallar);
        resolve(p);
      });
    };
    probar(puerto);
  });
}

async function principal() {
  console.log('\n  Despertando a Rubenchuelo…');
  const almacen = crearAlmacen(RAIZ);
  const ajustesApp = almacen.cargarAjustesApp();

  // ¿Ya hay un Rubenchuelo abierto en esta carpeta? Entonces solo se abre el navegador.
  const candado = almacen.leerCandado();
  if (candado && candado.pid !== process.pid && procesoVivo(candado.pid) && (await responde(candado.puerto))) {
    const url = `http://127.0.0.1:${candado.puerto}/`;
    console.log(`  Rubenchuelo ya estaba despierto en ${url}`);
    if (!sinNavegador) abrirNavegador(url);
    setTimeout(() => process.exit(0), 1500);
    return;
  }

  const app = new Aplicacion({ almacen, ajustesApp });
  try {
    await app.cargarCerebro(ajustesApp.cerebroActivo);
  } catch (e) {
    console.error(`  No se pudo cargar el cerebro «${ajustesApp.cerebroActivo}»: ${e.message}. Uso «principal».`);
    ajustesApp.cerebroActivo = 'principal';
    almacen.guardarAjustesApp(ajustesApp);
    await app.cargarCerebro('principal');
  }

  const host = ajustesApp.accesoRed ? '0.0.0.0' : '127.0.0.1';
  const servidor = http.createServer(crearManejador(app));
  servidor.keepAliveTimeout = 5000;
  const puerto = await escuchar(servidor, puertoArg || ajustesApp.puerto, host);
  app.puerto = puerto;
  almacen.tomarCandado({ pid: process.pid, puerto });
  app.iniciarDifusion();

  const url = `http://127.0.0.1:${puerto}/`;
  const s = app.cerebro.resumen();
  console.log('');
  console.log('  ==============================================');
  console.log('    Rubenchuelo está despierto');
  console.log(`    Cerebro: ${app.nombreCerebro} (${s.neuronas.toLocaleString('es-ES')} neuronas)`);
  console.log(`    Ábrelo en: ${url}`);
  if (ajustesApp.accesoRed) console.log('    Acceso desde la red local: ACTIVADO');
  console.log('  ==============================================');
  console.log('    No cierres esta ventana mientras lo uses.');
  console.log('    Para salir: botón «Guardar y salir» o Ctrl+C.');
  console.log('');
  if (ajustesApp.abrirNavegador && !sinNavegador) abrirNavegador(url);

  let cerrando = false;
  const cerrar = (motivo) => {
    if (cerrando) return;
    cerrando = true;
    console.log(`\n  Guardando el cerebro y cerrando (${motivo})…`);
    app.cerrar();
    servidor.close();
    console.log('  Listo. ¡Hasta luego!');
    process.exit(0);
  };
  app.alSalir = () => setTimeout(() => cerrar('Guardar y salir'), 300);
  for (const senal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    try { process.on(senal, () => cerrar(senal)); } catch { /* señal no disponible en este sistema */ }
  }
  process.on('uncaughtException', (e) => {
    console.error('  Error inesperado:', e);
    try { app.guardarSync(); } catch { /* lo intentamos */ }
  });
}

principal().catch((e) => {
  console.error('\n  No se pudo arrancar Rubenchuelo:', e.message);
  process.exitCode = 1;
});
