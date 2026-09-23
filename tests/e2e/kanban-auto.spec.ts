import { test, expect, type Browser, type Page } from "@playwright/test";
import { doLogin } from "./_helpers";

// Kanban automático — F2 (telas). SÓ LEITURA: nenhum teste salva, liga/desliga a chave, solta card ou escolhe
// uma opção do "Mover para…" — o vite local fala com o Supabase de PRODUÇÃO.
// TRAVADO NA LOJA TESTE (dono, 23/set — R2 do G-plano): NÃO troca de loja (nada de `selectStore`/`setActiveTenant`,
// que grava `users.tenant_id` e, sem a Loja Teste, cairia na 1ª loja da lista). Se o usuário de teste não estiver
// na Loja Teste, o teste FALHA. Escrita aceita pelo dono: as preferências de filtro/agrupamento do PRÓPRIO usuário
// de teste (`user_ui_prefs`, seed idempotente no load). Nenhuma outra escrita antes da G-chave.
// Rodar SEMPRE com E2E_BASE_URL=http://localhost:5173 (ou :5199 se o QA subiu o próprio vite) — o default do
// Playwright é PRODUÇÃO; sem E2E_BASE_URL local a spec nem começa.
// Bloco "chave LIGADA" só com E2E_KANBAN_LIGADO=1, DEPOIS que o dono ligar a chave na Loja Teste (G-chave).
//
// Nota de revisão M5 (Task 5, aplicada aqui na Task 8): o board Desktop (`div.hidden.md:flex`) e o board
// Mobile (`div.md:hidden`) do Desenvolvimento MONTAM OS DOIS ao mesmo tempo (só CSS esconde um lado) — por
// isso `kanban-card-fixado` e `kanban-grupo-toggle` aparecem em dobro no DOM, e `kanban-card` também conta os
// cards da coluna terminal "Lançado" (que usa o mesmo `KanbanCard`/testid, fora de `[data-testid^="kanban-coluna-"]`).
// Os locators abaixo que dependem de contagem/visibilidade únicas escopam ao container desktop visível
// (`.hidden.md\\:flex`) e, quando é só coluna de fluxo (exclui "Lançado"), a `[data-testid^="kanban-coluna-"]`.
// O que a spec VERIFICA não mudou — só o ESCOPO do seletor.
const LIGADO = process.env.E2E_KANBAN_LIGADO === "1";
const BASE_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(process.env.E2E_BASE_URL ?? "");
const LOJA_TESTE = "Loja Teste";
const TENANT_LOJA_TESTE = "37889b78-fffb-404b-8c75-18b7e50a1d9b";

// Só OBSERVA a rede: guarda o tenant_id que as telas pedem em `tenant_config` (nada é gravado).
function vigiarTenant(page: Page): Set<string> {
  const vistos = new Set<string>();
  page.on("request", (req) => {
    const url = req.url();
    if (!url.includes("/rest/v1/tenant_config")) return;
    const m = /[?&]tenant_id=eq\.([0-9a-f-]{36})/.exec(url);
    if (m) vistos.add(m[1]);
  });
  return vistos;
}

// Trava da Loja Teste: lê (sem clicar) o seletor "Loja em visualização" e confere o tenant que a Config pede.
// Qualquer divergência = FALHA com instrução; nunca troca de loja.
async function exigirLojaTeste(page: Page, vistos: Set<string>): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {}); // a sidebar (com o seletor) assenta depois do login
  const switcher = page.locator('div:has(> div:has-text("Loja em visualização"))').getByRole("combobox").first();
  const rotulo = (await switcher.count()) ? ((await switcher.textContent()) ?? "").trim() : null;
  await page.goto("/admin/configuracoes", { waitUntil: "networkidle" });
  const outros = [...vistos].filter((t) => t !== TENANT_LOJA_TESTE);
  if ((rotulo !== null && !rotulo.includes(LOJA_TESTE)) || !vistos.has(TENANT_LOJA_TESTE) || outros.length > 0) {
    throw new Error(
      `E2E do kanban travado na "${LOJA_TESTE}" (${TENANT_LOJA_TESTE}), mas o usuário de teste está em ` +
      `"${rotulo ?? "?"}" (tenant pedido: ${[...vistos].join(", ") || "nenhum"}). Este teste NÃO troca de loja ` +
      `(decisão do dono, 23/set): coloque o usuário de teste na Loja Teste à mão e rode de novo.`,
    );
  }
}

async function abrir(browser: Browser, viewport: { width: number; height: number }): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const vistos = vigiarTenant(page);
  await doLogin(page);
  await exigirLojaTeste(page, vistos);
  return page;
}

// Selo no card COMPACTO do Planejamento (B1, dono 23/set): cada selo dentro da linha e do corpo do card; o
// compacto nunca mostra o texto "automática"/"fixado" (no máximo o ícone). Devolve quantos selos compactos viu.
async function conferirSelosSemEstouro(page: Page): Promise<number> {
  const selos = page.getByTestId("etapa-kanban-selo");
  const n = Math.min(await selos.count(), 12);
  let compactos = 0;
  for (let i = 0; i < n; i++) {
    const selo = selos.nth(i);
    const medida = await selo.evaluate((el) => {
      const linha = el.parentElement as HTMLElement;
      const corpo = linha.parentElement as HTMLElement;
      const r = el.getBoundingClientRect();
      return {
        compacto: el.getAttribute("data-compacto") === "true",
        dentroDaLinha: r.right <= linha.getBoundingClientRect().right + 1 && r.left >= linha.getBoundingClientRect().left - 1,
        dentroDaTela: r.right <= window.innerWidth + 1,
        linhaSemEstouro: linha.scrollWidth <= linha.clientWidth + 1,
        corpoSemEstouro: corpo.scrollWidth <= corpo.clientWidth + 1,
      };
    });
    expect(medida, `selo #${i}`).toMatchObject({ dentroDaLinha: true, dentroDaTela: true, linhaSemEstouro: true, corpoSemEstouro: true });
    if (medida.compacto) {
      compactos++;
      await expect(selo).not.toContainText("automática");
      await expect(selo).not.toContainText("fixado");
    }
  }
  return compactos;
}

test.skip(!BASE_LOCAL, "defina E2E_BASE_URL=http://localhost:5173 (ou :5199) — o default do Playwright é PRODUÇÃO");

test.describe.configure({ mode: "serial" });

test.describe("Kanban automático — chave DESLIGADA (padrão): telas como hoje + selo/etiquetas", () => {
  test.skip(LIGADO, "a Loja Teste está com a chave LIGADA — rode o outro bloco");
  let page: Page;
  test.beforeAll(async ({ browser }) => { page = await abrir(browser, { width: 1600, height: 900 }); });
  test.afterAll(async () => { await page.context().close(); });

  test("Desenvolvimento: sem faixa e sem ícone de modo nas colunas", async () => {
    await page.goto("/criacao/desenvolvimento", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Desenvolvimento" })).toBeVisible();
    await expect(page.locator('[data-testid^="kanban-coluna-"]').first()).toBeVisible();
    await expect(page.getByTestId("kanban-auto-faixa")).toHaveCount(0);
    await expect(page.getByTestId("kanban-col-modo")).toHaveCount(0);
    // Escopo M5: board desktop visível (.hidden.md:flex) — o mobile (.md:hidden) monta em paralelo (só CSS
    // esconde) e duplicaria a contagem de `kanban-card-fixado` (CardAutoInfo é usado por KanbanCard E MobileCard).
    await expect(page.locator(".hidden.md\\:flex").getByTestId("kanban-card-fixado")).toHaveCount(0);
  });

  test("Planejamento: legenda do selo e selos sem 'automática'/'fixado'", async () => {
    await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
    const legenda = page.getByTestId("etapa-kanban-legenda");
    await expect(legenda).toBeVisible();
    await expect(legenda).not.toContainText("fixado");
    const selos = page.getByTestId("etapa-kanban-selo");
    const n = await selos.count();
    test.info().annotations.push({ type: "selos no Planejamento", description: String(n) });
    for (let i = 0; i < Math.min(n, 10); i++) {
      await expect(selos.nth(i)).not.toContainText("automática");
      await expect(selos.nth(i)).not.toContainText("fixado");
    }
  });

  test("Config da Loja: chave desligada, etiquetas por coluna, Requisitos de Reprovado travado", async () => {
    await page.goto("/admin/configuracoes", { waitUntil: "networkidle" });
    const sw = page.getByTestId("kanban-auto-switch");
    await expect(sw).toBeVisible();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("modo-coluna-entrada").first()).toBeVisible();
    await expect(page.getByTestId("requisitos-bloqueado").first()).toBeVisible();
  });

  for (const largura of [360, 390]) {
    test(`Planejamento no celular (${largura} px): selo no card compacto sem estourar a largura`, async ({ browser }) => {
      const m = await abrir(browser, { width: largura, height: 800 });
      await m.goto("/criacao/planejamento", { waitUntil: "networkidle" });
      await expect(m.getByTestId("etapa-kanban-selo").first()).toBeVisible();
      const compactos = await conferirSelosSemEstouro(m);
      test.info().annotations.push({ type: `selos compactos a ${largura} px`, description: String(compactos) });
      // A 360 px o card é compacto (main p-4 ⇒ card de ~156 px < 170); a 390 px fica no limite e pode sair cheio.
      if (largura === 360) expect(compactos).toBeGreaterThan(0);
      await m.context().close();
    });
  }
});

test.describe("Kanban automático — chave LIGADA na Loja Teste (G-chave) — SÓ LEITURA", () => {
  test.skip(!LIGADO, "rode com E2E_KANBAN_LIGADO=1 depois que o dono ligar a chave na Loja Teste");
  let page: Page;
  test.beforeAll(async ({ browser }) => { page = await abrir(browser, { width: 1600, height: 900 }); });
  test.afterAll(async () => { await page.context().close(); });

  test("Desenvolvimento: faixa + ícone de modo em TODA coluna + subtítulo", async () => {
    await page.goto("/criacao/desenvolvimento", { waitUntil: "networkidle" });
    await expect(page.getByTestId("kanban-auto-faixa")).toContainText("Kanban automático ligado.");
    const nCols = await page.locator('[data-testid^="kanban-coluna-"]').count();
    expect(nCols).toBeGreaterThan(0);
    await expect(page.getByTestId("kanban-col-modo")).toHaveCount(nCols);
  });

  test("arraste simulado (sem soltar) acende os destinos com a dica e apaga no fim", async () => {
    await page.goto("/criacao/desenvolvimento", { waitUntil: "networkidle" });
    await page.getByTitle("Recolher / Expandir").click();
    const expandir = page.getByRole("button", { name: "Expandir tecidos" });
    if (await expandir.count()) await expandir.click();
    else await page.keyboard.press("Escape");
    const card = page.getByTestId("kanban-card").filter({ visible: true }).first();
    await expect(card).toBeVisible();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await card.dispatchEvent("dragstart", { dataTransfer: dt });
    await expect(page.locator('[data-testid^="kanban-coluna-"].border-dashed').first()).toBeVisible();
    await card.dispatchEvent("dragend", { dataTransfer: dt });
    await expect(page.locator('[data-testid^="kanban-coluna-"].border-dashed')).toHaveCount(0);
  });

  test("mobile: “Mover para…” anota cada destino (sem escolher)", async ({ browser }) => {
    const m = await abrir(browser, { width: 390, height: 844 });
    await m.goto("/criacao/desenvolvimento", { waitUntil: "networkidle" });
    const grupo = m.getByTestId("kanban-grupo-toggle").filter({ visible: true }).first();
    if (await grupo.count()) await grupo.click();
    const mover = m.getByRole("combobox").filter({ hasText: "Mover para…" }).first();
    await expect(mover).toBeVisible();
    await mover.click();
    await expect(m.getByRole("option").first()).toBeVisible();
    const textos = await m.getByRole("option").allTextContents();
    expect(textos.some((t) => /fixa aqui|solta o card|já cumpre|falta 1 dado|faltam \d+ dados|fora do fluxo/.test(t))).toBe(true);
    await m.keyboard.press("Escape");
    await m.context().close();
  });

  test("Config e Planejamento refletem a chave ligada", async () => {
    await page.goto("/admin/configuracoes", { waitUntil: "networkidle" });
    await expect(page.getByTestId("kanban-auto-switch")).toHaveAttribute("aria-checked", "true");
    await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
    await expect(page.getByTestId("etapa-kanban-legenda")).toContainText("fixado");
  });

  test("Planejamento no celular (360 px) com a chave ligada: compacto só com o ícone, sem estourar", async ({ browser }) => {
    const m = await abrir(browser, { width: 360, height: 800 });
    await m.goto("/criacao/planejamento", { waitUntil: "networkidle" });
    await expect(m.getByTestId("etapa-kanban-selo").first()).toBeVisible();
    expect(await conferirSelosSemEstouro(m)).toBeGreaterThan(0);
    await m.context().close();
  });
});
