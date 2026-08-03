// Firebase Cloud Messaging (FCM) Background Service Worker
// Required for browser background push notifications.
// Place this file in the public root folder of your web server (e.g., /public/firebase-messaging-sw.js)

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Initialize the Firebase app in the service worker
// Replace these with your actual Firebase project config keys
firebase.initializeApp({
  apiKey: "AIzaSyBbZaXf59BXG1bQ1n6-Hu2yUhly-VYINXY",
  authDomain: "bcmfoodhub.firebaseapp.com",
  projectId: "bcmfoodhub",
  storageBucket: "bcmfoodhub.appspot.com",
  messagingSenderId: "560151898749",
  appId: "1:560151898749:web:48be385ca3d6bca5df14"
});

// Retrieve an instance of Firebase Messaging
const messaging = firebase.messaging();

// Handle background notifications
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Background message received:', payload);

  const notificationTitle = payload.notification.title || 'BCM FoodHub Update';
  const notificationOptions = {
    body: payload.notification.body || 'You have a new update.',
    icon: '/bcm-foodhub-logo-icon.png', // path to your icon
    badge: '/bcm-foodhub-logo-icon.png',
    data: payload.data || {}
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click action (e.g., open order details view)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.link || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If a window is already open, focus it and redirect
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.indexOf(self.location.origin) !== -1 && 'focus' in client) {
          return client.focus().then(() => {
            if ('navigate' in client) {
              return client.navigate(targetUrl);
            }
          });
        }
      }
      // Otherwise, open a new browser window/tab
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
