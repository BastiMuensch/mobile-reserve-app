self.addEventListener('install', function (event) {
  // Activate a new service worker immediately instead of waiting for all tabs to close - for a
  // homescreen PWA that's opened full-screen (no browser chrome/reload button), tabs are
  // effectively never all closed, so without this an update would practically never take effect.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', function (event) {
  // Take control of already-open clients right away, rather than only on their next navigation.
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', function (event) {
  if (event.data) {
    const options = {
      body: 'Es gibt eine neue Information zu Ihrem Einsatzplan. Bitte öffnen Sie die App.',
      icon: '/logo_transparent.png',
      badge: '/logo_transparent.png',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: '2'
      }
    }
    event.waitUntil(Promise.all([
      self.registration.showNotification('MobileReserve.digital', options),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        for (const client of clients) client.postMessage({ type: 'app-refresh' })
      })
    ]))
  }
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      // Focus an already-open app window instead of always opening a new one.
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'app-refresh' })
          return client.focus()
        }
      }
      return self.clients.openWindow('/')
    })
  )
})
