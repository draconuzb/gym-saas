"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

const API = process.env.NEXT_PUBLIC_API_URL || "";

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });
}

export default function EntryPage() {
  const { token, loading: authLoading, fetchWithAuth } = useAuth();
  const { t } = useLocale();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "found" | "granted" | "denied">("idle");
  const [result, setResult] = useState<any>(null);
  const [todayCheckins, setTodayCheckins] = useState<any[]>([]);
  const [approving, setApproving] = useState(false);

  const pressKey = (n: string) => {
    if (code.length >= 6) return;
    const newCode = code + n;
    setCode(newCode);
    if (newCode.length === 6) verifyCode(newCode);
  };

  const clearCode = () => {
    setCode("");
    setStatus("idle");
    setResult(null);
  };

  const verifyCode = async (c: string) => {
    setStatus("checking");
    try {
      const res = await fetchWithAuth(`${API}/api/verify-code`, {
        method: "POST",
        body: JSON.stringify({ code: c }),
      });
      const data = await res.json();

      if (data.pending) {
        setStatus("found");
        setResult(data);
      } else if (data.granted) {
        setStatus("granted");
        setResult(data);
        setTimeout(clearCode, 4000);
      } else {
        setStatus("denied");
        setResult(data);
        setTimeout(clearCode, 4000);
      }
    } catch {
      setStatus("denied");
      setResult({ message: t("common.serverError") });
      setTimeout(clearCode, 3000);
    }
  };

  const approveEntry = async () => {
    if (!result) return;
    setApproving(true);
    try {
      const res = await fetchWithAuth(`${API}/api/approve-checkin`, {
        method: "POST",
        body: JSON.stringify({ memberId: result.memberId, subscriptionId: result.subscriptionId }),
      });
      const data = await res.json();
      if (data.granted) {
        setStatus("granted");
        setResult(data);
      } else {
        setStatus("denied");
        setResult(data);
      }
      setTimeout(clearCode, 4000);
    } catch {
      setStatus("denied");
    }
    setApproving(false);
  };

  if (authLoading) return <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("common.loading")}</div>;

  const displayCode = code.split("").concat(Array(6 - code.length).fill("_")).join(" ");

  return (
    <>
      <header className="header">
        <h1>{t("entry.title")}</h1>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "2rem" }}>

        {/* Left: Number pad */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem" }}>

          {/* Status message */}
          {status === "idle" && (
            <p style={{ color: "var(--text-muted)", fontSize: "1rem" }}>{t("entry.subtitle")}</p>
          )}
          {status === "checking" && (
            <p style={{ color: "var(--accent-primary)", fontSize: "1rem" }}>{t("entry.checking")}</p>
          )}

          {/* Code display */}
          <div style={{
            fontSize: "2.5rem", fontWeight: 900, letterSpacing: "0.8rem",
            padding: "1rem 2rem", borderRadius: "16px", minWidth: "280px", textAlign: "center",
            background: status === "granted" ? "rgba(0,242,254,0.1)" :
                       status === "denied" ? "rgba(255,80,80,0.1)" :
                       status === "found" ? "rgba(255,200,0,0.1)" : "rgba(255,255,255,0.05)",
            border: status === "granted" ? "2px solid rgba(0,242,254,0.5)" :
                   status === "denied" ? "2px solid rgba(255,80,80,0.5)" :
                   status === "found" ? "2px solid rgba(255,200,0,0.5)" : "2px solid var(--border-glass)",
            color: status === "granted" ? "#00f2fe" :
                  status === "denied" ? "#ff5050" :
                  status === "found" ? "#ffc800" : "var(--text-main)",
            transition: "all 0.3s",
          }}>
            {displayCode}
          </div>

          {/* Result card */}
          {(status === "found" || status === "granted" || status === "denied") && result && (
            <div className="glass-card" style={{
              width: "100%", textAlign: "center", padding: "1.5rem",
              borderColor: status === "granted" ? "rgba(0,242,254,0.3)" :
                          status === "denied" ? "rgba(255,80,80,0.3)" : "rgba(255,200,0,0.3)",
            }}>
              <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>
                {status === "granted" ? "✅" : status === "denied" ? "🚫" : "⏳"}
              </div>
              <div style={{
                fontSize: "1.3rem", fontWeight: 900, marginBottom: "0.3rem",
                color: status === "granted" ? "#00f2fe" : status === "denied" ? "#ff5050" : "#ffc800",
              }}>
                {status === "granted" ? t("entry.granted") : status === "denied" ? t("entry.denied") : t("entry.memberFound")}
              </div>
              <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>
                {result.name}{result.plan ? ` · ${result.plan}` : ""}
              </div>
              <div style={{ color: "var(--text-muted)", marginTop: "0.3rem" }}>
                {status === "granted"
                  ? `${result.days_left} ${t("entry.daysLeft")}`
                  : status === "denied"
                  ? (result.message || t("entry.expired"))
                  : `${result.days_left} ${t("entry.daysLeft")}`}
              </div>

              {status === "found" && (
                <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem" }}>
                  <button onClick={approveEntry} disabled={approving} className="btn-primary"
                    style={{ flex: 1, padding: "0.9rem", fontSize: "1rem" }}>
                    {approving ? "..." : t("entry.approve")}
                  </button>
                  <button onClick={clearCode}
                    style={{ flex: 1, padding: "0.9rem", borderRadius: "12px", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-glass)", color: "var(--text-main)", cursor: "pointer", fontWeight: 600, fontSize: "1rem" }}>
                    {t("entry.cancel")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Number pad */}
          {(status === "idle" || status === "checking") && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.6rem", maxWidth: "300px", width: "100%" }}>
              {[1,2,3,4,5,6,7,8,9].map(n => (
                <button key={n} onClick={() => pressKey(String(n))}
                  style={{ fontSize: "1.6rem", fontWeight: 800, padding: "1rem", borderRadius: "14px", border: "1px solid var(--border-glass)", background: "rgba(255,255,255,0.05)", color: "white", cursor: "pointer" }}>
                  {n}
                </button>
              ))}
              <button onClick={clearCode}
                style={{ fontSize: "1rem", fontWeight: 700, padding: "1rem", borderRadius: "14px", border: "1px solid rgba(255,80,80,0.2)", background: "rgba(255,80,80,0.1)", color: "#ff5050", cursor: "pointer" }}>
                {t("entry.clear")}
              </button>
              <button onClick={() => pressKey("0")}
                style={{ fontSize: "1.6rem", fontWeight: 800, padding: "1rem", borderRadius: "14px", border: "1px solid var(--border-glass)", background: "rgba(255,255,255,0.05)", color: "white", cursor: "pointer" }}>
                0
              </button>
              <button onClick={() => { if (code.length === 6) verifyCode(code); }}
                style={{ fontSize: "1rem", fontWeight: 700, padding: "1rem", borderRadius: "14px", border: "none", background: "var(--gradient-action)", color: "#000", cursor: "pointer" }}>
                {t("entry.approve").split(" ")[0]}
              </button>
            </div>
          )}
        </div>

        {/* Right: Today's check-ins */}
        <div className="glass-card" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          <h2 style={{ fontWeight: 700, marginBottom: "1rem", borderBottom: "1px solid var(--border-glass)", paddingBottom: "0.75rem" }}>
            {t("entry.todayCheckins")}
          </h2>
          <TodayCheckins token={token} t={t} />
        </div>
      </div>
    </>
  );
}

function TodayCheckins({ token, t }: { token: string | null; t: (k: string) => string }) {
  const [checkins, setCheckins] = useState<any[]>([]);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    fetch(`${API}/api/reports/today-checkins`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.success) { setCheckins(d.data); setError(false); } })
      .catch(() => { setError(true); });
  }, [token]);

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (!document.hidden) load();
    }, 10000);
    return () => clearInterval(interval);
  }, [load]);

  if (checkins.length === 0) {
    return (
      <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "2rem 0" }}>
        {t("entry.noCheckins")}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {checkins.map((c, i) => (
        <div key={c.id} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "0.75rem", borderRadius: "10px", background: "rgba(255,255,255,0.03)",
        }}>
          <div>
            <span style={{ fontWeight: 700 }}>{c.first_name} {c.last_name || ""}</span>
            <span style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginLeft: "0.5rem" }}>{c.plan}</span>
          </div>
          <span style={{ color: "var(--accent-primary)", fontSize: "0.85rem", fontWeight: 600 }}>
            {formatTime(c.checked_in_at)}
          </span>
        </div>
      ))}
    </div>
  );
}
