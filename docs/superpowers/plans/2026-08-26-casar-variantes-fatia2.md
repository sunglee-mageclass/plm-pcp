# Casar variantes — Fatia 2 (reserva pelo par casado + pares na Ficha Técnica) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** O bloco de tecido complementar (Tecido 2/3, Forro, Entretela) que está CASADO com variantes do Tecido 1 passa a RESERVAR pela grade das cores do Tecido 1 casadas (Σ grade_total das variantes casadas), em vez da grade da própria posição. SEM arredondamento (mantém fracionado). Bloco complementar SEM casamento = comportamento de hoje intacto. Os pares aparecem na Ficha Técnica.

**Architecture:** um `CASE` no cálculo de reserva de `_estoque_tecido_core` (SSOT) e no espelho `detalhe_estoque_variante`: se a linha `modelo_tecido_variantes` é de bloco complementar E tem `complementa_variante_ids` não-vazio, o `grade_total` usado passa a ser a soma das grades das variantes do Tecido 1 casadas (traduzindo cada `variante_tecido_id` do array → `ordem` do Tecido 1 → `modelo_grades.grade_total`), POR MODELO. Front: `useFichaData` carrega `complementa_variante_ids`, `MaterialTable` mostra "casada com {...}".

**Tech Stack:** Supabase (SQL), Vite+React+TS, Vitest.

## Global Constraints
- Migration via `psql -f`; `BEGIN;…COMMIT;`; CREATE OR REPLACE diff-validado (`pg_get_functiondef` antes/depois, só o delta); REVOKE restatado (invariante #9). DB via `psql "$(cat /tmp/dburl.txt)"` — NUNCA ecoar a connection string.
- **A fórmula de reserva é DUPLICADA** em `_estoque_tecido_core` (CTE `reserva_mod`) e `detalhe_estoque_variante` — a mudança tem que entrar nas DUAS, senão a tela de detalhe da variante diverge do estoque (invariante #4). Teste transacional compara as duas.
- **SEM ceil** — mantém fracionado.
- **Zero regressão**: modelo sem casamento e o Tecido 1 devem dar reserva IDÊNTICA à de hoje (byte-a-byte). O teste tem que provar.
- `complementa_variante_ids` é `variante_tecido_id[]`; a soma das grades é POR MODELO (`mt.modelo_id`) — variante do Tecido 1 removida = id órfão no array, simplesmente não soma (sem erro).
- NÃO tocar o abate (`_baixar_estoque_tecido_corte_core` usa `cad_tecido_variantes.metragem_enviada` — fora de escopo).
- `npm run build` NÃO roda tsc → `npx tsc --noEmit`. Teste: `npx vitest run --no-file-parallelism` (nunca `npm test` puro — satura o pool). Anti-drift verde.

---

### Task 1: Reserva pelo par casado — `_estoque_tecido_core` + `detalhe_estoque_variante`

**Files:** Create `supabase/migrations/20260826120000_casar_variantes_fatia2_reserva.sql`

**Interfaces:** Muda o `grade_total` efetivo de linhas de bloco complementar casado nas DUAS funções de reserva. Sem mudança de assinatura.

- [ ] **Step 1 — helper de soma de grade do par (função SQL).** Criar `_grade_soma_pares(_modelo_id uuid, _complementa_ids uuid[]) RETURNS numeric` (SECURITY DEFINER, search_path public, REVOKE de PUBLIC/anon/authenticated): retorna `COALESCE(SUM(mg.grade_total),0)` das variantes do Tecido 1 do modelo cujo `variante_tecido_id = ANY(_complementa_ids)`:
  ```sql
  SELECT COALESCE(SUM(mg.grade_total),0)
  FROM public.modelo_tecido_variantes mv1
  JOIN public.modelo_tecidos mt1 ON mt1.id = mv1.modelo_tecido_id
     AND mt1.modelo_id = _modelo_id AND mt1.tipo = 'tecido' AND mt1.numero = 1
  JOIN public.modelo_grades mg ON mg.modelo_id = _modelo_id AND mg.variante_numero = mv1.ordem
  WHERE mv1.variante_tecido_id = ANY(_complementa_ids);
  ```
  (Amarra ao Tecido 1 do PRÓPRIO modelo; id órfão simplesmente não casa → não soma. Um helper centraliza a lógica nas 2 funções e evita drift.)

- [ ] **Step 2 — `_estoque_tecido_core`.** Dump VIVO. CREATE OR REPLACE com SÓ o delta no `reserva_mod`: o fator `COALESCE(g.gt,0)` vira um `CASE`:
  ```sql
  CASE
    WHEN mt.tipo = 'tecido' AND mt.numero = 1 THEN COALESCE(g.gt,0)
    WHEN mv.complementa_variante_ids IS NOT NULL AND cardinality(mv.complementa_variante_ids) > 0
      THEN public._grade_soma_pares(mt.modelo_id, mv.complementa_variante_ids)
    ELSE COALESCE(g.gt,0)   -- complementar SEM casamento = comportamento de hoje
  END
  ```
  NADA MAIS muda (o LEFT JOIN grade continua; só o fator usado muda por CASE). Diff-validar. Restatar REVOKE do `_core`.

- [ ] **Step 3 — `detalhe_estoque_variante`.** Dump VIVO. Mesma troca no subselect de reserva (o fator `grade_total` por `l.ordem`): buscar o `complementa_variante_ids` da linha `mtv` daquele bloco+ordem e aplicar o mesmo CASE:
  ```sql
  * ( CASE
        WHEN mt.tipo = 'tecido' AND mt.numero = 1 THEN COALESCE((SELECT mg.grade_total FROM modelo_grades mg WHERE mg.modelo_id=l.modelo_id AND mg.variante_numero=l.ordem),0)
        WHEN (SELECT mtv.complementa_variante_ids FROM modelo_tecido_variantes mtv WHERE mtv.modelo_tecido_id=mt.id AND mtv.ordem=l.ordem) IS NOT NULL
             AND cardinality((SELECT mtv.complementa_variante_ids FROM modelo_tecido_variantes mtv WHERE mtv.modelo_tecido_id=mt.id AND mtv.ordem=l.ordem)) > 0
          THEN public._grade_soma_pares(l.modelo_id, (SELECT mtv.complementa_variante_ids FROM modelo_tecido_variantes mtv WHERE mtv.modelo_tecido_id=mt.id AND mtv.ordem=l.ordem))
        ELSE COALESCE((SELECT mg.grade_total FROM modelo_grades mg WHERE mg.modelo_id=l.modelo_id AND mg.variante_numero=l.ordem),0)
      END )
  ```
  (`l` = `modelo_tecido_oc_links`; `mt.tipo`/`mt.numero` vêm do JOIN `modelo_tecidos mt`.) Diff-validar. Restatar REVOKE se houver.

- [ ] **Step 4 — aplicar + QA txn (rolled back).** `psql -f`. Diff-validar as 2 funções + o helper. ACLs: helper e cores com EXECUTE revogado de PUBLIC/anon/authenticated; wrappers públicos mantêm EXECUTE. **QA:**
  - Criar (txn) um modelo com Tecido 1 (2 variantes, grades 50 e 30) + Forro (1 variante) CASADO com as 2 variantes do Tecido 1 → a reserva do forro deve ser `consumo×(1+loss)×(50+30)×mult` (Σ das grades casadas), NÃO a grade da posição do forro.
  - Modelo SEM casamento → reserva do forro IDÊNTICA ao valor pré-migração (rodar a mesma conta com o `CASE` caindo no ELSE).
  - `_estoque_tecido_core` e `detalhe_estoque_variante` devem CONCORDAR no total reservado da variante do forro (comparar).
  ROLLBACK.

- [ ] **Step 5 — Commit** `feat(estoque): bloco complementar casado reserva pela grade do par (Σ cores do Tecido 1); sem regressão p/ não-casado (diff-validado)` na branch `feature/plan-tecido-a1`. NÃO push.

---

### Task 2: Ficha Técnica mostra os pares casados

**Files:** `src/components/producao/cad/useFichaData.ts`, `src/components/producao/cad/CadFichaCorte.tsx`

**Interfaces:** `TecidoRow["variantes"][number]` ganha `complementa_variante_ids?: string[]`; `MaterialTable` mostra "casada com {Tecido 1 · cor}, ..." na célula Variante.

- [ ] **Step 1 — carregar `complementa_variante_ids` no `useFichaData`.** O embed `cad_tecido_variantes(*)` (~:69) já traz a coluna (é `SELECT *`). No mapping (~:156-166), adicionar `complementa_variante_ids: v.complementa_variante_ids ?? null`. Atualizar o tipo `TecidoRow` (achar a definição do tipo no arquivo) p/ incluir `complementa_variante_ids?: string[] | null`.

- [ ] **Step 2 — mapa de rótulos das variantes do Tecido 1.** No `useFichaData`, derivar um `Map<variante_tecido_id, label>` das variantes do bloco Tecido 1 (tipo `tecido`, numero 1) usando os mesmos campos (`variante_nome/cor/apelido` via `varianteLabel`). Expor no retorno do hook (ex.: `tecido1LabelById`). (As variantes do Tecido 1 já estão em `cadTecidos` → `variantes`.)

- [ ] **Step 3 — `MaterialTable` mostra o par.** Em `CadFichaCorte.tsx`, `MaterialTable` recebe (novo prop opcional) `tecido1LabelById?: Map<string,string>`. Na célula Variante (~:92), quando `v.complementa_variante_ids?.length`, acrescentar em texto menor "· casada com {ids.map(id => tecido1LabelById.get(id)).filter(Boolean).join(', ')}". Passar o prop de `FichaTecnica.tsx` (e onde `CadFichaCorte`/Ficha de Corte usam `MaterialTable`, passar também — os dois mostram). Se `tecido1LabelById` ausente, não mostra (degrada).
  - Rótulo curto, cor de impressão (a Ficha é print — seguir o estilo `cell`; sem hex novo se possível, ou um cinza discreto coerente com a folha).

- [ ] **Step 4 — verificação.** `npx tsc --noEmit 2>&1 | grep -E 'TS2304|Ficha|useFichaData|CadFicha'` = vazio. `npm run build` passa. Anti-drift verde (impressão tem exceção de cor documentada, mas evitar hex novo). QA: imprimir a Ficha Técnica de um modelo com par casado → a linha do forro mostra "casada com {Tecido 1 · cor}". Modelo sem par = igual. Screenshot.

- [ ] **Step 5 — Commit** `feat(ficha): Ficha Técnica/Corte mostram a variante complementar casada` na branch `feature/plan-tecido-a1`. NÃO push.

---

### Task 3: Fechamento
- [ ] **Step 1 — teste automatizado da reserva.** Adicionar/estender um teste de integração (Vitest txn revertida, `tests/integration/`) que prova: (a) forro casado reserva por Σ das grades casadas; (b) forro não-casado reserva idêntico ao pré-mudança; (c) `_estoque_tecido_core` e `detalhe_estoque_variante` concordam. Rodar com `--no-file-parallelism`.
- [ ] **Step 2 — gates.** `tsc`=0; build; anti-drift; `npx vitest run --no-file-parallelism` (4 pre-existentes aceitos + o novo verde).
- [ ] **Step 3 — Review final (opus):** o CASE só muda blocos complementares CASADOS (Tecido 1 e não-casado byte-idênticos); as 2 fórmulas de reserva concordam; helper com ACL revogada; POR MODELO (sem cross-model); Ficha mostra o par; ZERO mudança no abate. Atualizar docs/mapeamento + CLAUDE.md invariante #4 (nota do par) + memória.

## Self-Review
**Spec coverage:** reserva pelo par (T1, 2 funções + helper); Ficha com pares (T2); teste + docs (T3). **Fora:** ceil independente; metragem_enviada do abate; complementar sem par (intacto).
**Placeholder scan:** T1 tem o SQL exato do helper e dos 2 CASE; T2 tem arquivo+âncora (useFichaData :156-166, MaterialTable :92). **Type consistency:** `complementa_variante_ids: string[]|null` no TecidoRow (T2); `_grade_soma_pares(uuid, uuid[])→numeric` idêntico nas 2 chamadas (T1).
**Riscos:** (a) DUPLICAÇÃO da fórmula — helper centraliza, mas o CASE entra nas 2; o teste compara as 2 (T1 Step 4 / T3). (b) POR MODELO — o helper amarra `mt1.modelo_id=_modelo_id`; sem isso somaria grade de outro modelo. (c) regressão zero p/ não-casado — o ELSE do CASE é o COALESCE(g.gt,0) de hoje; teste byte-a-byte. (d) id órfão no array (variante do Tecido 1 removida) → não casa no helper → não soma, sem erro.
