"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface User {
  id: number; name: string; email: string; role: string;
  driverId?: string; phone?: string; village?: string;
  parentContact?: string;
  licenseNo?: string; assignedBusId?: string; preferredRouteId?: number;
  // Student-specific
  boardingStop?: string; studentId?: string;
}

export type { User };

interface RegisterData {
  name: string; email: string; password: string; role: string;
  phone?: string; parentContact?: string; village?: string; boardingStop?: string; assignedBusId?: string; studentId?: string;
}

interface AuthContextType {
  user: User | null; token: string | null; loading: boolean;
  login: (emailOrDriverId: string, password: string, role: string) => Promise<void>;
  fingerprintLogin: (identifier?: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void; isAuthenticated: boolean;
  updateUser: (updates: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function base64urlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function bufferToBase64url(buffer: ArrayBuffer | null): string | null {
  if (!buffer) return null;
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function getFingerprintSupportError() {
  if (typeof window === "undefined") return "Fingerprint login is available only in the browser.";
  if (!window.isSecureContext) {
    return "Fingerprint login needs HTTPS or localhost. On mobile Wi‑Fi HTTP, open Chrome flags and add this site as a secure origin, or use local HTTPS.";
  }
  if (!window.PublicKeyCredential) {
    return "Fingerprint login is not supported on this device/browser.";
  }
  return "";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]   = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const restoreSession = async () => {
      const savedToken = localStorage.getItem("bus_token");
      const savedUser = localStorage.getItem("bus_user");
      if (!savedToken || !savedUser) {
        setLoading(false);
        return;
      }

      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { Authorization: `Bearer ${savedToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          setToken(data.token);
          setUser(data.user);
          localStorage.setItem("bus_token", data.token);
          localStorage.setItem("bus_user", JSON.stringify(data.user));
        } else if (res.status === 401 || res.status === 404) {
          setToken(null);
          setUser(null);
          localStorage.removeItem("bus_token");
          localStorage.removeItem("bus_user");
        }
      } catch {
        // Keep the locally restored session during temporary network/server issues.
      } finally {
        setLoading(false);
      }
    };
    restoreSession();
  }, []);

  const login = async (emailOrDriverId: string, password: string, role: string) => {
    // Detect if it's a driverId (starts with DRV) or email
    const isDriverId = role === "driver" && /^DRV\d+$/i.test(emailOrDriverId.trim());
    const body = isDriverId
      ? { driverId: emailOrDriverId.trim().toUpperCase(), password, role }
      : { email: emailOrDriverId.trim(), password, role };

    const res  = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    setUser(data.user); setToken(data.token);
    localStorage.setItem("bus_token", data.token);
    localStorage.setItem("bus_user", JSON.stringify(data.user));
  };

  const fingerprintLogin = async (identifier?: string) => {
    const supportError = getFingerprintSupportError();
    if (supportError) throw new Error(supportError);
    const remembered = localStorage.getItem("driver_fingerprint_login");
    const saved = remembered ? JSON.parse(remembered) : null;
    const driverIdentifier = (identifier || saved?.driverId || saved?.email || "").trim();
    if (!driverIdentifier) throw new Error("Enter Driver ID once, then tap Fingerprint Login.");

    const optionsRes = await fetch("/api/auth/webauthn/login/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: driverIdentifier }),
    });
    const options = await optionsRes.json();
    if (!optionsRes.ok) throw new Error(options.error || "Fingerprint login unavailable");

    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: base64urlToBuffer(options.challenge),
        rpId: options.rpId,
        timeout: options.timeout,
        userVerification: options.userVerification,
        allowCredentials: options.allowCredentials.map((item: any) => ({
          ...item,
          id: base64urlToBuffer(item.id),
        })),
      },
    }) as PublicKeyCredential | null;
    if (!credential) throw new Error("Fingerprint login was cancelled.");

    const response = credential.response as AuthenticatorAssertionResponse;
    const verifyRes = await fetch("/api/auth/webauthn/login/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        driverId: options.driverId,
        id: credential.id,
        rawId: bufferToBase64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufferToBase64url(response.clientDataJSON),
          authenticatorData: bufferToBase64url(response.authenticatorData),
          signature: bufferToBase64url(response.signature),
          userHandle: bufferToBase64url(response.userHandle),
        },
      }),
    });
    const data = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(data.error || "Fingerprint login failed");
    setUser(data.user); setToken(data.token);
    localStorage.setItem("bus_token", data.token);
    localStorage.setItem("bus_user", JSON.stringify(data.user));
    localStorage.setItem("driver_fingerprint_login", JSON.stringify({ driverId: data.user.driverId, email: data.user.email }));
  };

  const register = async (regData: RegisterData) => {
    if (regData.role !== "student") throw new Error("Only students can self-register.");
    const res  = await fetch("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(regData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");
    setUser(data.user); setToken(data.token);
    localStorage.setItem("bus_token", data.token);
    localStorage.setItem("bus_user", JSON.stringify(data.user));
  };

  const logout = () => {
    setUser(null); setToken(null);
    localStorage.removeItem("bus_token"); localStorage.removeItem("bus_user");
    window.location.href = "/";
  };

  const updateUser = (updates: Partial<User>) => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      localStorage.setItem("bus_user", JSON.stringify(updated));
      return updated;
    });
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, fingerprintLogin, register, logout, isAuthenticated: !!user, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
