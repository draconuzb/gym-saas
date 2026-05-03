"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

const API = process.env.NEXT_PUBLIC_API_URL || "";

function formatUZS(value: number): string {
  return value.toLocaleString() + " so'm";
}

function buildChartPath(revenueData: { month: string; revenue: number }[]): { line: string; area: string } {
  if (!revenueData.length) return { line: "M0,100", area: "M0,100 L0,100 Z" };

  const revenues = revenueData.map(d => d.revenue);
  const min = Math.min(...revenues);
  const max = Math.max(...revenues);
  const range = max - min || 1;

  const points = revenueData.map((d, i) => {
    const x = revenueData.length === 1 ? 50 : (i / (revenueData.length - 1)) * 100;
    const y = 100 - ((d.revenue - min) / range) * 80 - 10; // 10-90 range, inverted
    return { x, y };
  });

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L100,100 L0,100 Z`;

  return { line, area };
}

export default function Reports() {
  const { token, user, loading, fetchWithAuth } = useAuth();
  const { t } = useLocale();
  const [summary, setSummary] = useState<any>(null);
  const [revenueData, setRevenueData] = useState<{ month: string; revenue: number }[]>([]);
  const [heatmap, setHeatmap] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!token) return;

    fetchWithAuth(`${API}/api/reports/summary`)
      .then(r => r.json())
      .then(data => setSummary(data))
      .catch(() => {});

    fetchWithAuth(`${API}/api/reports/revenue`)
      .then(r => r.json())
      .then(data => setRevenueData(Array.isArray(data) ? data : data.data || []))
      .catch(() => {});

    fetchWithAuth(`${API}/api/reports/visits/heatmap`)
      .then(r => r.json())
      .then(data => setHeatmap(data))
      .catch(() => {});

    fetchWithAuth(`${API}/api/health`)
      .then(r => r.json())
      .then(data => setHealth(data))
      .catch(() => {});
  }, [token, fetchWithAuth]);

  const exportCSV = async () => {
    setExporting(true);
    try {
      const res = await fetchWithAuth(`${API}/api/members`);
      const data = await res.json();
      if (!data.success) return;

      function csvEscape(val: string): string {
        const escaped = String(val).replace(/"/g, '""');
        if (/^[=+\-@\t\r]/.test(escaped)) return `"'${escaped}"`;
        return `"${escaped}"`;
      }

      const header = "Name,Phone,Plan,Status,Days Left\n";
      const rows = data.data
        .map((m: any) => {
          const left =
            m.sub_status === "active"
              ? Math.max(0, (m.total_days || 0) - (m.days_used || 0))
              : 0;
          const status = left > 0 ? "Active" : "Expired";
          return `${csvEscape(`${m.first_name} ${m.last_name || ""}`)},${csvEscape(m.phone || "")},${csvEscape(m.plan || "")},${csvEscape(status)},${left}`;
        })
        .join("\n");

      const blob = new Blob([header + rows], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gym-report-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently handle errors
    }
    setExporting(false);
  };

  const distribution = summary?.data?.planDistribution || summary?.planDistribution || [];
  const { line: chartLine, area: chartArea } = buildChartPath(revenueData);

  if (loading) return <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("common.loading")}</div>;

  if (user?.role !== "admin") {
    return <div style={{ padding: "3rem", color: "#ff6b6b", fontWeight: 700 }}>{t("common.accessDenied")}</div>;
  }

  return (
    <>
      <header className="header">
        <h1>{t("reports.title")}</h1>
        <button className="btn-primary" onClick={exportCSV} disabled={exporting}>
          {exporting ? t("reports.exporting") : t("reports.export")}
        </button>
      </header>

      {/* Summary stats */}
      {summary && (
        <div className="stats-grid" style={{ marginBottom: "1rem" }}>
          <div className="glass-card">
            <div className="stat-label">{t("dashboard.activeMembers")}</div>
            <div className="stat-value">{summary.activeMembers ?? "—"}</div>
          </div>
          <div className="glass-card">
            <div className="stat-label">{t("dashboard.monthlyRevenue")}</div>
            <div className="stat-value">{summary.monthlyRevenue != null ? formatUZS(summary.monthlyRevenue) : "—"}</div>
          </div>
        </div>
      )}

      {/* Revenue chart */}
      <div className="glass-card" style={{ height: "300px", display: "flex", flexDirection: "column" }}>
        <h2 style={{ marginBottom: "1rem", fontWeight: 600 }}>{t("reports.revenue")}</h2>
        <div style={{ flex: 1, borderBottom: "1px solid var(--border-glass)", borderLeft: "1px solid var(--border-glass)", position: "relative" }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%", overflow: "visible" }}>
            <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.5" />
              <stop offset="100%" stopColor="var(--accent-secondary)" stopOpacity="0" />
            </linearGradient>
            <path d={chartLine} fill="none" stroke="var(--accent-primary)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
            <path d={chartArea} fill="url(#chartGlow)" />
          </svg>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5rem", color: "var(--text-muted)", fontSize: "0.8rem" }}>
          {revenueData.length > 0
            ? revenueData.map((d, i) => <span key={i}>{d.month}</span>)
            : <span>{t("common.noData")}</span>
          }
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "2rem", marginTop: "1rem" }}>

        <div className="glass-card">
          <h2 style={{ marginBottom: "1.5rem", fontWeight: 600 }}>{t("reports.distribution")}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {Array.isArray(distribution) && distribution.length > 0 ? distribution.map((d: any, i: number) => {
              const total = distribution.reduce((sum: number, x: any) => sum + parseInt(x.count), 0);
              const pct = total > 0 ? Math.round((parseInt(d.count) / total) * 100) : 0;
              const colors = ["#adb5bd", "var(--accent-primary)", "#ffd700", "#f97316", "#a78bfa"];
              return (
                <div key={d.plan || i}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem", color: "var(--text-main)", fontSize: "0.9rem" }}>
                    <span>{d.plan}</span><span>{d.count} ({pct}%)</span>
                  </div>
                  <div style={{ height: "8px", background: "rgba(255,255,255,0.1)", borderRadius: "4px", overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: colors[i % colors.length] }}></div>
                  </div>
                </div>
              );
            }) : <p style={{ color: "var(--text-muted)" }}>{t("common.noData")}</p>}
          </div>
        </div>

        <div className="glass-card">
          <h2 style={{ marginBottom: "1.5rem", fontWeight: 600 }}>{t("reports.health")}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", color: "var(--text-muted)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <span style={{ width: "12px", height: "12px", borderRadius: "50%", background: health?.database === "connected" ? "#00f2fe" : "#ff6b6b", boxShadow: `0 0 10px ${health?.database === "connected" ? "#00f2fe" : "#ff6b6b"}` }}></span>
              {t("reports.database")}: <strong style={{ color: "var(--text-main)" }}>{health?.database === "connected" ? t("common.online") : t("common.offline")}</strong>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <span style={{ width: "12px", height: "12px", borderRadius: "50%", background: health?.status === "ok" ? "#00f2fe" : "#ff6b6b", boxShadow: `0 0 10px ${health?.status === "ok" ? "#00f2fe" : "#ff6b6b"}` }}></span>
              {t("common.server")}: <strong style={{ color: "var(--text-main)" }}>{health?.status === "ok" ? t("common.running") : t("common.down")}</strong>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <span style={{ width: "12px", height: "12px", borderRadius: "50%", background: health?.uptime ? "#00f2fe" : "#ff6b6b", boxShadow: `0 0 10px ${health?.uptime ? "#00f2fe" : "#ff6b6b"}` }}></span>
              {t("common.uptime")}: <strong style={{ color: "var(--text-main)" }}>{health?.uptime ? (() => { const s = Math.floor(health.uptime); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; })() : "—"}</strong>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
