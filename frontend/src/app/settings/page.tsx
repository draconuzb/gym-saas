"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

const API = process.env.NEXT_PUBLIC_API_URL || "";

export default function Settings() {
  const { token, user, loading, fetchWithAuth } = useAuth();
  const { t } = useLocale();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!token) return;
    setLoadError("");
    fetchWithAuth(`${API}/api/settings`)
      .then(r => r.json())
      .then(d => { if (d.success) setSettings(d.data); })
      .catch(() => { setLoadError(t("common.serverError")); });
  }, [token]);

  const update = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/api/settings`, { method: "PUT", body: JSON.stringify(settings) });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setLoadError(data.message || t("common.saveFailed"));
      }
    } catch { setLoadError(t("common.networkError")); }
    setSaving(false);
  };

  const changePassword = async () => {
    setPwMsg(null);
    if (!currentPassword || !newPassword) {
      setPwMsg({ text: t("settings.fillAllFields"), ok: false });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMsg({ text: t("settings.passwordsMismatch"), ok: false });
      return;
    }
    if (newPassword.length < 6) {
      setPwMsg({ text: t("settings.passwordTooShort"), ok: false });
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/api/auth/change-password`, {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        setPwMsg({ text: t("settings.passwordChanged"), ok: true });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setTimeout(() => setPwMsg(null), 4000);
      } else {
        setPwMsg({ text: data.message || t("settings.passwordChangeFailed"), ok: false });
      }
    } catch {
      setPwMsg({ text: t("common.networkError"), ok: false });
    }
    setPwSaving(false);
  };

  const inputStyle = {
    width: "100%", padding: "0.75rem 1rem",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid var(--border-glass)",
    borderRadius: "10px",
    color: "var(--text-main)",
    fontSize: "0.95rem",
    outline: "none",
  };

  const labelStyle = {
    color: "var(--text-muted)", fontSize: "0.8rem", display: "block" as const,
    marginBottom: "0.4rem", textTransform: "uppercase" as const, letterSpacing: "1px",
  };

  if (loading) return <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("common.loading")}</div>;

  if (user?.role !== "admin") {
    return <div style={{ padding: "3rem", color: "#ff6b6b", fontWeight: 700 }}>{t("common.accessDenied")}</div>;
  }

  return (
    <>
      {loadError && (
        <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff6b6b", padding: "0.8rem 1rem", borderRadius: "12px", marginBottom: "1rem", textAlign: "center" }}>{loadError}</div>
      )}

      <header className="header">
        <h1>{t("settings.title")}</h1>
        <button className="btn-primary" onClick={save} disabled={saving}
          style={{ opacity: saving ? 0.7 : 1 }}>
          {saving ? t("settings.saving") : saved ? t("settings.saved") : t("settings.save")}
        </button>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "2rem" }}>

        <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <h2 style={{ fontWeight: 700, fontSize: "1.2rem", borderBottom: "1px solid var(--border-glass)", paddingBottom: "1rem" }}>{t("settings.gymProfile")}</h2>
          <div>
            <label style={labelStyle}>{t("settings.gymName")}</label>
            <input value={settings.gym_name || ""} onChange={e => update("gym_name", e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t("settings.supportPhone")}</label>
            <input value={settings.support_phone || ""} onChange={e => update("support_phone", e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t("settings.supportTelegram")}</label>
            <input value={settings.support_username || ""} onChange={e => update("support_username", e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
          <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <h2 style={{ fontWeight: 700, fontSize: "1.2rem", borderBottom: "1px solid var(--border-glass)", paddingBottom: "1rem" }}>{t("settings.integrations")}</h2>
            {[
              { name: "Telegram Bot", key: "TELEGRAM_BOT_TOKEN", connected: true },
              { name: "Payme Gateway", key: "PAYME_MERCHANT_ID", connected: false },
              { name: "Click Gateway", key: "CLICK_SERVICE_ID", connected: false },
            ].map(item => (
              <div key={item.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontWeight: 600 }}>{item.name}</p>
                  <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{item.key}</p>
                </div>
                <span style={{
                  padding: "0.25rem 0.8rem", borderRadius: "20px", fontSize: "0.8rem", fontWeight: 700,
                  background: item.connected ? "rgba(0,242,254,0.1)" : "rgba(255,107,107,0.1)",
                  color: item.connected ? "var(--accent-primary)" : "#ff6b6b",
                }}>
                  {item.connected ? t("settings.connected") : t("settings.notConnected")}
                </span>
              </div>
            ))}
          </div>

          <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <h2 style={{ fontWeight: 700, fontSize: "1.2rem", borderBottom: "1px solid var(--border-glass)", paddingBottom: "1rem" }}>{t("settings.notifications")}</h2>
            {[
              { key: "notify_expiry", label: t("settings.notifyExpiry"), defaultVal: "true" },
              { key: "notify_receipts", label: t("settings.notifyReceipts"), defaultVal: "true" },
              { key: "notify_daily_summary", label: t("settings.notifyDailySummary"), defaultVal: "false" },
            ].map(item => {
              const isOn = (settings[item.key] || item.defaultVal) === "true";
              return (
                <div key={item.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>{item.label}</p>
                  <div onClick={() => update(item.key, isOn ? "false" : "true")} style={{
                    width: "48px", height: "26px", borderRadius: "13px",
                    background: isOn ? "var(--gradient-action)" : "rgba(255,255,255,0.1)",
                    cursor: "pointer", position: "relative",
                    boxShadow: isOn ? "var(--shadow-glow)" : "none",
                  }}>
                    <div style={{
                      position: "absolute", top: "3px",
                      left: isOn ? "24px" : "3px",
                      width: "20px", height: "20px",
                      borderRadius: "50%", background: "white",
                      transition: "left 0.2s",
                    }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <h2 style={{ fontWeight: 700, fontSize: "1.2rem", borderBottom: "1px solid var(--border-glass)", paddingBottom: "1rem" }}>{t("settings.changePassword")}</h2>
            <div>
              <label style={labelStyle}>{t("settings.currentPassword")}</label>
              <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} style={inputStyle} placeholder={t("settings.enterCurrentPw")} />
            </div>
            <div>
              <label style={labelStyle}>{t("settings.newPassword")}</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={inputStyle} placeholder={t("settings.enterNewPw")} />
            </div>
            <div>
              <label style={labelStyle}>{t("settings.confirmPassword")}</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} style={inputStyle} placeholder={t("settings.enterConfirmPw")} />
            </div>
            {pwMsg && (
              <p style={{ fontSize: "0.85rem", color: pwMsg.ok ? "var(--accent-primary)" : "#ff6b6b" }}>
                {pwMsg.text}
              </p>
            )}
            <button className="btn-primary" onClick={changePassword} disabled={pwSaving}
              style={{ opacity: pwSaving ? 0.7 : 1, alignSelf: "flex-start" }}>
              {pwSaving ? t("settings.saving") : t("settings.changePassword")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
