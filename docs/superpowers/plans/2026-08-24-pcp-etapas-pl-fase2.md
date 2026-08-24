# Etapas PL — Fase 2 (tela nova do kanban /pcp/etapas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela nova `/pcp/etapas` — um kanban PL que posiciona cada bloco de serviço PL na sua etapa (derivada do preenchimento), com edição rápida no card em sync com o sheet do PCP, colapso lateral, fotos com zoom, e overlay do sheet do PCP ao clicar num card.

**Architecture:** Uma rota nova sob o hub PCP (gated pelo módulo opt-in `etapas_pl`, já criado na Fase 1). A página carrega TODOS os blocos de serviço PL (1 card = 1 bloco `producao_terceirizados` PL) espelhando a query da lista do PCP, deriva a etapa via `etapaDoBloco` (Fase 1, `src/lib/pcp-etapas.ts`), e distribui os cards em colunas = etapas ativas de `tenant_config.pcp_etapas`. Reprovadas NÃO aparecem. A edição rápida grava via `salvar_terceirizados` (mesma RPC do sheet → sync). O `↗` reusa o componente do sheet (`TerceirizadosDetail`, prop `onClose`) como Sheet overlay.

**Tech Stack:** Vite + React + TS, TanStack Router/Query, Supabase, Tailwind + shadcn, Vitest. Design Navy Trust v3 (`docs/design/ui-padroes.md`).

## Global Constraints

- Módulo `etapas_pl` (Fase 1): opt-in, default OFF. A rota E o card no hub/sidebar só aparecem com o módulo ligado.
- PL = categoria "PL" (`isServicoPL`, `@/lib/servico-confeccao`) **E** `producao_terceirizados.interno = false` **E** `ativo`. Card só para modelos com `cad.enviado_corte = true`.
- Etapa DERIVADA por `etapaDoBloco(bloco, etapasCfg)` (`@/lib/pcp-etapas`, Fase 1). `etapasCfg` = `tenant_config.pcp_etapas` (ou `ETAPAS_DEFAULT` se vazio); só as etapas `ativa` viram colunas. **Reprovada** (`etapaDoBloco(...).reprovada === true`) NÃO entra no quadro.
- Edição rápida grava via RPC `salvar_terceirizados` (estado COMPLETO do bloco, respeitando `rev`/colab) — NÃO inventar writer novo. Kanban ↔ sheet sempre em sync.
- Sheet overlay = reusar `TerceirizadosDetail` (`pcp.servicos.$modeloId.tsx`, exportado, prop `onClose`) — é como a lista do PCP já abre o detalhe.
- Padrões de UI (reusar, não reinventar): header/resumo = `criacao.planejamento.tsx` (header com busca+FilterButton à direita, linha de resumo abaixo com stats à esq. / ordenar à dir.); colapso lateral de coluna = `criacao.desenvolvimento.tsx` (`w-80`↔`w-9` rail com `[writing-mode:vertical-rl] rotate-180`, "Recolher colunas"); colapsável = `EstoqueTecidosTab.tsx`; foto = `ModeloResumoFoto` + zoom `ImagePreview`; DateField p/ datas; sem px/hex fora da escala (anti-drift).
- Front usa `as any` p/ colunas novas (types.ts não regenerado — débito conhecido).
- Antes de cada commit: `npx tsc --noEmit 2>&1 | grep TS2304`, `npm run build`, `npx vitest run tests/unit/ui-padroes-antidrift.test.ts`. Reusar o vite da :5173 p/ QA (nunca reiniciar).

---

### Task 1: Rota `/pcp/etapas` + registro no hub/sidebar + doc

**Files:**
- Create: `src/routes/_authenticated/pcp.etapas.tsx`
- Modify: `src/lib/permissions-catalog.ts` (bloco `module: "pcp"`)
- Modify: `src/lib/nav.ts` (PAGE_URLS + PAGE_ICONS)
- Modify: `CLAUDE.md` (Mapa de rotas — PCP virou hub)

**Interfaces:**
- Produces: rota `/pcp/etapas` (componente placeholder por ora — só o shell da página, título "Etapas — Produção PL", gated); page key `producao_etapas` no catálogo; `PAGE_URLS.producao_etapas = "/pcp/etapas"`.

- [ ] **Step 1:** `pcp.etapas.tsx` — mirror `pcp.servicos.tsx` (`createFileRoute("/_authenticated/pcp/etapas")` que envolve `<Outlet/>` em `<RequirePermission page="producao_etapas">`) OU, como é página única, um componente direto. Estude `pcp.servicos.tsx` e `expedicao.direcionamento.tsx`. Renderize por ora só um shell: breadcrumb "PCP › Etapas" + `<h1>Etapas — Produção PL</h1>` + um placeholder "quadro em construção". Gate: `useTenantModules().isModuleEnabled('etapas_pl')` — se off, empty-state (mesmo precedente de produto_acabado, sem `ModuleGuard` por causa da corrida de render).
- [ ] **Step 2:** `permissions-catalog.ts` — no bloco `module: "pcp"` add `PageDef { key: "producao_etapas", label: "Etapas", gate: "etapas_pl" }`. A key entra em `ALL_PAGE_KEYS` automaticamente.
- [ ] **Step 3:** `nav.ts` — `PAGE_URLS.producao_etapas = "/pcp/etapas"` + `PAGE_ICONS.producao_etapas` (ex.: `ListChecks` do lucide). O sidebar/hub passam a mostrar "Etapas" ao lado de "Serviços" só p/ loja com `etapas_pl` on (o `SectionHub`/sidebar já filtram por `p.gate`).
- [ ] **Step 4:** `CLAUDE.md` — atualizar a linha do "Mapa de rotas" que diz "PCP é o próprio Serviços (nível de página única)" → "PCP é HUB (Serviços + Etapas [gate `etapas_pl`]); `/pcp` renderiza SectionHub". Resolve o follow-up deferido #4.
- [ ] **Step 5:** `npx tsc --noEmit | grep -E 'TS2304|etapas|nav'`; `npm run build`; QA (:5173): com `etapas_pl` ON, o hub PCP e o sidebar mostram "Etapas" e `/pcp/etapas` abre o shell; com OFF, some.
- [ ] **Step 6: Commit** `git add ...; git commit -m "feat(pcp-etapas): rota /pcp/etapas + card no hub/sidebar (gated) + doc"`

---

### Task 2: Hook de dados do kanban (cards = blocos PL) — parte pura testada

**Files:**
- Create: `src/lib/pcp-etapas-kanban.ts` (mapeamento puro: linhas do banco → cards)
- Test: `tests/unit/pcp-etapas-kanban.test.ts`
- Create: `src/components/producao/etapas/useEtapasCards.ts` (o hook TanStack Query que roda a query + chama o mapeamento)

**Interfaces:**
- Consumes: `etapaDoBloco`, `ETAPAS_DEFAULT`, `EtapaCfg` (Fase 1); `isServicoPL` (`@/lib/servico-confeccao`).
- Produces:
  - `type EtapaCard = { blocoId: string; cadId: string; modeloId: string; ref: string|null; nome: string|null; fotoFontes: (string|null)[]; empresa: string|null; etapa: EtapaKey|null; bloco: BlocoEtapa & { categoria_terceirizado_id: string } }`
  - `function montarCards(rows: ModeloRow[], etapas: EtapaCfg[]): EtapaCard[]` — achata modelos→blocos PL (categoria PL + `interno=false` + `ativo`), calcula a etapa, EXCLUI reprovadas, retorna 1 card por bloco PL.
  - `function useEtapasCards(filtros): { cards, etapas, isLoading }` — query + `montarCards`.

- [ ] **Step 1: Testes de `montarCards`**

```ts
// tests/unit/pcp-etapas-kanban.test.ts
import { describe, it, expect } from "vitest";
import { montarCards } from "@/lib/pcp-etapas-kanban";
import { ETAPAS_DEFAULT } from "@/lib/pcp-etapas";

const modelo = (over = {}) => ({
  id:"m1", ref:"FEVLO-1", nome:"Vestido", fotos_modelo:["f.jpg"], desenho_tecnico_url:null, croqui_url:null,
  cad:[{ id:"c1", enviado_corte:true, producao_terceirizados:[
    { id:"b1", ativo:true, interno:false, categoria_terceirizado_id:"cat_pl", categorias_terceirizado:{ nome:"PL" },
      empresa:{ nome_fantasia:"Bela Vista" }, pt_data_saida:null, pt_data_entrada:null, pt_aprovacao:null,
      data_enviado:null, data_entregue:null, quantidade_recebida:null, grade_detalhe:null },
  ]}], ...over,
});

describe("montarCards", () => {
  it("bloco PL vira 1 card na etapa peca_teste", () => {
    const cards = montarCards([modelo() as any], ETAPAS_DEFAULT);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ blocoId:"b1", modeloId:"m1", empresa:"Bela Vista", etapa:"peca_teste" });
  });
  it("bloco interno (não-PL) é ignorado", () => {
    const m = modelo(); (m as any).cad[0].producao_terceirizados[0].interno = true;
    expect(montarCards([m as any], ETAPAS_DEFAULT)).toHaveLength(0);
  });
  it("categoria não-PL é ignorada", () => {
    const m = modelo(); (m as any).cad[0].producao_terceirizados[0].categorias_terceirizado.nome = "Oficina";
    expect(montarCards([m as any], ETAPAS_DEFAULT)).toHaveLength(0);
  });
  it("reprovada é EXCLUÍDA do kanban", () => {
    const m = modelo(); const b = (m as any).cad[0].producao_terceirizados[0];
    b.pt_data_saida="a"; b.pt_data_entrada="b"; b.pt_aprovacao="reprovado";
    expect(montarCards([m as any], ETAPAS_DEFAULT)).toHaveLength(0);
  });
  it("cad não enviado ao corte é ignorado", () => {
    const m = modelo(); (m as any).cad[0].enviado_corte = false;
    expect(montarCards([m as any], ETAPAS_DEFAULT)).toHaveLength(0);
  });
});
```

- [ ] **Step 2:** Rodar → falha (módulo ausente). `npx vitest run tests/unit/pcp-etapas-kanban.test.ts`
- [ ] **Step 3:** Implementar `montarCards` em `src/lib/pcp-etapas-kanban.ts` — para cada modelo com `cad[0].enviado_corte`, para cada bloco `ativo && !interno && isServicoPL(categorias_terceirizado.nome)`: monta `BlocoEtapa` (mapeando `quantidade_recebida`→`qtd_recebida`), chama `etapaDoBloco`; se `.reprovada` pula; senão emite o card. `fotoFontes` = `[fotos_modelo?.[0], desenho_tecnico_url, croqui_url]`.
- [ ] **Step 4:** Rodar → passa (5 testes).
- [ ] **Step 5:** `useEtapasCards.ts` — `useQuery` espelhando a query de `pcp.servicos.index.tsx:54-61` (from `modelos`, `.eq("enviado_cad",true)`, embed `cad(id, enviado_corte, producao_terceirizados(...))`) ESTENDIDA: no embed de `producao_terceirizados` inclua `id, ativo, interno, categoria_terceirizado_id, categorias_terceirizado(nome), empresa:empresa_id(nome_fantasia), pt_data_saida, pt_data_entrada, pt_aprovacao, data_enviado, data_entregue, quantidade_recebida, grade_detalhe` e no `modelos` inclua `fotos_modelo, desenho_tecnico_url, croqui_url`. Aplica filtros (coleção/busca). Carrega `pcp_etapas` de `tenant_config` (fallback `ETAPAS_DEFAULT`). Retorna `montarCards(rows, etapas)`. queryKey PRÓPRIA `["etapas-cards", filtros]` (não compartilhar).
- [ ] **Step 6: Commit** `git add src/lib/pcp-etapas-kanban.ts tests/unit/pcp-etapas-kanban.test.ts src/components/producao/etapas/useEtapasCards.ts; git commit -m "feat(pcp-etapas): dados do kanban (montarCards testado + useEtapasCards)"`

---

### Task 3: Layout da página — header (resumo/filtros) + quadro com colunas colapsáveis

**Files:**
- Modify: `src/routes/_authenticated/pcp.etapas.tsx`
- Create: `src/components/producao/etapas/EtapasBoard.tsx`

**Interfaces:**
- Consumes: `useEtapasCards` (T2), `EtapaCard`, as etapas ativas.
- Produces: `<EtapasBoard cards etapas onAbrir(modeloId) />` — o quadro; e o header/resumo na página.

- [ ] **Step 1:** Header na página espelhando `criacao.planejamento.tsx:837-926`: linha 1 = ícone + "Etapas — Produção PL" à esq., à dir. busca (lupa, `<Input>` ou `SearchToggle`) + `FilterButton` (coleção/mês/fornecedor) + botões "Recolher colunas"/"Recolher cards"; linha 2 (resumo) = `flex ... gap-2` com stats "·"-separadas (X PLs ativas · por etapa) à esq. e "Ordenar por" à dir. (`ml-auto`).
- [ ] **Step 2:** `EtapasBoard.tsx` — colunas = etapas ATIVAS (`etapas.filter(e=>e.ativa)`). Colapso lateral por coluna espelhando `criacao.desenvolvimento.tsx:586-623` (expandida `w-80`; recolhida rail `w-9` com título vertical `[writing-mode:vertical-rl] rotate-180` + dot + contador; header-bar e rail são toggles; estado num `Set<EtapaKey>`). "Recolher/Expandir colunas" global (`ChevronsDownUp`/`ChevronsUpDown`). Distribui os cards por `card.etapa === coluna.key`.
- [ ] **Step 3:** `tsc`/`build`/anti-drift. QA (:5173, `etapas_pl` on): `/pcp/etapas` mostra o quadro com 5 colunas (ou menos se alguma desativada), cards nas colunas certas, colapso lateral funcionando.
- [ ] **Step 4: Commit** `git commit -m "feat(pcp-etapas): página do kanban — header/resumo + colunas com colapso lateral"`

---

### Task 4: Card — foto+zoom, colapsável, edição rápida em sync

**Files:**
- Create: `src/components/producao/etapas/EtapaCardView.tsx`
- Modify: `src/components/producao/etapas/EtapasBoard.tsx`
- Create: `src/components/producao/etapas/useSalvarEtapaRapida.ts`

**Interfaces:**
- Consumes: `EtapaCard`; `salvar_terceirizados` (RPC).
- Produces: `<EtapaCardView card onAbrir minimized onToggleMin quickSave />` — o card; `useSalvarEtapaRapida()` → `salvarCampo(card, campo, valor)` que grava SÓ aquele bloco via `salvar_terceirizados` e invalida `["etapas-cards"]` + `["pcp-servicos"]` (sync com o sheet).
- [ ] **Step 1:** `EtapaCardView.tsx` — foto (`ModeloResumoFoto` fontes = `card.fotoFontes`; clique = zoom `ImagePreview`), REF + nome, fornecedor. Por etapa, o campo que faz avançar como edição rápida: Peça Teste = `<DateField>` Saída/Entrada + Aprovar/Reprovar; Separação = `<DateField>` Data Enviado; Retorno/Oficina = read-only (vem da grade/recebimento — mostrar progresso, editar no sheet). Botão `↗` (abre overlay) + botão minimizar (colapsa o corpo do card). `minimized` esconde o corpo.
- [ ] **Step 2:** `useSalvarEtapaRapida.ts` — `useMutation` que monta o payload de UM bloco (estado completo do bloco a partir do `card.bloco` + o campo alterado) e chama `salvar_terceirizados(_cad_id, [bloco], _obs?)`. ⚠️ montar o bloco COMPLETO (todos os campos que a RPC espera) p/ não zerar dados — reusar o shape que `pcp.servicos.$modeloId.tsx` usa no payload. Invalidar `["etapas-cards"]` E `["pcp-servicos"]` no onSuccess. Aprovar/Reprovar grava `pt_aprovacao`; reprovar faz o card sumir do quadro (montarCards exclui) no próximo fetch.
- [ ] **Step 3:** Wire `EtapaCardView` no `EtapasBoard`; "Recolher cards" global alterna `minimized` de todos.
- [ ] **Step 4:** `tsc`/`build`/anti-drift. QA (:5173): editar uma data no card → salva → card pula de coluna; abrir o mesmo modelo no sheet do PCP mostra o valor (sync); Reprovar → card some do quadro.
- [ ] **Step 5: Commit** `git commit -m "feat(pcp-etapas): card com foto/zoom, edição rápida em sync e minimizar"`

---

### Task 5: `↗` abre o sheet do PCP como overlay (sem sair da tela)

**Files:**
- Modify: `src/routes/_authenticated/pcp.etapas.tsx`

**Interfaces:**
- Consumes: `TerceirizadosDetail` (export de `pcp.servicos.$modeloId.tsx`, prop `onClose`), `Sheet` (`@/components/ui/sheet`).
- Produces: estado `overlayModeloId`; ao clicar `↗` num card, abre `<Sheet><SheetContent size="editor"><TerceirizadosDetail modeloId={overlayModeloId} onClose={()=>setOverlayModeloId(null)} /></SheetContent></Sheet>`.

- [ ] **Step 1:** Estudar como `pcp.servicos.index.tsx` abre o `TerceirizadosDetail` embutido (Sheet mode via `onClose`) — replicar EXATAMENTE (mesmas props, guarda de dirty no pai se aplicável). Montar `{overlayModeloId && <Sheet open>...<TerceirizadosDetail modeloId={overlayModeloId} onClose=.../></Sheet>}`.
- [ ] **Step 2:** `onAbrir(modeloId)` do card seta `overlayModeloId`. Ao fechar/salvar no overlay, invalidar `["etapas-cards"]` (o sheet grava via a mesma RPC → o quadro reflete).
- [ ] **Step 3:** `tsc`/`build`. QA (:5173): clicar `↗` num card abre o sheet do PCP como overlay (Sheet 70vw) sem navegar; editar+salvar lá → fechar → o card no quadro reflete.
- [ ] **Step 4: Commit** `git commit -m "feat(pcp-etapas): ↗ abre o sheet do PCP como overlay no kanban"`

---

### Task 6: Polish dos minors deferidos da Fase 1

**Files:**
- Modify: `src/routes/_authenticated/pcp.servicos.$modeloId.tsx` (ROTULO_CONFLITO)
- Modify: `src/components/producao/ReprovadasPl.tsx` (copy do hint)

**Interfaces:** —

- [ ] **Step 1:** Adicionar 3 entradas em `ROTULO_CONFLITO` p/ `pt_data_saida`/`pt_data_entrada`/`pt_aprovacao` (labels PT: "Peça Teste — Saída/Entrada/Aprovação") — resolve o banner de conflito colab mostrar a key crua (minor Fase 1 #2).
- [ ] **Step 2:** Trocar o texto "nova saída reabre o fluxo" por algo alinhado ao comportamento real (reabrir = mudar a Aprovação de 'reprovado'): ex. "trocar a Aprovação reabre o fluxo" (minor Fase 1 #3).
- [ ] **Step 3:** `tsc`/`build`/anti-drift. Commit `git commit -m "polish(pcp-etapas): rótulos de conflito colab + copy do reabrir"`

---

## Self-Review

**Spec coverage (§7 do spec → task):** rota/sidebar → T1; dados/card=bloco PL/reprovadas fora → T2; layout resumo/filtros + colapso lateral → T3; foto/zoom + edição rápida em sync + colapsar card → T4; overlay do sheet → T5. Minors deferidos → T6. Fora da Fase 2 (fases seguintes): S2 prazo, S3 parcelas, S4 NF, S5 peça-foto/câmera.

**Placeholder scan:** T2 traz código real (mapeamento puro + testes); T1/T3/T4/T5 são tasks de UI/integração com interface, arquivos:linha e PADRÕES concretos a espelhar (index query, TerceirizadosDetail overlay, Desenvolvimento collapse, Planejamento header) — não JSX linha-a-linha, pois a integração depende do estado real dos arquivos no momento (mesmo critério da Fase 1 T5–T7).

**Type consistency:** `EtapaCard`/`montarCards`/`useEtapasCards` usados igual em T2→T3→T4→T5. `etapaDoBloco`/`ETAPAS_DEFAULT`/`isServicoPL` reusados da Fase 1 (não redefinir). `TerceirizadosDetail` (prop `onClose`) reusado, não recriado.

**Riscos:** (a) a query do kanban carrega muitos modelos — paginar/filtrar por coleção como a lista do PCP faz; (b) o payload da edição rápida DEVE ser o bloco COMPLETO (senão zera campos) — T4 Step 2 destaca isso; (c) sync depende de invalidar as duas queryKeys (`etapas-cards` + `pcp-servicos`).
