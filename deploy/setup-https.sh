#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-adityauniversitybustracking.com}"
WWW_DOMAIN="${WWW_DOMAIN:-www.adityauniversitybustracking.com}"
EMAIL="${EMAIL:-}"

if [[ -z "$EMAIL" ]]; then
  echo "ERROR: Set EMAIL for Let's Encrypt."
  echo "Example:"
  echo "EMAIL=admin@example.com DOMAIN=adityauniversitybustracking.com sudo -E bash deploy/setup-https.sh"
  exit 1
fi

apt-get update
apt-get install -y certbot python3-certbot-nginx
nginx -t
certbot --nginx -d "$DOMAIN" -d "$WWW_DOMAIN" --email "$EMAIL" --agree-tos --redirect --non-interactive
systemctl reload nginx

echo "HTTPS enabled:"
echo "https://$DOMAIN"
echo "https://$DOMAIN/api/health"
