import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // The vendored studio is built output loaded by Node itself, as in production
    // (serverExternalPackages in next.config.ts); Vite never transforms it.
    server: { deps: { external: [/\/vendor\/carousel-studio\//] } },
  },
});
