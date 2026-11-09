# F4a — Status do kanban unificado em PA/PI/PT + filtro de reprovados

> Plano de implementação. Spec: `docs/superpowers/specs/2026-11-09-f4a-status-kanban-unificado-design.md`.
> SÓ FRONT: reusa `etapaDoModelo`/`EtapaKanbanBadge` (leitor), o fio `EtapaHeader`/`useMoverEtapa`/`opcoesMover*`
> (mover) e as RPCs existentes `kanban_mover`/`avaliar_condicoes_kanban`. Zero migration.

## Goal

PA (`ProdutoAcabadoSheet`), PI (`ProdutoImportadoSheet`) e PT (card do `PlanTecidoSheet`) passam a mostrar o
**mesmo status do kanban do card espelho** — o selo `EtapaKanbanBadge` derivado por `etapaDoModelo`, igual ao
Planejamento/Desenvolvimento. O selo vira **seletor** ("Mover para…") que move o card pelo fio existente do
kanban, respeitando os requisitos (comprado vs interno via `ehOrigemComprada`). PA/PI ganham um **filtro
"Status"** single (default oculta reprovados) que o PT já tem. As 3 telas juntas.

## Architecture

- **Leitor único (sem banco novo):** `etapaDoModelo(m: ModeloKanban, cfg: KanbanAutoConfig): EtapaSelo`
  (`src/lib/kanban-auto-ui.ts:209`) + `EtapaKanbanBadge` (`src/components/shared/EtapaKanbanBadge.tsx:11`).
  `ModeloKanban = { origem, status_desenvolvimento, ordem_criacao_enviada, lancado }` (`src/lib/kanban-auto.ts:50`).
  Config via `lerKanbanAutoConfig(tenant_config_row)` (`src/lib/kanban-auto.ts:73`).
- **Seletor (mover, com requisitos):** hoje o fio vive ACOPLADO ao Sheet do Planejamento em
  `planejamento-detail/ficha/` — `EtapaHeader` (componente), `useFichaKanban` (config+condições+derivação),
  `opcoesMoverHoje`/`opcoesMoverAuto` (opções) e `useMoverEtapa` (mutação). As partes PURAS
  (`etapa-kanban.ts`, `etapa-mover.ts`, `kanban-auto.ts`, `kanban-auto-ui.ts`) não têm React — reaproveitáveis.
  O plano **extrai um componente shared `MoverEtapaMenu`** (o popover de `EtapaHeader`, sem a linha "Próxima:…"
  que é específica do Sheet) e um hook shared `useSeloMover` (envolve `useFichaKanban` + `useMoverEtapa`) para
  PA/PI/PT usarem o MESMO fio — nenhuma lógica de requisito é reimplementada. A mutação continua sendo
  `useMoverEtapa` (RPC `kanban_mover` com a chave ligada; `UPDATE status_desenvolvimento` +
  `marcar_etapa_verificada('kanban')` com a chave desligada), respeitando as travas de permissão do servidor.
- **Condições em LOTE:** PA/PI carregam `avaliar_condicoes_kanban(_ids)` UMA vez pelos `modelo_id` da coleção
  (não N chamadas); o resultado é um mapa `modelo_id -> Record<string,boolean>` consumido por card. PT já tem o
  fluxo próprio (hoje via `plan_tecido_fases`, que SAI — ver T6).
- **Filtro de reprovados:** `FilterButton` single (`src/components/shared/filters.tsx:129`,
  `FilterConfigSingle` com `emptyValue`), descritor `{ label:"Status", single:true, options:[sem_reprovado,todos] }`,
  poda ANTES do map dos cards com `ehReprovadoStatus` (`src/lib/reprovado.ts:15`) sobre o status do embed. PT já
  tem (`filtro-painel.ts` + `slotPassaFiltroStatus`) — fica.

## Tech Stack

Vite + React + TypeScript, TanStack Query, Supabase (RLS). Testes: Vitest unit (funções puras). `vite build`
NÃO roda tsc → rodar `npx tsc --noEmit` depois de mexer em imports. Sem banco → sem teste de integração.

## Global Constraints

- **queryKey única por tela** (regra do projeto; key compartilhada já deu bug). PA usa
  `["pa-kanban-config", tenantId]` / `["pa-kanban-cond", colecaoId]`; PI usa `["pi-kanban-config", tenantId]` /
  `["pi-kanban-cond", colecaoId]` — NÃO reusar as keys do `useFichaKanban` (`tenant-plan-ficha-config`,
  `plan-kanban-cond`), que são por-modelo e por-tela-Planejamento.
- **Reusar, não reimplementar:** PA/PI/PT passam a usar o MESMO `MoverEtapaMenu`. A lógica de requisitos
  (`podeEntrarHoje`/`opcoesMoverHoje`/`opcoesMoverAuto`/`planoMoverEtapa`) NÃO é duplicada.
- **Permissão:** mover passa pela RPC/caminho existente (`useMoverEtapa`). As travas do servidor (S3d: `modelos`
  UPDATE gated por página; `kanban_mover` DEFINER) já existem e são respeitadas — o front não contorna.
- **Performance:** condições em LOTE por coleção (1 chamada).
- **NÃO tocar** `src/components/ui/` (shadcn). **NÃO mexer** no Sheet do Dev (`ModeloDetailPanel`) — decisão 8.
- Reprovado = `ehReprovadoStatus` (fonte única, `src/lib/reprovado.ts`) — nunca reimplementar o predicado.

## Review Focus

1. **Vaga SEM card no PT** (T6): continua com o pendente/reprovado PRÓPRIO da F2 (`statusEfetivoDaVaga` com
   `slot.modelo_id` null usa `slot.status`). Só a vaga COM card troca o badge de fase pelo status COMPLETO do
   kanban. Prova de que o filtro de reprovados do PT segue funcionando (T7).
2. **Mover respeitando requisitos:** destino sem requisito fica esmaecido/bloqueado com "falta X"; não pula
   etapa. Comprado (PA/PI, origem revenda/importado) usa o fluxo PRÓPRIO de comprado (`revenda_kanban_*`);
   interno (PT) usa o board/requisitos internos. É o switch `ehOrigemComprada` já existente.
3. **Condições em lote** (PA/PI): 1 chamada `avaliar_condicoes_kanban` por coleção, não N.
4. **queryKey única por tela** (sem colisão com o Planejamento).
5. **Tipos:** o embed de PA/PI é montado em `ModeloKanban` por função pura testada (T1); anti-drift vs
   `etapaDoModelo`.

## File Structure

**Criados:**
- `src/components/shared/MoverEtapaMenu.tsx` — popover "Mover para…" reusável (extraído do corpo de `EtapaHeader`).
- `src/hooks/useSeloMover.ts` — hook shared: monta `EtapaSelo` + opções + `onMover` para um card (envolve
  `useFichaKanban`/`useMoverEtapa` por modelo, OU recebe cfg/cond já carregados em lote). (Ver T1 para a decisão
  de assinatura.)
- `src/lib/kanban-card-selo.ts` — puras: `modeloKanbanDoEmbed(embedModelo)` (monta `ModeloKanban` do embed
  PA/PI) + `podaReprovados(items, lerStatus, modo)` (poda do filtro). + testes.
- `tests/unit/kanban-card-selo.test.ts`

**Modificados:**
- `src/components/produto-acabado/ProdutoAcabadoSheet.tsx` — amplia `SELECT_PRODUTO`, carrega config+condições em
  lote, estado `filtroStatus`, poda, passa props ao card.
- `src/components/produto-acabado/ProdutoCard.tsx` — selo+seletor no cabeçalho (ao lado do `SeloIntegracao`).
- `src/components/produto-importado/ProdutoImportadoSheet.tsx` — espelha PA.
- `src/components/produto-importado/ProdutoImportadoCard.tsx` — espelha ProdutoCard.
- `src/components/planejamento/planejamento-detail/ficha/EtapaHeader.tsx` — passa a consumir o novo
  `MoverEtapaMenu` (sem mudar o comportamento no Sheet do Planejamento).
- `src/components/plan-tecido/PlanTecidoSheet.tsx` — troca `faseInfo`/`statusEfetivoDaVaga` binário por
  `etapaDoModelo` nas vagas COM card; confirma filtro (T7).
- `src/components/plan-tecido/ModelCard.tsx` — card renderiza o selo do kanban (vaga com card) e o seletor.

---

## T1 — Componente/hook reusável de selo+mover para card

**Objetivo:** extrair o fio do `EtapaHeader` para um `MoverEtapaMenu` shared e padronizar como PA/PI/PT montam o
selo e movem o card, SEM duplicar a lógica de requisitos.

**Files:**
- Criar `src/components/shared/MoverEtapaMenu.tsx`.
- Criar `src/hooks/useSeloMover.ts`.
- Criar `src/lib/kanban-card-selo.ts` + `tests/unit/kanban-card-selo.test.ts`.
- Modificar `src/components/planejamento/planejamento-detail/ficha/EtapaHeader.tsx` (passa a usar `MoverEtapaMenu`).

**Interfaces:**

`src/lib/kanban-card-selo.ts` (puro, TDD):
```ts
import type { ModeloKanban } from "@/lib/kanban-auto";
import { ehReprovadoStatus } from "@/lib/reprovado";

/** Monta o ModeloKanban do embed `modelo:modelo_id(...)` de PA/PI. Campos ausentes = null/false
 *  (nunca "assume enviado"): ordem/lancado só true quando o embed diz true. */
export function modeloKanbanDoEmbed(m: {
  origem?: string | null;
  status_desenvolvimento?: string | null;
  ordem_criacao_enviada?: boolean | null;
  lancado?: boolean | null;
} | null | undefined): ModeloKanban {
  return {
    origem: m?.origem ?? null,
    status_desenvolvimento: m?.status_desenvolvimento ?? null,
    ordem_criacao_enviada: m?.ordem_criacao_enviada === true,
    lancado: m?.lancado === true,
  };
}

/** Poda de exibição do filtro "Status" (default sem_reprovado). Nunca apaga — quem chama só decide o que
 *  renderiza. `lerStatus` devolve {dev, plan} do card (embed do modelo), ou null para card sem modelo. */
export function cardReprovado(
  s: { status_desenvolvimento?: string | null; status_planejamento?: string | null } | null | undefined,
): boolean {
  return ehReprovadoStatus(s?.status_desenvolvimento, s?.status_planejamento);
}
export function passaFiltroStatusCard(
  s: { status_desenvolvimento?: string | null; status_planejamento?: string | null } | null | undefined,
  modo: "todos" | "sem_reprovado",
): boolean {
  return modo === "todos" ? true : !cardReprovado(s);
}
```

`src/components/shared/MoverEtapaMenu.tsx` — é o `Popover` + lista de `opcoes` do `EtapaHeader` (linhas 32-79),
extraído verbatim, SEM a linha "Próxima:…" (específica do Sheet):
```ts
import type { EtapaSelo } from "@/lib/kanban-auto-ui";
import type { OpcaoMover } from "@/components/planejamento/planejamento-detail/ficha/etapa-kanban";

export function MoverEtapaMenu({ selo, podeMover, opcoes, onMover, movendo, sujo, carregando, compacto, testIdPrefix }: {
  selo: EtapaSelo;
  podeMover: boolean;
  opcoes: OpcaoMover[];
  onMover: (para: string) => void;
  movendo: boolean;
  sujo?: boolean;
  carregando?: "carregando" | "erro" | false;
  compacto?: boolean;          // card estreito do canvas
  testIdPrefix?: string;       // "pa" | "pi" | "pt" — data-testid por tela
}) { /* gatilho EtapaKanbanBadge(onClick) + PopoverContent com as opcoes, idêntico ao EtapaHeader */ }
```
- `EtapaHeader.tsx` passa a renderizar `<MoverEtapaMenu ...>` no lugar do bloco inline e mantém a linha
  `proxima` própria. **Comportamento no Sheet do Planejamento não muda** (anti-regressão: testes do
  `EtapaHeader` existentes devem passar — ajustar `data-testid` se o teste busca `etapa-mover-gatilho`;
  manter os MESMOS testIds por default).

`src/hooks/useSeloMover.ts` — fonte única do selo+opções+mover por card, para PA/PI (modo "lote"):
```ts
import { useMemo } from "react";
import { etapaDoModelo, type EtapaSelo } from "@/lib/kanban-auto-ui";
import { opcoesMoverHoje } from "@/components/planejamento/planejamento-detail/ficha/etapa-kanban";
import { opcoesMoverAuto } from "@/components/planejamento/planejamento-detail/ficha/etapa-mover";
import { statusEfetivoFicha } from "@/components/planejamento/planejamento-detail/ficha/etapa-kanban";
import { useMoverEtapa } from "@/components/planejamento/planejamento-detail/ficha/useMoverEtapa";
import { boardDaLoja, type KanbanAutoConfig, type ModeloKanban } from "@/lib/kanban-auto";

/** Modo LOTE (PA/PI): cfg e cond já carregados pela tela (1 chamada/coleção). Retorna o que o
 *  MoverEtapaMenu precisa. */
export function useSeloMoverLote(o: {
  modeloId: string | null;
  modelo: ModeloKanban;          // modeloKanbanDoEmbed(...)
  cfg: KanbanAutoConfig;
  cond: Record<string, boolean>; // mapaCond[modeloId] ?? {}
  prontas: boolean;              // cfg carregada E cond em lote carregada
  tenantId?: string | null;
}) {
  const selo: EtapaSelo = useMemo(() => etapaDoModelo(o.modelo, o.cfg), [o.modelo, o.cfg]);
  const statusEfetivo = useMemo(
    () => statusEfetivoFicha(o.modelo.status_desenvolvimento, o.modelo.ordem_criacao_enviada === true, o.cfg),
    [o.modelo, o.cfg]);
  const opcoes = useMemo(() => {
    if (!o.prontas || selo.fase !== "kanban") return [];
    return o.cfg.kanban_automatico
      ? opcoesMoverAuto({ modelo: o.modelo, statusEfetivo, cfg: o.cfg, cond: o.cond })
      : opcoesMoverHoje({ origem: o.modelo.origem ?? null, statusEfetivo, cfg: o.cfg, cond: o.cond });
  }, [o.prontas, selo.fase, o.modelo, o.cfg, o.cond, statusEfetivo]);
  const mut = useMoverEtapa(o.modeloId, o.tenantId);
  const onMover = (para: string) => mut.mutate({
    para, origem: o.modelo.origem ?? null,
    statusAntes: statusEfetivo, fixadoAntes: selo.modo === "fixado",
    cfg: o.cfg, cond: o.cond,
  });
  const podeMover = o.prontas && selo.fase === "kanban" && opcoes.length > 0;
  return { selo, opcoes, onMover, podeMover, movendo: mut.isPending };
}
```

**Steps:**
1. (TDD) Escrever `tests/unit/kanban-card-selo.test.ts`: `modeloKanbanDoEmbed` (ausente→null/false; true→true),
   `passaFiltroStatusCard` (reprovado no dev OU plan sai no sem_reprovado; todos passa tudo), e um anti-drift:
   `etapaDoModelo(modeloKanbanDoEmbed(embed), cfg)` concorda com o selo esperado em casos
   planejamento/kanban/lançado/reprovado.
2. Implementar `kanban-card-selo.ts`.
3. Extrair o popover de `EtapaHeader` para `MoverEtapaMenu.tsx`; religar `EtapaHeader` a ele (manter testIds).
4. Implementar `useSeloMover.ts` (modo lote).
5. `npx tsc --noEmit`; rodar os testes do `EtapaHeader`/Sheet do Planejamento para garantir zero regressão.

**Nota de reuso documentada:** a partir desta tarefa, PA, PI e PT usam o MESMO `MoverEtapaMenu` e o MESMO fio de
requisitos (`opcoesMover*`/`useMoverEtapa`). Nada de requisito é reimplementado por tela.

---

## T2 — PA: ampliar embed + condições em lote + selo+seletor no card

**Files:** `src/components/produto-acabado/ProdutoAcabadoSheet.tsx`, `src/components/produto-acabado/ProdutoCard.tsx`.

**Interfaces / mudanças:**

1. **Ampliar o embed** em `SELECT_PRODUTO` (`ProdutoAcabadoSheet.tsx:147-155`) — o embed do modelo passa a trazer
   os 4 campos do `ModeloKanban`:
```
modelo:modelo_id(preco_venda, preco_atacado, linha_id, fotos_modelo, desenho_tecnico_url, croqui_url,
  tamanho_tipo, modelo_skus(count),
  status_desenvolvimento, status_planejamento, ordem_criacao_enviada, origem, lancado)
```
   - `status_planejamento` entra para o filtro de reprovados (reprovado pode estar no Planejamento). `origem` do
     card espelho é sempre "revenda", mas lemos do embed (não assumir) — é o que `etapaDoModelo` precisa.
   - Em `rowToDraft` guardar os campos novos no draft (campos novos no tipo `ProdutoDraft` em `shared.ts`):
     `modeloStatusDev`, `modeloStatusPlan`, `modeloOrdemEnviada`, `modeloOrigem`, `modeloLancado`. (Esses ficam
     FORA de `chaveDirty` — são só-leitura do espelho; o seletor move via RPC, não pelo Salvar.)

2. **Config do kanban da loja** (queryKey PRÓPRIA):
```ts
const { data: cfgRow, isSuccess: cfgOk } = useQuery({
  queryKey: ["pa-kanban-config", tenantId],
  enabled: !!tenantId,
  queryFn: async () => {
    const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error; return (data ?? null) as Record<string, unknown> | null;
  },
});
const kanbanCfg = useMemo(() => lerKanbanAutoConfig(cfgRow ?? null), [cfgRow]);
```

3. **Condições em LOTE** por coleção (1 chamada; só modelos COM `modelo_id` e enviados ao kanban):
```ts
const modeloIdsKanban = useMemo(
  () => [...new Set((produtosQuery.data ?? [])
    .filter((p) => p.modelo_id && p.modeloOrdemEnviada && !p.modeloLancado)
    .map((p) => p.modelo_id as string))].sort(),
  [produtosQuery.data]);
const { data: condMap = {}, isSuccess: condOk } = useQuery({
  queryKey: ["pa-kanban-cond", colecaoId, modeloIdsKanban],
  enabled: modeloIdsKanban.length > 0,
  queryFn: async () => {
    const { data, error } = await supabase.rpc("avaliar_condicoes_kanban" as any, { _ids: modeloIdsKanban });
    if (error) throw error;
    return (data ?? {}) as Record<string, Record<string, boolean>>;
  },
});
const condProntas = cfgOk && (modeloIdsKanban.length === 0 || condOk);
```
   - Invalidar `["pa-kanban-cond", colecaoId]` (prefixo) e `["pa-kanban-config", tenantId]` junto com as
     invalidações que já existem após criar card/salvar (o `useMoverEtapa` já invalida `["modelo"]`,
     `["modelos-planejamento"]` etc.; adicionar as 2 keys de PA no `onSettled` via o `tenantId` passado ao hook —
     ver nota abaixo).

4. **Card** (`ProdutoCard.tsx`, cabeçalho ~371-399, ao lado do `SeloIntegracao` linha 372): renderizar o selo +
   seletor. O card recebe por props o resultado do `useSeloMoverLote` OU os ingredientes para chamá-lo. Para
   manter 1 chamada/coleção (cfg/cond carregados no Sheet), o Sheet chama `useSeloMoverLote` por card dentro do
   `renderCardsRow` NÃO é possível (hook em loop) — então: **o Sheet passa `kanbanCfg`, `condMap`, `condProntas`,
   `tenantId` ao card; o `ProdutoCard` chama `useSeloMoverLote` internamente** (1 hook por card renderizado, cfg/
   cond já em cache — sem fetch por card). Inserir após o `SeloIntegracao`:
```tsx
{produto.modelo_id && (
  <div className="mt-1">
    <MoverEtapaMenu
      selo={selo} podeMover={podeMover} opcoes={opcoes} onMover={onMover}
      movendo={movendo} carregando={!condProntas ? "carregando" : false}
      compacto testIdPrefix="pa"
    />
  </div>
)}
```
   onde `const { selo, opcoes, onMover, podeMover, movendo } = useSeloMoverLote({ modeloId: produto.modelo_id,
   modelo: modeloKanbanDoEmbed({ origem: produto.modeloOrigem, status_desenvolvimento: produto.modeloStatusDev,
   ordem_criacao_enviada: produto.modeloOrdemEnviada, lancado: produto.modeloLancado }), cfg: kanbanCfg,
   cond: condMap[produto.modelo_id] ?? {}, prontas: condProntas, tenantId })`.
   - Produto SEM `modelo_id` (ainda não virou card): sem selo (nada no kanban) — coerente com o PT (vaga sem
     card) e com o fato de que `etapaDoModelo` precisa do espelho.

**Steps:**
1. Adicionar campos novos a `ProdutoDraft`/`rowToDraft` (`shared.ts` + Sheet) e ao `SELECT_PRODUTO`.
2. Adicionar as 2 queries (config + cond lote) com keys próprias.
3. Passar `kanbanCfg`/`condMap`/`condProntas`/`tenantId` ao `ProdutoCard`; chamar `useSeloMoverLote` no card e
   renderizar `MoverEtapaMenu`.
4. Garantir que o `useMoverEtapa` (via `useSeloMover`) invalide também as keys de PA — ver T2b.
5. `npx tsc --noEmit`.

**T2b — invalidação cruzada:** `useMoverEtapa.onSettled` hoje invalida as keys do Planejamento/Desenvolvimento.
Para o reflexo bidirecional (mover em PA reflete em PI/PT/Planejamento), adicionar no `onSettled` a invalidação
GENÉRICA por prefixo das coleções de produto e do Plan. Tecido: `["produtos-acabados"]`, `["produtos-importados"]`,
`["plan-tecido-fases"]`→(após T6 some)/`["plan-tecido"]`. Preferir invalidar por prefixo amplo já existente para
não precisar do `colecaoId`. (Decisão: manter a invalidação no `useMoverEtapa` central; é o único mover.)

---

## T3 — PA: filtro de reprovados

**Files:** `src/components/produto-acabado/ProdutoAcabadoSheet.tsx`.

**Interfaces:**
```ts
const [filtroStatus, setFiltroStatus] = useState<"todos" | "sem_reprovado">("sem_reprovado");
```
- `FilterButton` (shared) com descritor single, perto do `AgrupamentoButton`/`RecolherMenu` do canvas:
```tsx
<FilterButton
  screen="produto-acabado-canvas"
  filters={[{
    label: "Status", single: true, value: filtroStatus, emptyValue: "sem_reprovado",
    onChange: (v) => { setFiltroStatus(v as "todos" | "sem_reprovado"); },
    options: [{ id: "sem_reprovado", nome: "Todos menos reprovado" }, { id: "todos", nome: "Todos" }],
  }]}
/>
```
- **Poda** ANTES do map que renderiza os cards. Hoje a lista por lane/subcoleção vem de `produtosSub` (derivada de
  `produtosQuery.data`). Aplicar a poda sobre a fonte dos cards:
```ts
const produtosVisiveis = useMemo(
  () => (produtosSub ?? []).filter((p) =>
    passaFiltroStatusCard({ status_desenvolvimento: p.modeloStatusDev, status_planejamento: p.modeloStatusPlan }, filtroStatus)),
  [produtosSub, filtroStatus]);
```
   e usar `produtosVisiveis` onde hoje `produtosSub` alimenta `macroCampo`/`laneKeys`/`renderCardsRow`
   (`ProdutoAcabadoSheet.tsx:1001-1047`). **Só esconde; nunca apaga** (o Salvar segue sobre `drafts`, não sobre o
   filtrado). Produto sem `modelo_id` NUNCA é reprovado (embed null → `passaFiltroStatusCard` true) — aparece
   sempre, como no PT.

**Steps:**
1. Estado + `FilterButton`.
2. Poda com `passaFiltroStatusCard` antes dos cálculos de lane/map.
3. `npx tsc --noEmit`.

---

## T4 — PI: selo+seletor no card (espelha T2)

**Files:** `src/components/produto-importado/ProdutoImportadoSheet.tsx`,
`src/components/produto-importado/ProdutoImportadoCard.tsx`.

**Mudanças (idênticas ao T2, com os nomes do PI):**
1. `SELECT_PRODUTO_IMPORTADO` (`ProdutoImportadoSheet.tsx:64`) — o produto já vem por `*`; ampliar o embed do
   modelo: `modelo:modelo_id(preco_venda, tamanho_tipo, modelo_skus(count), status_desenvolvimento,
   status_planejamento, ordem_criacao_enviada, origem, lancado)`.
2. `rowToDraft` do PI: guardar `modeloStatusDev/modeloStatusPlan/modeloOrdemEnviada/modeloOrigem/modeloLancado`
   (fora do `chaveDirty`, pelo mesmo motivo do PA — o embed magro foi feito para evitar P0409 falso, então estes
   campos NÃO entram no snapshot de dirty).
3. Queries com keys próprias: `["pi-kanban-config", tenantId]` e `["pi-kanban-cond", colecaoId, modeloIds]`.
4. `ProdutoImportadoCard` (cabeçalho ~337-345, ao lado do `SeloIntegracao` linha 339): `useSeloMoverLote` +
   `MoverEtapaMenu testIdPrefix="pi"`, só quando `draft.modelo_id`.

**Steps:** espelhar T2 (1-5). `npx tsc --noEmit`.

---

## T5 — PI: filtro de reprovados (espelha T3)

**Files:** `src/components/produto-importado/ProdutoImportadoSheet.tsx`.

**Mudanças (idênticas ao T3):** estado `filtroStatus`, `FilterButton` (`screen="produto-importado-canvas"`),
poda `produtosVisiveis` com `passaFiltroStatusCard` antes de `renderCardsRow` (`ProdutoImportadoSheet.tsx:1087`+,
usada nos 3 pontos de render `:1320/:1340/:1358`).

**Steps:** espelhar T3. `npx tsc --noEmit`.

---

## T6 — PT: trocar faseInfo/binário por etapaDoModelo (mantendo vaga sem card)

**Files:** `src/components/plan-tecido/PlanTecidoSheet.tsx`, `src/components/plan-tecido/ModelCard.tsx`.

**Contexto:** hoje a vaga COM card mostra `faseInfo(modeloId)` (badge de FASE, RPC `plan_tecido_fases`,
`PlanTecidoSheet.tsx:820-853`) e um status binário `statusEfetivoDaVaga` (pendente/reprovado) num Select
(`ModelCard.tsx:490-508`). A query `modelosDb` (`:489`) JÁ traz `origem, status_desenvolvimento,
status_planejamento, lancado, enviado_cad` — falta só `ordem_criacao_enviada` no select para montar o
`ModeloKanban` completo.

**Mudanças:**
1. **Adicionar `ordem_criacao_enviada`** ao select de `modelosDb` (`:489`).
2. **Config do kanban:** já existe `["plan-tecido-kanban-cols"]` lendo `status_kanban`. Para `etapaDoModelo`
   precisamos da config COMPLETA (`lerKanbanAutoConfig` lê revenda_kanban_*, kanban_automatico, requisitos).
   Trocar essa query por `["plan-tecido-kanban-config"]` com `select("*")` e derivar `kanbanCfg =
   lerKanbanAutoConfig(row)`. (Mantém `kanbanCols` via `boardDaLoja(kanbanCfg)`/`normalizeKanbanStatuses` para
   o resto; sem segunda query.)
3. **Condições em lote:** adicionar query `["plan-tecido-kanban-cond", colecaoId, modeloIdsDb]` chamando
   `avaliar_condicoes_kanban(_ids: modeloIdsDb)` (modeloIdsDb já existe, `:797`). Necessária para o seletor
   (mover) e para o selo "automática/fixado" com a chave ligada.
4. **Selo por card (vaga COM card):** criar helper local
   `seloDoCard(modeloId): EtapaSelo | null` que monta `ModeloKanban` do `modelosDb` daquele id e chama
   `etapaDoModelo(m, kanbanCfg)`; `null` quando não há `modelo_id`.
5. **ModelCard — render:** trocar o bloco `fase` (`ModelCard.tsx:538-542`) por renderizar `EtapaKanbanBadge`/
   `MoverEtapaMenu` quando a vaga tem card. A prop `fase` (`:140`, `:2214`) é substituída por uma prop
   `selo?: EtapaSelo | null` + o fio de mover (`opcoes/onMover/podeMover` via `useSeloMoverLote` chamado dentro
   do `ModelCard`, modo interno — origem interna usa board/requisitos internos). Remover a passagem de
   `faseInfo`/`fasesMap` ao card.
6. **Vaga SEM card:** NÃO muda. O Select `pendente/reprovado` (`ModelCard.tsx:490-508`, controlado por
   `statusEfetivo`/`onStatus` que gravam na vaga via `aplicarStatusVaga`) continua EXATAMENTE como está para
   `!slot.modelo_id`. Com card, esse Select some (o status passa a ser o kanban completo pelo selo/seletor) —
   `statusEfetivoDaVaga` com `slot.modelo_id` já derivava do card; agora "deriva" = status COMPLETO do kanban, não
   mais o binário. Então: para vaga COM card, não renderizar o Select de pendente/reprovado; renderizar o selo+
   seletor. Para vaga SEM card, manter o Select.
7. **`plan_tecido_fases` / `faseInfo` / `kanbanCols` (via query antiga):** `faseInfo` e a query `plan-tecido-fases`
   (`:820`) SAEM (não há mais badge de fase). `labelColunaKanban` segue usado por `etapaDoModelo` internamente.
   Remover `fasesMap`/`faseInfo`/`["plan-tecido-fases"]` e o uso em `:2214`.

**Steps:**
1. Add `ordem_criacao_enviada` ao select; trocar a query de kanban por `select("*")` + `lerKanbanAutoConfig`.
2. Add query de condições em lote (key própria).
3. `seloDoCard` + passar `selo` ao `ModelCard`; dentro do `ModelCard`, `useSeloMoverLote` (modo interno) para a
   vaga com card; render `MoverEtapaMenu testIdPrefix="pt" compacto`.
4. Remover `faseInfo`/`fasesMap`/`plan-tecido-fases`; esconder o Select pendente/reprovado quando há card.
5. `npx tsc --noEmit`; rodar os testes de `plan-tecido/calc` (continuam passando — `statusEfetivoDaVaga`/
   `slotPassaFiltroStatus` seguem válidos para vaga SEM card).

**Review Focus específico:** prova de que a vaga SEM card mantém o pendente/reprovado próprio (Select + `onStatus`
+ `aplicarStatusVaga` intactos). Só o caminho `slot.modelo_id` muda.

---

## T7 — PT: confirmar filtro de reprovados segue ok com o status completo

**Files:** `src/components/plan-tecido/PlanTecidoSheet.tsx` (confirmação; provavelmente zero mudança de código).

**Contexto:** o filtro do PT já existe (`filtroStatus` `:329`, `montarFiltrosPlanTecido` em `filtro-painel.ts`,
poda `slotPassaFiltroStatus` em `:2107`). Ele poda por `statusEfetivoDaVaga(slot, reprovadoDoCard)` —
`reprovadoDoCard = reprovadoStatusSet.has(modelo_id)`, e `reprovadoStatusSet` vem de `ehReprovado(dev, plan)` sobre
`modelosDb` (`:788`). Como T6 NÃO mexe em `reprovadoStatusSet` nem em `statusEfetivoDaVaga`, o filtro continua
correto: a vaga COM card reprovado (dev OU plan) segue sendo podada no modo `sem_reprovado`, e o selo do kanban
(que mostra a coluna "Reprovado") só aparece no modo "todos".

**Steps:**
1. Verificar que `reprovadoStatusSet` segue alimentando `slotPassaFiltroStatus` (`:2107`) após T6 — não remover.
2. Verificar que o selo do kanban de um card reprovado some no modo `sem_reprovado` (porque o slot inteiro é
   podado antes do render — `passaStatus` em `:2107`). Nada a implementar além da confirmação.
3. Rodar a suíte de `plan-tecido/calc` + `npx tsc --noEmit` final.

---

## Verificação (final)

- Unit: `modeloKanbanDoEmbed`, `passaFiltroStatusCard`, anti-drift vs `etapaDoModelo` (T1);
  `plan-tecido/calc` (statusEfetivoDaVaga com/sem card) segue verde (T6/T7).
- `npx tsc --noEmit` após cada tarefa que mexe em imports (regra do projeto).
- `npm run build` + `npm run lint`.
- QA na prévia: selo aparece em PA/PI/PT; mover numa tela reflete nas outras (invalidação central do
  `useMoverEtapa` + queries de produto/plan-tecido); filtro oculta/mostra reprovados em PA/PI (e segue no PT);
  mover para etapa sem requisito fica bloqueado com "falta X"; vaga sem card do PT mantém pendente/reprovado.
- Revisão: `code-reviewer`.
