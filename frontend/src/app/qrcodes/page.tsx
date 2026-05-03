"use client";

import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || "Oson_gym_bot";

export default function QRCodes() {
  const { loading } = useAuth();
  const { t } = useLocale();

  const registrationUrl = `https://t.me/${BOT_USERNAME}?start=register`;
  const checkinUrl = `https://t.me/${BOT_USERNAME}?start=checkin`;
  const qrApiBase = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=`;

  // TODO: Replace external QR API (api.qrserver.com) with client-side generation
  // using a library like qrcode.react (npm install qrcode.react) for better
  // privacy, reliability, and offline support.
  const handlePrint = (type: "register" | "checkin") => {
    const url = type === "register" ? registrationUrl : checkinUrl;
    const title = type === "register" ? t("qrcodes.registration") : t("qrcodes.attendance");
    const w = window.open("", "_blank");
    if (!w) return;
    const doc = w.document;
    doc.open();
    const safeTitle = document.createTextNode(title).textContent || '';
    const safeUrl = encodeURI(url);
    doc.write(`<!DOCTYPE html><html><head><title>${safeTitle}</title><style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;}</style></head><body><h1>${safeTitle}</h1><img src="https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(url)}" alt="QR"/><p>${safeUrl}</p><script>window.print();</script></body></html>`);
    doc.close();
  };

  if (loading) return <div style={{ padding: "3rem", color: "var(--text-muted)" }}>{t("common.loading")}</div>;

  return (
    <>
      <header className="header"><h1>{t("qrcodes.title")}</h1></header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", gap: "2rem" }}>
        <div className="glass-card" style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📱</div>
          <h2 style={{ marginBottom: "0.5rem", fontWeight: 700 }}>{t("qrcodes.registration")}</h2>
          <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem", fontSize: "0.9rem" }}>{t("qrcodes.regDesc")}</p>
          <img src={`${qrApiBase}${encodeURIComponent(registrationUrl)}`} alt="Registration QR"
            style={{ width: "250px", height: "250px", borderRadius: "12px", background: "white", padding: "12px" }} />
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "1rem", wordBreak: "break-all" }}>{registrationUrl}</p>
          <button className="btn-primary" onClick={() => handlePrint("register")} style={{ marginTop: "1rem", width: "100%" }}>
            {t("qrcodes.print")}
          </button>
        </div>
        <div className="glass-card" style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>✅</div>
          <h2 style={{ marginBottom: "0.5rem", fontWeight: 700 }}>{t("qrcodes.attendance")}</h2>
          <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem", fontSize: "0.9rem" }}>{t("qrcodes.attDesc")}</p>
          <img src={`${qrApiBase}${encodeURIComponent(checkinUrl)}`} alt="Attendance QR"
            style={{ width: "250px", height: "250px", borderRadius: "12px", background: "white", padding: "12px" }} />
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "1rem", wordBreak: "break-all" }}>{checkinUrl}</p>
          <button className="btn-primary" onClick={() => handlePrint("checkin")} style={{ marginTop: "1rem", width: "100%" }}>
            {t("qrcodes.print")}
          </button>
        </div>
      </div>
      <div className="glass-card" style={{ marginTop: "1.5rem" }}>
        <h3 style={{ marginBottom: "0.75rem", fontWeight: 600 }}>{t("qrcodes.howTitle")}</h3>
        <ol style={{ color: "var(--text-muted)", lineHeight: "2", paddingLeft: "1.2rem" }}>
          <li>{t("qrcodes.step1")}</li>
          <li>{t("qrcodes.step2")}</li>
          <li>{t("qrcodes.step3")}</li>
          <li>{t("qrcodes.step4")}</li>
        </ol>
      </div>
    </>
  );
}
