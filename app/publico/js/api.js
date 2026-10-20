// Comunicación con el servidor local de Rubenchuelo.

let token = document.querySelector('meta[name="rubenchuelo-token"]')?.content || '';

export const obtenerToken = () => token;
export function ponerToken(t) { token = t; }

export async function api(ruta, { metodo = 'GET', cuerpo } = {}) {
  const cabeceras = { 'X-Rubenchuelo-Token': token, 'X-Rubenchuelo-Origen': 'interfaz' };
  if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch(ruta, { method: metodo, headers: cabeceras, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
  } catch {
    throw new Error('No hay conexión con Rubenchuelo');
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
  return datos;
}

// Para lo que llega en binario (el mapa): devuelve un ArrayBuffer.
export async function apiBinario(ruta) {
  let r;
  try {
    r = await fetch(ruta, { headers: { 'X-Rubenchuelo-Token': token, 'X-Rubenchuelo-Origen': 'interfaz' } });
  } catch {
    throw new Error('No hay conexión con Rubenchuelo');
  }
  if (!r.ok) {
    const datos = await r.json().catch(() => ({}));
    throw new Error(datos.error || `Error ${r.status}`);
  }
  return r.arrayBuffer();
}

// Eventos en directo. Se reconecta solo si se corta.
export function escuchar(manejadores, { alAbrir, alPerder } = {}) {
  let fuente = null;
  let perdida = false;
  const abrir = () => {
    fuente = new EventSource(`/api/eventos?token=${encodeURIComponent(token)}`);
    for (const [tipo, fn] of Object.entries(manejadores)) {
      fuente.addEventListener(tipo, (e) => {
        let datos;
        try { datos = JSON.parse(e.data); } catch { return; }
        try { fn(datos); } catch (err) { console.error(`Error en el evento ${tipo}:`, err); }
      });
    }
    fuente.onopen = () => {
      if (perdida) { perdida = false; if (alAbrir) alAbrir(true); } else if (alAbrir) alAbrir(false);
    };
    fuente.onerror = () => {
      if (!perdida) { perdida = true; if (alPerder) alPerder(); }
      if (fuente.readyState === EventSource.CLOSED) setTimeout(abrir, 2000);
    };
  };
  abrir();
  return { cerrar: () => fuente && fuente.close() };
}
