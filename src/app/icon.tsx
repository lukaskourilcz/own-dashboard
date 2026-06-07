import { ImageResponse } from "next/og";

// 512×512 — single source for favicon + PWA install icon. Browser scales
// down to 16/32 for the tab favicon; PWA uses it at native size.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/**
 * Minimal "stacked panels" mark — two concentric rounded rectangles in
 * black-on-cream (matches the dashboard's primary + background tokens).
 * Reads cleanly at 16×16 (browser tab) and looks intentional at PWA size.
 * No letter monogram — letters mush at small sizes.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0a0a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* outer panel */}
        <div
          style={{
            width: 320,
            height: 320,
            borderRadius: 56,
            background: "#fafafa",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "flex-end",
            padding: 40,
          }}
        >
          {/* inner panel — offset bottom-right */}
          <div
            style={{
              width: 160,
              height: 160,
              borderRadius: 28,
              background: "#0a0a0a",
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
