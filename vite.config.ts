import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

const apiPort = process.env.PB_PORT ?? "7433";

export default defineConfig({
  root: "web",
  plugins: [preact()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
});
