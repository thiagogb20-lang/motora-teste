/* Service worker do Firebase Cloud Messaging (Web Push) — recebe a corrida no iPhone (PWA na
 * Tela de Início, iOS 16.4+) e em navegadores, mesmo com o app em 2º plano/fechado.
 * Config pública do app Web do Firebase (projeto executivo-gyn-avisos). */
importScripts('https://www.gstatic.com/firebasejs/11.1.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDuhkPX-Qd1_st-z4NknWQFz8LERgPRUpM',
  authDomain: 'executivo-gyn-avisos.firebaseapp.com',
  projectId: 'executivo-gyn-avisos',
  storageBucket: 'executivo-gyn-avisos.firebasestorage.app',
  messagingSenderId: '413100869880',
  appId: '1:413100869880:web:7587a7ece6bacdedd7130d',
});

var BASE = '/motora-teste/executivo/motorista/';
var messaging = firebase.messaging();

// Mensagem só de dados: o próprio service worker mostra a notificação (obrigatório no iOS).
messaging.onBackgroundMessage(function (payload) {
  var d = payload.data || {};
  self.registration.showNotification(d.titulo || 'Executivo GYN', {
    body: d.corpo || '',
    icon: BASE + 'icone-192.png',
    badge: BASE + 'icone-192.png',
    tag: d.corrida_id || d.tipo || 'aviso',
    renotify: true,
    requireInteraction: d.tipo === 'nova_corrida',
    data: { url: BASE + (d.corrida_id ? ('?corrida=' + d.corrida_id) : '') },
  });
});

// Tocar na notificação abre/foca o app.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || BASE;
  event.waitUntil((async function () {
    var abertas = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (var i = 0; i < abertas.length; i++) {
      if (abertas[i].url.indexOf(BASE) !== -1 && 'focus' in abertas[i]) return abertas[i].focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
