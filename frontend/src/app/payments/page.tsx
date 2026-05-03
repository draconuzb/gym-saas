"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

const API = process.env.NEXT_PUBLIC_API_URL || "";

function formatPrice(n: number) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " so'm";
}

function formatDate(d: string) {
  return new Date(d).toLocaleString("uz-UZ", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function Payments() {
  const { token, loading, fetchWithAuth } = useAuth();
  const { t } = useLocale();
  const [pending, setPending] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [processing, setProcessing] = useState<number | null>(null);
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState(false);

  const loadData = useCallback(() => {
    if (!token) return;
    fetchWithAuth(`${API}/api/payments/pending`)
      .then(r => r.json()).then(d => { if (d.success) setPending(d.data); }).catch(() => setFetchError(true));
    fetchWithAuth(`${API}/api/payments?status=completed`)
      .then(r => r.json()).then(d => { if (d.success) setRecent(d.data.slice(0, 20)); }).catch(() => setFetchError(true));
  }, [token, fetchWithAuth]);

  useEffect(() => { loadData(); }, [loadData]);

  const approve = async (id: number) => {
    if (!confirm(t("payments.confirmApprove"))) return;
    setProcessing(id);
    try {
      const res = await fetchWithAuth(`${API}/api/payments/${id}/approve`, { method: "POST" });
      if (!res.ok) { alert(t("common.error")); setProcessing(null); return; }
      const data = await res.json();
      if (data.success) loadData();
      else alert(data.message || t("common.error"));
    } catch { alert(t("common.serverError")); }
    setProcessing(null);
  };

  const reject = async (id: number) => {
    if (!confirm(t("payments.confirmReject"))) return;
    setProcessing(id);
    try {
      const res = await fetchWithAuth(`${API}/api/payments/${id}/reject`, { method: "POST" });
      if (!res.ok) { alert(t("common.error")); setProcessing(null); return; }
      const data = await res.json();
      if (data.success) loadData();
      else alert(data.message || t("common.error"));
    } catch { alert(t("common.serverError")); }
    setProcessing(null);
  };

  if (loading) return <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("common.loading")}</div>;

  return (
    <>
      {fetchError && (
        <div style={{ padding: "1rem", marginBottom: "1rem", background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: "12px", color: "#ff6b6b" }}>
          {t("common.serverUnreachable")}
        </div>
      )}
      {/* Full-size receipt preview modal */}
      {previewImg && (
        <div
          onClick={() => setPreviewImg(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.85)", display: "flex",
            alignItems: "center", justifyContent: "center", cursor: "zoom-out",
          }}
        >
          <img src={previewImg} alt="Receipt" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "12px", objectFit: "contain" }} />
        </div>
      )}

      <header className="header">
        <h1>
          {t("payments.title")}
          {pending.length > 0 && (
            <span style={{
              marginLeft: "0.75rem", fontSize: "0.9rem", fontWeight: 700,
              background: "linear-gradient(135deg, #f5576c, #ff6b6b)",
              color: "#fff", padding: "0.25rem 0.75rem", borderRadius: "20px",
              verticalAlign: "middle",
            }}>
              {pending.length}
            </span>
          )}
        </h1>
        <button className="btn-primary" onClick={loadData}>{t("common.refresh")}</button>
      </header>

      {/* Pending payments */}
      {pending.length === 0 ? (
        <div className="glass-card" style={{ textAlign: "center", color: "var(--text-muted)", padding: "3rem" }}>
          {t("payments.noPending")}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "1.5rem" }}>
          {pending.map(p => (
            <div key={p.id} className="glass-card" style={{ borderTop: "4px solid #f5a623", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {/* Member info */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: "0.25rem" }}>
                    {p.first_name} {p.last_name || ""}
                  </h3>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    {p.phone || t("common.noPhone")}
                  </div>
                </div>
                <span style={{
                  fontSize: "0.75rem", fontWeight: 600,
                  background: "rgba(245,166,35,0.15)", color: "#f5a623",
                  padding: "0.2rem 0.6rem", borderRadius: "10px",
                }}>
                  {t("common.pending")}
                </span>
              </div>

              {/* Plan & payment details */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                <div>{t("common.plan")}: <strong style={{ color: "var(--text-main)" }}>{p.plan_name}</strong></div>
                <div>{t("payments.gateway")}: <strong style={{ color: "var(--text-main)" }}>{p.gateway}</strong></div>
                <div>{t("common.amount")}: <strong style={{ color: "var(--accent-primary)" }}>{formatPrice(p.amount)}</strong></div>
                <div>{t("common.date")}: <strong style={{ color: "var(--text-main)" }}>{formatDate(p.created_at)}</strong></div>
              </div>

              {/* Receipt photo */}
              {p.receipt_url && (
                <div>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "0.4rem" }}>{t("payments.receiptLabel")}</div>
                  <img
                    src={p.receipt_url}
                    alt="Receipt"
                    onClick={() => setPreviewImg(p.receipt_url)}
                    style={{
                      width: "100%", maxHeight: "200px", objectFit: "cover",
                      borderRadius: "10px", cursor: "zoom-in",
                      border: "1px solid var(--border-glass)",
                    }}
                  />
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "auto" }}>
                <button
                  onClick={() => approve(p.id)}
                  disabled={processing === p.id}
                  style={{
                    flex: 1, padding: "0.7rem", borderRadius: "10px", border: "none",
                    background: "linear-gradient(135deg, #00c853, #00e676)",
                    color: "#fff", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer",
                    opacity: processing === p.id ? 0.5 : 1,
                  }}
                >
                  {processing === p.id ? "..." : t("payments.approve")}
                </button>
                <button
                  onClick={() => reject(p.id)}
                  disabled={processing === p.id}
                  style={{
                    flex: 1, padding: "0.7rem", borderRadius: "10px", border: "none",
                    background: "linear-gradient(135deg, #ff1744, #ff6b6b)",
                    color: "#fff", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer",
                    opacity: processing === p.id ? 0.5 : 1,
                  }}
                >
                  {processing === p.id ? "..." : t("payments.reject")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent processed payments */}
      <div className="glass-card" style={{ marginTop: "2rem" }}>
        <h2 style={{ marginBottom: "1.5rem", fontWeight: 600 }}>{t("payments.recentProcessed")}</h2>
        <div style={{ color: "var(--text-muted)", display: "grid", gap: "1rem" }}>
          {recent.map((tx, i) => (
            <div key={tx.id || i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "1rem", borderBottom: "1px solid var(--border-glass)" }}>
              <div>
                <strong style={{ color: "var(--text-main)" }}>{tx.first_name || t("common.unknown")} {tx.last_name || ""}</strong>
                <div style={{ fontSize: "0.8rem", marginTop: "0.2rem" }}>{tx.gateway} · {tx.status} · #{tx.id}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: tx.status === "completed" ? "#00c853" : tx.status === "failed" ? "#ff6b6b" : "var(--text-muted)", fontWeight: 800 }}>
                  {formatPrice(tx.amount)}
                </div>
                <div style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                  {tx.status === "completed" ? t("payments.approved") : tx.status === "failed" ? t("payments.rejected") : tx.status}
                </div>
              </div>
            </div>
          ))}
          {recent.length === 0 && <p style={{ textAlign: "center", padding: "1rem 0" }}>{t("payments.noProcessed")}</p>}
        </div>
      </div>
    </>
  );
}
