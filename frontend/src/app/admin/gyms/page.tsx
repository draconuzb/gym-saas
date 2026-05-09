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
  has_bot_token: boolean;
  telegram_bot_username: string | null;
  bot_running: boolean;
  members_count: string;
  staff_count: string;
  created_at: string;
};

export default function AdminGymsPage() {
  const router = useRouter();
  const { user, loading, fetchWithAuth, logout, setActiveGymId } = useAuth();
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [error, setError] = useState("");
  const [showWizard, setShowWizard] = useState(false);
  const [editGymId, setEditGymId] = useState<number | null>(null);

  useEffect(() => {
    if (loading) return;
    // Don't auto-redirect — show a clear "wrong role" message so the user
    // sees what's happening instead of being silently bounced to /.
    if (user && user.role === "super_admin") refresh();
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

  const reloadBot = async (gym: Gym) => {
    try {
      await fetchWithAuth(`${API}/api/super/gyms/${gym.id}/reload-bot`, { method: "POST" });
      refresh();
    } catch (e: any) {
      setError(e.message || "Bot reload failed");
    }
  };

  if (loading) return null;

  // No session — point at the login page
  if (!user) {
    return (
      <NotAuthorized
        title="Tizimga kirish kerak"
        body="Bu sahifa platforma super admini uchun. Iltimos, avval tizimga kiring."
        ctaLabel="Login sahifasiga"
        ctaHref="/login"
        currentRole={null}
      />
    );
  }

  // Logged in but not super_admin (e.g. tenant admin)
  if (user.role !== "super_admin") {
    return (
      <NotAuthorized
        title="Bu sahifa faqat super admin uchun"
        body={`Sizning hisobingiz: ${user.role === "admin" ? "Zal admini" : user.role}${user.gymName ? ` (${user.gymName})` : ""}. Super admin sifatida kirish uchun avval chiqing.`}
        ctaLabel="Chiqish va qaytadan kirish"
        ctaOnClick={logout}
        currentRole={user.role}
      />
    );
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.8rem", marginBottom: "0.25rem" }}>Super Admin — Zallar</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
            Platforma boshqaruvi: yangi zal qo'shish, sozlamalar
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button onClick={() => setShowWizard(true)} className="btn-primary" style={{ padding: "0.7rem 1.2rem" }}>
            + Yangi zal
          </button>
          <button onClick={logout} style={btnGhost}>Chiqish</button>
        </div>
      </div>

      {error && (
        <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff6b6b", padding: "0.75rem 1rem", borderRadius: 10, marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {showWizard && (
        <CreateGymWizard
          fetchWithAuth={fetchWithAuth}
          onClose={() => setShowWizard(false)}
          onCreated={() => { setShowWizard(false); refresh(); }}
          onEnterGym={(id) => { setActiveGymId(id); router.push("/"); }}
        />
      )}

      {editGymId !== null && (
        <EditGymModal
          gymId={editGymId}
          fetchWithAuth={fetchWithAuth}
          onClose={() => { setEditGymId(null); refresh(); }}
        />
      )}

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
                <td style={{ ...td, fontSize: "0.85rem" }}>
                  <BotBadge gym={gym} onReload={() => reloadBot(gym)} />
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <button onClick={() => setEditGymId(gym.id)} style={{
                    padding: "0.4rem 0.8rem", fontSize: "0.85rem",
                    background: "transparent", border: "1px solid var(--border-glass)",
                    borderRadius: 8, color: "var(--text-muted)", cursor: "pointer",
                    marginRight: "0.4rem",
                  }}>
                    ✎ Tahrirlash
                  </button>
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
const td: React.CSSProperties = { padding: "0.9rem 1rem", fontSize: "0.95rem" };
const btnGhost: React.CSSProperties = {
  padding: "0.7rem 1.2rem", background: "transparent",
  border: "1px solid var(--border-glass)", borderRadius: 12,
  color: "var(--text-muted)", cursor: "pointer",
};

function NotAuthorized({ title, body, ctaLabel, ctaHref, ctaOnClick, currentRole }: {
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref?: string;
  ctaOnClick?: () => void;
  currentRole: string | null;
}) {
  return (
    <div style={{ minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <div className="glass-card" style={{ maxWidth: 480, padding: "2rem", textAlign: "center" }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "0.8rem" }}>🔐</div>
        <h2 style={{ fontSize: "1.4rem", marginBottom: "0.6rem" }}>{title}</h2>
        <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem", lineHeight: 1.6 }}>{body}</p>
        {currentRole && (
          <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "0.6rem 0.8rem", marginBottom: "1.3rem", fontSize: "0.85rem", color: "var(--text-muted)", textAlign: "left" }}>
            Joriy hisob roli: <strong style={{ color: "var(--text-main)", fontFamily: "monospace" }}>{currentRole}</strong>
          </div>
        )}
        <div style={{ display: "flex", gap: "0.6rem", justifyContent: "center" }}>
          {ctaHref && (
            <a href={ctaHref} className="btn-primary" style={{ padding: "0.7rem 1.4rem", textDecoration: "none", display: "inline-block" }}>
              {ctaLabel}
            </a>
          )}
          {ctaOnClick && (
            <button onClick={ctaOnClick} className="btn-primary" style={{ padding: "0.7rem 1.4rem" }}>
              {ctaLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BotBadge({ gym, onReload }: { gym: Gym; onReload: () => void }) {
  if (!gym.has_bot_token) {
    return <span style={{ color: "var(--text-muted)" }}>—</span>;
  }
  const running = gym.bot_running;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
      <span style={{
        background: running ? "rgba(0,200,100,0.15)" : "rgba(255,170,0,0.15)",
        color: running ? "#22c55e" : "#f59e0b",
        padding: "0.15rem 0.5rem", borderRadius: 6, fontSize: "0.78rem",
      }}>
        {running ? "▶ ishlamoqda" : "■ to'xtagan"}
      </span>
      {gym.telegram_bot_username && (
        <span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>@{gym.telegram_bot_username}</span>
      )}
      <button onClick={onReload} title="Botni qayta ishga tushirish" style={{
        background: "transparent", border: "none", color: "var(--text-muted)",
        cursor: "pointer", padding: "0 0.3rem", fontSize: "0.9rem",
      }}>↻</button>
    </span>
  );
}

// ============================================================
// Edit Gym modal — info, bot token, admins
// ============================================================

type GymDetail = {
  id: number; slug: string; name: string;
  phone: string | null; address: string | null;
  timezone: string | null; plan: string;
  is_active: boolean;
  telegram_bot_username: string | null;
};
type GymUser = {
  id: number; phone: string; role: string;
  first_name: string; last_name: string | null;
};

function EditGymModal({ gymId, fetchWithAuth, onClose }: {
  gymId: number;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
  onClose: () => void;
}) {
  const [gym, setGym] = useState<GymDetail | null>(null);
  const [users, setUsers] = useState<GymUser[]>([]);
  const [hasBotToken, setHasBotToken] = useState(false);
  const [botRunning, setBotRunning] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  // Info section state
  const [info, setInfo] = useState({ name: "", phone: "", address: "", timezone: "Asia/Tashkent", plan: "standard", is_active: true });
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoMsg, setInfoMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Bot section state
  const [tokenInput, setTokenInput] = useState("");
  const [tokenCheck, setTokenCheck] = useState<{ checking: boolean; valid: boolean | null; bot?: { username: string; first_name: string }; msg?: string }>({ checking: false, valid: null });
  const [savingBot, setSavingBot] = useState(false);
  const [botMsg, setBotMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Admin (user) section state — inline edit
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [userForm, setUserForm] = useState({ phone: "", firstName: "", lastName: "", password: "" });
  const [savingUser, setSavingUser] = useState(false);
  const [userMsg, setUserMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const reload = async () => {
    setLoadErr("");
    try {
      const [gRes, uRes, listRes] = await Promise.all([
        fetchWithAuth(`${API}/api/super/gyms/${gymId}`),
        fetchWithAuth(`${API}/api/super/gyms/${gymId}/users`),
        fetchWithAuth(`${API}/api/super/gyms`),
      ]);
      const g = await gRes.json();
      const u = await uRes.json();
      const list = await listRes.json();
      if (!g.success) throw new Error(g.message || "Zalni o'qib bo'lmadi");
      setGym(g.gym);
      setInfo({
        name: g.gym.name || "",
        phone: g.gym.phone || "",
        address: g.gym.address || "",
        timezone: g.gym.timezone || "Asia/Tashkent",
        plan: g.gym.plan || "standard",
        is_active: !!g.gym.is_active,
      });
      if (u.success) setUsers(u.users);
      if (list.success) {
        const cur = list.gyms.find((x: any) => x.id === gymId);
        if (cur) {
          setHasBotToken(!!cur.has_bot_token);
          setBotRunning(!!cur.bot_running);
        }
      }
    } catch (e: any) {
      setLoadErr(e.message || "Zalni o'qib bo'lmadi");
    }
  };

  useEffect(() => { reload(); }, [gymId]);

  // ── Info save
  const saveInfo = async () => {
    setSavingInfo(true); setInfoMsg(null);
    try {
      const res = await fetchWithAuth(`${API}/api/super/gyms/${gymId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: info.name, phone: info.phone || null, address: info.address || null,
          timezone: info.timezone, plan: info.plan, is_active: info.is_active,
        }),
      });
      const data = await res.json();
      if (data.success) setInfoMsg({ type: "ok", text: "Saqlandi." });
      else setInfoMsg({ type: "err", text: data.message || "Xato." });
    } catch (e: any) {
      setInfoMsg({ type: "err", text: e.message || "Xato." });
    } finally {
      setSavingInfo(false);
    }
  };

  // ── Bot actions
  const testToken = async () => {
    if (!tokenInput) return;
    setTokenCheck({ checking: true, valid: null });
    try {
      const res = await fetchWithAuth(`${API}/api/super/test-bot-token`, {
        method: "POST", body: JSON.stringify({ token: tokenInput }),
      });
      const d = await res.json();
      if (d.success && d.valid) setTokenCheck({ checking: false, valid: true, bot: d.bot });
      else setTokenCheck({ checking: false, valid: false, msg: d.message || "Token noto'g'ri." });
    } catch (e: any) {
      setTokenCheck({ checking: false, valid: false, msg: e.message });
    }
  };
  const saveToken = async () => {
    setSavingBot(true); setBotMsg(null);
    try {
      const res = await fetchWithAuth(`${API}/api/super/gyms/${gymId}`, {
        method: "PATCH", body: JSON.stringify({ telegram_bot_token: tokenInput }),
      });
      const d = await res.json();
      if (d.success) {
        setBotMsg({ type: "ok", text: `Token saqlandi. Bot: ${d.bot_reloaded ? "qayta ishga tushdi" : "yuklanmoqda..."}` });
        setTokenInput(""); setTokenCheck({ checking: false, valid: null });
        await reload();
      } else {
        setBotMsg({ type: "err", text: d.message || "Saqlab bo'lmadi." });
      }
    } catch (e: any) {
      setBotMsg({ type: "err", text: e.message });
    } finally {
      setSavingBot(false);
    }
  };
  const clearToken = async () => {
    if (!confirm("Bot tokenini o'chirmoqchimisiz? Bu zalda Telegram bot ishlamay qoladi.")) return;
    setSavingBot(true); setBotMsg(null);
    try {
      const res = await fetchWithAuth(`${API}/api/super/gyms/${gymId}`, {
        method: "PATCH", body: JSON.stringify({ telegram_bot_token: "" }),
      });
      const d = await res.json();
      if (d.success) { setBotMsg({ type: "ok", text: "Token olib tashlandi." }); await reload(); }
      else setBotMsg({ type: "err", text: d.message || "Xato." });
    } catch (e: any) {
      setBotMsg({ type: "err", text: e.message });
    } finally {
      setSavingBot(false);
    }
  };
  const reloadBot = async () => {
    setSavingBot(true); setBotMsg(null);
    try {
      const res = await fetchWithAuth(`${API}/api/super/gyms/${gymId}/reload-bot`, { method: "POST" });
      const d = await res.json();
      if (d.success) { setBotMsg({ type: "ok", text: d.bot_running ? "Bot qayta ishga tushdi." : "Bot yuklanmadi (tokenni tekshiring)." }); await reload(); }
      else setBotMsg({ type: "err", text: d.message || "Xato." });
    } catch (e: any) {
      setBotMsg({ type: "err", text: e.message });
    } finally {
      setSavingBot(false);
    }
  };

  // ── User edit
  const startEditUser = (u: GymUser) => {
    setUserMsg(null);
    setEditUserId(u.id);
    setUserForm({ phone: u.phone, firstName: u.first_name, lastName: u.last_name || "", password: "" });
  };
  const saveUser = async () => {
    if (editUserId == null) return;
    setSavingUser(true); setUserMsg(null);
    try {
      const body: any = {
        phone: userForm.phone,
        firstName: userForm.firstName,
        lastName: userForm.lastName,
      };
      if (userForm.password) body.password = userForm.password;
      const res = await fetchWithAuth(`${API}/api/super/gyms/${gymId}/users/${editUserId}`, {
        method: "PATCH", body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.success) {
        setUserMsg({ type: "ok", text: d.password_reset ? "Saqlandi (parol ham yangilandi)." : "Saqlandi." });
        setEditUserId(null);
        await reload();
      } else {
        setUserMsg({ type: "err", text: d.message || "Xato." });
      }
    } catch (e: any) {
      setUserMsg({ type: "err", text: e.message });
    } finally {
      setSavingUser(false);
    }
  };

  return (
    <div style={modalOverlay}>
      <div className="glass-card" style={{ ...modalCard, maxWidth: 720 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
          <div>
            <h2 style={{ fontSize: "1.3rem", marginBottom: "0.2rem" }}>
              {gym ? gym.name : "Yuklanmoqda..."}
            </h2>
            {gym && <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
              <code style={{ fontFamily: "monospace" }}>{gym.slug}</code> · ID {gym.id}
            </p>}
          </div>
          <button onClick={onClose} style={btnGhost}>Yopish</button>
        </div>

        {loadErr && (
          <div style={{ background: "rgba(255,107,107,0.1)", color: "#ff6b6b", padding: "0.7rem 1rem", borderRadius: 10, marginBottom: "1rem" }}>{loadErr}</div>
        )}

        {gym && (
          <>
            {/* ── INFO ── */}
            <Section title="Zal ma'lumotlari">
              {infoMsg && <FlashMsg msg={infoMsg} />}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
                <Field label="Nomi"><input style={inputStyle} value={info.name} onChange={e => setInfo({ ...info, name: e.target.value })} /></Field>
                <Field label="Telefon"><input style={inputStyle} value={info.phone} onChange={e => setInfo({ ...info, phone: e.target.value })} placeholder="+998..." /></Field>
                <Field label="Manzil" full><input style={inputStyle} value={info.address} onChange={e => setInfo({ ...info, address: e.target.value })} /></Field>
                <Field label="Timezone"><input style={inputStyle} value={info.timezone} onChange={e => setInfo({ ...info, timezone: e.target.value })} /></Field>
                <Field label="Tarif">
                  <select style={{ ...inputStyle, cursor: "pointer" }} value={info.plan} onChange={e => setInfo({ ...info, plan: e.target.value })}>
                    <option value="trial">Trial</option><option value="standard">Standard</option><option value="premium">Premium</option>
                  </select>
                </Field>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.8rem", color: "var(--text-muted)", fontSize: "0.9rem", cursor: "pointer" }}>
                <input type="checkbox" checked={info.is_active} onChange={e => setInfo({ ...info, is_active: e.target.checked })} />
                Faol (o'chirilsa, adminlar kira olmaydi)
              </label>
              <div style={{ marginTop: "0.8rem" }}>
                <button onClick={saveInfo} disabled={savingInfo} className="btn-primary" style={{ padding: "0.6rem 1.2rem" }}>
                  {savingInfo ? "Saqlanmoqda..." : "Saqlash"}
                </button>
              </div>
            </Section>

            {/* ── BOT ── */}
            <Section title="Telegram bot">
              {botMsg && <FlashMsg msg={botMsg} />}
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "0.8rem 1rem", marginBottom: "0.8rem", fontSize: "0.9rem" }}>
                {hasBotToken ? (
                  <>
                    Hozirgi bot:{" "}
                    {gym.telegram_bot_username
                      ? <a href={`https://t.me/${gym.telegram_bot_username}`} target="_blank" style={{ color: "var(--accent-primary)" }}>@{gym.telegram_bot_username}</a>
                      : <span style={{ color: "var(--text-muted)" }}>(username yo'q)</span>}
                    {" — "}
                    <span style={{ color: botRunning ? "#22c55e" : "#f59e0b" }}>{botRunning ? "▶ ishlamoqda" : "■ to'xtagan"}</span>
                  </>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>Bot ulanmagan.</span>
                )}
              </div>
              <Field label="Yangi token (BotFather'dan)" full>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <input
                    style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.85rem" }}
                    value={tokenInput}
                    onChange={e => { setTokenInput(e.target.value); setTokenCheck({ checking: false, valid: null }); }}
                    placeholder="1234567890:ABC..."
                  />
                  <button onClick={testToken} disabled={!tokenInput || tokenCheck.checking} style={{
                    padding: "0.7rem 1rem", background: "rgba(0,242,254,0.1)",
                    border: "1px solid rgba(0,242,254,0.3)", borderRadius: 10,
                    color: "var(--accent-primary)", cursor: tokenInput ? "pointer" : "not-allowed", whiteSpace: "nowrap",
                  }}>
                    {tokenCheck.checking ? "..." : "🔍 Tekshir"}
                  </button>
                </div>
              </Field>
              {tokenCheck.valid === true && tokenCheck.bot && (
                <div style={{ background: "rgba(0,200,100,0.1)", color: "#22c55e", padding: "0.6rem 0.8rem", borderRadius: 8, fontSize: "0.85rem", marginTop: "0.5rem" }}>
                  ✅ {tokenCheck.bot.first_name} (@{tokenCheck.bot.username})
                </div>
              )}
              {tokenCheck.valid === false && (
                <div style={{ background: "rgba(255,107,107,0.1)", color: "#ff6b6b", padding: "0.6rem 0.8rem", borderRadius: 8, fontSize: "0.85rem", marginTop: "0.5rem" }}>
                  ❌ {tokenCheck.msg}
                </div>
              )}
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.8rem", flexWrap: "wrap" }}>
                <button onClick={saveToken} disabled={!tokenInput || !tokenCheck.valid || savingBot} className="btn-primary" style={{ padding: "0.6rem 1.2rem" }}>
                  {savingBot ? "..." : "Tokenni saqlash"}
                </button>
                {hasBotToken && <button onClick={reloadBot} disabled={savingBot} style={btnGhost}>↻ Botni qayta yuklash</button>}
                {hasBotToken && <button onClick={clearToken} disabled={savingBot} style={{ ...btnGhost, color: "#ef4444", borderColor: "rgba(255,107,107,0.3)" }}>🗑 Tokenni o'chirish</button>}
              </div>
            </Section>

            {/* ── USERS ── */}
            <Section title="Adminlar">
              {userMsg && <FlashMsg msg={userMsg} />}
              {users.length === 0 && <div style={{ color: "var(--text-muted)" }}>Foydalanuvchi yo'q.</div>}
              {users.map(u => (
                <div key={u.id} style={{ borderTop: "1px solid var(--border-glass)", padding: "0.7rem 0" }}>
                  {editUserId === u.id ? (
                    <div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                        <Field label="Telefon"><input style={inputStyle} value={userForm.phone} onChange={e => setUserForm({ ...userForm, phone: e.target.value })} /></Field>
                        <Field label="Yangi parol (ixt.)"><input style={inputStyle} value={userForm.password} onChange={e => setUserForm({ ...userForm, password: e.target.value })} placeholder="bo'sh qoldirsangiz tegmaydi" /></Field>
                        <Field label="Ism"><input style={inputStyle} value={userForm.firstName} onChange={e => setUserForm({ ...userForm, firstName: e.target.value })} /></Field>
                        <Field label="Familiya"><input style={inputStyle} value={userForm.lastName} onChange={e => setUserForm({ ...userForm, lastName: e.target.value })} /></Field>
                      </div>
                      <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.5rem" }}>
                        <button onClick={saveUser} disabled={savingUser} className="btn-primary" style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}>
                          {savingUser ? "..." : "Saqlash"}
                        </button>
                        <button onClick={() => setEditUserId(null)} style={{ ...btnGhost, padding: "0.5rem 1rem", fontSize: "0.9rem" }}>Bekor</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div><strong>{u.first_name} {u.last_name || ""}</strong> <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>· {u.role}</span></div>
                        <div style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: "0.85rem" }}>{u.phone}</div>
                      </div>
                      <button onClick={() => startEditUser(u)} style={{ ...btnGhost, padding: "0.4rem 0.9rem", fontSize: "0.85rem" }}>✎ Tahrir</button>
                    </div>
                  )}
                </div>
              ))}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "1.5rem", paddingBottom: "1.2rem", borderBottom: "1px solid var(--border-glass)" }}>
      <h3 style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: 1.5, color: "var(--text-muted)", marginBottom: "0.8rem", fontWeight: 600 }}>{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : undefined }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function FlashMsg({ msg }: { msg: { type: "ok" | "err"; text: string } }) {
  const ok = msg.type === "ok";
  return (
    <div style={{
      background: ok ? "rgba(0,200,100,0.1)" : "rgba(255,107,107,0.1)",
      color: ok ? "#22c55e" : "#ff6b6b",
      padding: "0.6rem 0.9rem", borderRadius: 8, fontSize: "0.9rem", marginBottom: "0.7rem",
    }}>{msg.text}</div>
  );
}

// ============================================================
// 3-step wizard for creating a new gym
// ============================================================

type WizardForm = {
  // Step 1: gym info
  name: string;
  slug: string;
  phone: string;
  address: string;
  plan: "trial" | "standard" | "premium";
  // Step 2: admin user
  admin_first_name: string;
  admin_last_name: string;
  admin_phone: string;
  admin_password: string;
  admin_password_confirm: string;
  // Step 3: telegram bot (optional)
  telegram_bot_token: string;
};

function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function CreateGymWizard({ fetchWithAuth, onClose, onCreated, onEnterGym }: {
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onCreated: () => void;
  onEnterGym: (id: number) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [form, setForm] = useState<WizardForm>({
    name: "", slug: "", phone: "", address: "", plan: "standard",
    admin_first_name: "", admin_last_name: "", admin_phone: "",
    admin_password: "", admin_password_confirm: "",
    telegram_bot_token: "",
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [createdGym, setCreatedGym] = useState<{ id: number; slug: string; name: string; bot_username?: string | null } | null>(null);
  const [botCheck, setBotCheck] = useState<{ checking: boolean; valid: boolean | null; bot?: { username: string; first_name: string } | null; msg?: string }>({ checking: false, valid: null });

  // Auto-suggest slug from name
  useEffect(() => {
    if (!slugTouched) {
      setForm(f => ({ ...f, slug: suggestSlug(f.name) }));
    }
  }, [form.name, slugTouched]);

  const set = <K extends keyof WizardForm>(k: K, v: WizardForm[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const validateStep = (s: number): string | null => {
    if (s === 1) {
      if (!form.name.trim()) return "Zal nomini kiriting.";
      if (!form.slug.trim()) return "URL slug kerak.";
      if (!/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(form.slug))
        return "Slug faqat kichik harf, raqam va '-' belgisidan iborat bo'lishi kerak.";
    } else if (s === 2) {
      if (!form.admin_first_name.trim()) return "Admin ismi kerak.";
      if (!form.admin_phone.trim()) return "Admin telefon raqami kerak.";
      if (!/^\+?\d[\d\s()-]{7,}$/.test(form.admin_phone)) return "Telefon noto'g'ri formatda.";
      if (form.admin_password.length < 6) return "Parol kamida 6 belgi bo'lishi kerak.";
      if (form.admin_password !== form.admin_password_confirm) return "Parollar mos kelmayapti.";
    }
    return null;
  };

  const goNext = () => {
    const e = validateStep(step);
    if (e) { setErr(e); return; }
    setErr("");
    setStep(s => (s + 1) as 1|2|3|4);
  };
  const goBack = () => { setErr(""); setStep(s => Math.max(1, s - 1) as 1|2|3|4); };

  const testBotToken = async () => {
    setBotCheck({ checking: true, valid: null });
    try {
      const res = await fetchWithAuth(`${API}/api/super/test-bot-token`, {
        method: "POST",
        body: JSON.stringify({ token: form.telegram_bot_token }),
      });
      const data = await res.json();
      if (data.success && data.valid) {
        setBotCheck({ checking: false, valid: true, bot: data.bot });
      } else {
        setBotCheck({ checking: false, valid: false, msg: data.message || "Token noto'g'ri." });
      }
    } catch (e: any) {
      setBotCheck({ checking: false, valid: false, msg: e.message || "Tekshirib bo'lmadi." });
    }
  };

  const submit = async (skipBot = false) => {
    setErr("");
    setBusy(true);
    try {
      const body: Record<string, string> = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        plan: form.plan,
        admin_phone: form.admin_phone.trim(),
        admin_password: form.admin_password,
        admin_first_name: form.admin_first_name.trim(),
      };
      if (form.phone) body.phone = form.phone.trim();
      if (form.address) body.address = form.address.trim();
      if (form.admin_last_name) body.admin_last_name = form.admin_last_name.trim();
      if (!skipBot && form.telegram_bot_token && botCheck.valid) {
        body.telegram_bot_token = form.telegram_bot_token.trim();
      }
      const res = await fetchWithAuth(`${API}/api/super/gyms`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) {
        setErr(data.message || "Yaratib bo'lmadi.");
        return;
      }
      setCreatedGym({
        id: data.gym.id,
        slug: data.gym.slug,
        name: data.gym.name,
        bot_username: data.gym.telegram_bot_username,
      });
      setStep(4);
    } catch (e: any) {
      setErr(e.message || "Yaratib bo'lmadi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={modalOverlay}>
      <div className="glass-card" style={modalCard}>
        {step !== 4 && <Stepper current={step} />}

        {err && (
          <div style={{ background: "rgba(255,107,107,0.1)", color: "#ff6b6b", padding: "0.7rem 1rem", borderRadius: 10, marginBottom: "1rem", fontSize: "0.9rem" }}>
            {err}
          </div>
        )}

        {step === 1 && (
          <Step1 form={form} set={set} setSlugTouched={setSlugTouched} />
        )}
        {step === 2 && (
          <Step2 form={form} set={set} />
        )}
        {step === 3 && (
          <Step3
            form={form} set={set}
            botCheck={botCheck} setBotCheck={setBotCheck}
            onTestToken={testBotToken}
          />
        )}
        {step === 4 && createdGym && (
          <Step4Success
            gym={createdGym}
            onEnter={() => { onEnterGym(createdGym.id); }}
            onAddAnother={() => {
              setForm({
                name: "", slug: "", phone: "", address: "", plan: "standard",
                admin_first_name: "", admin_last_name: "", admin_phone: "",
                admin_password: "", admin_password_confirm: "",
                telegram_bot_token: "",
              });
              setSlugTouched(false);
              setBotCheck({ checking: false, valid: null });
              setCreatedGym(null);
              setStep(1);
            }}
            onClose={() => { onCreated(); }}
          />
        )}

        {step !== 4 && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.5rem", borderTop: "1px solid var(--border-glass)", paddingTop: "1.2rem" }}>
            <div>
              {step > 1
                ? <button onClick={goBack} style={btnGhost}>← Orqaga</button>
                : <button onClick={onClose} style={btnGhost}>Bekor qilish</button>}
            </div>
            <div style={{ display: "flex", gap: "0.6rem" }}>
              {step === 3 && (
                <button onClick={() => submit(true)} disabled={busy} style={btnGhost}>
                  Botsiz tugatish
                </button>
              )}
              {step < 3 && (
                <button onClick={goNext} className="btn-primary" style={{ padding: "0.7rem 1.4rem" }}>
                  Davom →
                </button>
              )}
              {step === 3 && (
                <button
                  onClick={() => submit(false)}
                  disabled={busy || (!!form.telegram_bot_token && !botCheck.valid)}
                  className="btn-primary"
                  style={{ padding: "0.7rem 1.4rem" }}
                >
                  {busy ? "Yaratilmoqda..." : "Tugatish"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step components ─────────────────────────────────────────

function Stepper({ current }: { current: number }) {
  const steps = [
    { n: 1, label: "Zal" },
    { n: 2, label: "Admin" },
    { n: 3, label: "Bot (ixt.)" },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: "1.5rem", gap: "0.5rem" }}>
      {steps.map((s, i) => (
        <div key={s.n} style={{ display: "flex", alignItems: "center", flex: 1 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 99,
            background: current >= s.n ? "var(--accent-primary)" : "rgba(255,255,255,0.06)",
            color: current >= s.n ? "#000" : "var(--text-muted)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 600, fontSize: "0.9rem", flexShrink: 0,
          }}>{s.n}</div>
          <span style={{ marginLeft: "0.5rem", fontSize: "0.85rem", color: current >= s.n ? "var(--text-main)" : "var(--text-muted)" }}>
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <div style={{ flex: 1, height: 2, margin: "0 0.7rem", background: current > s.n ? "var(--accent-primary)" : "rgba(255,255,255,0.06)" }} />
          )}
        </div>
      ))}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0.75rem 0.9rem",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid var(--border-glass)",
  borderRadius: 10, color: "var(--text-main)", outline: "none",
  fontSize: "0.95rem",
};
const labelStyle: React.CSSProperties = {
  display: "block", color: "var(--text-muted)",
  fontSize: "0.78rem", marginBottom: "0.4rem",
  textTransform: "uppercase", letterSpacing: "1px",
};

function Step1({ form, set, setSlugTouched }: {
  form: WizardForm;
  set: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
  setSlugTouched: (b: boolean) => void;
}) {
  return (
    <div>
      <h2 style={{ fontSize: "1.3rem", marginBottom: "0.3rem" }}>Zal haqida</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
        Asosiy ma'lumotlar. Slug — bu zalning sayt manzilidagi qisqa nomi.
      </p>

      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Zal nomi *</label>
        <input
          autoFocus
          type="text"
          placeholder="Onson Gym"
          value={form.name}
          onChange={e => set("name", e.target.value)}
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>URL slug *</label>
        <input
          type="text"
          placeholder="onson"
          value={form.slug}
          onChange={e => { setSlugTouched(true); set("slug", e.target.value.toLowerCase()); }}
          style={inputStyle}
        />
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
          Adminlar shu nom bilan kirishadi: <strong style={{ color: "var(--text-main)", fontFamily: "monospace" }}>gym.bizdaoson.uz/login</strong>
          {" → "}slug: <code style={{ fontFamily: "monospace", color: "var(--accent-primary)" }}>{form.slug || "..."}</code>
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        <div>
          <label style={labelStyle}>Telefon (ixt.)</label>
          <input type="tel" placeholder="+998 90 000 00 00" value={form.phone} onChange={e => set("phone", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Manzil (ixt.)</label>
          <input type="text" placeholder="Toshkent, ..." value={form.address} onChange={e => set("address", e.target.value)} style={inputStyle} />
        </div>
      </div>

      <div>
        <label style={labelStyle}>Tarif</label>
        <select value={form.plan} onChange={e => set("plan", e.target.value as WizardForm["plan"])} style={{ ...inputStyle, cursor: "pointer" }}>
          <option value="trial">Trial (sinov muddati)</option>
          <option value="standard">Standard</option>
          <option value="premium">Premium</option>
        </select>
      </div>
    </div>
  );
}

function Step2({ form, set }: {
  form: WizardForm;
  set: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
}) {
  const [showPwd, setShowPwd] = useState(false);
  return (
    <div>
      <h2 style={{ fontSize: "1.3rem", marginBottom: "0.3rem" }}>Birinchi admin</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
        Bu odam zalning egasi. Tizimga shu telefon va parol bilan kiradi.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        <div>
          <label style={labelStyle}>Ism *</label>
          <input autoFocus type="text" placeholder="Asadbek" value={form.admin_first_name} onChange={e => set("admin_first_name", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Familiya (ixt.)</label>
          <input type="text" placeholder="Nazarov" value={form.admin_last_name} onChange={e => set("admin_last_name", e.target.value)} style={inputStyle} />
        </div>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Telefon *</label>
        <input type="tel" placeholder="+998 90 123 45 67" value={form.admin_phone} onChange={e => set("admin_phone", e.target.value)} style={inputStyle} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <div>
          <label style={labelStyle}>Parol * (≥ 6 belgi)</label>
          <input type={showPwd ? "text" : "password"} placeholder="••••••" value={form.admin_password} onChange={e => set("admin_password", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Parolni tasdiqlang *</label>
          <input type={showPwd ? "text" : "password"} placeholder="••••••" value={form.admin_password_confirm} onChange={e => set("admin_password_confirm", e.target.value)} style={inputStyle} />
        </div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.5rem", color: "var(--text-muted)", fontSize: "0.85rem", cursor: "pointer" }}>
        <input type="checkbox" checked={showPwd} onChange={e => setShowPwd(e.target.checked)} />
        Parolni ko'rsatish
      </label>
    </div>
  );
}

function Step3({ form, set, botCheck, setBotCheck, onTestToken }: {
  form: WizardForm;
  set: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
  botCheck: { checking: boolean; valid: boolean | null; bot?: { username: string; first_name: string } | null; msg?: string };
  setBotCheck: (s: any) => void;
  onTestToken: () => void;
}) {
  return (
    <div>
      <h2 style={{ fontSize: "1.3rem", marginBottom: "0.3rem" }}>Telegram bot <span style={{ color: "var(--text-muted)", fontSize: "0.9rem", fontWeight: 400 }}>(ixtiyoriy)</span></h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
        @BotFather'da bot yarating va token oling. Hozir o'tkazib yuborib, keyinroq qo'shsangiz ham bo'ladi.
      </p>

      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Bot token</label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type="text"
            placeholder="1234567890:ABC..."
            value={form.telegram_bot_token}
            onChange={e => {
              set("telegram_bot_token", e.target.value);
              setBotCheck({ checking: false, valid: null });
            }}
            style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.88rem" }}
          />
          <button
            onClick={onTestToken}
            disabled={!form.telegram_bot_token || botCheck.checking}
            style={{
              padding: "0.75rem 1.2rem",
              background: "rgba(0,242,254,0.1)",
              border: "1px solid rgba(0,242,254,0.3)",
              borderRadius: 10, color: "var(--accent-primary)",
              cursor: form.telegram_bot_token && !botCheck.checking ? "pointer" : "not-allowed",
              whiteSpace: "nowrap",
            }}
          >
            {botCheck.checking ? "Tekshirilmoqda..." : "🔍 Tekshirish"}
          </button>
        </div>
      </div>

      {botCheck.valid === true && botCheck.bot && (
        <div style={{ background: "rgba(0,200,100,0.1)", border: "1px solid rgba(0,200,100,0.3)", color: "#22c55e", padding: "0.8rem 1rem", borderRadius: 10, fontSize: "0.9rem" }}>
          ✅ Bot tasdiqlandi: <strong>{botCheck.bot.first_name}</strong>{" "}
          <span style={{ color: "var(--text-muted)" }}>(@{botCheck.bot.username})</span>
        </div>
      )}
      {botCheck.valid === false && (
        <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff6b6b", padding: "0.8rem 1rem", borderRadius: 10, fontSize: "0.9rem" }}>
          ❌ {botCheck.msg || "Token noto'g'ri."}
        </div>
      )}

      <div style={{ marginTop: "1.5rem", padding: "1rem", background: "rgba(255,255,255,0.03)", borderRadius: 10, fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
        <strong>Bot qanday yaratiladi:</strong>
        <ol style={{ marginTop: "0.4rem", paddingLeft: "1.2rem" }}>
          <li>Telegram'da <a href="https://t.me/BotFather" target="_blank" style={{ color: "var(--accent-primary)" }}>@BotFather</a>'ga kiring</li>
          <li><code>/newbot</code> buyrug'ini yuboring</li>
          <li>Bot uchun nom va username kiriting</li>
          <li>Olingan tokenni shu yerga joylashtiring</li>
        </ol>
      </div>
    </div>
  );
}

function Step4Success({ gym, onEnter, onAddAnother, onClose }: {
  gym: { id: number; slug: string; name: string; bot_username?: string | null };
  onEnter: () => void;
  onAddAnother: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const loginUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div style={{ textAlign: "center", padding: "1rem 0" }}>
      <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>🎉</div>
      <h2 style={{ fontSize: "1.5rem", marginBottom: "0.4rem" }}>{gym.name} yaratildi!</h2>
      <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem" }}>
        Admin endi tizimga kirishi mumkin.
      </p>

      <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "1.2rem", textAlign: "left", marginBottom: "1.5rem" }}>
        <InfoRow label="Login URL" value={loginUrl} onCopy={() => copy(loginUrl, "url")} copied={copied === "url"} />
        <InfoRow label="Slug" value={gym.slug} onCopy={() => copy(gym.slug, "slug")} copied={copied === "slug"} mono />
        {gym.bot_username && (
          <InfoRow
            label="Telegram bot"
            value={`@${gym.bot_username}`}
            onCopy={() => copy(`@${gym.bot_username}`, "bot")}
            copied={copied === "bot"}
          />
        )}
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: "0.8rem", marginBottom: 0 }}>
          📌 Adminga login URL'ni va o'zi belgilagan parolni yuboring. Birinchi kirgandan keyin parolni o'zgartirsin.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.7rem", justifyContent: "center", flexWrap: "wrap" }}>
        <button onClick={onEnter} className="btn-primary" style={{ padding: "0.8rem 1.5rem" }}>
          Zalga kirish →
        </button>
        <button onClick={onAddAnother} style={btnGhost}>+ Yana zal qo'shish</button>
        <button onClick={onClose} style={btnGhost}>Yopish</button>
      </div>
    </div>
  );
}

function InfoRow({ label, value, onCopy, copied, mono }: {
  label: string; value: string; onCopy: () => void; copied: boolean; mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "0.72rem", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: 1 }}>{label}</div>
        <div style={{ fontSize: "0.95rem", fontFamily: mono ? "monospace" : undefined, marginTop: "0.15rem", overflowX: "auto", whiteSpace: "nowrap" }}>
          {value}
        </div>
      </div>
      <button onClick={onCopy} style={{
        background: "transparent", border: "1px solid var(--border-glass)",
        borderRadius: 6, color: copied ? "#22c55e" : "var(--text-muted)",
        padding: "0.3rem 0.7rem", cursor: "pointer", fontSize: "0.8rem",
      }}>
        {copied ? "✓ Nusxa olindi" : "Nusxa ol"}
      </button>
    </div>
  );
}

const modalOverlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
  backdropFilter: "blur(8px)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: "2rem",
};
const modalCard: React.CSSProperties = {
  width: "100%", maxWidth: 600, padding: "2rem",
  maxHeight: "92vh", overflowY: "auto",
};
