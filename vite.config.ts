import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Config padrão do TanStack Start (substitui o wrapper @lovable.dev/vite-tanstack-config).
// - src/server.ts é auto-detectado como server entry (nosso wrapper de erro SSR).
// - Alvo Cloudflare Workers via @cloudflare/vite-plugin + wrangler.jsonc.
// - tsConfigPaths resolve o alias @/* (de tsconfig.json).
export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
    tsConfigPaths(),
  ],
});
