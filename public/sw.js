// Service worker minimal Werewolf: hanya untuk menampilkan notifikasi "Giliranmu" dan membuka aplikasi
// saat notifikasi diketuk. Sengaja TIDAK ada handler fetch dan tidak ada cache, jadi halaman selalu
// diambil dari jaringan dan versi baru langsung terpakai.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const scope = self.registration.scope;
  const tujuan = (e.notification.data && e.notification.data.url) || scope;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((daftar) => {
      const ada = daftar.find((c) => c.url.startsWith(scope));
      if (ada) return ada.focus();
      return self.clients.openWindow(tujuan);
    }),
  );
});
