"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/hooks/useLocale";

const API = process.env.NEXT_PUBLIC_API_URL || "";

type GymOption = { slug: string; name: string };
const SUPER_OPTION_VALUE = "__super__";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  // selected: "" = none yet, "__super__" = super-admin path, "<slug>" = tenant
  const [selected, setSelected] = useState("");
  const [gymOptions, setGymOptions] = useState<GymOption[] | null>(null);
  const [hasSuperAdmin, setHasSuperAdmin] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Total options including the optional "Super admin (platform)" entry
  const totalOptions = (gymOptions?.length ?? 0) + (hasSuperAdmin ? 1 : 0);

  useEffect(() => {
    if (!phone || phone.length < 7) {
      setGymOptions(null);
      setHasSuperAdmin(false);
      setSelected("");
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/auth/gyms-by-phone?phone=${encodeURIComponent(phone)}`);
        const data = await res.json();
        if (data.success) {
          const gyms: GymOption[] = data.gyms || [];
          setGymOptions(gyms);
          setHasSuperAdmin(!!data.has_super_admin);
          // Auto-select only when there's exactly ONE option overall.
          // If both a gym and a super-admin record share the phone, we
          // ALWAYS show the picker so the user explicitly chooses.
          const total = gyms.length + (data.has_super_admin ? 1 : 0);
          if (total === 1) {
            setSelected(gyms[0]?.slug ?? SUPER_OPTION_VALUE);
          } else {
            setSelected("");
          }
        }
      } catch { /* ignore */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [phone]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const body: Record<string, string> = { phone, password };
      // "__super__" = super-admin login, omit gym_slug.
      // Empty selected with no options found also means super-admin.
      if (selected && selected !== SUPER_OPTION_VALUE) body.gym_slug = selected;

      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.message || t("login.failed"));
        return;
      }

      localStorage.setItem("token", data.token);
      if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);
      localStorage.setItem("user", JSON.stringify(data.user));

      // Super-admin lands on the platform dashboard; tenant users on the gym dashboard
      if (data.user?.role === "super_admin") {
        router.push("/admin/gyms");
      } else {
        router.push("/");
      }
    } catch {
      setError(t("common.serverError"));
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "0.9rem 1rem",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid var(--border-glass)",
    borderRadius: "12px",
    color: "var(--text-main)",
    fontSize: "1rem",
    outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    color: "var(--text-muted)", fontSize: "0.8rem",
    display: "block", marginBottom: "0.5rem",
    textTransform: "uppercase", letterSpacing: "1px",
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
          <label style={labelStyle}>{t("login.phone")}</label>
          <input
            type="tel"
            placeholder="+998 90 123 45 67"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            style={inputStyle}
          />
        </div>

        {totalOptions > 1 && (
          <div>
            <label style={labelStyle}>Hisob turi</label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              required
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              <option value="">— Tanlang —</option>
              {hasSuperAdmin && (
                <option value={SUPER_OPTION_VALUE}>🛡 Super Admin (platforma)</option>
              )}
              {gymOptions?.map(g => (
                <option key={g.slug} value={g.slug}>🏋 {g.name}</option>
              ))}
            </select>
            <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
              Bu telefon bir necha hisob bilan bog'langan. Qaysi hisobga kirayotganingizni tanlang.
            </p>
          </div>
        )}

        <div>
          <label style={labelStyle}>{t("login.password")}</label>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
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
