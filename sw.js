/* Service worker do Campos.
   IMPORTANTE: mude VERSAO a cada publicação (campos-v3, campos-v4...) para os celulares baixarem a versão nova.
   - Navegação / index.html: rede primeiro (pega atualização), cai no cache se estiver offline.
   - Demais arquivos do próprio site: cache primeiro.
   - Nunca intercepta outros domínios (IA, Evolution, wa.me). */
const VERSAO = 'campos-v2';
const ARQUIVOS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function guarda(req, resp) {
  if (resp && resp.ok && resp.type === 'basic') {
    const copia = resp.clone();
    caches.open(VERSAO).then((c) => c.put(req, copia)).catch(() => {});
  }
  return resp;
}

function ehPagina(req, url) {
  return req.mode === 'navigate' || /\/$|\/index\.html$/.test(url.pathname);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (ehPagina(req, url)) {
    // rede primeiro
    e.respondWith(
      fetch(req).then((resp) => guarda(req, resp)).catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then((r) => r || caches.match('./index.html'))
          .then((r) => r || Response.error())
      )
    );
    return;
  }
  // cache primeiro
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((emCache) =>
      emCache || fetch(req).then((resp) => guarda(req, resp)).catch(() => Response.error())
    )
  );
});
