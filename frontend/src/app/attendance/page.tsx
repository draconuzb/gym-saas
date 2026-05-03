"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

const API = process.env.NEXT_PUBLIC_API_URL || "";

export default function Attendance() {
  const { token, loading, fetchWithAuth } = useAuth();
  const { t } = useLocale();
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [data, setData] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [segments, setSegments] = useState<any[]>([]);
  const [segmentType, setSegmentType] = useState("expired");
  const [tab, setTab] = useState<"attendance" | "segments">("attendance");
  const [loadError, setLoadError] = useState("");

  const fetchAttendance = () => {
    if (!token) return;
    setLoadError("");
    fetchWithAuth(`${API}/api/attendance?date=${date}`)
      .then(r => r.json())
      .then(d => { if (d.success) { setData(d.data); setSummary(d.summary); } })
      .catch(() => { setLoadError(t("common.serverError")); });
  };

  const fetchSegments = () => {
    if (!token) return;
    fetchWithAuth(`${API}/api/attendance/segments?segment=${segmentType}`)
      .then(r => r.json())
      .then(d => { if (d.success) setSegments(d.data); })
      .catch(() => { setLoadError(t("common.serverError")); });
  };

  useEffect(() => { fetchAttendance(); }, [token, date]);
  useEffect(() => { fetchSegments(); }, [token, segmentType]);

  if (loading) return <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("common.loading")}</div>;

  return (
    <>
      <header className="header">
        <h1>{tab === "attendance" ? t("attendance.title") : t("attendance.segments")}</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className={tab === "attendance" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("attendance")}>{t("attendance.title")}</button>
          <button className={tab === "segments" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("segments")}>{t("attendance.segments")}</button>
        </div>
      </header>

      {loadError && (
        <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff6b6b", padding: "0.8rem 1rem", borderRadius: "12px", marginBottom: "1rem", textAlign: "center" }}>{loadError}</div>
      )}

      {tab === "attendance" && (
        <>
          <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", alignItems: "center" }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              style={{ padding: "0.5rem 1rem", borderRadius: "8px", border: "1px solid var(--border-glass)", background: "var(--bg-card)", color: "var(--text-main)", fontSize: "0.9rem" }} />
            <button className="btn-secondary" onClick={() => setDate(new Date().toISOString().split("T")[0])}>{t("attendance.today")}</button>
          </div>

          {summary && (
            <div className="stats-grid" style={{ marginBottom: "1rem" }}>
              <div className="glass-card">
                <div className="stat-label">{t("attendance.totalCheckins")}</div>
                <div className="stat-value">{summary.totalCheckins}</div>
              </div>
              <div className="glass-card">
                <div className="stat-label">{t("attendance.uniqueMembers")}</div>
                <div className="stat-value">{summary.uniqueMembers}</div>
              </div>
            </div>
          )}

          <div className="glass-card">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-glass)" }}>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>#</th>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>{t("members.name")}</th>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>{t("members.phone")}</th>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>{t("members.plan")}</th>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>{t("common.time")}</th>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>{t("members.status")}</th>
                </tr>
              </thead>
              <tbody>
                {data.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>{t("attendance.noCheckins")}</td></tr>
                ) : data.map((c, i) => {
                  const daysLeft = c.total_days && c.days_used != null ? Math.max(0, c.total_days - c.days_used) : 0;
                  return (
                    <tr key={c.id} style={{ borderBottom: "1px solid var(--border-glass)" }}>
                      <td style={{ padding: "0.75rem" }}>{i + 1}</td>
                      <td style={{ padding: "0.75rem" }}><a href={`/members/${c.member_id}`} style={{ color: "var(--accent-primary)" }}>{c.first_name} {c.last_name || ""}</a></td>
                      <td style={{ padding: "0.75rem", color: "var(--text-muted)" }}>{c.phone || "—"}</td>
                      <td style={{ padding: "0.75rem" }}>{c.plan}</td>
                      <td style={{ padding: "0.75rem" }}>{new Date(c.checked_in_at).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}</td>
                      <td style={{ padding: "0.75rem" }}><span style={{ color: daysLeft > 3 ? "#00f2fe" : daysLeft > 0 ? "#f97316" : "#ff6b6b" }}>{daysLeft} {t("common.days")}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "segments" && (
        <>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <button className={segmentType === "expired" ? "btn-primary" : "btn-secondary"} onClick={() => setSegmentType("expired")}>{t("attendance.segExpired")}</button>
            <button className={segmentType === "churned" ? "btn-primary" : "btn-secondary"} onClick={() => setSegmentType("churned")}>{t("attendance.segChurned")}</button>
            <button className={segmentType === "never_subscribed" ? "btn-primary" : "btn-secondary"} onClick={() => setSegmentType("never_subscribed")}>{t("attendance.segNever")}</button>
          </div>

          <div className="glass-card">
            <div style={{ marginBottom: "1rem", color: "var(--text-muted)" }}>
              {t("attendance.found")}: <strong style={{ color: "var(--text-main)" }}>{segments.length}</strong> {t("attendance.members")}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-glass)" }}>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>#</th>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>{t("members.name")}</th>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>{t("members.phone")}</th>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>{t("members.plan")}</th>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>{t("attendance.lastActivity")}</th>
                </tr>
              </thead>
              <tbody>
                {segments.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>{t("common.noData")}</td></tr>
                ) : segments.map((m, i) => (
                  <tr key={m.id} style={{ borderBottom: "1px solid var(--border-glass)" }}>
                    <td style={{ padding: "0.75rem" }}>{i + 1}</td>
                    <td style={{ padding: "0.75rem" }}><a href={`/members/${m.id}`} style={{ color: "var(--accent-primary)" }}>{m.first_name} {m.last_name || ""}</a></td>
                    <td style={{ padding: "0.75rem", color: "var(--text-muted)" }}>{m.phone || "—"}</td>
                    <td style={{ padding: "0.75rem" }}>{m.last_plan || m.plan || "—"}</td>
                    <td style={{ padding: "0.75rem", color: "var(--text-muted)" }}>{m.last_visit ? new Date(m.last_visit).toLocaleDateString("uz-UZ") : m.expired_at ? new Date(m.expired_at).toLocaleDateString("uz-UZ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
