import { apiUrl } from "@/config/network";

/**
 * Safe fetch helper — never throws "Unexpected token '<'" 
 * Returns { data, ok, status, error }
 */
export async function safeFetch<T = any>(
  url: string,
  options?: RequestInit
): Promise<{ data: T | null; ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(apiUrl(url), options);
    const contentType = res.headers.get("content-type") ?? "";
    
    if (!contentType.includes("application/json")) {
      // Server returned HTML (error page) — not JSON
      const text = await res.text();
      return { data: null, ok: false, status: res.status, error: `Server error ${res.status}` };
    }

    const data = await res.json();
    return { data, ok: res.ok, status: res.status, error: res.ok ? undefined : (data?.error || `Error ${res.status}`) };
  } catch (err: any) {
    return { data: null, ok: false, status: 0, error: err.message || "Network error" };
  }
}

/** Quick safe GET — returns data or null */
export async function safeGet<T = any>(url: string): Promise<T | null> {
  const { data, ok } = await safeFetch<T>(url);
  return ok ? data : null;
}
