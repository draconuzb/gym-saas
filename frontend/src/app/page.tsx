"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

const API = process.env.NEXT_PUBLIC_API_URL || "";

export default function Dashboard() {
  const { token, loading, fetchWithAuth } = useAuth();
  const { t } = useLocale();
  const [stats, setStats] = useState<any>(null);
  const [recentCheckins, setRecentCheckins] = useState<any[]>([]);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetchWithAuth(`${API}/api/stats`)
      .then(r => r.json())
      .then(data => setStats(data))
      .catch(() => setFetchError(true));
  }, [token]);

  if (loading) return <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("common.loading")}</div>;

  return (
    <>
      {fetchError && (
        <div style={{ padding: "1rem", marginBottom: "1rem", background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: "12px", color: "#ff6b6b" }}>
          {t("common.serverUnreachable")}
        </div>
      )}
      <header className="header">
        <h1>{t("dashboard.title")}</h1>
        <a href="/members"><button className="btn-primary">{t("dashboard.newMember")}</button></a>
      </header>

      <div className="stats-grid">
        <div className="glass-card">
          <div className="stat-label">{t("dashboard.activeMembers")}</div>
          <div className="stat-value">{stats?.activeMembers ?? "—"}</div>
        </div>
        <div className="glass-card">
          <div className="stat-label">{t("dashboard.dailyCheckins")}</div>
          <div className="stat-value">{stats?.dailyCheckins ?? "—"}</div>
        </div>
        <div className="glass-card">
          <div className="stat-label">{t("dashboard.monthlyRevenue")}</div>
          <div className="stat-value">{stats ? `${(stats.monthlyRevenue || 0).toLocaleString()} so'm` : "—"}</div>
        </div>
        <div className="glass-card">
          <div className="stat-label">{t("dashboard.expiringSoon")}</div>
          <div className="stat-value" style={{ color: "#ff6b6b" }}>{stats?.expiringSoon ?? "—"}</div>
        </div>
        <div className="glass-card">
          <div className="stat-label">{t("nav.daily")}</div>
          <div className="stat-value" style={{ color: "#f97316" }}>{stats?.dailyVisitors ?? "—"}</div>
        </div>
      </div>

      <div className="glass-card" style={{ flex: 1 }}>
        <h2 style={{ marginBottom: "1rem", fontWeight: 600 }}>{t("dashboard.newThisMonth")}</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "1.2rem" }}>
          {stats?.newMembersThisMonth ?? 0} {t("dashboard.registrations")}
        </p>
      </div>
    </>
  );
}
