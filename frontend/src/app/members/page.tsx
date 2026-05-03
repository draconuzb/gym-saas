"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0.7rem", background: "rgba(255,255,255,0.05)",
  border: "1px solid var(--border-glass)", borderRadius: "10px",
  color: "var(--text-main)", outline: "none",
};

type StatusFilter = "all" | "active" | "expired" | "blocked";

export default function Members() {
  const { token, loading, fetchWithAuth } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const [members, setMembers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", planId: "", remainingDays: "" });
  const [formError, setFormError] = useState("");
  const [plans, setPlans] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [fetchError, setFetchError] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const loadMembers = useCallback(() => {
    if (!token) return;
    let url = `${API}/api/members`;
    const params: string[] = [];
    if (debouncedSearch) params.push(`search=${debouncedSearch}`);
    if (statusFilter === "active") params.push("status=active");
    else if (statusFilter === "expired") params.push("status=expired");
    params.push(`limit=${PAGE_SIZE}`);
    params.push(`offset=${(page - 1) * PAGE_SIZE}`);
    if (params.length > 0) url += "?" + params.join("&");

    fetchWithAuth(url)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          let filtered = data.data;
          if (statusFilter === "blocked") {
            filtered = filtered.filter((m: any) => m.is_active === false);
          }
          setMembers(filtered);
          if (data.total !== undefined) {
            setTotalCount(data.total);
          } else {
            setTotalCount(filtered.length === PAGE_SIZE ? (page * PAGE_SIZE) + 1 : (page - 1) * PAGE_SIZE + filtered.length);
          }
          setSelected(new Set());
        }
      })
      .catch(() => setFetchError(true));
  }, [debouncedSearch, token, statusFilter, page, fetchWithAuth]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  useEffect(() => {
    if (!token) return;
    fetchWithAuth(`${API}/api/plans`)
      .then(r => r.json()).then(d => { if (d.success) setPlans(d.data); }).catch(() => {});
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setFormError("");
    try {
      const body: any = { firstName: form.firstName, lastName: form.lastName, phone: form.phone };
      if (form.planId) body.planId = parseInt(form.planId);
      if (form.remainingDays) body.remainingDays = parseInt(form.remainingDays);
      const res = await fetchWithAuth(`${API}/api/members/register`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setShowForm(false);
        setFormError("");
        setForm({ firstName: "", lastName: "", phone: "", planId: "", remainingDays: "" });
        loadMembers();
      } else {
        setFormError(data.message || t("members.registrationFailed"));
      }
    } catch { setFormError(t("common.serverNotReachable")); }
    setSubmitting(false);
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === members.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(members.map(m => m.id)));
    }
  };

  const handleDeleteMember = async (id: number) => {
    if (!token) return;
    if (!confirm(t("members.confirmDeleteAction"))) return;
    try {
      const res = await fetchWithAuth(`${API}/api/members/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) loadMembers();
    } catch { /* ignore */ }
  };

  const handleBulkBlock = async () => {
    if (!token || selected.size === 0) return;
    if (!confirm(t("members.confirmBulkBlock"))) return;
    const results = await Promise.allSettled(
      [...selected].map(id =>
        fetchWithAuth(`${API}/api/members/${id}`, {
          method: "PUT",
          body: JSON.stringify({ isActive: false }),
        })
      )
    );
    const failed = results.filter(r => r.status === "rejected");
    if (failed.length > 0) alert(`${failed.length} ${t("common.error")}`);
    setSelected(new Set());
    loadMembers();
  };

  const handleBulkDelete = async () => {
    if (!token || selected.size === 0) return;
    if (!confirm(t("members.confirmBulkDelete"))) return;
    const results = await Promise.allSettled(
      [...selected].map(id =>
        fetchWithAuth(`${API}/api/members/${id}`, {
          method: "DELETE",
        })
      )
    );
    const failed = results.filter(r => r.status === "rejected");
    if (failed.length > 0) alert(`${failed.length} ${t("common.error")}`);
    setSelected(new Set());
    loadMembers();
  };

  if (loading) return <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("common.loading")}</div>;

  const errorBanner = fetchError ? (
    <div style={{ padding: "1rem", marginBottom: "1rem", background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: "12px", color: "#ff6b6b" }}>
      {t("common.serverUnreachable")}
    </div>
  ) : null;

  const filterButtons: { label: string; value: StatusFilter }[] = [
    { label: t("members.all"), value: "all" },
    { label: t("members.active"), value: "active" },
    { label: t("members.expired"), value: "expired" },
    { label: t("members.blocked"), value: "blocked" },
  ];

  return (
    <>
      {errorBanner}
      <header className="header">
        <h1>{t("members.title")}</h1>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? t("members.cancel") : t("members.register")}
        </button>
      </header>

      {showForm && (
        <div className="glass-card" style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ fontWeight: 700, marginBottom: "1rem" }}>{t("members.register")}</h3>
          {formError && (
            <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff6b6b", padding: "0.6rem 1rem", borderRadius: "10px", marginBottom: "1rem", fontSize: "0.9rem" }}>
              {formError}
            </div>
          )}
          <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <input style={inputStyle} placeholder={`${t("members.firstName")} *`} required value={form.firstName}
              onChange={e => setForm({ ...form, firstName: e.target.value })} />
            <input style={inputStyle} placeholder={t("members.lastName")} value={form.lastName}
              onChange={e => setForm({ ...form, lastName: e.target.value })} />
            <input style={inputStyle} placeholder={`${t("members.phone")} *`} required value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })} />
            <select style={{ ...inputStyle, cursor: "pointer" }} value={form.planId}
              onChange={e => setForm({ ...form, planId: e.target.value })}>
              <option value="">{t("members.noPlan")}</option>
              {plans.map(p => (
                <option key={p.id} value={p.id}>{p.emoji} {p.name} — {p.days} {t("common.days")}</option>
              ))}
            </select>
            {form.planId && (
              <input style={inputStyle} type="number" placeholder={t("members.remainingDays")} min="1" max="365"
                value={form.remainingDays}
                onChange={e => setForm({ ...form, remainingDays: e.target.value })} />
            )}
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <button type="submit" className="btn-primary" disabled={submitting} style={{ flex: 1 }}>
                {submitting ? t("members.registering") : t("members.register.btn")}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                style={{ flex: 1, padding: "0.6rem", background: "transparent", border: "1px solid var(--border-glass)", borderRadius: "10px", color: "var(--text-main)", cursor: "pointer", fontWeight: 600 }}>
                {t("members.cancel")}
              </button>
            </div>
          </form>
          {form.planId && (
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "0.75rem" }}>
              {t("members.importHint")}
            </p>
          )}
        </div>
      )}

      {/* Search + Filter Row */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder={t("members.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "0.75rem 1rem",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid var(--border-glass)",
            borderRadius: "12px",
            color: "var(--text-main)",
            fontSize: "0.95rem",
            outline: "none",
            width: "300px",
          }}
        />
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {filterButtons.map(fb => (
            <button
              key={fb.value}
              onClick={() => setStatusFilter(fb.value)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "20px",
                border: statusFilter === fb.value ? "none" : "1px solid var(--border-glass)",
                background: statusFilter === fb.value ? "var(--gradient-action)" : "rgba(255,255,255,0.05)",
                color: "var(--text-main)",
                fontSize: "0.85rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              {fb.label}
            </button>
          ))}
        </div>
      </div>

      <div className="glass-card" style={{ flex: 1, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-glass)", color: "var(--text-muted)" }}>
              <th style={{ padding: "1rem", width: "40px" }}>
                <input
                  type="checkbox"
                  checked={members.length > 0 && selected.size === members.length}
                  onChange={toggleSelectAll}
                  style={{ cursor: "pointer", width: "16px", height: "16px", accentColor: "var(--accent-primary)" }}
                />
              </th>
              <th style={{ padding: "1rem" }}>ID</th>
              <th style={{ padding: "1rem" }}>{t("members.name")}</th>
              <th style={{ padding: "1rem" }}>{t("members.phone")}</th>
              <th style={{ padding: "1rem" }}>{t("members.plan")}</th>
              <th style={{ padding: "1rem" }}>{t("members.status")}</th>
              <th style={{ padding: "1rem" }}>{t("members.action")}</th>
            </tr>
          </thead>
          <tbody>
            {members.map(member => {
              const isActive = member.is_active !== false && member.sub_status === "active" && (member.total_days - member.days_used) > 0;
              const isBlocked = member.is_active === false;
              return (
                <tr key={member.id} style={{ borderBottom: "1px solid var(--border-glass)", opacity: isBlocked ? 0.6 : 1 }}>
                  <td style={{ padding: "1rem" }}>
                    <input
                      type="checkbox"
                      checked={selected.has(member.id)}
                      onChange={() => toggleSelect(member.id)}
                      style={{ cursor: "pointer", width: "16px", height: "16px", accentColor: "var(--accent-primary)" }}
                    />
                  </td>
                  <td style={{ padding: "1rem" }}>#{member.id}</td>
                  <td style={{ padding: "1rem", fontWeight: 600 }}>{member.first_name} {member.last_name || ""}</td>
                  <td style={{ padding: "1rem", color: "var(--text-muted)" }}>{member.phone || "\u2014"}</td>
                  <td style={{ padding: "1rem" }}>{member.plan}</td>
                  <td style={{ padding: "1rem" }}>
                    <span style={{
                      padding: "0.25rem 0.75rem",
                      borderRadius: "20px",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      backgroundColor: isBlocked
                        ? "rgba(255, 165, 0, 0.1)"
                        : isActive
                          ? "rgba(0, 242, 254, 0.1)"
                          : "rgba(255, 107, 107, 0.1)",
                      color: isBlocked
                        ? "#ffa500"
                        : isActive
                          ? "var(--accent-primary)"
                          : "#ff6b6b",
                    }}>
                      {isBlocked ? t("members.blocked") : isActive ? t("members.active") : t("members.expired")}
                    </span>
                  </td>
                  <td style={{ padding: "1rem" }}>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <Link href={`/members/${member.id}`} style={{ background: "transparent", border: "1px solid var(--border-glass)", color: "white", padding: "0.5rem 1rem", borderRadius: "8px", cursor: "pointer", textDecoration: "none", fontSize: "0.85rem" }}>
                        {t("members.viewProfile")}
                      </Link>
                      <button
                        onClick={() => handleDeleteMember(member.id)}
                        title={t("members.delete")}
                        style={{
                          background: "rgba(255, 59, 48, 0.15)",
                          border: "1px solid rgba(255, 59, 48, 0.3)",
                          color: "#ff3b30",
                          padding: "0.45rem 0.6rem",
                          borderRadius: "8px",
                          cursor: "pointer",
                          fontSize: "0.85rem",
                          lineHeight: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {members.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
                  {t("members.noMembers")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "16px" }}>
        <button
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page === 1}
          style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid #333", background: page === 1 ? "#1a1a2e" : "#16213e", color: "#fff", cursor: page === 1 ? "not-allowed" : "pointer" }}
        >
          &larr;
        </button>
        <span style={{ padding: "8px 16px", color: "#8892b0" }}>
          {page}
        </span>
        <button
          onClick={() => setPage(p => p + 1)}
          disabled={members.length < PAGE_SIZE}
          style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid #333", background: members.length < PAGE_SIZE ? "#1a1a2e" : "#16213e", color: "#fff", cursor: members.length < PAGE_SIZE ? "not-allowed" : "pointer" }}
        >
          &rarr;
        </button>
      </div>

      {/* Bulk Action Bar */}
      {selected.size > 0 && (
        <div style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "1rem 2rem",
          background: "rgba(20, 20, 30, 0.95)",
          backdropFilter: "blur(20px)",
          borderTop: "1px solid var(--border-glass)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          zIndex: 100,
          animation: "slideUp 0.25s ease-out",
        }}>
          <span style={{ color: "var(--text-muted)", fontSize: "0.9rem", fontWeight: 600 }}>
            {selected.size} {t("members.selected")}
          </span>
          <button
            onClick={handleBulkBlock}
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "10px",
              border: "none",
              background: "rgba(255, 165, 0, 0.2)",
              color: "#ffa500",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            {t("members.blockSelected")}
          </button>
          <button
            onClick={handleBulkDelete}
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "10px",
              border: "none",
              background: "rgba(255, 59, 48, 0.2)",
              color: "#ff3b30",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            {t("members.deleteSelected")}
          </button>
        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}
