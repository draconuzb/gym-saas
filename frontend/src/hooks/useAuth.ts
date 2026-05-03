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

  // Auto-refresh token every 50 minutes (token expires in 1h)
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
    router.push("/login");
  }, [router]);

  const fetchWithAuth = useCallback(async (url: string, options: RequestInit = {}) => {
    let t = localStorage.getItem("token");
    if (!t) {
      router.push("/login");
      throw new Error("No token");
    }
    let res = await fetch(url, {
      ...options,
      cache: 'no-store',
      headers: {
        ...options.headers,
        Authorization: `Bearer ${t}`,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
      },
    });
    // If access token expired, try refresh once
    if (res.status === 401 || res.status === 403) {
      const newToken = await tryRefresh();
      if (newToken) {
        setToken(newToken);
        res = await fetch(url, {
          ...options,
          cache: 'no-store',
          headers: {
            ...options.headers,
            Authorization: `Bearer ${newToken}`,
            "Content-Type": "application/json",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
          },
        });
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

  return { token, user, loading, logout, fetchWithAuth };
}
