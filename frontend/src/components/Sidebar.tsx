"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/hooks/useLocale";
import { useAuth } from "@/hooks/useAuth";
import { Locale } from "@/lib/i18n";

const adminOnlyPaths = ["/database", "/settings", "/reports", "/subscriptions"];

const navKeys = [
  { href: "/entry",         key: "nav.entry"         },
  { href: "/",              key: "nav.dashboard"     },
  { href: "/members",       key: "nav.members"       },
  { href: "/trainers",      key: "nav.trainers"      },
  { href: "/classes",       key: "nav.classes"       },
  { href: "/subscriptions", key: "nav.subscriptions" },
  { href: "/payments",      key: "nav.payments"      },
  { href: "/daily",          key: "nav.daily"         },
  { href: "/qrcodes",       key: "nav.qrcodes"       },
  { href: "/attendance",    key: "nav.attendance"    },
  { href: "/loyalty",       key: "nav.loyalty"       },
  { href: "/reports",       key: "nav.reports"       },
  { href: "/database",      key: "nav.database"      },
  { href: "/settings",      key: "nav.settings"      },
];

const flags: Record<string, string> = { uz: "\u{1F1FA}\u{1F1FF}", ru: "\u{1F1F7}\u{1F1FA}" };

export default function Sidebar() {
  const pathname = usePathname();
  const { t, locale, setLocale, languages } = useLocale();
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const isSuperAdmin = user?.role === "super_admin";
  const visibleNav = navKeys.filter(
    (item) => isAdmin || !adminOnlyPaths.includes(item.href)
  );

  // Display the gym name (or "Super Admin" when not currently scoped to one)
  const gymLabel = isSuperAdmin
    ? (typeof window !== "undefined" && localStorage.getItem("activeGymId")
        ? `Gym #${localStorage.getItem("activeGymId")}`
        : "Super Admin")
    : (user?.gymName || "GymSystem");

  return (
    <>
    <div
      className={`sidebar-overlay${mobileOpen ? " visible" : ""}`}
      onClick={() => setMobileOpen(false)}
    />
    <button
      className="hamburger-btn"
      onClick={() => setMobileOpen(!mobileOpen)}
      style={{
        display: "none",
        position: "fixed",
        top: "12px",
        left: "12px",
        zIndex: 1001,
        background: "rgba(20,20,30,0.95)",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: "8px",
        color: "#fff",
        padding: "8px 12px",
        cursor: "pointer",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "1.4rem",
        lineHeight: 1,
        backdropFilter: "blur(8px)",
      }}
      aria-label="Toggle menu"
    >
      {mobileOpen ? "\u2715" : "\u2630"}
    </button>
    <aside className={`sidebar${mobileOpen ? " mobile-open" : ""}`}>
      <div className="brand">{gymLabel}</div>
      {isSuperAdmin && (
        <Link
          href="/admin/gyms"
          className="nav-item"
          onClick={() => setMobileOpen(false)}
          style={{
            background: "rgba(0,242,254,0.08)",
            border: "1px solid rgba(0,242,254,0.25)",
            margin: "0.25rem 0 0.75rem",
            fontSize: "0.85rem",
            textAlign: "center",
            display: "block",
          }}
        >
          ← Zallar ro'yxati
        </Link>
      )}
      <nav>
        <ul className="nav-links">
          {visibleNav.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`nav-item ${pathname === item.href ? "active" : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                {t(item.key)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div style={{ padding: "0.75rem 0", borderTop: "1px solid var(--border-glass)", marginTop: "auto" }}>
        <div style={{ display: "flex", gap: "0.25rem", justifyContent: "center" }}>
          {(Object.keys(languages) as Locale[]).map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              style={{
                padding: "0.35rem 0.5rem",
                borderRadius: "8px",
                border: locale === l ? "1px solid var(--accent-primary)" : "1px solid transparent",
                background: locale === l ? "rgba(0,242,254,0.1)" : "transparent",
                cursor: "pointer",
                fontSize: "1rem",
                transition: "all 0.2s",
              }}
              title={languages[l]}
            >
              {flags[l]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ paddingTop: "0.5rem", borderTop: "1px solid var(--border-glass)" }}>
        <button
          onClick={() => { localStorage.removeItem("token"); localStorage.removeItem("refreshToken"); localStorage.removeItem("user"); window.location.href = "/login"; }}
          className="nav-item"
          style={{ color: "#ff6b6b", background: "none", border: "none", cursor: "pointer", width: "100%", textAlign: "left", padding: "0.75rem 1rem", fontSize: "inherit" }}
        >
          {t("nav.signOut")}
        </button>
      </div>
    </aside>
    </>
  );
}
