import { test, expect, type Page } from "@playwright/test";
import { doLogin, selectStore } from "./_helpers";

// REGRESSÃO do banner falso "Alguém salvou agora" na OC de Tecido (modo OC).
// Causa: corrida remonta+refetch (staleTime:0) — o efeito de merge re-disparava com o rascunho STALE (vazio) e a base já cheia, e o
// mergeLinhas contava cada linha do servidor como "nova". Guard: `ehCorridaRemontaSemTocar` (tests/unit/oc-tecido-corrida-remonta.test.ts).
// Sem o guard os cenários 2 e 3 acusam "Alguém salvou agora — 4 campo(s) atualizado(s)"; com ele, nenhum.
// Alvo: localhost:5190 (cópia local). NÃO roda contra produção.

const OC_NUMERO = "20260615_0001"; // received, non-rolo, 4 variant items (Loja Teste, cópia)
const BANNER_RE = /Alguém salvou agora/i;

function wireConsole(page: Page, sink: string[]) {
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("[OCTEC-MERGE"))  {
      sink.push(t);
      // eslint-disable-next-line no-console
      console.log("CONSOLE>", t);
    }
  });
}

async function openOcTecido(page: Page) {
  await page.goto("/entrada-saida/oc-tecido", { waitUntil: "networkidle" });
  // Recebidas é a 1ª aba (default). Garante.
  const recebidas = page.getByRole("tab", { name: /Recebidas/i });
  if (await recebidas.count()) await recebidas.first().click();
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function abrirOc(page: Page) {
  // Há duas variantes de lista (tabela desktop + cards mobile); uma fica hidden.
  // Pega a ocorrência VISÍVEL do número da OC e clica.
  const todas = page.getByText(OC_NUMERO, { exact: false });
  const n = await todas.count();
  let clicado = false;
  for (let i = 0; i < n; i++) {
    const el = todas.nth(i);
    if (await el.isVisible()) {
      await el.scrollIntoViewIfNeeded();
      await el.click();
      clicado = true;
      break;
    }
  }
  if (!clicado) throw new Error(`Nenhuma ocorrência visível de ${OC_NUMERO}`);
  // Sheet aberto: breadcrumb/título "OC 20260615_0001"
  await expect(page.getByText(new RegExp(`OC ${OC_NUMERO}`, "i")).first()).toBeVisible({ timeout: 10000 });
}

test.describe("banner falso CQ OC Tecido", () => {
  test.setTimeout(120000);

  test("Hipótese D: refetch SEM edição acende o banner?", async ({ page }) => {
    const logs: string[] = [];
    wireConsole(page, logs);
    await doLogin(page);
    await selectStore(page);
    await openOcTecido(page);
    await abrirOc(page);

    // Nenhuma edição. Forçar refetch por invalidação da query (equivale ao refetchOnWindowFocus / Realtime).
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      // dispara visibilitychange + focus (refetchOnWindowFocus)
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForTimeout(1500);

    const banner = page.getByText(BANNER_RE);
    const visivel = await banner.count().then((c) => (c ? banner.first().isVisible() : false));
    // eslint-disable-next-line no-console
    console.log("HIP-D banner visível (sem edição)?", visivel);
    expect(visivel, "refetch sem edição não pode acender o banner").toBe(false);
  });

  test("Controle: abrir, fechar SEM editar, reabrir (sem CQ, sem discard)", async ({ page }) => {
    const logs: string[] = [];
    wireConsole(page, logs);
    await doLogin(page);
    await selectStore(page);
    await openOcTecido(page);
    await abrirOc(page);
    await page.waitForTimeout(600);
    // Fecha sem editar (ESC; sem dirty => fecha direto, sem guard)
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    // Reabre
    await abrirOc(page);
    await page.waitForTimeout(1500);
    const banner = page.getByText(BANNER_RE);
    const cnt = await banner.count();
    const visivel = cnt ? await banner.first().isVisible() : false;
    const texto = visivel ? ((await banner.first().textContent()) ?? "") : "";
    // eslint-disable-next-line no-console
    console.log("CONTROLE (sem edição) banner visível?", visivel, "texto:", texto);
    expect(visivel, `abrir/fechar/reabrir sem editar não pode acender o banner (${texto})`).toBe(false);
  });

  test("Fluxo do dono: editar CQ, fechar, Descartar, reabrir", async ({ page }) => {
    const logs: string[] = [];
    wireConsole(page, logs);
    await doLogin(page);
    await selectStore(page);
    await openOcTecido(page);
    await abrirOc(page);

    // Rolar até a seção de CQ e expandir o 1º item.
    // Expande o primeiro CqItemCard (CollapsibleTrigger) que contém "Pendente"/badge.
    const triggers = page.locator('button:has(svg.lucide-chevron-right)');
    // Procura um item de CQ: expande todos os triggers visíveis na seção CQ.
    // Mais robusto: clicar nos labels "Alertar estilo" exige expandir antes.
    // Expande o primeiro trigger cujo texto tem " · " (artigo · variante).
    const n = await triggers.count();
    // eslint-disable-next-line no-console
    console.log("triggers chevron-right:", n);
    let expanded = false;
    for (let i = 0; i < n; i++) {
      const tr = triggers.nth(i);
      const txt = (await tr.textContent()) ?? "";
      if (txt.includes("·")) {
        await tr.scrollIntoViewIfNeeded();
        await tr.click();
        // depois de expandir aparece "Alertar estilo"
        const alertar = page.getByText("Alertar estilo", { exact: false });
        if (await alertar.count()) { expanded = true; break; }
      }
    }
    // eslint-disable-next-line no-console
    console.log("expandiu item CQ?", expanded);

    // Liga "Alertar estilo" (o Switch ao lado do label).
    const alertarLabel = page.getByText("Alertar estilo", { exact: false }).first();
    await alertarLabel.scrollIntoViewIfNeeded();
    const alertarSwitch = alertarLabel.locator("xpath=preceding-sibling::button[1]");
    if (await alertarSwitch.count()) {
      await alertarSwitch.first().click();
    } else {
      // fallback: switch dentro do mesmo label
      await alertarLabel.locator("button[role='switch']").first().click().catch(() => {});
    }
    // Liga "CQ ok" também
    const cqOk = page.getByText("CQ ok", { exact: false }).first();
    const cqOkSwitch = cqOk.locator("xpath=preceding-sibling::button[1]");
    if (await cqOkSwitch.count()) await cqOkSwitch.first().click().catch(() => {});

    await page.waitForTimeout(500);

    // Fecha o Sheet (ESC) -> abre o guard "Descartar?"
    await page.keyboard.press("Escape");
    // AlertDialog "Descartar alterações?" — clica em Descartar
    const descartar = page.getByRole("button", { name: /Descartar/i });
    await descartar.waitFor({ state: "visible", timeout: 5000 });
    await descartar.click();
    await page.waitForTimeout(800);

    // Reabre a OC
    await abrirOc(page);
    await page.waitForTimeout(1500);

    const banner = page.getByText(BANNER_RE);
    const cnt = await banner.count();
    const visivel = cnt ? await banner.first().isVisible() : false;
    let texto = "";
    if (visivel) texto = (await banner.first().textContent()) ?? "";
    // eslint-disable-next-line no-console
    console.log("REOPEN banner visível?", visivel, "texto:", texto);

    expect(visivel, `editar CQ, descartar e reabrir não pode acender o banner (${texto})`).toBe(false);
  });
});
