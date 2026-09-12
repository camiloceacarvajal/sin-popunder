// Banco de la Capa B: comprueba a quien se le devuelve el foco cuando salta una
// emergente. Carga el service worker de verdad con un `chrome` simulado.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/background.js', 'utf8');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function montar(ajustes) {
  const L = {};                       // listeners registrados
  const reg = (n) => ({ addListener: (f) => { (L[n] = L[n] || []).push(f); } });
  const acciones = [];                // lo que la extension le hizo al navegador
  const tabs = new Map();
  const chrome = {
    runtime: { onMessage: reg('msg'), onInstalled: reg('inst'), lastError: null,
               sendMessage: () => {} },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    scripting: { executeScript: async () => {} },
    storage: { local: {
      async get(k) { return { settings: ajustes, log: [], count: 0 }; },
      async set() {} } },
    windows: { onRemoved: reg('winrm'), update: async () => {} },
    webNavigation: { onCommitted: reg('nav') },
    tabs: {
      onCreated: reg('created'), onActivated: reg('activated'), onRemoved: reg('removed'),
      async get(id) { if (!tabs.has(id)) throw new Error('no tab'); return tabs.get(id); },
      async query() { return []; },
      async update(id, p) { acciones.push('foco->' + id); if (p && p.active) {
        for (const t of tabs.values()) t.active = false;
        if (tabs.get(id)) tabs.get(id).active = true;
        (L.activated || []).forEach((f) => f({ tabId: id, windowId: 1 })); } },
      async remove(id) { acciones.push('cierra->' + id); tabs.delete(id); },
      sendMessage: () => {}
    }
  };
  new Function('chrome', 'setTimeout', 'clearTimeout', src)(chrome, setTimeout, clearTimeout);
  return { L, acciones, tabs,
    activar: (id) => (L.activated || []).forEach((f) => f({ tabId: id, windowId: 1 })),
    video: (tabId, playing) => (L.msg || []).forEach((f) =>
      f({ type: 'video', playing }, { tab: { id: tabId } }, () => {})),
    crear: (tab) => (L.created || []).forEach((f) => f(tab)) };
}

const BASE = { enabled: true, mode: 'silencioso', focoSoloConVideo: true,
               sites: ['jkanime.net'], pausedUntil: 0 };
const ANIME = { id: 1, windowId: 1, active: true, url: 'https://jkanime.net/serie/6/' };
const OTRA  = { id: 2, windowId: 1, active: false, url: 'https://es.wikipedia.org/' };
const POP   = { id: 99, windowId: 1, active: true, openerTabId: 1,
                pendingUrl: 'https://anuncio.example.com/pop' };

let fallos = 0;
function check(nombre, cond, extra) {
  console.log((cond ? 'PASA  ' : 'FALLA ') + nombre + (cond ? '' : '   -> ' + extra));
  if (!cond) fallos++;
}

(async () => {
  // A) Estas en el anime, viendo. La emergente te roba el foco: te devuelve al anime.
  {
    const m = montar({ ...BASE });
    m.tabs.set(1, { ...ANIME }); m.tabs.set(2, { ...OTRA });
    m.activar(1); m.video(1, true);
    m.crear({ ...POP }); await dormir(60);
    check('A· viendo el anime -> te devuelve al anime',
      m.acciones.includes('foco->1') && m.acciones.includes('cierra->99'), m.acciones.join());
  }
  // B) Te fuiste a otra pestana. La emergente NO debe arrastrarte de vuelta.
  {
    const m = montar({ ...BASE });
    m.tabs.set(1, { ...ANIME, active: false }); m.tabs.set(2, { ...OTRA, active: true });
    m.activar(1); m.activar(2); m.video(1, true);
    m.crear({ ...POP }); await dormir(60);
    check('B· te habias ido a otra pestana -> te deja donde estabas',
      m.acciones.includes('foco->2') && !m.acciones.includes('foco->1'), m.acciones.join());
  }
  // C) El video aun no arranca: no se toca el foco en absoluto.
  {
    const m = montar({ ...BASE });
    m.tabs.set(1, { ...ANIME }); m.activar(1);
    m.crear({ ...POP }); await dormir(60);
    check('C· sin darle al play -> no te mueve, pero cierra la emergente',
      !m.acciones.some((a) => a.startsWith('foco->')) && m.acciones.includes('cierra->99'),
      m.acciones.join());
  }
  // D) La emergente abre al fondo: no robo nada, no hay nada que devolver.
  {
    const m = montar({ ...BASE });
    m.tabs.set(1, { ...ANIME }); m.activar(1); m.video(1, true);
    m.crear({ ...POP, active: false }); await dormir(60);
    check('D· emergente al fondo -> no toca el foco',
      !m.acciones.some((a) => a.startsWith('foco->')) && m.acciones.includes('cierra->99'),
      m.acciones.join());
  }
  // E) Con el ajuste apagado vuelve el comportamiento de antes.
  {
    const m = montar({ ...BASE, focoSoloConVideo: false });
    m.tabs.set(1, { ...ANIME }); m.activar(1);
    m.crear({ ...POP }); await dormir(60);
    check('E· ajuste apagado y sin video -> si devuelve el foco',
      m.acciones.includes('foco->1'), m.acciones.join());
  }
  // F) El video caduca: 25 s sin latido ya no cuenta como "viendo".
  {
    const m = montar({ ...BASE });
    m.tabs.set(1, { ...ANIME }); m.activar(1); m.video(1, true);
    const real = Date.now; Date.now = () => real() + 25000;
    m.crear({ ...POP }); await dormir(60); Date.now = real;
    check('F· 25 s sin latido -> deja de contar como viendo',
      !m.acciones.some((a) => a.startsWith('foco->')), m.acciones.join());
  }
  // B2) Igual que B, pero la emergente abre en una VENTANA nueva. El historial
  //     hay que buscarlo en la ventana del anime, no en la de la emergente.
  {
    const m = montar({ ...BASE });
    m.tabs.set(1, { ...ANIME, active: false }); m.tabs.set(2, { ...OTRA, active: true });
    m.activar(1); m.activar(2); m.video(1, true);
    m.crear({ ...POP, windowId: 7 }); await dormir(60);
    check('B2· emergente en ventana nueva -> te deja donde estabas',
      m.acciones.includes('foco->2') && !m.acciones.includes('foco->1'), m.acciones.join());
  }
  // G) Paginas internas del navegador: NUNCA se tocan. Si se cierran, no puedes
  //    ni llegar a brave://extensions para apagar la extension.
  for (const interna of ['brave://extensions/', 'chrome://extensions/',
                         'about:preferences', 'file:///home/x/nota.txt']) {
    const m = montar({ ...BASE });
    m.tabs.set(1, { ...ANIME }); m.activar(1); m.video(1, true);
    m.crear({ ...POP, pendingUrl: interna }); await dormir(60);
    check('G· no cierra ' + interna, !m.acciones.includes('cierra->99'), m.acciones.join());
  }
  // H) Control: un anuncio http de verdad si se cierra. Sin esto, G pasaria
  //    solo con desactivar el cierre entero.
  {
    const m = montar({ ...BASE });
    m.tabs.set(1, { ...ANIME }); m.activar(1); m.video(1, true);
    m.crear({ ...POP }); await dormir(60);
    check('H· CONTROL: el anuncio http si se cierra',
      m.acciones.includes('cierra->99'), m.acciones.join());
  }
  console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo pasa');
  process.exit(fallos ? 1 : 0);
})();
