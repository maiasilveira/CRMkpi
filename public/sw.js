'use strict';
// Service worker: guarda a "casca" do app para abrir rápido e funcionar como app instalado.
// As chamadas de API nunca são armazenadas em cache (dados sempre atuais e privados).
const VERSAO = 'kpi-v3';
const CASCA = ['/', '/index.html', '/styles.css', '/manifest.webmanifest', '/icon.svg',
  '/js/base.js', '/js/componentes.js', '/js/v-inicio.js', '/js/v-indicadores.js', '/js/v-planos.js', '/js/v-metas.js', '/js/v-governanca.js', '/js/v-admin.js', '/js/main.js'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Rede primeiro (sempre a versão mais nova); cache só como reserva offline
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))));
});
