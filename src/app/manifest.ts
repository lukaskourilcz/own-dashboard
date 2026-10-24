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
    background_color: brandConfig.metadataColors.background,
    theme_color: brandConfig.metadataColors.background,
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-192",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    categories: ["productivity", "business", "finance"],
    shortcuts: [
      // Inbox is hidden from navigation (HIDDEN_NAV_TABS); Tasks takes its slot.
      { name: "Tasks", short_name: "Tasks", url: "/tasks" },
      { name: "Projects", short_name: "Projects", url: "/projects" },
      { name: "Quick capture", short_name: "Capture", url: "/?capture=1" },
    ],
  };
}
