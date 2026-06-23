/**
 * Custom Next.js server that also runs Socket.IO for real-time GPS tracking.
 * This replaces `next start` so both Next.js and Socket.IO run on port 3000.
 *
 * Socket.IO is available at ws(s)://host:3000 (same port as Next.js).
 * On mobile Wi-Fi, open http(s)://<laptop-ip>:3000.
 */

const { createServer: createHttpServer } = require("http");
const { createServer: createHttpsServer } = require("https");
const { parse }        = require("url");
const fs               = require("fs");
const next             = require("next");
const { Server }       = require("socket.io");
const { Pool }         = require("pg");
const os               = require("os");
require("dotenv").config({ path: ".env.production" });
require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.local" });

// Always run in production mode — dev mode requires unbuilt source
const dev  = false;
process.env.NODE_ENV = "production";
const app  = next({ dev });
const handle = app.getRequestHandler();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
});

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const USE_HTTPS = process.env.HTTPS === "true";
const HTTPS_KEY_PATH = process.env.HTTPS_KEY_PATH || "certs/localhost-key.pem";
const HTTPS_CERT_PATH = process.env.HTTPS_CERT_PATH || "certs/localhost.pem";
const LOCAL_NETWORK_ORIGINS = [
  /^https?:\/\/localhost(?::\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?$/,
  /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}(?::\d+)?$/,
  /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(?::\d+)?$/,
  /^https?:\/\/[a-zA-Z0-9-]+\.loca\.lt$/,
  /^https?:\/\/[a-zA-Z0-9-]+\.ngrok-free\.app$/,
];

function isAllowedLocalOrigin(origin) {
  if (!origin) return true;
  const configured = (process.env.LOCAL_NETWORK_ORIGINS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  return configured.includes(origin) || LOCAL_NETWORK_ORIGINS.some(pattern => pattern.test(origin));
}

function createNetworkServer(handler) {
  if (!USE_HTTPS) return createHttpServer(handler);
  if (!fs.existsSync(HTTPS_KEY_PATH) || !fs.existsSync(HTTPS_CERT_PATH)) {
    throw new Error(`HTTPS=true but certificate files were not found: ${HTTPS_KEY_PATH}, ${HTTPS_CERT_PATH}`);
  }
  return createHttpsServer({
    key: fs.readFileSync(HTTPS_KEY_PATH),
    cert: fs.readFileSync(HTTPS_CERT_PATH),
  }, handler);
}

/* ── In-memory live state ── */
const activeBuses = new Map(); // busId → { lat, lng, speed, heading, tripId, driverId, routeId, lastUpdated }
const activeTrips = new Map(); // tripId → { busId, driverId, status }
const combinedBuses = new Map(); // targetBusId → { primaryBusId, driverId, startedAt }

app.prepare().then(() => {
  const httpServer = createNetworkServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  /* ── Socket.IO attached to SAME http server ── */
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        callback(null, isAllowedLocalOrigin(origin));
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports:          ["websocket", "polling"],
    pingTimeout:         60000,
    pingInterval:        25000,
    upgradeTimeout:      30000,
    allowEIO3:           true,
  });

  /* ─── REST: live bus list ─── */
  // Note: Next.js handles all /api/* routes, but we can intercept /socket-health
  io.engine.on("connection_error", (err) => {
    console.error("[Socket.IO] Connection error:", err.message);
  });

  /* ────────────────────────────────────────
     SOCKET EVENT HANDLERS
  ──────────────────────────────────────── */
  io.on("connection", (socket) => {
    console.log(`[CONNECT] ${socket.id} from ${socket.handshake.address}`);

    /* ── 1. Driver connects ── */
    socket.on("driver-connect", ({ busId, driverId, routeId }) => {
      socket.join(`bus-${busId}`);
      socket.join(`driver-${driverId}`);
      socket.data.busId    = busId;
      socket.data.driverId = driverId;
      socket.data.routeId  = routeId;
      socket.data.role     = "driver";
      console.log(`[DRIVER] ${driverId} → bus ${busId}`);

      // Broadcast bus now active to ALL clients (admin + students)
      io.emit("bus-status", {
        busId, driverId, routeId,
        status:    "active",
        timestamp: new Date().toISOString(),
      });

      // Send current active bus list to everyone
      broadcastActiveBuses();
    });

    /* ── 2. Live GPS location ── */
    socket.on("liveLocation", ({ busId, lat, lng, speed, heading, accuracy, tripId }) => {
      const now = new Date().toISOString();
      const entry = {
        lat, lng,
        speed:    speed    || 0,
        heading:  heading  || 0,
        accuracy: accuracy || 0,
        tripId:   tripId   || null,
        driverId: socket.data.driverId || null,
        routeId:  socket.data.routeId  || null,
        lastUpdated: now,
      };
      activeBuses.set(busId, entry);

      const payload = {
        busId, lat, lng,
        speed:    speed   || 0,
        heading:  heading || 0,
        routeId:  entry.routeId,
        timestamp: now,
      };

      // Broadcast to ALL connected clients (admin sees it, students see it)
      io.emit("bus-location-update", payload);

      // Also broadcast to room for targeted tracking
      io.to(`bus-${busId}`).emit("bus-location-update", payload);

      combinedBuses.forEach((combine, targetBusId) => {
        if (combine.primaryBusId !== busId) return;
        const combinedPayload = {
          ...payload,
          busId: targetBusId,
          combinedFrom: busId,
          message: `Tracking combined bus ${busId}`,
        };
        io.emit("bus-location-update", combinedPayload);
        io.to(`bus-${targetBusId}`).emit("bus-location-update", combinedPayload);
      });

      // Persist location to DB (30% sample rate)
      if (Math.random() < 0.3) {
        pool.query(
          `INSERT INTO bus_locations(bus_id,trip_id,lat,lng,speed,heading,accuracy)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [busId, tripId||null, lat, lng, speed||0, heading||0, accuracy||0]
        ).catch(() => {});

        // Update bus last position
        pool.query(
          `UPDATE buses SET last_lat=$1,last_lng=$2,last_speed=$3,last_updated=NOW() WHERE bus_id=$4`,
          [lat, lng, speed||0, busId]
        ).catch(() => {});
      }
    });

    /* ── 3. Trip status changes ── */
    socket.on("trip-status", ({ busId, tripId, status, driverId }) => {
      console.log(`[TRIP] bus=${busId} trip=${tripId} status=${status}`);

      if (status === "started") {
        activeTrips.set(String(tripId), { busId, driverId, status: "active", startTime: new Date().toISOString() });
        pool.query(`UPDATE buses SET status='active' WHERE bus_id=$1`, [busId]).catch(() => {});
        io.emit("bus-status", { busId, driverId, tripId, status: "active", timestamp: new Date().toISOString() });
        io.emit("trip-update",  { busId, tripId, status: "active", startTime: new Date().toISOString() });
        broadcastActiveBuses();

      } else if (status === "paused") {
        const trip = activeTrips.get(String(tripId));
        if (trip) activeTrips.set(String(tripId), { ...trip, status: "paused" });
        io.emit("bus-status",  { busId, tripId, status: "paused",  timestamp: new Date().toISOString() });
        io.emit("trip-update", { busId, tripId, status: "paused" });

      } else if (status === "completed" || status === "stopped") {
        const completedAt = new Date();
        activeTrips.delete(String(tripId));
        activeBuses.delete(busId);
        combinedBuses.forEach((combine, targetBusId) => {
          if (combine.primaryBusId === busId) {
            combinedBuses.delete(targetBusId);
            io.emit("bus-status", { busId: targetBusId, tripId, status: "inactive", timestamp: completedAt.toISOString(), combinedFrom: busId });
          }
        });
        pool.query(`UPDATE buses SET status='inactive',last_updated=NOW() WHERE bus_id=$1`, [busId]).catch(() => {});
        io.emit("bus-status",  { busId, tripId, status: "inactive",  timestamp: new Date().toISOString() });
        io.emit("trip-update", { busId, tripId, status: "completed", endTime: completedAt.toISOString() });
        broadcastActiveBuses();
      }
    });

    /* ── 4. Combine another bus into this running bus ── */
    socket.on("combine-bus", ({ primaryBusId, targetBusId, driverId, reason, alert }) => {
      const primary = String(primaryBusId || "").trim().toUpperCase();
      const target = String(targetBusId || "").trim().toUpperCase();
      if (!primary || !target || primary === target) return;

      combinedBuses.set(target, {
        primaryBusId: primary,
        driverId: driverId || socket.data.driverId || null,
        startedAt: new Date().toISOString(),
      });

      const payload = {
        ...(alert || {}),
        busId: target,
        targetBusId: target,
        primaryBusId: primary,
        driverId: driverId || socket.data.driverId || null,
        reason,
        timestamp: new Date().toISOString(),
      };

      console.log(`[COMBINE] ${target} → tracking ${primary}`);
      io.to(`bus-${target}`).emit("bus-combined", payload);
      io.emit("admin-bus-combined", payload);
      io.emit("bus-status", { busId: target, status: "active", combinedFrom: primary, timestamp: payload.timestamp });

      const loc = activeBuses.get(primary);
      if (loc) {
        const combinedPayload = {
          busId: target,
          lat: loc.lat,
          lng: loc.lng,
          speed: loc.speed,
          heading: loc.heading,
          timestamp: loc.lastUpdated,
          combinedFrom: primary,
        };
        io.emit("bus-location-update", combinedPayload);
        io.to(`bus-${target}`).emit("bus-location-update", combinedPayload);
      }
      broadcastActiveBuses();
    });

    /* ── 5. Emergency alert ── */
    socket.on("emergency-alert", ({ busId, driverId, lat, lng, category, label, reason, alert }) => {
      const payload = {
        ...(alert || {}),
        busId,
        driverId,
        lat,
        lng,
        category,
        label,
        reason,
        timestamp: new Date().toISOString(),
      };
      console.log(`[EMERGENCY] bus=${busId} driver=${driverId} type=${label || category || "emergency"}`);
      io.to(`bus-${busId}`).emit("emergency", payload);
      io.emit("admin-emergency", payload);
      pool.query(`UPDATE trips SET emergency_alert=true WHERE bus_id=$1 AND status='active'`, [busId]).catch(() => {});
    });

    /* ── 5b. Alert Resolution broadcast ── */
    socket.on("resolve-alert", ({ id, busId, resolvedAt }) => {
      console.log(`[RESOLVE_ALERT] id=${id} busId=${busId} resolvedAt=${resolvedAt}`);
      const payload = { id, busId, resolvedAt };
      io.to(`bus-${busId}`).emit("alert-resolved", payload);
      io.emit("alert-resolved", payload);
    });

    /* ── 6. Student tracks a specific bus ── */
    socket.on("track-bus", (busId) => {
      socket.join(`bus-${busId}`);
      // Immediately send current location if bus is active
      const combine = combinedBuses.get(busId);
      const sourceBusId = combine?.primaryBusId || busId;
      const loc = activeBuses.get(sourceBusId);
      if (loc) {
        socket.emit("bus-location-update", {
          busId, lat: loc.lat, lng: loc.lng,
          speed: loc.speed, heading: loc.heading,
          timestamp: loc.lastUpdated,
          combinedFrom: combine?.primaryBusId,
        });
      }
    });

    socket.on("untrack-bus", (busId) => socket.leave(`bus-${busId}`));

    /* ── 7. Client requests current active buses list ── */
    socket.on("get-active-buses", () => {
      socket.emit("active-buses-list", getActiveBusList());
    });

    /* ── 7.5. Route updated by admin or driver ── */
    socket.on("route-updated", ({ routeId }) => {
      console.log(`[ROUTE_UPDATED] routeId=${routeId}`);
      io.emit("route-updated", { routeId });
    });

    /* ── 8. Disconnect ── */
    socket.on("disconnect", (reason) => {
      console.log(`[DISCONNECT] ${socket.id} — ${reason}`);
      if (socket.data.role === "driver" && socket.data.busId) {
        const busId = socket.data.busId;
        // Give 30s grace period for reconnection
        setTimeout(() => {
          const stillConnected = [...io.sockets.sockets.values()]
            .some(s => s.data.busId === busId && s.id !== socket.id);
          if (!stillConnected) {
            activeBuses.delete(busId);
            combinedBuses.forEach((combine, targetBusId) => {
              if (combine.primaryBusId === busId) combinedBuses.delete(targetBusId);
            });
            io.emit("bus-status", { busId, status: "disconnected", timestamp: new Date().toISOString() });
            broadcastActiveBuses();
          }
        }, 30000);
      }
    });
  });

  /* ── Broadcast full active bus list to all clients ── */
  function broadcastActiveBuses() {
    io.emit("active-buses-list", getActiveBusList());
  }

  function getActiveBusList() {
    const list = [];
    activeBuses.forEach((v, k) => list.push({ busId: k, ...v }));
    combinedBuses.forEach((combine, targetBusId) => {
      const loc = activeBuses.get(combine.primaryBusId);
      if (!loc) return;
      list.push({
        busId: targetBusId,
        ...loc,
        combinedFrom: combine.primaryBusId,
      });
    });
    return list;
  }

  /* ── Heartbeat: broadcast every 5s so clients stay in sync ── */
  setInterval(() => {
    if (activeBuses.size > 0) {
      broadcastActiveBuses();
    }
  }, 5000);

  httpServer.listen(PORT, HOST, () => {
    const protocol = USE_HTTPS ? "https" : "http";
    const networkInterfaces = os.networkInterfaces();
    let localIp = "localhost";
    for (const name of Object.keys(networkInterfaces)) {
      for (const net of networkInterfaces[name]) {
        if ((net.family === "IPv4" || net.family === 4) && !net.internal) {
          localIp = net.address;
          break;
        }
      }
    }
    console.log(`\n🚍 Aditya Bus Connect running on ${protocol}://localhost:${PORT}`);
    console.log(`🌐 Local Wi-Fi access: ${protocol}://${localIp}:${PORT}`);
    console.log(`🔒 Host binding: ${HOST}`);
    console.log(`🔐 HTTPS: ${USE_HTTPS ? "enabled" : "disabled"}`);
    console.log(`📡 Socket.IO embedded on same port`);
    console.log(`🗄️  Database: ${process.env.DATABASE_URL ? "connected" : "using default"}`);
  });
});
