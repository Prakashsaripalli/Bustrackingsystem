const express  = require("express");
const http     = require("http");
const { Server } = require("socket.io");
const cors     = require("cors");
const { Pool } = require("pg");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: "*", methods: ["GET","POST"] } });

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
});

/* ─── In-memory live state ─── */
const activeBuses = new Map();  // busId → { lat,lng,speed,heading,tripId,driverId,routeId,lastUpdated }
const activeTrips = new Map();  // tripId → { busId,driverId,status,startTime }

/* ─── REST helpers ─── */
app.get("/api/health", (_, res) => res.json({ status: "ok", activeBuses: activeBuses.size }));

app.get("/api/live-buses", (_, res) => {
  const list = [];
  activeBuses.forEach((v, k) => list.push({ busId: k, ...v }));
  res.json(list);
});

/* ─── Helpers ─── */
function broadcastActiveBusesList() {
  const list = [];
  activeBuses.forEach((v, k) => list.push({ busId: k, ...v }));
  io.emit("active-buses-list", list);
}

/* ─── Socket.IO ─── */
io.on("connection", (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  /* ── driver joins ── */
  socket.on("driver-connect", ({ busId, driverId, routeId }) => {
    socket.join(`bus-${busId}`);
    socket.data = { busId, driverId, routeId, role: "driver" };
    console.log(`[DRIVER] ${driverId} → bus ${busId}`);
    // Tell everyone this bus is now active
    io.emit("bus-status", { busId, status: "active", driverId, routeId, timestamp: new Date().toISOString() });
    broadcastActiveBusesList();
  });

  /* ── live GPS location ── */
  socket.on("liveLocation", ({ busId, lat, lng, speed, heading, accuracy, tripId }) => {
    const entry = {
      lat, lng,
      speed:    speed    || 0,
      heading:  heading  || 0,
      accuracy: accuracy || 0,
      tripId:   tripId   || null,
      driverId: socket.data?.driverId || null,
      routeId:  socket.data?.routeId  || null,
      lastUpdated: new Date().toISOString(),
    };
    activeBuses.set(busId, entry);

    const payload = { busId, lat, lng, speed: speed||0, heading: heading||0, timestamp: entry.lastUpdated };
    io.emit("bus-location-update", payload);           // all clients (admin + students)

    /* Persist ~30% of updates */
    if (Math.random() < 0.3) {
      pool.query(
        `INSERT INTO bus_locations(bus_id,trip_id,lat,lng,speed,heading,accuracy)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [busId, tripId||null, lat, lng, speed||0, heading||0, accuracy||0]
      ).catch(() => {});

      /* Also update buses.last_lat/lng/speed */
      pool.query(
        `UPDATE buses SET last_lat=$1, last_lng=$2, last_speed=$3, last_updated=NOW() WHERE bus_id=$4`,
        [lat, lng, speed||0, busId]
      ).catch(() => {});
    }
  });

  /* ── trip status ── */
  socket.on("trip-status", ({ busId, tripId, status, driverId }) => {
    console.log(`[TRIP] bus=${busId} trip=${tripId} status=${status}`);

    if (status === "started") {
      activeTrips.set(tripId, { busId, driverId, status: "active", startTime: new Date().toISOString() });
      // Update bus status in DB
      pool.query(`UPDATE buses SET status='active' WHERE bus_id=$1`, [busId]).catch(()=>{});
      io.emit("bus-status", { busId, status: "active", tripId, timestamp: new Date().toISOString() });
      io.emit("trip-update", { busId, tripId, status: "active", startTime: new Date().toISOString() });

    } else if (status === "paused") {
      if (activeTrips.has(tripId)) activeTrips.get(tripId).status = "paused";
      io.emit("bus-status", { busId, status: "paused", tripId, timestamp: new Date().toISOString() });
      io.emit("trip-update", { busId, tripId, status: "paused" });

    } else if (status === "completed" || status === "stopped") {
      activeTrips.delete(tripId);
      activeBuses.delete(busId);
      // Update bus status + trip end time in DB
      pool.query(`UPDATE buses SET status='inactive', last_updated=NOW() WHERE bus_id=$1`, [busId]).catch(()=>{});
      pool.query(`UPDATE trips SET status='completed', end_time=NOW() WHERE id=$1`, [tripId]).catch(()=>{});
      io.emit("bus-status", { busId, status: "inactive", tripId, timestamp: new Date().toISOString() });
      io.emit("trip-update", { busId, tripId, status: "completed", endTime: new Date().toISOString() });
      broadcastActiveBusesList();
    }
  });

  /* ── emergency ── */
  socket.on("emergency-alert", ({ busId, driverId, lat, lng }) => {
    io.emit("emergency", { busId, driverId, lat, lng, timestamp: new Date().toISOString() });
    pool.query(`UPDATE trips SET emergency_alert=true WHERE bus_id=$1 AND status='active'`, [busId]).catch(()=>{});
  });

  /* ── Alert Resolution broadcast ── */
  socket.on("resolve-alert", ({ id, busId, resolvedAt }) => {
    console.log(`[RESOLVE_ALERT] id=${id} busId=${busId} resolvedAt=${resolvedAt}`);
    const payload = { id, busId, resolvedAt };
    io.to(`bus-${busId}`).emit("alert-resolved", payload);
    io.emit("alert-resolved", payload);
  });

  /* ── student tracks a bus ── */
  socket.on("track-bus", (busId) => {
    socket.join(`bus-${busId}`);
    const loc = activeBuses.get(busId);
    if (loc) socket.emit("bus-location-update", { busId, ...loc });
  });

  socket.on("untrack-bus", (busId) => socket.leave(`bus-${busId}`));

  /* ── disconnect ── */
  socket.on("disconnect", () => {
    console.log(`[DISCONNECT] ${socket.id}`);
    if (socket.data?.role === "driver" && socket.data?.busId) {
      setTimeout(() => {
        const still = [...io.sockets.sockets.values()]
          .some(s => s.data?.busId === socket.data.busId);
        if (!still) {
          activeBuses.delete(socket.data.busId);
          io.emit("bus-status", { busId: socket.data.busId, status: "disconnected", timestamp: new Date().toISOString() });
          broadcastActiveBusesList();
        }
      }, 30000);
    }
  });
});

const PORT = process.env.SOCKET_PORT || 3001;
server.listen(PORT, () => console.log(`🚍 Socket.IO server on :${PORT}`));
