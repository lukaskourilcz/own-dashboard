import { ImageResponse } from "next/og";

// Single icon endpoint serves the favicon + maskable PWA icon. 512x512 is
// large enough for every install context; the browser scales down.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0a0a",
          color: "#fafafa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 320,
          fontWeight: 700,
          fontFamily: "system-ui, sans-serif",
          letterSpacing: "-0.04em",
        }}
      >
        d
      </div>
    ),
    { ...size },
  );
}
