# Sin Popunder

Extensión MV3 para Chrome/Brave que neutraliza los popunder de los sitios de
streaming **sin bloquear la publicidad**, para no gatillar los avisos de
"desactiva tu adblock".

> **La idea central:** bloquear `window.open` devolviendo `null` no funciona.
> El popunder comprueba `!ventana.closed` y, si le devuelves `null`, sabe que
> está siendo bloqueado y reintenta por otra vía. Lo que sí funciona es
> **devolverle una ventana falsa** que se comporta como una real: el script
> cree que ganó y no vuelve a intentarlo.

| | |
|---|---|
| Manifiesto | MV3, dos capas independientes (`MAIN` + `ISOLATED`) |
| Red | ninguna. Todo el estado vive en `storage.local` |
| Pruebas | **37/37**, en dos bancos que corren en el navegador sin instalar nada |
| Extra | detecta el fin del episodio y ofrece pasar al siguiente |

## Instalar

1. Clona el repositorio.
2. Abre `chrome://extensions` (o `brave://extensions`).
3. Activa **Modo de desarrollador**, arriba a la derecha.
4. **Cargar descomprimida** → elige la carpeta del repositorio.
5. Ancla el ícono a la barra si quieres ver el contador de bloqueos.

No hay que reiniciar el navegador. Si editas el código, vuelve a la página de
extensiones y pulsa recargar en la tarjeta.

## Probar sin instalar

```bash
xdg-open test/banco-siguiente.html   # 37 comprobaciones
xdg-open test/banco.html
```

Ambos bancos se autoejecutan y pintan PASA/FALLA. Llevan **un control que debe
fallar**: si ese control sale verde, el banco está roto y no prueba nada.

## Cómo funciona

Dos capas independientes, para que si una falla la otra tape el hueco.

**Capa A — `src/blocker.js`**, corre en el mundo `MAIN` antes que cualquier
script del sitio. En vez de impedir la apertura, le devuelve a `window.open()`
una **ventana falsa**: un objeto que se comporta como una ventana real
(`focus()`, `close()`, `document.write()`, `location.href`, y cualquier
propiedad inesperada devuelve una función inerte en lugar de reventar). El
código del sitio sigue su camino creyendo que abrió la pestaña, así que no hay
error en consola ni señal que delate un bloqueo. También:

- `a.click()` y eventos de ratón sintéticos sobre `<a target="_blank">` externos
- `form.submit()` con `target="_blank"`
- el **enlace-trampa transparente encima del reproductor**: se anula y el clic
  se reenvía a lo que hay debajo, que es el play de verdad. Esto es lo que
  elimina los 3-4 clics por episodio.

`window.open.toString()` sigue devolviendo `function open() { [native code] }`,
que es lo que revisan algunos detectores.

**Capa B — `src/background.js`**. Si algo se escapa y logra abrir pestaña, se
detecta por `openerTabId` y se cierra sola, dejando constancia en el historial.
El foco solo se devuelve si la emergente lo robó de verdad, y se devuelve a
donde estuvieras tú — ver *Cuándo te devuelve el foco*.

Un `ctrl+clic`, `cmd+clic` o clic con el botón central abre pestañas
normalmente: hay una ventana de gracia de 3 s para respetar tu intención.

## Siguiente episodio

Cuando falta **1:10** para el final (ajustable), aparece abajo a la derecha
una tarjeta al estilo Netflix: **A continuación · Episodio N**, con un botón
para saltar y una ✕ para cerrarla. `Esc` también la cierra. Se retira sola a los
**20 segundos**: la idea es verla con margen antes del final y que no se quede
tapando el ending si decides no saltar. Con 0 segundos no se va nunca.

Lo interesante es *por qué esto solo puede hacerlo una extensión*: el `<video>`
no está en la página principal, está dentro de un iframe de un reproductor externo, que son
otros dominios. La página de arriba tiene prohibido leer `video.currentTime`.
Los content scripts de esta extensión entran en **todos** los marcos, así que sí
pueden. De ahí el reparto:

| dónde | qué hace |
|---|---|
| marco del reproductor | mira el reloj del vídeo y pinta la tarjeta |
| marco de arriba | sabe cuál es el episodio siguiente |
| `background.js` | lleva y trae los mensajes, y navega la pestaña |

La tarjeta se cuelga del **mismo documento donde vive el vídeo**, no de la
página de arriba. Es a propósito: en pantalla completa el elemento a pantalla
completa es el iframe, y todo lo que dibuje la página de arriba queda detrás,
invisible. Va en un shadow DOM cerrado, así que el CSS del sitio no puede
descolocarla ni sus scripts leerla.

**Cómo averigua cuál es el siguiente.** Primero calcula a mano la dirección que
debería tener (el último número de la ruta, +1) y *después* mira si esa
dirección está enlazada en la página. Nunca al revés, y nunca por el texto del
enlace: el sitio de referencia tiene un botón que dice «Siguiente» que **no** es el episodio
siguiente, es la paginación de la lista de episodios. Fiarse del texto te manda
al sitio equivocado. Hay una prueba dedicada a esa trampa.

Si el episodio actual es el último que la página conoce, no ofrece nada. Si la
dirección no está confirmada en la lista, la tarjeta lo dice.

**Cómo encuentra el vídeo.** La primera versión solo escuchaba el evento
`timeupdate` en fase de captura sobre `document`. Sobre el papel basta; en
el sitio no saltó, y desde fuera no había manera de saber cuál de los eslabones
falló. Ahora hace las dos cosas a la vez: escucha el evento **y** mira el reloj
cada dos segundos, buscando el `<video>` también dentro de los shadow DOM
abiertos, que es donde algunos reproductores lo esconden. El paseo por todos los
nodos solo ocurre si no apareció ninguno por las buenas.

Por el mismo motivo ya no le pregunta a `bridge.js` si el sitio está en la
lista: repite esas doce líneas por su cuenta. La independencia vale más que
ahorrarlas — un eslabón menos que pueda romperse en silencio.

Solo se dispara con vídeos de más de 4 minutos, para no saltar en los anuncios
de vídeo ni en los avances. Y el salto lo hace el fondo, comprobando que el
destino sea el mismo dominio y esté en la lista vigilada: el mensaje viene de un
iframe de un tercero, así que se trata como no fiable.

### Elegir solo el reproductor de siempre

Al llegar al episodio nuevo hay que **volver a elegir servidor** (Streamwish,
Desu, Okru, Magi…), y ese clic ocurre *antes* de que exista el vídeo, así que no
sirve como gesto para la pantalla completa. Por eso la extensión aprende cuál
usas — cuenta cada vez que pulsas uno — y en el episodio siguiente lo pulsa
sola. Si ese no está disponible, va al **segundo más usado**, y así.

Con el reproductor ya cargado, el siguiente clic que das es el del *play*,
dentro del reproductor. Ese sí es un gesto de verdad, y ese sí devuelve la
pantalla completa.

Tres cautelas, porque pulsar cosas solo en una página llena de anuncios es
delicado:

- La lista de nombres reconocidos es **cerrada**. Reconocer «cualquier cosa que
  parezca una pestaña» acabaría pulsando un anuncio.
- Solo se miran **hojas del árbol**, nunca contenedores: si no, una fila entera
  podría «llamarse» como un servidor por lo que contiene dentro. Un párrafo que
  mencione «Streamwish» tampoco cuenta — hay un límite de 20 caracteres.
- Solo cuenta **clics tuyos** (`isTrusted`). Contar los nuestros convertiría la
  preferencia en una profecía que se cumple sola.

Si el que prefieres ya está puesto, no lo vuelve a pulsar. Y si nunca has
elegido ninguno, no toca nada.

### La pantalla completa al cambiar de episodio

Al saltar, la pantalla completa se pierde y **no se puede devolver sola**:
`requestFullscreen()` exige un gesto tuyo reciente, y una página recién cargada
no tiene ninguno. Es una regla de seguridad del navegador, no un descuido — no
hay forma de rodearla desde una extensión.

Lo que sí se puede es dejar el regreso a un clic. Si saltabas **estando** en
pantalla completa, al llegar al episodio nuevo aparece una segunda tarjeta:

```
VENÍAS EN PANTALLA COMPLETA
Un clic y vuelve        [ Pantalla completa ]  ×
```

Y además queda armado el primer clic, o una de las teclas del play, que des
**dentro del reproductor**
— el que ibas a dar igualmente para darle al play. Cualquiera de los dos la
devuelve. Si no tocas nada en 45 segundos, la tarjeta se quita de en medio. La
oferta caduca a los dos minutos, para que no reaparezca en otra cosa.

### El gesto que encerraba la pestaña

La primera versión de esa "trampa amable" escuchaba `keydown` **sin ningún
filtro**. El problema es que `Alt+Tab` y `Ctrl+Tab` también son `keydown`: tu
propio intento de cambiar de ventana era lo que disparaba la pantalla completa y
te metía de vuelta dentro. Cuanto más insistías, más te encerraba, y como la
oferta dura 45 segundos parecía que la extensión te tenía secuestrado.

Ahora un gesto solo cuenta si es:

- un clic con el botón principal, o
- una tecla de las que de verdad le dan al play (espacio, intro, `k`, `f`),
  siempre que **no** lleve `Alt`, `Ctrl` ni `Cmd` y no estés escribiendo en un
  campo de texto.

Cualquier combinación con modificador es del navegador, no del reproductor.
Además, si te vas de la pestaña la oferta se retira: volver más tarde no debería
meterte en pantalla completa por sorpresa.

### Tres cosas que lo hacían fallar

**1. Se rendía al primer intento.** Marcaba «ya está» *antes* de saber si había
episodio siguiente. Si esa consulta fallaba, quedaba marcado para el resto del
episodio y no lo volvía a intentar nunca. Ahora solo se da por servido cuando la
tarjeta llega a salir de verdad; si falla, reintenta cada 5 segundos.

**2. La duración mentía al principio.** Los reproductores por trozos (HLS, que
usan casi todos) anuncian una duración provisional mientras cargan y la corrigen
después. Ahora se exige que lleve 4 segundos sin moverse antes de hacerle caso.

**3. Recargar la extensión dejaba huérfanas las pestañas abiertas.** Este era el
gordo, y explica el «tuve que reiniciar la página». Al recargar la extensión,
los content scripts que ya estaban corriendo siguen ahí, pero su
`chrome.runtime.id` pasa a ser `undefined` y cualquier mensaje que manden lanza
*Extension context invalidated*. Desde fuera parece que la extensión no hace
nada. Ahora `background.js` se **reinyecta solo** en las pestañas abiertas al
instalarse o actualizarse (permiso `scripting`), y cada archivo lleva su guarda
para no duplicarse. La de `blocker.js` es la importante: sin ella, una segunda
pasada guardaría como «nativa» la función que ya parcheó la primera, dejando dos
capas envueltas una dentro de otra. La marca se define con `defineProperty` para
que quede **no enumerable** — una marca visible en `Object.keys(window)` sería
justo la señal que buscan los detectores de bloqueadores.

**Diagnóstico.** Si no aparece la tarjeta, enciende *Diagnóstico* en el ícono.
La extensión anota en el historial qué está viendo, con capa **C**: si el marco
está activo o ignorado, si encontró el vídeo y cuánto dura, cuándo cruzó el
umbral, si el marco de arriba contestó, y por qué rechazó un salto. No suma al
contador de emergentes, que mide otra cosa. Con esas líneas se sabe en qué
eslabón se rompe sin abrir las herramientas del navegador.

**Avanzar solo** viene apagado. Si lo enciendes, la tarjeta cuenta atrás y salta
sola; mover el ratón encima o pulsar una tecla frena la cuenta, por si estabas
viendo los créditos a propósito.

## Cuándo te devuelve el foco

Las redes de anuncios de estos sitios escuchan `blur` y `visibilitychange`: te
disparan la emergente **justo cuando te vas de la pestaña**. Si además se te
devuelve el foco al anime a ciegas, quedas atrapado y no puedes salir a mirar
otra cosa. Por eso el foco se rige por tres reglas:

1. **Si la emergente abrió al fondo, no se toca nada.** No robó nada, no hay
   nada que devolver.
2. **Si robó el foco, se te devuelve a donde estabas tú**, no al anime. La
   extensión recuerda a qué pestaña te cambiaste por tu cuenta y vuelve a esa.
3. **Mientras el episodio no esté sonando, no se toca el foco en absoluto.**
   Antes de darle al play eres libre de navegar. Esto se puede apagar con
   *Devolver el foco solo si el episodio está sonando*.

El estado de reproducción lo informa cada marco de la pestaña escuchando `play`
y `pause` en fase de captura (los eventos de `<video>` no burbujean), con un
latido cada 5 s. Si pasan 20 s sin latido, se da por parado. El panel de la
extensión muestra en vivo si esa pestaña cuenta como *viendo anime* o
*sin reproducir*.

## Páginas del navegador: intocables

`brave://extensions`, `chrome://…`, `about:algo`, `file://` y las páginas de
otras extensiones **nunca** se cierran ni se rescatan. Parece obvio, pero la
Capa B cerraba cualquier pestaña abierta desde un sitio vigilado, y
`brave://extensions/` se parsea con hostname `extensions` — distinto de
el dominio del propio sitio, así que entraba de lleno en la regla y se cerraba sola. El
resultado era que no se podía llegar a la página de extensiones para apagar la
extensión. Hay pruebas dedicadas a las cuatro familias de direcciones, más un
control que comprueba que un anuncio http de verdad sí se sigue cerrando.

`about:blank` y la cadena vacía sí siguen en juego: así es como empieza un
popunder antes de redirigir.

## El historial de diagnóstico

Con *Anotar en el historial cada vez que toco una pestaña* (activado), cada
decisión sobre el foco deja una línea marcada **D** en el historial del ícono,
con el motivo completo: si la emergente abrió delante o al fondo, si el vídeo
estaba sonando o parado, y si se devolvió el foco y a qué pestaña. No cuenta en
el contador. Sirve para no tener que adivinar por qué la extensión hizo algo.

## Modos

- **Silencioso** (por defecto): no se abre nada, cero parpadeo.
- **Apoyo al sitio**: la emergente sí se abre, al fondo y sin robarte el foco,
  carga los segundos que elijas (4 por defecto) y se cierra sola. Es la idea que
  pediste: la página cobra su impresión, tú no cierras nada. Cuesta un parpadeo
  breve en la barra de pestañas.

## Alcance

Solo actúa en los sitios de la lista, nunca en el resto de la web — así jamás
rompe un popup legítimo de banco o de "iniciar sesión con Google". Vienen
cargados los dominios de la lista de `src/background.js` (jkanime, animeflv,
tioanime, monoschinos, animelatinohd, animeonline) y
hentaila; se añaden más desde el ícono con **Añadir el sitio de esta pestaña**.

Los iframes del reproductor viven en otros dominios (streamwish, filemoon, etc.).
Se activan igual porque la extensión mira quién es la página de arriba vía
`location.ancestorOrigins`, no el dominio del iframe. No hace falta añadirlos.

## El caso de referencia

Diagnosticado sobre la página real. Carga dos redes de anuncios además de sus
propios scripts: `cvt-s2.agl003.com` y `ca.luteousoecus.com`. Las técnicas son:

1. **Popunder con verificación.** Abre `window.open("about:blank","_blank")` y
   antes de seguir comprueba `o && !o.closed && typeof o.closed !== "undefined"`.
   Un bloqueador que devuelva `null` **falla esa comprobación y queda a la
   vista** del sitio. La ventana falsa de esta extensión pasa las tres
   condiciones, así que el script continúa como si nada. Luego hace
   `o.location.href = anuncio`, que en la ventana falsa no carga nada.
2. **Clic secuestrado.** Engancha `click` y `touchend` sobre elementos del
   reproductor, hace `stopPropagation()` y llama a `window.open`.
3. **Secuestro de la pestaña.** La segunda red, bajo cierta condición del
   servidor, hace `location.href = anuncio` sobre **tu propia pestaña** en vez de
   abrir una nueva. Contra esto la Capa B guarda la última URL buena y te
   devuelve, pero solo si la navegación la hizo un script (`client_redirect`),
   nunca si pinchaste un enlace tú. Interruptor: *Rescatar la pestaña*.

No encontré ningún detector de adblock en esos scripts (ni `bait`, ni
`detect`, ni nada equivalente). El riesgo de alerta es bajo, y aun así el
enfoque de ventana falsa es el que menos se nota.

## Si algo sigue escapándose

El historial del ícono muestra qué técnica se usó y a qué URL apuntaba, con capa
A o B. Si ves entradas de capa B repetidas es que la Capa A no está cubriendo esa
técnica todavía; pásame esas líneas y añado el parche.

## Pruebas

Hay dos bancos. Ambos se abren directo en el navegador, se autoejecutan y
pintan PASA/FALLA sin necesidad de instalar la extensión.

`test/banco-siguiente.html` reproduce la lista de episodios del sitio de referencia, con su
botón trampa de paginación incluido, y comprueba las tres formas de URL que usan
estos sitios (`/serie/12/`, `/ver/serie-12`, `/ver/serie-episodio-12`), el
acarreo del 9 al 10, el último episodio, y que no mezcle series ni dominios.
También comprueba que encuentra un `<video>` escondido en un shadow DOM, que
descarta uno de 35 segundos (un anuncio) y que con varios se queda con el más
largo. Y que la tarjeta de volver a pantalla completa se ofrece, que tapa la
esquina, y que **un clic sintético no se toma por un gesto tuyo** — intentarlo
sería tiempo perdido, el navegador lo rechaza igual. Lleva un **control que debe
detectar un resultado malo**: sin él, el banco saldría verde también con el
código roto. Comprueba además que reconoce un nombre de reproductor pero **no**
toma «Descargar» ni un párrafo que mencione uno; que sabe cuál está puesto ya;
que elige el más usado, que baja al segundo si el primero no está, y que sin
preferencia guardada no pulsa nada. Estado: 37/37 pasan, y
verificado a la inversa rompiendo el código a propósito (`p.n + 2`), que da 2
fallos. El botón
«Ver la tarjeta» la muestra para mirarla con los ojos; la cuenta atrás navega de
verdad, y por eso apunta al propio banco y no al sitio real.

`test/banco-siguiente.html` cubre las direcciones de episodio, la detección del
vídeo, la elección de servidor y **el gesto de pantalla completa**, con trampas
dedicadas para Alt+Tab, Ctrl+Tab, Ctrl+W y Alt+Flecha. Estado: 49/49.

`test/foco.js` carga el service worker de verdad con un `chrome` simulado y
comprueba las seis situaciones de foco: viendo el anime, habiéndote ido a otra
pestaña, sin darle al play, emergente al fondo, el ajuste apagado, y un estado de
reproducción caducado. Se corre con `node test/foco.js`. Estado: 12/12.

`test/banco.html` simula las cinco técnicas y verifica que ninguna abre nada y
que un enlace legítimo al mismo dominio no se toca. Carga `blocker.js` **dos
veces a propósito** y comprueba que el parche no se duplica y que la marca de
«ya cargado» no asoma en `Object.keys(window)`. Estado: 10/10 pasan.

Un aviso por experiencia: si sirves los bancos por HTTP, hazlo **sin caché**. Dos
fallos que investigué resultaron ser el navegador reutilizando una versión vieja
de `blocker.js`, no el código.

Además se probó de punta a punta en Brave con la extensión realmente instalada,
sirviendo una página por HTTP: la inyección en el mundo MAIN ocurre, la ventana
falsa aguanta la comprobación `!o.closed`, el anchor queda anulado y el navegador
termina con **una sola pestaña abierta**. El caso del clic real sobre el
enlace-trampa se verificó aparte con un clic de ratón de verdad: el enlace se
anula y el clic llega al reproductor de abajo.
