import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "https://assay-onbase.netlify.app", "/mcp": "https://assay-onbase.netlify.app" } },
  build: {
    sourcemap: false,
    rollupOptions: { output: { manualChunks: { viem: ["viem"], react: ["react", "react-dom", "react-router-dom"] } } },
  },
});
