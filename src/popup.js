const DEFAULTS = {
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
  sites: [],
  pausedUntil: 0
};

const $ = (id) => document.getElementById(id);
let cfg = Object.assign({}, DEFAULTS);

async function cargar() {
  const data = await chrome.storage.local.get(['settings', 'log', 'count']);
  cfg = Object.assign({}, DEFAULTS, data.settings || {});
  pintar(data.log || [], data.count || 0);
}

async function guardar() {
  await chrome.storage.local.set({ settings: cfg });
}

function pintar(log, count) {
  $('count').textContent = count;
  $('enabled').checked = !!cfg.enabled;
  $('forwardClick').checked = cfg.forwardClick !== false;
  $('revertRedirect').checked = cfg.revertRedirect !== false;
  $('focoSoloConVideo').checked = cfg.focoSoloConVideo !== false;
  $('diagnostico').checked = cfg.diagnostico !== false;
  $('supportSeconds').value = cfg.supportSeconds || 4;
  $('nextEpisode').checked = cfg.nextEpisode !== false;
  $('nextAutoplay').checked = !!cfg.nextAutoplay;
  $('nextThreshold').value = cfg.nextThreshold || 60;
  $('nextCountdown').value = cfg.nextCountdown || 10;
  $('nextDebug').checked = !!cfg.nextDebug;
  $('serverAuto').checked = cfg.serverAuto !== false;
  $('nextHideAfter').value = cfg.nextHideAfter === undefined ? 20 : cfg.nextHideAfter;
  const conAviso = cfg.nextEpisode !== false;
  $('wrapUmbral').style.display = conAviso ? 'flex' : 'none';
  $('wrapDura').style.display = conAviso ? 'flex' : 'none';
  $('wrapAuto').style.display = conAviso ? 'flex' : 'none';
  $('wrapCuenta').style.display = conAviso && cfg.nextAutoplay ? 'flex' : 'none';
  document.querySelectorAll('input[name=mode]').forEach((r) => {
    r.checked = r.value === cfg.mode;
  });
  $('wrapSecs').style.display = cfg.mode === 'apoyo' ? 'flex' : 'none';

  const pausa = (cfg.pausedUntil || 0) - Date.now();
  $('pause').textContent = pausa > 0
    ? 'En pausa ' + Math.ceil(pausa / 60000) + ' min (reanudar)'
    : 'Pausar 5 minutos';

  const ul = $('sites');
  ul.innerHTML = '';
  if (!cfg.sites.length) {
    ul.innerHTML = '<li class="empty">Ningun sitio en la lista.</li>';
  }
  cfg.sites.forEach((s, i) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = s;
    const del = document.createElement('button');
    del.textContent = '×';
    del.title = 'Quitar';
    del.addEventListener('click', async () => {
      cfg.sites.splice(i, 1);
      await guardar();
      cargar();
    });
    li.append(span, del);
    ul.appendChild(li);
  });

  const lg = $('log');
  lg.innerHTML = '';
  if (!log.length) {
    lg.innerHTML = '<li class="empty">Todavia nada.</li>';
  }
  log.slice(0, 40).forEach((e) => {
    const li = document.createElement('li');
    const how = document.createElement('div');
    how.className = 'how';
    const hora = new Date(e.ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    how.textContent = hora + '  ·  ' + (e.site || '?') + '  ·  ' + e.how;
    const url = document.createElement('div');
    url.className = 'url';
    url.textContent = e.url || '(sin url)';
    li.append(how, url);
    lg.appendChild(li);
  });
}

async function anadirSitio(host) {
  host = String(host || '').trim().toLowerCase().replace(/^https?:\/\//, '')
    .replace(/^www\./, '').split('/')[0];
  if (!host || cfg.sites.includes(host)) return;
  cfg.sites.push(host);
  await guardar();
  cargar();
}

$('enabled').addEventListener('change', async (e) => {
  cfg.enabled = e.target.checked;
  await guardar();
});

document.querySelectorAll('input[name=mode]').forEach((r) => {
  r.addEventListener('change', async () => {
    cfg.mode = r.value;
    await guardar();
    cargar();
  });
});

$('supportSeconds').addEventListener('change', async (e) => {
  cfg.supportSeconds = Math.min(30, Math.max(1, parseInt(e.target.value, 10) || 4));
  await guardar();
});

$('forwardClick').addEventListener('change', async (e) => {
  cfg.forwardClick = e.target.checked;
  await guardar();
});

$('diagnostico').addEventListener('change', async (e) => {
  cfg.diagnostico = e.target.checked;
  await guardar();
});

$('focoSoloConVideo').addEventListener('change', async (e) => {
  cfg.focoSoloConVideo = e.target.checked;
  await guardar();
});

// Estado en vivo del reproductor de la pestana que estas mirando.
async function pintarEstadoVideo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) return;
  chrome.runtime.sendMessage({ type: 'estado-video', tabId: tab.id }, (r) => {
    if (chrome.runtime.lastError || !r) { $('estadoVideo').textContent = 'sin datos'; return; }
    $('estadoVideo').textContent = r.playing ? 'viendo anime' : 'sin reproducir';
  });
}
pintarEstadoVideo();

$('revertRedirect').addEventListener('change', async (e) => {
  cfg.revertRedirect = e.target.checked;
  await guardar();
});

$('nextEpisode').addEventListener('change', async (e) => {
  cfg.nextEpisode = e.target.checked;
  await guardar();
  cargar();
});

$('nextAutoplay').addEventListener('change', async (e) => {
  cfg.nextAutoplay = e.target.checked;
  await guardar();
  cargar();
});

$('nextThreshold').addEventListener('change', async (e) => {
  cfg.nextThreshold = Math.min(600, Math.max(5, parseInt(e.target.value, 10) || 60));
  await guardar();
  cargar();
});

$('nextCountdown').addEventListener('change', async (e) => {
  cfg.nextCountdown = Math.min(60, Math.max(3, parseInt(e.target.value, 10) || 10));
  await guardar();
  cargar();
});

$('nextHideAfter').addEventListener('change', async (e) => {
  const v = parseInt(e.target.value, 10);
  cfg.nextHideAfter = Math.min(300, Math.max(0, isNaN(v) ? 20 : v));
  await guardar();
  cargar();
});

$('serverAuto').addEventListener('change', async (e) => {
  cfg.serverAuto = e.target.checked;
  await guardar();
});

$('nextDebug').addEventListener('change', async (e) => {
  cfg.nextDebug = e.target.checked;
  await guardar();
});

$('pause').addEventListener('click', async () => {
  cfg.pausedUntil = (cfg.pausedUntil || 0) > Date.now() ? 0 : Date.now() + 5 * 60 * 1000;
  await guardar();
  cargar();
});

$('addSite').addEventListener('click', () => anadirSitio($('newSite').value));
$('newSite').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') anadirSitio($('newSite').value);
});

$('addCurrent').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;
  try { anadirSitio(new URL(tab.url).hostname); } catch (e) {}
});

$('clear').addEventListener('click', async () => {
  await chrome.storage.local.set({ log: [], count: 0 });
  chrome.runtime.sendMessage({ type: 'reset-badge' });
  cargar();
});

cargar();
