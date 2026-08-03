import re

print("--- Starting Detailed Firebase Integration ---")

index_path = "customer-app/index.html"
with open(index_path, "r", encoding="utf-8") as f:
    html = f.read()

# 1. Inject Firebase client-side initialization at the beginning of script block
script_start = '<script type="text/babel" data-presets="react">'
script_init = """<script type="text/babel" data-presets="react">
    // --- BCM Firebase Client SDK Initialization ---
    try {
      if (typeof firebase !== 'undefined') {
        firebase.initializeApp({
          apiKey: "AIzaSyBbZaXf59BXG1bQ1n6-Hu2yUhly-VYINXY",
          authDomain: "bcmfoodhub.firebaseapp.com",
          projectId: "bcmfoodhub",
          storageBucket: "bcmfoodhub.firebasestorage.app",
          messagingSenderId: "560151898749",
          appId: "1:560151898749:android:c86025855b98414df5df14"
        });
        console.log("✅ Firebase Client App initialized successfully on the customer frontend.");
      }
    } catch (e) {
      console.warn("⚠️ Firebase Client initialization warning:", e.message);
    }"""

html = html.replace(script_start, script_init, 1)

# 2. Inject Web Push VAPID token request block inside Browser / PWA permission flow
browser_permission_target = """          // Browser / PWA path
          if(typeof window !== 'undefined' && 'Notification' in window) {"""

browser_permission_injection = """          // Browser / PWA path
          if(typeof window !== 'undefined' && 'Notification' in window) {
            // Try capturing the real Firebase Web Push token
            try {
              if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
                const fcm = firebase.messaging();
                fcm.getToken({
                  vapidKey: "BLTsxoCiDrw8KogcBF9X4CbOk82P-a7VDrLI_DJdz_NUa_jjkEOOziV8FG-DwRAw2sB5JFR3SK4Zn9_OVpVuUeE"
                }).then((webToken) => {
                  if (webToken) {
                    console.log("✅ Captured Firebase Web Push registration token:", webToken);
                    savePushToken(webToken);
                  }
                }).catch((fcmErr) => {
                  console.warn("⚠️ FCM Web Push token retrieval warning (will fall back to mock alerts):", fcmErr.message);
                });
              }
            } catch (fcmInitErr) {
              console.warn("⚠️ FCM Web Push initialization error:", fcmInitErr.message);
            }"""

html = html.replace(browser_permission_target, browser_permission_injection, 1)

with open(index_path, "w", encoding="utf-8") as f:
    f.write(html)

print("✅ Finished Detailed Firebase Integration inside customer-app/index.html!")
