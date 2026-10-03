import { test, expect, type Browser, type Page } from "@playwright/test";
import { doLogin } from "./_helpers";

// Kanban automático — F2 (telas). SÓ LEITURA: nenhum teste salva, liga/desliga a chave, solta card ou escolhe
// uma opção do "Mover para…" — o vite local fala com o Supabase de PRODUÇÃO.
// TRAVADO NA LOJA TESTE (dono, 23/set — R2 do G-plano): NÃO troca de loja (nada de `selectStore`/`setActiveTenant`,
// que grava `users.tenant_id` e, sem a Loja Teste, cairia na 1ª loja da lista). Se o usuário de teste não estiver
// na Loja Teste, o teste FALHA. Escrita aceita pelo dono: as preferências de filtro/agrupamento do PRÓPRIO usuário
// de teste (`user_ui_prefs`, seed idempotente no load). Nenhuma outra escrita antes da G-chave.
// Roda contra o app LOCAL: é o padrão do playwright.config.ts (P-238 A — sem E2E_BASE_URL = http://localhost:5173; use
// E2E_BASE_URL=http://localhost:5199 se o QA subiu o próprio vite). PRODUÇÃO só com E2E_PRODUCAO=sim no shell — e mesmo
// assim esta spec é pulada (só roda com endereço local).
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
// Mesmo endereço efetivo do playwright.config.ts (sem E2E_BASE_URL = local).
const BASE_EFETIVA = process.env.E2E_BASE_URL || "http://localhost:5173";
const BASE_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(BASE_EFETIVA);
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
//
// Achado extra (Task 8, corrida de login/tenant-switcher, registrado no controlador 23/set): investigado
// com trace de rede (6+ rodadas, sempre o mesmo teste) — a query `tenants` responde 200 com as 6 lojas
// (Loja Teste incluída) e o `TenantSwitcher` AINDA ASSIM pinta o ramo vazio ("Nenhuma loja ainda…",
// `src/components/admin/TenantSwitcher.tsx:80-88`, quando `tenants.length===0` no momento do render) —
// não é ausência de dado, é o React ainda não ter commitado a lista quando `networkidle` já tinha virado
// (a rede fica ociosa no MESMO instante em que a resposta chega, um tick antes do repaint). Isso fazia
// `switcher` (que só existe no ramo NÃO-vazio, com `combobox`) nunca aparecer — `rotulo` ficava `null` e
// a checagem caía no outro braço (`tenant_config` também não tinha sido pedido ainda). Não é troca de
// loja, não é achado de dado/produto: é só o INSTANTE da leitura. Endurecido esperando o PRÓPRIO
// `combobox` aparecer (só leitura, sem clicar) antes de ler o texto — a lógica de decisão (precisa
// conter "Loja Teste", tenant_config bateu, nenhum outro tenant visto) não mudou.
async function exigirLojaTeste(page: Page, vistos: Set<string>): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {}); // a sidebar (com o seletor) assenta depois do login
  const switcher = page.locator('div:has(> div:has-text("Loja em visualização"))').getByRole("combobox").first();
  await switcher.waitFor({ state: "attached", timeout: 8_000 }).catch(() => {}); // pode nunca aparecer p/ um usuário não-super_admin; segue com count()=0 nesse caso
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

// Achado (Task 8, registrado no controlador 23/set): /criacao/planejamento abre por padrão AGRUPADO
// por Tecido (`useAgrupamentoState("criacao-planejamento", ["tecido"])` — default de fábrica da tela,
// não é dado faltando na Loja Teste). Sem expandir os grupos nenhum card individual (logo nenhum
// `etapa-kanban-selo`) fica visível. Decisão do controlador: expandir pela UI ANTES de procurar o selo —
// só leitura, sem gravar nada. Clica em cada cabeçalho de grupo AINDA recolhido (`role=button` com
// `aria-expanded="false"`, o mesmo elemento de `renderGroup`/`toggleGroup` em criacao.planejamento.tsx —
// não tem classe `md:` nenhuma, funciona em qualquer viewport, inclusive 360/390 px onde o botão
// "Expandir todos os grupos" fica escondido por ser `hidden md:inline-flex`). `expandedGroups` é
// `useState` local (não é `user_ui_prefs`) — nada persiste, não precisa de `finally`/restaurar.
async function expandirGruposPlanejamento(page: Page): Promise<void> {
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const recolhidos = page.getByRole("button", { expanded: false }).filter({ has: page.locator("h2") });
    const n = await recolhidos.count();
    if (n === 0) return;
    await recolhidos.first().click();
    await page.waitForTimeout(50); // deixa o React re-renderizar antes de reconsultar
  }
}

// Achado (Task 8/finalização F2, registrado no controlador 24/set): o board Mobile do Desenvolvimento
// (`div.md:hidden`, criacao.desenvolvimento.tsx) é um Accordion — 1 `AccordionItem` por COLUNA de status;
// só a PRIMEIRA (`firstStatusKey`) nasce expandida (`defaultValue`). Se essa 1ª coluna estiver vazia
// ("Sem cards"), nenhum card mobile — logo nenhum "Mover para…" (`combobox`) — fica no DOM, mesmo que
// outras colunas tenham cards. `kanban-grupo-toggle` é um elemento DIFERENTE: agrupamento (splitter, ex.
// por tecido) DENTRO de uma coluna já expandida — clicar nele sem antes garantir que a COLUNA em si tem
// cards não resolve nada quando a coluna escolhida está vazia. Corrige o spec (não o produto): acha a
// AccordionTrigger de uma coluna com contagem > 0, expande-a se ainda fechada, e só então expande um
// eventual `kanban-grupo-toggle` dentro dela.
async function expandirColunaMobileComCard(page: Page): Promise<void> {
  // AccordionTrigger de coluna termina no <span> de contagem — filtra por trigger cujo texto termina num número > 0.
  const triggers = page.getByRole("button", { expanded: false });
  const n = await triggers.count();
  for (let i = 0; i < n; i++) {
    const trig = triggers.nth(i);
    const texto = ((await trig.textContent()) ?? "").trim();
    const m = /(\d+)\s*$/.exec(texto);
    if (m && Number(m[1]) > 0) {
      await trig.click();
      await page.waitForTimeout(50); // Radix anima a expansão antes de montar o conteúdo por completo
      break;
    }
  }
  const grupo = page.getByTestId("kanban-grupo-toggle").filter({ visible: true }).first();
  if (await grupo.count()) await grupo.click();
}

// Selo no card COMPACTO do Planejamento (B1, dono 23/set): cada selo dentro da linha e do corpo do card; o
// compacto nunca mostra o texto "automática"/"fixado" (no máximo o ícone). Devolve quantos selos compactos viu.
//
// Achado extra (Task 8, registrado no controlador 23/set, investigado com uma sonda descartável — nunca
// commitada): o Planejamento no mobile NÃO é um grid que quebra linha — é um CARROSSEL por linha/grupo
// (`GRID_COLS_CARROSSEL_CLASS`/`GRID_CARROSSEL_ITEM_CLASS`, src/hooks/useGridCols.ts, comentário do
// próprio código: "mostra 1 card + dica do próximo"). Cada card mede `basis-[78vw]` e fica num `flex
// overflow-x-auto snap-x`; por DESIGN só o 1º card de cada linha cabe inteiro na tela — os seguintes
// espiam parcialmente fora da viewport até o usuário arrastar o carrossel (comprovado: selo do 1º card
// de cada linha tem `right < innerWidth`; os seguintes crescem ~78vw a cada item, saindo da tela de
// propósito). TODOS os selos já vinham com `compacto:true`, corpo com `p-2 space-y-1` (sem overflow
// PRÓPRIO — `linhaSemEstouro`/`corpoSemEstouro` sempre batiam) — o único falso-positivo era medir
// `dentroDaTela` (viewport inteira) em vez de "cabe no card compacto que já é para estar visível". Não
// mudei o que "sem estourar" significa (segue: selo não estoura a LINHA nem o CORPO do card, nem o
// texto completo aparece no compacto) — só passei a pular os selos de cards que o PRÓPRIO carrossel
// posiciona fora da tela de propósito (identificados pelo wrapper `.snap-start`: `left` bem além de 0
// dentro do pai rolável = card ainda não "snapado" para a tela).
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
      // Sobe até achar o item do carrossel (`.snap-start`, GRID_CARROSSEL_ITEM_CLASS) — se não achar
      // (telas sem carrossel), considera "na tela" só pelo viewport, como antes.
      let carrosselItem: HTMLElement | null = corpo;
      while (carrosselItem && !carrosselItem.classList.contains("snap-start")) carrosselItem = carrosselItem.parentElement;
      const carrosselPai = carrosselItem?.parentElement ?? null;
      const dentroDoCarrossel = !carrosselItem || !carrosselPai
        ? true
        : carrosselItem.getBoundingClientRect().left <= carrosselPai.getBoundingClientRect().left + 1;
      return {
        compacto: el.getAttribute("data-compacto") === "true",
        dentroDaLinha: r.right <= linha.getBoundingClientRect().right + 1 && r.left >= linha.getBoundingClientRect().left - 1,
        dentroDaTela: r.right <= window.innerWidth + 1,
        linhaSemEstouro: linha.scrollWidth <= linha.clientWidth + 1,
        corpoSemEstouro: corpo.scrollWidth <= corpo.clientWidth + 1,
        dentroDoCarrossel, // true = é o card "snapado"/visível da linha; false = espiando fora, por design
      };
    });
    if (!medida.dentroDoCarrossel) continue; // achado: carrossel — só o 1º card de cada linha precisa caber
    expect(medida, `selo #${i}`).toMatchObject({ dentroDaLinha: true, dentroDaTela: true, linhaSemEstouro: true, corpoSemEstouro: true });
    if (medida.compacto) {
      compactos++;
      await expect(selo).not.toContainText("automática");
      await expect(selo).not.toContainText("fixado");
    }
  }
  return compactos;
}

test.skip(!BASE_LOCAL, "só roda contra o app local (padrão http://localhost:5173 ou E2E_BASE_URL=http://localhost:5199)");

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
    // A legenda em si NÃO depende de card (testid próprio `etapa-kanban-selo-exemplo`, sempre presente);
    // o loop abaixo é que só acha `etapa-kanban-selo` (por card) com os grupos expandidos — mesmo achado
    // do teste de celular. Expandir aqui só torna a anotação abaixo fiel ao que a Loja Teste tem; a
    // asserção do teste (não conter "automática"/"fixado") não muda.
    await expandirGruposPlanejamento(page);
    const selos = page.getByTestId("etapa-kanban-selo");
    const n = await selos.count();
    test.info().annotations.push({ type: "selos no Planejamento", description: String(n) });
    for (let i = 0; i < Math.min(n, 10); i++) {
      await expect(selos.nth(i)).not.toContainText("automática");
      await expect(selos.nth(i)).not.toContainText("fixado");
    }
  });

  test("Config da Loja: chave desligada — SEM etiquetas por coluna nem Reprovado travado (Baixo 3, fix final)", async () => {
    // Fix final F2 (revisão final Opus, Baixo 3): com a chave DESLIGADA as etiquetas Entrada/
    // Automática/Manual e o Reprovado travado mentiam ("entra sozinho" sem nenhuma coluna andando
    // sozinha de verdade) — ambos ficam ESCONDIDOS enquanto a chave está desligada.
    await page.goto("/admin/configuracoes", { waitUntil: "networkidle" });
    const sw = page.getByTestId("kanban-auto-switch");
    await expect(sw).toBeVisible();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("modo-coluna-entrada")).toHaveCount(0);
    await expect(page.getByTestId("requisitos-bloqueado")).toHaveCount(0);
  });

  for (const largura of [360, 390]) {
    test(`Planejamento no celular (${largura} px): selo no card compacto sem estourar a largura`, async ({ browser }) => {
      const m = await abrir(browser, { width: largura, height: 800 });
      await m.goto("/criacao/planejamento", { waitUntil: "networkidle" });
      await expandirGruposPlanejamento(m); // achado: a tela abre agrupada por Tecido por padrão
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
    await expandirColunaMobileComCard(m);
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
    await expandirGruposPlanejamento(m); // achado: a tela abre agrupada por Tecido por padrão
    await expect(m.getByTestId("etapa-kanban-selo").first()).toBeVisible();
    expect(await conferirSelosSemEstouro(m)).toBeGreaterThan(0);
    await m.context().close();
  });
});
