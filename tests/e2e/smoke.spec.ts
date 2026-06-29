import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// Smoke test E2E ("o robô que confere as telas"):
// loga com o usuário de teste e visita as telas pesadas, conferindo que cada uma
// ABRE SEM QUEBRAR (não testa regra de negócio — isso é o (b) de fluxos completos).
//
// Roda contra E2E_BASE_URL (ver playwright.config.ts). Precisa de E2E_EMAIL/E2E_PASSWORD
// no .env — de preferência um usuário DEDICADO na Loja Teste, com acesso às telas
// (tenant_admin), senão as telas redirecionam por falta de permissão (vira "aviso", não falha).

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

// h1 da página de erro do SSR (src/lib/error-page.ts) — sinal de "quebrou de verdade".
const ERROR_PAGE_MARK = "This page didn't load";

const SCREENS: { path: string; name: string }[] = [
  { path: "/dashboard", name: "dashboard" },
  { path: "/criacao/planejamento", name: "criacao-planejamento" },
  { path: "/criacao/desenvolvimento", name: "criacao-desenvolvimento" },
  { path: "/producao/cad", name: "producao-cad" },
  { path: "/producao/cq", name: "producao-cq" },
  { path: "/producao/oficina", name: "producao-oficina" },
  { path: "/producao/acabamento", name: "producao-acabamento" },
  { path: "/producao/lancamentos", name: "producao-lancamentos" },
  { path: "/producao/consumo-oc", name: "producao-consumo-oc" },
  { path: "/entrada-saida/oc-tecido", name: "oc-tecido" },
  { path: "/entrada-saida/oc-aviamento", name: "oc-aviamento" },
  { path: "/entrada-saida/estoque", name: "estoque" },
  { path: "/financeiro", name: "financeiro" },
  { path: "/cadastro/tecidos", name: "cadastro-tecidos" },
  { path: "/cadastro/aviamentos", name: "cadastro-aviamentos" },
  { path: "/cadastro/servico", name: "cadastro-servico" },
  { path: "/cadastro/colaboradores", name: "cadastro-colaboradores" },
];

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      "Defina E2E_EMAIL e E2E_PASSWORD no .env (usuário de teste dedicado).",
    );
  }
  context = await browser.newContext();
  page = await context.newPage();
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  // login OK -> redireciona p/ /home (src/routes/auth.tsx). Se falhar, isto estoura.
  await page.waitForURL("**/home", { timeout: 30_000 });
});

test.afterAll(async () => {
  await context?.close();
});

test("login entra e chega na home", async () => {
  await expect(page).toHaveURL(/\/home/);
  await page.screenshot({ path: "test-results/screens/00-home.png", fullPage: true });
});

for (const screen of SCREENS) {
  test(`tela abre sem quebrar: ${screen.name}`, async () => {
    const resp = await page.goto(screen.path, { waitUntil: "domcontentloaded" });

    // 1) o worker NÃO devolveu 500 (SSR não quebrou)
    expect(resp?.status() ?? 0, `HTTP de ${screen.path}`).toBeLessThan(500);

    // 2) não é a página de erro do SSR
    await expect(page.locator("body")).not.toContainText(ERROR_PAGE_MARK);

    // deixa o app hidratar/rotear (redirect de permissão acontece no cliente)
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

    // 3) informativo: se saiu da rota pedida, provável falta de permissão (NÃO falha o teste)
    const finalPath = new URL(page.url()).pathname;
    if (!finalPath.startsWith(screen.path)) {
      test
        .info()
        .annotations.push({
          type: "aviso",
          description: `${screen.path} redirecionou p/ ${finalPath} — provável falta de permissão do usuário de teste (tela não exercitada a fundo).`,
        });
    }

    await page.screenshot({
      path: `test-results/screens/${screen.name}.png`,
      fullPage: true,
    });
  });
}
