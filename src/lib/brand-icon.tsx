import "server-only";
import { ImageResponse } from "next/og";
import { brandConfig } from "@/lib/brand";

/**
 * Connected-work mark — a structured frame, linked path, two square nodes,
 * and one circular endpoint. It mirrors the CSS BrandMark placement contract.
 */
export function renderAppIcon(edge: 192 | 512) {
  const ink = brandConfig.metadataColors.mark;
  const scale = (value: number) => value * edge / 512;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: ink,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            width: scale(300),
            height: scale(300),
            borderRadius: scale(52),
            background: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              position: "absolute", left: scale(78), top: scale(74), width: scale(142), height: scale(142),
              borderLeft: `${scale(18)}px solid ${ink}`, borderBottom: `${scale(18)}px solid ${ink}`, borderRadius: scale(8),
            }}
          />
          <div style={{ position: "absolute", left: scale(54), top: scale(50), width: scale(64), height: scale(64), borderRadius: scale(12), background: ink }} />
          <div style={{ position: "absolute", right: scale(50), top: scale(50), width: scale(64), height: scale(64), borderRadius: scale(12), border: `${scale(16)}px solid ${ink}`, background: "#ffffff" }} />
          <div style={{ position: "absolute", right: scale(50), bottom: scale(48), width: scale(64), height: scale(64), borderRadius: scale(64), background: ink }} />
        </div>
      </div>
    ),
    { width: edge, height: edge },
  );
}
