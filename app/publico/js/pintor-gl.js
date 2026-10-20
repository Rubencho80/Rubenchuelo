// Pintor optimizado: dibuja el mapa con la tarjeta gráfica (WebGL 2).
// Las neuronas y las conexiones se suben a la tarjeta una vez y allí se quedan;
// cada cuadro son unas pocas órdenes aunque haya cientos de miles. En cada
// cuadro solo se manda lo que cambia sin parar: lo que brilla y las señales.
// Debajo, en un lienzo 2D, va el fondo con las regiones; encima, en el lienzo
// del mapa, las etiquetas y los anillos. Se ve igual que el pintor clásico.

import { COLOR, COLOR_ARISTA, ALFA_ARISTA, FUENTE_ETIQUETA, pintarFondo } from './pintor-lienzo.js';

const ANCHO_TEX = 1024;   // neuronas por fila en las texturas (celda() lo da por hecho)
const COLOR_TEXTO = ['#d7f6f2', '#ead9ff', '#ffe6b0', '#d6e4ff', '#d6e4ff', '#d6e4ff'];
const SEG = 9;     // floats por segmento: x1 y1 x2 y2 · r g b a · ancho
const BRILLO = 7;  // floats por brillo: x y radio alfa · r g b

// Cada neurona ocupa una «celda» en dos texturas: uPos (de dónde viene y adónde
// va) y uAtr (tipo + 16 si está enfocada, tamaño, cuándo nació, cuándo murió).
const COMUN = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform vec3 uCam;
uniform vec2 uVista;
uniform sampler2D uPos;
uniform sampler2D uAtr;
uniform float uE;
const vec4 FUERA = vec4(2.0, 2.0, 2.0, 1.0);
vec2 aPantalla(vec2 w) { return (w - uCam.xy) * uCam.z + uVista * 0.5; }
vec4 aClip(vec2 p) { return vec4(p.x / uVista.x * 2.0 - 1.0, 1.0 - p.y / uVista.y * 2.0, 0.0, 1.0); }
ivec2 celda(int i) { return ivec2(i & 1023, i >> 10); }
vec2 posicion(int i) { vec4 p = texelFetch(uPos, celda(i), 0); return mix(p.xy, p.zw, uE); }
vec2 esquina() { return vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)); }
`;

const VS_NEURONAS = `
uniform int uVisibles;
uniform float uCrecer;
uniform float uDpr;
uniform float uAhora;
uniform int uPasada;
uniform float uAlfa;
uniform float uZ;
out vec2 vLocal;
out float vR;
flat out int vTipo;
out float vAlfa;
out float vLinea;
void main() {
  int i = gl_InstanceID;
  vec4 a = texelFetch(uAtr, celda(i), 0);
  int tf = int(a.x + 0.5);
  int tipo = tf & 15;
  bool foco = (tf & 16) != 0;
  if (a.y <= 0.0 || ((uVisibles >> tipo) & 1) == 0 || (uPasada == 1 && foco) || (uPasada == 2 && !foco)) {
    gl_Position = FUERA;
    return;
  }
  float r = max(1.6, a.y * uCrecer);
  if (a.z > 0.0) {
    float p = max(0.0, (uAhora - a.z) / 0.6);
    if (p < 1.0) r *= 0.3 + 0.7 * (1.0 - pow(1.0 - p, 3.0)) + sin(p * 3.14159265) * 0.35;
  }
  if (a.w > 0.0) r *= max(0.0, 1.0 - (uAhora - a.w) / 0.7);
  r *= uDpr;
  float linea = tipo == 1 ? max(1.2, 1.8 * min(1.4, uZ)) * uDpr : 0.0;
  float ext = r + linea * 0.5 + 1.0;
  vec2 c = aPantalla(posicion(i));
  if (r < 0.05 || c.x < -ext || c.y < -ext || c.x > uVista.x + ext || c.y > uVista.y + ext) {
    gl_Position = FUERA;
    return;
  }
  vLocal = (esquina() * 2.0 - 1.0) * ext;
  vR = r;
  vTipo = tipo;
  vLinea = linea;
  vAlfa = (uPasada == 1 ? 0.22 : 1.0) * uAlfa;
  gl_Position = aClip(c + vLocal);
}`;

// Cada forma se calcula por distancia al borde: los bordes salen suaves sin
// pedirle antialiasing a la tarjeta.
const FS_NEURONAS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vR;
flat in int vTipo;
in float vAlfa;
in float vLinea;
uniform vec3 uColores[6];
out vec4 color;
float cubre(float d) { return clamp(0.5 - d, 0.0, 1.0); }
void main() {
  vec2 p = vLocal;
  float r = vR;
  float a;
  if (vTipo == 1) {
    float l = length(p);
    float trazo = cubre(abs(l - r) - vLinea * 0.5);
    a = trazo + cubre(l - r) * 0.22 * (1.0 - trazo);
  } else if (vTipo == 2) {
    vec2 q = abs(p) - vec2(r * 0.85);
    a = cubre(max(q.x, q.y));
  } else if (vTipo == 3) {
    float d1 = -0.7 * r - p.y;
    float d2 = dot(p - vec2(r, -0.7 * r), vec2(0.8619, 0.5070));
    float d3 = dot(p - vec2(0.0, r), vec2(-0.8619, 0.5070));
    a = cubre(max(d1, max(d2, d3)));
  } else if (vTipo >= 4) {
    a = cubre((abs(p.x) + abs(p.y) - r) * 0.70710678);
  } else {
    a = cubre(length(p) - r);
  }
  a *= vAlfa;
  if (a < 0.003) discard;
  color = vec4(uColores[vTipo] * a, a);
}`;

const VS_ARISTAS = `
layout(location = 0) in uvec2 aExt;
layout(location = 1) in vec2 aPC;
uniform float uPesoMin;
uniform int uVisibles;
uniform float uAlfa;
uniform float uAnchoBase;
uniform float uDpr;
uniform float uAhora;
uniform vec3 uColorArista[5];
uniform float uAlfaArista[5];
out float vD;
out float vMedio;
out vec4 vColor;
void main() {
  int ia = int(aExt.x);
  int ib = int(aExt.y);
  float w = aPC.x;
  int k = int(aPC.y + 0.5);
  vec4 ta = texelFetch(uAtr, celda(ia), 0);
  vec4 tb = texelFetch(uAtr, celda(ib), 0);
  int tipoA = int(ta.x + 0.5) & 15;
  int tipoB = int(tb.x + 0.5) & 15;
  if ((k < 2 && w < uPesoMin) || ta.y <= 0.0 || tb.y <= 0.0
      || ((uVisibles >> tipoA) & 1) == 0 || ((uVisibles >> tipoB) & 1) == 0
      || (ta.w > 0.0 && uAhora - ta.w > 0.7) || (tb.w > 0.0 && uAhora - tb.w > 0.7)) {
    gl_Position = FUERA;
    return;
  }
  vec2 p1 = aPantalla(posicion(ia));
  vec2 p2 = aPantalla(posicion(ib));
  float c = min(3.0, floor(w * 4.0));
  float medio = max(0.5, (0.45 + c * 0.4) * uAnchoBase) * uDpr * 0.5;
  vColor = vec4(uColorArista[k], uAlfaArista[k] * (0.22 + c * 0.26) * uAlfa);
  vec2 d = p2 - p1;
  float L = length(d);
  vec2 dir = L > 0.001 ? d / L : vec2(1.0, 0.0);
  vec2 q = esquina();
  float lado = q.y * 2.0 - 1.0;
  float ext = medio + 1.0;
  gl_Position = aClip(mix(p1, p2, q.x) + dir * (q.x * 2.0 - 1.0) * medio + vec2(-dir.y, dir.x) * lado * ext);
  vD = lado * ext;
  vMedio = medio;
}`;

// Segmentos sueltos con su color: las conexiones destacadas y las colas de las señales.
const VS_SEGMENTOS = `
layout(location = 0) in vec4 aP;
layout(location = 1) in vec4 aColor;
layout(location = 2) in float aAncho;
uniform float uDpr;
out float vD;
out float vMedio;
out vec4 vColor;
void main() {
  vec2 p1 = aPantalla(aP.xy);
  vec2 p2 = aPantalla(aP.zw);
  float medio = aAncho * uDpr * 0.5;
  vec2 d = p2 - p1;
  float L = length(d);
  vec2 dir = L > 0.001 ? d / L : vec2(1.0, 0.0);
  vec2 q = esquina();
  float lado = q.y * 2.0 - 1.0;
  float ext = medio + 1.0;
  gl_Position = aClip(mix(p1, p2, q.x) + dir * (q.x * 2.0 - 1.0) * medio + vec2(-dir.y, dir.x) * lado * ext);
  vD = lado * ext;
  vMedio = medio;
  vColor = aColor;
}`;

// Cobertura exacta de un píxel por una línea de cierto grosor (también si es más fina que un píxel).
const FS_LINEA = `#version 300 es
precision highp float;
in float vD;
in float vMedio;
in vec4 vColor;
out vec4 color;
void main() {
  float d = abs(vD);
  float a = clamp(min(d + vMedio, 0.5) - max(d - vMedio, -0.5), 0.0, 1.0) * vColor.a;
  if (a < 0.003) discard;
  color = vec4(vColor.rgb * a, a);
}`;

const VS_BRILLOS = `
layout(location = 0) in vec4 aS;
layout(location = 1) in vec3 aCol;
uniform float uDpr;
out vec2 vLocal;
out float vR;
out vec4 vColor;
void main() {
  vec2 c = aPantalla(aS.xy);
  float R = aS.z * uDpr;
  if (R < 0.05 || c.x < -R || c.y < -R || c.x > uVista.x + R || c.y > uVista.y + R) {
    gl_Position = FUERA;
    return;
  }
  vLocal = (esquina() * 2.0 - 1.0) * R;
  vR = R;
  vColor = vec4(aCol, aS.w);
  gl_Position = aClip(c + vLocal);
}`;

// El mismo degradado que el brillo del pintor clásico (1 → 0,6 → 0).
const FS_BRILLOS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vR;
in vec4 vColor;
out vec4 color;
void main() {
  float t = length(vLocal) / vR;
  if (t >= 1.0) discard;
  float a = (t < 0.22 ? mix(1.0, 0.6, t / 0.22) : mix(0.6, 0.0, (t - 0.22) / 0.78)) * vColor.a;
  color = vec4(vColor.rgb * a, a);
}`;

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

function compilar(gl, tipo, fuente) {
  const s = gl.createShader(tipo);
  gl.shaderSource(s, fuente);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`sombreador: ${error}`);
  }
  return s;
}

function programa(gl, vs, fs, uniformes) {
  const p = gl.createProgram();
  gl.attachShader(p, compilar(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compilar(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`programa: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  for (const nombre of ['uCam', 'uVista', 'uPos', 'uAtr', 'uE', ...uniformes]) u[nombre] = gl.getUniformLocation(p, nombre);
  return { p, u };
}

export class PintorGL {
  constructor(mapa) {
    this.m = mapa;
    this.cvFondo = document.createElement('canvas');
    this.cvGL = document.createElement('canvas');
    for (const c of [this.cvFondo, this.cvGL]) {
      c.className = 'capa';
      c.setAttribute('aria-hidden', 'true');
    }
    const gl = this.cvGL.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('el navegador no tiene WebGL 2');
    this.gl = gl;
    this.gf = this.cvFondo.getContext('2d');
    this.t0 = performance.now();
    this.colores = new Float32Array(COLOR.flatMap(rgb));
    this.coloresArista = new Float32Array(COLOR_ARISTA.flatMap(rgb));
    this.rgbArista = COLOR_ARISTA.map(rgb);
    this.alfasArista = new Float32Array(ALFA_ARISTA);
    this.rgbTipo = COLOR.map(rgb);
    this.rgbColor = new Map();
    this.datosSeg = new Float32Array(SEG * 512);
    this.datosBrillo = new Float32Array(BRILLO * 1024);
    this._iniciarGL();
    mapa.cv.before(this.cvFondo, this.cvGL);
    this.perdido = false;
    this._alPerder = (e) => { e.preventDefault(); this.perdido = true; };
    this._alRecuperar = () => {
      try {
        this._iniciarGL();
        this.alCargar();
        this.perdido = false;
      } catch (err) {
        console.warn('No se pudo recuperar la tarjeta gráfica:', err);
        mapa._pintorFallido();
      }
      mapa.sucio = true;
    };
    this.cvGL.addEventListener('webglcontextlost', this._alPerder);
    this.cvGL.addEventListener('webglcontextrestored', this._alRecuperar);
  }

  _iniciarGL() {
    const gl = this.gl;
    this.pNeuronas = programa(gl, COMUN + VS_NEURONAS, FS_NEURONAS, ['uVisibles', 'uCrecer', 'uDpr', 'uAhora', 'uPasada', 'uAlfa', 'uZ', 'uColores']);
    this.pAristas = programa(gl, COMUN + VS_ARISTAS, FS_LINEA, ['uPesoMin', 'uVisibles', 'uAlfa', 'uAnchoBase', 'uDpr', 'uAhora', 'uColorArista', 'uAlfaArista']);
    this.pSegmentos = programa(gl, COMUN + VS_SEGMENTOS, FS_LINEA, ['uDpr']);
    this.pBrillos = programa(gl, COMUN + VS_BRILLOS, FS_BRILLOS, ['uDpr']);

    this.texPos = gl.createTexture();
    this.texAtr = gl.createTexture();
    for (const t of [this.texPos, this.texAtr]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    this.capacidad = 0;
    this.pos = null;
    this.atr = null;
    this.pendiente = { pos: [Infinity, -1], atr: [Infinity, -1] };

    this.vaoVacio = gl.createVertexArray();
    this.vaoAristas = gl.createVertexArray();
    this.bufExt = gl.createBuffer();
    this.bufPC = gl.createBuffer();
    gl.bindVertexArray(this.vaoAristas);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufExt);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 2, gl.UNSIGNED_INT, 0, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPC);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    this.vaoSeg = gl.createVertexArray();
    this.bufSeg = gl.createBuffer();
    gl.bindVertexArray(this.vaoSeg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSeg);
    for (const [loc, n, desde] of [[0, 4, 0], [1, 4, 16], [2, 1, 32]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, SEG * 4, desde);
      gl.vertexAttribDivisor(loc, 1);
    }

    this.vaoBrillo = gl.createVertexArray();
    this.bufBrillo = gl.createBuffer();
    gl.bindVertexArray(this.vaoBrillo);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufBrillo);
    for (const [loc, n, desde] of [[0, 4, 0], [1, 3, 16]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, BRILLO * 4, desde);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.slots = [];
    this.slotDe = new Map();
    this.nSlots = 0;
    this.nAristas = 0;
    this._claveFondo = '';
  }

  // ───────────── datos en la tarjeta ─────────────

  _reservar(n) {
    const gl = this.gl;
    if (n <= this.capacidad) return;
    const cap = Math.ceil((n * 1.25) / ANCHO_TEX) * ANCHO_TEX;
    const filas = cap / ANCHO_TEX;
    if (filas > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('demasiadas neuronas para la tarjeta gráfica');
    this.pos = new Float32Array(cap * 4);
    this.atr = new Float32Array(cap * 4);
    for (const t of [this.texPos, this.texAtr]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ANCHO_TEX, filas, 0, gl.RGBA, gl.FLOAT, null);
    }
    this.capacidad = cap;
  }

  _escribir(i, n) {
    const o = i * 4;
    const p = this.pos, a = this.atr;
    p[o] = n.ox; p[o + 1] = n.oy; p[o + 2] = n.tx; p[o + 3] = n.ty;
    a[o] = n.t + (this.m.enfocados.has(n.id) ? 16 : 0);
    a[o + 1] = Math.max(0.01, n.s);
    a[o + 2] = n.nace ? Math.max(0.001, (n.nace - this.t0) / 1000) : 0;
    a[o + 3] = n.muere ? Math.max(0.001, (n.muere - this.t0) / 1000) : 0;
  }

  _marcar(cual, i) {
    const r = this.pendiente[cual];
    if (i < r[0]) r[0] = i;
    if (i > r[1]) r[1] = i;
  }

  _marcarTodo(cual) {
    if (this.nSlots) this.pendiente[cual] = [0, this.nSlots - 1];
  }

  _subirPendiente() {
    const gl = this.gl;
    for (const [cual, tex, datos] of [['pos', this.texPos, this.pos], ['atr', this.texAtr, this.atr]]) {
      const r = this.pendiente[cual];
      if (r[1] < r[0]) continue;
      const f0 = Math.floor(r[0] / ANCHO_TEX), f1 = Math.floor(r[1] / ANCHO_TEX);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, f0, ANCHO_TEX, f1 - f0 + 1, gl.RGBA, gl.FLOAT, datos, f0 * ANCHO_TEX * 4);
      this.pendiente[cual] = [Infinity, -1];
    }
  }

  // Todo de nuevo: cada neurona a su celda (ordenadas por tipo, que es el
  // orden en que se dibujan) y las conexiones apuntando a esas celdas.
  alCargar() {
    const m = this.m, gl = this.gl;
    const porTipo = [[], [], [], [], [], []];
    for (const n of m.nodos.values()) porTipo[n.t].push(n);
    const lista = [].concat(...porTipo);
    this._reservar(lista.length + 512);
    this.slots = lista;
    this.slotDe = new Map();
    for (let i = 0; i < lista.length; i++) {
      this.slotDe.set(lista[i].id, i);
      this._escribir(i, lista[i]);
    }
    this.nSlots = lista.length;
    this._marcarTodo('pos');
    this._marcarTodo('atr');

    const A = m.aristas;
    const ext = new Uint32Array(A.n * 2), pc = new Float32Array(A.n * 2);
    let k = 0;
    for (let j = 0; j < A.n; j++) {
      const sa = this.slotDe.get(A.a[j]), sb = this.slotDe.get(A.b[j]);
      if (sa === undefined || sb === undefined) continue;
      ext[2 * k] = sa; ext[2 * k + 1] = sb;
      pc[2 * k] = A.w[j]; pc[2 * k + 1] = A.k[j];
      k++;
    }
    this.nAristas = k;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufExt);
    gl.bufferData(gl.ARRAY_BUFFER, ext.subarray(0, 2 * k), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPC);
    gl.bufferData(gl.ARRAY_BUFFER, pc.subarray(0, 2 * k), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  // Neuronas que nacen, mueren o reviven.
  alNodos(lista) {
    for (const n of lista) {
      let i = this.slotDe.get(n.id);
      if (i === undefined) {
        if (this.nSlots >= this.capacidad) { this.alCargar(); return; }
        i = this.nSlots++;
        this.slotDe.set(n.id, i);
        this.slots[i] = n;
      }
      this._escribir(i, n);
      this._marcar('pos', i);
      this._marcar('atr', i);
    }
  }

  alQuitar(lista) {
    for (const n of lista) {
      const i = this.slotDe.get(n.id);
      if (i === undefined) continue;
      this.slotDe.delete(n.id);
      this.slots[i] = null;
      this.atr[i * 4 + 1] = 0;
      this._marcar('atr', i);
    }
  }

  alMover() {
    const p = this.pos;
    for (let i = 0; i < this.nSlots; i++) {
      const n = this.slots[i];
      if (!n) continue;
      const o = i * 4;
      p[o] = n.ox; p[o + 1] = n.oy; p[o + 2] = n.tx; p[o + 3] = n.ty;
    }
    this._marcarTodo('pos');
  }

  alEnfocar() {
    const a = this.atr, enfocados = this.m.enfocados;
    if (!a) return;
    for (let i = 0; i < this.nSlots; i++) {
      const n = this.slots[i];
      if (n) a[i * 4] = n.t + (enfocados.has(n.id) ? 16 : 0);
    }
    this._marcarTodo('atr');
  }

  redimensionar() {
    const m = this.m;
    for (const c of [this.cvFondo, this.cvGL]) {
      c.width = Math.round(m.ancho * m.dpr);
      c.height = Math.round(m.alto * m.dpr);
    }
    this._claveFondo = '';
  }

  destruir() {
    this.cvGL.removeEventListener('webglcontextlost', this._alPerder);
    this.cvGL.removeEventListener('webglcontextrestored', this._alRecuperar);
    const perder = this.gl.getExtension('WEBGL_lose_context');
    if (perder) perder.loseContext();
    this.cvFondo.remove();
    this.cvGL.remove();
    const m = this.m;
    m.g.setTransform(1, 0, 0, 1, 0, 0);
    m.g.clearRect(0, 0, m.cv.width, m.cv.height);
  }

  // ───────────── dibujo ─────────────

  _radio(n, ahora, crecer) {
    let r = Math.max(1.6, n.s * crecer);
    if (n.nace) {
      const p = (ahora - n.nace) / 600;
      if (p < 1) r *= 0.3 + 0.7 * (1 - Math.pow(1 - p, 3)) + Math.sin(p * Math.PI) * 0.35;
    }
    if (n.muere) r *= Math.max(0, 1 - (ahora - n.muere) / 700);
    return r;
  }

  _rgbDe(hex) {
    let c = this.rgbColor.get(hex);
    if (!c) this.rgbColor.set(hex, (c = rgb(hex)));
    return c;
  }

  _segmento(n, x1, y1, x2, y2, ancho, c, a) {
    if ((n + 1) * SEG > this.datosSeg.length) {
      const mas = new Float32Array(this.datosSeg.length * 2);
      mas.set(this.datosSeg);
      this.datosSeg = mas;
    }
    const d = this.datosSeg, o = n * SEG;
    d[o] = x1; d[o + 1] = y1; d[o + 2] = x2; d[o + 3] = y2;
    d[o + 4] = c[0]; d[o + 5] = c[1]; d[o + 6] = c[2]; d[o + 7] = a; d[o + 8] = ancho;
  }

  _brillo(n, x, y, R, a, c) {
    if ((n + 1) * BRILLO > this.datosBrillo.length) {
      const mas = new Float32Array(this.datosBrillo.length * 2);
      mas.set(this.datosBrillo);
      this.datosBrillo = mas;
    }
    const d = this.datosBrillo, o = n * BRILLO;
    d[o] = x; d[o + 1] = y; d[o + 2] = R; d[o + 3] = a;
    d[o + 4] = c[0]; d[o + 5] = c[1]; d[o + 6] = c[2];
  }

  _comunes(P, cam, vista) {
    const gl = this.gl;
    gl.useProgram(P.p);
    gl.uniform3fv(P.u.uCam, cam);
    gl.uniform2fv(P.u.uVista, vista);
    gl.uniform1i(P.u.uPos, 0);
    gl.uniform1i(P.u.uAtr, 1);
    gl.uniform1f(P.u.uE, this.m.e);
  }

  _segmentos(n, P, cam, vista) {
    if (!n) return;
    const gl = this.gl;
    this._comunes(P, cam, vista);
    gl.uniform1f(P.u.uDpr, this.m.dpr);
    gl.bindVertexArray(this.vaoSeg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSeg);
    gl.bufferData(gl.ARRAY_BUFFER, this.datosSeg.subarray(0, n * SEG), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
  }

  dibujar(ahora) {
    const m = this.m;
    const W = m.ancho, H = m.alto;
    const clave = `${m.cam.x}|${m.cam.y}|${m.cam.z}|${W}|${H}|${m.noche}|${m.regiones.length}`;
    if (clave !== this._claveFondo) {
      this._claveFondo = clave;
      this.gf.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
      pintarFondo(this.gf, m, W, H);
    }
    if (!this.perdido && !this.gl.isContextLost()) this._pintarGL(ahora);
    this._superponer(ahora);
  }

  _pintarGL(ahora) {
    const m = this.m, gl = this.gl;
    const z = m.cam.z, dpr = m.dpr;
    this._subirPendiente();
    const vista = [this.cvGL.width, this.cvGL.height];
    const cam = [m.cam.x, m.cam.y, z * dpr];
    const seg = (ahora - this.t0) / 1000;
    const atenuar = m.enfocados.size > 0;
    gl.viewport(0, 0, vista[0], vista[1]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texPos);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texAtr);

    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // 1. Conexiones.
    if (this.nAristas) {
      const P = this.pAristas;
      this._comunes(P, cam, vista);
      gl.uniform1f(P.u.uPesoMin, m.pesoMin);
      gl.uniform1i(P.u.uVisibles, m.mascara);
      gl.uniform1f(P.u.uAlfa, (atenuar ? 0.28 : 1) * (m.noche ? 0.7 : 1));
      gl.uniform1f(P.u.uAnchoBase, Math.min(1.5, Math.sqrt(z * 2)));
      gl.uniform1f(P.u.uDpr, dpr);
      gl.uniform1f(P.u.uAhora, seg);
      gl.uniform3fv(P.u.uColorArista, this.coloresArista);
      gl.uniform1fv(P.u.uAlfaArista, this.alfasArista);
      gl.bindVertexArray(this.vaoAristas);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nAristas);
    }

    // 2. Las conexiones de la seleccionada y el camino del «¿por qué?», bien visibles.
    let n = 0;
    const A = m.aristas;
    if (m.vecSel) {
      for (const j of m.vecSel) {
        const na = m.nodos.get(A.a[j]), nb = m.nodos.get(A.b[j]);
        if (!na || !nb) continue;
        const w = Math.min(1, A.w[j]);
        this._segmento(n++, m.x(na), m.y(na), m.x(nb), m.y(nb), 1 + 2.2 * w, this.rgbArista[A.k[j]], 0.35 + 0.6 * w);
      }
    }
    if (m.resaltado && m.resaltado.pasos.length) {
      const c = this._rgbDe('#ffe9a8');
      for (const [a, b] of m.resaltado.pasos) {
        const na = m.nodos.get(a), nb = m.nodos.get(b);
        if (na && nb) this._segmento(n++, m.x(na), m.y(na), m.x(nb), m.y(nb), 2.4, c, 0.9);
      }
    }
    this._segmentos(n, this.pSegmentos, cam, vista);

    // 3. Neuronas (si hay algo enfocado, primero las atenuadas y luego las enfocadas).
    if (this.nSlots) {
      const P = this.pNeuronas;
      this._comunes(P, cam, vista);
      gl.uniform1i(P.u.uVisibles, m.mascara);
      gl.uniform1f(P.u.uCrecer, 0.55 + 0.45 * Math.pow(z, 0.6));
      gl.uniform1f(P.u.uDpr, dpr);
      gl.uniform1f(P.u.uAhora, seg);
      gl.uniform1f(P.u.uAlfa, m.noche ? 0.8 : 1);
      gl.uniform1f(P.u.uZ, z);
      gl.uniform3fv(P.u.uColores, this.colores);
      gl.bindVertexArray(this.vaoVacio);
      for (const pasada of atenuar ? [1, 2] : [0]) {
        gl.uniform1i(P.u.uPasada, pasada);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nSlots);
      }
    }

    // 4. Lo que brilla y las señales: su luz se suma a lo que hay debajo.
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
    const crecer = 0.55 + 0.45 * Math.pow(z, 0.6);
    let nb = 0;
    const blanco = this._rgbDe('#ffffff');
    for (const [id, a] of m.actividad) {
      const nd = m.nodos.get(id);
      if (!nd || !((m.mascara >> nd.t) & 1)) continue;
      const r = this._radio(nd, ahora, crecer);
      const x = m.x(nd), y = m.y(nd);
      this._brillo(nb++, x, y, r * (2.4 + 4.5 * a) + 7 * a, Math.min(1, 0.2 + a * 0.9), this.rgbTipo[nd.t]);
      if (a > 0.35) this._brillo(nb++, x, y, r * 1.7, Math.min(1, (a - 0.35) * 1.4), blanco);
    }
    n = 0;
    for (const s of m.senales) {
      const p = (ahora - s.t0) / s.dur;
      if (p >= 1 || p < 0) continue;
      const na = m.nodos.get(s.a), nd = m.nodos.get(s.b);
      if (!na || !nd) continue;
      const x1 = m.x(na), y1 = m.y(na), x2 = m.x(nd), y2 = m.y(nd);
      const e = 1 - Math.pow(1 - p, 2);
      const x = x1 + (x2 - x1) * e, y = y1 + (y2 - y1) * e;
      const cola = Math.max(0, e - 0.3);
      const c = this._rgbDe(s.color);
      this._segmento(n++, x1 + (x2 - x1) * cola, y1 + (y2 - y1) * cola, x, y, 1.4, c, 0.45 * (1 - p) * Math.min(1, 0.4 + s.fuerza));
      this._brillo(nb++, x, y, 3 + 5 * Math.min(1, s.fuerza), 0.95 * (1 - p * 0.6), c);
    }
    this._segmentos(n, this.pSegmentos, cam, vista);
    if (nb) {
      const P = this.pBrillos;
      this._comunes(P, cam, vista);
      gl.uniform1f(P.u.uDpr, dpr);
      gl.bindVertexArray(this.vaoBrillo);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufBrillo);
      gl.bufferData(gl.ARRAY_BUFFER, this.datosBrillo.subarray(0, nb * BRILLO), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nb);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  // Encima, en el lienzo 2D: anillos y etiquetas (son pocos).
  _superponer(ahora) {
    const m = this.m, g = m.g;
    const W = m.ancho, H = m.alto, z = m.cam.z;
    g.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, W, H);
    const crecer = 0.55 + 0.45 * Math.pow(z, 0.6);
    const cx = m.cam.x, cy = m.cam.y;
    const enPantalla = (n) => {
      const sx = (m.x(n) - cx) * z + W / 2, sy = (m.y(n) - cy) * z + H / 2;
      return sx > -60 && sx < W + 60 && sy > -60 && sy < H + 60 ? [sx, sy] : null;
    };
    const visible = (n) => n && !n.muere && (m.mascara >> n.t) & 1;

    // Nacimientos: un anillo que se expande.
    g.lineWidth = 1.5;
    for (const n of m.recientes) {
      if (!((m.mascara >> n.t) & 1)) continue;
      const p = (ahora - n.nace) / 1400;
      const s = p < 1 ? enPantalla(n) : null;
      if (!s) continue;
      g.strokeStyle = COLOR[n.t];
      g.globalAlpha = (1 - p) * 0.9;
      g.beginPath();
      g.arc(s[0], s[1], this._radio(n, ahora, crecer) + 4 + 22 * p, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;

    // Anillo de la seleccionada y de la que está bajo el ratón.
    for (const id of [m.seleccion, m.encima]) {
      if (id === null) continue;
      const n = m.nodos.get(id);
      const s = visible(n) ? enPantalla(n) : null;
      if (!s) continue;
      g.strokeStyle = '#ffffff';
      g.lineWidth = id === m.seleccion ? 2 : 1.2;
      g.globalAlpha = id === m.seleccion ? 0.95 : 0.6;
      g.beginPath();
      g.arc(s[0], s[1], this._radio(n, ahora, crecer) + 5, 0, Math.PI * 2);
      g.stroke();
    }
    // Lo que tiene en mente.
    if (m.enMente.size) {
      g.strokeStyle = '#e8fbff';
      g.lineWidth = 1.3;
      g.globalAlpha = 0.65;
      g.setLineDash([3, 4]);
      g.beginPath();
      for (const id of m.enMente) {
        const n = m.nodos.get(id);
        const s = visible(n) ? enPantalla(n) : null;
        if (!s) continue;
        const r = this._radio(n, ahora, crecer) + 8;
        g.moveTo(s[0] + r, s[1]);
        g.arc(s[0], s[1], r, 0, Math.PI * 2);
      }
      g.stroke();
      g.setLineDash([]);
    }
    g.globalAlpha = 1;
    this._etiquetas(ahora, crecer, enPantalla, visible);
  }

  // Las mismas reglas que el pintor clásico, pero sin recorrer ni ordenar todas
  // las neuronas en cada cuadro: primero lo importante y luego de mayor a menor
  // (m.porTamano ya viene ordenado), hasta llenar el hueco.
  _etiquetas(ahora, crecer, enPantalla, visible) {
    const m = this.m, g = m.g, z = m.cam.z;
    const maximo = z < 0.35 ? 110 : z < 0.8 ? 180 : 260;
    g.font = FUENTE_ETIQUETA;
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 3.5;
    g.strokeStyle = m.noche ? 'rgba(3,5,12,0.9)' : 'rgba(9,13,25,0.88)';
    if (!this._anchos || this._anchos.size > 60000) this._anchos = new Map();
    const ocupado = new Set();
    const CW = 24, CH = 16;
    let dibujadas = 0;
    let probadas = 0;
    let lleno = false;
    const probar = (n, prio) => {
      const s = enPantalla(n);
      if (!s) return;
      if (dibujadas >= maximo || ++probadas > maximo * 6) { lleno = true; return; }
      const texto = n.l.length > 32 ? `${n.l.slice(0, 31)}…` : n.l;
      let ancho = this._anchos.get(texto);
      if (ancho === undefined) { ancho = g.measureText(texto).width; this._anchos.set(texto, ancho); }
      const x = s[0] + this._radio(n, ahora, crecer) + 4, y = s[1];
      const c0 = Math.floor(x / CW), c1 = Math.floor((x + ancho) / CW), f = Math.floor(y / CH) + 1000;
      if (prio < 800) for (let c = c0; c <= c1; c++) if (ocupado.has(f * 100000 + c + 1000)) return;
      for (let c = c0; c <= c1; c++) ocupado.add(f * 100000 + c + 1000);
      const act = m.actividad.get(n.id) || 0;
      g.globalAlpha = prio >= 500 ? 1 : 0.82;
      g.strokeText(texto, x, y);
      g.fillStyle = act > 0.25 ? '#ffffff' : COLOR_TEXTO[n.t];
      g.fillText(texto, x, y);
      dibujadas++;
    };

    const hechas = new Set();
    const especiales = [];
    const anadir = (id, prio) => {
      if (id === null || hechas.has(id)) return;
      const n = m.nodos.get(id);
      if (!visible(n) || !n.l || n.t === 3) return;
      hechas.add(id);
      especiales.push([prio, n]);
    };
    anadir(m.seleccion, 1000);
    anadir(m.encima, 950);
    for (const id of m.enfocados) anadir(id, 800);
    for (const id of m.enMente) anadir(id, 700);
    for (const [id, a] of m.actividad) if (a > 0.25) anadir(id, 500 + a * 100);
    especiales.sort((a, b) => b[0] - a[0]);
    for (const [prio, n] of especiales) {
      probar(n, prio);
      if (lleno) break;
    }
    if (m.etiquetas && !lleno) {
      for (const n of m.porTamano) {
        if (n.muere || hechas.has(n.id) || !((m.mascara >> n.t) & 1)) continue;
        const r = Math.max(1.6, n.s * crecer);
        if (r < 3.4 && z <= 1.3) {
          if (n.t >= 4) continue;
          break;   // de aquí en adelante todas son más pequeñas
        }
        if (n.t === 2 && z <= 1.1) continue;
        probar(n, r * 10 + (n.t >= 4 ? 400 : 0));
        if (lleno) break;
      }
    }
    g.globalAlpha = 1;
  }
}
