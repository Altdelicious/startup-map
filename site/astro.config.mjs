// @ts-check
import { defineConfig } from "astro/config";

// SITE_BASE is "/<repo>/" for GitHub project pages and "/" for a custom domain (see .github/workflows/deploy.yml).
export default defineConfig({
  site: process.env.SITE_URL || "http://localhost:4321",
  base: process.env.SITE_BASE || "/",
  trailingSlash: "ignore",
  build: { format: "directory" },
});
