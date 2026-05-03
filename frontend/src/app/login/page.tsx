"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/hooks/useLocale";

const API = process.env.NEXT_PUBLIC_API_URL || "";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.message || t("login.failed"));
        return;
      }

      localStorage.setItem("token", data.token);
      if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);
      localStorage.setItem("user", JSON.stringify(data.user));
      router.push("/");
    } catch {
      setError(t("common.serverError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem",
    }}>
      <form onSubmit={handleSubmit} className="glass-card" style={{ width: "100%", maxWidth: "420px", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <div style={{ textAlign: "center", marginBottom: "0.5rem" }}>
          <div className="brand" style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }}>GymSystem</div>
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>{t("login.title")}</p>
        </div>

        {error && (
          <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff6b6b", padding: "0.75rem 1rem", borderRadius: "10px", fontSize: "0.9rem" }}>
            {error}
          </div>
        )}

        <div>
          <label style={{ color: "var(--text-muted)", fontSize: "0.8rem", display: "block", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "1px" }}>
            {t("login.phone")}
          </label>
          <input
            type="tel"
            placeholder="+998 90 123 45 67"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            style={{
              width: "100%", padding: "0.9rem 1rem",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid var(--border-glass)",
              borderRadius: "12px",
              color: "var(--text-main)",
              fontSize: "1rem",
              outline: "none",
            }}
          />
        </div>

        <div>
          <label style={{ color: "var(--text-muted)", fontSize: "0.8rem", display: "block", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "1px" }}>
            {t("login.password")}
          </label>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              width: "100%", padding: "0.9rem 1rem",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid var(--border-glass)",
              borderRadius: "12px",
              color: "var(--text-main)",
              fontSize: "1rem",
              outline: "none",
            }}
          />
        </div>

        <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", padding: "1rem", fontSize: "1rem", opacity: loading ? 0.7 : 1 }}>
          {loading ? t("login.signingIn") : t("login.signIn")}
        </button>

        <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
          {t("login.forgot")}
        </p>
      </form>
    </div>
  );
}
