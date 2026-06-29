import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { doLogin, selectStore, STORE } from "./_helpers";

// Testes de formulários + condicionais + fluxos, NA Loja Teste (com dados).
// Diferente do smoke (só "abre sem quebrar"), aqui abrimos forms e conferimos regras.

test.describe.configure({ mode: "serial" });
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await doLogin(page);
  await selectStore(page);
});

test.afterAll(async () => {
  await context?.close();
});

// Fundação: confirmar que a loja foi de fato selecionada (senão o resto não vale).
test("loja selecionada (TenantSwitcher não está mais vazio)", async () => {
  const switcher = page
    .locator('div:has(> div:has-text("Loja em visualização"))')
    .getByRole("combobox")
    .first();
  await expect(switcher).not.toContainText("Selecione a loja");
  await page.screenshot({ path: "test-results/forms/00-loja-selecionada.png", fullPage: true });
});

/* ===== Condicionais das OCs: recebimento/Cancelar só existem em OC já criada ===== */

test("OC Aviamento — Nova OC: SEM recebimento e SEM 'Cancelar' item (isEdit=false)", async () => {
  await page.goto("/entrada-saida/oc-aviamento", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Nova OC/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Nova OC de Aviamento")).toBeVisible();
  // Condicional 1: coluna/campo de recebimento ("Qtd Recebida") só aparece no edit.
  await expect(dialog.getByText("Qtd Recebida")).toHaveCount(0);
  // Condicional 2: o checkbox "Cancelar" item (um <label>, não o botão do rodapé) só no edit.
  await expect(dialog.locator('label:has-text("Cancelar")')).toHaveCount(0);
  await page.screenshot({ path: "test-results/forms/oc-aviamento-nova.png", fullPage: true });
  await page.keyboard.press("Escape");
});

test("OC Tecido — Nova OC: SEM seção de recebimento (isEdit=false)", async () => {
  await page.goto("/entrada-saida/oc-tecido", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Nova OC/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Nova OC de Tecido")).toBeVisible();
  // Recebimento (OcTecidoRecebimento) só no edit → não há "Qtd Recebida" na Nova OC.
  await expect(dialog.getByText("Qtd Recebida")).toHaveCount(0);
  await page.screenshot({ path: "test-results/forms/oc-tecido-nova.png", fullPage: true });
  await page.keyboard.press("Escape");
});

// Lado POSITIVO da condicional: abrir uma OC existente (clique na linha) → edit → o
// checkbox "Cancelar" item DEVE aparecer (isEdit=true). Read-only: não salva nada.
test("OC Aviamento — abrir OC existente: 'Cancelar' item APARECE (isEdit=true)", async () => {
  await page.goto("/entrada-saida/oc-aviamento", { waitUntil: "networkidle" });
  const row = page.locator("tr.cursor-pointer").first();
  if ((await row.count()) === 0) {
    test.skip(true, "Loja sem OC de aviamento p/ abrir em edição.");
    return;
  }
  await row.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('label:has-text("Cancelar")').first()).toBeVisible();
  await page.screenshot({ path: "test-results/forms/oc-aviamento-edit.png", fullPage: true });
  await page.keyboard.press("Escape");
});

/* ===== Formulários abrem (dialog aparece com o título certo) ===== */

test("Criação — 'Novo Modelo' abre o formulário", async () => {
  await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Novo Modelo" }).first().click();
  await expect(page.getByRole("dialog").getByText("Novo Modelo")).toBeVisible();
  await page.screenshot({ path: "test-results/forms/novo-modelo.png", fullPage: true });
  await page.keyboard.press("Escape");
});

test("Cadastro — 'Novo Tecido' abre o formulário", async () => {
  await page.goto("/cadastro/tecidos", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Novo", exact: true }).first().click();
  await expect(page.getByRole("dialog").getByText("Novo Tecido")).toBeVisible();
  await page.screenshot({ path: "test-results/forms/novo-tecido.png", fullPage: true });
  await page.keyboard.press("Escape");
});

/* ===== Fluxo real (escreve na Loja Teste e LIMPA): criar e excluir um tecido ===== */

test("FLUXO — criar e excluir um tecido (create → detalhe → excluir)", async () => {
  const nome = `__ROBO_TESTE__ ${Date.now()}`;
  await page.goto("/cadastro/tecidos", { waitUntil: "networkidle" });

  // Criar
  await page.getByRole("button", { name: "Novo", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Novo Tecido")).toBeVisible();
  await dialog.getByPlaceholder("Ex: Linho 100% premium").fill(nome);
  await dialog.getByRole("button", { name: /Criar e abrir/ }).click();

  // "Criar e abrir" navega (full reload) p/ o detalhe → espera a URL + o nome render.
  await page.waitForURL(/\/cadastro\/tecidos\/[0-9a-f-]+/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByText(nome).first()).toBeVisible();
  await page.screenshot({ path: "test-results/forms/fluxo-tecido-criado.png", fullPage: true });

  // Excluir (clica até o AlertDialog abrir — robusto contra hidratação pós-reload).
  const alert = page.getByRole("alertdialog");
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Excluir", exact: true }).first().click();
    try {
      await alert.getByText("Excluir tecido?").waitFor({ state: "visible", timeout: 4000 });
      break;
    } catch {
      if (i === 2) throw new Error("AlertDialog de exclusão não abriu.");
    }
  }
  await alert.getByRole("button", { name: "Excluir", exact: true }).click();

  // Volta p/ a lista e o tecido criado NÃO existe mais (limpeza confirmada).
  await page.waitForURL(/\/cadastro\/tecidos$/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByText(nome)).toHaveCount(0);
});
