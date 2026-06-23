#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/bustracklive}"
APP_USER="${APP_USER:-www-data}"
REPO_URL="${REPO_URL:-}"
DOMAIN="${DOMAIN:-adityauniversitybustracking.com}"
WWW_DOMAIN="${WWW_DOMAIN:-www.adityauniversitybustracking.com}"
DB_NAME="${DB_NAME:-app_db}"
DB_USER="${DB_USER:-bustrack_user}"
DB_PASSWORD="${DB_PASSWORD:-CHANGE_THIS_DATABASE_PASSWORD}"
JWT_SECRET="${JWT_SECRET:-CHANGE_THIS_LONG_RANDOM_SECRET}"

if [[ -z "$REPO_URL" ]]; then
  echo "ERROR: Set REPO_URL before running."
  echo "Example:"
  echo "REPO_URL=https://github.com/yourname/yourrepo.git DOMAIN=adityauniversitybustracking.com sudo -E bash deploy/deploy-ubuntu.sh"
  exit 1
fi

echo "==> Installing system packages"
apt-get update
apt-get install -y nginx postgresql postgresql-contrib git curl ca-certificates
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Preparing app directory: $APP_DIR"
mkdir -p "$APP_DIR"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

if [[ ! -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
else
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
fi

echo "==> Creating PostgreSQL database/user if needed"
sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
SQL

echo "==> Writing production environment"
cat > "$APP_DIR/.env.production" <<ENV
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
HTTPS=false
NEXT_PUBLIC_APP_URL=https://$DOMAIN
NEXT_PUBLIC_API_BASE_URL=
NEXT_PUBLIC_SOCKET_URL=
DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME
JWT_SECRET=$JWT_SECRET
LOCAL_NETWORK_ORIGINS=https://$DOMAIN,https://$WWW_DOMAIN
ENV
chown "$APP_USER":"$APP_USER" "$APP_DIR/.env.production"
chmod 600 "$APP_DIR/.env.production"

echo "==> Installing dependencies and building"
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci
sudo -u "$APP_USER" npm run build

echo "==> Installing systemd service"
cp "$APP_DIR/deploy/ubuntu-systemd.service.example" /etc/systemd/system/bustracklive.service
systemctl daemon-reload
systemctl enable bustracklive
systemctl restart bustracklive

echo "==> Installing Nginx config"
sed "s/adityauniversitybustracking.com/$DOMAIN/g; s/www.adityauniversitybustracking.com/$WWW_DOMAIN/g" \
  "$APP_DIR/deploy/nginx-bustracklive.production.example" > /etc/nginx/sites-available/bustracklive
ln -sf /etc/nginx/sites-available/bustracklive /etc/nginx/sites-enabled/bustracklive
nginx -t
systemctl reload nginx

echo "==> Deployment prepared"
echo "Now run HTTPS setup:"
echo "sudo certbot --nginx -d $DOMAIN -d $WWW_DOMAIN"
echo ""
echo "Check app:"
echo "sudo systemctl status bustracklive --no-pager"
echo "curl http://127.0.0.1:3000/api/health"
