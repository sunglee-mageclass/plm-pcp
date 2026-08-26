# Badge de origem "Revenda" nos cards (Desenvolvimento + Planejamento de Produto) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** Nos cards das listas de **Desenvolvimento** e **Planejamento de Produto**, mostrar um badge "Revenda" para produtos com `modelos.origem === "revenda"` (produtos comprados prontos p/ revender, não fabricados). Feature visual pequena, front-only, sem banco.

**Architecture:** um `<StatusBadge tone="info">Revenda</StatusBadge>` (primitivo já usado nos dois arquivos) renderizado condicionalmente quando `modelo.origem === "revenda"`, junto ao nome/VersaoBadge de cada card. No Planejamento `origem` já vem na query; no Desenvolvimento precisa ser adicionado à query + ao tipo.

**Tech Stack:** Vite+React+TS. Sem SQL.

## Global Constraints
- `StatusBadge` de `@/components/shared/StatusBadge` (já importado nos 2 arquivos); tons: success/warning/danger/info/neutral. Usar `info` (revenda é classificação de origem, não status de workflow nem erro).
- Badge só aparece quando `origem === "revenda"` (interno/null = sem badge, comportamento de hoje).
- `origem` já EXISTE em `modelos`. Dev: adicionar à query+tipo. Planejamento: já vem (`criacao.planejamento.tsx:270`, tipo `:94`).
- `npm run build` NÃO roda tsc → `npx tsc --noEmit`. Anti-drift verde (usar StatusBadge/tokens, sem hex/px cru).
- Rótulo "Revenda" idêntico nos 2 cards (mesma entidade = mesmo rótulo). Consistente com o filtro/agrupamento "Revenda" que já existe no Planejamento.

---

### Task 1: Desenvolvimento — badge "Revenda" no KanbanCard + MobileCard

**Files:** `src/routes/_authenticated/criacao.desenvolvimento.tsx`

**Interfaces:** `origem` na query + no tipo `Modelo`; badge nos 2 cards.

- [ ] **Step 1 — dado.** Query `["modelos-desenvolvimento"]` (~:228): adicionar `origem` ao `.select(...)`. Tipo `Modelo` (~:40): adicionar `origem: string | null`. (Modelos de revenda TÊM `ordem_criacao_enviada=true` — confirmado 8 no banco — então aparecem no board; o badge é visível.)
- [ ] **Step 2 — KanbanCard (desktop, ~:932-977).** Junto ao nome+VersaoBadge (~:963-966), quando `modelo.origem === "revenda"`, renderizar `<StatusBadge tone="info" className="text-[10px] normal-case tracking-normal shrink-0">Revenda</StatusBadge>`. Posicionar sem quebrar o `truncate` do nome (badge com `shrink-0`; o nome mantém `truncate`).
- [ ] **Step 3 — MobileCard (~:878-930).** Mesmo badge, no mesmo lugar relativo (junto ao nome/VersaoBadge — achar a linha equivalente ~:903). `origem` vem do mesmo `modelo`.
- [ ] **Step 4 — verificação.** `npx tsc --noEmit 2>&1 | grep -E 'TS2304|desenvolvimento'` vazio; `npm run build`; anti-drift. QA :5173 (reusar vite do dono): abrir Desenvolvimento → um card de revenda (há 8 no banco; ex. loja com revenda) mostra o badge "Revenda"; card interno não mostra. Screenshot desktop + mobile.
- [ ] **Step 5 — Commit** `feat(dev): badge "Revenda" no card do kanban de Desenvolvimento` na branch `feature/plan-tecido-a1`. NÃO push.

---

### Task 2: Planejamento de Produto — badge "Revenda" no card

**Files:** `src/routes/_authenticated/criacao.planejamento.tsx`

**Interfaces:** `origem` já vem (query :270, tipo :94). Só o badge no card (compacto + corpo cheio).

- [ ] **Step 1 — corpo cheio (~:993-997).** Junto ao nome+VersaoBadge (~:994-996), quando `modelo.origem === "revenda"`, renderizar `<StatusBadge tone="info" className="normal-case tracking-normal shrink-0">Revenda</StatusBadge>`. (O card já usa `modelo.origem !== "revenda"` em outros pontos, ex. :1031 — o dado está disponível no escopo do card.)
- [ ] **Step 2 — compacto (~:968-988).** No ramo `compact` (mobile/muitas colunas), adicionar o badge "Revenda" de forma discreta junto ao nome (~:972) ou ao lado do StatusBadge de status (~:975) — menor (`text-[10px]`), sem poluir. Se o espaço for apertado, priorizar o corpo cheio; no compacto pode ir como um badge pequeno na mesma linha do nome.
- [ ] **Step 3 — verificação.** `npx tsc --noEmit 2>&1 | grep -E 'TS2304|planejamento'` vazio; `npm run build`; anti-drift. QA :5173: abrir Planejamento de Produto → card de revenda mostra "Revenda"; interno não; nos dois modos (compacto e cheio). Screenshot.
- [ ] **Step 4 — Commit** `feat(planejamento): badge "Revenda" no card de Planejamento de Produto` na branch. NÃO push.

---

### Task 3: Fechamento
- [ ] **Step 1:** `tsc`=0; build; anti-drift. QA dos 2 boards: badge "Revenda" só em card de revenda, mesmo rótulo/tom nos dois; interno intocado. Screenshots.
- [ ] **Step 2:** Review final (opus/sonnet): badge condicional a `origem==="revenda"`, `StatusBadge tone="info"`, rótulo "Revenda" idêntico nos 2 cards; Dev ganhou `origem` na query+tipo; sem hex/px cru; nada mais mudou.

## Self-Review
**Spec coverage:** badge Dev (T1); badge Planejamento (T2). **Type consistency:** `origem: string \| null` no tipo `Modelo` do Dev (Planejamento já tem). **Riscos:** (a) Dev sem `origem` na query — T1 Step 1 adiciona; (b) truncate do nome — badge `shrink-0`; (c) mesmo rótulo/tom nos 2 — "Revenda"/`info` em ambos.
