"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

const API = process.env.NEXT_PUBLIC_API_URL || "";

interface LoyaltyMember {
  id: number; first_name: string; last_name: string; phone: string;
  plan: string; total_visits: number; last_visit: string; created_at: string;
}

interface LoyaltyTier { members: LoyaltyMember[]; count: number; }

export default function Loyalty() {
  const { token, loading, fetchWithAuth } = useAuth();
  const { t } = useLocale();
  const [data, setData] = useState<{ threeMonths: LoyaltyTier; sixMonths: LoyaltyTier; oneYear: LoyaltyTier } | null>(null);
  const [activeTier, setActiveTier] = useState<"threeMonths" | "sixMonths" | "oneYear">("threeMonths");

  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!token) return;
    setLoadError("");
    fetchWithAuth(`${API}/api/attendance/loyalty`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d.data); })
      .catch(() => { setLoadError(t("common.serverError")); });
  }, [token]);

  if (loading) return <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("common.loading")}</div>;

  const tiers = [
    { key: "threeMonths" as const, label: t("loyalty.threeMonths"), emoji: "🥉", color: "#cd7f32" },
    { key: "sixMonths" as const, label: t("loyalty.sixMonths"), emoji: "🥈", color: "#c0c0c0" },
    { key: "oneYear" as const, label: t("loyalty.oneYear"), emoji: "🥇", color: "#ffd700" },
  ];

  const currentTier = data ? data[activeTier] : null;

  return (
    <>
      <header className="header">
        <h1>{t("loyalty.title")}</h1>
      </header>

      {loadError && (
        <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff6b6b", padding: "0.8rem 1rem", borderRadius: "12px", marginBottom: "1rem", textAlign: "center" }}>{loadError}</div>
      )}

      {/* Tier summary cards */}
      <div className="stats-grid" style={{ marginBottom: "1.5rem" }}>
        {tiers.map((tier) => (
          <div key={tier.key}
            className="glass-card"
            onClick={() => setActiveTier(tier.key)}
            style={{ cursor: "pointer", border: activeTier === tier.key ? `2px solid ${tier.color}` : "2px solid transparent", transition: "all 0.2s" }}>
            <div className="stat-label">{tier.emoji} {tier.label}</div>
            <div className="stat-value" style={{ color: tier.color }}>{data ? data[tier.key].count : "—"}</div>
          </div>
        ))}
      </div>

      {/* Member list for selected tier */}
      <div className="glass-card">
        <h2 style={{ marginBottom: "1rem", fontWeight: 600 }}>
          {tiers.find(t => t.key === activeTier)?.emoji} {tiers.find(t => t.key === activeTier)?.label}
          {currentTier && <span style={{ color: "var(--text-muted)", fontWeight: 400, marginLeft: "0.5rem" }}>({currentTier.count} {t("attendance.members")})</span>}
        </h2>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-glass)" }}>
              <th style={{ textAlign: "left", padding: "0.75rem" }}>#</th>
              <th style={{ textAlign: "left", padding: "0.75rem" }}>{t("members.name")}</th>
              <th style={{ textAlign: "left", padding: "0.75rem" }}>{t("members.phone")}</th>
              <th style={{ textAlign: "left", padding: "0.75rem" }}>{t("members.plan")}</th>
              <th style={{ textAlign: "left", padding: "0.75rem" }}>{t("loyalty.totalVisits")}</th>
              <th style={{ textAlign: "left", padding: "0.75rem" }}>{t("loyalty.memberSince")}</th>
              <th style={{ textAlign: "left", padding: "0.75rem" }}>{t("loyalty.lastVisit")}</th>
            </tr>
          </thead>
          <tbody>
            {!currentTier || currentTier.members.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>{t("common.noData")}</td></tr>
            ) : currentTier.members.map((m, i) => (
              <tr key={m.id} style={{ borderBottom: "1px solid var(--border-glass)" }}>
                <td style={{ padding: "0.75rem" }}>{i + 1}</td>
                <td style={{ padding: "0.75rem" }}><a href={`/members/${m.id}`} style={{ color: "var(--accent-primary)" }}>{m.first_name} {m.last_name || ""}</a></td>
                <td style={{ padding: "0.75rem", color: "var(--text-muted)" }}>{m.phone || "—"}</td>
                <td style={{ padding: "0.75rem" }}>{m.plan}</td>
                <td style={{ padding: "0.75rem" }}><strong>{m.total_visits}</strong></td>
                <td style={{ padding: "0.75rem", color: "var(--text-muted)" }}>{new Date(m.created_at).toLocaleDateString("uz-UZ")}</td>
                <td style={{ padding: "0.75rem", color: "var(--text-muted)" }}>{m.last_visit ? new Date(m.last_visit).toLocaleDateString("uz-UZ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
