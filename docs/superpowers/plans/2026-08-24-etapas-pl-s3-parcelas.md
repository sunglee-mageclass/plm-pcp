# Etapas PL — S3 (Parcelas de Serviço pelo Prazo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Gerar `parcelas_servico` seguindo o prazo do fornecedor (ex `"30/60/90"` → 3 parcelas com vencimento Data Entregue +30/+60/+90), preservando parcelas pagas; e exibir o offset `+Ndias` por parcela nas abas Serviços **e** OCs do Financeiro.

**Architecture:** A geração de `parcelas_servico` vive dentro da RPC de leitura `servicos_financeiro()` (sync-then-read). Troca-se o seed de data única pelo split do prazo do fornecedor (`empresas.prazo_pagamento`) a partir da data-base `data_entregue`, netting contra pagas. Para o rótulo `+Ndias` da aba OCs, persiste-se `dias_offset` em `parcelas` (gravado por `_recalcular_parcelas_core`, que já conhece `v_dias[i]`). `servicos_financeiro()` passa a devolver `dias_offset` por parcela. Front exibe `data · +Ndias`.

**Tech Stack:** Vite+React+TS, TanStack, Supabase (Postgres), Tailwind+shadcn, Vitest.

## Global Constraints

- Migrations em `supabase/migrations/`, aplicadas via `psql "$(cat /tmp/dburl.txt)" -f <arq>` (regra 1). Se `/tmp/dburl.txt` faltar, OBTER a conexão do dono — não inventar. Envolver em `BEGIN;…COMMIT;`.
- **Editar função existente = diff-validar** (regra 2/CLAUDE.md): dump do `pg_get_functiondef` VIVO como base, editar só o delta, `diff` antes/depois mostra SÓ as adições planejadas. Usar `CREATE OR REPLACE` (preserva ACL/REVOKE) — NUNCA `DROP FUNCTION`.
- `servicos_financeiro()` e `_recalcular_parcelas_core` têm REVOKE de PUBLIC/anon (invariante #1/#9); o `CREATE OR REPLACE` preserva — confirmar após aplicar.
- **Invariante de segurança de dados (o ponto crítico do review):** NUNCA alterar/deletar parcela com `status='pago'` OU `data_pagamento IS NOT NULL`. NUNCA sobrescrever `data_vencimento` de parcela `a_pagar` que foi editada à mão. Netting sempre abate o valor já pago do total.
- Sem prazo cadastrado no fornecedor → comportamento ATUAL (N = `numero_parcelas`, data única = Data Entregue). Sem regressão.
- Coluna nova fora do `types.ts` → `as any` no ponto de leitura do front. Antes de cada commit: `npx tsc --noEmit | grep TS2304`, `npm run build`, teste anti-drift (`tests/unit/ui-padroes-antidrift.test.ts`).
- NÃO dropar `producao_terceirizados.numero_parcelas` (legado + fallback sem prazo).
- Datas SEMPRE via `<DateField>` no front (nunca `<input type=date>`). Aqui S3 só EXIBE offset — sem novo input de data.

---

### Task 1: Migration — `parcelas.dias_offset` + `_recalcular_parcelas_core` grava o offset

**Files:**
- Create: `supabase/migrations/20260824140000_parcelas_dias_offset.sql`

**Interfaces:**
- Produces: coluna `parcelas.dias_offset int` (nullable); `_recalcular_parcelas_core` passa a gravar `dias_offset = v_dias[i]` (ou NULL quando caiu no fallback `i*30`) nos 3 INSERTs.

- [ ] **Step 1:** Dump do def VIVO: `psql "$(cat /tmp/dburl.txt)" -c "select pg_get_functiondef('public._recalcular_parcelas_core(uuid,text)'::regprocedure);" > /tmp/core_before.sql`. (Se a assinatura exata divergir, descobrir com `\df _recalcular_parcelas_core` e usar a real.)
- [ ] **Step 2:** Escrever a migration. `BEGIN;` + `ALTER TABLE public.parcelas ADD COLUMN IF NOT EXISTS dias_offset int;` + `CREATE OR REPLACE FUNCTION public._recalcular_parcelas_core(...)` com o corpo do def VIVO, editado APENAS assim:
  - Declarar (se ainda não houver) nada novo — `v_dias`/`i` já existem.
  - No loop (perto de `20260811100000_recalcular_parcelas_p_acabado.sql:146-158`), calcular o offset junto do vencimento:
    ```sql
    IF array_length(v_dias, 1) >= i THEN
      v_vencimento := v_base_data + v_dias[i]; v_offset := v_dias[i];
    ELSE
      v_vencimento := v_base_data + (i * 30); v_offset := NULL;
    END IF;
    ```
    (declarar `v_offset int;` no bloco DECLARE).
  - Nos 3 `INSERT INTO public.parcelas (...)` adicionar `, dias_offset` na lista de colunas e `, v_offset` nos VALUES. Nada mais.
  - `COMMIT;`.
- [ ] **Step 3:** Aplicar + diff-validar: `psql -f`; dump AFTER (`/tmp/core_after.sql`); `diff /tmp/core_before.sql /tmp/core_after.sql` → só: `v_offset` no DECLARE, as 2 atribuições no IF, e `dias_offset`/`v_offset` nos 3 INSERTs. Confirmar coluna: `select column_name from information_schema.columns where table_name='parcelas' and column_name='dias_offset';`. Confirmar ACL preservada: `select has_function_privilege('anon','public._recalcular_parcelas_core(uuid,text)','EXECUTE');` deve ser `f` (ou o teste de REVOKE que já existir).
- [ ] **Step 4: Commit** `git commit -m "feat(financeiro): parcelas.dias_offset gravado por _recalcular_parcelas_core (diff-validado)"`

---

### Task 2: Migration — `servicos_financeiro()` gera parcelas pelo prazo + devolve `dias_offset`

**Files:**
- Create: `supabase/migrations/20260824150000_servicos_financeiro_prazo.sql`

**Interfaces:**
- Consumes: `empresas.prazo_pagamento` (S2), `producao_terceirizados.empresa_id`, `data_entregue`/`data_enviado`.
- Produces: `servicos_financeiro()` (a) gera `parcelas_servico` pelo split do prazo com netting; (b) devolve `dias_offset int` por parcela no jsonb.

- [ ] **Step 1:** Dump do def VIVO: `psql "$(cat /tmp/dburl.txt)" -c "select pg_get_functiondef('public.servicos_financeiro()'::regprocedure);" > /tmp/sf_before.sql`. Ler o corpo inteiro; localizar (i) o loop de sync que hoje faz o INSERT flat + o UPDATE de `data_vencimento IS NULL` (origem: `20260717120000_parcelas_servico_comprovante.sql:31-42`); (ii) o SELECT final que monta o jsonb (colunas listadas no report do explorer).
- [ ] **Step 2:** Escrever a migration = `BEGIN;` + `CREATE OR REPLACE FUNCTION public.servicos_financeiro()` com o corpo VIVO editado em DOIS pontos, nada mais:

  **(A) Substituir o seed flat pelo split do prazo, dentro do mesmo loop por bloco `r` elegível.** Declarar no DECLARE: `v_prazo text; v_dias int[]; v_n int; v_base date; v_venc date; v_off int; i int;`. Substituir o bloco INSERT+UPDATE flat por:
  ```sql
  v_base := COALESCE(r.data_entregue, r.data_enviado);
  v_prazo := (SELECT prazo_pagamento FROM public.empresas WHERE id = r.empresa_id);
  v_dias := ARRAY(
    SELECT t::int FROM regexp_split_to_table(COALESCE(v_prazo,''),'[^0-9]+') AS t
    WHERE t ~ '^[0-9]+$'
  );
  IF array_length(v_dias,1) >= 1 THEN
    v_n := LEAST(array_length(v_dias,1), 24);
  ELSE
    v_n := GREATEST(COALESCE(r.numero_parcelas,1), 1);
  END IF;

  -- Deleta só parcelas NÃO pagas acima de v_n (nunca apaga paga)
  DELETE FROM public.parcelas_servico ps
   WHERE ps.producao_terceirizado_id = r.id
     AND ps.numero_parcela > v_n
     AND ps.status <> 'pago' AND ps.data_pagamento IS NULL;

  -- Gera/atualiza 1..v_n preservando pagas e vencimentos editados à mão
  FOR i IN 1..v_n LOOP
    IF array_length(v_dias,1) >= i THEN v_venc := v_base + v_dias[i]; v_off := v_dias[i];
    ELSE v_venc := v_base + (i*30); v_off := NULL; END IF;

    INSERT INTO public.parcelas_servico (tenant_id, producao_terceirizado_id, numero_parcela, data_vencimento)
    VALUES (v_tenant, r.id, i, v_venc)
    ON CONFLICT (producao_terceirizado_id, numero_parcela) DO NOTHING;

    -- Só corrige o vencimento de parcela a_pagar que AINDA está na data-base "crua"
    -- (nunca editada à mão, nunca paga). Preserva ajuste manual e pagas.
    UPDATE public.parcelas_servico ps
       SET data_vencimento = v_venc
     WHERE ps.producao_terceirizado_id = r.id AND ps.numero_parcela = i
       AND ps.status <> 'pago' AND ps.data_pagamento IS NULL
       AND (ps.data_vencimento IS NULL OR ps.data_vencimento = v_base);
  END LOOP;
  ```
  ⚠️ A detecção de "editado à mão" = `data_vencimento <> v_base` (o valor cru antigo). Isso é conservador: só reescreve enquanto o vencimento ainda for exatamente a data-base (estado pré-prazo) ou nulo; qualquer outro valor é tratado como manual e preservado. Aceito pelo dono (na dúvida, preserva).

  **(B) Expor `dias_offset` no SELECT final.** O SELECT já devolve `numero_parcela`. Para o offset por parcela, computar a partir do prazo do fornecedor **na projeção**: adicionar ao SELECT jsonb um campo `'dias_offset', <expr>` onde `<expr>` reproduz o mesmo array: pegar o `numero_parcela`-ésimo elemento de `regexp_split_to_table(empresas.prazo_pagamento…)`. Como o SELECT já junta `empresas` (para `empresa_nome`), derivar:
  ```sql
  'dias_offset',
    (ARRAY(SELECT t::int FROM regexp_split_to_table(COALESCE(e.prazo_pagamento,''),'[^0-9]+') AS t WHERE t ~ '^[0-9]+$'))[ps.numero_parcela]
  ```
  (`e` = alias já usado para `empresas` no SELECT; se o alias for outro, usar o real. Quando não há prazo ou o índice excede → NULL, front mostra "—".)

  `COMMIT;`.
- [ ] **Step 3:** Aplicar + diff-validar: `psql -f`; dump AFTER; `diff /tmp/sf_before.sql /tmp/sf_after.sql` → só o bloco de sync trocado + as declarações + o campo `dias_offset` no SELECT. Confirmar ACL: `select has_function_privilege('anon','public.servicos_financeiro()','EXECUTE');` = `f`.
- [ ] **Step 4:** QA manual do algoritmo via SQL (não commitar): num bloco de teste com fornecedor prazo "30/60/90" e `data_entregue` setada, chamar `select * from jsonb_array_elements(servicos_financeiro())` e conferir 3 parcelas com vencimentos +30/+60/+90 e `dias_offset` 30/60/90; marcar uma paga e rechamar → paga intacta, demais preservam.
- [ ] **Step 5: Commit** `git commit -m "feat(financeiro): parcelas_servico geradas pelo prazo do fornecedor + dias_offset (diff-validado)"`

---

### Task 3: Front — exibir `+Ndias` por parcela nas abas Serviços e OCs

**Files:**
- Modify: `src/routes/_authenticated/financeiro.tsx`

**Interfaces:**
- Consumes: `dias_offset` de `servicos_financeiro()` (aba Serviços) e da tabela `parcelas` (aba OCs, `select("*")` já traz).
- Produces: célula/badge de Vencimento mostra `dd/mm/aaaa` + um sufixo discreto `+Ndias` quando `dias_offset` não-nulo.

- [ ] **Step 1:** Criar um helper local pequeno no arquivo (perto dos outros helpers de formatação), ex.:
  ```tsx
  function OffsetTag({ dias }: { dias: number | null | undefined }) {
    if (dias == null) return null;
    return <span className="ml-1 text-[11px] text-muted-foreground tabular-nums">+{dias}d</span>;
  }
  ```
  (usar tokens/classes já existentes — sem px/hex cru; `text-[11px]` é permitido? conferir anti-drift: se reprovar, usar `text-xs`.)
- [ ] **Step 2:** Aba Serviços (`ServicosView`, célula Vencimento ~`financeiro.tsx:1510-1511`): ao lado do `<VencimentoCell>`/data, renderizar `<OffsetTag dias={r.dias_offset} />` (ler `r.dias_offset` com `as any` se o tipo do row não tiver). Não alterar a edição inline do vencimento.
- [ ] **Step 3:** Aba OCs (célula de vencimento da lista de `parcelas`, ~`financeiro.tsx:1050-1074` e a render correspondente): idem, `<OffsetTag dias={(p as any).dias_offset} />` junto da data. Localizar a célula real de vencimento na render das parcelas de OC e adicionar o tag; não mexer no `VencimentoCell` de OC.
- [ ] **Step 4:** `npx tsc --noEmit | grep -E 'TS2304|financeiro'`; `npm run build`; `npx vitest run tests/unit/ui-padroes-antidrift.test.ts`. QA :5173 — abrir Financeiro › Serviços: parcela de bloco com fornecedor "30/60/90" mostra `+30d/+60d/+90d`; aba OCs idem para uma OC com prazo; parcela sem prazo mostra só a data.
- [ ] **Step 5: Commit** `git commit -m "feat(financeiro): rótulo +Ndias por parcela nas abas Serviços e OCs"`

---

## Self-Review

**Spec coverage:** geração pelo prazo em `servicos_financeiro` → T2; netting/preservação de pagas → T2 (guardas explícitas); `+Ndias` em Serviços → T3; retrofit `+Ndias` em OCs → T1 (persiste offset) + T3 (exibe). Marcar-pago/comprovante/data-pagamento → já existem, fora de escopo.

**Placeholder scan:** T1/T2 têm o método (dump+diff) e o delta exato com código; T3 tem arquivo:linha e o componente. Sem JSX linha-a-linha na render de OC (depende do estado real) mas com âncoras precisas — o executor localiza a célula de vencimento de OC.

**Type consistency:** `dias_offset int` idêntico em T1 (coluna `parcelas`), T2 (campo do jsonb de `servicos_financeiro`) e T3 (leitura front). `<OffsetTag dias>` idêntico nas duas abas.

**Riscos:** (a) diff-validação obrigatória das 2 funções grandes (T1/T2) — o maior risco é reescrever mais do que o delta; o diff antes/depois é o gate. (b) O ponto crítico de correção é a preservação de pagas + manuais em T2 — a condição `data_vencimento = v_base` como "não editado" é conservadora e o review deve confirmar que nenhuma parcela paga/manual é tocada. (c) alias de `empresas` no SELECT de `servicos_financeiro` pode não ser `e` — usar o real. (d) `text-[11px]` pode falhar o anti-drift — fallback `text-xs`.
