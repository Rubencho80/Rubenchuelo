// Modo escuchar en la interfaz: el botón del micrófono y la barra que enseña lo
// que va oyendo, lo que ha aprendido y lo que ha descartado por no entenderlo bien.

import { api } from './api.js';
import { el, avisar, num } from './util.js';

const $ = (id) => document.getElementById(id);

export class BarraOido {
  constructor() {
    this.boton = $('btnEscuchar');
    this.barra = $('oidoBarra');
    this.estadoTexto = $('oidoEstado');
    this.nivel = $('oidoNivel');
    this.cuentas = $('oidoCuentas');
    this.parcial = $('oidoParcial');
    this.ultima = $('oidoUltima');
    this.estado = { disponible: false, activo: false, oyendo: false, frases: 0, descartadas: 0 };
    this.dormido = false;
    this.boton.addEventListener('click', () => this._alternar());
  }

  async _alternar() {
    this.boton.disabled = true;
    try {
      this.poner(await api('/api/oido', { metodo: 'POST', cuerpo: { activo: !this.estado.activo } }));
    } catch (e) {
      avisar(e.message, 'error');
    } finally {
      this.boton.disabled = !this.estado.disponible;
    }
  }

  // Estado completo (llega con /api/estado y con los eventos «oido»).
  poner(e, { dormido = this.dormido } = {}) {
    if (!e) return;
    this.estado = { ...this.estado, ...e };
    this.dormido = dormido;
    const s = this.estado;
    this.boton.disabled = !s.disponible;
    if (!s.disponible) this.boton.title = 'Falta el oído (la carpeta «oido» con el modelo de voz)';
    this.boton.setAttribute('aria-pressed', s.activo ? 'true' : 'false');
    if (s.disponible) this.boton.title = s.activo ? 'Dejar de escuchar' : 'Escuchar: aprende de lo que oiga por el micrófono, sin contestar';
    this.barra.hidden = !s.activo;
    const parado = s.activo && (dormido || !s.oyendo);
    this.barra.classList.toggle('parado', parado);
    const con = s.motor === 'whisper' ? ' con Whisper' : s.cargandoWhisper ? ' (cargando Whisper…)' : ' con Vosk';
    this.estadoTexto.textContent = !s.activo ? '' : dormido ? 'Duerme: escuchará al despertar' : s.oyendo ? `Escuchando${con}` : 'Abriendo el micrófono…';
    this.cuentas.textContent = s.activo
      ? `${num(s.frases)} ${s.frases === 1 ? 'aprendida' : 'aprendidas'}${s.descartadas ? `, ${num(s.descartadas)} ${s.descartadas === 1 ? 'descartada' : 'descartadas'}` : ''}`
      : '';
    if (!s.activo || parado) { this.parcial.textContent = ''; this.nivel.style.width = '0'; }
    if (!s.activo) this.ultima.replaceChildren();
  }

  evento(m) {
    switch (m.tipo) {
      case 'estado':
        this.poner(m);
        break;
      case 'nivel':
        this.nivel.style.width = `${Math.round(Math.min(1, m.v) * 100)}%`;
        break;
      case 'parcial':
        this.parcial.textContent = m.texto ? `«${m.texto}…»` : '';
        break;
      case 'aprendida':
        this.estado.frases = m.frases;
        this.ultima.replaceChildren(el('span', { clase: 'si' }, '✓ Aprendido: '), `«${m.texto}»`);
        this.ultima.title = `Seguridad media ${Math.round(m.media * 100)} % (${m.motor === 'whisper' ? 'Whisper' : 'Vosk'})`;
        this.poner({});
        break;
      case 'descartada':
        this.estado.descartadas = m.descartadas;
        this.ultima.replaceChildren(el('span', { clase: 'no' }, m.motivo === 'otro idioma'
          ? '✗ Descartado (no es español): '
          : `✗ Descartado (${Math.round(m.media * 100)} % de seguridad): `), `«${m.texto}»`);
        this.ultima.title = m.motivo === 'otro idioma' ? 'Solo aprende lo que oye en español.' : 'No lo ha entendido bien, así que no lo aprende.';
        this.poner({});
        break;
      default:
        break;
    }
  }
}
