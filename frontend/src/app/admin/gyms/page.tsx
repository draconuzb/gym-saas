"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

const API = process.env.NEXT_PUBLIC_API_URL || "";

type Gym = {
  id: number;
  slug: string;
  name: string;
  phone: string | null;
  is_active: boolean;
  plan: string;
  telegram_bot_username: string | null;
  members_count: string;
  staff_count: string;
  created_at: string;
};

export default function AdminGymsPage() {
  const router = useRouter();
  const { user, loading, fetchWithAuth, logout, setActiveGymId } = useAuth();
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user || user.role !== "super_admin") {
      router.push("/");
      return;
    }
    refresh();
  }, [loading, user]);

  const refresh = async () => {
    try {
      const res = await fetchWithAuth(`${API}/api/super/gyms`);
      const data = await res.json();
      if (data.success) setGyms(data.gyms);
      else setError(data.message || "Failed to load gyms");
    } catch (e: any) {
      setError(e.message || "Failed to load gyms");
    }
  };

  const enterGym = (gym: Gym) => {
    setActiveGymId(gym.id);
    router.push("/");
  };

  if (loading || !user) return null;
  if (user.role !== "super_admin") return null;

  return (
    <div style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.8rem", marginBottom: "0.25rem" }}>Super Admin — Gyms</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
            Platforma boshqaruvi: yangi zal qo'shish, sozlamalar, billing
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button onClick={() => setShowCreate(s => !s)} className="btn-primary" style={{ padding: "0.7rem 1.2rem" }}>
            {showCreate ? "Yopish" : "+ Yangi zal"}
          </button>
          <button onClick={logout} style={{ padding: "0.7rem 1.2rem", background: "transparent", border: "1px solid var(--border-glass)", borderRadius: 12, color: "var(--text-muted)", cursor: "pointer" }}>
            Chiqish
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff6b6b", padding: "0.75rem 1rem", borderRadius: 10, marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {showCreate && <CreateGymForm onCreated={() => { setShowCreate(false); refresh(); }} fetchWithAuth={fetchWithAuth} />}

      <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)" }}>
              <th style={th}>Nomi</th>
              <th style={th}>Slug</th>
              <th style={th}>Status</th>
              <th style={th}>A'zolar</th>
              <th style={th}>Xodimlar</th>
              <th style={th}>Bot</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {gyms.length === 0 && (
              <tr><td colSpan={7} style={{ ...td, textAlign: "center", padding: "2rem" }}>Hali zal qo'shilmagan</td></tr>
            )}
            {gyms.map(gym => (
              <tr key={gym.id} style={{ borderTop: "1px solid var(--border-glass)" }}>
                <td style={td}><strong>{gym.name}</strong></td>
                <td style={{ ...td, fontFamily: "monospace", color: "var(--text-muted)" }}>{gym.slug}</td>
                <td style={td}>
                  <span style={{
                    background: gym.is_active ? "rgba(0,200,100,0.15)" : "rgba(255,107,107,0.15)",
                    color: gym.is_active ? "#22c55e" : "#ef4444",
                    padding: "0.2rem 0.6rem", borderRadius: 6, fontSize: "0.8rem",
                  }}>
                    {gym.is_active ? "Faol" : "O'chirilgan"}
                  </span>
                </td>
                <td style={td}>{gym.members_count}</td>
                <td style={td}>{gym.staff_count}</td>
                <td style={{ ...td, fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  {gym.telegram_bot_username ? `@${gym.telegram_bot_username}` : "—"}
                </td>
                <td style={td}>
                  <button onClick={() => enterGym(gym)} className="btn-primary" style={{ padding: "0.4rem 0.9rem", fontSize: "0.85rem" }}>
                    Kirish →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left", padding: "0.9rem 1rem",
  fontSize: "0.78rem", textTransform: "uppercase",
  letterSpacing: "1px", color: "var(--text-muted)", fontWeight: 600,
};
const td: React.CSSProperties = {
  padding: "0.9rem 1rem", fontSize: "0.95rem",
};

// ─── Inline create form ───────────────────────────────────────
function CreateGymForm({ onCreated, fetchWithAuth }: {
  onCreated: () => void;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [form, setForm] = useState({
    slug: "", name: "", phone: "", address: "",
    admin_phone: "", admin_password: "", admin_first_name: "",
    telegram_bot_token: "", telegram_bot_username: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const body = Object.fromEntries(
        Object.entries(form).filter(([_, v]) => v !== "")
      );
      const res = await fetchWithAuth(`${API}/api/super/gyms`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) {
        setErr(data.message || "Failed");
        return;
      }
      onCreated();
    } catch (e: any) {
      setErr(e.message || "Failed");
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, key: keyof typeof form, type = "text", required = false, placeholder = "") => (
    <div>
      <label style={{ display: "block", color: "var(--text-muted)", fontSize: "0.78rem", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "1px" }}>
        {label}{required && " *"}
      </label>
      <input
        type={type}
        required={required}
        placeholder={placeholder}
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        style={{
          width: "100%", padding: "0.7rem 0.9rem",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid var(--border-glass)",
          borderRadius: 10, color: "var(--text-main)", outline: "none",
        }}
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="glass-card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
      <h3 style={{ marginBottom: "1.2rem" }}>Yangi zal qo'shish</h3>
      {err && <div style={{ background: "rgba(255,107,107,0.1)", color: "#ff6b6b", padding: "0.6rem", borderRadius: 8, marginBottom: "1rem" }}>{err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        {field("Slug (URL'da ishlatiladi)", "slug", "text", true, "onson")}
        {field("Nomi", "name", "text", true, "Onson Gym")}
        {field("Telefon", "phone", "tel", false, "+998 90 000 00 00")}
        {field("Manzil", "address", "text", false, "Tashkent, ...")}
      </div>

      <h4 style={{ color: "var(--text-muted)", marginBottom: "0.8rem", marginTop: "0.5rem" }}>Birinchi admin</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        {field("Admin telefon", "admin_phone", "tel", true, "+998 90 ...")}
        {field("Admin parol", "admin_password", "password", true, "min 6 belgi")}
        {field("Admin ismi", "admin_first_name", "text", true, "Asadbek")}
      </div>

      <h4 style={{ color: "var(--text-muted)", marginBottom: "0.8rem", marginTop: "0.5rem" }}>Telegram bot (ixtiyoriy)</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
        {field("Bot token", "telegram_bot_token", "text", false, "1234:ABC...")}
        {field("Bot username", "telegram_bot_username", "text", false, "onson_gym_bot")}
      </div>

      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button type="submit" disabled={busy} className="btn-primary" style={{ padding: "0.8rem 1.5rem" }}>
          {busy ? "Yaratilmoqda..." : "Yaratish"}
        </button>
      </div>
    </form>
  );
}
