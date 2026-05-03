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

function deriveType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("yoga")) return "yoga";
  if (lower.includes("hiit")) return "hiit";
  if (lower.includes("boxing")) return "boxing";
  if (lower.includes("pilates")) return "pilates";
  if (lower.includes("crossfit")) return "crossfit";
  return "general";
}

function formatTime(t: string): string {
  // "06:00:00" → "06:00"
  if (!t) return "—";
  return t.slice(0, 5);
}

export default function Classes() {
  const { token, loading, fetchWithAuth } = useAuth();
  const { t } = useLocale();
  const [schedule, setSchedule] = useState<any[]>([]);
  const [selectedDay, setSelectedDay] = useState("Mon");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [trainers, setTrainers] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", trainerId: "", dayOfWeek: "Mon", startTime: "", capacity: "" });
  const [loadError, setLoadError] = useState("");

  const loadClasses = useCallback(() => {
    if (!token) return;
    setLoadError("");
    fetchWithAuth(`${API}/api/classes?day=${selectedDay}`)
      .then(r => r.json())
      .then(data => { if (data.success) setSchedule(data.data); })
      .catch(() => { setLoadError(t("common.serverError")); });
  }, [selectedDay, token, fetchWithAuth]);

  useEffect(() => { loadClasses(); }, [loadClasses]);

  const openForm = async () => {
    setShowForm(true);
    if (!token) return;
    try {
      const res = await fetchWithAuth(`${API}/api/trainers`);
      const data = await res.json();
      if (data.success) setTrainers(data.data);
    } catch { /* ignore */ }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`${API}/api/classes`, {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          trainerId: form.trainerId ? Number(form.trainerId) : undefined,
          dayOfWeek: form.dayOfWeek,
          startTime: form.startTime,
          capacity: form.capacity ? Number(form.capacity) : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowForm(false);
        setForm({ name: "", trainerId: "", dayOfWeek: "Mon", startTime: "", capacity: "" });
        loadClasses();
      }
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  const handleDelete = async (classId: number) => {
    if (!confirm(t("classes.confirmDelete"))) return;
    if (!token) return;
    setDeletingId(classId);
    try {
      const res = await fetchWithAuth(`${API}/api/classes/${classId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) loadClasses();
    } catch { /* ignore */ }
    setDeletingId(null);
  };

  if (loading) return <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("common.loading")}</div>;

  const typeColors: Record<string, string> = {
    yoga: "#a78bfa",
    hiit: "#f97316",
    boxing: "#ef4444",
    pilates: "#00f2fe",
    crossfit: "#10b981",
    general: "#adb5bd",
  };

  return (
    <>
      <header className="header">
        <h1>{t("classes.title")}</h1>
        <button className="btn-primary" onClick={() => showForm ? setShowForm(false) : openForm()}>
          {showForm ? t("members.cancel") : t("classes.add")}
        </button>
      </header>

      {showForm && (
        <div className="glass-card" style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ fontWeight: 700, marginBottom: "1rem" }}>{t("classes.addTitle")}</h3>
          <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <input style={inputStyle} placeholder={t("classes.name") + " *"} required value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })} />
            <select style={inputStyle} value={form.trainerId} onChange={e => setForm({ ...form, trainerId: e.target.value })}>
              <option value="">{ t("classes.selectTrainer") }</option>
              {trainers.map(tr => (
                <option key={tr.id} value={tr.id}>{tr.first_name} {tr.last_name || ""}</option>
              ))}
            </select>
            <select style={inputStyle} value={form.dayOfWeek} onChange={e => setForm({ ...form, dayOfWeek: e.target.value })}>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <input style={inputStyle} type="time" placeholder={t("classes.time")} value={form.startTime}
              onChange={e => setForm({ ...form, startTime: e.target.value })} />
            <input style={inputStyle} type="number" placeholder={t("classes.capacity")} value={form.capacity}
              onChange={e => setForm({ ...form, capacity: e.target.value })} />
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <button type="submit" className="btn-primary" disabled={submitting} style={{ flex: 1 }}>
                {submitting ? t("common.loading") : t("classes.add")}
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

      {/* Week days filter bar */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => (
          <button key={day} onClick={() => setSelectedDay(day)} style={{
            padding: "0.5rem 1.25rem",
            borderRadius: "30px",
            background: day === selectedDay ? "var(--gradient-action)" : "rgba(255,255,255,0.05)",
            border: "1px solid var(--border-glass)",
            color: "white",
            fontWeight: 600,
            cursor: "pointer",
            fontSize: "0.85rem",
          }}>{t("days." + day)}</button>
        ))}
      </div>

      {/* Classes grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1.5rem" }}>
        {schedule.map((cls, i) => {
          const classType = deriveType(cls.name || "");
          const typeColor = typeColors[classType] || "#adb5bd";
          const enrolled = parseInt(cls.enrolled) || 0;
          const capacity = cls.capacity || 0;
          return (
            <div key={cls.id || i} className="glass-card" style={{ borderLeft: `4px solid ${typeColor}`, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: "1.1rem" }}>{cls.name}</h3>
                  <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{t("classes.with")} {cls.trainer_name || "—"}</p>
                </div>
                <span style={{
                  background: `${typeColor}20`,
                  color: typeColor,
                  padding: "0.25rem 0.75rem",
                  borderRadius: "20px",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}>{classType}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", color: "var(--text-muted)" }}>
                <span>{formatTime(cls.start_time)}</span>
                <span>{cls.day_of_week}</span>
                <span>{enrolled}/{capacity}</span>
              </div>
              {/* Capacity bar */}
              <div style={{ height: "6px", background: "rgba(255,255,255,0.08)", borderRadius: "3px" }}>
                <div style={{
                  width: `${(enrolled / (capacity || 1)) * 100}%`,
                  height: "100%", borderRadius: "3px",
                  background: typeColor,
                }}></div>
              </div>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button style={{ flex: 1, background: "transparent", border: "1px solid var(--border-glass)", color: "var(--text-main)", padding: "0.5rem", borderRadius: "10px", cursor: "pointer", fontWeight: 600 }}>
                  {enrolled} {t("classes.enrolled")}
                </button>
                <button
                  onClick={() => handleDelete(cls.id)}
                  disabled={deletingId === cls.id}
                  style={{ padding: "0.5rem 1rem", background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: "10px", color: "#ff6b6b", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}>
                  {deletingId === cls.id ? "..." : t("common.delete")}
                </button>
              </div>
            </div>
          );
        })}
        {schedule.length === 0 && (
          <div className="glass-card" style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
            {t("classes.noClasses")}
          </div>
        )}
      </div>
    </>
  );
}
