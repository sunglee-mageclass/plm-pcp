# Plan. Tecido — Fase 1a (fundação de dados: categoria de tecido) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir e devolver a **categoria de tecido** (intenção) por slot e a lista de **categorias (lanes) por subcoleção** na árvore do plano, sem quebrar nada existente — a fundação de dados do canvas por categoria (Fase 1b usa isso).

**Architecture:** Estende a árvore do plano (que é salva/lida por 2 RPCs `_core` DEFINER, save = delete+reinsert wholesale). Adiciona 1 coluna nullable no slot + 1 tabela filha por subcoleção (RLS tenant-scoped + `set_tenant_id_trg`, padrão do projeto), e atualiza os 2 `_core` para gravar/devolver os campos novos. Tudo backward-compatible (front atual ignora campos novos; coluna null).

**Tech Stack:** Postgres (Supabase, RLS) · migration via `psql "$(cat /tmp/dburl.txt)" -f` · TypeScript (types do front via `as any`).

## Global Constraints

- Migration em `supabase/migrations/`, aplicada com `psql "$(cat /tmp/dburl.txt)" -f <arq>`; **envolver em `BEGIN; … COMMIT;`** e escrever **idempotente** (`IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`/`CREATE OR REPLACE`/`DROP … IF EXISTS`).
- **Não reimplementar** `_estoque_tecido_core` nem tocar em parcelas/CQ. Aqui só mexe na árvore do plano.
- Ao alterar função existente, **diff-validar** com `pg_get_functiondef` antes/depois e rodar **teste transacional revertido** (`BEGIN; SELECT set_config('request.jwt.claims', …); …; ROLLBACK;`).
- Tabela nova segue o padrão das filhas do plano: 4 policies `tenant_select/insert/update/delete` com `tenant_id = get_user_tenant_id()` + trigger `set_tenant_id_trg BEFORE INSERT` (função `set_tenant_id()`).
- Front acessa RPCs/colunas novas com `as any` (types.ts do Supabase não é regenerado — débito conhecido).
- Categoria da lane = `categorias_tecido` (NÃO `categorias_produto`; o slot já tem `categoria_id` que é de produto — não reaproveitar).

---

### Task 1: Migration — coluna, tabela e cores atualizados

**Files:**
- Create: `supabase/migrations/20260728100000_plan_tecido_categoria_tecido.sql`

**Interfaces:**
- Produces (formato da árvore que o front vai usar na Fase 1b):
  - Slot ganha `categoria_tecido_id: uuid | null`.
  - Subcoleção ganha `categorias_tecido: string[]` (ids de `categorias_tecido`, ordenados).
  - `salvar_plan_tecido(_colecao_id, _arvore)` passa a gravar ambos; `plan_tecido_arvore(_colecao_id)` passa a devolvê-los.

- [ ] **Step 1: Escrever a migration completa**

Crie o arquivo com exatamente este conteúdo (as duas funções `_core` são o def atual **com os campos novos adicionados** — marcados em comentário):

```sql
-- Plan. Tecido Fase 1a: categoria de tecido (intenção) por slot + categorias por subcoleção.
-- Backward-compatible: coluna nullable, tabela nova vazia, cores estendidos (front antigo ignora).
BEGIN;

-- 1) categoria de tecido (intenção) por slot
ALTER TABLE plan_tecido_slots
  ADD COLUMN IF NOT EXISTS categoria_tecido_id uuid REFERENCES categorias_tecido(id);

-- 2) categorias (lanes) por subcoleção do plano — quais lanes existem, mesmo vazias
CREATE TABLE IF NOT EXISTS plan_tecido_subcolecao_categorias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid,
  subcolecao_id uuid NOT NULL REFERENCES plan_tecido_subcolecoes(id) ON DELETE CASCADE,
  categoria_id  uuid NOT NULL REFERENCES categorias_tecido(id),
  ordem         integer NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (subcolecao_id, categoria_id)
);
CREATE INDEX IF NOT EXISTS idx_ptsc_sub ON plan_tecido_subcolecao_categorias(subcolecao_id);

ALTER TABLE plan_tecido_subcolecao_categorias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON plan_tecido_subcolecao_categorias;
DROP POLICY IF EXISTS tenant_insert ON plan_tecido_subcolecao_categorias;
DROP POLICY IF EXISTS tenant_update ON plan_tecido_subcolecao_categorias;
DROP POLICY IF EXISTS tenant_delete ON plan_tecido_subcolecao_categorias;
CREATE POLICY tenant_select ON plan_tecido_subcolecao_categorias FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_insert ON plan_tecido_subcolecao_categorias FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_update ON plan_tecido_subcolecao_categorias FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_delete ON plan_tecido_subcolecao_categorias FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());

DROP TRIGGER IF EXISTS set_tenant_id_trg ON plan_tecido_subcolecao_categorias;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON plan_tecido_subcolecao_categorias
  FOR EACH ROW EXECUTE FUNCTION set_tenant_id();

-- 3) SALVAR core: grava categoria_tecido_id no slot + categorias_tecido por subcoleção
CREATE OR REPLACE FUNCTION public._salvar_plan_tecido_core(_colecao_id uuid, _arvore jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan uuid;
  v_sub jsonb; v_ln jsonb; v_slot jsonb; v_mat jsonb; v_var jsonb;
  v_sub_id uuid; v_ln_id uuid; v_slot_id uuid; v_mat_id uuid;
begin
  insert into plan_tecido (colecao_id) values (_colecao_id)
    on conflict (colecao_id) do update set updated_at = now()
    returning id into v_plan;
  delete from plan_tecido_subcolecoes where plan_id = v_plan;  -- cascateia p/ subcolecao_categorias
  for v_sub in select * from jsonb_array_elements(coalesce(_arvore->'subcolecoes','[]'::jsonb)) loop
    insert into plan_tecido_subcolecoes (plan_id, subcolecao_id, ordem)
      values (v_plan, nullif(v_sub->>'subcolecao_id','')::uuid, coalesce((v_sub->>'ordem')::int,0))
      returning id into v_sub_id;
    -- NOVO: categorias (lanes) da subcoleção
    insert into plan_tecido_subcolecao_categorias (subcolecao_id, categoria_id, ordem)
      select v_sub_id, nullif(t.val,'')::uuid, t.ord
      from jsonb_array_elements_text(coalesce(v_sub->'categorias_tecido','[]'::jsonb)) with ordinality as t(val, ord)
      where nullif(t.val,'') is not null
      on conflict (subcolecao_id, categoria_id) do nothing;
    for v_ln in select * from jsonb_array_elements(coalesce(v_sub->'linhas','[]'::jsonb)) loop
      insert into plan_tecido_linhas (sub_id, linha_id, categoria_id, ordem)
        values (v_sub_id, nullif(v_ln->>'linha_id','')::uuid, nullif(v_ln->>'categoria_id','')::uuid, coalesce((v_ln->>'ordem')::int,0))
        returning id into v_ln_id;
      for v_slot in select * from jsonb_array_elements(coalesce(v_ln->'slots','[]'::jsonb)) loop
        insert into plan_tecido_slots (linha_ref_id, modelo_id, slot_index, nome, custo_simulado,
          custo_terceirizados_previsto, custos_adicionais, preco_venda, categoria_id, usar_estoque, proporcoes,
          categoria_tecido_id)  -- NOVO
          values (v_ln_id, nullif(v_slot->>'modelo_id','')::uuid, coalesce((v_slot->>'slot_index')::int,0),
            v_slot->>'nome', v_slot->'custo_simulado',
            nullif(v_slot->>'custo_terceirizados_previsto','')::numeric,
            coalesce(v_slot->'custos_adicionais','[]'::jsonb),
            nullif(v_slot->>'preco_venda','')::numeric,
            nullif(v_slot->>'categoria_id','')::uuid,
            coalesce((v_slot->>'usar_estoque')::boolean, false),
            v_slot->'proporcoes',
            nullif(v_slot->>'categoria_tecido_id','')::uuid)  -- NOVO
          returning id into v_slot_id;
        for v_mat in select * from jsonb_array_elements(coalesce(v_slot->'materiais','[]'::jsonb)) loop
          insert into plan_tecido_materiais (slot_id, artigo_id, tipo, numero, consumo, loss_percent, ordem)
            values (v_slot_id, nullif(v_mat->>'artigo_id','')::uuid, coalesce(v_mat->>'tipo','tecido'),
              coalesce((v_mat->>'numero')::int,1), coalesce((v_mat->>'consumo')::numeric,0),
              coalesce((v_mat->>'loss_percent')::numeric,0), coalesce((v_mat->>'ordem')::int,0))
            returning id into v_mat_id;
          for v_var in select * from jsonb_array_elements(coalesce(v_mat->'variantes','[]'::jsonb)) loop
            insert into plan_tecido_variantes (material_id, variante_tecido_id, ordem, multiplicador, grades, grade_total)
              values (v_mat_id, nullif(v_var->>'variante_tecido_id','')::uuid, coalesce((v_var->>'ordem')::int,1),
                coalesce((v_var->>'multiplicador')::numeric,1), coalesce(v_var->'grades','{}'::jsonb),
                coalesce((v_var->>'grade_total')::int,0));
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
  return v_plan;
end $function$;

-- 4) ARVORE core: devolve categoria_tecido_id no slot + categorias_tecido na subcoleção
CREATE OR REPLACE FUNCTION public._plan_tecido_arvore_core(_colecao_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when p.id is null then null else jsonb_build_object(
    'plan_id', p.id, 'colecao_id', p.colecao_id,
    'subcolecoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'subcolecao_id', s.subcolecao_id, 'ordem', s.ordem,
        'categorias_tecido', coalesce((select jsonb_agg(sc.categoria_id order by sc.ordem, sc.created_at)
          from plan_tecido_subcolecao_categorias sc where sc.subcolecao_id = s.id), '[]'::jsonb),  -- NOVO
        'linhas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'linha_id', l.linha_id, 'categoria_id', l.categoria_id, 'ordem', l.ordem,
            'slots', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', sl.id, 'modelo_id', sl.modelo_id, 'ref', m.ref, 'nome', coalesce(m.nome, sl.nome),
                'thumb_path', coalesce((m.fotos_modelo)[1], m.desenho_tecnico_url, m.croqui_url),
                'categoria_id', sl.categoria_id, 'categoria_tecido_id', sl.categoria_tecido_id,  -- NOVO
                'usar_estoque', sl.usar_estoque,
                'proporcoes', coalesce(sl.proporcoes, m.proporcoes),
                'custo_simulado', sl.custo_simulado,
                'custo_terceirizados_previsto', sl.custo_terceirizados_previsto,
                'custos_adicionais', sl.custos_adicionais, 'preco_venda', sl.preco_venda,
                'materiais', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', mt.id, 'artigo_id', mt.artigo_id, 'artigo_nome', a.nome,
                    'unidade_medida', a.unidade_medida, 'rendimento', a.rendimento,
                    'preco_por_metro', a.preco_por_metro,
                    'tipo', mt.tipo, 'numero', mt.numero, 'consumo', mt.consumo,
                    'loss_percent', mt.loss_percent, 'ordem', mt.ordem,
                    'variantes', coalesce((
                      select jsonb_agg(jsonb_build_object(
                        'id', vv.id, 'variante_tecido_id', vv.variante_tecido_id,
                        'label', concat_ws(' - ', vt.nome_variante, cor.nome, ap.nome),
                        'cor_nome', cor.nome,
                        'ordem', vv.ordem, 'multiplicador', vv.multiplicador,
                        'grades', vv.grades, 'grade_total', vv.grade_total) order by vv.ordem)
                      from plan_tecido_variantes vv
                      left join variantes_tecido vt on vt.id = vv.variante_tecido_id
                      left join cores cor on cor.id = vt.cor_id
                      left join cores_apelido ap on ap.id = vt.cor_apelido_id
                      where vv.material_id = mt.id), '[]'::jsonb)) order by mt.ordem)
                  from plan_tecido_materiais mt
                  left join artigos a on a.id = mt.artigo_id
                  where mt.slot_id = sl.id), '[]'::jsonb)) order by sl.slot_index)
              from plan_tecido_slots sl
              left join modelos m on m.id = sl.modelo_id
              where sl.linha_ref_id = l.id), '[]'::jsonb)) order by l.ordem)
          from plan_tecido_linhas l where l.sub_id = s.id), '[]'::jsonb)) order by s.ordem)
      from plan_tecido_subcolecoes s where s.plan_id = p.id), '[]'::jsonb)
  ) end
  from (select id, colecao_id from plan_tecido where colecao_id = _colecao_id) p;
$function$;

COMMIT;
```

- [ ] **Step 2: Aplicar a migration**

Run:
```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260728100000_plan_tecido_categoria_tecido.sql
```
Expected: `BEGIN` … `CREATE TABLE`/`ALTER TABLE`/`CREATE FUNCTION` … `COMMIT` sem erro.

- [ ] **Step 3: Diff-validar as funções (assinatura preservada, campos novos presentes)**

Run:
```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
psql "$(cat /tmp/dburl.txt)" -Atc "select pg_get_functiondef('public._salvar_plan_tecido_core(uuid,jsonb)'::regprocedure) ~ 'categoria_tecido_id' as salvar_ok, pg_get_functiondef('public._plan_tecido_arvore_core(uuid)'::regprocedure) ~ 'categorias_tecido' as arvore_ok;"
```
Expected: `t|t` (ambos true).

- [ ] **Step 4: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
git add supabase/migrations/20260728100000_plan_tecido_categoria_tecido.sql
git commit -m "Plan. Tecido Fase 1a: categoria de tecido por slot + categorias por subcoleção (migration + cores)"
```

---

### Task 2: Teste transacional revertido (round-trip save→load)

**Files:**
- Create (temporário, não versionar): `/private/tmp/claude-501/-Users-sunglee-PLM---Cria--o/67bcc3b0-96de-4ce9-bf73-56da2c471768/scratchpad/test_cat_tecido.sql`

**Interfaces:**
- Consumes: `salvar_plan_tecido(_colecao_id, _arvore)` e `plan_tecido_arvore(_colecao_id)` (wrappers públicos dos cores).

- [ ] **Step 1: Escrever o teste transacional**

O teste escolhe (subquery) um tenant que tenha ≥1 coleção e ≥1 `categorias_tecido`, autentica como um usuário desse tenant, salva uma árvore mínima com `categoria_tecido_id` no slot + `categorias_tecido` na subcoleção, relê via `plan_tecido_arvore`, e falha (RAISE) se os campos não voltarem. Sempre `ROLLBACK`.

Crie o arquivo:
```sql
BEGIN;
DO $$
DECLARE
  v_tenant uuid; v_user uuid; v_col uuid; v_cat uuid; v_arv jsonb; v_out jsonb;
  v_sub jsonb; v_slot jsonb;
BEGIN
  -- escolhe um tenant com coleção e categoria de tecido
  SELECT c.tenant_id, c.id INTO v_tenant, v_col
    FROM colecoes c
    WHERE EXISTS (SELECT 1 FROM categorias_tecido k WHERE k.tenant_id = c.tenant_id)
      AND EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = c.tenant_id)
    LIMIT 1;
  IF v_col IS NULL THEN RAISE EXCEPTION 'sem dados de teste (coleção+categoria+user no mesmo tenant)'; END IF;
  SELECT id INTO v_cat FROM categorias_tecido WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_user FROM users WHERE tenant_id = v_tenant LIMIT 1;

  -- autentica como esse usuário (para set_tenant_id / RLS / get_user_tenant_id)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- árvore mínima: 1 subcoleção (com categoria) → 1 linha → 1 slot (com categoria_tecido_id)
  v_arv := jsonb_build_object('subcolecoes', jsonb_build_array(
    jsonb_build_object(
      'subcolecao_id', NULL, 'ordem', 0,
      'categorias_tecido', jsonb_build_array(v_cat::text),
      'linhas', jsonb_build_array(jsonb_build_object(
        'ordem', 0,
        'slots', jsonb_build_array(jsonb_build_object(
          'slot_index', 0, 'nome', 'TESTE', 'categoria_tecido_id', v_cat::text, 'materiais', '[]'::jsonb))
      ))
    )));

  PERFORM salvar_plan_tecido(v_col, v_arv);
  v_out := plan_tecido_arvore(v_col);

  v_sub := v_out->'subcolecoes'->0;
  v_slot := v_sub->'linhas'->0->'slots'->0;

  IF (v_sub->'categorias_tecido'->>0) IS DISTINCT FROM v_cat::text THEN
    RAISE EXCEPTION 'FALHOU: categorias_tecido da subcoleção não voltou (%).', v_sub->'categorias_tecido';
  END IF;
  IF (v_slot->>'categoria_tecido_id') IS DISTINCT FROM v_cat::text THEN
    RAISE EXCEPTION 'FALHOU: categoria_tecido_id do slot não voltou (%).', v_slot->>'categoria_tecido_id';
  END IF;
  RAISE NOTICE 'OK: round-trip categoria de tecido (sub + slot) preservou os ids.';
END $$;
ROLLBACK;
```

- [ ] **Step 2: Rodar o teste**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -f "/private/tmp/claude-501/-Users-sunglee-PLM---Cria--o/67bcc3b0-96de-4ce9-bf73-56da2c471768/scratchpad/test_cat_tecido.sql"
```
Expected: `NOTICE: OK: round-trip categoria de tecido (sub + slot) preservou os ids.` seguido de `ROLLBACK`. **Nenhuma linha alterada permanece** (rolled back). Se `FALHOU`, corrigir a migration (Task 1) e reaplicar (o `CREATE OR REPLACE` é idempotente).

---

### Task 3: Tipos do front (PtSlot / PtSub)

**Files:**
- Modify: `src/lib/plan-tecido/types.ts`

**Interfaces:**
- Produces: `PtSlot.categoria_tecido_id?: string | null`, `PtSub.categorias_tecido?: string[]` — consumidos pela Fase 1b.

- [ ] **Step 1: Ler o arquivo e localizar `PtSlot` e `PtSub`**

Run: abrir `src/lib/plan-tecido/types.ts` e localizar as interfaces/types `PtSlot` (nó de slot) e `PtSub` (nó de subcoleção).

- [ ] **Step 2: Adicionar os campos**

Em `PtSlot`, adicionar (junto dos demais campos opcionais do slot):
```ts
  categoria_tecido_id?: string | null;
```
Em `PtSub`, adicionar:
```ts
  categorias_tecido?: string[];
```
(Se `PtSub` não existir com esse nome, adicionar no tipo que representa o nó de subcoleção da árvore — o que tem `subcolecao_id`/`linhas`.)

- [ ] **Step 3: Type-check**

Run:
```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npx tsc --noEmit 2>&1 | grep -E "types\.ts|TS2" | head
```
Expected: nenhuma saída (sem erros novos introduzidos por essa mudança).

- [ ] **Step 4: Build**

Run:
```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
```
Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
git add src/lib/plan-tecido/types.ts
git commit -m "Plan. Tecido Fase 1a: tipos PtSlot.categoria_tecido_id + PtSub.categorias_tecido"
```

---

## Self-review

- **Cobertura da spec (§4 modelo de dados):** `categoria_tecido_id` no slot ✔ (Task 1); `plan_tecido_subcolecao_categorias` com RLS+trigger+índice ✔ (Task 1); `salvar`/`arvore` estendidos ✔ (Task 1); tipos do front ✔ (Task 3); teste round-trip ✔ (Task 2). Sem `categoria_forro_id`/papel forro (C3) ✔. Não usa `categoria_id` (produto) ✔.
- **Placeholders:** nenhum — SQL e TS completos.
- **Consistência de tipos:** o front lê `categoria_tecido_id` (slot) e `categorias_tecido` (sub) exatamente como o `arvore` core devolve, e envia com as mesmas chaves no `salvar`.
- **Invariantes:** save wholesale (delete+reinsert) — sem preocupação de diff por id aqui; RLS/trigger no padrão das filhas do plano; funções DEFINER com `search_path public`; nada toca estoque/parcelas/CQ.

## Próximo (fora deste plano)
**Fase 1b — UI do canvas** (plano próprio, após 1a landar): `PlanTecidoSheet` → `w-screen` + `view`; `SubcolecaoList`/`CanvasSubcolecao`; lanes por categoria + chips + seleção/aplicar/"+categoria"; Resumo escopado (a comprar sem duplicar forro, pendências, PV gated); breadcrumb clicável; Salvar/dirty. Consome `PtSlot.categoria_tecido_id` e `PtSub.categorias_tecido` desta fase.
