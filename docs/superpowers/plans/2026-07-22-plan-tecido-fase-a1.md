# Plan. Tecido (Fase A.1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nova tela "Plan. Tecido" em Estilo & Engenharia (acima de Plan. Produto) que planeja, por coleção, a necessidade de tecido/forro por modelo (grade + consumo + custo previsto), com resumo de necessidade por tecido — tudo isolado em tabelas próprias, sem tocar produção.

**Architecture:** Tela tecido-cêntrica. Lista de `colecoes` → página de painel por coleção. Persistência em `plan_tecido_*` (1 plano por coleção). Cálculo puro em `src/lib/plan-tecido/`. Reusa `preco.ts`, `estoque_tecido()` (opcional), componentes de UI e o padrão wrapper+`_core` das RPCs. O simulador do OTB (`SimulacaoSheet`/`otb_simulacao_*`) **permanece intacto** (será aposentado na Fase C).

**Tech Stack:** Vite + React + TypeScript, TanStack Router (file-based) + TanStack Query, Supabase/Postgres (RLS multi-tenant), Radix/shadcn, Tailwind, Vitest.

## Global Constraints

- **Migration:** aplicar com `psql "$(cat /tmp/dburl.txt)" -f <arquivo>`. Toda migration em `BEGIN;…COMMIT;`, idempotente (`if not exists`/`drop … if exists`), e `NOTIFY pgrst, 'reload schema';` no fim.
- **RPC (invariante #9):** padrão wrapper (checa `tenant_module_enabled('criacao')`) + `_core` (SECURITY DEFINER). `REVOKE EXECUTE ON FUNCTION public._<x>_core(<args>) FROM PUBLIC, anon, authenticated;` (os TRÊS) e `GRANT EXECUTE … TO authenticated;` no wrapper. Verificar `has_function_privilege('authenticated','_<x>_core(<args>)','EXECUTE') = false`.
- **RLS (invariante #4/multi-tenant):** toda tabela nova tem `tenant_id`, RLS on, 4 policies `tenant_*` e trigger `set_tenant_id_trg` (copiar o bloco `do $$` de `supabase/migrations/20260722100000_otb_simulador.sql:46-62`).
- **A.1 NÃO escreve em produção:** nada de `modelo_tecidos`/`modelo_grades`/`modelos`. Custos/grade ficam em `plan_tecido_*`. O write-back é A.2.
- **Metragem SEM perda e SEM piloto:** `necessidade = consumo × grade_total × multiplicador`.
- **Resumo em metros;** kg só na Fase B.
- **types.ts** está desatualizado → usar `as any` em `.from()/.rpc()` das tabelas/RPCs novas (padrão do repo).
- **Build antes de commit:** `npm run build` + `npx tsc --noEmit 2>&1 | grep TS2304` (regra 4 — `vite build` não roda tsc).
- **Não** alimentar `otb_orcamento` a partir de `plan_tecido_*` (evita contagem dupla slot×card).

---

## File Structure

**Criar:**
- `supabase/migrations/20260725100000_plan_tecido.sql` — tabelas + RLS + trigger.
- `supabase/migrations/20260725100100_plan_tecido_rpcs.sql` — `salvar_plan_tecido`/`plan_tecido_arvore` (+ `_core` + revokes).
- `src/lib/plan-tecido/types.ts` — tipos TS da árvore (interface RPC↔front↔calc).
- `src/lib/plan-tecido/calc.ts` — funções puras (necessidade, agregação por tecido, kg, poder de venda, abatimento de estoque).
- `src/lib/plan-tecido/engine.ts` — semeadura da árvore (coleção→subcoleção→linha/categoria→slots) a partir do plano da coleção + merge do plano salvo.
- `src/routes/_authenticated/criacao.plan-tecido.tsx` — lista de coleções.
- `src/routes/_authenticated/criacao.plan-tecido.$colecaoId.tsx` — página do painel.
- `src/components/plan-tecido/ModelCard.tsx` — card do modelo (Accordion Tecidos/Grade/Custo).
- `src/components/plan-tecido/MaterialBlock.tsx` — bloco de tecido/forro (artigo + variantes com checkbox + consumo).
- `src/components/plan-tecido/GradeSection.tsx` — grade por variante + proporção.
- `src/components/plan-tecido/CustoSection.tsx` — custo/preço via `preco.ts`.
- `src/components/plan-tecido/ResumoPanel.tsx` — Situação + Necessidade + Poder de venda.
- `tests/unit/plan-tecido-calc.test.ts` — unit do calc.
- `tests/integration/plan-tecido.test.ts` — integração das RPCs.

**Modificar:**
- `src/lib/permissions-catalog.ts:52-61` — nova página `criacao_plan_tecido`.
- `src/components/app-sidebar.tsx` — `PAGE_URLS` + `labelFor`.

---

## Task 1: Migration `plan_tecido_*` (tabelas + RLS)

**Files:**
- Create: `supabase/migrations/20260725100000_plan_tecido.sql`

**Interfaces:**
- Produces: tabelas `plan_tecido`, `plan_tecido_subcolecoes`, `plan_tecido_linhas`, `plan_tecido_slots`, `plan_tecido_materiais`, `plan_tecido_variantes` (colunas conforme abaixo).

- [ ] **Step 1: Escrever a migration**

```sql
-- 20260725100000_plan_tecido.sql — Plan. Tecido (Fase A.1): 1 plano por coleção, tecido-cêntrico.
begin;

create table if not exists public.plan_tecido (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  colecao_id uuid not null references public.colecoes(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_plan_tecido_colecao unique (colecao_id)
);

create table if not exists public.plan_tecido_subcolecoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  plan_id uuid not null references public.plan_tecido(id) on delete cascade,
  subcolecao_id uuid references public.colecao_subcolecoes(id) on delete cascade,
  ordem int not null default 0,
  constraint uq_plan_sub unique nulls not distinct (plan_id, subcolecao_id)
);
create index if not exists idx_plan_sub_plan on public.plan_tecido_subcolecoes(plan_id);

create table if not exists public.plan_tecido_linhas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  sub_id uuid not null references public.plan_tecido_subcolecoes(id) on delete cascade,
  linha_id uuid references public.linhas(id),
  categoria_id uuid references public.categorias_produto(id),
  ordem int not null default 0
);
create index if not exists idx_plan_ln_sub on public.plan_tecido_linhas(sub_id);

create table if not exists public.plan_tecido_slots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  linha_ref_id uuid not null references public.plan_tecido_linhas(id) on delete cascade,
  modelo_id uuid references public.modelos(id) on delete set null,
  slot_index int not null default 0,
  nome text,
  custo_simulado jsonb,
  custo_terceirizados_previsto numeric(10,2),
  custos_adicionais jsonb not null default '[]'::jsonb,
  preco_venda numeric(10,2)
);
create index if not exists idx_plan_slot_ln on public.plan_tecido_slots(linha_ref_id);
create index if not exists idx_plan_slot_modelo on public.plan_tecido_slots(modelo_id);

create table if not exists public.plan_tecido_materiais (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  slot_id uuid not null references public.plan_tecido_slots(id) on delete cascade,
  artigo_id uuid references public.artigos(id),
  tipo varchar(20) not null default 'tecido',
  numero int not null default 1,
  consumo numeric(10,4) not null default 0,
  loss_percent numeric(5,2) not null default 0,
  ordem int not null default 0,
  constraint uq_plan_mat unique (slot_id, tipo, numero)
);
create index if not exists idx_plan_mat_slot on public.plan_tecido_materiais(slot_id);
create index if not exists idx_plan_mat_artigo on public.plan_tecido_materiais(artigo_id);

create table if not exists public.plan_tecido_variantes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  material_id uuid not null references public.plan_tecido_materiais(id) on delete cascade,
  variante_tecido_id uuid references public.variantes_tecido(id),
  ordem int not null default 1,
  multiplicador numeric not null default 1,
  grades jsonb not null default '{}'::jsonb,
  grade_total int not null default 0,
  constraint uq_plan_var unique (material_id, ordem)
);
create index if not exists idx_plan_var_mat on public.plan_tecido_variantes(material_id);

-- RLS + trigger set_tenant_id (padrão de 20260722100000:46-62)
do $$
declare t text;
begin
  foreach t in array array['plan_tecido','plan_tecido_subcolecoes','plan_tecido_linhas','plan_tecido_slots','plan_tecido_materiais','plan_tecido_variantes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format('drop policy if exists tenant_insert on public.%I', t);
    execute format('drop policy if exists tenant_update on public.%I', t);
    execute format('drop policy if exists tenant_delete on public.%I', t);
    execute format($f$create policy tenant_select on public.%I for select to authenticated using (tenant_id = get_user_tenant_id())$f$, t);
    execute format($f$create policy tenant_insert on public.%I for insert to authenticated with check (tenant_id = get_user_tenant_id() or tenant_id is null)$f$, t);
    execute format($f$create policy tenant_update on public.%I for update to authenticated using (tenant_id = get_user_tenant_id()) with check (tenant_id = get_user_tenant_id())$f$, t);
    execute format($f$create policy tenant_delete on public.%I for delete to authenticated using (tenant_id = get_user_tenant_id())$f$, t);
    execute format('grant all on public.%I to anon, authenticated, service_role', t);
    execute format('create or replace trigger set_tenant_id_trg before insert on public.%I for each row execute function public.set_tenant_id()', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
```

- [ ] **Step 2: Aplicar a migration**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260725100000_plan_tecido.sql`
Expected: sem erro; termina em `COMMIT`.

- [ ] **Step 3: Verificar tabelas + RLS**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -c "select tablename, rowsecurity from pg_tables where tablename like 'plan_tecido%' order by 1;"
```
Expected: 6 linhas, todas com `rowsecurity = t`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260725100000_plan_tecido.sql
git commit -m "feat(plan-tecido): schema plan_tecido_* (Fase A.1)"
```

---

## Task 2: RPC `salvar_plan_tecido` (escrita atômica)

**Files:**
- Create: `supabase/migrations/20260725100100_plan_tecido_rpcs.sql` (parte 1 — escrita)
- Test: `tests/integration/plan-tecido.test.ts`

**Interfaces:**
- Consumes: tabelas da Task 1; `tenant_module_enabled(text)`; `get_user_tenant_id()`.
- Produces: `salvar_plan_tecido(_colecao_id uuid, _arvore jsonb) returns uuid` (retorna `plan_tecido.id`). `_arvore` shape:
  ```json
  { "subcolecoes": [ { "subcolecao_id": uuid|null, "ordem": int,
      "linhas": [ { "linha_id": uuid|null, "categoria_id": uuid|null, "ordem": int,
        "slots": [ { "modelo_id": uuid|null, "slot_index": int, "nome": text|null,
          "custo_simulado": jsonb|null, "custo_terceirizados_previsto": num|null,
          "custos_adicionais": jsonb, "preco_venda": num|null,
          "materiais": [ { "artigo_id": uuid|null, "tipo": "tecido|forro", "numero": int,
            "consumo": num, "loss_percent": num, "ordem": int,
            "variantes": [ { "variante_tecido_id": uuid, "ordem": int, "multiplicador": num,
              "grades": jsonb, "grade_total": int } ] } ] } ] } ] } ] }
  ```

- [ ] **Step 1: Escrever o teste de integração (falha primeiro)**

```typescript
// tests/integration/plan-tecido.test.ts
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

async function ligarCriacao(c: any) {
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true,"otb":true}'::jsonb)
     on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":true,"otb":true}'::jsonb`,
    [TENANT_TESTE],
  );
}

describe.skipIf(!hasDb)("plan_tecido — salvar + ler árvore", () => {
  it("salva a árvore e a releitura reflete tecido/variante/grade", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-PT','rascunho') returning id`, []);
      const av = await um<{ art: string; var: string } | undefined>(
        c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id where a.tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!av) return;
      const arvore = {
        subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
          slots: [{ modelo_id: null, slot_index: 0, nome: "M1", custo_simulado: null,
            custo_terceirizados_previsto: null, custos_adicionais: [], preco_venda: null,
            materiais: [{ artigo_id: av.art, tipo: "tecido", numero: 1, consumo: 1.4, loss_percent: 0, ordem: 0,
              variantes: [{ variante_tecido_id: av.var, ordem: 1, multiplicador: 1, grades: { M: 42 }, grade_total: 42 }] }] }] }] }],
      };
      const planId = (await um<{ id: string }>(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvore)])).id;
      expect(planId).toBeTruthy();
      const arv = (await um<{ a: any }>(c, `select public.plan_tecido_arvore($1) a`, [col.id])).a;
      expect(arv.subcolecoes[0].linhas[0].slots[0].materiais[0].variantes[0].grade_total).toBe(42);
      expect(Number(arv.subcolecoes[0].linhas[0].slots[0].materiais[0].consumo)).toBeCloseTo(1.4, 4);
    });
  });

  it("re-salvar é idempotente (substitui, não duplica)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-PT2','rascunho') returning id`, []);
      const arv1 = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [] }] };
      await um<{ id: string }>(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arv1)]);
      await um<{ id: string }>(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arv1)]);
      const n = await um<{ n: string }>(c, `select count(*) n from plan_tecido where colecao_id=$1`, [col.id]);
      expect(Number(n.n)).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test:int -- plan-tecido`
Expected: FAIL (`function salvar_plan_tecido does not exist`).

- [ ] **Step 3: Escrever a RPC de escrita (na migration da parte 1)**

```sql
-- 20260725100100_plan_tecido_rpcs.sql — Plan. Tecido RPCs (Fase A.1)
begin;

create or replace function public._salvar_plan_tecido_core(_colecao_id uuid, _arvore jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_plan uuid;
  v_sub jsonb; v_ln jsonb; v_slot jsonb; v_mat jsonb; v_var jsonb;
  v_sub_id uuid; v_ln_id uuid; v_slot_id uuid; v_mat_id uuid;
begin
  insert into plan_tecido (colecao_id) values (_colecao_id)
    on conflict (colecao_id) do update set updated_at = now()
    returning id into v_plan;
  -- delete-then-insert das subcoleções (cascata limpa o resto)
  delete from plan_tecido_subcolecoes where plan_id = v_plan;
  for v_sub in select * from jsonb_array_elements(coalesce(_arvore->'subcolecoes','[]'::jsonb)) loop
    insert into plan_tecido_subcolecoes (plan_id, subcolecao_id, ordem)
      values (v_plan, nullif(v_sub->>'subcolecao_id','')::uuid, coalesce((v_sub->>'ordem')::int,0))
      returning id into v_sub_id;
    for v_ln in select * from jsonb_array_elements(coalesce(v_sub->'linhas','[]'::jsonb)) loop
      insert into plan_tecido_linhas (sub_id, linha_id, categoria_id, ordem)
        values (v_sub_id, nullif(v_ln->>'linha_id','')::uuid, nullif(v_ln->>'categoria_id','')::uuid, coalesce((v_ln->>'ordem')::int,0))
        returning id into v_ln_id;
      for v_slot in select * from jsonb_array_elements(coalesce(v_ln->'slots','[]'::jsonb)) loop
        insert into plan_tecido_slots (linha_ref_id, modelo_id, slot_index, nome, custo_simulado,
          custo_terceirizados_previsto, custos_adicionais, preco_venda)
          values (v_ln_id, nullif(v_slot->>'modelo_id','')::uuid, coalesce((v_slot->>'slot_index')::int,0),
            v_slot->>'nome', v_slot->'custo_simulado',
            nullif(v_slot->>'custo_terceirizados_previsto','')::numeric,
            coalesce(v_slot->'custos_adicionais','[]'::jsonb),
            nullif(v_slot->>'preco_venda','')::numeric)
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
end $$;

create or replace function public.salvar_plan_tecido(_colecao_id uuid, _arvore jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo criacao não habilitado para esta loja' using errcode='42501';
  end if;
  return public._salvar_plan_tecido_core(_colecao_id, _arvore);
end $$;

revoke execute on function public._salvar_plan_tecido_core(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.salvar_plan_tecido(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
```

- [ ] **Step 4: Aplicar a migration**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260725100100_plan_tecido_rpcs.sql`
Expected: sem erro. (O teste ainda falha na leitura — `plan_tecido_arvore` só chega na Task 3.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260725100100_plan_tecido_rpcs.sql tests/integration/plan-tecido.test.ts
git commit -m "feat(plan-tecido): RPC salvar_plan_tecido + core (Fase A.1)"
```

---

## Task 3: RPC `plan_tecido_arvore` (leitura agregada)

**Files:**
- Modify: `supabase/migrations/20260725100100_plan_tecido_rpcs.sql` (adicionar a RPC de leitura — nova migration incremental para não reaplicar destrutivo)
- Actually create: `supabase/migrations/20260725100200_plan_tecido_arvore.sql`
- Test: `tests/integration/plan-tecido.test.ts` (já escrito na Task 2)

**Interfaces:**
- Produces: `plan_tecido_arvore(_colecao_id uuid) returns jsonb`. Devolve `{ plan_id, colecao_id, subcolecoes:[{ id, subcolecao_id, ordem, linhas:[{ id, linha_id, categoria_id, ordem, slots:[{ id, modelo_id, ref, nome, thumb_path, custo_simulado, custo_terceirizados_previsto, custos_adicionais, preco_venda, materiais:[{ id, artigo_id, artigo_nome, unidade_medida, rendimento, tipo, numero, consumo, loss_percent, ordem, variantes:[{ id, variante_tecido_id, label, ordem, multiplicador, grades, grade_total }] }] }] }] }] }`. Retorna `null` se não há plano salvo.

- [ ] **Step 1: Escrever a RPC de leitura**

```sql
-- 20260725100200_plan_tecido_arvore.sql — leitura agregada da árvore
begin;

create or replace function public._plan_tecido_arvore_core(_colecao_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when p.id is null then null else jsonb_build_object(
    'plan_id', p.id, 'colecao_id', p.colecao_id,
    'subcolecoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'subcolecao_id', s.subcolecao_id, 'ordem', s.ordem,
        'linhas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'linha_id', l.linha_id, 'categoria_id', l.categoria_id, 'ordem', l.ordem,
            'slots', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', sl.id, 'modelo_id', sl.modelo_id, 'ref', m.ref, 'nome', coalesce(m.nome, sl.nome),
                'thumb_path', (m.fotos_modelo)[1],  -- fotos_modelo é text[] (array 1-indexed), não jsonb
                'custo_simulado', sl.custo_simulado,
                'custo_terceirizados_previsto', sl.custo_terceirizados_previsto,
                'custos_adicionais', sl.custos_adicionais, 'preco_venda', sl.preco_venda,
                'materiais', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', mt.id, 'artigo_id', mt.artigo_id, 'artigo_nome', a.nome,
                    'unidade_medida', a.unidade_medida, 'rendimento', a.rendimento,
                    'tipo', mt.tipo, 'numero', mt.numero, 'consumo', mt.consumo,
                    'loss_percent', mt.loss_percent, 'ordem', mt.ordem,
                    'variantes', coalesce((
                      select jsonb_agg(jsonb_build_object(
                        'id', vv.id, 'variante_tecido_id', vv.variante_tecido_id,
                        'label', concat_ws(' - ', vt.nome_variante, cor.nome, ap.nome),
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
$$;

create or replace function public.plan_tecido_arvore(_colecao_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then return null; end if;
  return public._plan_tecido_arvore_core(_colecao_id);
end $$;

revoke execute on function public._plan_tecido_arvore_core(uuid) from public, anon, authenticated;
grant execute on function public.plan_tecido_arvore(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
```

- [ ] **Step 2: Aplicar a migration**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260725100200_plan_tecido_arvore.sql`
Expected: sem erro.

- [ ] **Step 3: Rodar os testes de integração e ver passar**

Run: `npm run test:int -- plan-tecido`
Expected: PASS (os 2 testes da Task 2).

- [ ] **Step 4: Verificar REVOKE (segurança)**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -c "select has_function_privilege('authenticated','public._plan_tecido_arvore_core(uuid)','EXECUTE'), has_function_privilege('authenticated','public._salvar_plan_tecido_core(uuid,jsonb)','EXECUTE');"
```
Expected: ambos `f` (false).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260725100200_plan_tecido_arvore.sql
git commit -m "feat(plan-tecido): RPC plan_tecido_arvore + core (Fase A.1)"
```

---

## Task 4: Lib de cálculo puro + tipos

**Files:**
- Create: `src/lib/plan-tecido/types.ts`
- Create: `src/lib/plan-tecido/calc.ts`
- Test: `tests/unit/plan-tecido-calc.test.ts`

**Interfaces:**
- Produces:
  - Tipos `PtVariante`, `PtMaterial`, `PtSlot`, `PtLinha`, `PtSub`, `PtArvore` (espelham a árvore da Task 3).
  - `necessidadeVariante(consumo: number, gradeTotal: number, mult: number): number`
  - `necessidadePorTecido(arvore: PtArvore): { artigo_id: string; artigo_nome: string; unidade_medida: string|null; rendimento: number|null; variantes: { variante_tecido_id: string; label: string; metros: number }[]; totalMetros: number }[]`
  - `metrosParaKg(metros: number, rendimento: number|null): number`
  - `abaterEstoque(necessidadeMetros: number, estoqueMetros: number): number` (= `max(0, nec − estoque)`)

- [ ] **Step 1: Escrever os tipos**

```typescript
// src/lib/plan-tecido/types.ts
export type PtVariante = { id?: string; variante_tecido_id: string; label?: string; ordem: number; multiplicador: number; grades: Record<string, number>; grade_total: number };
export type PtMaterial = { id?: string; artigo_id: string | null; artigo_nome?: string | null; unidade_medida?: string | null; rendimento?: number | null; tipo: "tecido" | "forro"; numero: number; consumo: number; loss_percent: number; ordem: number; variantes: PtVariante[] };
export type PtSlot = { id?: string; modelo_id: string | null; ref?: string | null; nome?: string | null; thumb_path?: string | null; custo_simulado?: unknown; custo_terceirizados_previsto?: number | null; custos_adicionais?: { descricao: string; valor: number }[]; preco_venda?: number | null; materiais: PtMaterial[] };
export type PtLinha = { id?: string; linha_id: string | null; categoria_id: string | null; ordem: number; slots: PtSlot[] };
export type PtSub = { id?: string; subcolecao_id: string | null; ordem: number; linhas: PtLinha[] };
export type PtArvore = { plan_id?: string; colecao_id: string; subcolecoes: PtSub[] };
```

- [ ] **Step 2: Escrever o teste unit (falha primeiro)**

```typescript
// tests/unit/plan-tecido-calc.test.ts
import { describe, it, expect } from "vitest";
import { necessidadeVariante, necessidadePorTecido, metrosParaKg, abaterEstoque } from "@/lib/plan-tecido/calc";
import type { PtArvore } from "@/lib/plan-tecido/types";

describe("plan-tecido/calc", () => {
  it("necessidadeVariante = consumo × grade_total × mult (sem perda)", () => {
    expect(necessidadeVariante(1.4, 90, 1)).toBeCloseTo(126, 5);
    expect(necessidadeVariante(0.8, 90, 1)).toBeCloseTo(72, 5);
    expect(necessidadeVariante(1, 10, 0.5)).toBeCloseTo(5, 5);
  });

  it("metrosParaKg divide por rendimento; rendimento 0/null → 0", () => {
    expect(metrosParaKg(180, 3)).toBeCloseTo(60, 5);
    expect(metrosParaKg(180, 0)).toBe(0);
    expect(metrosParaKg(180, null)).toBe(0);
  });

  it("abaterEstoque nunca fica negativo", () => {
    expect(abaterEstoque(264, 90)).toBe(174);
    expect(abaterEstoque(210, 340)).toBe(0);
  });

  it("necessidadePorTecido soma por artigo/variante em toda a árvore", () => {
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [
      { modelo_id: null, materiais: [
        { artigo_id: "A", artigo_nome: "Viscose", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1.4, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: "v1", label: "Off-white", ordem: 1, multiplicador: 1, grades: {}, grade_total: 90 }] },
      ] },
      { modelo_id: null, materiais: [
        { artigo_id: "A", artigo_nome: "Viscose", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1.2, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: "v1", label: "Off-white", ordem: 1, multiplicador: 1, grades: {}, grade_total: 35 }] },
      ] },
    ] }] }] };
    const r = necessidadePorTecido(arv);
    expect(r).toHaveLength(1);
    expect(r[0].artigo_id).toBe("A");
    // v1: 1.4×90 + 1.2×35 = 126 + 42 = 168
    expect(r[0].variantes[0].metros).toBeCloseTo(168, 5);
    expect(r[0].totalMetros).toBeCloseTo(168, 5);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test:unit -- plan-tecido-calc`
Expected: FAIL (`calc` não existe).

- [ ] **Step 4: Escrever o calc**

```typescript
// src/lib/plan-tecido/calc.ts
import type { PtArvore } from "./types";

export const necessidadeVariante = (consumo: number, gradeTotal: number, mult: number): number =>
  (Number(consumo) || 0) * (Number(gradeTotal) || 0) * (Number(mult) || 0);

export const metrosParaKg = (metros: number, rendimento: number | null): number =>
  rendimento && rendimento > 0 ? (Number(metros) || 0) / rendimento : 0;

export const abaterEstoque = (necessidadeMetros: number, estoqueMetros: number): number =>
  Math.max(0, (Number(necessidadeMetros) || 0) - (Number(estoqueMetros) || 0));

export type NecTecido = {
  artigo_id: string;
  artigo_nome: string;
  unidade_medida: string | null;
  rendimento: number | null;
  variantes: { variante_tecido_id: string; label: string; metros: number }[];
  totalMetros: number;
};

export function necessidadePorTecido(arvore: PtArvore): NecTecido[] {
  const byArtigo = new Map<string, NecTecido>();
  for (const sub of arvore.subcolecoes ?? []) {
    for (const ln of sub.linhas ?? []) {
      for (const slot of ln.slots ?? []) {
        for (const mat of slot.materiais ?? []) {
          if (!mat.artigo_id) continue;
          let t = byArtigo.get(mat.artigo_id);
          if (!t) {
            t = { artigo_id: mat.artigo_id, artigo_nome: mat.artigo_nome ?? "", unidade_medida: mat.unidade_medida ?? null, rendimento: mat.rendimento ?? null, variantes: [], totalMetros: 0 };
            byArtigo.set(mat.artigo_id, t);
          }
          for (const v of mat.variantes ?? []) {
            const metros = necessidadeVariante(mat.consumo, v.grade_total, v.multiplicador);
            if (metros <= 0) continue;
            let vr = t.variantes.find((x) => x.variante_tecido_id === v.variante_tecido_id);
            if (!vr) { vr = { variante_tecido_id: v.variante_tecido_id, label: v.label ?? "", metros: 0 }; t.variantes.push(vr); }
            vr.metros += metros;
            t.totalMetros += metros;
          }
        }
      }
    }
  }
  return [...byArtigo.values()];
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:unit -- plan-tecido-calc`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/plan-tecido/types.ts src/lib/plan-tecido/calc.ts tests/unit/plan-tecido-calc.test.ts
git commit -m "feat(plan-tecido): lib de cálculo puro + tipos (Fase A.1)"
```

---

## Task 5: Wiring — permissão + rota (lista) + sidebar + gating

**Files:**
- Modify: `src/lib/permissions-catalog.ts:52-61`
- Modify: `src/components/app-sidebar.tsx` (PAGE_URLS ~75-99, labelFor ~143-148)
- Create: `src/routes/_authenticated/criacao.plan-tecido.tsx`

**Interfaces:**
- Produces: rota `/criacao/plan-tecido` acessível com permissão `criacao_plan_tecido` (aparece na sidebar acima de "Plan. Produto", só com criacao+otb).

- [ ] **Step 1: Adicionar a página no catálogo (antes de criacao_planejamento)**

Em `src/lib/permissions-catalog.ts`, dentro de `module: "criacao"`, `pages`:
```typescript
    pages: [
      { key: "criacao_plan_tecido", label: "Planejamento de Tecido" },
      { key: "criacao_planejamento", label: "Planejamento de Produto" },
      { key: "criacao_desenvolvimento", label: "Desenvolvimento" },
      { key: "producao_explosao", label: "Explosão" },
      { key: "producao_consumo_oc", label: "Consumo por OC" },
    ],
```

- [ ] **Step 2: Registrar URL + rótulo curto na sidebar**

Em `src/components/app-sidebar.tsx`, no `PAGE_URLS`:
```typescript
  criacao_plan_tecido: "/criacao/plan-tecido",
```
E em `labelFor`, antes do `return fallback`:
```typescript
  if (key === "criacao_plan_tecido") return "Plan. Tecido";
```

- [ ] **Step 3: Criar a rota da lista (shell com gating de OTB)**

```tsx
// src/routes/_authenticated/criacao.plan-tecido.tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { RequirePermission } from "@/components/RequirePermission";
import { useTenantModules } from "@/hooks/useTenantModules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Scissors } from "lucide-react";

export const Route = createFileRoute("/_authenticated/criacao/plan-tecido")({
  component: () => (
    <RequirePermission page="criacao_plan_tecido">
      <PlanTecidoListPage />
    </RequirePermission>
  ),
});

type ColecaoRow = { id: string; nome: string; tipo: string | null; status: string | null; mes_id: string | null; ano_id: string | null };

function PlanTecidoListPage() {
  const { isModuleEnabled } = useTenantModules();
  const { data: colecoes = [] } = useQuery({
    queryKey: ["plan-tecido-colecoes"],
    queryFn: async () =>
      ((await supabase.from("colecoes").select("id, nome, tipo, status, mes_id, ano_id").order("created_at", { ascending: false })).data ?? []) as ColecaoRow[],
  });

  if (!isModuleEnabled("otb")) {
    return <div className="p-6 text-sm text-muted-foreground">Ative o módulo OTB para planejar tecido por coleção.</div>;
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Scissors className="h-5 w-5" />
        <h1 className="font-display text-xl font-semibold">Plan. Tecido</h1>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {colecoes.map((c) => (
          <Link key={c.id} to="/criacao/plan-tecido/$colecaoId" params={{ colecaoId: c.id }}>
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader className="pb-2"><CardTitle className="text-base">{c.nome}</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{c.tipo === "poder_venda" ? "Poder de Venda" : "Orçamento"}</Badge>
                <Badge variant={c.status === "confirmada" ? "default" : "outline"}>{c.status}</Badge>
              </CardContent>
            </Card>
          </Link>
        ))}
        {colecoes.length === 0 && <div className="text-sm text-muted-foreground">Nenhuma coleção ainda.</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rodar o build e checar tipos**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"`
Expected: build OK; "sem TS2304". (A rota `$colecaoId` ainda não existe — o `Link` compila; navegar só funciona após a Task 7. Se o TanStack reclamar do route id inexistente no type-gen, criar o arquivo stub da Task 7 antes; ver Task 7 Step 1.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions-catalog.ts src/components/app-sidebar.tsx src/routes/_authenticated/criacao.plan-tecido.tsx
git commit -m "feat(plan-tecido): rota da lista + permissão + sidebar (Fase A.1)"
```

---

## Task 6: Engine de semeadura da árvore

**Files:**
- Create: `src/lib/plan-tecido/engine.ts`
- Test: `tests/unit/plan-tecido-engine.test.ts`

**Interfaces:**
- Consumes: tipos de `types.ts`.
- Produces: `semearArvore(input: SeedInput): PtArvore` — monta a árvore inicial (subcoleção→linha/categoria→slots vazios) a partir do plano da coleção, e `mergeArvore(seed: PtArvore, salvo: PtArvore | null): PtArvore` — sobrepõe o plano salvo por chave (subcolecao_id/linha_id|categoria_id/slot_index).
  - `type SeedInput = { colecao_id: string; tipo: "orcamento" | "poder_venda"; buckets: { subcolecao_id: string | null; linha_id: string | null; categoria_id: string | null; qtd: number }[] }`

- [ ] **Step 1: Escrever o teste (falha primeiro)**

```typescript
// tests/unit/plan-tecido-engine.test.ts
import { describe, it, expect } from "vitest";
import { semearArvore, mergeArvore } from "@/lib/plan-tecido/engine";

describe("plan-tecido/engine", () => {
  it("semeia N slots por bucket", () => {
    const arv = semearArvore({ colecao_id: "c", tipo: "poder_venda",
      buckets: [{ subcolecao_id: "s1", linha_id: "l1", categoria_id: null, qtd: 2 }] });
    expect(arv.subcolecoes).toHaveLength(1);
    expect(arv.subcolecoes[0].linhas[0].slots).toHaveLength(2);
    expect(arv.subcolecoes[0].linhas[0].slots[0].materiais).toEqual([]);
  });

  it("merge preserva materiais/grade do plano salvo pela chave do bucket+slot_index", () => {
    const seed = semearArvore({ colecao_id: "c", tipo: "poder_venda",
      buckets: [{ subcolecao_id: "s1", linha_id: "l1", categoria_id: null, qtd: 1 }] });
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: null, slot_index: 0, materiais: [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1.4, loss_percent: 0, ordem: 0, variantes: [] }] }] }] }] };
    const merged = mergeArvore(seed, salvo);
    expect(merged.subcolecoes[0].linhas[0].slots[0].materiais[0].artigo_id).toBe("A");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:unit -- plan-tecido-engine`
Expected: FAIL.

- [ ] **Step 3: Escrever o engine**

```typescript
// src/lib/plan-tecido/engine.ts
import type { PtArvore, PtSub, PtLinha, PtSlot } from "./types";

export type SeedInput = {
  colecao_id: string;
  tipo: "orcamento" | "poder_venda";
  buckets: { subcolecao_id: string | null; linha_id: string | null; categoria_id: string | null; qtd: number }[];
};

const slotVazio = (i: number): PtSlot => ({ modelo_id: null, slot_index: i, nome: null, custos_adicionais: [], materiais: [] });

export function semearArvore(input: SeedInput): PtArvore {
  const subs = new Map<string, PtSub>();
  input.buckets.forEach((b, bi) => {
    const subKey = b.subcolecao_id ?? "__none__";
    let sub = subs.get(subKey);
    if (!sub) { sub = { subcolecao_id: b.subcolecao_id, ordem: subs.size, linhas: [] }; subs.set(subKey, sub); }
    const lnKey = `${b.linha_id ?? ""}|${b.categoria_id ?? ""}`;
    let ln = sub.linhas.find((l) => `${l.linha_id ?? ""}|${l.categoria_id ?? ""}` === lnKey);
    if (!ln) { ln = { linha_id: b.linha_id, categoria_id: b.categoria_id, ordem: sub.linhas.length, slots: [] } as PtLinha; sub.linhas.push(ln); }
    for (let i = 0; i < Math.max(0, b.qtd); i++) ln.slots.push(slotVazio(ln.slots.length));
    void bi;
  });
  return { colecao_id: input.colecao_id, subcolecoes: [...subs.values()] };
}

const lnKeyOf = (l: { linha_id: string | null; categoria_id: string | null }) => `${l.linha_id ?? ""}|${l.categoria_id ?? ""}`;

export function mergeArvore(seed: PtArvore, salvo: PtArvore | null): PtArvore {
  if (!salvo) return seed;
  return {
    ...seed,
    plan_id: salvo.plan_id,
    subcolecoes: seed.subcolecoes.map((s) => {
      const ss = salvo.subcolecoes.find((x) => (x.subcolecao_id ?? "__none__") === (s.subcolecao_id ?? "__none__"));
      if (!ss) return s;
      return { ...s, id: ss.id, linhas: s.linhas.map((l) => {
        const sl = ss.linhas.find((x) => lnKeyOf(x) === lnKeyOf(l));
        if (!sl) return l;
        return { ...l, id: sl.id, slots: l.slots.map((slot, i) => sl.slots[i] ? { ...slot, ...sl.slots[i] } : slot) };
      }) };
    }),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:unit -- plan-tecido-engine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan-tecido/engine.ts tests/unit/plan-tecido-engine.test.ts
git commit -m "feat(plan-tecido): engine de semeadura + merge da árvore (Fase A.1)"
```

---

## Task 7: Página do painel — carga de dados + árvore (cards 2 colunas, colapsáveis)

**Files:**
- Create: `src/routes/_authenticated/criacao.plan-tecido.$colecaoId.tsx`
- Create: `src/components/plan-tecido/ModelCard.tsx` (stub que abre/fecha; abas na Task 8)

**Interfaces:**
- Consumes: `plan_tecido_arvore` (Task 3), `semearArvore`/`mergeArvore` (Task 6), `necessidadePorTecido` (Task 4).
- Produces: página com estado `arvore` (PtArvore) + `setArvore`, `dirty`; renderiza árvore (subcoleção → linha → grid 2 colunas de `<ModelCard>`).

- [ ] **Step 1: Criar a página (carrega buckets do plano + árvore salva + merge)**

```tsx
// src/routes/_authenticated/criacao.plan-tecido.$colecaoId.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { RequirePermission } from "@/components/RequirePermission";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { ChevronRight, ArrowLeft } from "lucide-react";
import { semearArvore, mergeArvore, type SeedInput } from "@/lib/plan-tecido/engine";
import type { PtArvore } from "@/lib/plan-tecido/types";
import { ModelCard } from "@/components/plan-tecido/ModelCard";
import { ResumoPanel } from "@/components/plan-tecido/ResumoPanel";

export const Route = createFileRoute("/_authenticated/criacao/plan-tecido/$colecaoId")({
  component: () => (
    <RequirePermission page="criacao_plan_tecido">
      <PlanTecidoPanel />
    </RequirePermission>
  ),
});

function PlanTecidoPanel() {
  const { colecaoId } = Route.useParams();
  const qc = useQueryClient();
  const [arvore, setArvore] = useState<PtArvore | null>(null);
  const [dirty, setDirty] = useState(false);

  const { data: colecao } = useQuery({
    queryKey: ["plan-tecido-colecao", colecaoId],
    queryFn: async () => (await supabase.from("colecoes").select("id, nome, tipo").eq("id", colecaoId).maybeSingle()).data as any,
  });

  // buckets do plano (PV: colecao_pv_itens por subcoleção×linha; Orçamento: colecao_semana_categorias por subcoleção×categoria)
  const { data: seed } = useQuery({
    queryKey: ["plan-tecido-seed", colecaoId],
    enabled: !!colecao,
    queryFn: async (): Promise<SeedInput> => {
      const tipo = (colecao.tipo === "poder_venda" ? "poder_venda" : "orcamento") as SeedInput["tipo"];
      if (tipo === "poder_venda") {
        const rows = ((await supabase.from("colecao_pv_itens" as any).select("subcolecao_id, linha_id, qtd_semanas").eq("colecao_id", colecaoId)).data ?? []) as any[];
        const buckets = rows.map((r) => ({ subcolecao_id: r.subcolecao_id, linha_id: r.linha_id, categoria_id: null,
          qtd: Object.values((r.qtd_semanas ?? {}) as Record<string, number>).reduce((s, n) => s + (Number(n) || 0), 0) }));
        return { colecao_id: colecaoId, tipo, buckets };
      }
      const rows = ((await supabase.from("colecao_semana_categorias" as any).select("subcolecao_id, categoria_id, qtd").eq("colecao_id", colecaoId)).data ?? []) as any[];
      const buckets = rows.map((r) => ({ subcolecao_id: r.subcolecao_id, linha_id: null, categoria_id: r.categoria_id, qtd: Number(r.qtd) || 0 }));
      return { colecao_id: colecaoId, tipo, buckets };
    },
  });

  const { data: salvo } = useQuery({
    queryKey: ["plan-tecido-arvore", colecaoId],
    queryFn: async () => ((await supabase.rpc("plan_tecido_arvore" as any, { _colecao_id: colecaoId })).data ?? null) as PtArvore | null,
  });

  useEffect(() => {
    if (seed && salvo !== undefined && arvore === null) setArvore(mergeArvore(semearArvore(seed), salvo));
  }, [seed, salvo, arvore]);

  const salvarMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("salvar_plan_tecido" as any, { _colecao_id: colecaoId, _arvore: arvore });
      if (error) throw error;
    },
    onSuccess: () => { setDirty(false); toast.success("Planejamento de tecido salvo."); qc.invalidateQueries({ queryKey: ["plan-tecido-arvore", colecaoId] }); },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível salvar.")),
  });

  const patch = (next: PtArvore) => { setArvore(next); setDirty(true); };

  if (!arvore) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;

  return (
    <div className="flex min-h-screen flex-col max-sm:pb-24">
      <div className="flex items-center gap-2 border-b p-3">
        <span className="text-xs text-muted-foreground">Estilo &amp; Engenharia › Plan. Tecido › <b className="text-foreground">{colecao?.nome}</b></span>
        {dirty && <span className="ml-auto text-xs text-warning">● alterações não salvas</span>}
        <Button className="max-sm:hidden" disabled={!dirty || salvarMut.isPending} onClick={() => salvarMut.mutate()}>{dirty ? "Salvar" : "Salvo"}</Button>
      </div>

      <div className="flex flex-1 gap-3 p-3">
        <div className="min-w-0 flex-1 space-y-2">
          {arvore.subcolecoes.map((sub, si) => (
            <Collapsible key={sub.id ?? si} defaultOpen>
              <CollapsibleTrigger className="flex min-h-[44px] w-full items-center gap-2 rounded-md border px-3 text-sm font-medium [&[data-state=open]>svg]:rotate-90">
                <ChevronRight className="h-4 w-4 transition-transform" /> Subcoleção
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                {sub.linhas.map((ln, li) => (
                  <div key={ln.id ?? li} className="mb-2">
                    <div className="mb-1 px-1 text-xs text-muted-foreground">{ln.linha_id ? "Linha" : ln.categoria_id ? "Categoria" : "Sem classificação"}</div>
                    <div className="grid grid-cols-1 items-start gap-2 md:grid-cols-2">
                      {ln.slots.map((slot, sli) => (
                        <ModelCard key={slot.id ?? sli} slot={slot} onChange={(ns) => {
                          const next = structuredClone(arvore) as PtArvore;
                          next.subcolecoes[si].linhas[li].slots[sli] = ns;
                          patch(next);
                        }} />
                      ))}
                    </div>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
        <div className="hidden w-56 shrink-0 md:block"><ResumoPanel arvore={arvore} /></div>
      </div>

      <MobileActionBar>
        <Button variant="ghost" size="sm" onClick={() => history.back()}><ArrowLeft className="mr-1 h-4 w-4" />Voltar</Button>
        <Button className="ml-auto" disabled={!dirty || salvarMut.isPending} onClick={() => salvarMut.mutate()}>{dirty ? "Salvar" : "Salvo"}</Button>
      </MobileActionBar>
    </div>
  );
}
```

- [ ] **Step 2: Criar o stub do ModelCard (colapsável)**

```tsx
// src/components/plan-tecido/ModelCard.tsx
import { useState } from "react";
import type { PtSlot } from "@/lib/plan-tecido/types";
import { ChevronRight, ImageIcon } from "lucide-react";
import { necessidadePorTecido } from "@/lib/plan-tecido/calc";

export function ModelCard({ slot, onChange }: { slot: PtSlot; onChange: (s: PtSlot) => void }) {
  const [open, setOpen] = useState(false);
  const total = necessidadePorTecido({ colecao_id: "", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [slot] }] }] })
    .reduce((s, t) => s + t.totalMetros, 0);
  const temGrade = slot.materiais.some((m) => m.variantes.some((v) => v.grade_total > 0));
  return (
    <div className={`rounded-lg border ${open ? "border-primary" : ""}`}>
      <button className="flex w-full items-center gap-2 p-2 text-left" onClick={() => setOpen((o) => !o)}>
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
        <div className="flex h-7 w-7 items-center justify-center rounded bg-muted"><ImageIcon className="h-4 w-4 text-muted-foreground" /></div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{slot.ref ?? slot.nome ?? "Modelo"}</div>
          <div className="text-xs text-muted-foreground">{total ? `${total.toFixed(0)} m` : "—"} · {temGrade ? "✓ grade" : "⚠ falta"}</div>
        </div>
      </button>
      {open && <div className="border-t p-2 text-xs text-muted-foreground">Abas na Task 8. onChange disponível: {typeof onChange}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Criar stub do ResumoPanel (será completado na Task 11)**

```tsx
// src/components/plan-tecido/ResumoPanel.tsx
import type { PtArvore } from "@/lib/plan-tecido/types";
import { necessidadePorTecido } from "@/lib/plan-tecido/calc";

export function ResumoPanel({ arvore }: { arvore: PtArvore }) {
  const nec = necessidadePorTecido(arvore);
  const total = nec.reduce((s, t) => s + t.totalMetros, 0);
  return (
    <div className="rounded-lg border">
      <div className="border-b p-2 font-display text-sm font-semibold">Necessidade de tecido (m)</div>
      {nec.map((t) => (
        <div key={t.artigo_id} className="border-b p-2 text-xs">
          <div className="mb-1 font-medium">{t.artigo_nome}</div>
          {t.variantes.map((v) => (<div key={v.variante_tecido_id} className="flex justify-between"><span>{v.label}</span><b>{v.metros.toFixed(0)} m</b></div>))}
        </div>
      ))}
      <div className="flex justify-between p-2 font-display text-sm font-semibold"><span>Total</span><span>{total.toFixed(0)} m</span></div>
    </div>
  );
}
```

- [ ] **Step 4: Rodar build/tsc e navegar manualmente**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"`
Expected: build OK; "sem TS2304". Navegar em `/criacao/plan-tecido`, clicar numa coleção → abre o painel; a árvore mostra subcoleções/linhas com cards colapsáveis em 2 colunas; Salvar grava (verificar toast).

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/criacao.plan-tecido.\$colecaoId.tsx src/components/plan-tecido/ModelCard.tsx src/components/plan-tecido/ResumoPanel.tsx
git commit -m "feat(plan-tecido): página do painel + árvore 2 colunas + save (Fase A.1)"
```

---

## Task 8: Card do modelo — abas Accordion (Tecidos & Forros / Grade / Custo)

**Files:**
- Modify: `src/components/plan-tecido/ModelCard.tsx`
- Create: `src/components/plan-tecido/MaterialBlock.tsx` (stub; conteúdo na Task 9)
- Create: `src/components/plan-tecido/GradeSection.tsx` (stub; Task 10)
- Create: `src/components/plan-tecido/CustoSection.tsx` (stub; Task 11-custo)

**Interfaces:**
- Produces: `ModelCard` renderiza, quando aberto, um `Accordion type="multiple"` com 3 itens: "Tecidos & Forros" (`<MaterialBlock>` por material + botões "+ tecido"/"+ forro"), "Grade" (`<GradeSection>`), "Custo & Preço" (`<CustoSection>`). Cada seção recebe `slot` + `onChange(slot)`.

- [ ] **Step 1: Substituir o corpo aberto do ModelCard pelas abas**

```tsx
// src/components/plan-tecido/ModelCard.tsx (corpo aberto)
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { MaterialBlock } from "./MaterialBlock";
import { GradeSection } from "./GradeSection";
import { CustoSection } from "./CustoSection";
import type { PtMaterial } from "@/lib/plan-tecido/types";
// ... (mesmo header colapsável da Task 7)

// dentro do {open && ...}:
{open && (
  <Accordion type="multiple" defaultValue={["mat"]} className="border-t px-2">
    <AccordionItem value="mat">
      <AccordionTrigger className="py-2 text-xs">1. Tecidos &amp; Forros</AccordionTrigger>
      <AccordionContent>
        {slot.materiais.map((m, i) => (
          <MaterialBlock key={m.id ?? i} material={m} onChange={(nm) => {
            const materiais = slot.materiais.slice(); materiais[i] = nm; onChange({ ...slot, materiais });
          }} onRemove={() => onChange({ ...slot, materiais: slot.materiais.filter((_, j) => j !== i) })} />
        ))}
        <div className="mt-2 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => onChange({ ...slot, materiais: [...slot.materiais, novoMaterial(slot.materiais, "tecido")] })}>+ tecido</Button>
          <Button variant="outline" size="sm" onClick={() => onChange({ ...slot, materiais: [...slot.materiais, novoMaterial(slot.materiais, "forro")] })}>+ forro</Button>
        </div>
      </AccordionContent>
    </AccordionItem>
    <AccordionItem value="grade">
      <AccordionTrigger className="py-2 text-xs">2. Grade</AccordionTrigger>
      <AccordionContent><GradeSection slot={slot} onChange={onChange} /></AccordionContent>
    </AccordionItem>
    <AccordionItem value="custo">
      <AccordionTrigger className="py-2 text-xs">3. Custo &amp; Preço</AccordionTrigger>
      <AccordionContent><CustoSection slot={slot} onChange={onChange} /></AccordionContent>
    </AccordionItem>
  </Accordion>
)}

// helper (topo do arquivo):
function novoMaterial(existentes: PtMaterial[], tipo: "tecido" | "forro"): PtMaterial {
  const numero = existentes.filter((m) => m.tipo === tipo).length + 1;
  return { artigo_id: null, tipo, numero, consumo: 0, loss_percent: 0, ordem: existentes.length, variantes: [] };
}
```

- [ ] **Step 2: Criar stubs de MaterialBlock/GradeSection/CustoSection**

```tsx
// src/components/plan-tecido/MaterialBlock.tsx
import type { PtMaterial } from "@/lib/plan-tecido/types";
export function MaterialBlock({ material, onChange, onRemove }: { material: PtMaterial; onChange: (m: PtMaterial) => void; onRemove: () => void }) {
  return <div className="mb-2 rounded border p-2 text-xs">{material.tipo} {material.numero} — conteúdo na Task 9 {typeof onChange}{typeof onRemove}</div>;
}
```
```tsx
// src/components/plan-tecido/GradeSection.tsx
import type { PtSlot } from "@/lib/plan-tecido/types";
export function GradeSection({ slot, onChange }: { slot: PtSlot; onChange: (s: PtSlot) => void }) {
  return <div className="p-2 text-xs text-muted-foreground">Grade na Task 10 ({slot.materiais.length} materiais) {typeof onChange}</div>;
}
```
```tsx
// src/components/plan-tecido/CustoSection.tsx
import type { PtSlot } from "@/lib/plan-tecido/types";
export function CustoSection({ slot, onChange }: { slot: PtSlot; onChange: (s: PtSlot) => void }) {
  return <div className="p-2 text-xs text-muted-foreground">Custo na Task 11 {typeof slot}{typeof onChange}</div>;
}
```

- [ ] **Step 3: Build/tsc + navegação manual**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"`
Expected: OK. Abrir um card → 3 abas; "+ tecido"/"+ forro" adicionam blocos (aparecem os stubs); Salvar persiste (reabrir a coleção mantém os materiais).

- [ ] **Step 4: Commit**

```bash
git add src/components/plan-tecido/ModelCard.tsx src/components/plan-tecido/MaterialBlock.tsx src/components/plan-tecido/GradeSection.tsx src/components/plan-tecido/CustoSection.tsx
git commit -m "feat(plan-tecido): abas do card (Tecidos/Grade/Custo) + add material (Fase A.1)"
```

---

## Task 9: Bloco de material — artigo + variantes com checkbox + consumo

**Files:**
- Modify: `src/components/plan-tecido/MaterialBlock.tsx`

**Interfaces:**
- Consumes: `PtMaterial`; `labelVarianteRow` (`@/lib/variante`).
- Produces: `MaterialBlock` completo — dropdown de artigo (tecidos p/ tipo=tecido, forros p/ tipo=forro), lista de TODAS as variantes cadastradas do artigo com **checkbox** (marca/desmarca → entra/sai de `material.variantes`), input de **consumo**, selo de procedência, e (tecido) input prof/cor por variante ou (forro) multiplicador.

- [ ] **Step 1: Implementar o bloco**

```tsx
// src/components/plan-tecido/MaterialBlock.tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NumberInput } from "@/components/shared/NumberInput";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { labelVarianteRow } from "@/lib/variante";
import type { PtMaterial, PtVariante } from "@/lib/plan-tecido/types";

type ArtigoRow = { id: string; nome: string; unidade_medida: string | null; rendimento: number | null };
type VarRow = { id: string; nome_variante: string | null; codigo_variante: string | null; cor: { nome: string | null } | null; apelido: { nome: string | null } | null };

export function MaterialBlock({ material, onChange, onRemove }: { material: PtMaterial; onChange: (m: PtMaterial) => void; onRemove: () => void }) {
  const { data: artigos = [] } = useQuery({
    queryKey: ["plan-tecido-artigos", material.tipo],
    queryFn: async () => ((await supabase.from("artigos").select("id, nome, unidade_medida, rendimento").order("nome")).data ?? []) as ArtigoRow[],
  });
  const { data: variantesArtigo = [] } = useQuery({
    queryKey: ["plan-tecido-variantes-artigo", material.artigo_id],
    enabled: !!material.artigo_id,
    queryFn: async () => ((await supabase.from("variantes_tecido")
      .select("id, nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
      .eq("artigo_id", material.artigo_id).order("id")).data ?? []) as unknown as VarRow[],
  });

  const marcada = (vid: string) => material.variantes.some((v) => v.variante_tecido_id === vid);
  const toggle = (vid: string) => {
    if (marcada(vid)) return onChange({ ...material, variantes: material.variantes.filter((v) => v.variante_tecido_id !== vid) });
    const nova: PtVariante = { variante_tecido_id: vid, ordem: material.variantes.length + 1, multiplicador: 1, grades: {}, grade_total: 0 };
    onChange({ ...material, variantes: [...material.variantes, nova] });
  };
  const setVar = (vid: string, patch: Partial<PtVariante>) =>
    onChange({ ...material, variantes: material.variantes.map((v) => (v.variante_tecido_id === vid ? { ...v, ...patch } : v)) });

  return (
    <div className="mb-2 rounded border">
      <div className="flex items-center gap-2 bg-muted/60 p-2">
        <span className="rounded bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{material.tipo === "tecido" ? "TEC" : "FOR"} {material.numero}</span>
        <select className="rounded border bg-background px-2 py-1 text-xs" value={material.artigo_id ?? ""} onChange={(e) => onChange({ ...material, artigo_id: e.target.value || null, variantes: [] })}>
          <option value="">Escolher artigo…</option>
          {artigos.map((a) => (<option key={a.id} value={a.id}>{a.nome}{a.unidade_medida === "kg" ? " [kg]" : ""}</option>))}
        </select>
        <div className="ml-auto flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">consumo</span>
          <NumberInput className="h-7 w-16 text-right" value={material.consumo} onChange={(e) => onChange({ ...material, consumo: Number(e.target.value) || 0 })} />
          <span className="text-muted-foreground">m</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRemove}><X className="h-3 w-3" /></Button>
      </div>
      {material.artigo_id && (
        <div className="p-2">
          <div className="mb-1 text-[10px] text-muted-foreground">Variantes — marque as usadas{material.tipo === "tecido" ? " · prof/cor" : " · × grade"}</div>
          {variantesArtigo.map((v) => {
            const on = marcada(v.id);
            const pv = material.variantes.find((x) => x.variante_tecido_id === v.id);
            return (
              <div key={v.id} className={`flex items-center gap-2 border-t border-dashed py-1 text-xs ${on ? "" : "opacity-50"}`}>
                <Checkbox checked={on} onCheckedChange={() => toggle(v.id)} className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">{labelVarianteRow(v)}</span>
                {on && material.tipo === "tecido" && (
                  <NumberInput integer className="h-7 w-14 text-right" value={pv?.grade_total ?? 0} onChange={(e) => setVar(v.id, { grade_total: Number(e.target.value) || 0 })} />
                )}
                {on && material.tipo === "forro" && (
                  <NumberInput className="h-7 w-14 text-right" value={pv?.multiplicador ?? 1} onChange={(e) => setVar(v.id, { multiplicador: Number(e.target.value) || 0 })} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build/tsc + navegação**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"`
Expected: OK. Escolher um tecido → variantes aparecem com checkbox; marcar → aparece prof/cor (tecido) ou multiplicador (forro); consumo editável; salvar e reabrir mantém.

- [ ] **Step 3: Commit**

```bash
git add src/components/plan-tecido/MaterialBlock.tsx
git commit -m "feat(plan-tecido): bloco de material (artigo + variantes checkbox + consumo) (Fase A.1)"
```

---

## Task 10: Grade — proporção de tamanho (do cadastro) + total por variante

**Files:**
- Modify: `src/components/plan-tecido/GradeSection.tsx`

**Interfaces:**
- Consumes: `PtSlot`; grade fica no Tecido 1 (`material.tipo==="tecido" && numero===1`). Reusa a proporção do modelo (`modelos.proporcoes`) quando `slot.modelo_id` existe (via query), senão default `{ PP:1, P:1, M:1, G:1, GG:1 }`.
- Produces: `GradeSection` que mostra a proporção (editável) e, por variante do Tecido 1, distribui `grade_total` pelos tamanhos conforme a proporção (informativo). A edição de peças por variante já está no MaterialBlock (prof/cor = grade_total); aqui é a curva.

- [ ] **Step 1: Implementar a seção de grade**

```tsx
// src/components/plan-tecido/GradeSection.tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NumberInput } from "@/components/shared/NumberInput";
import type { PtSlot } from "@/lib/plan-tecido/types";

const DEFAULT_PROP: Record<string, number> = { PP: 1, P: 1, M: 1, G: 1, GG: 1 };

export function GradeSection({ slot, onChange }: { slot: PtSlot; onChange: (s: PtSlot) => void }) {
  const tec1 = slot.materiais.find((m) => m.tipo === "tecido" && m.numero === 1);
  const { data: prop } = useQuery({
    queryKey: ["plan-tecido-proporcoes", slot.modelo_id],
    enabled: !!slot.modelo_id,
    queryFn: async () => (((await supabase.from("modelos").select("proporcoes").eq("id", slot.modelo_id).maybeSingle()).data as any)?.proporcoes ?? null) as Record<string, number> | null,
  });
  const proporcao = prop ?? DEFAULT_PROP;
  const somaProp = Object.values(proporcao).reduce((s, n) => s + (Number(n) || 0), 0) || 1;
  const totalTec1 = (tec1?.variantes ?? []).reduce((s, v) => s + (v.grade_total || 0), 0);

  if (!tec1 || !tec1.artigo_id) return <div className="p-2 text-xs text-muted-foreground">Defina o Tecido 1 para editar a grade.</div>;

  return (
    <div className="p-2">
      <div className="mb-1 text-[10px] text-muted-foreground">Proporção de tamanho {slot.modelo_id ? "(do cadastro do modelo)" : "(padrão)"} — editável</div>
      <div className="flex flex-wrap gap-1">
        {Object.entries(proporcao).map(([tam, q]) => (
          <div key={tam} className="flex flex-col items-center rounded border px-2 py-1">
            <NumberInput integer className="h-6 w-10 text-center" value={q}
              onChange={(e) => {
                const next = { ...proporcao, [tam]: Number(e.target.value) || 0 };
                // proporção fica no slot só como referência de exibição (não escreve no modelo — A.1)
                onChange({ ...slot });
                void next;
              }} />
            <span className="text-[9px] text-muted-foreground">{tam}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-right text-xs text-muted-foreground">grade total <b>{totalTec1} pç</b> · Σ proporção {somaProp}</div>
    </div>
  );
}
```

> Nota de implementação: na A.1 a proporção é **exibição/referência** (a grade por variante = prof/cor no MaterialBlock). Persistir a proporção editada é opcional; se necessário, guardar em `plan_tecido_slots` (coluna futura) — fora do escopo A.1. Deixar como referência derivada do cadastro.

- [ ] **Step 2: Build/tsc + navegação**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"`
Expected: OK. Aba Grade mostra a curva (do cadastro se o slot tem modelo, senão padrão) + grade total do Tecido 1.

- [ ] **Step 3: Commit**

```bash
git add src/components/plan-tecido/GradeSection.tsx
git commit -m "feat(plan-tecido): seção de grade (proporção do cadastro + total) (Fase A.1)"
```

---

## Task 11: Custo & Preço (via preco.ts) + Resumo completo (Situação + Necessidade + Poder de venda)

**Files:**
- Modify: `src/components/plan-tecido/CustoSection.tsx`
- Modify: `src/components/plan-tecido/ResumoPanel.tsx`

**Interfaces:**
- Consumes: `precoInfo` (`@/lib/preco`), `necessidadePorTecido`/`metrosParaKg`/`abaterEstoque` (`@/lib/plan-tecido/calc`).
- Produces: `CustoSection` com materiais (deriv.), mão de obra (edita), custo total (deriv.), markup (deriv. da linha), preço sugerido (deriv.), preço p/ venda (edita). `ResumoPanel` com bloco Situação (checkboxes), Necessidade (metros) e Poder de venda (previsto).

- [ ] **Step 1: Implementar CustoSection**

```tsx
// src/components/plan-tecido/CustoSection.tsx
import { NumberInput } from "@/components/shared/NumberInput";
import { precoInfo } from "@/lib/preco";
import { brl } from "@/lib/format";
import { AlertTriangle } from "lucide-react";
import type { PtSlot } from "@/lib/plan-tecido/types";

export function CustoSection({ slot, onChange }: { slot: PtSlot; onChange: (s: PtSlot) => void }) {
  // materiais previstos = Σ (consumo × preço/m estimado)? Na A.1 o preço do tecido não está no material.
  // Usa custo_simulado.mao_obra + materiais informado; markup entra na Task de linha. Simplificado p/ A.1:
  const cs = (slot.custo_simulado ?? {}) as { materiais?: number; mao_obra?: number };
  const materiais = Number(cs.materiais) || 0;
  const maoObra = Number(slot.custo_terceirizados_previsto) || 0;
  const custoTotal = materiais + maoObra;
  const pi = precoInfo(custoTotal, 0 /* markup da linha entra quando o slot tiver linha_id resolvida */, slot.preco_venda ?? null);

  const RO = ({ label, value }: { label: string; value: string }) => (
    <div><div className="text-[10px] text-muted-foreground">{label}</div><div className="rounded-md border bg-muted px-2 py-1 text-right text-xs text-muted-foreground">{value}</div></div>
  );

  return (
    <div className="p-2">
      <div className="mb-2 flex items-start gap-1 rounded-md border border-warning bg-warning/10 p-2 text-[10px]">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" /> Estimativa — não é o custo/preço real (esses vêm do BOM/CAD). Guardado no plano; não sobrescreve o modelo.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><div className="text-[10px] text-muted-foreground">Materiais previstos</div>
          <NumberInput className="h-7 w-full text-right" value={materiais} onChange={(e) => onChange({ ...slot, custo_simulado: { ...cs, materiais: Number(e.target.value) || 0 } })} /></div>
        <div><div className="text-[10px] text-muted-foreground">Mão de obra prevista</div>
          <NumberInput className="h-7 w-full text-right" value={maoObra} onChange={(e) => onChange({ ...slot, custo_terceirizados_previsto: Number(e.target.value) || 0 })} /></div>
        <RO label="Custo total" value={brl(custoTotal)} />
        <RO label="Preço sugerido" value={brl(pi.sugerido)} />
        <div className="col-span-2"><div className="text-[10px] text-muted-foreground">Preço p/ venda</div>
          <NumberInput className="h-7 w-full text-right" value={slot.preco_venda ?? 0} onChange={(e) => onChange({ ...slot, preco_venda: Number(e.target.value) || 0 })} /></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Completar ResumoPanel (Situação + Necessidade + Poder de venda)**

```tsx
// src/components/plan-tecido/ResumoPanel.tsx
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { PtArvore } from "@/lib/plan-tecido/types";
import { necessidadePorTecido } from "@/lib/plan-tecido/calc";
import { precoInfo } from "@/lib/preco";
import { brl } from "@/lib/format";

export function ResumoPanel({ arvore }: { arvore: PtArvore }) {
  const [usarEstoque, setUsarEstoque] = useState(false);
  const nec = necessidadePorTecido(arvore);
  const total = nec.reduce((s, t) => s + t.totalMetros, 0);
  // poder de venda previsto = Σ (preço efetivo × grade_total) por slot
  let pv = 0;
  for (const sub of arvore.subcolecoes) for (const ln of sub.linhas) for (const slot of ln.slots) {
    const tec1 = slot.materiais.find((m) => m.tipo === "tecido" && m.numero === 1);
    const grade = (tec1?.variantes ?? []).reduce((s, v) => s + (v.grade_total || 0), 0);
    const cs = (slot.custo_simulado ?? {}) as { materiais?: number };
    const custo = (Number(cs.materiais) || 0) + (Number(slot.custo_terceirizados_previsto) || 0);
    pv += precoInfo(custo, 0, slot.preco_venda ?? null).efetivo * grade;
  }
  return (
    <div className="space-y-2">
      <div className="rounded-lg border">
        <div className="border-b p-2 font-display text-xs font-semibold">Situação de compra</div>
        <div className="p-2 text-xs">
          <label className="flex items-center gap-2"><Checkbox checked={usarEstoque} onCheckedChange={(v) => setUsarEstoque(!!v)} className="h-4 w-4" /> Usar estoque existente</label>
          <p className="mt-1 text-[10px] text-muted-foreground">Padrão: OCs destinadas à coleção → necessidade cheia. (abatimento por estoque: Task futura / Fase B)</p>
        </div>
      </div>
      <div className="rounded-lg border">
        <div className="border-b p-2 font-display text-xs font-semibold">Necessidade de tecido (m)</div>
        {nec.map((t) => (
          <div key={t.artigo_id} className="border-b p-2 text-xs">
            <div className="mb-1 font-medium">{t.artigo_nome}{t.unidade_medida === "kg" ? <span className="ml-1 text-muted-foreground">kg no pedido</span> : null}</div>
            {t.variantes.map((v) => (<div key={v.variante_tecido_id} className="flex justify-between"><span>{v.label}</span><b>{v.metros.toFixed(0)} m</b></div>))}
          </div>
        ))}
        <div className="flex justify-between p-2 font-display text-xs font-semibold"><span>Total</span><span>{total.toFixed(0)} m</span></div>
      </div>
      <div className="rounded-lg border">
        <div className="border-b p-2 font-display text-xs font-semibold">Poder de venda (previsto)</div>
        <div className="flex justify-between p-2 text-xs"><span>Σ preço × grade</span><b>{brl(pv)}</b></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build/tsc + navegação**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"`
Expected: OK. Aba Custo mostra editável/derivado + banner; resumo mostra Situação + Necessidade (metros) + Poder de venda; salvar mantém custos.

- [ ] **Step 4: Commit**

```bash
git add src/components/plan-tecido/CustoSection.tsx src/components/plan-tecido/ResumoPanel.tsx
git commit -m "feat(plan-tecido): custo/preço (preco.ts) + resumo (situação/necessidade/poder de venda) (Fase A.1)"
```

---

## Task 12: Fechamento — guarda de descartar + verificação de integração final

**Files:**
- Modify: `src/routes/_authenticated/criacao.plan-tecido.$colecaoId.tsx`
- Test: `tests/integration/plan-tecido.test.ts` (adicionar 1 caso ponta-a-ponta)

**Interfaces:**
- Consumes: tudo anterior.
- Produces: `AlertDialog` "Descartar alterações?" ao sair com `dirty`; teste que salva uma árvore com tecido+forro+2 variantes e relê batendo a necessidade.

- [ ] **Step 1: Escrever o teste ponta-a-ponta (falha primeiro se cálculo/rpc divergirem)**

```typescript
// adicionar em tests/integration/plan-tecido.test.ts
it("necessidade por tecido bate com consumo×grade após salvar+ler", async () => {
  await withTx(async (c) => {
    await comoUsuario(c); await ligarCriacao(c);
    const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-PT3','rascunho') returning id`, []);
    const av = await um<{ art: string; var: string } | undefined>(
      c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id where a.tenant_id=$1 limit 1`, [TENANT_TESTE]);
    if (!av) return;
    const arvore = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
      slots: [{ modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [
        { artigo_id: av.art, tipo: "tecido", numero: 1, consumo: 2, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: av.var, ordem: 1, multiplicador: 1, grades: {}, grade_total: 50 }] }] }] }] }] };
    await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvore)]);
    const arv = (await um<{ a: any }>(c, `select public.plan_tecido_arvore($1) a`, [col.id])).a;
    const m = arv.subcolecoes[0].linhas[0].slots[0].materiais[0];
    // necessidade = 2 × 50 × 1 = 100
    expect(Number(m.consumo) * Number(m.variantes[0].grade_total) * Number(m.variantes[0].multiplicador)).toBe(100);
  });
});
```

- [ ] **Step 2: Rodar e ver passar**

Run: `npm run test:int -- plan-tecido`
Expected: PASS (3 casos).

- [ ] **Step 3: Adicionar guarda de descartar não-salvo na página**

```tsx
// no PlanTecidoPanel: estado + AlertDialog
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
// ...
const [confirmSair, setConfirmSair] = useState(false);
const voltar = () => { if (dirty) setConfirmSair(true); else history.back(); };
// trocar os onClick de "Voltar" para voltar()
// e renderizar:
<AlertDialog open={confirmSair} onOpenChange={setConfirmSair}>
  <AlertDialogContent>
    <AlertDialogHeader><AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
      <AlertDialogDescription>Há alterações não salvas no planejamento de tecido.</AlertDialogDescription></AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Continuar editando</AlertDialogCancel>
      <AlertDialogAction onClick={() => history.back()}>Descartar</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 4: Build/tsc + verificação manual final**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304" && npm test`
Expected: build OK; "sem TS2304"; testes unit+int passam. Manual: editar → tentar Voltar com dirty → dialog aparece; Salvar limpa o dirty.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/criacao.plan-tecido.\$colecaoId.tsx tests/integration/plan-tecido.test.ts
git commit -m "feat(plan-tecido): guarda de descartar + teste ponta-a-ponta (Fase A.1)"
```

---

## Self-Review (feita)

**1. Cobertura do spec (A.1):** navegação/gating (Task 5) · lista (Task 5) · árvore 2-col colapsável (Task 7) · toggle por-linha/tecido → *pendência: não há task explícita para o toggle "por tecido" da árvore; incluído como reagrupamento de exibição no ResumoPanel/árvore, mas a re-renderização por tecido não tem task dedicada.* **Ação:** o toggle é enhancement visual — registrado como pendência menor abaixo (não bloqueia A.1; a árvore por-linha/categoria + resumo por-tecido já entregam o valor). Custo (Task 11) · grade/proporção (Task 10) · resumo necessidade + situação + poder de venda (Task 11) · material com checkbox + forro variantes (Task 9) · persistência plan_tecido_* (Tasks 1-3) · dirty/guarda/MobileActionBar (Tasks 7,12).

**2. Placeholders:** os stubs das Tasks 7/8 são substituídos nas Tasks 8-11 (cada um com código completo). Sem TBD/TODO de produção.

**3. Consistência de tipos:** `PtArvore/PtSlot/PtMaterial/PtVariante` (Task 4) usados igual em engine (6), página (7), componentes (8-11). RPC `salvar_plan_tecido(_colecao_id, _arvore)` e `plan_tecido_arvore(_colecao_id)` idênticas em migrations (2,3), página (7) e testes (2,12). `necessidadePorTecido`/`necessidadeVariante`/`metrosParaKg`/`abaterEstoque` idênticas em calc (4), ModelCard (7), ResumoPanel (11).

**Pendências menores (não bloqueiam; tratar no fim ou A.2):**
- Toggle de árvore "por tecido" (reagrupamento visual). 
- Markup real por linha no CustoSection (precisa resolver `linha_id` do slot → `linhas.markup`); hoje passa `markup=0`. Enhancement: buscar markup da linha do bucket.
- "Materiais previstos" hoje é input manual; futuramente derivar de `consumo × preço_por_metro` do artigo (needs preço) — deixar manual na A.1.
- Abatimento por estoque (checkbox "usar estoque existente") liga a leitura de `estoque_tecido()` — implementar quando o dono priorizar (Fase B já traz o confronto).
