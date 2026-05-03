"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

const API = process.env.NEXT_PUBLIC_API_URL || "";

export default function DatabasePage() {
  const { token, user, loading: authLoading, fetchWithAuth } = useAuth();
  const { t } = useLocale();
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const loadStatus = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${API}/api/database/status`);
      const data = await res.json();
      if (data.success) setStatus(data.data);
    } catch { showMsg(t("common.serverError"), "error"); }
    setLoading(false);
  };

  useEffect(() => { loadStatus(); }, [token]);

  const showMsg = (text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetchWithAuth(`${API}/api/database/export`, { method: "POST" });
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gym-backup-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showMsg(t("db.backupSuccess"), "success");
    } catch {
      showMsg(t("db.exportFailed"), "error");
    }
    setExporting(false);
  };

  const handleImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setImporting(true);
      try {
        const text = await file.text();
        const backup = JSON.parse(text);
        const res = await fetchWithAuth(`${API}/api/database/import`, {
          method: "POST",
          body: JSON.stringify(backup),
        });
        const data = await res.json();
        if (data.success) {
          showMsg(`Imported: ${JSON.stringify(data.imported)}`, "success");
          loadStatus();
        } else {
          showMsg(data.message || t("common.error"), "error");
        }
      } catch {
        showMsg(t("db.invalidBackup"), "error");
      }
      setImporting(false);
    };
    input.click();
  };

  const handleReset = async (table: string) => {
    if (!confirm(`"${table}" jadvalidagi BARCHA ma'lumotlarni o'chirmoqchimisiz?\n\nBu amalni qaytarib bo'lmaydi!`)) return;
    if (!confirm(`Ishonchingiz komilmi? "${table}" jadvalini tozalash.`)) return;

    setResetting(table);
    try {
      const res = await fetchWithAuth(`${API}/api/database/reset/${table}`, {
        method: "POST",
        body: JSON.stringify({ confirm: `DELETE_ALL_${table.toUpperCase()}` }),
      });
      const data = await res.json();
      if (data.success) {
        showMsg(data.message, "success");
        loadStatus();
      } else {
        showMsg(data.message || t("common.error"), "error");
      }
    } catch {
      showMsg(t("common.error"), "error");
    }
    setResetting(null);
  };

  const tableLabels: Record<string, string> = {
    members: "Members",
    subscriptions: "Subscriptions",
    checkins: "Check-ins",
    payments: "Payments",
    plans: "Plans",
    trainers: "Trainers",
    classes: "Classes",
    class_enrollments: "Enrollments",
    users: "Staff Users",
    bot_admins: "Bot Admins",
    settings: "Settings",
  };

  const resettable = ["checkins", "payments", "class_enrollments"];

  if (authLoading) return <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("common.loading")}</div>;

  if (user?.role !== "admin") {
    return <div style={{ padding: "3rem", color: "#ff6b6b", fontWeight: 700 }}>{t("common.accessDenied")}</div>;
  }

  return (
    <>
      <header className="header">
        <h1>{t("db.title")}</h1>
        <button className="btn-primary" onClick={loadStatus} style={{ opacity: loading ? 0.7 : 1 }}>
          {loading ? t("db.loading") : t("db.refresh")}
        </button>
      </header>

      {message && (
        <div style={{
          padding: "0.75rem 1rem", borderRadius: "12px", marginBottom: "1rem",
          background: message.type === "success" ? "rgba(0,242,254,0.1)" : "rgba(255,107,107,0.1)",
          border: `1px solid ${message.type === "success" ? "rgba(0,242,254,0.3)" : "rgba(255,107,107,0.3)"}`,
          color: message.type === "success" ? "var(--accent-primary)" : "#ff6b6b",
        }}>
          {message.text}
        </div>
      )}

      {/* Connection status */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1.5rem" }}>
        <div className="glass-card" style={{ textAlign: "center" }}>
          <div style={{
            width: "16px", height: "16px", borderRadius: "50%", margin: "0 auto 0.75rem",
            background: status?.connected ? "#00f2fe" : "#ff6b6b",
            boxShadow: `0 0 12px ${status?.connected ? "#00f2fe" : "#ff6b6b"}`,
          }} />
          <div className="stat-label">{t("db.status")}</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 700, marginTop: "0.3rem" }}>
            {status?.connected ? t("db.connected") : t("db.disconnected")}
          </div>
        </div>

        <div className="glass-card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
            {status?.mode === "postgresql" ? "🐘" : "💾"}
          </div>
          <div className="stat-label">{t("db.mode")}</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 700, marginTop: "0.3rem" }}>
            {status?.mode === "postgresql" ? "PostgreSQL" : "In-Memory"}
          </div>
        </div>

        <div className="glass-card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📊</div>
          <div className="stat-label">{t("db.totalRows")}</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 700, marginTop: "0.3rem" }}>
            {status?.totalRows ?? "—"}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "2rem" }}>

        {/* Table stats */}
        <div className="glass-card">
          <h2 style={{ fontWeight: 700, marginBottom: "1.25rem", borderBottom: "1px solid var(--border-glass)", paddingBottom: "0.75rem" }}>
            {t("db.tables")}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {status?.tables && Object.entries(status.tables).map(([table, count]) => (
              <div key={table} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "0.6rem 0.75rem", borderRadius: "10px",
                background: "rgba(255,255,255,0.02)",
              }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{t("db.tbl." + table) !== ("db.tbl." + table) ? t("db.tbl." + table) : table}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginLeft: "0.5rem" }}>{table}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span style={{
                    background: "rgba(0,242,254,0.1)", color: "var(--accent-primary)",
                    padding: "0.2rem 0.75rem", borderRadius: "20px", fontSize: "0.85rem", fontWeight: 700,
                    minWidth: "40px", textAlign: "center",
                  }}>
                    {count as number}
                  </span>
                  {resettable.includes(table) && (
                    <button
                      onClick={() => handleReset(table)}
                      disabled={resetting === table}
                      style={{
                        padding: "0.3rem 0.6rem", borderRadius: "8px", fontSize: "0.75rem",
                        background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.2)",
                        color: "#ff6b6b", cursor: "pointer", fontWeight: 600,
                        opacity: resetting === table ? 0.5 : 1,
                      }}
                    >
                      {resetting === table ? "..." : t("db.resetBtn")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* Backup / Restore */}
          <div className="glass-card">
            <h2 style={{ fontWeight: 700, marginBottom: "1rem", borderBottom: "1px solid var(--border-glass)", paddingBottom: "0.75rem" }}>
              {t("db.backup")}
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="btn-primary"
                style={{ width: "100%", padding: "0.75rem", opacity: exporting ? 0.7 : 1 }}
              >
                {exporting ? t("common.loading") : `📥 ${t("db.export")}`}
              </button>
              <button
                onClick={handleImport}
                disabled={importing}
                style={{
                  width: "100%", padding: "0.75rem", borderRadius: "12px",
                  background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-glass)",
                  color: "var(--text-main)", cursor: "pointer", fontWeight: 600,
                  opacity: importing ? 0.7 : 1,
                }}
              >
                {importing ? t("common.loading") : `📤 ${t("db.import")}`}
              </button>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
