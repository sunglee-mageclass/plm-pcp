# OTB: desacoplar cards + orçamento de modelos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o OTB parar de criar cards no Planejamento ao confirmar; transformar o plano num alvo fixo e contar os cards ao vivo (realizado/total), com divergência sinalizada.

**Architecture:** Backend vira a fonte de verdade — uma RPC `otb_orcamento` (com helper `_otb_colecao_totais`) calcula total (do plano) × realizado (contagem de `modelos`) por coleção/subcoleção/nível-3. O trigger de sync bidirecional é removido; `confirmar` só marca verde. O front consome a RPC via um hook único em lista, diálogos de criação e sidebar.

**Tech Stack:** Postgres (Supabase, RLS, RPC SECURITY DEFINER wrapper+`_core`), React + Vite + TanStack Query, Tailwind.

## Global Constraints

- **Migrations**: aplicar com `psql "$(cat /tmp/dburl.txt)" -f <arquivo>`. Trecho destrutivo (DROP/DELETE) sempre dentro de `BEGIN; … COMMIT;` e idempotente (`IF EXISTS`/`OR REPLACE`).
- **Segurança RPC (invariante #9)**: todo `_core`/helper interno = `REVOKE EXECUTE ON FUNCTION public._xxx(...) FROM PUBLIC, anon, authenticated;`. Conferir com `has_function_privilege('anon','_xxx(args)','EXECUTE') = false`.
- **Módulo `otb`**: RPCs públicas gated por `tenant_module_enabled('otb')`.
- **Multi-tenant**: tudo filtra por `get_user_tenant_id()`; nada de vazamento cross-tenant.
- **Build gate**: antes de cada commit de front, `npx tsc --noEmit 2>&1 | grep -c 'error TS'` = 0 e `npm run build` verde. `vite build` NÃO roda tsc.
- **Timestamps de migration**: continuar após `20260720220000`. Este plano usa `20260721100000`–`20260721130000`.
- **Após backend novo**: regenerar `src/integrations/supabase/types.ts`.
- **Realizado** = `COUNT(modelos WHERE colecao_id = X)` — todos os cards vinculados, qualquer status.
- **Total** = plano fixo: PV = Σ `colecao_pv_itens.qtd_semanas`; Orçamento = Σ `colecao_semanas.qtd_planejada`.
- **Divergência oficial** (vermelho + bolinha sidebar) = `realizado > total` no nível **coleção**, só **confirmadas**. Sub-níveis estourados = **âmbar** (sem sidebar).

---

## File Structure

**Backend (novas migrations em `supabase/migrations/`):**
- `20260721100000_otb_drop_sync.sql` — dropa trigger+funcs de sync; limpeza única de blanks legados.
- `20260721110000_otb_confirmar_enxuto.sql` — `otb_confirmar`/`otb_confirmar_pv` só marcam verde.
- `20260721120000_otb_orcamento.sql` — `_otb_colecao_totais` + `_otb_orcamento_core` + wrapper `otb_orcamento` + REVOKEs.
- `20260721130000_sidebar_badges_otb_divergencia.sql` — `sidebar_badges` ganha `otb_divergencia`.

**Frontend:**
- `src/components/otb/orcamento.ts` (novo) — hook `useOrcamento()` + tipos + helpers de lookup + `<OrcamentoTag>`.
- `src/routes/_authenticated/otb.index.tsx` (mod) — lista: realizado/total + árvore âmbar.
- `src/routes/_authenticated/criacao.planejamento.tsx` (mod) — contadores no ModeloDialog e no BatchCardsDialog (campos Subcoleção+Linha + projeção); selecionáveis com R/T.
- `src/components/app-sidebar.tsx` (mod) — bolinha vermelha no item OTB; dot no ramo sem-subs.
- `src/integrations/supabase/types.ts` (regen).
- `CLAUDE.md` + memória (docs-keeper).

---

## Task 1: Migration — dropar sync bidirecional + limpar blanks legados

**Files:**
- Create: `supabase/migrations/20260721100000_otb_drop_sync.sql`

**Interfaces:**
- Produces: remove `trg_otb_sync_semana`, `fn_otb_sync_semana`, `fn_otb_dec_semana_on_delete`. Depois desta task, criar/apagar/reclassificar card NÃO altera mais `colecao_semanas`/`colecao_semana_categorias`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 20260721100000_otb_drop_sync.sql
-- Remove o sync bidirecional OTB↔cards e limpa os blanks legados (cards "vazios"
-- criados pelo antigo otb_confirmar). Depois disto o plano é ALVO FIXO.
BEGIN;

DROP TRIGGER IF EXISTS trg_otb_sync_semana ON public.modelos;
DROP FUNCTION IF EXISTS public.fn_otb_sync_semana() CASCADE;
DROP FUNCTION IF EXISTS public.fn_otb_dec_semana_on_delete() CASCADE;

-- Limpeza ÚNICA: apaga cards "sem conteúdo" vinculados a uma coleção (nome/estilista/
-- fotos/tecidos/preço/obs vazios, não lançado). Cobre os blanks legados dos dois fluxos
-- (Orçamento: têm categoria/subcol/semana; PV: têm linha/subcol/semana) — ambos sem conteúdo.
DELETE FROM public.modelos m
WHERE m.colecao_id IS NOT NULL
  AND m.status_planejamento IN ('em_planejamento','reprovado')
  AND COALESCE(m.nome,'') = '' AND m.estilista_id IS NULL
  AND m.preco_venda IS NULL AND m.data_lancamento IS NULL AND COALESCE(m.lancado,false) = false
  AND m.origem = 'interno' AND COALESCE(m.observacoes_gerais,'') = ''
  AND cardinality(COALESCE(m.fotos_modelo,'{}')) = 0
  AND cardinality(COALESCE(m.fotos_referencia,'{}')) = 0
  AND cardinality(COALESCE(m.tecidos_planejados,'{}')) = 0;

COMMIT;
```

- [ ] **Step 2: Aplicar a migration**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260721100000_otb_drop_sync.sql`
Expected: `BEGIN` … `DROP TRIGGER` … `DROP FUNCTION` … `DELETE <n>` … `COMMIT` (sem erro).

- [ ] **Step 3: Verificar que o trigger sumiu**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -tA -c "select count(*) from pg_trigger where tgname='trg_otb_sync_semana';"
```
Expected: `0`

- [ ] **Step 4: Verificar que criar um card NÃO mexe no plano**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -tA -c "
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub',(SELECT u.id FROM users u JOIN colecoes c ON c.tenant_id=u.tenant_id WHERE c.status='confirmada' LIMIT 1))::text, true);
WITH c AS (SELECT id, tenant_id, nome FROM colecoes WHERE status='confirmada' LIMIT 1),
     antes AS (SELECT COALESCE(sum(qtd_planejada),0) q FROM colecao_semanas cs JOIN c ON c.id=cs.colecao_id)
INSERT INTO modelos (tenant_id, colecao_id, colecao, status_planejamento, versao, nome, tecidos_planejados, fotos_modelo, fotos_referencia, observacoes_gerais)
SELECT tenant_id, id, nome, 'em_planejamento', 1, '', '{}','{}','{}','' FROM c;
SELECT COALESCE(sum(qtd_planejada),0) AS depois FROM colecao_semanas cs JOIN (SELECT id FROM colecoes WHERE status='confirmada' LIMIT 1) c ON c.id=cs.colecao_id;
ROLLBACK;"
```
Expected: o `depois` é igual ao total do plano antes do INSERT (o trigger não incrementou). Sem erro.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721100000_otb_drop_sync.sql
git commit -m "feat(otb): dropar sync bidirecional + limpar blanks legados"
```

---

## Task 2: Migration — `confirmar` só marca verde

**Files:**
- Create: `supabase/migrations/20260721110000_otb_confirmar_enxuto.sql`

**Interfaces:**
- Consumes: nada (independente da Task 1, mas aplicar depois).
- Produces: `otb_confirmar(uuid)` e `otb_confirmar_pv(uuid)` retornam `{confirmada:true}` e só setam `status='confirmada'`. Não criam nem apagam cards. Não usam `app.otb_reconciling`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 20260721110000_otb_confirmar_enxuto.sql
-- Confirmar deixa de criar/remover cards e de sincronizar. Só marca a coleção verde.
-- (Os blanks legados já foram limpos na 20260721100000; cards manuais sobrevivem.)
CREATE OR REPLACE FUNCTION public.otb_confirmar(_colecao_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id();
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  update colecoes set status='confirmada' where id=_colecao_id and tenant_id=v_tenant;
  if not found then raise exception 'Coleção não encontrada'; end if;
  return jsonb_build_object('confirmada', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.otb_confirmar_pv(_colecao_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id();
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  update colecoes set status='confirmada'
   where id=_colecao_id and tenant_id=v_tenant and tipo='poder_venda';
  if not found then raise exception 'Coleção (poder de venda) não encontrada'; end if;
  return jsonb_build_object('confirmada', true);
end;
$function$;
```

- [ ] **Step 2: Aplicar**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260721110000_otb_confirmar_enxuto.sql`
Expected: `CREATE FUNCTION` × 2, sem erro.

- [ ] **Step 3: Verificar que confirmar não cria cards**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -tA -c "
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub',(SELECT u.id FROM users u JOIN colecoes c ON c.tenant_id=u.tenant_id WHERE c.tipo='poder_venda' LIMIT 1))::text, true);
WITH c AS (SELECT id FROM colecoes WHERE tipo='poder_venda' LIMIT 1),
     antes AS (SELECT count(*) n FROM modelos m JOIN c ON c.id=m.colecao_id)
SELECT (SELECT n FROM antes) AS antes,
       (public.otb_confirmar_pv((SELECT id FROM c)))::text AS ret,
       (SELECT count(*) FROM modelos m JOIN c ON c.id=m.colecao_id) AS depois;
ROLLBACK;"
```
Expected: `antes == depois` (nenhum card criado); `ret` contém `"confirmada": true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260721110000_otb_confirmar_enxuto.sql
git commit -m "feat(otb): confirmar só marca verde (sem criar/remover cards)"
```

---

## Task 3: Migration — RPC `otb_orcamento` (total × realizado)

**Files:**
- Create: `supabase/migrations/20260721120000_otb_orcamento.sql`

**Interfaces:**
- Produces:
  - `_otb_colecao_totais(_tenant uuid)` → `TABLE(colecao_id uuid, nome text, tipo text, total int, realizado int)` (só confirmadas). SSOT do nível coleção.
  - `_otb_orcamento_core(_tenant uuid, _colecao_id uuid)` → `jsonb` com `{colecoes[], subcolecoes[], niveis3[]}`.
  - `otb_orcamento(_colecao_id uuid default null)` → `jsonb` (wrapper gated). `_colecao_id` nulo = todas confirmadas.
  - Shape: `colecoes[].{colecao_id,nome,tipo,total,realizado}`; `subcolecoes[].{colecao_id,subcolecao,total,realizado}`; `niveis3[].{colecao_id,subcolecao,tipo3,ref_id,label,total,realizado}` (`tipo3` = `'linha'`|`'categoria'`).

- [ ] **Step 1: Escrever a migration**

```sql
-- 20260721120000_otb_orcamento.sql
-- Total (plano fixo) × realizado (contagem de cards) por coleção/subcoleção/nível-3.
CREATE OR REPLACE FUNCTION public._otb_colecao_totais(_tenant uuid)
 RETURNS TABLE(colecao_id uuid, nome text, tipo text, total int, realizado int)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cols AS (
    SELECT c.id, c.nome, COALESCE(c.tipo,'orcamento') AS tipo
    FROM colecoes c WHERE c.tenant_id = _tenant AND c.status = 'confirmada'
  )
  SELECT cols.id, cols.nome, cols.tipo,
    (CASE WHEN cols.tipo = 'poder_venda' THEN
       COALESCE((SELECT sum((e.value)::int)
                 FROM colecao_pv_itens it
                 CROSS JOIN LATERAL jsonb_each_text(it.qtd_semanas) e(key,value)
                 WHERE it.colecao_id = cols.id AND e.value ~ '^[0-9]+$'),0)
     ELSE
       COALESCE((SELECT sum(cs.qtd_planejada) FROM colecao_semanas cs WHERE cs.colecao_id = cols.id),0)
     END)::int AS total,
    COALESCE((SELECT count(*) FROM modelos m WHERE m.colecao_id = cols.id AND m.tenant_id = _tenant),0)::int AS realizado
  FROM cols;
$function$;

CREATE OR REPLACE FUNCTION public._otb_orcamento_core(_tenant uuid, _colecao_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_res jsonb;
begin
  WITH cols AS (
    SELECT t.colecao_id, t.nome, t.tipo, t.total, t.realizado
    FROM public._otb_colecao_totais(_tenant) t
    WHERE _colecao_id IS NULL OR t.colecao_id = _colecao_id
  ),
  sc AS (
    SELECT c.colecao_id, c.tipo, s.id AS sub_id, s.nome AS sub_nome
    FROM cols c JOIN colecao_subcolecoes s ON s.colecao_id = c.colecao_id
  ),
  sub AS (
    SELECT sc.colecao_id, sc.sub_nome,
      (CASE WHEN sc.tipo='poder_venda' THEN
         COALESCE((SELECT sum((e.value)::int) FROM colecao_pv_itens it
                   CROSS JOIN LATERAL jsonb_each_text(it.qtd_semanas) e(key,value)
                   WHERE it.subcolecao_id = sc.sub_id AND e.value ~ '^[0-9]+$'),0)
       ELSE
         COALESCE((SELECT sum(cs.qtd_planejada) FROM colecao_semanas cs WHERE cs.subcolecao_id = sc.sub_id),0)
       END)::int AS total,
      COALESCE((SELECT count(*) FROM modelos m WHERE m.colecao_id = sc.colecao_id
                AND m.tenant_id = _tenant AND m.subcolecao = sc.sub_nome),0)::int AS realizado
    FROM sc
  ),
  n3 AS (
    -- PV: nível 3 = linha
    SELECT sc.colecao_id, sc.sub_nome, 'linha'::text AS tipo3, it.linha_id AS ref_id, l.nome AS label,
      COALESCE((SELECT sum((e.value)::int) FROM jsonb_each_text(it.qtd_semanas) e(key,value)
                WHERE e.value ~ '^[0-9]+$'),0)::int AS total
    FROM sc JOIN colecao_pv_itens it ON it.subcolecao_id = sc.sub_id
    LEFT JOIN linhas l ON l.id = it.linha_id
    WHERE sc.tipo = 'poder_venda'
    UNION ALL
    -- Orçamento: nível 3 = categoria
    SELECT sc.colecao_id, sc.sub_nome, 'categoria'::text, csc.categoria_id, cat.nome,
      sum(csc.qtd)::int
    FROM sc JOIN colecao_semana_categorias csc ON csc.subcolecao_id = sc.sub_id
    LEFT JOIN categorias_produto cat ON cat.id = csc.categoria_id
    WHERE sc.tipo <> 'poder_venda'
    GROUP BY sc.colecao_id, sc.sub_nome, csc.categoria_id, cat.nome
  ),
  n3r AS (
    SELECT n3.*, COALESCE((SELECT count(*) FROM modelos m
      WHERE m.colecao_id = n3.colecao_id AND m.tenant_id = _tenant AND m.subcolecao = n3.sub_nome
        AND ((n3.tipo3='linha' AND m.linha_id = n3.ref_id)
          OR (n3.tipo3='categoria' AND m.categoria_principal_id = n3.ref_id))),0)::int AS realizado
    FROM n3
  )
  SELECT jsonb_build_object(
    'colecoes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'colecao_id',colecao_id,'nome',nome,'tipo',tipo,'total',total,'realizado',realizado)) FROM cols),'[]'::jsonb),
    'subcolecoes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'colecao_id',colecao_id,'subcolecao',sub_nome,'total',total,'realizado',realizado)) FROM sub),'[]'::jsonb),
    'niveis3', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'colecao_id',colecao_id,'subcolecao',sub_nome,'tipo3',tipo3,'ref_id',ref_id,'label',label,
        'total',total,'realizado',realizado)) FROM n3r),'[]'::jsonb)
  ) INTO v_res;
  return v_res;
end;
$function$;

CREATE OR REPLACE FUNCTION public.otb_orcamento(_colecao_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id();
begin
  if not public.tenant_module_enabled('otb') then
    return jsonb_build_object('colecoes','[]'::jsonb,'subcolecoes','[]'::jsonb,'niveis3','[]'::jsonb);
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  return public._otb_orcamento_core(v_tenant, _colecao_id);
end;
$function$;

REVOKE EXECUTE ON FUNCTION public._otb_colecao_totais(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._otb_orcamento_core(uuid, uuid) FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 2: Aplicar**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260721120000_otb_orcamento.sql`
Expected: 3× `CREATE FUNCTION` + 2× `REVOKE`, sem erro.

- [ ] **Step 3: Verificar REVOKE (invariante #9)**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -tA -c "
select has_function_privilege('anon','public._otb_colecao_totais(uuid)','EXECUTE'),
       has_function_privilege('authenticated','public._otb_orcamento_core(uuid,uuid)','EXECUTE');"
```
Expected: `f|f`

- [ ] **Step 4: Verificar os números contra o plano (total) e os cards (realizado)**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -tA -c "
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub',(SELECT u.id FROM users u JOIN colecoes c ON c.tenant_id=u.tenant_id WHERE c.status='confirmada' LIMIT 1))::text, true);
WITH r AS (SELECT public.otb_orcamento() j),
     one AS (SELECT (jsonb_array_elements((SELECT j FROM r)->'colecoes')) e)
SELECT e->>'nome' AS nome, e->>'total' AS total_rpc, e->>'realizado' AS real_rpc,
       (SELECT count(*) FROM modelos m WHERE m.colecao_id = (e->>'colecao_id')::uuid) AS real_check
FROM one LIMIT 5;
ROLLBACK;"
```
Expected: para cada linha, `real_rpc == real_check`; `total_rpc` bate com o plano (>0 nas coleções com plano).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721120000_otb_orcamento.sql
git commit -m "feat(otb): RPC otb_orcamento (total do plano x realizado dos cards)"
```

---

## Task 4: Migration — `sidebar_badges.otb_divergencia`

**Files:**
- Create: `supabase/migrations/20260721130000_sidebar_badges_otb_divergencia.sql`

**Interfaces:**
- Consumes: `_otb_colecao_totais(uuid)` (Task 3).
- Produces: `sidebar_badges()` retorna também `otb_divergencia` (nº de coleções confirmadas com `realizado > total`, 0 se módulo off).

- [ ] **Step 1: Escrever a migration** (recria `sidebar_badges` = versão atual + bloco OTB)

```sql
-- 20260721130000_sidebar_badges_otb_divergencia.sql
CREATE OR REPLACE FUNCTION public.sidebar_badges()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_tz text; v_hoje date;
  v_prontos int; v_alertas int; v_oc_tec int; v_oc_avi int; v_oc_etq int; v_otb int := 0;
BEGIN
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RETURN jsonb_build_object('prontos_lancar',0,'alertas_tecido',0,'oc_tecido_atrasada',0,
                              'oc_aviamento_atrasada',0,'oc_etiqueta_atrasada',0,'otb_divergencia',0);
  END IF;

  SELECT NULLIF(btrim(timezone),'') INTO v_tz FROM public.tenant_config WHERE tenant_id = v_tenant;
  v_tz := COALESCE(v_tz,'America/Sao_Paulo');
  v_hoje := (now() AT TIME ZONE v_tz)::date;

  SELECT count(*) INTO v_prontos FROM public.modelos m
  WHERE m.tenant_id = v_tenant AND COALESCE(m.lancado,false) = false
    AND EXISTS (SELECT 1 FROM public.cad c WHERE c.modelo_id = m.id AND c.tenant_id = v_tenant
      AND public._cq_liberado(c.id)
      AND NOT EXISTS (SELECT 1 FROM public.producao_terceirizados pt
        WHERE pt.cad_id = c.id AND COALESCE(pt.interno,false) = false AND COALESCE(pt.aprovado,false) = false));

  SELECT count(*) INTO v_alertas FROM public.ocs_tecido_itens it
  JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id AND oc.tenant_id = v_tenant
  WHERE it.cq_alerta_status IN ('alertado','troca_pendente');

  SELECT count(*) INTO v_oc_tec FROM public.ocs_tecido oc
  WHERE oc.tenant_id = v_tenant AND oc.status = 'encomendado' AND COALESCE(oc.is_rolo,false) = false
    AND oc.data_prevista_entrega IS NOT NULL AND oc.data_prevista_entrega < v_hoje;

  SELECT count(*) INTO v_oc_avi FROM public.ocs_aviamento oc
  WHERE oc.tenant_id = v_tenant AND oc.status = 'encomendado'
    AND oc.data_prevista_entrega IS NOT NULL AND oc.data_prevista_entrega < v_hoje;

  SELECT count(*) INTO v_oc_etq FROM public.ocs_etiqueta oc
  WHERE oc.tenant_id = v_tenant AND oc.status = 'encomendado'
    AND oc.data_prevista_entrega IS NOT NULL AND oc.data_prevista_entrega < v_hoje;

  -- OTB: coleções confirmadas onde os cards passaram do plano (só se o módulo está on).
  IF public.tenant_module_enabled('otb') THEN
    SELECT count(*) INTO v_otb FROM public._otb_colecao_totais(v_tenant) t WHERE t.realizado > t.total;
  END IF;

  RETURN jsonb_build_object(
    'prontos_lancar', COALESCE(v_prontos,0), 'alertas_tecido', COALESCE(v_alertas,0),
    'oc_tecido_atrasada', COALESCE(v_oc_tec,0), 'oc_aviamento_atrasada', COALESCE(v_oc_avi,0),
    'oc_etiqueta_atrasada', COALESCE(v_oc_etq,0), 'otb_divergencia', COALESCE(v_otb,0));
END $function$;
```

- [ ] **Step 2: Aplicar**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260721130000_sidebar_badges_otb_divergencia.sql`
Expected: `CREATE FUNCTION`, sem erro.

- [ ] **Step 3: Verificar a chave nova**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -tA -c "
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub',(SELECT u.id FROM users u JOIN colecoes c ON c.tenant_id=u.tenant_id WHERE c.status='confirmada' LIMIT 1))::text, true);
SELECT public.sidebar_badges() ? 'otb_divergencia', (public.sidebar_badges()->>'otb_divergencia');
ROLLBACK;"
```
Expected: `t|<n>` (n ≥ 0).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260721130000_sidebar_badges_otb_divergencia.sql
git commit -m "feat(otb): sidebar_badges expõe otb_divergencia"
```

---

## Task 5: Regenerar types.ts

**Files:**
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Regenerar** (mesmo método usado no projeto)

Run: `npx supabase gen types typescript --db-url "$(cat /tmp/dburl.txt)" --schema public > src/integrations/supabase/types.ts`
Expected: arquivo atualizado; `otb_orcamento` e `sidebar_badges` aparecem em `Functions`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -c 'error TS'`
Expected: `0`

- [ ] **Step 3: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore: regen types.ts (otb_orcamento, sidebar_badges)"
```

---

## Task 6: Hook `useOrcamento()` + tags

**Files:**
- Create: `src/components/otb/orcamento.ts`

**Interfaces:**
- Produces:
  - `useOrcamento()` → `{ isLoading, colecao(id): Bucket|null, subcolecao(colId, nome): Bucket|null, nivel3(colId, nome, refId): Bucket|null, temDivergencia(colId): boolean }`.
  - `type Bucket = { total: number; realizado: number; over: boolean }` (`over = realizado > total`).
  - `<OrcamentoTag total realizado />` → `<span>` com `realizado/total`, âmbar quando `over` (usado como sufixo).
  - queryKey `["otb-orcamento"]`.

- [ ] **Step 1: Escrever o módulo**

```tsx
// src/components/otb/orcamento.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Bucket = { total: number; realizado: number; over: boolean };
type Col = { colecao_id: string; nome: string; tipo: string; total: number; realizado: number };
type Sub = { colecao_id: string; subcolecao: string; total: number; realizado: number };
type N3 = { colecao_id: string; subcolecao: string; tipo3: string; ref_id: string | null; label: string | null; total: number; realizado: number };

const mk = (total: number, realizado: number): Bucket => ({ total, realizado, over: realizado > total });

export function useOrcamento() {
  const { data, isLoading } = useQuery({
    queryKey: ["otb-orcamento"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("otb_orcamento" as any, {});
      if (error) throw error;
      return (data ?? { colecoes: [], subcolecoes: [], niveis3: [] }) as { colecoes: Col[]; subcolecoes: Sub[]; niveis3: N3[] };
    },
    staleTime: 30_000,
  });
  const colMap = new Map<string, Col>((data?.colecoes ?? []).map((c) => [c.colecao_id, c]));
  const subMap = new Map<string, Sub>((data?.subcolecoes ?? []).map((s) => [`${s.colecao_id}|${s.subcolecao}`, s]));
  const n3Map = new Map<string, N3>((data?.niveis3 ?? []).map((n) => [`${n.colecao_id}|${n.subcolecao}|${n.ref_id ?? ""}`, n]));

  return {
    isLoading,
    colecao: (id?: string | null): Bucket | null => { const c = id ? colMap.get(id) : undefined; return c ? mk(c.total, c.realizado) : null; },
    subcolecao: (colId?: string | null, nome?: string | null): Bucket | null => {
      if (!colId || !nome) return null; const s = subMap.get(`${colId}|${nome}`); return s ? mk(s.total, s.realizado) : null;
    },
    nivel3: (colId?: string | null, nome?: string | null, refId?: string | null): Bucket | null => {
      if (!colId || !nome || !refId) return null; const n = n3Map.get(`${colId}|${nome}|${refId}`); return n ? mk(n.total, n.realizado) : null;
    },
    temDivergencia: (colId?: string | null): boolean => { const c = colId ? colMap.get(colId) : undefined; return !!c && c.realizado > c.total; },
    subcolecoesDe: (colId: string): Sub[] => (data?.subcolecoes ?? []).filter((s) => s.colecao_id === colId),
    niveis3De: (colId: string, nome: string): N3[] => (data?.niveis3 ?? []).filter((n) => n.colecao_id === colId && n.subcolecao === nome),
  };
}

export function OrcamentoTag({ total, realizado, className = "" }: { total: number; realizado: number; className?: string }) {
  const over = realizado > total;
  return <span className={`tabular-nums ${over ? "text-amber-600 font-semibold" : "text-muted-foreground"} ${className}`}>{realizado}/{total}</span>;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "orcamento.ts" | head; npx tsc --noEmit 2>&1 | grep -c 'error TS'`
Expected: `0` erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/otb/orcamento.ts
git commit -m "feat(otb): hook useOrcamento + OrcamentoTag"
```

---

## Task 7: Lista do OTB — realizado/total + vermelho de divergência

**Files:**
- Modify: `src/routes/_authenticated/otb.index.tsx` (linhas ~204 e ~251-255)

**Interfaces:**
- Consumes: `useOrcamento()` (Task 6).

- [ ] **Step 1: Importar o hook** (no topo do arquivo, junto aos outros imports de `@/components/otb/...`)

```tsx
import { useOrcamento } from "@/components/otb/orcamento";
```

- [ ] **Step 2: Instanciar o hook** (perto das outras chamadas de hook no componente da rota, ex.: após `const qc = useQueryClient();`)

```tsx
const orc = useOrcamento();
```

- [ ] **Step 3: Trocar o rodapé "planejados"** (substituir o bloco atual das linhas ~251-255)

De:
```tsx
                <div className="mt-1">
                  <span className="text-xs text-muted-foreground tabular-nums" title="Modelos em status planejado / quantidade definida no OTB">
                    {st.definido > 0 ? `${st.planejados}/${st.definido} planejados` : `${st.planejados} ${st.planejados === 1 ? "planejado" : "planejados"}`}
                  </span>
                </div>
```
Para:
```tsx
                {(() => {
                  const ob = orc.colecao(c.id); // só confirmadas retornam bucket
                  if (!ob) return null;
                  const over = ob.realizado > ob.total;
                  return (
                    <div className="mt-1">
                      <span className={`text-xs tabular-nums ${over ? "text-red-600 font-semibold" : "text-muted-foreground"}`}
                        title="Cards criados no Planejamento / total do plano">
                        {ob.realizado}/{ob.total} modelos{over ? " · divergência" : ""}
                      </span>
                    </div>
                  );
                })()}
```

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -c 'error TS' && npm run build 2>&1 | tail -2`
Expected: `0` erros; build `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/otb.index.tsx
git commit -m "feat(otb): lista mostra realizado/total + vermelho de divergência"
```

---

## Task 8: Card OTB — árvore subcoleção→nível-3 com âmbar

**Files:**
- Modify: `src/routes/_authenticated/otb.index.tsx` (dentro do `<button>` do card, após o rodapé da Task 7)

**Interfaces:**
- Consumes: `useOrcamento()` (`subcolecoesDe`, `niveis3De`).

- [ ] **Step 1: Adicionar a árvore** (logo após o bloco inserido na Task 7, ainda dentro do `<button>`)

```tsx
                {(() => {
                  const subs = orc.subcolecoesDe(c.id);
                  if (!subs.length) return null;
                  return (
                    <div className="mt-1 space-y-0.5 border-t pt-1">
                      {subs.map((s) => {
                        const sover = s.realizado > s.total;
                        const n3 = orc.niveis3De(c.id, s.subcolecao);
                        return (
                          <div key={s.subcolecao} className="text-[11px]">
                            <div className="flex items-center justify-between">
                              <span className="truncate">{s.subcolecao}</span>
                              <span className={`tabular-nums ${sover ? "text-amber-600 font-semibold" : "text-muted-foreground"}`}>{s.realizado}/{s.total}</span>
                            </div>
                            {n3.map((n) => {
                              const nover = n.realizado > n.total;
                              return (
                                <div key={`${n.tipo3}-${n.ref_id}`} className="flex items-center justify-between pl-3 text-muted-foreground/80">
                                  <span className="truncate">{n.label ?? "—"}</span>
                                  <span className={`tabular-nums ${nover ? "text-amber-600 font-semibold" : ""}`}>{n.realizado}/{n.total}</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
```

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -c 'error TS' && npm run build 2>&1 | tail -2`
Expected: `0` erros; build `✓`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/otb.index.tsx
git commit -m "feat(otb): card expande subcoleção/linha com aviso âmbar"
```

---

## Task 9: Contadores no "Novo Modelo"

**Files:**
- Modify: `src/routes/_authenticated/criacao.planejamento.tsx` (dentro do `ModeloDialog`, seção "Coleção", ~linhas 1321-1367)

**Interfaces:**
- Consumes: `useOrcamento()`.

- [ ] **Step 1: Importar + instanciar** dentro de `ModeloDialog` (perto de `const otbOn = isModuleEnabled("otb");`)

```tsx
// no topo do arquivo (imports):
import { useOrcamento, OrcamentoTag } from "@/components/otb/orcamento";
// dentro de ModeloDialog:
const orc = useOrcamento();
```

- [ ] **Step 2: Adicionar a tira de contadores** logo abaixo do bloco de selects de Coleção/Subcoleção/Linha (dentro da seção "Coleção", antes de fechar a seção)

```tsx
{otbOn && draft.colecao_id && (() => {
  const cb = orc.colecao(draft.colecao_id);
  if (!cb) return null; // coleção não confirmada → sem orçamento
  const sb = orc.subcolecao(draft.colecao_id, draft.subcolecao);
  // 3º nível: linha (PV) ou categoria (Orçamento) — usa o que estiver setado
  const ref = draft.linha_id ?? draft.categoria_principal_id;
  const nb = orc.nivel3(draft.colecao_id, draft.subcolecao, ref);
  return (
    <div className="col-span-full flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted/40 px-2 py-1 text-xs">
      <span className="text-muted-foreground">Orçamento:</span>
      <span>{colecoes.find((c) => c.id === draft.colecao_id)?.nome ?? "coleção"} <OrcamentoTag total={cb.total} realizado={cb.realizado} /></span>
      {sb && <span>· {draft.subcolecao} <OrcamentoTag total={sb.total} realizado={sb.realizado} /></span>}
      {nb && <span>· <OrcamentoTag total={nb.total} realizado={nb.realizado} /></span>}
    </div>
  );
})()}
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -c 'error TS' && npm run build 2>&1 | tail -2`
Expected: `0`; build `✓`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/criacao.planejamento.tsx
git commit -m "feat(planejamento): contadores de orçamento no Novo Modelo"
```

---

## Task 10: "Novos Cards" — campos Subcoleção+Linha + projeção

**Files:**
- Modify: `src/routes/_authenticated/criacao.planejamento.tsx` (`BatchCardsDialog`, ~linhas 1553-1793)

**Interfaces:**
- Consumes: `useOrcamento()`.
- Produces: cada card do lote grava `subcolecao` e `linha_id` (novos campos de lote).

- [ ] **Step 1: Novos estados** (junto aos outros `useState` do `BatchCardsDialog`)

```tsx
const [subcolecao, setSubcolecao] = useState("");
const [linhaId, setLinhaId] = useState<string | null>(null);
const orc = useOrcamento();
```

Também: garantir que `BatchCardsDialog` recebe `linhas: LinhaOpt[]` e a lista de subcoleções da coleção. Se não recebe `linhas`, adicionar à assinatura e passar na chamada (`<BatchCardsDialog ... linhas={linhas} />`). Para subcoleções, carregar por query:

```tsx
const { data: subOpts = [] } = useQuery({
  queryKey: ["batch-subcolecoes", colecaoId],
  enabled: otbOn && !!colecaoId,
  queryFn: async () => (await supabase.from("colecao_subcolecoes").select("nome").eq("colecao_id", colecaoId!).order("ordem")).data?.map((r: any) => r.nome as string) ?? [],
});
```
(`otbOn` já existe no escopo do arquivo; se não no dialog, passar via prop.)

- [ ] **Step 2: Campos no formulário** (junto aos campos compartilhados Coleção/Semana/Mês/Ano, ~linhas 1672-1713) — só quando `otbOn`:

```tsx
{otbOn && (
  <div className="grid gap-1">
    <Label className="text-xs">Subcoleção</Label>
    <Select value={subcolecao || "__none__"} onValueChange={(v) => setSubcolecao(v === "__none__" ? "" : v)} disabled={!colecaoId}>
      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">—</SelectItem>
        {subOpts.map((s) => { const b = orc.subcolecao(colecaoId, s); return (
          <SelectItem key={s} value={s}>{s}{b ? ` · ${b.realizado}/${b.total}${b.over ? " ⚠" : ""}` : ""}</SelectItem>
        ); })}
      </SelectContent>
    </Select>
  </div>
)}
{otbOn && (
  <div className="grid gap-1">
    <Label className="text-xs">Linha</Label>
    <Select value={linhaId ?? "__none__"} onValueChange={(v) => setLinhaId(v === "__none__" ? null : v)}>
      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">—</SelectItem>
        {linhas.map((l) => { const b = orc.nivel3(colecaoId, subcolecao, l.id); return (
          <SelectItem key={l.id} value={l.id}>{l.nome}{b ? ` · ${b.realizado}/${b.total}${b.over ? " ⚠" : ""}` : ""}</SelectItem>
        ); })}
      </SelectContent>
    </Select>
  </div>
)}
```

- [ ] **Step 3: Gravar os campos no insert** (no `create` mutation, dentro do `payloads.push({...})`)

Adicionar ao objeto empurrado:
```tsx
          subcolecao,
          linha_id: linhaId,
```

- [ ] **Step 4: Resumo projetado** (abaixo do "total de cards criados")

```tsx
{otbOn && colecaoId && (() => {
  const cb = orc.colecao(colecaoId);
  if (!cb) return null;
  const sb = subcolecao ? orc.subcolecao(colecaoId, subcolecao) : null;
  const nb = (linhaId && subcolecao) ? orc.nivel3(colecaoId, subcolecao, linhaId) : null;
  const proj = (b: { total: number; realizado: number } | null) => b ? `${b.realizado + total}/${b.total}` : null;
  return (
    <p className="text-xs text-muted-foreground">
      Com esse planejamento: <b>{proj(cb)}</b> nesta coleção
      {sb && <> · <b>{proj(sb)}</b> nesta subcoleção</>}
      {nb && <> · <b>{proj(nb)}</b> nesta linha</>}
    </p>
  );
})()}
```
(`total` já é a soma das quantidades das linhas de categoria, existente no dialog.)

- [ ] **Step 5: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -c 'error TS' && npm run build 2>&1 | tail -2`
Expected: `0`; build `✓`.

- [ ] **Step 6: Commit**

```bash
git add src/routes/_authenticated/criacao.planejamento.tsx
git commit -m "feat(planejamento): Novos Cards com subcoleção+linha e projeção de orçamento"
```

---

## Task 11: Sidebar — bolinha vermelha no OTB

**Files:**
- Modify: `src/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: `sidebar_badges().otb_divergencia` (Task 4).

- [ ] **Step 1: Mapear o novo contador** (no objeto `countFor`, junto às outras chaves)

```tsx
  otb_divergencia: Number(badges?.otb_divergencia ?? 0),
```

- [ ] **Step 2: Cor** (no `BADGE_CLS`)

```tsx
  otb_divergencia: "bg-red-500 text-white",
```

- [ ] **Step 3: Dot no item OTB (ramo SEM subitens)** — no `renderItem`, no bloco `if (item.subs.length === 0)`, tornar o link `relative` e acrescentar o dot quando o item é o OTB e há divergência:

De:
```tsx
        <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
          <Link to={item.url}>
            <item.icon className="h-4 w-4" />
            <span>{item.title}</span>
          </Link>
        </SidebarMenuButton>
```
Para:
```tsx
        <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
          <Link to={item.url} className="relative">
            <item.icon className="h-4 w-4" />
            <span>{item.title}</span>
            {item.url === "/otb" && (countFor.otb_divergencia ?? 0) > 0 && (
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" title="Coleção(ões) com divergência" />
            )}
          </Link>
        </SidebarMenuButton>
```

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -c 'error TS' && npm run build 2>&1 | tail -2`
Expected: `0`; build `✓`.

- [ ] **Step 5: Commit**

```bash
git add src/components/app-sidebar.tsx
git commit -m "feat(sidebar): bolinha vermelha no OTB quando há divergência"
```

---

## Task 12: Invalidação + docs

**Files:**
- Modify: `src/routes/_authenticated/criacao.planejamento.tsx` (invalidar `["otb-orcamento"]` ao criar/editar/excluir card)
- Modify: `CLAUDE.md` (bloco OTB)
- Modify: memória (`docs-keeper`)

- [ ] **Step 1: Invalidar o orçamento quando cards mudam** — nos `onSuccess` das mutations que criam/editam/excluem `modelos` no Planejamento (ex.: `save`, `create` do batch, exclusão), acrescentar:

```tsx
qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
```
(garante que os contadores e a lista refletem o novo realizado.)

- [ ] **Step 2: Atualizar `CLAUDE.md`** — no bloco do módulo `otb`, substituir a descrição do "sync bidirecional / fn_otb_sync_semana / auto-criação no confirmar" por: confirmar só marca verde; plano é alvo fixo; realizado = contagem viva via `otb_orcamento`; divergência (total da coleção) vira vermelho + bolinha no sidebar; sub-níveis avisam em âmbar. Remover a menção a `app.otb_reconciling`/`trg_otb_sync_semana` como mecanismo vigente.

- [ ] **Step 3: Atualizar a memória** — editar `project_otb_open_to_buy.md` e `project_otb_poder_de_venda.md` refletindo o desacoplamento; anotar a RPC `otb_orcamento` e o comportamento de divergência.

- [ ] **Step 4: Type-check + build final**

Run: `npx tsc --noEmit 2>&1 | grep -c 'error TS' && npm run build 2>&1 | tail -2`
Expected: `0`; build `✓`.

- [ ] **Step 5: Commit + push**

```bash
git add -A
git commit -m "chore(otb): invalidar orçamento ao mudar cards + docs"
git pull --rebase origin main && git push origin main
```

---

## Self-Review (feito pelo autor do plano)

- **Cobertura do spec:** §3 confirmar→Task 2 + limpeza Task 1; §4 total/realizado→Task 3; §5 lista/card→Tasks 7,8; §6 contadores→Tasks 9,10; §7 sidebar→Task 11; §8 RPC→Task 3; §9 migração→Task 1 (limpeza única); §10 escopo v1 coberto. Docs §11→Task 12.
- **Divergência de decisão registrada:** o spec dizia "confirmar apaga blanks"; o plano move a limpeza p/ migration única (Task 1) e deixa confirmar sem apagar (Task 2), evitando apagar cards vazios recém-criados num re-confirmar. Confirmar com o dono no handoff.
- **Consistência de tipos:** `Bucket {total,realizado,over}` e as funções `colecao/subcolecao/nivel3/temDivergencia` do hook (Task 6) são usadas com a mesma assinatura nas Tasks 7-11. Shape do `otb_orcamento` (colecoes/subcolecoes/niveis3) idêntico entre Task 3 (SQL) e Task 6 (hook).
- **Placeholders:** nenhum — SQL e TSX completos por passo.
