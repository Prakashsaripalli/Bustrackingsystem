# Deploy BusTrackLive to `adityauniversitybustracking`

To make this project public, you need a real internet domain such as:

```text
adityauniversitybustracking.com
adityauniversitybustracking.in
bus.adityauniversity.edu
```

`adityauniversitybustracking` alone is not a public URL. Buy a domain or create a subdomain, then point it to your server.

## Recommended Production Setup

- Ubuntu VM with public IP
- Node.js 20+
- PostgreSQL
- Nginx reverse proxy
- Let’s Encrypt HTTPS
- systemd service for auto-restart

This keeps all current app features working:

- Next.js UI
- Node custom server
- Socket.IO live tracking
- PostgreSQL database
- JWT auth
- GPS tracking
- QR scanner
- PWA install
- fingerprint/passkey login over HTTPS

## 1) Prepare Server

```bash
sudo apt-get update
sudo apt-get install -y nginx postgresql postgresql-contrib git curl certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

## Fast Path: Automated Script

After your domain DNS points to the server and the project is in a Git repo, run this on Ubuntu:

```bash
REPO_URL=https://github.com/username/repo.git \
DOMAIN=adityauniversitybustracking.com \
WWW_DOMAIN=www.adityauniversitybustracking.com \
DB_PASSWORD='change_this_database_password' \
JWT_SECRET='change_this_long_random_secret' \
sudo -E bash deploy/deploy-ubuntu.sh
```

Then enable HTTPS:

```bash
EMAIL=admin@example.com \
DOMAIN=adityauniversitybustracking.com \
WWW_DOMAIN=www.adityauniversitybustracking.com \
sudo -E bash deploy/setup-https.sh
```

If you want me to do the actual deployment, send the details listed in `deploy/ACCESS_NEEDED_TO_DEPLOY.md`.

## 2) Upload or Clone Project

```bash
sudo mkdir -p /var/www/bustracklive
sudo chown -R $USER:$USER /var/www/bustracklive
cd /var/www/bustracklive
```

Copy your project files here, or clone your Git repository:

```bash
git clone <your-repo-url> .
```

## 3) Configure Database

Create a PostgreSQL database and user:

```bash
sudo -u postgres psql
```

```sql
CREATE DATABASE app_db;
CREATE USER bustrack_user WITH PASSWORD 'CHANGE_THIS_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE app_db TO bustrack_user;
\q
```

If you already have existing local data, export/import it:

```bash
pg_dump "postgresql://postgres:postgres@127.0.0.1:5432/app_db" > bustrack_backup.sql
psql "postgresql://bustrack_user:CHANGE_THIS_PASSWORD@127.0.0.1:5432/app_db" < bustrack_backup.sql
```

## 4) Create Production Env

```bash
cp deploy/production.env.example .env.production
nano .env.production
```

Example:

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
HTTPS=false
NEXT_PUBLIC_APP_URL=https://adityauniversitybustracking.com
NEXT_PUBLIC_API_BASE_URL=
NEXT_PUBLIC_SOCKET_URL=
DATABASE_URL=postgresql://bustrack_user:CHANGE_THIS_PASSWORD@127.0.0.1:5432/app_db
JWT_SECRET=use-a-long-random-production-secret
LOCAL_NETWORK_ORIGINS=https://adityauniversitybustracking.com,https://www.adityauniversitybustracking.com
```

## 5) Install and Build

```bash
npm ci
npm run build
```

## 6) Start with systemd

```bash
sudo cp deploy/ubuntu-systemd.service.example /etc/systemd/system/bustracklive.service
sudo nano /etc/systemd/system/bustracklive.service
sudo systemctl daemon-reload
sudo systemctl enable bustracklive
sudo systemctl restart bustracklive
sudo systemctl status bustracklive --no-pager
```

Check logs:

```bash
sudo journalctl -u bustracklive -f
```

## 7) Configure Nginx

```bash
sudo cp deploy/nginx-bustracklive.production.example /etc/nginx/sites-available/bustracklive
sudo nano /etc/nginx/sites-available/bustracklive
sudo ln -sf /etc/nginx/sites-available/bustracklive /etc/nginx/sites-enabled/bustracklive
sudo nginx -t
sudo systemctl reload nginx
```

## 8) Enable HTTPS

First, create DNS `A` records:

```text
adityauniversitybustracking.com      -> your-server-public-ip
www.adityauniversitybustracking.com  -> your-server-public-ip
```

Then run:

```bash
sudo certbot --nginx -d adityauniversitybustracking.com -d www.adityauniversitybustracking.com
```

## 9) Verify

```bash
curl -I https://adityauniversitybustracking.com
curl https://adityauniversitybustracking.com/api/health
```

Open in browser:

```text
https://adityauniversitybustracking.com
```

## 10) Debug Commands

```bash
sudo systemctl status bustracklive --no-pager
sudo journalctl -u bustracklive -n 100 --no-pager
sudo nginx -t
sudo tail -n 100 /var/log/nginx/error.log
sudo ss -ltnp | grep 3000
```

## Important

PWA install, GPS, QR camera, and fingerprint/passkey require HTTPS in real-world deployment. Do not use plain HTTP for the public site.
