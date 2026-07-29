import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    assetsDir: "assets",
    target: "es2023",
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/wildplay.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
