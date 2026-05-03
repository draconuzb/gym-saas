"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

const API = process.env.NEXT_PUBLIC_API_URL || "";

function formatPrice(n: number) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " so'm";
}

export default function Subscriptions() {
  const { token, loading, fetchWithAuth } = useAuth();
  const { t } = useLocale();
  const [plans, setPlans] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null); // null = not editing, {} = new, {id} = existing
  const [form, setForm] = useState({
    name: "", emoji: "📦", price: 0, days: 12, description: "",
    calendarDurationMonths: 1,
    visitQuotaMode: "limited" as "limited" | "unlimited",
    visitQuota: 12,
    allowMultiEntryPerDay: false,
  });

  const [loadError, setLoadError] = useState("");

  const loadData = () => {
    if (!token) return;
    setLoadError("");
    fetchWithAuth(`${API}/api/plans?all=true`)
      .then(r => r.json()).then(d => { if (d.success) setPlans(d.data); })
      .catch(() => { setLoadError(t("common.serverError")); });
    fetchWithAuth(`${API}/api/payments`)
      .then(r => r.json()).then(d => { if (d.success) setTransactions(d.data); })
      .catch(() => { setLoadError(t("common.serverError")); });
  };

  useEffect(() => { loadData(); }, [token]);

  if (loading) return <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("common.loading")}</div>;

  const startCreate = () => {
    setForm({
      name: "", emoji: "📦", price: 200000, days: 12, description: "",
      calendarDurationMonths: 1, visitQuotaMode: "limited", visitQuota: 12, allowMultiEntryPerDay: false,
    });
    setEditing({});
  };

  const startEdit = (plan: any) => {
    setForm({
      name: plan.name, emoji: plan.emoji || "📦", price: plan.price, days: plan.days,
      description: plan.description || "",
      calendarDurationMonths: plan.calendar_duration_months ?? 1,
      visitQuotaMode: plan.visit_quota === null ? "unlimited" : "limited",
      visitQuota: plan.visit_quota ?? plan.days ?? 12,
      allowMultiEntryPerDay: plan.allow_multi_entry_per_day === true,
    });
    setEditing(plan);
  };

  const save = async () => {
    if (!form.name) { alert(t("plans.nameRequired")); return; }
    const body = {
      name: form.name,
      emoji: form.emoji,
      price: form.price,
      days: form.visitQuotaMode === "limited" ? form.visitQuota : 12,
      description: form.description,
      visitQuota: form.visitQuotaMode === "unlimited" ? null : form.visitQuota,
      calendarDurationMonths: form.calendarDurationMonths,
      allowMultiEntryPerDay: form.allowMultiEntryPerDay,
    };
    try {
      const url = editing.id ? `${API}/api/plans/${editing.id}` : `${API}/api/plans`;
      const method = editing.id ? "PUT" : "POST";
      const res = await fetchWithAuth(url, { method, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.success) {
        alert(t("common.saveFailed") + ": " + (data.message || ""));
        return;
      }
      setEditing(null);
      loadData();
    } catch (err: any) {
      alert(t("common.networkError"));
    }
  };

  const deletePlan = async (id: number) => {
    if (!confirm(t("plans.confirmDelete"))) return;
    try {
      const res = await fetchWithAuth(`${API}/api/plans/${id}`, { method: "DELETE" });
      if (!res.ok) { alert("Delete failed"); return; }
    } catch { alert("Server error"); return; }
    loadData();
  };

  return (
    <>
      <header className="header">
        <h1>{t("plans.title")}</h1>
        <button className="btn-primary" onClick={startCreate}>{t("plans.newPlan")}</button>
      </header>

      {loadError && (
        <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff6b6b", padding: "0.8rem 1rem", borderRadius: "12px", marginBottom: "1rem", textAlign: "center" }}>{loadError}</div>
      )}

      {/* Edit/Create modal */}
      {editing && (
        <div className="glass-card" style={{ marginBottom: "1rem", border: "1px solid var(--accent-primary)" }}>
          <h3 style={{ fontWeight: 700, marginBottom: "1rem" }}>{editing.id ? t("plans.editPlan") : t("plans.newPlanTitle")}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={{ color: "var(--text-muted)", fontSize: "0.8rem", display: "block", marginBottom: "0.3rem" }}>{t("plans.name")}</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                style={{ width: "100%", padding: "0.7rem", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-glass)", borderRadius: "10px", color: "var(--text-main)", outline: "none" }} />
            </div>
            <div>
              <label style={{ color: "var(--text-muted)", fontSize: "0.8rem", display: "block", marginBottom: "0.3rem" }}>{t("plans.emoji")}</label>
              <input value={form.emoji} onChange={e => setForm({ ...form, emoji: e.target.value })}
                style={{ width: "100%", padding: "0.7rem", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-glass)", borderRadius: "10px", color: "var(--text-main)", outline: "none" }} />
            </div>
            <div>
              <label style={{ color: "var(--text-muted)", fontSize: "0.8rem", display: "block", marginBottom: "0.3rem" }}>{t("plans.price")}</label>
              <input type="number" value={form.price} onChange={e => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
                style={{ width: "100%", padding: "0.7rem", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-glass)", borderRadius: "10px", color: "var(--text-main)", outline: "none" }} />
            </div>
            <div>
              <label style={{ color: "var(--text-muted)", fontSize: "0.8rem", display: "block", marginBottom: "0.3rem" }}>{t("plans.calendarDuration")}</label>
              <input type="number" min="1" value={form.calendarDurationMonths} onChange={e => setForm({ ...form, calendarDurationMonths: parseInt(e.target.value) || 1 })}
                style={{ width: "100%", padding: "0.7rem", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-glass)", borderRadius: "10px", color: "var(--text-main)", outline: "none" }} />
            </div>
            <div>
              <label style={{ color: "var(--text-muted)", fontSize: "0.8rem", display: "block", marginBottom: "0.3rem" }}>{ t("plans.visitQuota") }</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <select value={form.visitQuotaMode} onChange={e => setForm({ ...form, visitQuotaMode: e.target.value as "limited" | "unlimited" })}
                  style={{ padding: "0.7rem", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-glass)", borderRadius: "10px", color: "var(--text-main)", outline: "none", cursor: "pointer" }}>
                  <option value="limited">{ t("plans.limited") }</option>
                  <option value="unlimited">{ t("plans.unlimitedVip") }</option>
                </select>
                {form.visitQuotaMode === "limited" && (
                  <input type="number" min="1" value={form.visitQuota} onChange={e => setForm({ ...form, visitQuota: parseInt(e.target.value) || 1 })}
                    style={{ flex: 1, padding: "0.7rem", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-glass)", borderRadius: "10px", color: "var(--text-main)", outline: "none" }} />
                )}
              </div>
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0" }}>
              <input type="checkbox" id="multiEntry" checked={form.allowMultiEntryPerDay}
                onChange={e => setForm({ ...form, allowMultiEntryPerDay: e.target.checked })}
                style={{ width: "18px", height: "18px", cursor: "pointer" }} />
              <label htmlFor="multiEntry" style={{ color: "var(--text-muted)", fontSize: "0.9rem", cursor: "pointer" }}>
                {t("plans.allowMultiEntry")}
              </label>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ color: "var(--text-muted)", fontSize: "0.8rem", display: "block", marginBottom: "0.3rem" }}>{t("plans.description")}</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                style={{ width: "100%", padding: "0.7rem", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-glass)", borderRadius: "10px", color: "var(--text-main)", outline: "none" }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
            <button className="btn-primary" onClick={save} style={{ padding: "0.6rem 1.5rem" }}>{t("plans.save")}</button>
            <button onClick={() => setEditing(null)} style={{ padding: "0.6rem 1.5rem", background: "transparent", border: "1px solid var(--border-glass)", borderRadius: "12px", color: "var(--text-main)", cursor: "pointer" }}>{t("plans.cancel")}</button>
          </div>
        </div>
      )}

      {/* Plans grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "2rem" }}>
        {plans.map(plan => (
          <div key={plan.id} className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "1rem", borderTop: "4px solid var(--accent-primary)", opacity: plan.is_active === false ? 0.5 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "1.4rem", fontWeight: 700 }}>{plan.emoji} {plan.name}</h2>
              {plan.is_active === false && <span style={{ fontSize: "0.75rem", color: "#ff6b6b", background: "rgba(255,107,107,0.1)", padding: "0.2rem 0.6rem", borderRadius: "10px" }}>{t("plans.inactive")}</span>}
            </div>
            <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--accent-primary)" }}>{formatPrice(plan.price)}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              <span style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem", borderRadius: "8px", background: "rgba(0,242,254,0.1)", color: "var(--accent-primary)" }}>
                {plan.visit_quota === null ? t("plans.unlimited") : `${plan.visit_quota ?? plan.days} ${t("plans.visits")}`}
              </span>
              <span style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem", borderRadius: "8px", background: "rgba(255,200,0,0.1)", color: "#ffc800" }}>
                {plan.calendar_duration_months ?? 1} {t("plans.months")}
              </span>
              {plan.allow_multi_entry_per_day && (
                <span style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem", borderRadius: "8px", background: "rgba(250,150,0,0.1)", color: "#ffa500" }}>
                  {t("plans.multiEntry")}
                </span>
              )}
            </div>
            {plan.description && <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{plan.description}</p>}

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "auto" }}>
              <button onClick={() => startEdit(plan)} style={{ flex: 1, padding: "0.6rem", borderRadius: "10px", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-glass)", color: "var(--text-main)", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}>
                {t("plans.edit")}
              </button>
              <button onClick={() => deletePlan(plan.id)} style={{ padding: "0.6rem 1rem", borderRadius: "10px", background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff6b6b", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}>
                {t("plans.delete")}
              </button>
            </div>
          </div>
        ))}
        {plans.length === 0 && (
          <div className="glass-card" style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
            {t("plans.noPlans")}
          </div>
        )}
      </div>

      {/* Recent transactions */}
      <div className="glass-card" style={{ marginTop: "2rem" }}>
        <h2 style={{ marginBottom: "1.5rem", fontWeight: 600 }}>{t("plans.recentTx")}</h2>
        <div style={{ color: "var(--text-muted)", display: "grid", gap: "1rem" }}>
          {transactions.map((tx, i) => (
            <div key={tx.id || i} style={{ display: "flex", justifyContent: "space-between", paddingBottom: "1rem", borderBottom: "1px solid var(--border-glass)" }}>
              <div>
                <strong style={{ color: "var(--text-main)" }}>{tx.first_name || t("common.unknown")} {tx.last_name || ""}</strong>
                <div style={{ fontSize: "0.8rem", marginTop: "0.2rem" }}>{tx.gateway} · {tx.status} · #{tx.id}</div>
              </div>
              <div style={{ color: tx.status === "completed" ? "#4facfe" : "var(--text-muted)", fontWeight: 800 }}>{formatPrice(tx.amount)}</div>
            </div>
          ))}
          {transactions.length === 0 && <p style={{ textAlign: "center", padding: "1rem 0" }}>{t("plans.noTx")}</p>}
        </div>
      </div>
    </>
  );
}
