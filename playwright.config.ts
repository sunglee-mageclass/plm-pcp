import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// P-238 A (03/out): rodar contra PRODUÇÃO só com opt-in explícito NO SHELL (lido ANTES do .env —
// um .env não consegue liberar sozinho): `E2E_PRODUCAO=sim npm run test:e2e`.
const optInProducao = process.env.E2E_PRODUCAO === "sim";

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

// Onde o robô testa. Padrão: o app LOCAL (localhost:5173, que aponta para a cópia do banco quando
// servido pelo banco-local). Endereço que não é local só com E2E_PRODUCAO=sim no shell.
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:5173";
const hostE2E = new URL(BASE_URL).hostname;
if (!["localhost", "127.0.0.1"].includes(hostE2E) && !optInProducao) {
  throw new Error(
    `E2E apontando para ${hostE2E} (fora do computador). Para rodar contra PRODUÇÃO de propósito: E2E_PRODUCAO=sim npm run test:e2e`,
  );
}

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
