// Capa C: el aviso de "siguiente episodio", estilo Netflix.
//
// POR QUE VIVE EN LA EXTENSION Y NO PODRIA SER UN SCRIPT DE LA PAGINA
// -------------------------------------------------------------------
// El <video> no esta en jkanime: esta dentro de un iframe de streamwish, desu u
// ok.ru, que son otros dominios. La pagina de arriba no puede leer
// video.currentTime, el navegador se lo impide. Esta extension si, porque sus
// content scripts entran en TODOS los marcos (all_frames: true).
//
// De ahi el reparto de trabajo:
//
//   marco del reproductor  ->  mira el reloj del video y pinta la tarjeta
//   marco de arriba (0)    ->  sabe cual es el episodio siguiente
//   background.js          ->  lleva y trae los mensajes entre los dos
//
// La tarjeta se pinta en el MISMO documento donde esta el video, no en la
// pagina de arriba. Es a proposito: si estas en pantalla completa, el elemento
// a pantalla completa es el iframe, y cualquier cosa que dibuje la pagina de
// arriba queda DETRAS, invisible.
//
// SOBRE LA PANTALLA COMPLETA
// --------------------------
// Al saltar de episodio la pantalla completa se pierde, y no se puede devolver
// sola: requestFullscreen() exige un gesto tuyo reciente ("transient user
// activation"), y una pagina recien cargada no tiene ninguno. Es una regla de
// seguridad del navegador, no un descuido. Lo unico honesto es dejar el regreso
// a un solo clic: al llegar al episodio nuevo aparece un boton "Pantalla
// completa", y ademas cualquier clic o tecla dentro del reproductor sirve, que
// es el que ibas a dar igualmente para darle al play.
//
// SOBRE COMO ENCUENTRA EL VIDEO
// -----------------------------
// La primera version escuchaba el evento 'timeupdate' en fase de captura sobre
// document. Sobre el papel basta; en la practica no salto en jkanime. No hay
// forma de saber desde fuera cual de los eslabones fallo, asi que ahora hace
// las dos cosas: escucha el evento Y ademas mira el reloj cada dos segundos,
// buscando el <video> tambien dentro de los shadow DOM abiertos. Un sondeo cada
// dos segundos no le cuesta nada al equipo y no depende de como el reproductor
// monte su arbol.
(() => {
  'use strict';

  // Al recargar la extension volvemos a inyectar los scripts en las pestanas ya
  // abiertas (ver background.js). Sin esta guarda quedarian dos copias de todo
  // corriendo en el mismo marco.
  if (window.__sinpopSiguienteCargado) return;
  window.__sinpopSiguienteCargado = true;

  const hayChrome = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;

  // Cuando recargas la extension, los content scripts que ya estaban corriendo
  // en una pestana abierta se quedan huerfanos: chrome.runtime.id pasa a ser
  // undefined y todo mensaje lanza "Extension context invalidated". Por eso hay
  // que preguntarlo cada vez y no una sola al arrancar.
  function vivo() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }

  // Por debajo de esto no es el episodio: es un anuncio de video o un avance.
  const MIN_DURACION = 240;      // 4 minutos
  const SONDEO_MS = 2000;

  const AJUSTES = {
    nextEpisode: true,     // funcion encendida
    nextThreshold: 70,     // segundos antes del final en que aparece (1:10)
    nextHideAfter: 20,     // segundos que la tarjeta se queda a la vista (0 = siempre)
    serverAuto: true,      // elegir solo el reproductor de siempre
    nextAutoplay: false,   // avanzar solo, sin tocar nada
    nextCountdown: 10,     // cuenta atras cuando nextAutoplay esta encendido
    nextDebug: false       // dejar rastro en el historial del icono
  };

  let cfg = Object.assign({}, AJUSTES);
  let sitios = [];
  let enLista = false;

  // ---- de que sitio estamos hablando ---------------------------------------
  // Repetimos aqui la logica de dominios de bridge.js en vez de escucharle. La
  // primera version le preguntaba a bridge por un evento del DOM, y al no
  // funcionar nada no habia manera de saber si el fallo estaba en ese eslabon.
  // Son doce lineas; la independencia vale mas que ahorrarlas.
  function hostDeLaCima() {
    // Un iframe del reproductor tiene otro dominio que la pagina de anime.
    try {
      const anc = location.ancestorOrigins;
      if (anc && anc.length) return new URL(anc[anc.length - 1]).hostname;
    } catch (e) {}
    try { if (window.top === window.self) return location.hostname; } catch (e) {}
    try { return new URL(document.referrer).hostname; } catch (e) {}
    return location.hostname;
  }

  function coincide(host, lista) {
    host = String(host || '').toLowerCase().replace(/^www\./, '');
    return (lista || []).some((s) => {
      s = String(s).toLowerCase().replace(/^www\./, '').trim();
      return s && (host === s || host.endsWith('.' + s));
    });
  }

  // ---- rastro en el historial del icono ------------------------------------
  // Va al mismo sitio que los popunders bloqueados, con capa C, pero sin sumar
  // al contador: son notas de diagnostico, no bloqueos.
  const dichas = new Set();
  function nota(clave, texto, unaVez) {
    if (!cfg.nextDebug || !vivo()) return;
    if (unaVez) {
      if (dichas.has(clave)) return;
      dichas.add(clave);
    }
    try { chrome.runtime.sendMessage({ type: 'diag', how: 'C · ' + texto, url: location.href }); } catch (e) {}
  }

  function leerAjustes(s) {
    s = s || {};
    sitios = s.sites || [];
    cfg.nextEpisode = s.nextEpisode !== false;
    cfg.nextAutoplay = !!s.nextAutoplay;
    cfg.nextDebug = !!s.nextDebug;
    cfg.nextThreshold = Math.min(600, Math.max(5,
      parseInt(s.nextThreshold, 10) || AJUSTES.nextThreshold));
    cfg.nextCountdown = Math.min(60, Math.max(3,
      parseInt(s.nextCountdown, 10) || AJUSTES.nextCountdown));
    cfg.nextHideAfter = Math.min(300, Math.max(0,
      parseInt(s.nextHideAfter, 10) || 0));
    cfg.serverAuto = s.serverAuto !== false;

    const arriba = hostDeLaCima();
    enLista = coincide(location.hostname, sitios) || coincide(arriba, sitios);
    nota('marco', enLista
      ? 'marco activo (arriba: ' + arriba + ')'
      : 'marco IGNORADO (aqui: ' + location.hostname + ', arriba: ' + arriba + ')', true);
  }

  if (hayChrome) {
    chrome.storage.local.get('settings', (d) => leerAjustes(d && d.settings));
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === 'local' && c.settings) { dichas.clear(); leerAjustes(c.settings.newValue); }
    });
  }

  // =========================================================================
  // PARTE 1 - averiguar cual es el episodio siguiente (solo el marco de arriba)
  // =========================================================================
  //
  // Se hace en dos pasos y en este orden por una razon concreta: en jkanime hay
  // un boton que dice "Siguiente" que NO es el episodio siguiente, es la
  // paginacion de la lista de episodios. Fiarse del texto del enlace te manda
  // al sitio equivocado. Asi que primero calculamos a mano cual DEBERIA ser la
  // direccion, y despues buscamos si esa direccion existe en la pagina.

  // Corta la ruta por el ultimo numero. Cubre las tres formas que usan estos
  // sitios:  /serie/12/   ·   /ver/serie-12   ·   /ver/serie-episodio-12
  function partir(ruta) {
    const m = String(ruta).match(/(\d+)(\/?)$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (!isFinite(n) || n < 1 || n > 9998) return null;
    return { prefijo: ruta.slice(0, m.index), n: n, barra: m[2] };
  }

  function armar(p, n) {
    return p.prefijo + n + p.barra;
  }

  // base se pasa como argumento (en vez de leer location a secas) para que el
  // banco de pruebas pueda simular una url de jkanime desde un file://
  function episodiosEnLaPagina(p, base) {
    base = base || location.href;
    const origen = new URL(base).origin;
    const vistos = new Set();
    document.querySelectorAll('a[href]').forEach((a) => {
      let u;
      try { u = new URL(a.getAttribute('href'), base); } catch (e) { return; }
      if (u.origin !== origen) return;
      if (!u.pathname.startsWith(p.prefijo)) return;
      const q = partir(u.pathname);
      if (q && q.prefijo === p.prefijo) vistos.add(q.n);
    });
    return vistos;
  }

  function calcularSiguiente(base) {
    base = base || location.href;
    const aqui = new URL(base);
    const p = partir(aqui.pathname);
    if (!p) return null;

    const destino = p.n + 1;
    const lista = episodiosEnLaPagina(p, base);

    // La pagina enlaza el siguiente: confirmado, existe.
    let confirmado = lista.has(destino);

    // La pagina lista episodios pero NO el siguiente, y el actual no es el
    // ultimo que conoce: raro, mejor no inventar.
    if (!confirmado && lista.size) {
      let max = 0;
      lista.forEach((n) => { if (n > max) max = n; });
      if (destino > max) return null;   // era el ultimo episodio
    }

    return {
      url: new URL(armar(p, destino), aqui.origin).href,
      n: destino,
      confirmado: confirmado
    };
  }

  // El marco de arriba responde a quien le pregunte.
  if (hayChrome) {
    chrome.runtime.onMessage.addListener((msg, sender, responder) => {
      if (!msg || msg.type !== 'siguiente-calcula') return;
      let r = null;
      try { r = calcularSiguiente(); } catch (e) {}
      responder(r);
      return false;
    });
  }

  // =========================================================================
  // PARTE 2 - la tarjeta
  // =========================================================================

  let raiz = null;        // el <div> anfitrion, con su shadow DOM
  let sombra = null;
  let temporizador = null;

  // Estas tres sustituyen a un unico "ya salio" que tenia antes. El fallo era
  // que se marcaba ANTES de preguntar por el episodio siguiente: si la consulta
  // fallaba (por ejemplo con el contexto de la extension invalidado), quedaba
  // marcado para siempre y ya no volvia a intentarlo en todo el episodio. De
  // ahi que solo funcionara despues de recargar la pagina.
  let mostrada = false;        // la tarjeta llego a salir: no insistir
  let pidiendo = false;        // hay una consulta en vuelo
  let proximoIntento = 0;      // tras un fallo, esperar antes de reintentar

  const ESTILO = `
    :host { all: initial; }
    .caja {
      position: fixed; right: 20px; bottom: 22px; z-index: 2147483647;
      display: flex; align-items: center; gap: 14px;
      padding: 12px 14px 12px 18px; border-radius: 10px;
      background: rgba(18,18,18,.94); color: #fff;
      font: 500 14px/1.3 system-ui, sans-serif;
      box-shadow: 0 8px 28px rgba(0,0,0,.55);
      border: 1px solid rgba(255,255,255,.12);
      animation: entra .22s ease-out;
    }
    @keyframes entra { from { opacity: 0; transform: translateY(10px) } }
    .txt { display: flex; flex-direction: column; gap: 2px; }
    .et { font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
          color: #b3b3b3; font-weight: 600; }
    .ep { font-size: 15px; font-weight: 600; }
    .ir {
      all: unset; cursor: pointer; box-sizing: border-box;
      padding: 9px 16px; border-radius: 6px;
      background: #fff; color: #111; font: 600 14px system-ui, sans-serif;
      white-space: nowrap;
    }
    .ir:hover { background: #e6e6e6; }
    .ir:focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; }
    .no {
      all: unset; cursor: pointer; padding: 4px 8px; border-radius: 6px;
      color: #b3b3b3; font: 600 18px system-ui, sans-serif; line-height: 1;
    }
    .no:hover { color: #fff; background: rgba(255,255,255,.12); }
    @media (max-width: 560px) {
      .caja { right: 12px; left: 12px; bottom: 12px; }
    }
  `;

  function cerrar() {
    if (temporizador) { clearInterval(temporizador); temporizador = null; }
    if (raiz && raiz.parentNode) raiz.parentNode.removeChild(raiz);
    raiz = null; sombra = null;
  }

  // El sitio donde colgarla cambia al entrar y salir de pantalla completa.
  function anfitrion() {
    return document.fullscreenElement || document.body || document.documentElement;
  }

  // Constructor unico para las dos tarjetas (la del siguiente episodio y la de
  // volver a pantalla completa): mismo aspecto, mismo sitio, misma ✕.
  function pintarTarjeta(o) {
    cerrar();
    raiz = document.createElement('div');
    raiz.setAttribute('data-sinpop', 'siguiente');
    sombra = raiz.attachShadow({ mode: 'closed' });

    const est = document.createElement('style');
    est.textContent = ESTILO;

    const caja = document.createElement('div');
    caja.className = 'caja';

    const txt = document.createElement('div');
    txt.className = 'txt';
    const et = document.createElement('div');
    et.className = 'et';
    et.textContent = o.etiqueta;
    const ep = document.createElement('div');
    ep.className = 'ep';
    ep.textContent = o.titulo;
    txt.append(et, ep);

    const ir = document.createElement('button');
    ir.className = 'ir';
    ir.textContent = o.boton;

    const no = document.createElement('button');
    no.className = 'no';
    no.textContent = '×';
    no.title = 'Cerrar (Esc)';

    caja.append(txt, ir, no);
    sombra.append(est, caja);
    anfitrion().appendChild(raiz);
    try { ir.focus({ preventScroll: true }); } catch (e) {}

    ir.addEventListener('click', o.alPulsar);
    no.addEventListener('click', () => { cerrar(); if (o.alCerrar) o.alCerrar(); });
    return { caja: caja, boton: ir };
  }

  function mostrar(info) {
    const t = pintarTarjeta({
      etiqueta: info.confirmado ? 'A continuación' : 'A continuación (sin confirmar)',
      titulo: 'Episodio ' + info.n,
      boton: 'Reproducir',
      alPulsar: () => saltar(info.url)
    });
    const caja = t.caja, ir = t.boton;
    nota('tarjeta', 'tarjeta mostrada: episodio ' + info.n);

    // Se retira sola pasado su rato. La idea es verla con margen antes del
    // final y que no se quede tapando el ending si decides no saltar.
    if (cfg.nextHideAfter > 0) {
      setTimeout(() => { if (raiz && !temporizador) cerrar(); }, cfg.nextHideAfter * 1000);
    }

    if (cfg.nextAutoplay) {
      let quedan = cfg.nextCountdown;
      ir.textContent = 'Reproducir (' + quedan + ')';
      temporizador = setInterval(() => {
        quedan--;
        if (quedan <= 0) { clearInterval(temporizador); temporizador = null; saltar(info.url); return; }
        ir.textContent = 'Reproducir (' + quedan + ')';
      }, 1000);
      // Cualquier gesto tuyo cancela la cuenta atras: si estabas mirando los
      // creditos a proposito, que no te lo quite de delante.
      const frena = () => {
        if (!temporizador) return;
        clearInterval(temporizador); temporizador = null;
        ir.textContent = 'Reproducir';
      };
      caja.addEventListener('mouseenter', frena);
      document.addEventListener('keydown', frena, true);
    }
  }

  // Al entrar o salir de pantalla completa hay que recolgarla, o desaparece.
  document.addEventListener('fullscreenchange', () => {
    if (raiz) anfitrion().appendChild(raiz);
  }, true);

  document.addEventListener('keydown', (ev) => {
    if (raiz && ev.key === 'Escape') cerrar();
  }, true);

  function enPantallaCompleta() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function saltar(url) {
    const veniaEnPC = enPantallaCompleta();
    cerrar();
    nota('salto', 'saltando a ' + url + (veniaEnPC ? ' (venias en pantalla completa)' : ''));
    if (!hayChrome) { location.href = url; return; }   // banco de pruebas
    // La navegacion la hace el fondo: desde un iframe de otro dominio no se
    // puede tocar top.location, y un window.open aqui lo mataria blocker.js.
    try { chrome.runtime.sendMessage({ type: 'siguiente-ir', url: url, pc: veniaEnPC }); } catch (e) {}
  }

  // =========================================================================
  // PARTE 2b - devolver la pantalla completa en el episodio nuevo
  // =========================================================================
  //
  // No se puede hacer sola: hace falta un gesto tuyo. Asi que se arma una
  // trampa amable — el primer clic o tecla que des dentro del reproductor la
  // devuelve — y ademas se ofrece un boton por si el video arranca solo y no
  // llegas a tocar nada.

  let esperandoGesto = false;

  function desarmar() {
    if (!esperandoGesto) return;
    esperandoGesto = false;
    document.removeEventListener('pointerdown', alGesto, true);
    document.removeEventListener('keydown', alGesto, true);
  }

  function pedirPantallaCompleta() {
    const dest = document.documentElement;
    const pedir = dest.requestFullscreen || dest.webkitRequestFullscreen;
    if (!pedir) { nota('pc-no', 'este marco no puede pedir pantalla completa'); return; }
    let p;
    try { p = pedir.call(dest); } catch (e) { nota('pc-error', 'pantalla completa rechazada: ' + e); return; }
    const bien = () => { nota('pc-ok', 'pantalla completa devuelta'); cerrar(); desarmar();
      try { chrome.runtime.sendMessage({ type: 'pc-listo' }); } catch (e) {} };
    const mal = (e) => nota('pc-error', 'pantalla completa rechazada: ' + e);
    if (p && p.then) p.then(bien, mal);
    else setTimeout(() => (enPantallaCompleta() ? bien() : mal('sin promesa')), 300);
  }

  // Teclas con las que de verdad se le da al play. Nada mas cuenta como gesto.
  //
  // Aqui estaba el fallo que dejaba la pestana encerrada: se armaba un keydown
  // sin filtro, y Alt+Tab y Ctrl+Tab TAMBIEN son keydown. O sea que tu propio
  // intento de cambiar de ventana disparaba la pantalla completa y te devolvia
  // adentro. Cuanto mas insistias, mas te encerraba.
  const TECLAS_PLAY = [' ', 'Spacebar', 'Enter', 'k', 'K', 'f', 'F'];

  function escribiendo() {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  }

  function gestoValido(ev) {
    if (!ev || !ev.isTrusted) return false;
    if (ev.type === 'keydown') {
      // Cualquier combinacion con modificador es para el navegador, no para el
      // reproductor: Alt+Tab, Ctrl+Tab, Ctrl+W, Cmd+`, Alt+Flecha...
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return false;
      if (escribiendo()) return false;
      return TECLAS_PLAY.indexOf(ev.key) !== -1;
    }
    if (ev.type === 'pointerdown') return ev.button === 0;
    return false;
  }

  function alGesto(ev) {
    // isTrusted es la clave: un clic sintetico no vale como gesto para el
    // navegador, asi que ni lo intentamos.
    if (!gestoValido(ev)) return;
    pedirPantallaCompleta();
  }

  function ofrecerPantallaCompleta() {
    if (esperandoGesto || enPantallaCompleta()) return;
    esperandoGesto = true;
    document.addEventListener('pointerdown', alGesto, true);
    document.addEventListener('keydown', alGesto, true);
    pintarTarjeta({
      etiqueta: 'Venías en pantalla completa',
      titulo: 'Un clic y vuelve',
      boton: 'Pantalla completa',
      alPulsar: pedirPantallaCompleta,
      alCerrar: () => { desarmar(); try { chrome.runtime.sendMessage({ type: 'pc-listo' }); } catch (e) {} }
    });
    nota('pc-oferta', 'ofreciendo devolver la pantalla completa');
    // Si en 45 s no tocaste nada, se quita de en medio.
    setTimeout(() => { if (esperandoGesto) { desarmar(); cerrar(); } }, 45000);
  }

  // Y si te vas de la pestana, la oferta se retira. Volver mas tarde no deberia
  // meterte en pantalla completa por sorpresa.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && esperandoGesto) { desarmar(); cerrar(); }
  }, true);

  // =========================================================================
  // PARTE 2c - recordar que reproductor usas y volver a elegirlo
  // =========================================================================
  //
  // Este es el que de verdad destraba la pantalla completa. Al llegar al
  // episodio nuevo hay que elegir servidor otra vez, y ese clic pasa ANTES de
  // que exista el video, asi que no sirve como gesto. Si el reproductor de
  // siempre se carga solo, el siguiente clic que das ya es el del play, dentro
  // del reproductor, y ese si devuelve la pantalla completa.
  //
  // Solo corre en el marco de arriba: la lista de servidores esta ahi.

  // Nombres que estos sitios usan para sus reproductores. La lista es
  // deliberadamente cerrada: reconocer "cualquier cosa que parezca una pestana"
  // acabaria pulsando un anuncio.
  const SERVIDORES = [
    'desu', 'magi', 'okru', 'ok.ru', 'mega', 'streamwish', 'voe', 'vidhide',
    'mixdrop', 'mp4upload', 'streamtape', 'stape', 'doodstream', 'dood',
    'filemoon', 'netu', 'yourupload', 'uqload', 'vidguard', 'burstcloud',
    'sendvid', 'fireload', 'senvid', 'listeamed', 'zippyshare', 'solidfiles',
    'amazon', 'nozomi', 'desuka', 'xtreme', 'jkanime'
  ];

  let cuentas = {};        // cuantas veces elegiste cada uno
  let yaElegido = false;   // una sola vez por carga de pagina

  function nombreDeServidor(el) {
    const t = (el.textContent || '').trim().toLowerCase();
    if (!t || t.length > 20) return null;
    const n = t.replace(/[^a-z0-9.]/g, '');
    return SERVIDORES.indexOf(n) >= 0 ? n : null;
  }

  // Los candidatos son solo hojas del arbol: si aceptaramos contenedores, una
  // fila entera o la tabla podria "llamarse" como un servidor por su contenido.
  function candidatos() {
    const m = new Map();
    document.querySelectorAll('a, li, td, th, button, span, div, p').forEach((el) => {
      if (el.children.length) return;
      const n = nombreDeServidor(el);
      if (n && !m.has(n)) m.set(n, el);
    });
    return m;
  }

  // Heuristica para no volver a pulsar el que ya esta puesto: estos sitios lo
  // marcan con una clase. Si no la encontramos, no pasa nada grave: pulsarlo
  // otra vez recarga el mismo reproductor.
  function yaEstaPuesto(el) {
    for (let e = el, i = 0; e && i < 3; e = e.parentElement, i++) {
      const c = (e.className || '') + ' ' + (e.getAttribute && e.getAttribute('aria-selected') === 'true' ? 'selected' : '');
      if (/\b(active|selected|current|activo|seleccionado)\b/i.test(String(c))) return true;
    }
    return false;
  }

  function guardarCuentas() {
    if (!vivo()) return;
    try { chrome.storage.local.set({ servidores: cuentas }); } catch (e) {}
  }

  function recordarServidor(n) {
    cuentas[n] = (cuentas[n] || 0) + 1;
    guardarCuentas();
    nota('servidor-' + n, 'reproductor elegido: ' + n + ' (van ' + cuentas[n] + ')');
  }

  function elegirServidor() {
    if (yaElegido || !cfg.serverAuto || !enLista) return;
    const m = candidatos();
    // Con menos de dos no hay lista de servidores que valga; probablemente sea
    // una palabra suelta en cualquier otro sitio de la pagina.
    if (m.size < 2) return;
    yaElegido = true;

    const orden = Object.keys(cuentas).sort((a, b) => cuentas[b] - cuentas[a]);
    if (!orden.length) { nota('sin-preferencia', 'aun no se cual reproductor prefieres'); return; }

    for (const n of orden) {
      const el = m.get(n);
      if (!el) continue;                       // ese no esta en este episodio
      if (yaEstaPuesto(el)) { nota('servidor-ok', n + ' ya estaba puesto'); return; }
      try { el.click(); } catch (e) { continue; }
      nota('servidor-auto', 'elegido solo: ' + n);
      return;
    }
    nota('servidor-ninguno', 'ninguno de tus reproductores esta en este episodio');
  }

  if (hayChrome && window.top === window.self) {
    chrome.storage.local.get('servidores', (d) => {
      cuentas = (d && d.servidores) || {};
      // Un respiro para que la lista de servidores termine de pintarse.
      setTimeout(elegirServidor, 1500);
      setTimeout(elegirServidor, 4000);
    });

    // Solo clics de verdad: los sinteticos son los nuestros, y contarlos
    // convertiria la preferencia en una profecia que se cumple sola.
    document.addEventListener('click', (ev) => {
      if (!ev.isTrusted || !enLista) return;
      let el = ev.target;
      for (let i = 0; el && i < 4; i++, el = el.parentElement) {
        const n = nombreDeServidor(el);
        if (n) { recordarServidor(n); return; }
      }
    }, true);
  }

  // =========================================================================
  // PARTE 3 - vigilar el reloj del video
  // =========================================================================

  // Busca <video> tambien dentro de shadow DOM abiertos. El paseo por todos los
  // nodos solo se hace si no aparecio ninguno por las buenas, que es el caso
  // raro; asi el sondeo sigue siendo barato en la pagina normal.
  function buscarVideos() {
    const v = Array.from(document.querySelectorAll('video, audio'));
    if (v.length) return v;
    const fondo = [];
    document.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) el.shadowRoot.querySelectorAll('video, audio').forEach((m) => fondo.push(m));
    });
    return fondo;
  }

  function elBueno() {
    let mejor = null;
    buscarVideos().forEach((v) => {
      const d = v.duration;
      if (!isFinite(d) || d < MIN_DURACION) return;
      if (!mejor || d > mejor.duration) mejor = v;
    });
    return mejor;
  }

  function preguntarYMostrar() {
    if (mostrada || pidiendo || Date.now() < proximoIntento) return;
    pidiendo = true;

    const fallo = (por) => {
      pidiendo = false;
      proximoIntento = Date.now() + 5000;   // se reintenta, no se abandona
      nota('fallo-' + por, 'no pude ofrecer el siguiente (' + por + '), reintento en 5s');
    };
    const pintar = (info) => {
      pidiendo = false;
      if (info && info.url) { mostrada = true; mostrar(info); }
      else fallo('sin episodio siguiente');
    };

    if (window.top === window.self) {   // el video esta en la propia pagina
      try { pintar(calcularSiguiente()); } catch (e) { fallo('error al calcular: ' + e); }
      return;
    }
    if (!vivo()) { fallo('extension recargada; recarga la pagina'); return; }
    try {
      chrome.runtime.sendMessage({ type: 'siguiente-pregunta' }, (r) => {
        if (chrome.runtime.lastError) return fallo(chrome.runtime.lastError.message);
        pintar(r);
      });
    } catch (e) { fallo('' + e); }
  }

  let vistoUnVideo = false;   // declarado aqui, que es donde se usa primero
  let durAnterior = 0;
  let durDesde = 0;

  // Los reproductores por trozos (HLS, que es lo que usan casi todos) anuncian
  // una duracion provisional mientras cargan y la corrigen despues. Si se hace
  // caso a la primera cifra, "falta menos de un minuto" puede ser mentira en el
  // minuto cuatro. Se exige que la duracion lleve 4 segundos sin moverse.
  const ASIENTO_MS = 4000;

  function revisar(v) {
    if (!enLista || !cfg.nextEpisode || mostrada || !v) return;
    const d = v.duration;
    if (!isFinite(d) || d < MIN_DURACION) return;
    if (Math.abs(d - durAnterior) > 1) { durAnterior = d; durDesde = Date.now(); return; }
    if (Date.now() - durDesde < ASIENTO_MS) return;
    if (!vistoUnVideo) {
      vistoUnVideo = true;
      nota('video', 'video encontrado, dura ' + Math.round(d) + 's');
      // Aqui, y no antes: solo tiene sentido ofrecerla en el marco que de
      // verdad tiene el episodio, no en cada iframe de publicidad.
      if (hayChrome) {
        try {
          chrome.runtime.sendMessage({ type: 'pc-consultar' }, (r) => {
            if (!chrome.runtime.lastError && r && r.pendiente) ofrecerPantallaCompleta();
          });
        } catch (e) {}
      }
    }
    const falta = d - v.currentTime;
    if (falta > cfg.nextThreshold) return;
    nota('umbral', 'faltan ' + Math.round(falta) + 's, pido el siguiente');
    preguntarYMostrar();
  }

  // Camino 1: el evento. Los eventos de <video> no burbujean, pero en fase de
  // captura si llegan a document.
  function alEvento(ev) {
    if (ev.target instanceof HTMLMediaElement) revisar(ev.target);
  }
  document.addEventListener('timeupdate', alEvento, true);
  document.addEventListener('ended', alEvento, true);

  // Camino 2: el sondeo. Es el que no depende de como el reproductor arme su
  // arbol ni de que los eventos lleguen hasta document.
  let sinVideo = 0;
  setInterval(() => {
    if (!enLista || !cfg.nextEpisode) return;
    const v = elBueno();
    if (!v) {
      // Solo se queja tras un minuto: al principio el reproductor aun no ha
      // cargado nada y no hay nada de que informar.
      if (++sinVideo === 30) nota('sin-video', 'un minuto sin encontrar video en este marco', true);
      return;
    }
    sinVideo = 0;
    revisar(v);
  }, SONDEO_MS);

  // Video nuevo (cambiaste de calidad o de servidor): vuelve a estar permitido.
  function reiniciar(ev) {
    if (!(ev.target instanceof HTMLMediaElement)) return;
    mostrada = false;
    proximoIntento = 0;
    durAnterior = 0;
    cerrar();
  }
  document.addEventListener('loadedmetadata', reiniciar, true);
  document.addEventListener('emptied', reiniciar, true);

  // Para el banco de pruebas: sin esto la logica de direcciones no se puede
  // probar sin instalar la extension.
  if (!hayChrome) {
    globalThis.__sinpopSiguiente = {
      partir, armar, episodiosEnLaPagina, calcularSiguiente, mostrar, cerrar,
      buscarVideos, elBueno, pintarTarjeta, ofrecerPantallaCompleta, gestoValido,
      nombreDeServidor, candidatos, yaEstaPuesto, elegirServidor,
      cuentasDe: () => cuentas, ponCuentas: (c) => { cuentas = c; yaElegido = false; },
      activar: () => { enLista = true; },
      ajustar: (o) => Object.assign(cfg, o)
    };
  }
})();
