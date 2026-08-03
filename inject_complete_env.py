import json

print("--- Merging Complete Environment Variables ---")

# 1. DEFINE BASE PARAMS FROM USER ENV FILE
base_env = """PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/bcm_marketplace
NODE_ENV=development

# Email OTP (Afrihost SMTP)
SMTP_HOST=smtp.afrihost.co.za
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=bcm@ms-inc.co.za
SMTP_PASS=@Karabo1234
OTP_EMAIL_FROM=BCM FoodHub <bcm@ms-inc.co.za>
EMAIL_OTP_DEV_MODE=false

# PayFast Sandbox Credentials
PF_MERCHANT_ID=13712451
PF_MERCHANT_KEY=99iubcv3sd8v5
PF_PASSPHRASE=Karabo532612
PF_NOTIFY_URL=https://bcmbrands.onrender.com/payfast-webhook
"""

# 2. DEFINE FIREBASE SERVICE ACCOUNT DATA
service_account_data = {
  "type": "service_account",
  "project_id": "bcmfoodhub",
  "private_key_id": "cf9c6d8fdff36ccc1838ab9adbe245a8011662fd",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDhE9rwB03LAcRH\nj3gw05y5X5eUK6hl2BeCubUxhVBcFtahFS9eVkJyGQ5nd2JCJUBjEx8uEdzvz7kU\nY0FKHdWFzDBMM4mJqX7OuVfMGUIEQtdEtajqmCvlAy+Uw5so5V863VkVqFnprzGR\nbcSxyLqMuFC3VJa/H0nbxmadnzhf/bU68CNYUEbnALMduo4PQOgAG9TwO2hGYgql\njwB2PabN8lieCf3zTMhFA9bUhTvnBtm3GCVg9ysRhRwtP+3ajVYQFSHzDZRhlx+X\njSxPp7q2aud0IqdpPpa2WiLy35NwIBzE8Kz7ItHpY/G9pla4junHdj3jMvGUOdQV\n9BOuI6zXAgMBAAECggEAaEy8pIUl8gBwFd8wiaPOGQLoqYNvpj40auImyntmKT52\nGDBKgpNDeD8PMzgZ4uADTcYDKWSitshSElYKX8+ibj2YVf996TqPpjkyK8S6mGHn\nApKR46A/mwDWcEASqylbb1o6WXRpsgX62NL+looXlHUnBkWfE5LqtXrje4BYbfYz\nM8vRNWH3ZFNvFQos+SgWdcbSdFV9Uh7kbKa9RJ0/HmJuLrHP3euzvXiQCWxQ/ug\n8uBFNOo05DuZgPxdisC+5f3IkrShOIYqnUJGiuNffYXoA63YGEH3whEmkBDLE95z\n7WoSgWAujUGtWuwsYO7j0AuYtS41huIbyWevAU+6/QKBgQD9DWmmWzJvEB0BFHeT\npkrBMzKuIXCZZz0IeBJeMMJR16SCEvYmYXcE1SB18idWv/7vNTBWoZebPlfOZxfy\nwARee9ffeeFcDq/QMATZS11vWeJRtAEsv4vxA91M2DtCGZxdcfa1ZlNvnyLxvbX5\nGmHdBKEcIzPTk8WgbznVSgMFBQKBgQDjswXyK+GHPnlayRFNhB9zLAz/O1vqYnOY\nBw4kjElBgeRvDl8QIBm2HO6Ie0qM1cNN++qlzLWiCZGGQ4EL/b3aQlynos7/qeFU\nCX1XoWq/v6LM6IWfppUl5r4xhkVkTY/vFju/WklhcYMt3BNJX55KMRDmLjaNV5jX\n6a3cjMKRKwKBgQDgJrVjCn1OK/PFNSAGxdKJ+JP38t8Ow4gorFN446/9Vwr9vVYV\nAViwCynJ0EpQaZmkwnSjCFiGx154EpIAEV7NYt4BsrCRHuFVhHOHF18Yd4Il5VD1\nFmcbgtTQcOlsz8rWa1ChtpZJ1ajagbVjhp8RbDxZ9ETAMbFpP5z29axfEQKBgARR\nkexM7sMc6TpSk/RvbBVIIZr5qj2gzmZ0w8znqEAI0adVk3H/2dz9YXzPMdPH/iNN\ngt7QKiW/nrX4M8thbadlGNLJILnyo+ZvI6R02Ex4uwK96kLj6vJEFRllXY2Qdwlm\n141Cjh++AmntQaRjnuHzWkmzWK+HmMuHkBedx9bvAoGAOasrnvu6n/EFMXhVanbC\nsOWoi/L6eTRHHRWlK2j/N3yH1e16FYt1vwmKI4ed25ta14/BRtffhI1Q0V7oryIB\nBTyjS9Vm8cgdHHVMAgxw8jZOUOLQfgToaMNFcAB84ysKIXBzoDObAonixqo1E5qo\nYQADOGIYtu6BPexozibMbLg=\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@bcmfoodhub.iam.gserviceaccount.com",
  "client_id": "108994533517826448189",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40bcmfoodhub.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
}

service_account_single_line = json.dumps(service_account_data)

# 3. MERGE THE TWO
complete_env_content = base_env + f"\n# Firebase Cloud Messaging Credentials\nFIREBASE_SERVICE_ACCOUNT='{service_account_single_line}'\n"

# 4. WRITE MERGED VERSION TO ACTIVE PATHS
with open("/home/user/.env", "w", encoding="utf-8") as f:
    f.write(complete_env_content)
with open("customer-app/.env", "w", encoding="utf-8") as f:
    f.write(complete_env_content)

print("✅ Merged complete environment variables written to active directories successfully.")
print("--- complete_env_content created! ---")
