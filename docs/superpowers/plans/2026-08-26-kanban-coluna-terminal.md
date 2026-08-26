# Kanban: coluna terminal obrigatória (sintética) + Reprovado colapsado — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** Dar aos boards de kanban um "último card" FIXO e obrigatório onde ancorar automação — já que os status/etapas são editáveis pelo usuário. (1) Em **Desenvolvimento**, "Reprovado" nasce colapsado por default (outros expandidos). (2) Em **Desenvolvimento** e (3) em **Etapas PL**, uma coluna terminal SINTÉTICA (injetada pelo sistema, fora da config editável), sempre última, sempre colapsada, imune ao expandir-tudo; o card entra nela AUTOMATICAMENTE (derivado) quando `modelos.lancado === true`, e SAI das colunas normais (aparece só na terminal). Rótulo: Dev="Lançado", Etapas PL="Finalizado". **Tudo front, derivado — ZERO migração de banco.**

**Architecture:** `lancado` já é fonte única de "Lançado" (`modelos.lancado`, set pela "Lançar" no Planejamento). Os dois boards são separados (código independente); a coluna terminal é adicionada em CADA um como coluna sintética de chave reservada (`"__lancado__"` / `"__finalizado__"`), NÃO persistida na config nem no `status_desenvolvimento`. O bucketing de cards passa a: se `lancado` → terminal; senão → coluna normal de hoje. A coluna terminal é sempre renderizada por último, força-colapsada, e o expandir-tudo a ignora.

**Tech Stack:** Vite+React+TS. Sem SQL.

## Global Constraints
- ZERO migração/RPC/trigger. `lancado` já vem (Dev) ou passa a vir (Etapas PL) na query — só LER.
- A coluna terminal é SINTÉTICA: chave reservada com sentinela improvável de colidir (`"__lancado__"`, `"__finalizado__"`); NÃO entra em `tenant_config.status_kanban`/`pcp_etapas`; NÃO editável/removível na Config.
- Derivada: card com `lancado=true` aparece SÓ na terminal; se `lancado` voltar a false, volta ao fluxo. Sem writer novo.
- Sempre colapsada por default + imune ao "expandir tudo" (o global toggle nunca a expande; o botão de expandir dela é o único jeito de abrir — ou fica sempre colapsável só individual).
- `npm run build` NÃO roda tsc → `npx tsc --noEmit`. Anti-drift verde. Teste unit onde houver lib pura.
- Reusar o padrão de colapso existente de cada board (Dev: `collapsed: Set<string>` + `toggleAll`/`isCollapsed`; Etapas: `collapsedCols` + `toggleAllCols`).

---

### Task 1: Desenvolvimento — Reprovado colapsado por default (pedido #1, isolado)

**Files:** `src/routes/_authenticated/criacao.desenvolvimento.tsx`

**Interfaces:** o `collapsed` (Set de status keys) nasce com `"reprovado"` incluído; usuário pode expandir; não re-força ao expandir/colapsar.

- [ ] **Step 1:** O `collapsed` state (~:127) hoje é `useState(new Set())`. Semear `"reprovado"` DEPOIS que `statusKanban` resolve (query async ~:174-186). Adicionar um `useEffect` keyed em `statusKanban`, guardado por um ref "usuário já tocou" (espelhar o `tecidosTocadoRef` ~:140,504-508): na 1ª vez que `statusKanban` tem itens, `setCollapsed(prev => new Set(prev).add("reprovado"))` SE `"reprovado"` for uma key presente. O ref impede re-semear depois que o usuário mexe (toggle marca o ref).
  - `toggleCollapse` (~:144-148) e `toggleAll` (~:481-482) devem marcar o ref (`tocado=true`) para não re-semear.
- [ ] **Step 2:** `npx tsc --noEmit | grep -E 'TS2304|desenvolvimento'` vazio; `npm run build`; anti-drift. QA :5173 (reusar vite do dono): abrir Desenvolvimento → "Reprovado" nasce colapsado, demais expandidos; expandir Reprovado manualmente funciona; recarregar volta ao default (Reprovado colapsado) — aceitável (estado em memória). Screenshot.
- [ ] **Step 3: Commit** `feat(dev): coluna Reprovado do kanban nasce colapsada por default` na branch `feature/plan-tecido-a1`. NÃO push.

---

### Task 2: Desenvolvimento — coluna terminal sintética "Lançado" (pedido #2)

**Files:** `src/routes/_authenticated/criacao.desenvolvimento.tsx`

**Interfaces:** uma coluna sintética `TERMINAL = { key: "__lancado__", label: "Lançado", color: ... }` sempre renderizada por ÚLTIMO; cards com `lancado=true` vão só pra ela; sempre colapsada + imune ao expandir-tudo.

- [ ] **Step 1 — `lancado` na query.** A query do board (~:198-209) já traz vários campos; adicionar `lancado` ao `.select(...)` (a coluna existe em `modelos`). Tipar no shape do card.
- [ ] **Step 2 — bucketing.** `byStatus` (~:427-438) hoje mapeia por `status_desenvolvimento` (fallback firstStatusKey). Alterar: se `m.lancado === true`, o card vai pro bucket `"__lancado__"` (a terminal) e NÃO pro bucket normal (sai do fluxo — decisão do dono). Senão, comportamento de hoje.
- [ ] **Step 3 — coluna sintética na lista de colunas.** Onde renderiza `statusKanban.map(...)` (desktop ~:586-666, mobile accordion ~:669-697): renderizar, DEPOIS do map dos status normais, a coluna terminal (mesma estrutura visual de coluna colapsada/expandida). Definir `const TERMINAL_DEV = { key: "__lancado__", label: "Lançado", color: "var(--tone-success-fg)" ou similar token }`. NÃO adicionar `TERMINAL_DEV` a `statusKanban` (senão entra no `toggleAll`/config); é uma coluna à parte no JSX + no `byStatus`.
- [ ] **Step 4 — sempre colapsada + imune.** `isCollapsed` p/ a terminal = SEMPRE true por default (semear no Task-1 `collapsed`? não — a terminal não é status key). Tratar a terminal com sua PRÓPRIA lógica: um `terminalAberta` state local (default false); o botão de expandir DELA alterna só ela; o `toggleAll` (~:481-482) NÃO a inclui (não está em `statusKanban`), então já é imune por construção. Garantir que o rail colapsado dela mostra label vertical + contagem (espelhar o rail dos outros ~:616).
  - Card na terminal: reusar `KanbanCard`; drag DESABILITADO na terminal (não faz sentido arrastar de/para ela — ela é derivada). Se o board permite drop, bloquear drop na terminal e drag dos cards dela.
- [ ] **Step 5:** `tsc`/build/anti-drift. QA :5173: um modelo lançado (`lancado=true`) aparece SÓ na coluna "Lançado" (colapsada, à direita); expandir tudo NÃO a abre; abrir só ela funciona; um modelo não-lançado fica no fluxo normal; desmarcar lançado devolve ao fluxo. Screenshot.
- [ ] **Step 6: Commit** `feat(dev): coluna terminal sintética "Lançado" (derivada de lancado, sempre colapsada)` na branch. NÃO push.

---

### Task 3: Etapas PL — coluna terminal sintética "Finalizado" (pedido #3)

**Files:** `src/lib/pcp-etapas-kanban.ts`, `src/components/producao/etapas/useEtapasCards.ts`, `src/components/producao/etapas/EtapasBoard.tsx`, `src/routes/_authenticated/pcp.etapas.tsx` (+ `src/lib/pcp-etapas.ts` se a chave terminal entrar lá — mas NÃO em `ETAPAS_DEFAULT`)

**Interfaces:** uma coluna sintética `"__finalizado__"` (label "Finalizado") sempre última + colapsada; card com `modelo.lancado=true` vai só pra ela.

- [ ] **Step 1 — `lancado` na query + tipo.** `useEtapasCards.ts` (~:44-48): adicionar `lancado` ao `.select("id, ref, nome, ... , lancado, cad(...)")`. `ModeloRow` (`pcp-etapas-kanban.ts:27-35`): adicionar `lancado?: boolean | null`.
- [ ] **Step 2 — bucketing derivado.** `montarCards` (`pcp-etapas-kanban.ts:51-87`): ao montar cada card, se `modelo.lancado === true`, setar `etapa: "__finalizado__"` (a terminal) em vez da etapa derivada por `etapaDoBloco`. (O card SAI do fluxo normal e vai só pra terminal — espelha a decisão do Dev.) Manter a exclusão de reprovado etc.
  - Alternativa mais limpa: `etapaDoBloco` continua igual; o override `lancado→"__finalizado__"` fica em `montarCards` (que tem acesso ao `modelo`). Preferir isso (não poluir a derivação pura de bloco com dado de modelo).
- [ ] **Step 3 — coluna sintética no board.** `EtapasBoard.tsx` (~:49 `etapas.filter(ativa)`, ~:100-165 render): após as colunas ativas, renderizar a coluna terminal `{ key: "__finalizado__", label: "Finalizado", ativa: true }` por ÚLTIMO. NÃO adicionar a `ETAPAS_DEFAULT`/`pcp_etapas` (fora da config). O bucket `Map<EtapaKey, EtapaCard[]>` (~:50-56) já agrupa por `c.etapa`, então cards com `etapa="__finalizado__"` caem no bucket certo — só garantir que a coluna terminal é renderizada mesmo não estando em `etapas`.
  - `EtapaKey` (`pcp-etapas.ts:1`) é um union — adicionar `"__finalizado__"` ao type (mas NÃO a `ETAPAS_DEFAULT`).
- [ ] **Step 4 — sempre colapsada + imune.** `collapsedCols` (`pcp.etapas.tsx:77`) + `toggleAllCols`/`allCollapsed` (~:142-145) iteram `colunasAtivas` — a terminal NÃO está lá, então o global toggle já a ignora (imune por construção). Dar à terminal um estado próprio de abrir/fechar (default colapsada), como no Dev. Contagens (`pcp.etapas.tsx:137-140,258-264`) e `colunasAtivas` (~:136) devem considerar a terminal ao contar cards mas não no toggle-all.
- [ ] **Step 5 — paridade do badge.** `EtapasPlPanel.tsx` (o badge de etapa dentro do sheet de PCP Serviços) usa o mesmo `etapaDoBloco` — como o override é em `montarCards` (não em `etapaDoBloco`), o badge do sheet NÃO mudará (mostra a etapa real do bloco). Confirmar que isso é aceitável (o sheet mostra a etapa de produção; "Finalizado/Lançado" é conceito do BOARD). Se o dono quiser o badge refletir "Lançado" também, é fast-follow — NÃO nesta task.
- [ ] **Step 6:** `tsc`/build/anti-drift. QA :5173 (módulo `etapas_pl` ligado): um modelo lançado aparece só na coluna "Finalizado" (última, colapsada); expandir-tudo não a abre; não-lançado segue nas etapas derivadas; desmarcar lançado devolve. Screenshot.
- [ ] **Step 7: Commit** `feat(pcp): coluna terminal sintética "Finalizado" no Etapas PL (derivada de lancado)` na branch. NÃO push.

---

### Task 4: Fechamento
- [ ] **Step 1:** `tsc`=0; build; anti-drift; `npx vitest run --no-file-parallelism` (4 pre-existentes ok). QA dos 3: Reprovado colapsado; Dev "Lançado" e Etapas "Finalizado" recebem o lançado, sempre colapsadas, imunes ao expandir-tudo, card sai do fluxo. Modelo não-lançado 100% igual ao de hoje.
- [ ] **Step 2:** Review final (opus): coluna sintética NÃO entra na config editável; derivada de `lancado` (sem writer/migração); sempre colapsada + imune; card lançado sai do fluxo normal; os 2 boards independentes; sentinelas de chave não colidem com status/etapa reais. Atualizar memória.

## Self-Review
**Spec coverage:** Reprovado colapsado (T1); terminal Dev "Lançado" (T2); terminal Etapas "Finalizado" (T3). **Fora:** badge do sheet PCP refletir Lançado (fast-follow); persistir posição (é derivado); marco CQ (dono escolheu só `lancado`).
**Riscos:** (a) sentinela de chave — `"__lancado__"`/`"__finalizado__"` não podem colidir com uma key de status/etapa real (slugify nunca gera `__x__`; seguro); (b) a terminal fora do `toggleAll` — imune por construção, confirmar; (c) card lançado sumindo do fluxo — é a decisão do dono, garantir que NÃO some do board todo (só troca de coluna); (d) drag na terminal — desabilitar; (e) Etapas: override em montarCards, não na derivação pura (mantém `etapaDoBloco` testável).
