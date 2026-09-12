// Capa A: corre en el mundo MAIN, antes que cualquier script de la pagina.
// Devuelve una ventana falsa a window.open en vez de bloquear de plano, para
// que el codigo del sitio siga su curso sin errores ni deteccion de adblock.
(() => {
  'use strict';

  // Guarda imprescindible: al recargar la extension se reinyecta en las
  // pestanas ya abiertas, y si esto corriera dos veces la segunda pasada
  // guardaria como "nativa" la funcion que ya parcheo la primera, dejando dos
  // capas envueltas una dentro de otra. Se define con defineProperty y no como
  // asignacion normal para que quede NO enumerable: este script vive en el
  // mundo de la pagina, y una marca visible en Object.keys(window) seria
  // justo la senal que buscan los detectores de bloqueadores.
  if (Object.getOwnPropertyDescriptor(window, '__sinpopCargado')) return;
  try { Object.defineProperty(window, '__sinpopCargado', { value: true }); }
  catch (e) { return; }

  const EVT_TO_PAGE = '__sinpop_cfg';
  const EVT_FROM_PAGE = '__sinpop_hit';

  // Guardamos las referencias nativas antes de que la pagina toque nada.
  const nativeOpen = window.open;
  const nativeClick = HTMLElement.prototype.click;
  const nativeDispatch = EventTarget.prototype.dispatchEvent;
  const nativeSubmit = HTMLFormElement.prototype.submit;
  const nativeToString = Function.prototype.toString;
  const CustomEventRef = window.CustomEvent;
  const dispatchOnWindow = nativeDispatch.bind(window);

  // Estado. Arranca desactivado y bridge.js lo enciende si el sitio esta en la
  // lista: asi jamas rompemos un popup legitimo (login OAuth, banco) por error.
  let active = false;
  let mode = 'silencioso';
  let forwardClick = true;

  // ---- toString nativo para las funciones que reemplazamos -----------------
  const disguised = new WeakMap();
  Function.prototype.toString = function () {
    const src = disguised.get(this);
    return src !== undefined ? src : nativeToString.call(this);
  };
  disguised.set(Function.prototype.toString, nativeToString.call(nativeToString));

  function disguise(fn, name) {
    disguised.set(fn, 'function ' + name + '() { [native code] }');
    return fn;
  }

  // ---- reporte hacia el mundo aislado --------------------------------------
  function report(how, url) {
    try {
      dispatchOnWindow(new CustomEventRef(EVT_FROM_PAGE, {
        detail: JSON.stringify({ how: how, url: String(url || '') })
      }));
    } catch (e) { /* la pagina no debe notar nada */ }
  }

  // ---- ventana falsa --------------------------------------------------------
  const noop = function () {};
  disguise(noop, '');

  function fakeLocation(url) {
    let parsed;
    try { parsed = new URL(url || 'about:blank', location.href); }
    catch (e) { parsed = new URL('about:blank'); }
    const loc = {
      assign: noop, replace: noop, reload: noop,
      toString: function () { return parsed.href; },
      get href() { return parsed.href; },
      set href(v) { try { parsed = new URL(v, parsed.href); } catch (e) {} }
    };
    ['protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash', 'origin']
      .forEach((k) => Object.defineProperty(loc, k, {
        get() { return parsed[k]; }, set() {}, enumerable: true, configurable: true
      }));
    return loc;
  }

  function fakeWindow(url) {
    const loc = fakeLocation(url);
    const doc = {
      open: noop, close: noop, write: noop, writeln: noop, focus: noop,
      createElement: (t) => document.createElement(t),
      createTextNode: (t) => document.createTextNode(t),
      getElementById: () => null,
      getElementsByTagName: () => [],
      getElementsByClassName: () => [],
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: noop, removeEventListener: noop,
      body: null, head: null, documentElement: null,
      title: '', cookie: '', readyState: 'complete',
      referrer: '', URL: loc.href, location: loc
    };

    const w = {
      closed: false,
      name: '',
      opener: null,
      document: doc,
      location: loc,
      focus: noop, blur: noop,
      close: function () { w.closed = true; },
      moveTo: noop, moveBy: noop, resizeTo: noop, resizeBy: noop,
      scroll: noop, scrollTo: noop, scrollBy: noop,
      print: noop, stop: noop,
      alert: noop, confirm: () => false, prompt: () => null,
      postMessage: noop, addEventListener: noop, removeEventListener: noop,
      setTimeout: () => 0, clearTimeout: noop,
      setInterval: () => 0, clearInterval: noop,
      requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
      getComputedStyle: () => ({}),
      innerWidth: 1024, innerHeight: 768,
      outerWidth: 1024, outerHeight: 768,
      screenX: 0, screenY: 0, pageXOffset: 0, pageYOffset: 0,
      devicePixelRatio: 1,
      localStorage: null, sessionStorage: null,
      navigator: navigator, screen: screen, history: { length: 1, back: noop, forward: noop, go: noop },
      open: function () { return fakeWindow(''); }
    };
    w.self = w.window = w.top = w.parent = w.frames = w;

    // Cualquier propiedad no prevista devuelve una funcion inerte en vez de
    // reventar con TypeError, que es lo que delataria el bloqueo.
    return new Proxy(w, {
      get(t, p) {
        if (p in t) return t[p];
        if (typeof p === 'symbol' || p === 'then') return undefined;
        return noop;
      },
      set(t, p, v) { t[p] = v; return true; },
      has() { return true; }
    });
  }

  // ---- window.open ----------------------------------------------------------
  const patchedOpen = disguise(function open(url) {
    if (!active) return nativeOpen.apply(window, arguments);
    if (mode === 'apoyo') {
      // Dejamos abrir: la Capa B la manda al fondo y la cierra sola.
      report('open-apoyo', url);
      return nativeOpen.apply(window, arguments);
    }
    report('window.open', url);
    return fakeWindow(url);
  }, 'open');

  try {
    Object.defineProperty(window, 'open', {
      value: patchedOpen, writable: true, configurable: true
    });
  } catch (e) { window.open = patchedOpen; }

  // ---- anchors y formularios con target _blank ------------------------------
  function isBlank(el) {
    if (!el || !el.target) return false;
    const t = String(el.target).toLowerCase();
    return t === '_blank' || t === '_new';
  }

  function externo(href) {
    try { return new URL(href, location.href).hostname !== location.hostname; }
    catch (e) { return false; }
  }

  HTMLElement.prototype.click = disguise(function click() {
    if (active && mode !== 'apoyo' && this instanceof HTMLAnchorElement &&
        isBlank(this) && externo(this.href)) {
      report('a.click()', this.href);
      return;
    }
    return nativeClick.apply(this, arguments);
  }, 'click');

  EventTarget.prototype.dispatchEvent = disguise(function dispatchEvent(ev) {
    if (active && mode !== 'apoyo' && ev && !ev.isTrusted &&
        (ev.type === 'click' || ev.type === 'auxclick' || ev.type === 'mouseup') &&
        this instanceof HTMLAnchorElement && isBlank(this) && externo(this.href)) {
      report('dispatchEvent', this.href);
      return true;
    }
    return nativeDispatch.apply(this, arguments);
  }, 'dispatchEvent');

  HTMLFormElement.prototype.submit = disguise(function submit() {
    if (active && mode !== 'apoyo' && isBlank(this)) {
      report('form.submit()', this.action);
      return;
    }
    return nativeSubmit.apply(this, arguments);
  }, 'submit');

  // ---- clic real sobre el enlace-trampa que tapa el reproductor -------------
  // Es el que obliga a cerrar pestanas 3-4 veces: un <a target="_blank"> encima
  // del play. Lo anulamos y reenviamos el clic a lo que hay debajo.
  document.addEventListener('click', function (ev) {
    if (!active || mode === 'apoyo' || !ev.isTrusted) return;
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0) return;

    const a = ev.target && ev.target.closest && ev.target.closest('a[target], area[target]');
    if (!a || !isBlank(a) || !externo(a.href)) return;

    ev.preventDefault();
    ev.stopImmediatePropagation();
    report('clic-trampa', a.href);

    if (!forwardClick) return;
    // Reenviamos a lo que este debajo del enlace, que suele ser el play real.
    const x = ev.clientX, y = ev.clientY;
    const capas = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [];
    for (const el of capas) {
      if (el === a || a.contains(el) || el.contains(a)) continue;
      if (el === document.documentElement || el === document.body) continue;
      try {
        nativeDispatch.call(el, new MouseEvent('click', {
          bubbles: true, cancelable: true, view: window, clientX: x, clientY: y
        }));
      } catch (e) {}
      break;
    }
  }, true);

  // ---- configuracion desde el mundo aislado --------------------------------
  window.addEventListener(EVT_TO_PAGE, function (ev) {
    let cfg;
    try { cfg = JSON.parse(ev.detail); } catch (e) { return; }
    active = !!cfg.active;
    mode = cfg.mode || 'silencioso';
    forwardClick = cfg.forwardClick !== false;
  }, true);
})();
