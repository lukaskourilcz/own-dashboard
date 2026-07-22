import { ImageResponse } from "next/og";

// 512×512 — single source for favicon + PWA install icon. Browser scales
// down to 16/32 for the tab favicon; PWA uses it at native size.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/**
 * Connected-work mark — a structured frame, linked path, two square nodes,
 * and one circular endpoint. It mirrors the CSS BrandMark placement contract.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#183b6b",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            width: 300,
            height: 300,
            borderRadius: 52,
            background: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              position: "absolute", left: 78, top: 74, width: 142, height: 142,
              borderLeft: "18px solid #183b6b", borderBottom: "18px solid #183b6b", borderRadius: 8,
            }}
          />
          <div style={{ position: "absolute", left: 54, top: 50, width: 64, height: 64, borderRadius: 12, background: "#183b6b" }} />
          <div style={{ position: "absolute", right: 50, top: 50, width: 64, height: 64, borderRadius: 12, border: "16px solid #183b6b", background: "#ffffff" }} />
          <div style={{ position: "absolute", right: 50, bottom: 48, width: 64, height: 64, borderRadius: 64, background: "#183b6b" }} />
        </div>
      </div>
    ),
    { ...size },
  );
}
