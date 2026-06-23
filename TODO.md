# TODO - Deploy BusTrackLive

## Plan (approved)
- Use recommended deployment target: **Ubuntu VM + PostgreSQL + systemd (or PM2)**.

## Steps
1. Inspect deployment-related scripts/config in repo (package.json, next.config.ts, server.js, .env.example).
2. Decide runtime strategy: build once (`next build`) then run `node server.js`.
3. Create production environment variable template for server runtime (DATABASE_URL, PORT, HOST, LOCAL_NETWORK_ORIGINS if needed).
4. Create Ubuntu systemd unit file for `node server.js` to run on boot + restart on failure.
5. (Optional) Create Nginx reverse proxy config for HTTP→HTTPS and WebSocket support.
6. Provide exact commands: install deps, build, migrate/seed if needed, start/restart service.
7. Provide a quick verification checklist: health page, Socket.IO connection, PWA install over HTTPS.

## Progress
- [x] Read key files: package.json, next.config.ts, server.js, docs/LOCAL_NETWORK_ACCESS.md, PWAController.tsx, docs/PWA_ARCHITECTURE.md
- [x] Generate systemd unit + required env template
- [ ] Provide Nginx config (optional)
- [ ] Provide exact commands for build/start


