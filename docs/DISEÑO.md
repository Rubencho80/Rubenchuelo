# Rubenchuelo — documento de diseño

## Qué es y por qué

Rubenchuelo es un cerebro artificial muy pequeño que **empieza vacío y aprende
mientras le hablas**. Lo que aprende no se guarda como texto en ningún sitio:
se convierte en neuronas nuevas y en el peso de sus conexiones, imitando (de
forma muy simplificada) cómo lo hace un cerebro natural: hipocampo rápido,
corteza lenta y un sueño que pasa lo del día a la corteza.

Es un experimento para **ver aprender y crecer** a una red neuronal, no un
asistente que razone.

## Objetivos

- Aprender en tiempo real de cada mensaje, ajustando pesos y creando neuronas.
- Varios tipos de neurona (palabra, concepto, hipocampo, inhibidora, inicio/fin).
- Sueño con fases (profundo/NREM y REM), poda y consolidación. Se puede dormir a
  mano, con temporizador, con horario o cuando esté agotado.
- Mapa de neuronas explorable con sus conexiones y su actividad en directo.
- Entrada para textos gigantes desde otras aplicaciones (API local).
- Portable: todo, incluido el conocimiento, en una carpeta que cabe en un pendrive.

## No objetivos

- Hablar con fluidez o razonar. Responderá como un niño pequeño o un loro listo.
- Funcionar sin abrir la aplicación (el horario de sueño solo actúa si está abierta).

## Anti-objetivos (sería un fracaso aunque funcionara)

- Que guarde las conversaciones en un archivo y "haga trampa" leyéndolas.
- Que necesite instalar algo o tener internet.
- Que se corrompa el cerebro al quitar el pendrive.

## Restricciones

- Windows primero (Mac/Linux funcionan si tienen Node.js instalado).
- Sin librerías externas: solo Node.js y el navegador.
- La API solo escucha en el propio ordenador salvo que se active a mano.

## Arquitectura

```
Rubenchuelo/
  Rubenchuelo.exe      doble clic → arranca y lo abre en su propia ventana
  Iniciar.bat          lo mismo, con la ventana negra y el navegador normal
  Instalar Rubenchuelo.exe   instalador (lleva el programa dentro)
  herramientas/        para volver a crear los .exe (construir.js, código C#)
  runtime/node.exe     Node.js portable
  app/servidor.js      servidor local (interfaz + API + eventos en directo)
  app/nucleo/          el cerebro (neuronas, aprendizaje, sueño, lectura…)
  app/publico/         la interfaz (chat, mapa, paneles)
  cerebros/<nombre>/   el conocimiento: cerebro.json.gz, ajustes, diario, copias
  ajustes.json         ajustes de la aplicación (puerto, token, cerebro activo)
```

Un único proceso de Node hace de servidor en `127.0.0.1:7777`. La interfaz se
comunica con él por HTTP y recibe la actividad en directo por *Server-Sent
Events* (`/api/eventos`).

## El cerebro

### Neuronas

| Tipo | Papel | Nace cuando… |
|---|---|---|
| Palabra | oído y boca: representa una palabra | oye una palabra nueva |
| Concepto (corteza) | agrupa palabras que suelen ir juntas | algo le sorprende y no encaja con lo que conoce |
| Hipocampo (célula de tiempo) | cada frase deja una cadena rápida | oye una frase (capacidad limitada) |
| Inhibidora | frena a su grupo (unas 40 neuronas) | su grupo se llena |
| Inicio / fin | dónde empiezan y acaban las frases | siempre existen |

Las neuronas mueren si se quedan sin conexiones tras la poda, y las células del
hipocampo mueren cuando su recuerdo se consolida o cuando hace falta sitio.

### Conexiones (pesos)

- **Secuencia** palabra→palabra: qué suele venir después (aprendizaje tipo STDP).
- **Asociación** palabra↔palabra: aparecen a menos de 5 palabras en la misma frase
  (regla de Hebb; más fuerte cuanto más cerca).
- **Palabras parecidas**: las que suenan parecido (perro/perros) se conectan un poco al nacer.
- **Miembro** concepto↔palabra.
- **Cadena del hipocampo** y **célula→palabra**.

Todas se refuerzan con `w ← w + η·(1 − w)` y se debilitan multiplicando.

### Moduladores

- **Sorpresa (noradrenalina)**: palabras nuevas o frases que no encajan → aprende más fuerte.
- **Dopamina**: 👍/👎 en una respuesta refuerza o debilita exactamente las
  conexiones que usó (huella de elegibilidad) y marca esos recuerdos como más o
  menos importantes para el sueño.
- **Habituación**: las palabras muy oídas ("de", "el") pesan menos.
- **Presión de sueño (adenosina)**: sube con lo que aprende y con el tiempo
  despierto. Con mucho sueño aprende peor y dice más tonterías.
- **Aturdimiento**: si lo despiertas, durante un minuto responde peor (y bosteza).

### Pensar

La actividad se propaga por la red durante unos pasos: las neuronas integran lo
que les llega, disparan si superan un umbral, se fatigan si disparan seguido, y
las inhibidoras frenan a su grupo según la actividad que circula por él (las que
ganan siguen activas). Cada neurona reparte su salida entre sus conexiones
(recursos sinápticos limitados), así las palabras "comodín" conectadas a todo no
lo inundan. Los conceptos tienen un umbral más alto: solo se encienden si
reconocen buena parte de su patrón. El resultado es el "contexto": qué tiene en
la cabeza ahora mismo.

### Hablar

Construye frases hacia delante (hasta "fin") y hacia atrás (hasta "inicio")
siguiendo las conexiones de secuencia de la corteza y, si lo hay, el recuerdo del
hipocampo que se está reviviendo. En cada paso:

- el contexto decide entre las opciones (pesan más las palabras con contenido que
  las muy comunes como "el", "de");
- **anticipa**: una opción vale más si lleva a algo que tiene en la cabeza
  ("en la" → "montaña" gana a "en el" → "perro").

Prueba varias frases y dice la que más encaja según:

- **relevancia y novedad**: lo activas que están sus palabras y lo que aportan;
- **cobertura**: si habla de lo que se le ha preguntado;
- **fluidez**: lo natural que suena leída hacia delante;
- **coherencia** (Hebb): si sus palabras con contenido se han oído juntas alguna
  vez. Así descarta las "quimeras" que pegan trozos de recuerdos distintos.

Ante una pregunta empieza por aquello que se pregunta. Ante una afirmación
empieza por algo que ya sabía, no repite lo que oye y no mezcla lo que acaba de
aprender en ese mensaje con recuerdos viejos. Si no sabe nada, habla
"telegráficamente" ("Toby… perro…") o pregunta con curiosidad ("¿Mercurio?"),
como un bebé.

## El sueño

Un sueño tiene varios **ciclos** (4 por defecto). Cada ciclo tiene:

1. **Fase profunda (NREM)**: repasa los recuerdos del hipocampo (los importantes
   en más ciclos), intercalados con recuerdos antiguos de la corteza para no
   olvidarlos. Cada repaso refuerza la corteza y crea o afina conceptos.
2. **Fase REM**: enciende recuerdos al azar con ruido y poca inhibición. Lo que
   "dice" se guarda en el diario de sueños y lo que se enciende a la vez crea
   asociaciones nuevas débiles.

La fase profunda domina al principio de la noche y el REM al final, como en
las personas.

Al terminar: **poda** (todas las conexiones bajan un poco y las muy débiles
desaparecen), se vacía el hipocampo consolidado, la presión de sueño vuelve a
cero y se hace una copia de seguridad. Si se le despierta antes, la
consolidación queda a medias, no hay poda y se queda aturdido.

Disparadores: botón, temporizador (cada X horas despierto), horario (ventanas
diarias con días de la semana) y "dormir al agotarse" (presión ≥ 100 %).

## Habilidades (se pueden apagar en Ajustes)

### Memoria de trabajo

Tras cada mensaje guarda, solo en RAM, lo que se ha dicho: las palabras con
contenido del mensaje y, algo menos, las de su respuesta. Lo anterior se queda en
el 40 % con cada mensaje y a la mitad cada 3 minutos; caben unas 16 cosas. En el
mensaje siguiente esas neuronas arrancan ya algo encendidas (*priming*): no es un
empujón continuo, se apaga en pocos pasos salvo que lo nuevo lo refuerce. La
huella es fuerte (60 %) si la pregunta no nombra a nadie («¿Qué come?») y casi
nula (6 %) si sí («¿Quién es Luna?»). Para saber si una palabra nombra a alguien,
mira si suele empezar frases («Luna…», «El caballo…»). Ante una pregunta, también
prueba frases que empiecen por lo que tiene en mente. Al dormir se vacía.

Medido con 20 semillas: tras «¿Quién es Luna?», a «¿Qué come?» contesta
«pescado» 16 veces de 20 (sin memoria de trabajo, 8).

### Deducir mientras duerme

Después de repasar un recuerdo (o de recordar uno antiguo) mira si la frase acaba
en «… B» y si la corteza sabe «B es/son C», siguiendo sus conexiones de
secuencia (también con las palabras que suenan como B: perro/perros). Si es así,
construye «… C» y la aprende como un repaso flojo (60 % de la velocidad del
sueño), porque es una suposición suya. Ajusta el número («animales» → «animal»,
creando la palabra si no la conocía) y el artículo («un»/«una»). No deduce lo
que ya sabe bien. Como mucho 12 deducciones por noche.

Al preguntar algo de sí o no, si puede construir por sí mismo exactamente lo que
se le pregunta y el sujeto está conectado con lo que se dice de él, contesta
«Sí. …».

### Agrupar palabras que se usan igual

En la fase REM toma las palabras de los recuerdos del día (o algunas al azar).
Para cada una compara sus vecinos (qué va antes y qué va después, sin contar las
palabras comodín) con los de las palabras que comparten al menos dos vecinos. Si
se parecen lo bastante (coseno ≥ 0,5), crea o refuerza una neurona de categoría
(un concepto especial) con todas ellas. Las categorías no se usan para reconocer
frases, solo para que una palabra active a sus parecidas. Se podan como los demás
conceptos si dejan de reforzarse.

## Leer textos gigantes

Los textos que llegan por la API o arrastrando un `.txt` se leen en **modo
lectura**: se aprenden directamente en la corteza, más despacio; solo las frases
más sorprendentes pasan al hipocampo; la presión de sueño sube mucho. Si está
dormido, los textos esperan en una bandeja y se leen al despertar.

Cada texto se **repasa entero** `lectura.repasos` veces (5 por defecto, de 1 a
1.000.000; también `repasos` en `/api/aprender`). Cada vuelta vuelve a pasar todas
las frases por `leerFrase`, así que refuerza toda la corteza y no solo las frases
del hipocampo; las frases al hipocampo, los conceptos nuevos y su tope salen de
la primera vuelta (la sesión es la misma). Texto de prueba de 5.600 palabras,
5 cerebros, 50 preguntas «¿qué come / dónde vive?», después de dormir:

| repasos | 1 | 3 | 5 | 10 | 20 |
|---|---|---|---|---|---|
| aciertos | 33 | 49 | 49 | 50 | 49 |

Antes de dormir apenas cambia (10-17 de 50): contesta con lo más repetido del
texto («queso», «la granja»); la diferencia aparece al consolidar.

**Pensar en cerebros grandes** (`_salidas`): al leer libros enteros, una palabra
acaba asociada con cientos o miles (Gandalf, con 1.798), y casi todas sus
conexiones más fuertes son con «el», «de», «y»… a 0,97. Repartir la actividad
entre todas dejaba a cada una tan poco que no se encendía nada y la idea moría.
Ahora, si tiene más de 16, empuja solo a las 16 con más peso al cubo, dividido
por lo conectada que está cada una (√(1 + conexiones/200)); los conceptos siguen
como antes (con el tope se perdía el de la frase que acaba de oír). Por debajo de
16 no cambia nada. Con el texto de prueba, después de dormir: 1 repaso 33 → 48
de 50; 5 repasos 49 → 50; 10 repasos 50. Probado y descartado: que los repasos no
cuenten como oír la palabra otra vez (bajaba a 36-41) y medir la fluidez solo
contra las continuaciones más fuertes (frases tipo ensalada).

Con el cerebro de la trilogía (36.000 neuronas, 10 repasos) la charla casi no
cambia (38 de 60 respuestas con frase frente a 37): ha aprendido el idioma de la
novela, no a conversar. «Hola» sale sobre todo en las canciones de Tom Bombadil
(«¡Hola! ¡Dol!»), las afirmaciones no las repite como un loro y solo contesta si
sabe algo muy relacionado, y a las preguntas responde con lo que se le ha dicho
en la charla, que es lo más claro que tiene.

## Escuchar (oído)

Botón del micrófono en el chat; ajustes en `ajustes.json` → `oido` (micrófono, pausa, seguridad
mínima de frase y de palabra). Todo es local, sin internet:

- `oido/Oido.exe` (`herramientas/exe/Oido.cs`, C# de consola, 64 bits): graba el micrófono con
  `winmm` (16 kHz, 16 bits, mono) y se lo pasa a Vosk (`oido/motor/libvosk.dll`, 0.3.45, copiado
  del paquete de Python; Apache 2.0) con el modelo `vosk-model-small-es-0.42` (`oido/modelo`).
  Escribe una línea JSON por mensaje: `listo`, `nivel`, `parcial` y `frase` (con la seguridad de
  cada palabra). Una frase se cierra cuando lleva callado la pausa elegida (medida en tiempo de
  sonido, así también vale para grabaciones: `--archivo voz.wav`). Se cierra solo si el servidor
  le cierra la entrada estándar.
- `app/nucleo/oido.js` lo arranca y lo para, y `filtrarFrase` decide: si la **seguridad media de
  la frase entera** es menor que `confianzaFrase` (0,85), se tira entera; si no, se quitan solo
  las palabras sueltas por debajo de `confianzaPalabra` (0,5). Calibrado con voz sintética: el
  español claro da una media de 0,94 a 1,00, y el inglés oído con el modelo español, 0,73 a 0,74.
- `aplicacion.js` aprende lo aceptado con `leerFrase` (como la lectura: más despacio, sin
  contestar, con su sueño y sus frases sorprendentes al hipocampo). Al dormirse apaga el oído
  y lo vuelve a encender al despertar. Al cambiar de cerebro deja de escuchar.
- Ocupa unos 110 MB (motor y modelo); el instalador pasa de 34 a 86 MB.

### Whisper (`oido/whisper`, 1,7 GB)

Vosk sigue marcando dónde acaba cada frase y enseñando lo que oye al momento, pero
la versión que se aprende es la de Whisper:

- `programa/`: whisper.cpp b5454 para CUDA 12.4 (trae cuBLAS y cudart; la versión para
  CUDA 11.8 no trae cuBLAS y en este ordenador solo funcionaba con el procesador, a 15 s por
  frase). `modelos/ggml-large-v3-turbo-q5_0.bin` (547 MB; sha256 3942…a7e2, igual que en
  Hugging Face).
- Con `--audio CARPETA`, `Oido.exe` guarda el sonido de cada frase (con 1,5 s de antes:
  Vosk tarda en notar que alguien habla y con 0,5 s se comía la primera palabra) y lo
  dice en la frase. `oido.js` (`Whisper`) arranca `whisper-server.exe` en 127.0.0.1:8179
  (o el siguiente puerto libre) al empezar a escuchar, y le pasa cada frase (`/inference`,
  `verbose_json`). `palabrasDeWhisper` junta los trozos de palabra y su seguridad, quita
  lo que según Whisper no era voz (`no_speech_prob` > 0,6), y luego actúa el mismo filtro.
- Whisper detecta el idioma: lo que no sea español se descarta (con el idioma forzado a
  español, transcribía el inglés en inglés y muy seguro, y el filtro no lo paraba).
- Si no hay tarjeta NVIDIA (el servidor no carga CUDA), se para y queda Vosk. Al dejar de
  escuchar, o al dormirse, se cierra para liberar la memoria de la tarjeta (~1 GB).
- Medido con la grabación de prueba: 0,2 s por frase en la RTX 4060 (14 s con el
  procesador), seguridad media 0,99–1. Inglés: descartado por idioma; una frase rara que
  creyó española, por seguridad (0,53).
- No va dentro del instalador (construir.js lo deja fuera): el instalador lo copia de la
  carpeta portátil si se marca, y al actualizar lo aparta y lo vuelve a poner.

## Mapa

Plano con regiones (corteza, hipocampo, inicio, fin). Cada neurona es un punto
de color según su tipo; las conectadas se acercan solas (disposición por
fuerzas que se calcula poco a poco en el servidor). Se ven en directo los
disparos, las señales viajando por las conexiones, los nacimientos y, durante el
sueño, las oleadas de repaso. Clic en una neurona → sus conexiones y pesos, y
botón para estimularla. "¿Por qué?" en una respuesta resalta el camino que
siguió.

### Colocación (`nucleo/disposicion.js`)

Cada segundo se mueven unas 2.000 neuronas (5.000 durmiendo), con un tope de
~12 ms. Fuerzas:

- **Separarse** de las vecinas demasiado cercanas. En zonas muy llenas mira una
  muestra al azar de 48 entre las 9 casillas de alrededor y la cuenta como si
  fueran todas. (Antes miraba solo las 120 primeras, siempre empezando por la
  izquierda, y eso empujaba todo el mapa hacia la derecha: con «Señor de los
  Anillos» el 91 % de las palabras acabó en la mitad derecha.)
- **Acercarse** al punto medio de sus 24 asociaciones que más tiran, que son las
  más fuertes pero contando menos las palabras que van con todo («de», «que»…).
  Si cuentan igual, esas pocas arrastran a todo el mapa hacia donde estén.
- **Presión**: una rejilla gruesa (casillas de 80) empuja de las zonas abarrotadas
  hacia los huecos, para que las palabras ocupen la corteza.
- Los conceptos se van al medio de sus palabras y las inhibidoras al medio de su
  grupo; por eso se ven en el centro.
- **Reparto rápido** (`repartir`): si la décima parte más llena de la corteza
  tiene casi la mitad de las palabras (al abrir el cerebro o cada 10 minutos),
  las recoloca de golpe por toda la elipse sin desordenarlas. La que estaba más a
  la izquierda sigue más a la izquierda, y lo mismo de arriba abajo, así que lo
  que estaba junto sigue junto.

Con «Señor de los Anillos», en una hora simulada: el reparto tarda 40 ms, se queda
entre el 47 % y el 57 % a la izquierda, y cada palabra queda a 312 de su asociación
más fuerte frente a 499 de una palabra al azar. La posición es solo para verlo: no
cambia nada de lo que sabe.

### Que vaya fluido con muchas neuronas

Con «Señor de los Anillos» (33.000 neuronas, 28.000 conexiones en el mapa) el
dibujo clásico tardaba ~500 ms por cuadro: el navegador traza cada círculo y cada
línea con el lienzo 2D. Lo que se hizo:

- **Pintores** (`publico/js/`): `mapa.js` guarda el estado (neuronas, cámara,
  disparos, ratón) y un pintor lo dibuja. `pintor-gl.js` (botón **Optimizado**,
  encendido por defecto) usa WebGL 2: cada neurona ocupa una celda en dos
  texturas (de dónde viene y adónde va; tipo, tamaño, nacimiento y muerte) y se
  dibuja todo con instancias, las formas por distancia al borde (bordes suaves sin
  antialiasing). En cada cuadro solo se manda lo que cambia sin parar (lo que
  brilla y las señales). Fondo y regiones van en un lienzo 2D debajo (solo se
  redibuja al mover la cámara); anillos y etiquetas en otro encima. Las etiquetas
  siguen las mismas reglas que antes, pero sin ordenar todas las neuronas en cada
  cuadro (`porTamano` viene ordenado). `pintor-lienzo.js` es el dibujo de antes,
  para cuando el optimizado está apagado, el navegador no tiene WebGL 2 o la
  tarjeta falla (entonces cambia solo).
- **Movimiento**: un solo «avance» para todas (cada neurona va de `o` a `t`); la
  tarjeta interpola, así que deslizarse no cuesta nada al procesador.
- **Datos** (`nucleo/formato-mapa.js` y `publico/js/formato-mapa.js`): el mapa va
  en binario (`/api/mapa?formato=bin`, ~1,2 MB en vez de 1,8 MB de JSON y sin
  interpretar nada); se calcula con un generador que cede cada ~8 ms
  (`mapaAsincrono`), así que el cerebro sigue contestando mientras tanto; los
  nombres de los conceptos se reutilizan 30 s y las conexiones flojas ni se
  guardan (suelo sacado del corte anterior). Entre mapas completos solo se piden
  las posiciones (`/api/mapa/posiciones`, ~400 KB) cuando cambia la época de la
  disposición (`posiciones` en `/api/estado`).
- **Resultado** (misma máquina, 33.000 neuronas, todo el mapa a la vista):
  ~120 cuadros por segundo (el máximo de la pantalla) frente a 2, menos de 1 ms
  de JavaScript por cuadro, también con actividad, selección y de noche. Mientras
  prepara el mapa, el servidor responde en menos de 40 ms (antes se paraba ~150 ms).
- Se ve igual que el clásico; lo único distinto es que las conexiones largas que
  cruzan la pantalla se dibujan aunque sus dos extremos queden fuera.

## API

Documentada en `docs/API.md`. Todas las rutas piden el token que aparece en la
pestaña "Conexiones". Por defecto solo responde desde el mismo ordenador.

## Guardado y portabilidad

- Autoguardado cada minuto si hay cambios, al dormir, al terminar de leer y al salir
  (también al cerrar la ventana negra).
- Escritura segura: archivo temporal → `fsync` → renombrar, conservando la versión anterior.
- Copias de seguridad automáticas tras cada sueño y cada pocas horas.
- Varios cerebros; clonar uno es copiar su carpeta.
- El chat no se guarda: solo existe mientras la aplicación está abierta.

## Programa de Windows (Rubenchuelo.exe e instalador)

Se compilan con el `csc.exe` (C# 5, .NET Framework 4) que ya trae Windows, sin
instalar nada: `herramientas\Crear exe e instalador.bat` (o
`runtime\node.exe herramientas\construir.js`). **Hay que volver a ejecutarlo
después de cambiar el programa**, para que el instalador lleve la versión nueva.

- `Rubenchuelo.exe` (`herramientas/exe/Lanzador.cs`): arranca `node app\servidor.js
  --sin-navegador` sin ventana negra (con una ventanita mientras despierta), espera
  a que `en-uso.lock` tenga su `pid` y responda `/api/ping`, y lo abre en Edge (o
  Chrome) en modo aplicación con un perfil propio en
  `%LOCALAPPDATA%\Rubenchuelo\ventana-<huella de la carpeta>`. Así es una ventana
  sin barras, con el icono de Rubenchuelo, y se sabe cuándo la cierras: entonces
  pide `/api/salir` (guarda y se cierra). Icono junto al reloj: abrir otra
  ventana, abrir su carpeta, guardar y salir. Si ya estaba abierto (otro doble
  clic, o Iniciar.bat), solo abre otra ventana. Si se cierra el cerebro (botón
  «Guardar y salir»), cierra sus ventanas. Si no hay Edge ni Chrome, usa el
  navegador normal.
- `Instalar Rubenchuelo.exe` (`Instalador.cs`) lleva dentro `carga.rbpk`
  (`app`, `runtime`, `docs`, `LEEME.md`, `Iniciar.bat`, `iniciar.sh` y
  `Rubenchuelo.exe`, comprimidos: 88 MB → 34 MB). Instala para el usuario
  (`%LOCALAPPDATA%\Programs\Rubenchuelo` por defecto, sin administrador), crea los
  accesos del menú Inicio y del escritorio y la entrada en «Aplicaciones
  instaladas» (`HKCU\…\Uninstall\Rubenchuelo`). Puede **copiar** los cerebros de
  un Rubenchuelo portátil (junto al instalador o en `Escritorio\Rubenchuelo`).
  Encima de una instalación anterior solo cambia el programa; nunca toca
  `cerebros` ni `ajustes.json`. Se niega a instalar en una carpeta con otras
  cosas o con Rubenchuelo abierto (en la ventana ofrece cerrarlo).
- `Rubenchuelo.exe --desinstalar` solo funciona en la copia instalada (la
  portátil se borra a mano). Quita programa, accesos, registro y el perfil de la
  ventana; los cerebros se quedan salvo que marques borrarlos (y entonces van a la
  papelera).
- Para probar sin tocar el sistema: `"Instalar Rubenchuelo.exe" /silencioso
  /destino:… /accesos:… /clave:Software\Prueba /cerebros:no /log:…` y
  `Rubenchuelo.exe --desinstalar --silencioso --clave Software\Prueba`.
- No están firmados: si alguien se los descarga de internet, Windows avisará
  («Windows protegió tu PC» → Más información → Ejecutar de todas formas).

## Decisiones tomadas por mí (revisables)

- JavaScript con Node.js, sin dependencias; `node.exe` copiado del Node instalado.
- Puerto 7777 (si está ocupado prueba los siguientes).
- Las preguntas no enseñan el orden de las palabras (para que no conteste con
  preguntas) ni crean recuerdos en el hipocampo.
- Duración de sueño por defecto: 2 minutos, para poder verlo.
- Token obligatorio en la API para que ninguna web pueda meterle textos sin permiso,
  y comprobación del `Host` para evitar ataques de "DNS rebinding".

## Cómo se ha comprobado

- `runtime\node.exe --test "app/pruebas/*.test.js"`: 31 pruebas (aprendizaje,
  preguntas, curiosidad, dopamina, sueño completo e interrumpido, poda, olvido del
  hipocampo, guardado, lectura, horario, ajustes, las tres habilidades encendidas
  y apagadas, el filtro de frases oídas, la lectura de lo que dice Whisper, los repasos de los textos y la API de punta a punta).
- Oído, con una grabación de voz sintética en español (tres frases con pausas):
  las transcribe bien y las separa; por la API aprende las tres, y a «¿Qué come
  Luna?» contesta «Luna es mi gata y come pescado.». Con el micrófono de verdad abre,
  escucha y, al apagarlo, Oido.exe se cierra.
- Habilidades, con 20 semillas: deduce «Toby es un animal» y luego lo contesta en
  20 de 20; forma las categorías {toby ≈ luna}, {perro ≈ gata} y
  {pienso ≈ pescado} en 20 de 20.
- Con 30 semillas aleatorias, tras enseñarle seis frases sobre Toby y Luna,
  contesta bien a "¿Quién es Luna?", "¿Qué come Toby?", "¿Dónde vive Luna?"…
  en 30 de 30 casos antes y después de dormir.
- Tras leer un texto de 5.600 palabras sobre animales acierta "qué come" y
  "dónde vive" bastante más después de dormir que antes (35/50 frente a 17/50;
  39/50 con la memoria de trabajo apagada, porque al preguntar seguido por
  animales distintos el anterior se queda un poco en mente): lo leído se asienta
  durmiendo, como se buscaba.
- Un libro sintético de 200.000 palabras (vocabulario de 15.000) se lee en ~1 s y
  deja 16.800 neuronas y 470.000 conexiones (65 MB de memoria, 2,5 MB en disco;
  guardar 0,4 s, cargar 0,2 s). Contestar tarda ~60 ms, la disposición del mapa
  se limita a ~12 ms por segundo y el navegador dibuja el mapa en ~30 ms.
- Mapa con 33.000 neuronas: ~120 cuadros por segundo con el optimizado, 2 con el
  clásico (medido en el navegador, moviendo, acercando, con actividad y de noche).
- Rubenchuelo.exe y el instalador, probados en carpetas de prueba: arrancar sin
  ventana negra, abrir dos veces, cerrar la ventana (guarda y se cierra en ~1,5 s),
  «Guardar y salir» (cierra todas sus ventanas), instalar, actualizar
  conservando cerebros, negarse con Rubenchuelo abierto o en una carpeta ajena,
  y desinstalar dejando los cerebros.
