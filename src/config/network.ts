export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");
export const SOCKET_URL = (process.env.NEXT_PUBLIC_SOCKET_URL || "").replace(/\/$/, "");

export function apiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export function getSocketUrl() {
  if (SOCKET_URL) return SOCKET_URL;
  if (typeof window !== "undefined") return window.location.origin;
  return undefined;
}
