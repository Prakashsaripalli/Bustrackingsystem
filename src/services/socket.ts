"use client";

import { io, Socket } from "socket.io-client";
import { getSocketUrl } from "@/config/network";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(getSocketUrl(), {
      transports:           ["websocket", "polling"],
      reconnection:          true,
      reconnectionAttempts:  Infinity,
      reconnectionDelay:     1000,
      reconnectionDelayMax:  5000,
      timeout:               20000,
      path:                  "/socket.io",
    });

    socket.on("connect", () => {
      console.log("[Socket] Connected:", socket?.id);
      // Request current active buses on connect
      socket?.emit("get-active-buses");
    });

    socket.on("disconnect", (reason) => {
      console.log("[Socket] Disconnected:", reason);
    });

    socket.on("connect_error", (err) => {
      console.warn("[Socket] Connection error:", err.message);
    });

    socket.on("reconnect", (n) => {
      console.log("[Socket] Reconnected after", n, "attempts");
      socket?.emit("get-active-buses");
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}
