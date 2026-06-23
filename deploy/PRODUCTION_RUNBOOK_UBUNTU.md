# BusTrackLive - Ubuntu Deployment Runbook

## Assumptions
- You will host on an Ubuntu VM you control.
- You will run the app using the project’s built-in Node server (`server.js`).
- The VM has PostgreSQL available (either local or reachable remotely).
- Your public domain is a real FQDN such as `adityauniversitybustracking.com` or `adityauniversitybustracking.in`.

> A single word like `adityauniversitybustracking` is not a public internet domain by itself. Buy/connect a real domain, then create DNS records.

## 0) Point your domain to the server
At your domain registrar/DNS provider, create:

```text
Type: A
Name: @
Value: <your-server-public-ip>
TTL: Auto

Type: A
Name: www
Value: <your-server-public-ip>
TTL: Auto
```

Wait until DNS resolves:

```bash
dig adityauniversitybustracking.com
dig www.adityauniversitybustracking.com
```

## 1) Create a deployment folder
Example:
```bash
sudo mkdir -p /var/www/bustracklive
sudo chown -R www-data:www-data /var/www/bustracklive
```

Copy project files to `/var/www/bustracklive` (or use git pull).

## 2) Install Node dependencies
```bash
cd /var/www/bustracklive
sudo -u www-data npm ci
```

## 3) Build
```bash
sudo -u www-data npm run build
```

## 4) Configure environment variables
Create `/var/www/bustracklive/.env.production` (owned by `www-data`).

Minimum:
- `DATABASE_URL` (required)
- `PORT` (optional; default 3000)
- `HOST` (optional; default 0.0.0.0)

Example `.env`:
```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
HTTPS=false
NEXT_PUBLIC_APP_URL=https://adityauniversitybustracking.com
NEXT_PUBLIC_API_BASE_URL=
NEXT_PUBLIC_SOCKET_URL=
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/app_db
JWT_SECRET=replace-with-a-long-random-secret
LOCAL_NETWORK_ORIGINS=https://adityauniversitybustracking.com,https://www.adityauniversitybustracking.com
```

Optional:
- `LOCAL_NETWORK_ORIGINS` if you need to allow-list origins for Socket.IO CORS.

## 5) systemd service
Copy the example unit to systemd:
```bash
sudo cp /var/www/bustracklive/deploy/ubuntu-systemd.service.example /etc/systemd/system/bustracklive.service
```
Edit the service file if needed (paths, User, env locations).

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable bustracklive
sudo systemctl restart bustracklive
```

Check status/logs:
```bash
sudo systemctl status bustracklive --no-pager
sudo journalctl -u bustracklive -f
```

## 6) Validate
- App should be reachable at: `http://<server-ip>:3000` (or via Nginx/HTTPS if configured)
- Socket.IO should be available on the same port (same host/port).

## 7) (Strongly recommended) Add HTTPS with Nginx
PWA install + GPS/camera/WebAuthn commonly require secure contexts. Use Nginx + Let’s Encrypt.

Use `deploy/nginx-bustracklive.production.example`:

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo cp /var/www/bustracklive/deploy/nginx-bustracklive.production.example /etc/nginx/sites-available/bustracklive
sudo nano /etc/nginx/sites-available/bustracklive
sudo ln -sf /etc/nginx/sites-available/bustracklive /etc/nginx/sites-enabled/bustracklive
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d adityauniversitybustracking.com -d www.adityauniversitybustracking.com
```

After HTTPS is active, verify:

```bash
curl -I https://adityauniversitybustracking.com
curl -I https://adityauniversitybustracking.com/api/health
```

## 8) Production checklist

- `https://adityauniversitybustracking.com` loads the app.
- `https://adityauniversitybustracking.com/api/health` returns `{"ok":true}`.
- Browser DevTools shows Socket.IO connected under Network → WS.
- Driver GPS works only after location permission is allowed.
- QR scanner works only after camera permission is allowed.
- PWA install appears only on HTTPS.
- Fingerprint/passkey login appears only on HTTPS and supported devices.

