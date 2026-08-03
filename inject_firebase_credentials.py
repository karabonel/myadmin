import re

print("--- Injecting User Firebase Credentials ---")

# 1. DEFINE USER EXTRACTED VALUES
API_KEY = "AIzaSyBbZaXf59BXG1bQ1n6-Hu2yUhly-VYINXY"
PROJECT_ID = "bcmfoodhub"
STORAGE_BUCKET = "bcmfoodhub.firebasestorage.app"
MESSAGING_SENDER_ID = "560151898749"
AUTH_DOMAIN = "bcmfoodhub.firebaseapp.com"

# 2. UPDATE FIREBASE-MESSAGING-SW.JS
sw_path = "customer-app/firebase-messaging-sw.js"
with open(sw_path, "r", encoding="utf-8") as f:
    sw = f.read()

sw = sw.replace("YOUR_FIREBASE_API_KEY", API_KEY)
sw = sw.replace("YOUR_PROJECT_ID.firebaseapp.com", AUTH_DOMAIN)
sw = sw.replace("YOUR_PROJECT_ID", PROJECT_ID)
sw = sw.replace("YOUR_PROJECT_ID.appspot.com", STORAGE_BUCKET)
sw = sw.replace("YOUR_MESSAGING_SENDER_ID", MESSAGING_SENDER_ID)
# Fallback Web App ID (Can be replaced if user provides specific web app id)
sw = sw.replace("YOUR_APP_ID", "1:560151898749:web:48be385ca3d6bca5df14")

with open(sw_path, "w", encoding="utf-8") as f:
    f.write(sw)
print("✅ firebase-messaging-sw.js successfully updated with your project credentials.")


# 3. UPDATE CUSTOMER-APP/INDEX.HTML
index_path = "customer-app/index.html"
with open(index_path, "r", encoding="utf-8") as f:
    html = f.read()

# Replace frontend initialization placeholders
html = html.replace("YOUR_FIREBASE_API_KEY", API_KEY)
html = html.replace("YOUR_PROJECT_ID.firebaseapp.com", AUTH_DOMAIN)
html = html.replace("YOUR_PROJECT_ID", PROJECT_ID)
html = html.replace("YOUR_PROJECT_ID.appspot.com", STORAGE_BUCKET)
html = html.replace("YOUR_MESSAGING_SENDER_ID", MESSAGING_SENDER_ID)
html = html.replace("YOUR_APP_ID", "1:560151898749:web:48be385ca3d6bca5df14")

with open(index_path, "w", encoding="utf-8") as f:
    f.write(html)
print("✅ customer-app/index.html successfully updated with your project credentials.")
