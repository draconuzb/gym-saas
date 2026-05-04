"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "";

async function tryRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem("refreshToken");
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const data = await res.json();
    if (data.success && data.token) {
      localStorage.setItem("token", data.token);
      return data.token;
    }
  } catch { /* refresh failed */ }
  return null;
}

export function useAuth() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = localStorage.getItem("token");
    const u = localStorage.getItem("user");
    if (!t) {
      router.push("/login");
      return;
    }
    setToken(t);
    try {
      setUser(u ? JSON.parse(u) : null);
    } catch {
      setUser(null);
      localStorage.removeItem("user");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!token) return;
    const interval = setInterval(async () => {
      const newToken = await tryRefresh();
      if (newToken) setToken(newToken);
    }, 50 * 60 * 1000);
    return () => clearInterval(interval);
  }, [token]);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("activeGymId");
    router.push("/login");
  }, [router]);

  // Super-admin "switch into" a gym for tenant-scoped views.
  // Stored in localStorage so it persists across reloads.
  const setActiveGymId = useCallback((id: number | null) => {
    if (id == null) localStorage.removeItem("activeGymId");
    else localStorage.setItem("activeGymId", String(id));
    // Notify other tabs/components
    window.dispatchEvent(new Event("activeGymIdChanged"));
  }, []);

  const fetchWithAuth = useCallback(async (url: string, options: RequestInit = {}) => {
    let t = localStorage.getItem("token");
    if (!t) {
      router.push("/login");
      throw new Error("No token");
    }

    const buildHeaders = (tok: string) => {
      const h: Record<string, string> = {
        ...(options.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
      };
      // For super-admin, attach the active gym id (if set) so tenant routes work
      const u = localStorage.getItem("user");
      try {
        const parsed = u ? JSON.parse(u) : null;
        if (parsed?.role === "super_admin") {
          const activeGymId = localStorage.getItem("activeGymId");
          if (activeGymId) h["X-Gym-Id"] = activeGymId;
        }
      } catch { /* ignore */ }
      return h;
    };

    let res = await fetch(url, { ...options, cache: 'no-store', headers: buildHeaders(t) });

    if (res.status === 401 || res.status === 403) {
      const newToken = await tryRefresh();
      if (newToken) {
        setToken(newToken);
        res = await fetch(url, { ...options, cache: 'no-store', headers: buildHeaders(newToken) });
        if (res.status === 401 || res.status === 403) {
          logout();
          throw new Error("Session expired");
        }
        return res;
      }
      logout();
      throw new Error("Session expired");
    }
    return res;
  }, [router, logout]);

  return { token, user, loading, logout, fetchWithAuth, setActiveGymId };
}
