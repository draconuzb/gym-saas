"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0.7rem", background: "rgba(255,255,255,0.05)",
  border: "1px solid var(--border-glass)", borderRadius: "10px",
  color: "var(--text-main)", outline: "none",
};

export default function TrainersPage() {
  const { token, loading, fetchWithAuth } = useAuth();
  const { t } = useLocale();
  const [trainers, setTrainers] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", specialty: "", phone: "" });
  const [loadError, setLoadError] = useState("");

  const loadTrainers = useCallback(() => {
    if (!token) return;
    setLoadError("");
    fetchWithAuth(`${API}/api/trainers`)
      .then(r => r.json())
      .then(data => { if (data.success) setTrainers(data.data); })
      .catch(() => { setLoadError(t("common.serverError")); });
  }, [token]);

  useEffect(() => { loadTrainers(); }, [loadTrainers]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`${API}/api/trainers`, {
        method: "POST",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setShowForm(false);
        setForm({ firstName: "", lastName: "", specialty: "", phone: "" });
        loadTrainers();
      }
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  const handleDelete = async (trainerId: number) => {
    if (!confirm(t("trainers.confirmDelete"))) return;
    if (!token) return;
    setDeletingId(trainerId);
    try {
      const res = await fetchWithAuth(`${API}/api/trainers/${trainerId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) loadTrainers();
    } catch { /* ignore */ }
    setDeletingId(null);
  };

  const colors = ["#f97316", "#a78bfa", "#ef4444", "#00f2fe", "#10b981", "#ffd700"];

  if (loading) return <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("common.loading")}</div>;

  return (
    <>
      <header className="header">
        <h1>{t("trainers.title")}</h1>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? t("members.cancel") : t("trainers.add")}
        </button>
      </header>

      {showForm && (
        <div className="glass-card" style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ fontWeight: 700, marginBottom: "1rem" }}>{t("trainers.addTitle")}</h3>
          <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <input style={inputStyle} placeholder={`${t("trainers.firstName")} *`} required value={form.firstName}
              onChange={e => setForm({ ...form, firstName: e.target.value })} />
            <input style={inputStyle} placeholder={t("trainers.lastName")} value={form.lastName}
              onChange={e => setForm({ ...form, lastName: e.target.value })} />
            <input style={inputStyle} placeholder={t("trainers.specialty")} value={form.specialty}
              onChange={e => setForm({ ...form, specialty: e.target.value })} />
            <input style={inputStyle} placeholder={t("trainers.phone")} value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })} />
            <div style={{ display: "flex", gap: "0.75rem", gridColumn: "1 / -1" }}>
              <button type="submit" className="btn-primary" disabled={submitting} style={{ flex: 1 }}>
                {submitting ? t("common.loading") : t("trainers.add")}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                style={{ flex: 1, padding: "0.6rem", background: "transparent", border: "1px solid var(--border-glass)", borderRadius: "10px", color: "var(--text-main)", cursor: "pointer", fontWeight: 600 }}>
                {t("members.cancel")}
              </button>
            </div>
          </form>
        </div>
      )}

      {loadError && (
        <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff6b6b", padding: "0.8rem 1rem", borderRadius: "12px", marginBottom: "1rem", textAlign: "center" }}>{loadError}</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1.5rem" }}>
        {trainers.map((trainer, idx) => {
          const color = colors[idx % colors.length];
          const initials = `${(trainer.first_name || "")[0] || ""}${(trainer.last_name || "")[0] || ""}`.toUpperCase();
          return (
            <div key={trainer.id} className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

              {/* Header row */}
              <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                <div style={{
                  width: "56px", height: "56px", borderRadius: "50%",
                  background: `${color}22`,
                  border: `2px solid ${color}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: "1rem", color: color, flexShrink: 0,
                }}>
                  {initials}
                </div>
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: "1.05rem" }}>{trainer.first_name} {trainer.last_name || ""}</h3>
                  <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{trainer.specialty || t("trainers.general")}</p>
                </div>
              </div>

              {/* Stats row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: "12px", padding: "0.75rem", textAlign: "center" }}>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color }}>{trainer.sessions ?? 0}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1px" }}>{t("trainers.sessions")}</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: "12px", padding: "0.75rem", textAlign: "center" }}>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color }}>{trainer.rating ?? "—"}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1px" }}>{t("trainers.rating")}</div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button style={{ flex: 1, padding: "0.6rem", background: "transparent", border: "1px solid var(--border-glass)", borderRadius: "10px", color: "var(--text-main)", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}>
                  {t("trainers.viewSchedule")}
                </button>
                <button
                  onClick={() => handleDelete(trainer.id)}
                  disabled={deletingId === trainer.id}
                  style={{ flex: 1, padding: "0.6rem", background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: "10px", color: "#ff6b6b", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}>
                  {deletingId === trainer.id ? "..." : t("trainers.delete")}
                </button>
              </div>
            </div>
          );
        })}
        {trainers.length === 0 && (
          <div className="glass-card" style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
            {t("trainers.noTrainers")}
          </div>
        )}
      </div>
    </>
  );
}
