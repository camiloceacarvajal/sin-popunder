// Capa A (puente): mundo aislado. Decide si esta pestana/iframe esta en la
// lista de sitios vigilados y se lo comunica a blocker.js, que vive en MAIN.
(() => {
  'use strict';

  // Ver la misma guarda en siguiente.js: al recargar la extension se reinyecta
  // en las pestanas ya abiertas y no queremos dos copias escuchando.
  if (window.__sinpopBridgeCargado) return;
  window.__sinpopBridgeCargado = true;

  const EVT_TO_PAGE = '__sinpop_cfg';
  const EVT_FROM_PAGE = '__sinpop_hit';

  function hostDeLaCima() {
    // Un iframe del reproductor tiene otro dominio que la pagina de anime.
    // ancestorOrigins nos deja saber quien es el top aunque sea cross-origin.
    try {
      const anc = location.ancestorOrigins;
      if (anc && anc.length) return new URL(anc[anc.length - 1]).hostname;
    } catch (e) {}
    try { if (window.top === window.self) return location.hostname; } catch (e) {}
    try { return new URL(document.referrer).hostname; } catch (e) {}
    return location.hostname;
  }

  function coincide(host, sitios) {
    host = String(host || '').toLowerCase().replace(/^www\./, '');
    return sitios.some((s) => {
      s = String(s).toLowerCase().replace(/^www\./, '').trim();
      return s && (host === s || host.endsWith('.' + s));
    });
  }

  function enviarConfig(cfg) {
    try {
      window.dispatchEvent(new CustomEvent(EVT_TO_PAGE, { detail: JSON.stringify(cfg) }));
    } catch (e) {}
  }

  function evaluar(ajustes) {
    const sitios = ajustes.sites || [];
    const pausado = (ajustes.pausedUntil || 0) > Date.now();
    const enLista = coincide(location.hostname, sitios) || coincide(hostDeLaCima(), sitios);
    const activo = !!ajustes.enabled && !pausado && enLista;
    enviarConfig({
      active: activo,
      mode: ajustes.mode || 'silencioso',
      forwardClick: ajustes.forwardClick !== false
    });
    return activo;
  }

  let activoAqui = false;

  chrome.storage.local.get('settings', (data) => {
    const s = (data && data.settings) || {};
    activoAqui = evaluar(s);
  });

  chrome.storage.onChanged.addListener((cambios, area) => {
    if (area !== 'local' || !cambios.settings) return;
    activoAqui = evaluar(cambios.settings.newValue || {});
  });

  // Reportes que llegan del mundo MAIN.
  window.addEventListener(EVT_FROM_PAGE, (ev) => {
    let d;
    try { d = JSON.parse(ev.detail); } catch (e) { return; }
    try {
      chrome.runtime.sendMessage({
        type: 'hit',
        how: d.how,
        url: d.url,
        from: location.href
      });
    } catch (e) {}
  }, true);

  // Cuando el usuario abre una pestana a proposito (ctrl / cmd / boton central)
  // le avisamos al fondo para que no la cierre.
  function intencion(ev) {
    if (!activoAqui || !ev.isTrusted) return;
    if (!(ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button === 1)) return;
    try { chrome.runtime.sendMessage({ type: 'grace' }); } catch (e) {}
  }
  document.addEventListener('click', intencion, true);
  document.addEventListener('auxclick', intencion, true);

  // ---- estado del reproductor ----------------------------------------------
  // Le contamos al fondo si en este marco hay video sonando. Sirve para que la
  // Capa B no te arrastre de vuelta al anime cuando aun no le has dado al play.
  // Los eventos de <video> no burbujean, por eso se escucha en fase de captura.
  let ultimoSi = 0;
  let latido = 0;

  function avisar(reproduciendo) {
    // El "si" se repite cada 5 s como latido; lo estrangulamos. El "no" es un
    // cambio de estado y sale siempre.
    if (reproduciendo) {
      const ahora = Date.now();
      if (ahora - ultimoSi < 4000) return;
      ultimoSi = ahora;
    }
    try { chrome.runtime.sendMessage({ type: 'video', playing: reproduciendo }); } catch (e) {}
  }

  function sonando() {
    const medios = Array.from(document.querySelectorAll('video, audio'));
    return medios.some((v) => !v.paused && !v.ended && v.readyState >= 3 && v.currentTime > 0);
  }

  function pararLatido() {
    if (latido) { clearInterval(latido); latido = 0; }
  }

  function alArrancar() {
    if (!activoAqui) return;
    avisar(true);
    if (latido) return;
    latido = setInterval(() => {
      if (!activoAqui) { pararLatido(); return; }
      if (sonando()) avisar(true);
      else { pararLatido(); avisar(false); }
    }, 5000);
  }

  function alParar() {
    if (!activoAqui) return;
    // Puede haber mas de un <video> en el marco: solo es "parado" si ninguno suena.
    if (sonando()) return;
    pararLatido();
    avisar(false);
  }

  ['play', 'playing'].forEach((ev) => document.addEventListener(ev, alArrancar, true));
  ['pause', 'ended', 'emptied', 'abort'].forEach((ev) => document.addEventListener(ev, alParar, true));

  // Si te vas de la pestana con el video en marcha, el estado sigue siendo
  // "reproduciendo": no queremos que el simple hecho de mirar otra cosa cuente
  // como pausa.
  window.addEventListener('pagehide', () => { pararLatido(); }, true);
})();
