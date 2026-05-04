"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";
  // Super-admin platform views render full-bleed (no sidebar)
  const isSuperAdminView = pathname?.startsWith("/admin/");

  if (isLogin || isSuperAdminView) return <>{children}</>;

  return (
    <div className="dashboard-container">
      <Sidebar />
      <main className="main-content">{children}</main>
    </div>
  );
}
