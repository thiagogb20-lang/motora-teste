/* Service worker do Motora Teste.
   IMPORTANTE: mude VERSAO a cada publicação (motora-teste-v4, motora-teste-v5...) para os celulares baixarem a versão nova.
   - Navegação / index.html: rede primeiro (pega atualização), cai no cache se estiver offline.
   - Demais arquivos do próprio site: cache primeiro.
   - Biblioteca supabase-js do jsDelivr: cache primeiro (é um arquivo fixo).
   - NUNCA guarda nem intercepta o Supabase (*.supabase.co), Gemini, Groq ou qualquer outro domínio. */
const VERSAO = 'motora-teste-v4';
const ARQUIVOS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const NUNCA = /(^|\.)supabase\.co$|(^|\.)googleapis\.com$|(^|\.)groq\.com$/;

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
  if (resp && resp.ok && (resp.type === 'basic' || resp.type === 'cors')) {
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
  if (NUNCA.test(url.hostname)) return;
  const ehCdn = url.href === LIB;
  if (url.origin !== self.location.origin && !ehCdn) return;

  if (!ehCdn && ehPagina(req, url)) {
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
