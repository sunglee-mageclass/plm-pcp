import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Carrega o .env (gitignored) sem dependência extra: só preenche o que ainda
// não estiver no ambiente do shell. Precisamos de E2E_BASE_URL / E2E_EMAIL / E2E_PASSWORD.
try {
  const envFile = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
} catch {
  // sem .env: usa o que vier do shell (ex.: CI)
}

// Onde o robô testa. Padrão: produção atual. Aponte p/ o staging quando existir
// (E2E_BASE_URL=https://sistrama-staging.sung-lee.workers.dev).
const BASE_URL = process.env.E2E_BASE_URL || "https://sistrama.sung-lee.workers.dev";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1, // login único compartilhado; rodar em série
  retries: 1, // tolera soluço de rede
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    viewport: { width: 1366, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
