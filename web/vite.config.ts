import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const calendarProxy = {
    "/api": {
      target: env.CALENDAR_PROXY_TARGET || "http://127.0.0.1:8787",
      changeOrigin: true
    }
  };

  return {
    plugins: [
      preact(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["fonts/*.ttf", "icons/*"],
        manifest: {
          name: "shared-page",
          short_name: "shared-page",
          description: "A shared hand-drawn calendar for two people and their AI.",
          theme_color: "#ffffff",
          background_color: "#ffffff",
          display: "standalone",
          orientation: "portrait-primary",
          start_url: "/",
          scope: "/",
          icons: [
            {
              src: "/icons/app-icon.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any"
            },
            {
              src: "/icons/icon-1024.png",
              sizes: "1024x1024",
              type: "image/png",
              purpose: "any"
            }
          ]
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          navigateFallback: "/index.html",
          globPatterns: ["**/*.{js,css,html,svg,png,ttf}"],
          globIgnores: ["runtime-config.js"],
          runtimeCaching: []
        }
      })
    ],
    server: {
      host: true,
      proxy: calendarProxy
    },
    preview: {
      host: true,
      proxy: calendarProxy
    },
    test: {
      environment: "node"
    }
  };
});
