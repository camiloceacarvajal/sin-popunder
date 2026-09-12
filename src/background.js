// Capa B: la red de seguridad. Si algo se escapa de los parches del mundo MAIN
// y logra abrir una pestana, aqui la mandamos al fondo y la cerramos sola.
const DEFAULT_SETTINGS = {
  enabled: true,
  mode: 'silencioso',
  supportSeconds: 4,
  forwardClick: true,
  revertRedirect: true,
  focoSoloConVideo: true,
  diagnostico: true,
  nextEpisode: true,
  nextThreshold: 70,
  nextHideAfter: 20,
  serverAuto: true,
  nextAutoplay: false,
  nextCountdown: 10,
  nextDebug: false,
  sites: [
    'jkanime.net',
    'animeflv.net',
    'tioanime.com',
    'monoschinos2.com',
    'animelatinohd.com',
    'animeonline.ninja',
    'hentaila.com'
  ],
  pausedUntil: 0
};

const MAX_LOG = 300;
const GRACIA_MS = 3000;

const gracia = new Map();        // tabId del que abre -> timestamp limite
const enObservacion = new Map(); // tabId nuevo -> { openerHost, url }
const ultimaBuena = new Map();   // tabId -> ultima url del sitio vigilado
const ultimoRescate = new Map(); // tabId -> timestamp del ultimo rescate
const pendientePC = new Map();   // tabId -> hasta cuando ofrecer la pantalla completa
const estadoVideo = new Map();   // tabId -> { playing, ts } del reproductor
const historialFoco = new Map(); // windowId -> ultimas pestanas que elegiste tu

// Se levanta mientras SOMOS NOSOTROS los que cambiamos de pestana, para no
// confundir nuestro propio movimiento con una eleccion tuya.
let nuestroCambio = false;

// Un video sonando avisa cada 5 s. Sin noticias en 20 s lo damos por parado.
const VIDEO_FRESCO_MS = 20000;

function videoSonando(tabId) {
  const e = estadoVideo.get(tabId);
  return !!e && e.playing && (Date.now() - e.ts) < VIDEO_FRESCO_MS;
}

// A donde devolver el foco: a la ultima pestana que elegiste tu, nunca a la
// emergente ni, a ciegas, al anime.
function aDondeVolver(windowId, idEmergente, openerId) {
  const hist = historialFoco.get(windowId) || [];
  for (const id of hist) {
    if (id !== idEmergente && !enObservacion.has(id)) return id;
  }
  return openerId;
}

// Cuanto tiempo sigue en pie la oferta de devolver la pantalla completa tras
// saltar de episodio. Dos minutos: da de sobra para que cargue la pagina nueva
// y el reproductor, y no tanto como para que reaparezca en otra cosa.
const PC_MS = 120000;

async function ajustes() {
  const data = await chrome.storage.local.get('settings');
  return Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
}

function normalizar(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

function vigilado(host, sitios) {
  host = normalizar(host);
  return sitios.some((s) => {
    s = normalizar(s).trim();
    return s && (host === s || host.endsWith('.' + s));
  });
}

// Paginas del propio navegador y del sistema: brave://, chrome://, about:algo,
// file://, las de otras extensiones. NUNCA se tocan. Cerrarlas era lo que
// impedia llegar a brave://extensions para apagar la extension.
//
// about:blank y la cadena vacia SI siguen en juego: asi es como empieza un
// popunder antes de redirigir al anuncio.
// Deja constancia de CADA intervencion sobre tus pestanas, con el motivo.
// Sale en el historial del icono marcado como D. No cuenta en el contador.
function diag(cfg, texto, url) {
  if (!cfg || cfg.diagnostico === false) return;
  registrar({ how: 'D · ' + texto, url: url || '', site: 'foco', layer: 'D' }, false);
}

function esInterna(url) {
  const u = String(url || '');
  if (u === '' || u === 'about:blank') return false;
  return !/^https?:\/\//i.test(u);
}

function hostDe(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}

// contar=false para las notas de diagnostico de la Capa C: aparecen en el
// historial pero no inflan el contador de "emergentes neutralizadas", que mide
// otra cosa.
async function registrar(entrada, contar) {
  const data = await chrome.storage.local.get(['log', 'count']);
  const log = data.log || [];
  log.unshift(Object.assign({ ts: Date.now() }, entrada));
  if (log.length > MAX_LOG) log.length = MAX_LOG;
  if (contar === false) { await chrome.storage.local.set({ log }); return; }
  const count = (data.count || 0) + 1;
  await chrome.storage.local.set({ log, count });
  chrome.action.setBadgeText({ text: count > 999 ? '999+' : String(count) });
  chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
}

// Al recargar o actualizar la extension, los content scripts que ya estaban
// corriendo en las pestanas abiertas quedan huerfanos: siguen ahi, pero su
// chrome.runtime.id pasa a ser undefined y cualquier mensaje que manden lanza
// "Extension context invalidated". Desde fuera parece que la extension no hace
// nada, y solo vuelve en si al recargar la pestana a mano.
//
// Aqui se vuelven a inyectar solos. Cada archivo lleva su guarda para no
// duplicarse si la pestana ya tenia la version nueva.
const ARCHIVOS = {
  MAIN: ['src/blocker.js'],
  ISOLATED: ['src/bridge.js', 'src/siguiente.js']
};

async function reinyectar() {
  const cfg = await ajustes();
  let pestanas = [];
  try { pestanas = await chrome.tabs.query({}); } catch (e) { return; }
  for (const t of pestanas) {
    if (t.id === undefined || !vigilado(hostDe(t.url), cfg.sites)) continue;
    for (const mundo of ['MAIN', 'ISOLATED']) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: t.id, allFrames: true },   // tambien el iframe del reproductor
          files: ARCHIVOS[mundo],
          world: mundo,
          injectImmediately: true
        });
      } catch (e) { /* pestana descartada, sin permiso, o ya cerrada */ }
    }
  }
}

// Ajustes que aparecieron despues: si no estan, se ponen. El umbral se sube de
// 60 a 70 s (1:10) solo si seguia en el valor viejo por defecto — si tu lo
// habias cambiado a mano, se respeta.
async function alDia() {
  const data = await chrome.storage.local.get('settings');
  if (!data.settings) { await chrome.storage.local.set({ settings: DEFAULT_SETTINGS }); return; }
  const s = data.settings;
  let toco = false;
  if (s.nextThreshold === undefined || s.nextThreshold === 60) { s.nextThreshold = 70; toco = true; }
  if (s.nextHideAfter === undefined) { s.nextHideAfter = 20; toco = true; }
  if (s.serverAuto === undefined) { s.serverAuto = true; toco = true; }
  if (toco) await chrome.storage.local.set({ settings: s });
}

chrome.runtime.onInstalled.addListener(async () => {
  await alDia();
  reinyectar();
});

// Salto al episodio siguiente. Comprobamos el destino aqui y no solo en el
// content script: el mensaje llega desde el marco de un tercero (streamwish y
// compania), asi que se trata como no fiable. Solo se navega a un sitio de la
// lista vigilada, nunca a donde diga un anuncio.
async function irAlSiguiente(tabId, url, veniaEnPC) {
  let destino;
  try { destino = new URL(url); } catch (e) { return; }
  if (destino.protocol !== 'https:' && destino.protocol !== 'http:') return;

  const cfg = await ajustes();
  const rechazo = (por) => {
    if (cfg.nextDebug) registrar({ how: 'C · salto rechazado: ' + por, url: url, site: hostDe(url), layer: 'C' }, false);
  };
  if (!vigilado(destino.hostname, cfg.sites)) return rechazo('destino fuera de la lista');

  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch (e) { return rechazo('no encuentro la pestana'); }
  // Y ademas tiene que ser el MISMO dominio en el que ya estabas.
  if (normalizar(hostDe(tab.url)) !== normalizar(destino.hostname)) return rechazo('otro dominio');

  // La marca se pone ANTES de navegar: en cuanto la pagina nueva cargue, su
  // reproductor va a preguntar si tiene que ofrecerte la pantalla completa.
  if (veniaEnPC) pendientePC.set(tabId, Date.now() + PC_MS);

  try {
    await chrome.tabs.update(tabId, { url: destino.href });
  } catch (e) {
    pendientePC.delete(tabId);
    rechazo('la pestana no navego');
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'hit') {
    registrar({
      how: msg.how,
      url: msg.url,
      site: hostDe(msg.from) || hostDe(sender.url),
      layer: 'A'
    });
  } else if (msg.type === 'grace' && sender.tab) {
    gracia.set(sender.tab.id, Date.now() + GRACIA_MS);
  } else if (msg.type === 'reset-badge') {
    chrome.action.setBadgeText({ text: '' });
  } else if (msg.type === 'pc-consultar' && sender.tab) {
    const hasta = pendientePC.get(sender.tab.id) || 0;
    sendResponse({ pendiente: hasta > Date.now() });
    return false;
  } else if (msg.type === 'video' && sender.tab) {
    // Cualquier marco de la pestana puede avisar. Basta con que uno diga que
    // esta sonando para dar la pestana por "viendo anime".
    const previo = estadoVideo.get(sender.tab.id);
    if (msg.playing || !previo || previo.playing !== true ||
        (Date.now() - previo.ts) > VIDEO_FRESCO_MS) {
      estadoVideo.set(sender.tab.id, { playing: !!msg.playing, ts: Date.now() });
    }
  } else if (msg.type === 'estado-video' && sender.tab === undefined) {
    sendResponse({ playing: videoSonando(msg.tabId) });
    return false;
  } else if (msg.type === 'pc-listo' && sender.tab) {
    pendientePC.delete(sender.tab.id);
  } else if (msg.type === 'diag') {
    registrar({ how: msg.how, url: msg.url, site: hostDe(sender.url), layer: 'C' }, false);
  } else if (msg.type === 'siguiente-pregunta' && sender.tab) {
    // El iframe del reproductor no puede leer la pagina de arriba (otro
    // dominio). Le preguntamos nosotros al marco 0 y le devolvemos la
    // respuesta. Hay que devolver true para poder responder mas tarde.
    chrome.tabs.sendMessage(sender.tab.id, { type: 'siguiente-calcula' }, { frameId: 0 },
      (r) => sendResponse(chrome.runtime.lastError ? null : r));
    return true;
  } else if (msg.type === 'siguiente-ir' && sender.tab && msg.url) {
    // Navegar la pestana entera: desde el iframe no se puede tocar
    // top.location, y un window.open lo mataria nuestra propia Capa A.
    irAlSiguiente(sender.tab.id, msg.url, !!msg.pc);
  }
  sendResponse && sendResponse({ ok: true });
  return false;
});

chrome.tabs.onCreated.addListener(async (tab) => {
  const openerId = tab.openerTabId;
  if (openerId === undefined) return;

  const cfg = await ajustes();
  if (!cfg.enabled || (cfg.pausedUntil || 0) > Date.now()) return;

  let opener;
  try { opener = await chrome.tabs.get(openerId); } catch (e) { return; }
  const openerHost = hostDe(opener.url || opener.pendingUrl);
  if (!vigilado(openerHost, cfg.sites)) return;

  // El usuario la pidio con ctrl / cmd / boton central: se respeta.
  const hasta = gracia.get(openerId) || 0;
  if (hasta > Date.now()) { gracia.delete(openerId); return; }

  const destino = tab.pendingUrl || tab.url || '';
  if (esInterna(destino)) return;
  const destinoHost = hostDe(destino);

  // Variante en que el contenido real se muda a la pestana nueva y el anuncio
  // se queda en la vieja: si es el mismo dominio, no la tocamos.
  if (destinoHost && normalizar(destinoHost) === normalizar(openerHost)) return;

  const espera = cfg.mode === 'apoyo' ? Math.max(1, cfg.supportSeconds || 4) * 1000 : 0;

  enObservacion.set(tab.id, { openerHost, url: destino });

  // Solo devolvemos el foco si la emergente lo robo de verdad (abrio delante).
  // Si abrio al fondo, o si tu ya estabas en otra pestana, no te movemos: ese
  // tiron era justo lo que impedia salirse del anime a mirar otra cosa.
  //
  // Y con "solo con video" puesto, mientras el episodio no este sonando no
  // tocamos el foco en absoluto: antes de darle al play eres libre de navegar.
  const roboElFoco = tab.active === true;
  const sonando = videoSonando(openerId);
  const tocaDevolver = cfg.focoSoloConVideo === false || sonando;

  diag(cfg, 'emergente de ' + openerHost +
       ' | abrio ' + (roboElFoco ? 'DELANTE' : 'al fondo') +
       ' | video ' + (sonando ? 'sonando' : 'parado') +
       ' | ' + (roboElFoco && tocaDevolver ? 'devuelvo el foco' : 'NO toco el foco'), destino);

  if (roboElFoco && tocaDevolver) {
    // Ojo: la ventana que importa es la del ANIME, no la de la emergente. Si el
    // anuncio abre una ventana nueva, su historial esta vacio y caiamos al
    // openerId, o sea te arrastrabamos al anime aunque te hubieras movido.
    const ventanaTuya = opener.windowId !== undefined ? opener.windowId : tab.windowId;
    const destinoFoco = aDondeVolver(ventanaTuya, tab.id, openerId);
    nuestroCambio = true;
    try { await chrome.tabs.update(destinoFoco, { active: true }); } catch (e) {}
    diag(cfg, 'foco devuelto a la pestana ' + destinoFoco +
         (destinoFoco === openerId ? ' (el anime; no tenia historial tuyo)' : ' (donde estabas tu)'));
    setTimeout(() => { nuestroCambio = false; }, 400);
  }

  setTimeout(async () => {
    const info = enObservacion.get(tab.id) || {};
    let urlFinal = info.url || destino;
    try {
      const actual = await chrome.tabs.get(tab.id);
      urlFinal = actual.url || actual.pendingUrl || urlFinal;
    } catch (e) {}
    enObservacion.delete(tab.id);
    // Se vuelve a mirar: en el rato de espera puede haber acabado en una
    // pagina interna, y esas no se cierran nunca.
    if (esInterna(urlFinal)) return;
    try { await chrome.tabs.remove(tab.id); } catch (e) {}
    registrar({
      how: cfg.mode === 'apoyo' ? 'pestana cargada ' + (espera / 1000) + 's y cerrada' : 'pestana cerrada',
      url: urlFinal,
      site: openerHost,
      layer: 'B'
    });
  }, espera);
});

// Guardamos la URL definitiva de la pestana emergente (suele redirigir varias
// veces antes de aterrizar en el anunciante).
chrome.webNavigation.onCommitted.addListener(async (det) => {
  if (det.frameId !== 0) return;

  const info = enObservacion.get(det.tabId);
  if (info) { info.url = det.url; return; }

  if (esInterna(det.url)) { ultimoRescate.delete(det.tabId); return; }

  const host = hostDe(det.url);
  const cfg = await ajustes();

  // La pestana sigue en un sitio vigilado: la anotamos como ultimo buen sitio.
  if (vigilado(host, cfg.sites)) {
    ultimaBuena.set(det.tabId, det.url);
    return;
  }

  // Variante en que el anuncio se lleva la pestana actual en vez de abrir una
  // nueva: la red hace location.href = anuncio sobre la ventana del anime.
  if (!cfg.enabled || cfg.revertRedirect === false) return;
  if ((cfg.pausedUntil || 0) > Date.now()) return;

  const anterior = ultimaBuena.get(det.tabId);
  if (!anterior) return;

  // Solo si lo movio un script, no si tu pinchaste un enlace.
  const porScript = (det.transitionQualifiers || []).includes('client_redirect');
  if (!porScript) { ultimaBuena.delete(det.tabId); return; }

  // Un solo rescate cada 5 s, para no entrar en un bucle con el sitio.
  const ultimo = ultimoRescate.get(det.tabId) || 0;
  if (Date.now() - ultimo < 5000) return;
  ultimoRescate.set(det.tabId, Date.now());

  try { await chrome.tabs.update(det.tabId, { url: anterior }); } catch (e) { return; }
  registrar({ how: 'secuestro de pestana revertido', url: det.url, site: hostDe(anterior), layer: 'B' });
});

// Memoria de a que pestana te cambias TU. Es lo que nos permite devolverte a
// donde estabas en vez de arrastrarte de vuelta al anime.
chrome.tabs.onActivated.addListener((info) => {
  if (nuestroCambio) return;
  if (enObservacion.has(info.tabId)) return;   // es la emergente, no cuenta
  const hist = historialFoco.get(info.windowId) || [];
  const limpio = hist.filter((id) => id !== info.tabId);
  limpio.unshift(info.tabId);
  if (limpio.length > 4) limpio.length = 4;
  historialFoco.set(info.windowId, limpio);
});

chrome.windows.onRemoved.addListener((windowId) => {
  historialFoco.delete(windowId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  estadoVideo.delete(tabId);
  for (const [win, hist] of historialFoco) {
    const limpio = hist.filter((id) => id !== tabId);
    if (limpio.length) historialFoco.set(win, limpio);
    else historialFoco.delete(win);
  }
  gracia.delete(tabId);
  enObservacion.delete(tabId);
  ultimaBuena.delete(tabId);
  ultimoRescate.delete(tabId);
  pendientePC.delete(tabId);
});
