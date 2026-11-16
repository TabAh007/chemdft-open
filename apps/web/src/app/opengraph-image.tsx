import { ImageResponse } from "next/og";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";
export const alt = "ChemDFT — Free online DFT in your browser";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 80px",
          background: "linear-gradient(135deg, #0e2238 0%, #071320 100%)",
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        {/* Top bar with Logo & Tagline */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <svg width="64" height="64" viewBox="0 0 256 256">
              <defs>
                <linearGradient id="ogbg" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#E4ECF1" />
                  <stop offset="0.55" stopColor="#8FB0C6" />
                  <stop offset="1" stopColor="#2F5878" />
                </linearGradient>
              </defs>
              <rect width="256" height="256" rx="56" fill="url(#ogbg)" />
              <circle cx="140" cy="80" r="22" fill="#80868C" />
              <circle cx="95" cy="72" r="24" fill="#D9A520" />
              <circle cx="65" cy="100" r="20" fill="#80868C" />
              <circle cx="50" cy="145" r="20" fill="#80868C" />
              <circle cx="60" cy="190" r="22" fill="#80868C" />
              <circle cx="100" cy="210" r="22" fill="#80868C" />
              <circle cx="145" cy="200" r="22" fill="#D8403A" />
              <circle cx="32" cy="195" r="18" fill="#3A66B8" />
              <circle cx="85" cy="235" r="20" fill="#D8403A" />
            </svg>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em", color: "#F4F6F8" }}>
                ChemDFT
              </div>
              <div style={{ fontSize: 16, color: "#8FB0C6", fontWeight: 500 }}>
                chemdft.com
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 18px",
              borderRadius: 20,
              background: "rgba(47, 88, 120, 0.4)",
              border: "1px solid rgba(143, 176, 198, 0.3)",
              fontSize: 16,
              color: "#A2C3D9",
              fontWeight: 500,
            }}
          >
            Scientific Computing Beta
          </div>
        </div>

        {/* Central message */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              fontSize: 64,
              fontWeight: 800,
              lineHeight: 1.12,
              letterSpacing: "-0.03em",
              color: "#ffffff",
              maxWidth: 950,
            }}
          >
            Free online DFT in your browser
          </div>
          <div
            style={{
              fontSize: 26,
              lineHeight: 1.4,
              color: "#A2C3D9",
              maxWidth: 900,
            }}
          >
            An AI Scientist plans; real engines calculate.
          </div>
        </div>

        {/* Engine Pills Bottom Bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {["PySCF 2.14.0", "Quantum ESPRESSO 7.6", "xTB 6.7.1", "CREST 3.0.2"].map((engine) => (
            <div
              key={engine}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 16px",
                borderRadius: 8,
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                fontSize: 16,
                fontWeight: 600,
                color: "#E4ECF1",
              }}
            >
              {engine}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
