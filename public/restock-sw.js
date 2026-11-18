/* TRAIT back-in-stock alerts: shows the "{product} is back" push and opens the product on tap. Same-origin links only. */
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === "string" ? data.title.slice(0, 120) : "Back in stock at TRAIT";
  const body = typeof data.body === "string" ? data.body.slice(0, 200) : "Tap to order.";
  event.waitUntil(self.registration.showNotification(title, { body, icon: "/trait-logo.jpeg", badge: "/trait-logo.jpeg", tag: typeof data.tag === "string" ? data.tag : "restock", data: { url: typeof data.url === "string" ? data.url : "/" } }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  let url = new URL("/", self.location.origin);
  try { const target = new URL(event.notification.data && event.notification.data.url || "/", self.location.origin); if (target.origin === self.location.origin) url = target; } catch { /* keep the homepage */ }
  event.waitUntil(self.clients.openWindow(url.href));
});
