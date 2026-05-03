"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0.7rem", background: "rgba(255,255,255,0.05)",
  border: "1px solid var(--border-glass)", borderRadius: "10px",
  color: "var(--text-main)", outline: "none",
};

function formatAmount(amount: number): string {
  return amount.toLocaleString("uz-UZ") + " so'm";
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  return d.toLocaleDateString("uz-UZ", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  return d.toLocaleDateString("uz-UZ", { year: "numeric", month: "2-digit", day: "2-digit" }) +
    " " + d.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
}

function calcExpiryDate(activatedAt: string | null, totalDays: number): string {
  if (!activatedAt) return "\u2014";
  const d = new Date(activatedAt);
  d.setDate(d.getDate() + totalDays);
  return formatDate(d.toISOString());
}

export default function MemberProfile() {
  const { token, loading, fetchWithAuth } = useAuth();
  const { t } = useLocale();
  const params = useParams();
  const router = useRouter();
  const id = params.id;
  const [member, setMember] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);

  // Edit state
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "", phone: "" });
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Renew state
  const [showRenew, setShowRenew] = useState(false);
  const [plans, setPlans] = useState<any[]>([]);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [renewSubmitting, setRenewSubmitting] = useState(false);

  // Add/Remove days state
  const [showAddDays, setShowAddDays] = useState(false);
  const [showRemoveDays, setShowRemoveDays] = useState(false);
  const [daysInput, setDaysInput] = useState("");
  const [daysSubmitting, setDaysSubmitting] = useState(false);

  const loadMember = useCallback(() => {
    if (!token) return;
    fetchWithAuth(`${API}/api/members/${id}`)
      .then(r => r.json())
      .then(data => { if (data.success) setMember(data.data); else setNotFound(true); })
      .catch(() => { setNotFound(true); });
  }, [id, token, fetchWithAuth]);

  useEffect(() => { loadMember(); }, [loadMember]);

  const openEdit = () => {
    if (member) {
      setEditForm({ firstName: member.first_name || "", lastName: member.last_name || "", phone: member.phone || "" });
    }
    setShowEdit(true);
    setShowRenew(false);
    setShowAddDays(false);
    setShowRemoveDays(false);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setEditSubmitting(true);
    try {
      const res = await fetchWithAuth(`${API}/api/members/${id}`, {
        method: "PUT",
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (data.success) {
        setShowEdit(false);
        loadMember();
      }
    } catch { /* ignore */ }
    setEditSubmitting(false);
  };

  const openRenew = async () => {
    setShowRenew(true);
    setShowEdit(false);
    setShowAddDays(false);
    setShowRemoveDays(false);
    if (!token) return;
    try {
      const res = await fetchWithAuth(`${API}/api/plans`);
      const data = await res.json();
      if (data.success) {
        setPlans(data.data);
        if (data.data.length > 0) setSelectedPlan(data.data[0].id);
      }
    } catch { /* ignore */ }
  };

  const handleRenewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedPlan) return;
    setRenewSubmitting(true);
    try {
      const res = await fetchWithAuth(`${API}/api/members/${id}/subscribe`, {
        method: "POST",
        body: JSON.stringify({ planId: selectedPlan }),
      });
      const data = await res.json();
      if (data.success) {
        setShowRenew(false);
        loadMember();
      }
    } catch { /* ignore */ }
    setRenewSubmitting(false);
  };

  const handleBlockToggle = async () => {
    if (!token || !member) return;
    const isCurrentlyActive = member.is_active !== false;
    if (isCurrentlyActive) {
      if (!confirm(`${member.first_name} ${t("members.confirmBlockMember")}`)) return;
    }
    try {
      const res = await fetchWithAuth(`${API}/api/members/${id}`, {
        method: "PUT",
        body: JSON.stringify({ isActive: !isCurrentlyActive }),
      });
      const data = await res.json();
      if (data.success) loadMember();
    } catch { /* ignore */ }
  };

  const handleFreezeToggle = async () => {
    if (!token || !member) return;
    const sub = member.subscription;
    const isFrozen = sub?.status === "frozen";
    const endpoint = isFrozen ? "unfreeze" : "freeze";
    const confirmMsg = isFrozen
      ? `${member.first_name} ${t("members.confirmUnfreeze")}`
      : `${member.first_name} ${t("members.confirmFreeze")}`;
    if (!confirm(confirmMsg)) return;
    try {
      const res = await fetchWithAuth(`${API}/api/members/${id}/${endpoint}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) loadMember();
      else alert(data.message || t("common.error"));
    } catch { alert(t("common.serverError")); }
  };

  const handleAddDays = async () => {
    if (!token) return;
    const days = parseInt(daysInput);
    if (!days || days < 1 || days > 365) return;
    setDaysSubmitting(true);
    try {
      const res = await fetchWithAuth(`${API}/api/members/${id}/add-days`, {
        method: "POST",
        body: JSON.stringify({ days }),
      });
      const data = await res.json();
      if (data.success) {
        setShowAddDays(false);
        setDaysInput("");
        loadMember();
      }
    } catch { /* ignore */ }
    setDaysSubmitting(false);
  };

  const handleRemoveDays = async () => {
    if (!token) return;
    const days = parseInt(daysInput);
    if (!days || days < 1 || days > 365) return;
    setDaysSubmitting(true);
    try {
      const res = await fetchWithAuth(`${API}/api/members/${id}/remove-days`, {
        method: "POST",
        body: JSON.stringify({ days }),
      });
      const data = await res.json();
      if (data.success) {
        setShowRemoveDays(false);
        setDaysInput("");
        loadMember();
      }
    } catch { /* ignore */ }
    setDaysSubmitting(false);
  };

  const handleDeleteMember = async () => {
    if (!token) return;
    if (!confirm(`${member.first_name} ${t("members.confirmDeleteMember")}`)) return;
    if (!confirm(t("members.confirmDeleteAction"))) return;
    try {
      const res = await fetchWithAuth(`${API}/api/members/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        router.push("/members");
      }
    } catch { /* ignore */ }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  if (notFound) {
    return <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("members.notFound")}</div>;
  }

  if (loading || !member) {
    return (
      <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("common.loading")}</div>
    );
  }

  const initials = `${(member.first_name || "")[0] || ""}${(member.last_name || "")[0] || ""}`.toUpperCase();
  const sub = member.subscription;
  const subStatus = sub?.status || "expired";
  const daysLeft = sub
    ? (sub.visit_quota === null ? null : Math.max(0, sub.total_days - sub.days_used))
    : 0;
  const expiryDate = sub
    ? (sub.expires_at ? formatDate(sub.expires_at) : calcExpiryDate(sub.activated_at, sub.total_days))
    : "\u2014";
  const isBlocked = member.is_active === false;

  const quickDays = [5, 10, 12, 30];

  return (
    <>
      <header className="header">
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <Link href="/members" style={{ color: "var(--text-muted)", textDecoration: "none", fontSize: "0.9rem" }}>{t("members.backToList")}</Link>
          <h1>{member.first_name} {member.last_name || ""}</h1>
          {isBlocked && (
            <span style={{
              padding: "0.2rem 0.7rem", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 600,
              background: "rgba(255,165,0,0.15)", color: "#ffa500",
            }}>{t("members.blockedBadge")}</span>
          )}
        </div>
        <button className="btn-primary" onClick={openEdit}>{t("members.editMember")}</button>
      </header>

      {/* Edit Member Form */}
      {showEdit && (
        <div className="glass-card" style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ fontWeight: 700, marginBottom: "1rem" }}>{t("members.editMember")}</h3>
          <form onSubmit={handleEditSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <input style={inputStyle} placeholder={`${t("members.firstName")} *`} required value={editForm.firstName}
              onChange={e => setEditForm({ ...editForm, firstName: e.target.value })} />
            <input style={inputStyle} placeholder={t("members.lastName")} value={editForm.lastName}
              onChange={e => setEditForm({ ...editForm, lastName: e.target.value })} />
            <input style={inputStyle} placeholder={t("members.phone")} value={editForm.phone}
              onChange={e => setEditForm({ ...editForm, phone: e.target.value })} />
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <button type="submit" className="btn-primary" disabled={editSubmitting} style={{ flex: 1 }}>
                {editSubmitting ? t("settings.saving") : t("settings.save")}
              </button>
              <button type="button" onClick={() => setShowEdit(false)}
                style={{ flex: 1, padding: "0.6rem", background: "transparent", border: "1px solid var(--border-glass)", borderRadius: "10px", color: "var(--text-main)", cursor: "pointer", fontWeight: 600 }}>
                {t("members.cancel")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Renew Subscription Form */}
      {showRenew && (
        <div className="glass-card" style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ fontWeight: 700, marginBottom: "1rem" }}>{t("members.renewSub")}</h3>
          <form onSubmit={handleRenewSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <select style={inputStyle} value={selectedPlan} onChange={e => setSelectedPlan(e.target.value)} required>
              <option value="" disabled>{t("members.selectPlan")}</option>
              {plans.map(plan => (
                <option key={plan.id} value={plan.id}>{plan.name} - {plan.days} {t("common.days")} - {plan.price.toLocaleString("uz-UZ")} so&apos;m</option>
              ))}
            </select>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <button type="submit" className="btn-primary" disabled={renewSubmitting} style={{ flex: 1 }}>
                {renewSubmitting ? t("common.processing") : t("members.renew")}
              </button>
              <button type="button" onClick={() => setShowRenew(false)}
                style={{ flex: 1, padding: "0.6rem", background: "transparent", border: "1px solid var(--border-glass)", borderRadius: "10px", color: "var(--text-main)", cursor: "pointer", fontWeight: 600 }}>
                {t("members.cancel")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Days Form */}
      {showAddDays && (
        <div className="glass-card" style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ fontWeight: 700, marginBottom: "1rem" }}>{t("members.addDays")}</h3>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            {quickDays.map(d => (
              <button
                key={d}
                onClick={() => setDaysInput(String(d))}
                style={{
                  padding: "0.4rem 1rem",
                  borderRadius: "20px",
                  border: daysInput === String(d) ? "none" : "1px solid var(--border-glass)",
                  background: daysInput === String(d) ? "var(--gradient-action)" : "rgba(255,255,255,0.05)",
                  color: "var(--text-main)",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {d} {t("common.days")}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <input
              type="number"
              min="1"
              max="365"
              placeholder={t("members.numberOfDays")}
              value={daysInput}
              onChange={e => setDaysInput(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={handleAddDays}
              disabled={daysSubmitting || !daysInput}
              className="btn-primary"
              style={{ padding: "0.7rem 1.5rem" }}
            >
              {daysSubmitting ? t("members.adding") : t("common.add")}
            </button>
            <button
              onClick={() => { setShowAddDays(false); setDaysInput(""); }}
              style={{ padding: "0.7rem 1rem", background: "transparent", border: "1px solid var(--border-glass)", borderRadius: "10px", color: "var(--text-main)", cursor: "pointer", fontWeight: 600 }}
            >
              {t("members.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Remove Days Form */}
      {showRemoveDays && (
        <div className="glass-card" style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ fontWeight: 700, marginBottom: "1rem" }}>{t("members.removeDays")}</h3>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <input
              type="number"
              min="1"
              max="365"
              placeholder={t("members.numberOfDaysToRemove")}
              value={daysInput}
              onChange={e => setDaysInput(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={handleRemoveDays}
              disabled={daysSubmitting || !daysInput}
              style={{
                padding: "0.7rem 1.5rem",
                borderRadius: "10px",
                border: "none",
                background: "rgba(255, 107, 107, 0.2)",
                color: "#ff6b6b",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {daysSubmitting ? t("members.removing") : t("common.remove")}
            </button>
            <button
              onClick={() => { setShowRemoveDays(false); setDaysInput(""); }}
              style={{ padding: "0.7rem 1rem", background: "transparent", border: "1px solid var(--border-glass)", borderRadius: "10px", color: "var(--text-main)", cursor: "pointer", fontWeight: 600 }}
            >
              {t("members.cancel")}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "2rem" }}>

        {/* Left: Profile card */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="glass-card" style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
            <div style={{
              width: "80px", height: "80px", borderRadius: "50%",
              background: isBlocked ? "rgba(255,165,0,0.1)" : "rgba(0,242,254,0.1)",
              border: `2px solid ${isBlocked ? "#ffa500" : "var(--accent-primary)"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1.8rem", fontWeight: 800, color: isBlocked ? "#ffa500" : "var(--accent-primary)"
            }}>
              {initials}
            </div>
            <div>
              <h2 style={{ fontWeight: 700 }}>{member.first_name} {member.last_name || ""}</h2>
              <p style={{ color: "var(--text-muted)", marginTop: "0.25rem" }}>{member.phone || "\u2014"}</p>
            </div>
            <span style={{
              padding: "0.3rem 1rem", borderRadius: "20px", fontSize: "0.85rem", fontWeight: 600,
              background: isBlocked
                ? "rgba(255,165,0,0.1)"
                : subStatus === "active"
                  ? "rgba(0,242,254,0.1)"
                  : "rgba(255,107,107,0.1)",
              color: isBlocked
                ? "#ffa500"
                : subStatus === "active"
                  ? "var(--accent-primary)"
                  : "#ff6b6b"
            }}>{isBlocked ? t("members.blocked") : subStatus === "active" ? t("common.active") : t("common.expired")}</span>

            {/* Action Buttons */}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center", width: "100%", marginTop: "0.5rem" }}>
              <button
                onClick={handleBlockToggle}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: "10px",
                  border: "none",
                  background: isBlocked ? "rgba(52, 199, 89, 0.2)" : "rgba(255, 165, 0, 0.2)",
                  color: isBlocked ? "#34c759" : "#ffa500",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  flex: 1,
                }}
              >
                {isBlocked ? t("members.unblock") : t("members.block")}
              </button>
              {member?.subscription && (
                <button
                  onClick={handleFreezeToggle}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "10px",
                    border: "none",
                    background: member.subscription.status === "frozen" ? "rgba(0,242,254,0.2)" : "rgba(100,160,255,0.2)",
                    color: member.subscription.status === "frozen" ? "var(--accent-primary)" : "#64a0ff",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    flex: 1,
                  }}
                >
                  {member.subscription.status === "frozen" ? t("members.unfreeze") : t("members.freeze")}
                </button>
              )}
              <button
                onClick={() => { setShowAddDays(true); setShowRemoveDays(false); setShowEdit(false); setShowRenew(false); setDaysInput(""); }}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "10px",
                  border: "1px solid var(--border-glass)",
                  background: "rgba(255,255,255,0.05)",
                  color: "var(--text-main)",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                {t("members.plusDays")}
              </button>
              <button
                onClick={() => { setShowRemoveDays(true); setShowAddDays(false); setShowEdit(false); setShowRenew(false); setDaysInput(""); }}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "10px",
                  border: "1px solid var(--border-glass)",
                  background: "rgba(255,255,255,0.05)",
                  color: "var(--text-main)",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                {t("members.minusDays")}
              </button>
            </div>
          </div>

          <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <h3 style={{ fontWeight: 700, borderBottom: "1px solid var(--border-glass)", paddingBottom: "0.75rem" }}>{t("members.membership")}</h3>
            {[
              { label: t("common.plan"), value: sub?.plan_name || "\u2014" },
              { label: t("common.startDate"), value: sub ? formatDate(sub.activated_at) : "\u2014" },
              { label: t("common.expiryDate"), value: expiryDate },
              { label: t("common.daysLeft"), value: sub ? (daysLeft === null ? t("common.unlimited") : `${daysLeft} / ${sub.total_days}`) : "\u2014" },
              { label: t("members.totalVisits"), value: String(member.totalVisits ?? 0) },
            ].map(row => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                <span style={{ color: "var(--text-muted)" }}>{row.label}</span>
                <span style={{ fontWeight: 600 }}>{row.value}</span>
              </div>
            ))}

            {/* Telegram ID row */}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", alignItems: "center" }}>
              <span style={{ color: "var(--text-muted)" }}>{t("members.telegramId")}</span>
              {member.telegram_id ? (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <a
                    href={`https://t.me/user?id=${member.telegram_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--accent-primary)", textDecoration: "none", fontWeight: 600, fontSize: "0.9rem" }}
                  >
                    {member.telegram_id}
                  </a>
                  <button
                    onClick={() => copyToClipboard(String(member.telegram_id))}
                    title="Copy Telegram ID"
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border-glass)",
                      color: "var(--text-muted)",
                      borderRadius: "6px",
                      padding: "0.2rem 0.4rem",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                      lineHeight: 1,
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                </div>
              ) : (
                <span style={{ fontWeight: 600 }}>{"\u2014"}</span>
              )}
            </div>

            <button className="btn-primary" style={{ width: "100%", marginTop: "0.5rem" }} onClick={openRenew}>{t("members.renewSub")}</button>
          </div>

          {/* Delete Member Button */}
          <button
            onClick={handleDeleteMember}
            style={{
              width: "100%",
              padding: "0.75rem",
              borderRadius: "12px",
              border: "1px solid rgba(255, 59, 48, 0.3)",
              background: "rgba(255, 59, 48, 0.1)",
              color: "#ff3b30",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            {t("members.delete")}
          </button>
        </div>

        {/* Right: Activity */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* Payment History */}
          <div className="glass-card">
            <h3 style={{ fontWeight: 700, marginBottom: "1.25rem" }}>{t("members.paymentHistory")}</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                  <th style={{ padding: "0.5rem 0" }}>{t("payments.invoice")}</th>
                  <th style={{ padding: "0.5rem 0" }}>{t("common.amount")}</th>
                  <th style={{ padding: "0.5rem 0" }}>{t("payments.gateway")}</th>
                  <th style={{ padding: "0.5rem 0" }}>{t("common.date")}</th>
                  <th style={{ padding: "0.5rem 0" }}>{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {(member.payments || []).map((p: any) => (
                  <tr key={p.id} style={{ borderTop: "1px solid var(--border-glass)" }}>
                    <td style={{ padding: "0.75rem 0" }}>#{p.id}</td>
                    <td style={{ padding: "0.75rem 0", fontWeight: 700, color: "var(--accent-primary)" }}>{formatAmount(p.amount)}</td>
                    <td style={{ padding: "0.75rem 0" }}>{p.gateway}</td>
                    <td style={{ padding: "0.75rem 0", color: "var(--text-muted)" }}>{formatDate(p.created_at)}</td>
                    <td style={{ padding: "0.75rem 0" }}>
                      <span style={{
                        background: p.status === "completed" ? "rgba(0,242,254,0.1)" : "rgba(255,107,107,0.1)",
                        color: p.status === "completed" ? "var(--accent-primary)" : "#ff6b6b",
                        padding: "0.2rem 0.6rem", borderRadius: "10px", fontSize: "0.8rem"
                      }}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {(!member.payments || member.payments.length === 0) && (
                  <tr>
                    <td colSpan={5} style={{ padding: "1rem 0", textAlign: "center", color: "var(--text-muted)" }}>{t("payments.noPayments")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Recent Visits */}
          <div className="glass-card">
            <h3 style={{ fontWeight: 700, marginBottom: "1.25rem" }}>{t("members.recentCheckins")}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {(member.recentCheckins || []).map((v: any, i: number) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "0.75rem 1rem", background: "rgba(255,255,255,0.03)", borderRadius: "12px", fontSize: "0.9rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>{formatDateTime(v.checked_in_at)}</span>
                </div>
              ))}
              {(!member.recentCheckins || member.recentCheckins.length === 0) && (
                <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "1rem 0" }}>{t("members.noCheckins")}</p>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
