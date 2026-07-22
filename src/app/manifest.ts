import type { MetadataRoute } from "next";
import { brandConfig } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brandConfig.name,
    short_name: brandConfig.shortName,
    description: brandConfig.description.en,
    start_url: "/",
    id: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f4ef",
    theme_color: "#183b6b",
    icons: [
      { src: "/icon", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    categories: ["productivity", "business", "finance"],
    shortcuts: [
      { name: "Inbox", short_name: "Inbox", url: "/inbox" },
      { name: "Projects", short_name: "Projects", url: "/projects" },
      { name: "Quick capture", short_name: "Capture", url: "/?capture=1" },
    ],
  };
}
