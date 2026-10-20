# API de Rubenchuelo

Para que otras aplicaciones hablen con Rubenchuelo, le den textos para leer o lo manden a dormir.

- **Dirección**: `http://127.0.0.1:7777` (si el puerto estaba ocupado, la ventana negra dice cuál usa).
- **Token**: obligatorio en todas las rutas salvo `/api/ping`. Lo tienes en la pestaña
  **Conexiones** (y en `ajustes.json`). Mándalo en la cabecera `X-Rubenchuelo-Token`
  (o como `?token=` en la dirección, por ejemplo para `/api/eventos`).
- Por defecto solo acepta conexiones desde **el mismo ordenador**. Para aceptar otros dispositivos
  de tu red, activa «Aceptar conexiones de otros dispositivos de la red» en Ajustes y reinicia.
- Las respuestas son JSON. Los errores llevan `{"error": "explicación"}` y un código HTTP
  (400 datos mal, 401 token, 404 no existe, 409 no se puede ahora, 413 demasiado grande).
- Texto en **UTF-8** (si llega en la codificación antigua de Windows también lo entiende).

## Hablarle

`POST /api/mensaje` con `{"texto": "¿Qué es Toby?"}`

```json
{ "id": 12, "texto": "Toby es mi perro.", "modo": "frase",
  "aprendido": { "palabras": 3, "nuevas": 0, "sorpresa": 0.44, "pregunta": true, "conceptoNuevo": false, "recuerdos": 0 },
  "desperto": false }
```

`modo` puede ser `frase`, `balbuceo` (no sabe qué decir), `curiosidad` (no conoce lo que preguntas)
o `durmiendo` (si está dormido y en Ajustes no se despierta al hablarle). Si lo despiertas,
`desperto` es `true` y estará aturdido un minuto.

**Premiar o castigar una respuesta** (dopamina): `POST /api/opinion` con `{"id": 12, "valor": 1}`
(o `-1`). Solo recuerda las últimas 60 respuestas.

**¿Por qué dijo eso?**: `GET /api/explicar/12`

## Darle textos para leer

`POST /api/aprender`, de dos maneras:

- JSON: `{"texto": "…muy largo…", "fuente": "libro.txt"}`
- Texto tal cual (`Content-Type: text/plain; charset=utf-8`) y el nombre en la dirección:
  `/api/aprender?fuente=libro.txt`

Opcional: `"repasos": 20` (o `&repasos=20`), las veces que lo repasa entero; si no, las de
Ajustes (5 por defecto). La tarea dice por cuál va (`repaso`, `repasos`).

Devuelve la tarea de lectura (`id`, `estado`: `en_cola`, `leyendo`, `en_pausa`, `terminada`,
`cancelada`). Si está dormido, el texto espera y lo lee al despertar. Tamaño máximo: 50 MB
(se cambia en Ajustes).

- `GET /api/lecturas`: estado y progreso de todas las lecturas.
- `DELETE /api/lecturas/{id}`: cancela una (lo ya leído queda aprendido).

## Escuchar (micrófono)

- `GET /api/oido`: `{ disponible, activo, oyendo, motor ('whisper' o 'vosk'), cargandoWhisper, whisper, frases, descartadas, error }`.
- `POST /api/oido` con `{"activo": true}` o `false`: empieza o deja de escuchar. Lo que oye se
  aprende como lo leído y no contesta.
- `GET /api/oido/dispositivos`: los micrófonos (`[{ id, nombre }]`; en Ajustes, `oido.dispositivo`).
- En los eventos en directo llega `oido` con `tipo`: `estado`, `nivel` (volumen), `parcial` (lo que
  va oyendo), `aprendida` y `descartada` (con `texto` y `media`, la seguridad media).

## Sueño

- `POST /api/dormir` con `{}` (duración de los ajustes) o `{"minutos": 5}`.
- `POST /api/despertar`
- `GET /api/diario`: sueños (`suenos`) e informes de cada noche (`informes`).

## Estado y mapa

- `GET /api/estado`: despierto o dormido, fase, presión de sueño, dopamina, sorpresa, contadores…
- `GET /api/mapa?maxAristas=6000`: todas las neuronas (`[id, tipo, x, y, etiqueta, tamaño]`,
  tipo 0 palabra, 1 concepto, 2 hipocampo, 3 inhibidora, 4 inicio, 5 fin) y las conexiones más
  fuertes (`[a, b, peso, clase]` en una lista plana; clase 0 secuencia, 1 asociación,
  2 concepto, 3 cadena del hipocampo, 4 célula→palabra).
  Con `&formato=bin` llega lo mismo en binario, mucho más ligero con cerebros grandes
  (el formato está explicado en `app/nucleo/formato-mapa.js`).
- `GET /api/mapa/posiciones`: solo dónde está cada neurona, en binario. `posiciones` en
  `/api/estado` cambia cada vez que se mueven, para saber cuándo volver a pedirlas.
- `GET /api/neuronas/{id}`: una neurona con sus conexiones y pesos.
- `POST /api/neuronas/{id}/estimular`: la activa y devuelve lo que le viene a la cabeza.
- `GET /api/buscar?palabra=perro`: la neurona de esa palabra, si la conoce.

## Eventos en directo

`GET /api/eventos?token=…` es un flujo [Server-Sent Events](https://developer.mozilla.org/es/docs/Web/API/Server-sent_events).
Eventos: `estado`, `chat`, `pensamiento` (disparos para animar), `neuronas` (nacimientos y
muertes), `sueno` (fase), `sueno_texto` (un sueño), `informe` (al despertar), `lectura`, `externo`.

```js
const fuente = new EventSource('http://127.0.0.1:7777/api/eventos?token=TU_TOKEN');
fuente.addEventListener('sueno_texto', (e) => console.log('Ha soñado:', JSON.parse(e.data).texto));
```

## Otras rutas

`GET /api/chat`, `GET|PUT /api/ajustes`, `POST /api/token` (genera uno nuevo),
`GET|POST /api/cerebros`, `POST /api/cerebros/usar|clonar|archivar`, `GET|POST /api/copias`,
`POST /api/copias/restaurar`, `POST /api/guardar`, `POST /api/salir`, `GET /api/ping`.

## Ejemplos

**PowerShell** (darle un archivo):

```powershell
$cuerpo = @{ texto = Get-Content -Raw -Encoding UTF8 "C:\ruta\libro.txt"; fuente = "libro.txt" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:7777/api/aprender" `
  -Headers @{ "X-Rubenchuelo-Token" = "TU_TOKEN" } `
  -ContentType "application/json; charset=utf-8" `
  -Body ([Text.Encoding]::UTF8.GetBytes($cuerpo))
```

**curl** (darle un archivo):

```
curl -X POST "http://127.0.0.1:7777/api/aprender?fuente=libro.txt" -H "X-Rubenchuelo-Token: TU_TOKEN" -H "Content-Type: text/plain; charset=utf-8" --data-binary @libro.txt
```

**Python** (sin instalar nada):

```python
import json, urllib.request

URL = "http://127.0.0.1:7777"
TOKEN = "TU_TOKEN"

def rubenchuelo(ruta, datos):
    peticion = urllib.request.Request(URL + ruta, data=json.dumps(datos).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Rubenchuelo-Token": TOKEN})
    with urllib.request.urlopen(peticion) as r:
        return json.load(r)

print(rubenchuelo("/api/mensaje", {"texto": "Hola, Rubenchuelo"})["texto"])
```

**JavaScript**:

```js
const r = await fetch('http://127.0.0.1:7777/api/mensaje', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Rubenchuelo-Token': 'TU_TOKEN' },
  body: JSON.stringify({ texto: 'Hola, Rubenchuelo' }),
});
console.log((await r.json()).texto);
```
