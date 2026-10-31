// Mantenimiento Mediese - service worker "limpiador" (v104)
// La app ya no usa caché offline. Si algún celular o PC tiene un service worker
// viejo guardando archivos antiguos, este lo borra, se da de baja y recarga la app.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clientes = await self.clients.matchAll({ type: "window" });
    clientes.forEach((c) => c.navigate(c.url));
  })());
});

// Sin caché: todo va directo a la red
self.addEventListener("fetch", () => {});
