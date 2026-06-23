# Local Wi-Fi Mobile Access

This project can run on your laptop and be opened from Android devices on the same Wi-Fi network without internet deployment.

## Important Project Note

The requested stack mentions Vite and MongoDB, but this repository is currently a Next.js React app with a custom Node server, Socket.IO, and PostgreSQL. The changes below preserve the existing project and apply the same local-network behavior:

- The app server listens on `0.0.0.0`.
- Frontend API calls use same-origin `/api/...` URLs.
- Socket.IO connects to the same origin opened in the browser.
- Local-network CORS is allowed for common private IP ranges.

## Updated Server Configuration

`server.js` now uses:

```js
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

httpServer.listen(PORT, HOST, () => {
  console.log(`BusTrackLive running on http://localhost:${PORT}`);
  console.log(`Local Wi-Fi access: http://<your-laptop-ip>:${PORT}`);
});
```

Socket.IO CORS allows localhost plus private Wi-Fi IP ranges:

```js
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      callback(null, isAllowedLocalOrigin(origin));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});
```

## Frontend API Configuration

`src/config/network.ts` provides:

```ts
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");
export const SOCKET_URL = (process.env.NEXT_PUBLIC_SOCKET_URL || "").replace(/\/$/, "");
```

For this app, leave `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_SOCKET_URL` blank. When mobile opens `http://<laptop-ip>:3000`, all `/api/...` calls and Socket.IO use that same address automatically.

## Environment Example

Use `.env.local.example` as the template:

```env
PORT=3000
HOST=0.0.0.0
NEXT_PUBLIC_API_BASE_URL=
NEXT_PUBLIC_SOCKET_URL=
NEXT_PUBLIC_APP_URL=http://localhost:3000
LOCAL_NETWORK_ORIGINS=
```

Optional allow-list example:

```env
LOCAL_NETWORK_ORIGINS=http://192.168.1.23:3000,http://localhost:3000
```

## If Your Frontend Were Vite

This repository does not contain `vite.config.ts`, but the equivalent Vite config would be:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:3000",
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true,
      },
    },
  },
});
```

For a separate Vite frontend, set:

```env
VITE_API_BASE_URL=http://<laptop-ip>:3000
VITE_SOCKET_URL=http://<laptop-ip>:3000
```

## If Your Backend Were Plain Express

This repository uses `server.js`, but a plain Express equivalent would be:

```js
const cors = require("cors");
const express = require("express");
const app = express();

app.use(cors({
  origin: true,
  credentials: true,
}));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log(`Backend running on http://${HOST}:${PORT}`);
});
```

## Find Laptop IPv4 Address

On Windows PowerShell:

```powershell
ipconfig
```

Look for your Wi-Fi adapter and copy `IPv4 Address`, for example:

```text
IPv4 Address. . . . . . . . . . . : 192.168.1.23
```

## Start the App for Local Wi-Fi

Because `server.js` now binds to `0.0.0.0`, either command works:

```powershell
npm run dev
```

or:

```powershell
npm run dev:network
```

If you changed production files, rebuild first:

```powershell
npm run build
npm run dev:network
```

## Open From Devices

Laptop browser:

```text
http://localhost:3000
```

Android browser on same Wi-Fi:

```text
http://<laptop-ip>:3000
```

Example:

```text
http://192.168.1.23:3000
```

## Socket.IO Across Devices

The frontend uses:

```ts
window.location.origin
```

So if Android opens `http://192.168.1.23:3000`, Socket.IO also connects to `http://192.168.1.23:3000/socket.io`.

## Android PWA, GPS, and QR Camera Warning

Basic pages, APIs, auth, and Socket.IO work over local Wi-Fi HTTP. However, Android Chrome normally requires a secure context for:

- PWA installation/service worker
- GPS geolocation
- Camera QR scanning
- Fingerprint/passkey WebAuthn

For a full Android PWA demo without internet deployment, use one of these:

1. Chrome testing flag on Android:
   - Open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
   - Add `http://<laptop-ip>:3000`
   - Relaunch Chrome
2. Local HTTPS with a trusted certificate installed on the Android phone.

Without one of those, Android may allow normal browsing but block GPS, camera, passkey, or PWA install.

## Local HTTPS Mode

The server supports HTTPS when certificate files are available:

```env
HTTPS=true
HTTPS_KEY_PATH=certs/localhost-key.pem
HTTPS_CERT_PATH=certs/localhost.pem
```

Start with:

```powershell
npm run dev:https
```

Then open:

```text
https://<laptop-ip>:3000
```

Important: Android must trust the certificate. If the certificate is not trusted by Android, Chrome will still treat the page as insecure and fingerprint/PWA install may remain blocked.

For quickest classroom/demo testing on Android Chrome:

1. Open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Add your app origin, for example:

```text
http://192.168.0.135:3000
```

3. Relaunch Chrome.
4. Open the app again.

After this, fingerprint/passkey, camera, GPS, and PWA install prompts are allowed for that local origin.

## Windows Firewall

If mobile cannot open the app:

1. Make sure laptop and phone are on the same Wi-Fi.
2. Allow Node.js through Windows Defender Firewall.
3. Check that the server log shows:

```text
Host binding: 0.0.0.0
Local Wi-Fi access: http://<your-laptop-ip>:3000
```
