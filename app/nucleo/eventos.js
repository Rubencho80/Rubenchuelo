'use strict';
// Difusión en directo a la interfaz y a otras apps (Server-Sent Events).

class Difusor {
  constructor() {
    this.clientes = new Set();
    this._latido = setInterval(() => {
      for (const res of this.clientes) res.write(': latido\n\n');
    }, 20000);
    if (this._latido.unref) this._latido.unref();
  }

  conectar(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 2000\n\n');
    this.clientes.add(res);
    req.on('close', () => this.clientes.delete(res));
  }

  // `prescindible`: animaciones que se pueden saltar si un cliente va lento.
  emitir(tipo, datos, { prescindible = false } = {}) {
    if (!this.clientes.size) return;
    const msg = `event: ${tipo}\ndata: ${JSON.stringify(datos)}\n\n`;
    for (const res of this.clientes) {
      if (prescindible && res.writableLength > 2_000_000) continue;
      res.write(msg);
    }
  }

  cerrar() {
    clearInterval(this._latido);
    for (const res of this.clientes) res.end();
    this.clientes.clear();
  }
}

module.exports = { Difusor };
