# Rubenchuelo

Un cerebro artificial muy pequeño que empieza sin saber nada y **aprende mientras le hablas**.
Lo que le enseñas no se guarda como texto: se convierte en neuronas nuevas y en el peso de sus
conexiones. Duerme, sueña, olvida lo que no usa y se lleva en un pendrive.

## Abrirlo

1. Haz doble clic en **`Rubenchuelo.exe`** (el de la neurona).
2. Sale un momento «Despertando…» y se abre Rubenchuelo en **su propia ventana**, como
   cualquier programa. Mientras está abierto tiene su icono junto al reloj (clic derecho:
   abrir otra ventana, abrir su carpeta o guardar y salir).
3. Para cerrarlo: **cierra la ventana** (con la X) o pulsa **Guardar y salir**. En los dos
   casos guarda todo lo que sabe antes de cerrarse.

No hace falta instalar nada ni tener internet. **`Iniciar.bat`** sigue funcionando como
antes (ventana negra y navegador normal). En Mac o Linux usa `iniciar.sh` (ahí sí
necesitas Node.js instalado).

## Instalarlo

Si prefieres tenerlo instalado como un programa más, haz doble clic en
**`Instalar Rubenchuelo.exe`**:

- Se instala solo para tu usuario (no pide permisos de administrador), en
  `AppData\Local\Programs\Rubenchuelo` salvo que elijas otra carpeta.
- Lo tendrás en el **menú Inicio**, en el **escritorio** (si lo marcas) y en
  **Configuración → Aplicaciones instaladas**, desde donde se desinstala.
- Puede **traerse los cerebros** de esta carpeta: los copia, así que los de aquí no se
  tocan. Desde ese momento son dos Rubenchuelos distintos: lo que aprenda uno no lo
  sabrá el otro.
- Para actualizarlo, vuelve a ejecutar el instalador: cambia el programa y conserva sus
  cerebros.
- Al desinstalarlo, sus cerebros se quedan en la carpeta salvo que marques borrarlos (y
  entonces van a la papelera).

Los .exe no están firmados: si los pasas a otro ordenador por internet (no con un
pendrive), Windows dirá «Windows protegió tu PC». Pulsa **Más información → Ejecutar de
todas formas**.

## Empezar de cero

Rubenchuelo viene **sin saber nada**: la primera vez que lo abres nace el cerebro
«principal» con solo dos neuronas (inicio y fin de frase).

Para volver a empezar de cero más adelante:

- **Sin perder el actual**: pestaña **Cerebros** → escribe un nombre → **Crear** → **Usar**.
  Puedes volver al anterior cuando quieras.
- **Borrándolo todo**: cierra Rubenchuelo y borra (o mueve a otro sitio) la carpeta `cerebros`.
  La próxima vez que lo abras nacerá un «principal» nuevo y vacío.

## Enseñarle

Háblale con frases cortas y sencillas, y luego pregúntale:

> Toby es mi perro. · Los perros son animales. · Toby es marrón y tiene cuatro patas. · ¿Qué es Toby?

Qué esperar: habla como un niño muy pequeño. Al principio balbucea y repite lo más llamativo
("Toby… perro…"). Cuando ya sabe cosas, contesta con frases que ha aprendido o mezcla de ellas.
Si le preguntas por algo que no conoce, pregunta él ("¿Mercurio?"). No razona: relaciona.

Debajo de cada mensaje tuyo verás cuántas neuronas han nacido y cuánta sorpresa le ha causado.
En cada respuesta suya tienes:

- **👍 / 👎**: dopamina. Refuerza o debilita exactamente las conexiones que usó para decir eso.
- **¿Por qué?**: qué oyó, qué le vino a la cabeza y el camino que siguió para construir la frase.
  Lo que usó se resalta en el mapa.

## El mapa de neuronas

Cada punto es una neurona. Las conectadas se van acercando solas.

| Forma y color | Neurona | Qué hace |
|---|---|---|
| ● turquesa | Palabra | Su oído y su boca. Nace al oír una palabra nueva. |
| ○ violeta | Concepto | Agrupa palabras que van juntas, como {toby, perro, mi}. |
| ■ ámbar | Hipocampo | Recuerdos rápidos del día: una cadena por frase. Se vacía al dormir. |
| ▼ coral | Inhibidora | Frena a su grupo para que no se encienda todo a la vez. |
| ◆ azul | Inicio / fin | Dónde empiezan y acaban las frases. |

- **En directo** ves brillar las neuronas que disparan y las señales viajando por las conexiones.
  Cuando nace una neurona aparece un anillo.
- **Rueda** para acercar, **arrastrar** para moverte, **doble clic** para ampliar, **Ver todo** para volver.
- **Clic en una neurona**: sus conexiones con los pesos, y el botón **Estimular** para ver qué le
  viene a la cabeza si la activas tú.
- La leyenda de la izquierda sirve también para ocultar o mostrar cada tipo.
- **Conexiones desde** oculta las conexiones más débiles.
- **Optimizado** (encendido) dibuja el mapa con la tarjeta gráfica: va fluido aunque
  tenga decenas de miles de neuronas y se ve igual. Si algún día ves algo raro, apágalo y
  volverá el dibujo clásico (que con muchas neuronas va a tirones).

## El sueño

Mientras duerme, toda la interfaz se pone en modo noche. Cada noche tiene varios ciclos:

- **Fase profunda**: repasa los recuerdos del hipocampo y los pasa a la corteza, mezclados con
  recuerdos antiguos para no olvidarlos. Los importantes (o premiados con 👍) se repasan más.
- **Fase REM**: sueña. Mezcla recuerdos al azar y une un poco lo que se enciende a la vez.
  Lo que dice en sueños aparece en la pestaña **Sueños** (el diario es solo para ti; él no lo lee).
- **Poda**: al final todas las conexiones bajan un poco y las muy débiles desaparecen.

Puedes dormirlo con el botón **Dormir**, con un **temporizador** (cada X horas despierto),
con un **horario** (por ejemplo de 03:00 a 03:30 ciertos días) o dejar que se duerma solo
**cuando se agote** (presión de sueño al 100 %). Todo eso está en **Ajustes**.
Si le hablas mientras duerme se despierta, pero la consolidación queda a medias y se queda
aturdido un minuto. El horario solo funciona si Rubenchuelo está abierto a esa hora.

## Habilidades

Tres capacidades extra que puedes apagar o encender en **Ajustes → Habilidades**. Ninguna
gasta mucha memoria del ordenador.

- **Memoria de trabajo**: recuerda de qué estabais hablando durante unos minutos. Si
  preguntas «¿Quién es Luna?» y luego «¿Qué come?», entiende que hablas de Luna. Lo que
  tiene en mente lleva un anillo discontinuo en el mapa y aparece escrito abajo. Si nombras
  a otra persona o cosa, cambia de tema. Al dormir se le va de la cabeza.
- **Deducir mientras duerme**: si sabe que «Toby es mi perro» y que «los perros son
  animales», al dormir deduce «Toby es un animal». Después, a «¿Toby es un animal?»
  contesta «Sí. Toby es un animal.». Las deducciones (y por qué las hizo) salen en la
  pestaña **Sueños**. Son suposiciones suyas: se aprenden más flojo que lo que le dices.
- **Agrupar palabras que se usan igual**: al dormir busca palabras que aparecen en frases
  parecidas y las junta en una categoría, como {toby ≈ luna} o {perro ≈ gata}. En el mapa
  son conceptos violeta con «≈» en el nombre, y hacen que una palabra le recuerde a las otras.

## Que te escuche

Pulsa el **micrófono** junto a la caja de texto y Rubenchuelo se pondrá a **escuchar todo lo que
se dice**:

- Pasa la voz a texto **en este ordenador, sin internet**, en la carpeta `oido`. Vosk oye al
  momento y marca dónde acaba cada frase (cuando haces una pausa). Luego **Whisper**, que entiende
  mucho mejor (nombres, acentos, ruido) y pone puntos y mayúsculas, vuelve a escuchar esa frase
  con la tarjeta gráfica (unas décimas de segundo) y eso es lo que aprende. Whisper necesita una
  tarjeta NVIDIA: en un ordenador sin ella, y mientras se carga al empezar, se usa solo Vosk.
- Con Whisper, lo que **no esté en español** se descarta.
- **No contesta**: aprende como cuando lee, más despacio que charlando y le va entrando sueño.
  Si le escribes en el chat mientras tanto, te responde normal.
- Si **no está seguro** de lo que ha oído (de media, en toda la frase), **tira la frase
  entera**. De las frases que sí aprende, quita las palabras sueltas dudosas. Con voz clara
  suele estar por encima de 0,9 de seguridad; con ruido o en otro idioma, por debajo de 0,75.
- Encima de la caja ves un punto rojo, el volumen, lo que va oyendo y lo último que ha hecho
  con ello (✓ aprendido o ✗ descartado). El texto no se guarda: solo lo que aprende.
- **Mientras duerme no escucha**: vuelve a escuchar solo al despertar.
- Oye todo lo que suene (también la tele o a otras personas). Para pararlo, vuelve a pulsar el
  micrófono.
- En **Ajustes → Escuchar** eliges Whisper o Vosk, el micrófono, la pausa que cierra una frase
  (1,2 s por defecto) y la seguridad mínima de cada frase (0,85) y de cada palabra (0,5).

Whisper casi no se equivoca; Vosk solo, bastante más. Lo que aprenda mal se irá olvidando si no
lo vuelve a oír. Whisper ocupa 1,7 GB (`oido\whisper`): si llevas Rubenchuelo en un pendrive
pequeño, puedes dejar esa carpeta fuera y escuchará con Vosk. El instalador no lo lleva dentro,
pero lo copia de esta carpeta si lo marcas.

## Darle textos grandes

- **Arrastra un `.txt`** a la ventana (o usa el botón del documento junto a la caja de texto).
- Desde **otra aplicación**: mira la pestaña **Conexiones** (tiene ejemplos listos para copiar)
  y `docs/API.md`.

Los textos se leen en modo lectura: aprende más despacio que charlando, solo las frases más
sorprendentes pasan al hipocampo y le da mucho sueño. **Lo leído se asienta durmiendo**:
pregúntale después de una noche.

**Repasos**: cada texto lo lee entero y lo vuelve a leer **5 veces** (se cambia en **Ajustes →
Lectura de textos → Veces que repasa cada texto**, sin tope). Cada vuelta refuerza todo lo leído,
no solo unas frases. Con un texto de prueba de 5.600 palabras, después de dormir acertaba 33 de 50
preguntas leyéndolo una vez y 49 de 50 repasándolo 5 veces. Mientras lee ves «repaso 2 de 5»; si
lo cancelas, lo leído hasta ahí se queda.

## Llevarlo en un pendrive

Todo está dentro de esta carpeta. Pulsa **Guardar y salir**, copia la carpeta entera al
pendrive y ábrelo en cualquier Windows con `Rubenchuelo.exe` (o `Iniciar.bat`).

```
Rubenchuelo/
  Rubenchuelo.exe        para abrirlo
  Iniciar.bat            para abrirlo a la antigua (ventana negra y navegador)
  Instalar Rubenchuelo.exe   para instalarlo (no hace falta llevarlo en el pendrive)
  runtime/node.exe       el motor (Node.js)
  oido/                  para escuchar: Oido.exe, Vosk y su modelo en español
  oido/whisper/          Whisper con su modelo (1,7 GB; sin esta carpeta escucha solo con Vosk)
  app/                   el programa
  cerebros/<nombre>/     LO QUE SABE: cerebro.json.gz, ajustes, diario y copias de seguridad
  ajustes.json           ajustes de la aplicación (puerto, token…)
  docs/                  diseño y API
  herramientas/          para volver a crear los .exe si cambia el programa
```

- Guarda solo cada minuto si ha aprendido algo, al dormir, al terminar de leer y al salir.
  Escribe primero un archivo temporal y lo cambia de golpe, así un apagón no lo corrompe; además
  conserva la versión anterior (`cerebro.anterior.json.gz`).
- Hace una **copia de seguridad** después de cada noche completa y cada pocas horas
  (pestaña **Cerebros** → Copias de seguridad → Restaurar).
- Puedes tener **varios cerebros** y clonarlos (pestaña **Cerebros**). Archivar no borra: mueve el
  cerebro a `cerebros/_papelera`.
- El chat no se guarda nunca: lo que ha aprendido está solo en sus neuronas.

## Si algo va mal

- **"Sin conexión con Rubenchuelo"**: se ha cerrado (o la ventana negra). Vuelve a abrir
  `Rubenchuelo.exe` o `Iniciar.bat`.
- **Doble clic dos veces**: no pasa nada, solo abre otra ventana del que ya estaba despierto.
- **El mapa va a tirones**: mira que el botón **Optimizado** esté encendido.
- **Rubenchuelo.exe se queja de que falta algo**: tiene que estar dentro de la carpeta de
  Rubenchuelo, junto a `app` y `runtime`. Para volver a crearlo (o el instalador) después de
  cambiar el programa: `herramientas\Crear exe e instalador.bat`.
- **Puerto ocupado**: prueba solo los siguientes puertos; la ventana negra dice cuál usa.
- **Comprobar que todo funciona** (desde esta carpeta, en una terminal):
  `runtime\node.exe --test "app/pruebas/*.test.js"`

## El código (GitHub)

El instalador está en **Releases**: trae todo menos Whisper, así que escucha con Vosk. El
repositorio solo guarda el código; para usarlo desde ahí faltan los programas de otros, que
pesan demasiado:

- `runtime/node.exe`: Node.js 24 para Windows de 64 bits (https://nodejs.org). Sin él,
  `Iniciar.bat` usa el Node.js instalado en el ordenador.
- `oido/motor/`: `libvosk.dll` y sus tres DLL, de la versión para Windows de 64 bits de Vosk
  (https://github.com/alphacep/vosk-api/releases).
- `oido/modelo/`: el modelo `vosk-model-small-es-0.42` descomprimido
  (https://alphacephei.com/vosk/models).
- `oido/whisper/` (opcional): en `programa/`, whisper.cpp para Windows con CUDA 12.4
  (`whisper-server.exe` y sus DLL), y en `modelos/`, `ggml-large-v3-turbo-q5_0.bin`
  (https://huggingface.co/ggerganov/whisper.cpp).

Los .exe se crean con `herramientas\Crear exe e instalador.bat`. Los cerebros y `ajustes.json`
nunca se suben.
