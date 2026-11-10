import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://ace-coderr.github.io/assay/ (GitHub Pages), so every asset URL needs the /assay/ prefix.
// Routing is hash-based, so deep links work without any server rewrite rules.
export default defineConfig({
  base: "/assay/",
  plugins: [react()],
  server: { port: 5199, strictPort: false },
  build: {
    sourcemap: false,
    rollupOptions: { output: { manualChunks: { viem: ["viem"], react: ["react", "react-dom", "react-router-dom"] } } },
  },
});
