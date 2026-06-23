# Nginx: make https://adityauniversitybustracking.com work (with Socket.IO)

Replace `adityauniversitybustracking.com` with your real purchased domain. A single word like `adityauniversitybustracking` cannot get a public Let’s Encrypt certificate.

If your URL loads the wrong thing or fails, these are the exact checks.

## 0) Confirm Node is actually running
```bash
sudo systemctl status bustracklive --no-pager
sudo journalctl -u bustracklive -n 200 --no-pager
```
Node must be listening on **0.0.0.0:3000**.
```bash
sudo ss -ltnp | findstr ":3000" || true
```
(If you don’t see 3000, fix systemd env vars first.)

## 1) Use correct Nginx server_name
In your site config, ensure:
```nginx
server_name adityauniversitybustracking.com www.adityauniversitybustracking.com;
```

Reload nginx:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 2) Enable TLS (Let’s Encrypt)
Install certbot and issue cert:
```bash
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d adityauniversitybustracking.com -d www.adityauniversitybustracking.com
```

## 3) Correct HTTPS reverse proxy config (Socket.IO)
Use this HTTPS template as your final Nginx site config (replace paths if needed).

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name adityauniversitybustracking.com www.adityauniversitybustracking.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```
After certbot, it will add the `listen 443 ssl` server block. Ensure the **443** block also includes:
- `proxy_http_version 1.1;`
- `Upgrade` and `Connection upgrade` headers

## 4) Check Nginx is proxying to the right place
Open Nginx logs:
```bash
sudo tail -n 200 /var/log/nginx/error.log
sudo tail -n 200 /var/log/nginx/access.log
```

Hit the site locally from the VM:
```bash
curl -I http://127.0.0.1
curl -I https://adityauniversitybustracking.com
```

## 5) If the page loads but live tracking doesn’t work
That usually means WebSocket upgrade is blocked.
Verify by checking browser devtools → Network → WebSocket.
If it’s failing, confirm the proxy includes upgrade headers in the **443** server block.

## 6) Quick fix: missing trailing slash
If your app/router expects a path prefix, Nginx can redirect.
But for normal Next.js app, `/` should work.

---
If you paste the last ~50 lines of:
- `sudo journalctl -u bustracklive -n 50 --no-pager`
- `sudo tail -n 50 /var/log/nginx/error.log`
I’ll point to the exact failing line.
