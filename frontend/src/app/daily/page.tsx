"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

const API = process.env.NEXT_PUBLIC_API_URL || "";

function formatPrice(n: number) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " so'm";
}

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0.7rem", background: "rgba(255,255,255,0.05)",
  border: "1px solid var(--border-glass)", borderRadius: "10px",
  color: "var(--text-main)", outline: "none", fontSize: "0.95rem",
};

export default function DailyVisits() {
  const { token, loading: authLoading, fetchWithAuth } = useAuth();
  const { t } = useLocale();
  const [visits, setVisits] = useState<any[]>([]);
  const [summary, setSummary] = useState({ count: 0, total: 0 });
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ visitorName: "", phone: "", amount: "", paymentMethod: "cash", notes: "" });
  const [selectedDate, setSelectedDate] = useState("");
  const [loadError, setLoadError] = useState("");

  const loadData = useCallback(() => {
    if (!token) return;
    setLoadError("");
    const dateParam = selectedDate ? `?date=${selectedDate}` : "";
    fetchWithAuth(`${API}/api/daily${dateParam}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setVisits(d.data);
          setSummary(d.summary);
        }
      })
      .catch(() => { setLoadError(t("common.serverError")); });
  }, [token, selectedDate, fetchWithAuth]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !form.amount) return;
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`${API}/api/daily`, {
        method: "POST",
        body: JSON.stringify({ ...form, amount: parseInt(form.amount) }),
      });
      const data = await res.json();
      if (data.success) {
        setShowForm(false);
        setForm({ visitorName: "", phone: "", amount: "", paymentMethod: "cash", notes: "" });
        loadData();
      }
    } catch { setLoadError(t("common.serverError")); }
    setSubmitting(false);
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t("common.confirm"))) return;
    try {
      const res = await fetchWithAuth(`${API}/api/daily/${id}`, { method: "DELETE" });
      if (!res.ok) { alert("Delete failed"); return; }
    } catch { alert("Server error"); return; }
    loadData();
  };

  if (authLoading) return <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("common.loading")}</div>;

  return (
    <>
      <header className="header">
        <h1>{t("daily.title")}</h1>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? t("daily.cancel") : t("daily.add")}
        </button>
      </header>

      {loadError && (
        <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff6b6b", padding: "0.8rem 1rem", borderRadius: "12px", marginBottom: "1rem", textAlign: "center" }}>{loadError}</div>
      )}

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1.5rem" }}>
        <div className="glass-card" style={{ textAlign: "center" }}>
          <div className="stat-label">{t("daily.visitors")}</div>
          <div className="stat-value">{summary.count}</div>
        </div>
        <div className="glass-card" style={{ textAlign: "center" }}>
          <div className="stat-label">{t("daily.total")}</div>
          <div className="stat-value" style={{ fontSize: "1.8rem" }}>{formatPrice(summary.total)}</div>
        </div>
        <div className="glass-card" style={{ textAlign: "center" }}>
          <div className="stat-label">{t("daily.today")}</div>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{ ...inputStyle, textAlign: "center", marginTop: "0.5rem" }}
          />
        </div>
      </div>

      {/* Add visitor form */}
      {showForm && (
        <div className="glass-card" style={{ border: "1px solid var(--accent-primary)" }}>
          <h3 style={{ fontWeight: 700, marginBottom: "1rem" }}>{t("daily.add")}</h3>
          <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1rem" }}>
            <input style={inputStyle} placeholder={t("daily.name")} value={form.visitorName}
              onChange={e => setForm({ ...form, visitorName: e.target.value })} />
            <input style={inputStyle} placeholder={t("daily.phone")} value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })} />
            <input style={inputStyle} type="number" placeholder={t("daily.amount")} required value={form.amount}
              onChange={e => setForm({ ...form, amount: e.target.value })} />
            <select style={{ ...inputStyle, cursor: "pointer" }} value={form.paymentMethod}
              onChange={e => setForm({ ...form, paymentMethod: e.target.value })}>
              <option value="cash">{t("daily.cash")}</option>
              <option value="payme">Payme</option>
              <option value="click">Click</option>
            </select>
            <input style={inputStyle} placeholder={t("daily.notes")} value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })} />
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button type="submit" className="btn-primary" disabled={submitting} style={{ flex: 1 }}>
                {submitting ? "..." : t("daily.save")}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                style={{ flex: 1, padding: "0.6rem", background: "transparent", border: "1px solid var(--border-glass)", borderRadius: "10px", color: "var(--text-main)", cursor: "pointer" }}>
                {t("daily.cancel")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Visitors list */}
      <div className="glass-card">
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-glass)", color: "var(--text-muted)" }}>
              <th style={{ padding: "0.75rem" }}>#</th>
              <th style={{ padding: "0.75rem" }}>{t("daily.name")}</th>
              <th style={{ padding: "0.75rem" }}>{t("daily.phone")}</th>
              <th style={{ padding: "0.75rem" }}>{t("daily.amount")}</th>
              <th style={{ padding: "0.75rem" }}>{t("daily.method")}</th>
              <th style={{ padding: "0.75rem" }}>{t("daily.notes")}</th>
              <th style={{ padding: "0.75rem" }}>{ t("daily.time") }</th>
              <th style={{ padding: "0.75rem" }}></th>
            </tr>
          </thead>
          <tbody>
            {visits.map((v, i) => (
              <tr key={v.id} style={{ borderBottom: "1px solid var(--border-glass)" }}>
                <td style={{ padding: "0.75rem", color: "var(--text-muted)" }}>{i + 1}</td>
                <td style={{ padding: "0.75rem", fontWeight: 600 }}>{v.visitor_name || "—"}</td>
                <td style={{ padding: "0.75rem", color: "var(--text-muted)" }}>{v.phone || "—"}</td>
                <td style={{ padding: "0.75rem", color: "var(--accent-primary)", fontWeight: 700 }}>{formatPrice(v.amount)}</td>
                <td style={{ padding: "0.75rem" }}>
                  <span style={{
                    padding: "0.2rem 0.6rem", borderRadius: "10px", fontSize: "0.8rem", fontWeight: 600,
                    background: v.payment_method === "cash" ? "rgba(0,242,254,0.1)" : "rgba(16,185,129,0.1)",
                    color: v.payment_method === "cash" ? "var(--accent-primary)" : "#10b981",
                  }}>{v.payment_method}</span>
                </td>
                <td style={{ padding: "0.75rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>{v.notes || ""}</td>
                <td style={{ padding: "0.75rem", color: "var(--text-muted)" }}>{formatTime(v.visited_at)}</td>
                <td style={{ padding: "0.75rem" }}>
                  <button onClick={() => handleDelete(v.id)}
                    style={{ padding: "0.3rem 0.6rem", borderRadius: "8px", fontSize: "0.75rem", background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.2)", color: "#ff6b6b", cursor: "pointer" }}>
                    {t("daily.delete")}
                  </button>
                </td>
              </tr>
            ))}
            {visits.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
                  {t("daily.noVisits")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
