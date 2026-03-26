/**
 * HanuAI Attendance System – Service Worker
 * Handles Web Push notifications for check-in / check-out reminders.
 */

const CACHE_NAME = 'hanuai-sw-v1';

// ── Install & Activate ──────────────────────────────────────────────────────
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// ── Push Event ───────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'HanuAI Attendance', body: 'You have an attendance reminder.' };

  if (event.data) {
    try {
      data = JSON.parse(event.data.text());
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || '',
    icon: data.icon || '/static/assets/icon-192.png',
    badge: '/static/assets/badge-72.png',
    tag: 'attendance-reminder',          // collapses duplicate notifications
    renotify: true,
    requireInteraction: true,            // stays visible until dismissed
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: '📋 Open App' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── Notification Click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing open tab if found
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
