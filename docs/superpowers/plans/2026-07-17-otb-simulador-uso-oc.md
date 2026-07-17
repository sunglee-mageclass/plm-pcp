# Simulador de Uso de OC no OTB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um "Consumo por OC" simulado dentro do OTB: atribui uma OC real a uma coleção/subcoleção, digita consumo por peça, e mostra se o tecido daquela OC sobra ou estoura — salvável em cenários nomeados, com write-back estrutural no alvo do plano.

**Architecture:** 4 tabelas novas multi-tenant + 3 RPCs **INVOKER** (espelham `salvar_colecao_pv`, RLS + gate de módulo, sem `_core`/REVOKE). Um `Sheet` novo (`SimulacaoSheet`) com gerenciador de cenários (molde `PadraoMixSheet`) e árvore Unidade→Linha→Modelo (molde `ColecaoPVSheet`). Cálculo puro isolado em `src/lib/simulacao.ts` (testável). Botão **Simular** por card no `otb.index.tsx`. Write-back grava **direto no alvo do plano** (`colecao_pv_itens` / `colecao_semanas`), nunca em `modelos`.

**Tech Stack:** Vite + React + TS + TanStack Router/Query + Supabase (Postgres/RLS) + Tailwind/Radix. Testes: Vitest (unit puro + integração transacional `withTx`/`comoUsuario` contra o banco de produção revertido).

**Spec:** `docs/superpowers/specs/2026-07-16-otb-simulador-uso-oc-design.md` (revisão 2026-07-17).

## Global Constraints

Copiados do spec + CLAUDE.md. **Cada task herda isto:**

- **Módulo `otb` opt-in**: toda RPC checa `if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;`.
- **RPCs INVOKER, não DEFINER** (espelham `salvar_colecao_pv`): sem `SECURITY DEFINER`, `SET search_path TO 'public'`, checam `auth.uid()` + módulo; a RLS das 4 tabelas garante o tenant. **NÃO** aplicar o par `_core`/`REVOKE` (#9 é só p/ DEFINER) — não há `_core`.
- **4 tabelas multi-tenant**: `tenant_id uuid` (stampado por trigger `set_tenant_id`), RLS ligada com as **mesmas policies de `colecao_pv_itens`** (`tenant_select/insert/update/delete` por `tenant_id = get_user_tenant_id()`, insert também aceita `tenant_id IS NULL`).
- **Metragem da OC** = espelho de `consumo_por_oc`: `artigo.unidade_medida = 'kg' ? quantidade × artigo.rendimento : quantidade`. Base = `quantidade_pedida`; recebida (`quantidade_recebida`) é referência ao lado.
- **`qtd_semanas`** é jsonb `{ "<semana>": qtd }` (chave = nº da semana como string); `num_modelos` de uma linha = Σ dos valores; distribuição = `splitEven` (piso + resto nas primeiras semanas).
- **Write-back** grava **só o alvo do plano** (`colecao_pv_itens` no PV; `colecao_semanas.qtd_planejada` no Orçamento). **Nunca** cria/edita/apaga `modelos`. Orçamento **bloqueia** (RAISE) se o novo total deixaria alguma semana abaixo de Σ das categorias (`colecao_semana_categorias`).
- **Após aplicar**: front invalida `["otb-orcamento"]` + queries da coleção/editor.
- **AlertDialog** de confirmação no write-back.
- **Migration** por `psql "$(cat /tmp/dburl.txt)" -f`, **idempotente** (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS`+`CREATE POLICY`, `CREATE OR REPLACE TRIGGER`). Regenerar `types.ts` depois.
- **Antes de commitar**: `npm run build` **e** `npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551|TS2339" || true`.
- **Erros de usuário** em PT-BR; toasts via `toast.error(mensagemErro(e, "…"))`.

## File Structure

Todo o SQL numa migration só (aditiva/idempotente), construída incrementalmente pelas tasks 1–5:

- **Create:** `supabase/migrations/20260722100000_otb_simulador.sql` — 4 tabelas + 3 RPCs.
- **Create:** `src/lib/simulacao.ts` — cálculo puro (splitEven, metragem, demanda, saldo, distribuição).
- **Create:** `tests/unit/simulacao.test.ts` — unit do cálculo puro.
- **Create:** `tests/integration/otb-simulador.test.ts` — integração transacional das 3 RPCs.
- **Create:** `src/components/otb/SimulacaoSheet.tsx` — o Sheet (cenários + árvore + resultado + write-back).
- **Modify:** `src/routes/_authenticated/otb.index.tsx` — botão **Simular** por card + montar o Sheet.
- **Modify:** `src/integrations/supabase/types.ts` — regenerado (task 6).
- **Modify:** `CLAUDE.md` + memória (task 11).

---

### Task 1: Migration — 4 tabelas do simulador

**Files:**
- Create: `supabase/migrations/20260722100000_otb_simulador.sql`
- Test: `tests/integration/otb-simulador.test.ts` (bloco "tabelas")

**Interfaces:**
- Produces: tabelas `otb_simulacoes`, `otb_simulacao_unidades`, `otb_simulacao_linhas`, `otb_simulacao_modelos` (colunas/FKs abaixo), com RLS + `set_tenant_id`.

- [ ] **Step 1: Escrever o DDL** (início do arquivo de migration)

```sql
-- 20260722100000_otb_simulador.sql — Simulador de Uso de OC no OTB.
-- Tabelas + RPCs INVOKER (espelham salvar_colecao_pv). Idempotente/aditivo.
begin;

create table if not exists public.otb_simulacoes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid,
  colecao_id uuid not null references public.colecoes(id) on delete cascade,
  nome       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_otb_sim_colecao on public.otb_simulacoes(colecao_id);

create table if not exists public.otb_simulacao_unidades (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid,
  simulacao_id      uuid not null references public.otb_simulacoes(id) on delete cascade,
  subcolecao_id     uuid references public.colecao_subcolecoes(id) on delete cascade,
  oc_tecido_item_id uuid references public.ocs_tecido_itens(id) on delete set null,
  constraint uq_otb_sim_unidade unique nulls not distinct (simulacao_id, subcolecao_id)
);
create index if not exists idx_otb_sim_un_sim on public.otb_simulacao_unidades(simulacao_id);

create table if not exists public.otb_simulacao_linhas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid,
  unidade_id  uuid not null references public.otb_simulacao_unidades(id) on delete cascade,
  linha_id    uuid references public.linhas(id),
  prof_cor    integer not null default 0,
  cores       integer not null default 1,
  num_modelos integer not null default 0,
  ordem       integer not null default 0
);
create index if not exists idx_otb_sim_ln_un on public.otb_simulacao_linhas(unidade_id);

create table if not exists public.otb_simulacao_modelos (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid,
  linha_ref_id uuid not null references public.otb_simulacao_linhas(id) on delete cascade,
  modelo_id    uuid references public.modelos(id) on delete set null,
  slot_index   integer not null default 0,
  consumo      numeric not null default 0
);
create index if not exists idx_otb_sim_md_ln on public.otb_simulacao_modelos(linha_ref_id);

-- RLS + policies (mesmo shape de colecao_pv_itens) + stamp de tenant, nas 4 tabelas.
do $$
declare t text;
begin
  foreach t in array array['otb_simulacoes','otb_simulacao_unidades','otb_simulacao_linhas','otb_simulacao_modelos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format('drop policy if exists tenant_insert on public.%I', t);
    execute format('drop policy if exists tenant_update on public.%I', t);
    execute format('drop policy if exists tenant_delete on public.%I', t);
    execute format($f$create policy tenant_select on public.%I for select to authenticated using (tenant_id = get_user_tenant_id())$f$, t);
    execute format($f$create policy tenant_insert on public.%I for insert to authenticated with check (tenant_id = get_user_tenant_id() or tenant_id is null)$f$, t);
    execute format($f$create policy tenant_update on public.%I for update to authenticated using (tenant_id = get_user_tenant_id()) with check (tenant_id = get_user_tenant_id())$f$, t);
    execute format($f$create policy tenant_delete on public.%I for delete to authenticated using (tenant_id = get_user_tenant_id())$f$, t);
    execute format('create or replace trigger set_tenant_id_trg before insert on public.%I for each row execute function set_tenant_id()', t);
  end loop;
end $$;

commit;
```

- [ ] **Step 2: Aplicar a migration**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260722100000_otb_simulador.sql`
Expected: `BEGIN … CREATE TABLE … DO … COMMIT` sem erro.

- [ ] **Step 3: Verificar schema**

Run: `psql "$(cat /tmp/dburl.txt)" -c '\d public.otb_simulacao_unidades'`
Expected: colunas `subcolecao_id`, `oc_tecido_item_id`, constraint `uq_otb_sim_unidade` UNIQUE NULLS NOT DISTINCT, policies `tenant_*`, trigger `set_tenant_id_trg`.

- [ ] **Step 4: Escrever o teste de integração (tabelas)** — cria o arquivo com este bloco

```ts
import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, um, hasDb, TENANT_TESTE } from "./db";

const ligarOtb = (c: any) =>
  c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":true}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);

describe.skipIf(!hasDb)("OTB Simulador — tabelas", () => {
  it("insere simulação e o tenant vem por trigger (RLS)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarOtb(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-SIM','rascunho') returning id`, []);
      const sim = await um<{ id: string; tenant_id: string }>(
        c, `insert into otb_simulacoes (colecao_id, nome) values ($1,'Cenário 1') returning id, tenant_id`, [col.id]);
      expect(sim.tenant_id).toBe(TENANT_TESTE);
      const un = await um<{ tenant_id: string }>(
        c, `insert into otb_simulacao_unidades (simulacao_id, subcolecao_id) values ($1, null) returning tenant_id`, [sim.id]);
      expect(un.tenant_id).toBe(TENANT_TESTE);
    });
  });
});
```

- [ ] **Step 5: Rodar o teste**

Run: `npm run test:int -- tests/integration/otb-simulador.test.ts`
Expected: 1 passed (ou "skipped" se não houver `/tmp/dburl.txt` — nesse caso rode com o banco disponível).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260722100000_otb_simulador.sql tests/integration/otb-simulador.test.ts
git commit -m "feat(otb): tabelas do Simulador de Uso de OC (RLS + stamp de tenant)"
```

---

### Task 2: RPC `salvar_simulacao`

**Files:**
- Modify: `supabase/migrations/20260722100000_otb_simulador.sql` (adicionar a função ANTES do `commit;` final — mova o `commit;` pra depois de todas as RPCs conforme as tasks 2–5 forem entrando; a migration é reaplicada inteira a cada task)
- Test: `tests/integration/otb-simulador.test.ts`

**Interfaces:**
- Produces: `salvar_simulacao(_id uuid, _header jsonb, _arvore jsonb) returns uuid`.
  - `_header`: `{ colecao_id, nome }`.
  - `_arvore`: `[{ subcolecao_id?, oc_tecido_item_id?, linhas: [{ linha_id?, prof_cor, cores, num_modelos, modelos: [{ modelo_id?, slot_index, consumo }] }] }]`.

- [ ] **Step 1: Escrever o teste (create + re-save atômico + módulo off)**

```ts
describe.skipIf(!hasDb)("OTB Simulador — salvar_simulacao", () => {
  it("cria a árvore e re-salva substituindo (delete-and-reinsert)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarOtb(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-SIM2','rascunho') returning id`, []);
      const arvore = [{ subcolecao_id: null, oc_tecido_item_id: null,
        linhas: [{ linha_id: null, prof_cor: 8, cores: 3, num_modelos: 2,
          modelos: [{ slot_index: 0, consumo: 1.2 }, { slot_index: 1, consumo: 1.5 }] }] }];
      const id = (await um<{ id: string }>(c, `select public.salvar_simulacao(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify({ colecao_id: col.id, nome: "Cenário A" }), JSON.stringify(arvore)])).id;
      let chk = await um<{ un: string; ln: string; md: string }>(c,
        `select (select count(*) from otb_simulacao_unidades u where u.simulacao_id=$1)::text un,
                (select count(*) from otb_simulacao_linhas l join otb_simulacao_unidades u on u.id=l.unidade_id where u.simulacao_id=$1)::text ln,
                (select count(*) from otb_simulacao_modelos m join otb_simulacao_linhas l on l.id=m.linha_ref_id join otb_simulacao_unidades u on u.id=l.unidade_id where u.simulacao_id=$1)::text md`, [id]);
      expect(chk.un).toBe("1"); expect(chk.ln).toBe("1"); expect(chk.md).toBe("2");
      // re-salva com 1 modelo só → substitui
      const arvore2 = [{ subcolecao_id: null, oc_tecido_item_id: null,
        linhas: [{ linha_id: null, prof_cor: 8, cores: 3, num_modelos: 1, modelos: [{ slot_index: 0, consumo: 2 }] }] }];
      await c.query(`select public.salvar_simulacao($1, $2::jsonb, $3::jsonb)`,
        [id, JSON.stringify({ colecao_id: col.id, nome: "Cenário A2" }), JSON.stringify(arvore2)]);
      chk = await um<{ un: string; ln: string; md: string }>(c,
        `select (select count(*) from otb_simulacao_unidades u where u.simulacao_id=$1)::text un, '0' ln,
                (select count(*) from otb_simulacao_modelos m join otb_simulacao_linhas l on l.id=m.linha_ref_id join otb_simulacao_unidades u on u.id=l.unidade_id where u.simulacao_id=$1)::text md`, [id]);
      expect(chk.md).toBe("1");
      const nome = await um<{ nome: string }>(c, `select nome from otb_simulacoes where id=$1`, [id]);
      expect(nome.nome).toBe("Cenário A2");
    });
  });

  it("bloqueia quando o módulo otb está desligado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`delete from user_roles where user_id=(select id from users where tenant_id=$1 limit 1) and role='super_admin'`, [TENANT_TESTE]);
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":false}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome) values ('C-OFF') returning id`, []);
      await expect(c.query(`select public.salvar_simulacao(null, $1::jsonb, '[]'::jsonb)`,
        [JSON.stringify({ colecao_id: col.id, nome: "X" })])).rejects.toThrow();
    });
  });
});
```

> Nota: o bloco "módulo off" espelha `otb.test.ts` — remove o papel `super_admin` do usuário de teste (dentro da txn) pra que o gate de módulo seja avaliado. Use `USER_TESTE` do import se preferir (é o mesmo usuário do `TENANT_TESTE`).

- [ ] **Step 2: Rodar o teste (falha: função não existe)**

Run: `npm run test:int -- tests/integration/otb-simulador.test.ts -t "salvar_simulacao"`
Expected: FAIL (`function public.salvar_simulacao(...) does not exist`).

- [ ] **Step 3: Adicionar a RPC na migration** (antes do `commit;`)

```sql
create or replace function public.salvar_simulacao(_id uuid, _header jsonb, _arvore jsonb)
returns uuid language plpgsql set search_path to 'public' as $function$
declare
  v_id uuid := _id; v_colecao uuid; v_un jsonb; v_ln jsonb; v_md jsonb;
  v_un_id uuid; v_ln_id uuid; v_li int; v_mi int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;
  v_colecao := nullif(_header->>'colecao_id','')::uuid;
  if v_colecao is null then raise exception 'Informe a coleção.'; end if;
  if coalesce(btrim(_header->>'nome'),'') = '' then raise exception 'Informe o nome do cenário.'; end if;
  if not exists (select 1 from public.colecoes where id = v_colecao and tenant_id = public.get_user_tenant_id()) then
    raise exception 'Coleção não encontrada.';
  end if;

  if v_id is null then
    insert into public.otb_simulacoes (colecao_id, nome) values (v_colecao, btrim(_header->>'nome')) returning id into v_id;
  else
    update public.otb_simulacoes set nome = btrim(_header->>'nome')
      where id = v_id and colecao_id = v_colecao and tenant_id = public.get_user_tenant_id();
    if not found then raise exception 'Cenário não encontrado.'; end if;
    delete from public.otb_simulacao_unidades where simulacao_id = v_id;
  end if;

  for v_un in select value from jsonb_array_elements(coalesce(_arvore,'[]'::jsonb)) loop
    insert into public.otb_simulacao_unidades (simulacao_id, subcolecao_id, oc_tecido_item_id)
    values (v_id, nullif(v_un->>'subcolecao_id','')::uuid, nullif(v_un->>'oc_tecido_item_id','')::uuid)
    returning id into v_un_id;
    v_li := 0;
    for v_ln in select value from jsonb_array_elements(coalesce(v_un->'linhas','[]'::jsonb)) loop
      insert into public.otb_simulacao_linhas (unidade_id, linha_id, prof_cor, cores, num_modelos, ordem)
      values (v_un_id, nullif(v_ln->>'linha_id','')::uuid,
              greatest(0, coalesce((v_ln->>'prof_cor')::int, 0)),
              greatest(1, coalesce((v_ln->>'cores')::int, 1)),
              greatest(0, coalesce((v_ln->>'num_modelos')::int, 0)), v_li)
      returning id into v_ln_id;
      v_li := v_li + 1;
      v_mi := 0;
      for v_md in select value from jsonb_array_elements(coalesce(v_ln->'modelos','[]'::jsonb)) loop
        insert into public.otb_simulacao_modelos (linha_ref_id, modelo_id, slot_index, consumo)
        values (v_ln_id, nullif(v_md->>'modelo_id','')::uuid,
                coalesce((v_md->>'slot_index')::int, v_mi),
                greatest(0, coalesce((v_md->>'consumo')::numeric, 0)));
        v_mi := v_mi + 1;
      end loop;
    end loop;
  end loop;
  return v_id;
end $function$;
```

- [ ] **Step 4: Reaplicar a migration**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260722100000_otb_simulador.sql`
Expected: sem erro (tabelas já existem → no-op; função criada/atualizada).

- [ ] **Step 5: Rodar o teste (passa)**

Run: `npm run test:int -- tests/integration/otb-simulador.test.ts -t "salvar_simulacao"`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260722100000_otb_simulador.sql tests/integration/otb-simulador.test.ts
git commit -m "feat(otb): RPC salvar_simulacao (upsert atômico da árvore)"
```

---

### Task 3: RPC `excluir_simulacao`

**Files:**
- Modify: `supabase/migrations/20260722100000_otb_simulador.sql`
- Test: `tests/integration/otb-simulador.test.ts`

**Interfaces:**
- Produces: `excluir_simulacao(_id uuid) returns void` (cascata nas filhas via FK).

- [ ] **Step 1: Escrever o teste**

```ts
describe.skipIf(!hasDb)("OTB Simulador — excluir_simulacao", () => {
  it("apaga a simulação e cascateia as filhas", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarOtb(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome) values ('C-DEL-SIM') returning id`, []);
      const id = (await um<{ id: string }>(c, `select public.salvar_simulacao(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify({ colecao_id: col.id, nome: "Del" }),
         JSON.stringify([{ subcolecao_id: null, linhas: [{ prof_cor: 1, cores: 1, num_modelos: 1, modelos: [{ slot_index: 0, consumo: 1 }] }] }])])).id;
      await c.query(`select public.excluir_simulacao($1)`, [id]);
      const chk = await um<{ n: string; nun: string }>(c,
        `select (select count(*) from otb_simulacoes where id=$1)::text n,
                (select count(*) from otb_simulacao_unidades where simulacao_id=$1)::text nun`, [id]);
      expect(chk.n).toBe("0"); expect(chk.nun).toBe("0");
    });
  });
});
```

- [ ] **Step 2: Rodar (falha)** — `npm run test:int -- tests/integration/otb-simulador.test.ts -t "excluir_simulacao"` → FAIL.

- [ ] **Step 3: Adicionar a RPC**

```sql
create or replace function public.excluir_simulacao(_id uuid)
returns void language plpgsql set search_path to 'public' as $function$
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;
  delete from public.otb_simulacoes where id = _id and tenant_id = public.get_user_tenant_id();
  if not found then raise exception 'Cenário não encontrado.'; end if;
end $function$;
```

- [ ] **Step 4: Reaplicar** — `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260722100000_otb_simulador.sql`
- [ ] **Step 5: Rodar (passa)** — `npm run test:int -- tests/integration/otb-simulador.test.ts -t "excluir_simulacao"` → 1 passed.
- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(otb): RPC excluir_simulacao"
```

---

### Task 4: RPC `aplicar_simulacao` — ramo PV

**Files:**
- Modify: `supabase/migrations/20260722100000_otb_simulador.sql`
- Test: `tests/integration/otb-simulador.test.ts`

**Interfaces:**
- Produces: `aplicar_simulacao(_simulacao_id uuid, _unidade_id uuid) returns jsonb`. Nesta task só o ramo **PV** (`colecoes.tipo = 'poder_venda'`): para cada linha da unidade, `UPDATE colecao_pv_itens` (match `colecao_id, subcolecao_id, linha_id`) gravando `prof_cor`, `cores` e `qtd_semanas` (num redistribuído nas `colecao_subcolecoes.semanas` por splitEven). Retorna `{aplicado:true}`.

- [ ] **Step 1: Escrever o teste (PV grava prof/cores + qtd_semanas por splitEven)**

```ts
describe.skipIf(!hasDb)("OTB Simulador — aplicar_simulacao (PV)", () => {
  it("grava prof/cores e distribui o nº de modelos nas semanas", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarOtb(c);
      const linha = await um<{ id: string }>(c, `insert into linhas (nome) values ('L-SIM') returning id`, []);
      // coleção PV com 1 subcoleção (semanas 1..5) e 1 item de linha
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, tipo, status) values ('C-PV-SIM','poder_venda','rascunho') returning id`, []);
      const sub = await um<{ id: string }>(c, `insert into colecao_subcolecoes (colecao_id, nome, semanas) values ($1,'Sub', '{1,2,3,4,5}') returning id`, [col.id]);
      await c.query(`insert into colecao_pv_itens (colecao_id, subcolecao_id, linha_id, prof_cor, cores, qtd_semanas) values ($1,$2,$3, 4, 2, '{}'::jsonb)`, [col.id, sub.id, linha.id]);
      // simulação: mesma unidade/linha, prof 8 cores 3, 13 modelos
      const arvore = [{ subcolecao_id: sub.id, oc_tecido_item_id: null,
        linhas: [{ linha_id: linha.id, prof_cor: 8, cores: 3, num_modelos: 13, modelos: [] }] }];
      const simId = (await um<{ id: string }>(c, `select public.salvar_simulacao(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify({ colecao_id: col.id, nome: "Cen" }), JSON.stringify(arvore)])).id;
      const unId = (await um<{ id: string }>(c, `select id from otb_simulacao_unidades where simulacao_id=$1`, [simId])).id;
      const r = await um<{ obj: any }>(c, `select public.aplicar_simulacao($1,$2) as obj`, [simId, unId]);
      expect(r.obj.aplicado).toBe(true);
      const it = await um<{ prof: number; cores: number; q: any }>(c,
        `select prof_cor prof, cores, qtd_semanas q from colecao_pv_itens where colecao_id=$1 and subcolecao_id=$2 and linha_id=$3`, [col.id, sub.id, linha.id]);
      expect(it.prof).toBe(8); expect(it.cores).toBe(3);
      // splitEven(13,5) = [3,3,3,2,2]
      expect(it.q).toEqual({ "1": 3, "2": 3, "3": 3, "4": 2, "5": 2 });
      // idempotente: reaplicar dá o mesmo
      await c.query(`select public.aplicar_simulacao($1,$2)`, [simId, unId]);
      const it2 = await um<{ q: any }>(c, `select qtd_semanas q from colecao_pv_itens where colecao_id=$1 and subcolecao_id=$2 and linha_id=$3`, [col.id, sub.id, linha.id]);
      expect(it2.q).toEqual({ "1": 3, "2": 3, "3": 3, "4": 2, "5": 2 });
    });
  });
});
```

- [ ] **Step 2: Rodar (falha)** — FAIL (função não existe).

- [ ] **Step 3: Adicionar a RPC** (com o ramo PV completo + `else raise 'Orçamento…'` provisório que a Task 5 substitui pelo ramo real)

```sql
create or replace function public.aplicar_simulacao(_simulacao_id uuid, _unidade_id uuid)
returns jsonb language plpgsql set search_path to 'public' as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_colecao uuid; v_tipo text; v_sub uuid; v_semanas int[];
  v_ln record; v_q jsonb; v_n int; v_rem int; j int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;

  select s.colecao_id into v_colecao from public.otb_simulacoes s where s.id = _simulacao_id and s.tenant_id = v_tenant;
  if v_colecao is null then raise exception 'Cenário não encontrado.'; end if;
  select tipo into v_tipo from public.colecoes where id = v_colecao and tenant_id = v_tenant;

  select subcolecao_id into v_sub from public.otb_simulacao_unidades
    where id = _unidade_id and simulacao_id = _simulacao_id and tenant_id = v_tenant;
  if not found then raise exception 'Unidade não encontrada.'; end if;

  if v_tipo = 'poder_venda' then
    select coalesce(semanas, '{}') into v_semanas from public.colecao_subcolecoes where id = v_sub and colecao_id = v_colecao;
    for v_ln in select linha_id, prof_cor, cores, num_modelos from public.otb_simulacao_linhas where unidade_id = _unidade_id and linha_id is not null loop
      v_q := '{}'::jsonb;
      v_n := coalesce(array_length(v_semanas, 1), 0);
      if v_n > 0 then
        v_rem := v_ln.num_modelos - (v_ln.num_modelos / v_n) * v_n;   -- splitEven: resto nas primeiras
        for j in 1..v_n loop
          v_q := v_q || jsonb_build_object(v_semanas[j]::text, (v_ln.num_modelos / v_n) + (case when (j-1) < v_rem then 1 else 0 end));
        end loop;
      end if;
      update public.colecao_pv_itens
        set prof_cor = greatest(0, v_ln.prof_cor),
            cores    = greatest(0, v_ln.cores),
            qtd_semanas = case when v_n > 0 then v_q else qtd_semanas end
      where colecao_id = v_colecao and subcolecao_id = v_sub and linha_id = v_ln.linha_id and tenant_id = v_tenant;
    end loop;
  else
    raise exception 'Orçamento ainda não implementado.'; -- substituído na Task 5
  end if;

  return jsonb_build_object('aplicado', true);
end $function$;
```

- [ ] **Step 4: Reaplicar** — `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260722100000_otb_simulador.sql`
- [ ] **Step 5: Rodar (passa)** — `npm run test:int -- tests/integration/otb-simulador.test.ts -t "aplicar_simulacao (PV)"` → 1 passed.
- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(otb): aplicar_simulacao ramo PV (prof/cores + qtd_semanas splitEven)"
```

---

### Task 5: `aplicar_simulacao` — ramo Orçamento + guarda de categorias

**Files:**
- Modify: `supabase/migrations/20260722100000_otb_simulador.sql` (substituir o `else raise …` pelo ramo real)
- Test: `tests/integration/otb-simulador.test.ts`

**Interfaces:**
- Consumes/Produces: mesma assinatura `aplicar_simulacao`. Ramo Orçamento: distribui `Σ num_modelos` da unidade nas `colecao_semanas` da unidade (splitEven), gravando `qtd_planejada`. **Bloqueia** se alguma semana ficaria abaixo de `Σ colecao_semana_categorias.qtd`.

- [ ] **Step 1: Escrever os testes (aplica + bloqueia por categoria)**

```ts
describe.skipIf(!hasDb)("OTB Simulador — aplicar_simulacao (Orçamento)", () => {
  it("distribui o total nas semanas de colecao_semanas", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarOtb(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, tipo, status) values ('C-ORC-SIM','orcamento','rascunho') returning id`, []);
      const sub = await um<{ id: string }>(c, `insert into colecao_subcolecoes (colecao_id, nome, semanas) values ($1,'S','{1,2}') returning id`, [col.id]);
      await c.query(`insert into colecao_semanas (colecao_id, subcolecao_id, semana, qtd_planejada) values ($1,$2,'1',0),($1,$2,'2',0)`, [col.id, sub.id]);
      const arvore = [{ subcolecao_id: sub.id, linhas: [{ linha_id: null, prof_cor: 1, cores: 1, num_modelos: 7, modelos: [] }] }];
      const simId = (await um<{ id: string }>(c, `select public.salvar_simulacao(null,$1::jsonb,$2::jsonb) as id`,
        [JSON.stringify({ colecao_id: col.id, nome: "Cen" }), JSON.stringify(arvore)])).id;
      const unId = (await um<{ id: string }>(c, `select id from otb_simulacao_unidades where simulacao_id=$1`, [simId])).id;
      await c.query(`select public.aplicar_simulacao($1,$2)`, [simId, unId]);
      const sem = await um<{ s: string }>(c, `select string_agg(semana||':'||qtd_planejada, ',' order by semana) s from colecao_semanas where colecao_id=$1 and subcolecao_id=$2`, [col.id, sub.id]);
      expect(sem.s).toBe("1:4,2:3"); // splitEven(7,2)
    });
  });

  it("bloqueia se o novo total ficaria abaixo de Σ categorias da semana", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarOtb(c);
      const cat = await um<{ id: string }>(c, `select id from categorias_produto where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, tipo, status) values ('C-ORC-CAT','orcamento','rascunho') returning id`, []);
      const sub = await um<{ id: string }>(c, `insert into colecao_subcolecoes (colecao_id, nome, semanas) values ($1,'S','{1}') returning id`, [col.id]);
      await c.query(`insert into colecao_semanas (colecao_id, subcolecao_id, semana, qtd_planejada) values ($1,$2,'1',10)`, [col.id, sub.id]);
      await c.query(`insert into colecao_semana_categorias (colecao_id, subcolecao_id, semana, categoria_id, qtd) values ($1,$2,'1',$3,8)`, [col.id, sub.id, cat.id]);
      const arvore = [{ subcolecao_id: sub.id, linhas: [{ linha_id: null, prof_cor: 1, cores: 1, num_modelos: 3, modelos: [] }] }];
      const simId = (await um<{ id: string }>(c, `select public.salvar_simulacao(null,$1::jsonb,$2::jsonb) as id`,
        [JSON.stringify({ colecao_id: col.id, nome: "Cen" }), JSON.stringify(arvore)])).id;
      const unId = (await um<{ id: string }>(c, `select id from otb_simulacao_unidades where simulacao_id=$1`, [simId])).id;
      await c.query(`savepoint sp1`);
      await expect(c.query(`select public.aplicar_simulacao($1,$2)`, [simId, unId])).rejects.toThrow();
      await c.query(`rollback to savepoint sp1`);
      const q = await um<{ q: string }>(c, `select qtd_planejada::text q from colecao_semanas where colecao_id=$1 and subcolecao_id=$2 and semana='1'`, [col.id, sub.id]);
      expect(q.q).toBe("10"); // inalterado
    });
  });
});
```

- [ ] **Step 2: Rodar (falha)** — o teste "distribui" falha (`Orçamento ainda não implementado`).

- [ ] **Step 3: Substituir o `else raise …`** pelo ramo Orçamento:

```sql
  else
    -- Orçamento: distribui Σ num_modelos da unidade nas semanas de colecao_semanas dessa unidade.
    declare
      v_total int; v_nweeks int; v_rem int; v_new int; r record;
    begin
      select coalesce(sum(num_modelos), 0) into v_total from public.otb_simulacao_linhas where unidade_id = _unidade_id;
      select count(*) into v_nweeks from public.colecao_semanas
        where colecao_id = v_colecao and subcolecao_id is not distinct from v_sub and tenant_id = v_tenant;
      if v_nweeks = 0 then raise exception 'A coleção não tem semanas para aplicar.'; end if;
      v_rem := v_total - (v_total / v_nweeks) * v_nweeks;
      -- Guarda: nenhuma semana pode ficar abaixo de Σ categorias.
      for r in
        select semana, (row_number() over (order by semana)) - 1 as idx
        from public.colecao_semanas
        where colecao_id = v_colecao and subcolecao_id is not distinct from v_sub and tenant_id = v_tenant
        order by semana
      loop
        v_new := (v_total / v_nweeks) + (case when r.idx < v_rem then 1 else 0 end);
        if (select coalesce(sum(qtd), 0) from public.colecao_semana_categorias
              where colecao_id = v_colecao and subcolecao_id is not distinct from v_sub and semana = r.semana) > v_new then
          raise exception 'Ajuste as categorias da semana % no editor da coleção antes de aplicar (o novo total ficaria abaixo do já distribuído).', r.semana;
        end if;
      end loop;
      -- Aplica.
      for r in
        select semana, (row_number() over (order by semana)) - 1 as idx
        from public.colecao_semanas
        where colecao_id = v_colecao and subcolecao_id is not distinct from v_sub and tenant_id = v_tenant
        order by semana
      loop
        v_new := (v_total / v_nweeks) + (case when r.idx < v_rem then 1 else 0 end);
        update public.colecao_semanas set qtd_planejada = v_new
          where colecao_id = v_colecao and subcolecao_id is not distinct from v_sub and semana = r.semana and tenant_id = v_tenant;
      end loop;
    end;
  end if;
```

- [ ] **Step 4: Reaplicar** — `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260722100000_otb_simulador.sql`
- [ ] **Step 5: Rodar TODO o arquivo** — `npm run test:int -- tests/integration/otb-simulador.test.ts` → todos passam.
- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(otb): aplicar_simulacao ramo Orçamento (splitEven + guarda de categorias)"
```

---

### Task 6: Regenerar `types.ts`

**Files:**
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Regenerar** (a migration já está aplicada em produção)

Run:
```bash
supabase gen types typescript --db-url "$(cat /tmp/dburl.txt)" --schema public > src/integrations/supabase/types.ts
```
Expected: arquivo reescrito; `git diff --stat` mostra `types.ts` alterado.

- [ ] **Step 2: Conferir que as tabelas/RPCs novas entraram**

Run: `grep -nE "otb_simulac|salvar_simulacao|aplicar_simulacao|excluir_simulacao" src/integrations/supabase/types.ts | head`
Expected: linhas dos 4 `Tables` novos + 3 `Functions`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551" || echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(otb): regenera types.ts com as tabelas/RPCs do simulador"
```

---

### Task 7: `src/lib/simulacao.ts` — cálculo puro + unit tests

**Files:**
- Create: `src/lib/simulacao.ts`
- Test: `tests/unit/simulacao.test.ts`

**Interfaces:**
- Produces:
  - `splitEven(total: number, n: number): number[]`
  - `metragemDisponivel(unidadeMedida: string | null, quantidade: number, rendimento: number | null): number`
  - `pecasLinha(profCor: number, cores: number): number`
  - `demandaLinha(profCor: number, cores: number, consumos: number[]): number`
  - `saldo(disponivel: number, demanda: number): number`
  - `distribuirNasSemanas(num: number, semanas: number[]): Record<string, number>`

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, it, expect } from "vitest";
import { splitEven, metragemDisponivel, pecasLinha, demandaLinha, saldo, distribuirNasSemanas } from "@/lib/simulacao";

describe("simulacao — cálculo puro", () => {
  it("splitEven reparte o resto nas primeiras", () => {
    expect(splitEven(13, 5)).toEqual([3, 3, 3, 2, 2]);
    expect(splitEven(10, 5)).toEqual([2, 2, 2, 2, 2]);
    expect(splitEven(3, 0)).toEqual([]);
    expect(splitEven(0, 3)).toEqual([0, 0, 0]);
  });
  it("metragem: kg converte por rendimento; metro é direto", () => {
    expect(metragemDisponivel("kg", 100, 4)).toBe(400);
    expect(metragemDisponivel("metro", 250, 4)).toBe(250);
    expect(metragemDisponivel("kg", 100, null)).toBe(0);
  });
  it("peças e demanda", () => {
    expect(pecasLinha(8, 3)).toBe(24);
    // 2 modelos × 24 peças × consumos 1,2 e 1,5 → 24*1.2 + 24*1.5
    expect(demandaLinha(8, 3, [1.2, 1.5])).toBeCloseTo(24 * 1.2 + 24 * 1.5, 5);
  });
  it("saldo e distribuição", () => {
    expect(saldo(900, 172.8)).toBeCloseTo(727.2, 5);
    expect(distribuirNasSemanas(13, [1, 2, 3, 4, 5])).toEqual({ "1": 3, "2": 3, "3": 3, "4": 2, "5": 2 });
    expect(distribuirNasSemanas(5, [])).toEqual({});
  });
});
```

- [ ] **Step 2: Rodar (falha)** — `npm test -- tests/unit/simulacao.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// Cálculo puro do Simulador de Uso de OC (sem I/O; testável).
// Espelha a distribuição do editor PV (splitEven) e a metragem de consumo_por_oc.

/** Reparte um inteiro igualmente em n baldes; o resto vai pros primeiros. */
export const splitEven = (total: number, n: number): number[] => {
  if (n <= 0) return [];
  const base = Math.floor(total / n), rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
};

/** Metragem do item de OC: kg converte por rendimento; unidade em metro é direto. */
export const metragemDisponivel = (unidadeMedida: string | null, quantidade: number, rendimento: number | null): number =>
  (unidadeMedida === "kg" ? (quantidade || 0) * (rendimento || 0) : (quantidade || 0));

/** Peças de uma linha = profundidade × cores (Orçamento: cores = 1). */
export const pecasLinha = (profCor: number, cores: number): number => (profCor || 0) * (cores || 0);

/** Demanda (m) de uma linha = Σ dos modelos (peças × consumo). Sem perda. */
export const demandaLinha = (profCor: number, cores: number, consumos: number[]): number => {
  const p = pecasLinha(profCor, cores);
  return consumos.reduce((s, c) => s + p * (c || 0), 0);
};

/** Saldo = disponível − demanda (≥0 sobra, <0 estoura). */
export const saldo = (disponivel: number, demanda: number): number => (disponivel || 0) - (demanda || 0);

/** Distribui `num` nas semanas dadas (chaves string), via splitEven. */
export const distribuirNasSemanas = (num: number, semanas: number[]): Record<string, number> => {
  const shares = splitEven(num, semanas.length);
  const out: Record<string, number> = {};
  semanas.forEach((w, i) => { out[String(w)] = shares[i] ?? 0; });
  return out;
};
```

- [ ] **Step 4: Rodar (passa)** — `npm test -- tests/unit/simulacao.test.ts` → passed.
- [ ] **Step 5: Commit**

```bash
git add src/lib/simulacao.ts tests/unit/simulacao.test.ts
git commit -m "feat(otb): cálculo puro do simulador (src/lib/simulacao.ts) + unit tests"
```

---

### Task 8: `SimulacaoSheet.tsx` — cenários + árvore + resultado (sem write-back)

**Files:**
- Create: `src/components/otb/SimulacaoSheet.tsx`

**Interfaces:**
- Consumes: `src/lib/simulacao.ts` (task 7); RPCs `salvar_simulacao`/`excluir_simulacao` (tasks 2–3).
- Produces: `export function SimulacaoSheet({ colecaoId, tipo, onClose }: { colecaoId: string; tipo: string; onClose: () => void }): JSX.Element`.

**Padrões a espelhar (ler antes):**
- Gerenciador de cenários (pílulas + criar/renomear/excluir + dirty `•` + Sel/Lbl): `src/components/otb/PadraoMixSheet.tsx:39-224`.
- Hidratação da coleção + `splitEven`/embed: `src/components/otb/ColecaoPVSheet.tsx:26-171`.
- `Sheet`/`SheetContent side="right" className="w-full sm:max-w-[70vw] flex flex-col p-0"`, footer com `Voltar` (mr-auto) → `PadraoMixSheet.tsx:106-206`.

**Modelo de dados (estado local):**
```ts
type ModeloSim = { id: string; modeloId: string | null; consumo: number; ref?: string | null; nome?: string | null };
type LinhaSim  = { id: string; linhaId: string | null; profCor: number; cores: number; modelos: ModeloSim[] };
type UnidadeSim = { id: string; subcolecaoId: string | null; nomeUnidade: string; ocItemId: string | null; linhas: LinhaSim[] };
type Cenario = { id: string; nome: string; unidades: UnidadeSim[] };
```

- [ ] **Step 1: Imports + helpers + seleção de OC**

Cabeçalho igual a `ColecaoPVSheet` (imports de `useQuery/useMutation/useQueryClient`, `supabase`, `toast`, `mensagemErro`, `Sheet*`, `Button`, `Input`, `Card`, `Badge`, `Select*`, `AlertDialog*`, ícones `Plus/Trash2/Pencil/Save/ArrowLeft/ChevronRight`) + `import { splitEven, metragemDisponivel, demandaLinha, saldo } from "@/lib/simulacao";`. Reaproveitar `nid`/`num`/`Sel`/`Lbl` do `PadraoMixSheet` (copiar — são triviais).

Queries de leitura (dentro do componente):
```ts
// Cenários salvos desta coleção
const { data: cenarios = [] } = useQuery({
  queryKey: ["otb-simulacoes", colecaoId],
  queryFn: async () => {
    const { data, error } = await supabase.from("otb_simulacoes" as any)
      .select("id, nome, unidades:otb_simulacao_unidades(id, subcolecao_id, oc_tecido_item_id, linhas:otb_simulacao_linhas(id, linha_id, prof_cor, cores, num_modelos, ordem, modelos:otb_simulacao_modelos(id, modelo_id, slot_index, consumo)))")
      .eq("colecao_id", colecaoId).order("created_at");
    if (error) throw error; return (data ?? []) as any[];
  },
});
// Estrutura do plano (p/ semear a árvore): PV lê colecao_pv_itens; Orçamento lê colecao_semanas.
const { data: plano } = useQuery({
  queryKey: ["otb-sim-plano", colecaoId, tipo],
  queryFn: async () => {
    const { data, error } = await supabase.from("colecoes" as any)
      .select("id, tipo, subcolecoes:colecao_subcolecoes(id, nome, ordem, semanas), itens:colecao_pv_itens(subcolecao_id, linha_id, prof_cor, cores, qtd_semanas), semanas:colecao_semanas(subcolecao_id, semana, qtd_planejada)")
      .eq("id", colecaoId).single();
    if (error) throw error; return data as any;
  },
});
// Modelos reais (foto/ref) quando confirmada
const { data: modelosReais = [] } = useQuery({
  queryKey: ["otb-sim-modelos", colecaoId],
  queryFn: async () => (await supabase.from("modelos").select("id, ref, nome, fotos_modelo, subcolecao, linha_id").eq("colecao_id", colecaoId)).data ?? [],
});
// OCs de tecido + itens p/ o seletor da trava
const { data: ocs = [] } = useQuery({
  queryKey: ["otb-sim-ocs"],
  queryFn: async () => (await supabase.from("ocs_tecido" as any)
    .select("id, numero_pedido, itens:ocs_tecido_itens(id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida, artigo:artigos(nome, unidade_medida, rendimento))")
    .order("created_at", { ascending: false })).data ?? [] as any[],
});
const linhaOpts = useQuery({ queryKey: ["padrao-linhas"], queryFn: async () => (await supabase.from("linhas").select("id, nome").order("nome")).data ?? [] }).data ?? [];
const nomeLinha = (id: string | null) => (linhaOpts as any[]).find((l) => l.id === id)?.nome ?? "Linha";
```

- [ ] **Step 2: Semear a árvore a partir do plano** (função `semear(): UnidadeSim[]`)

Regra:
- **PV** (`tipo === "poder_venda"`): uma unidade por subcoleção (de `plano.subcolecoes`). Para cada `colecao_pv_itens` da subcoleção → uma `LinhaSim` (`profCor`, `cores`, `linhaId`), `num = Σ qtd_semanas`, explodido em `num` `ModeloSim` (slots). Casar `modelosReais` por (`subcolecao`==nome da sub, `linha_id`) em ordem → preencher `ref/nome/modeloId`; slots sobrando ficam anônimos.
- **Orçamento** (senão): uma unidade por subcoleção presente em `plano.semanas` (ou uma única unidade `subcolecaoId=null` se as semanas têm `subcolecao_id` null). Uma `LinhaSim` sintética (`linhaId=null`, `cores=1`, `profCor=1`), `num = Σ qtd_planejada` da unidade, explodido em slots.

```ts
const semear = (): UnidadeSim[] => {
  if (!plano) return [];
  const modByKey = (subNome: string, linhaId: string | null) =>
    (modelosReais as any[]).filter((m) => (m.subcolecao ?? "") === subNome && (m.linha_id ?? null) === linhaId);
  if (tipo === "poder_venda") {
    const subs = [...(plano.subcolecoes ?? [])].sort((a: any, b: any) => (a.ordem ?? 0) - (b.ordem ?? 0));
    return subs.map((sc: any) => {
      const its = (plano.itens ?? []).filter((it: any) => it.subcolecao_id === sc.id);
      const linhas: LinhaSim[] = its.map((it: any) => {
        const num = Object.values((it.qtd_semanas ?? {}) as Record<string, number>).reduce((s, v) => s + (Number(v) || 0), 0);
        const reais = modByKey(sc.nome, it.linha_id);
        const modelos: ModeloSim[] = Array.from({ length: num }, (_, i) => ({
          id: nid("m"), modeloId: reais[i]?.id ?? null, consumo: 0, ref: reais[i]?.ref, nome: reais[i]?.nome,
        }));
        return { id: nid("l"), linhaId: it.linha_id ?? null, profCor: Number(it.prof_cor) || 0, cores: Number(it.cores) || 0, modelos };
      });
      return { id: nid("u"), subcolecaoId: sc.id, nomeUnidade: sc.nome, ocItemId: null, linhas };
    });
  }
  // Orçamento
  const bySub = new Map<string | null, number>();
  for (const s of (plano.semanas ?? [])) bySub.set(s.subcolecao_id ?? null, (bySub.get(s.subcolecao_id ?? null) ?? 0) + (Number(s.qtd_planejada) || 0));
  const nomeSub = (id: string | null) => (plano.subcolecoes ?? []).find((x: any) => x.id === id)?.nome ?? "Coleção";
  return [...bySub.entries()].map(([subId, num]) => {
    const modelos: ModeloSim[] = Array.from({ length: num }, (_, i) => ({ id: nid("m"), modeloId: null, consumo: 0 }));
    return { id: nid("u"), subcolecaoId: subId, nomeUnidade: nomeSub(subId), ocItemId: null,
      linhas: [{ id: nid("l"), linhaId: null, profCor: 1, cores: 1, modelos }] };
  });
};
```

- [ ] **Step 3: Estado de cenários** (espelha `PadraoMixSheet.tsx:54-96`)

`selId`, `draft: Cenario`, `draftFor`, `dirty`, `editNome`. `useEffect` seleciona o 1º cenário; ao trocar de cenário, `mapCenarioFromDb(row)` mapeia do banco preservando consumo **e guarda `dbId`** em cada `UnidadeSim` (o `type UnidadeSim` ganha `dbId?: string`, usado no write-back da Task 9). Botão **"+ Cenário"** cria via `salvar_simulacao(null, {colecao_id, nome:'Cenário N'}, semear())` (semeia do plano). Renomear inline. Excluir com `AlertDialog` → `excluir_simulacao({ _id })`.

```ts
const mapCenarioFromDb = (row: any): Cenario => ({
  id: row.id, nome: row.nome,
  unidades: [...(row.unidades ?? [])].map((u: any) => ({
    id: nid("u"), dbId: u.id, subcolecaoId: u.subcolecao_id ?? null,
    nomeUnidade: nomeUnidadeDe(u.subcolecao_id), ocItemId: u.oc_tecido_item_id ?? null,
    linhas: [...(u.linhas ?? [])].sort((a: any, b: any) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((l: any) => ({
      id: nid("l"), linhaId: l.linha_id ?? null, profCor: Number(l.prof_cor) || 0, cores: Number(l.cores) || 0,
      modelos: [...(l.modelos ?? [])].sort((a: any, b: any) => (a.slot_index ?? 0) - (b.slot_index ?? 0)).map((m: any) => ({
        id: nid("m"), modeloId: m.modelo_id ?? null, consumo: Number(m.consumo) || 0,
      })),
    })),
  })),
});
```

- [ ] **Step 3b: Botão "Re-puxar do OTB"** — re-semeia a árvore do estado atual do plano **preservando o consumo já digitado**. Roda `semear()` e, para cada slot novo, copia o `consumo` do draft atual casando por `modeloId` (quando houver) senão por (`subcolecaoId`, `linhaId`, `slot index`). Marca `dirty`.

```ts
const repuxar = () => {
  const antigos = new Map<string, number>(); // chave → consumo
  draft.unidades.forEach((u) => u.linhas.forEach((l) => l.modelos.forEach((m, i) => {
    antigos.set(m.modeloId ?? `${u.subcolecaoId}|${l.linhaId}|${i}`, m.consumo);
  })));
  const unidades = semear().map((u) => ({ ...u, linhas: u.linhas.map((l) => ({ ...l,
    modelos: l.modelos.map((m, i) => ({ ...m, consumo: antigos.get(m.modeloId ?? `${u.subcolecaoId}|${l.linhaId}|${i}`) ?? 0 })) })) }));
  setDraft((d) => ({ ...d, unidades })); setDirty(true);
};
```
Botão no topo da árvore: `<Button variant="outline" size="sm" onClick={repuxar}>Re-puxar do OTB</Button>`.

```ts
const salvar = useMutation({
  mutationFn: async () => {
    const arvore = draft.unidades.map((u) => ({
      subcolecao_id: u.subcolecaoId, oc_tecido_item_id: u.ocItemId,
      linhas: u.linhas.map((l) => ({ linha_id: l.linhaId, prof_cor: l.profCor, cores: l.cores, num_modelos: l.modelos.length,
        modelos: l.modelos.map((m, i) => ({ modelo_id: m.modeloId, slot_index: i, consumo: m.consumo })) })),
    }));
    const { data, error } = await supabase.rpc("salvar_simulacao" as any, { _id: selId, _header: { colecao_id: colecaoId, nome: draft.nome.trim() }, _arvore: arvore });
    if (error) throw error; return data as string;
  },
  onSuccess: () => { toast.success("Cenário salvo."); setDirty(false); qc.invalidateQueries({ queryKey: ["otb-simulacoes", colecaoId] }); },
  onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar o cenário.")),
});
```

- [ ] **Step 4: Render da árvore + resultado** — Card por unidade:
  - Seletor **OC → item** (`Sel` aninhado: primeiro a OC, depois o item; ao escolher, `patch(u, { ocItemId })`). Mostrar `metragemDisponivel(art.unidade_medida, quantidade_pedida, art.rendimento)` como **Disponível** e a recebida ao lado.
  - Por linha (PV mostra prof/cores editáveis; Orçamento mostra só "grade" = `profCor`): inputs `profCor`/`cores`, botão **+ Modelo** (adiciona slot), **"aplicar consumo a todos"**.
  - Por modelo: `peças = profCor × cores`, input **consumo**; se `modeloId` → mostrar **foto + ref/nome** do card real. A foto sai de `modelos.fotos_modelo[0]` renderizada via `useSignedUrl` (padrão do projeto — ver `@/lib/storage-tenant`/`useSignedUrl`; thumbnail `h-8 w-8 rounded object-cover`, com fallback "Modelo N" quando sem foto/anônimo). Para ter a foto, incluir `fotos_modelo` no `select` de `modelosReais` (Step 1).
  - **Resultado** por unidade: `demanda = Σ demandaLinha(...)`; `disp = metragem do item`; `saldo(disp, demanda)`: verde "sobram X m" / vermelho "faltam X m". Barra `% = demanda/disp`.

  (JSX mecânico — espelhe os Cards/inputs de `PadraoMixSheet.tsx:163-194` e a barra de progresso de `ColecaoPVSheet`/`otb.index.tsx:222`.)

- [ ] **Step 5: Footer** — `Voltar` (mr-auto, `ArrowLeft`), `Salvar` (disabled se `!dirty`). (Botão **Aplicar** entra na Task 9.)

- [ ] **Step 6: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551|TS2339" || echo OK` → `OK`
Run: `npm run build` → sucesso.

- [ ] **Step 7: Commit**

```bash
git add src/components/otb/SimulacaoSheet.tsx
git commit -m "feat(otb): SimulacaoSheet — cenários + árvore Unidade/Linha/Modelo + resultado"
```

---

### Task 9: Write-back ("Aplicar no card da coleção")

**Files:**
- Modify: `src/components/otb/SimulacaoSheet.tsx`

**Interfaces:**
- Consumes: `aplicar_simulacao` (tasks 4–5).

- [ ] **Step 1: Mutation + AlertDialog + botão por unidade**

```ts
const [confirmAplicar, setConfirmAplicar] = useState<{ unidadeId: string; nome: string } | null>(null);
const aplicar = useMutation({
  mutationFn: async (unidadeDbId: string) => {
    const { error } = await supabase.rpc("aplicar_simulacao" as any, { _simulacao_id: selId, _unidade_id: unidadeDbId });
    if (error) throw error;
  },
  onSuccess: () => {
    toast.success("Valores aplicados no card da coleção.");
    setConfirmAplicar(null);
    qc.invalidateQueries({ queryKey: ["otb-orcamento"] });        // total do plano mudou
    qc.invalidateQueries({ queryKey: ["colecao-pv", colecaoId] });
    qc.invalidateQueries({ queryKey: ["otb-sim-plano", colecaoId, tipo] });
    qc.invalidateQueries({ queryKey: ["otb-colecoes"] });
  },
  onError: (e: any) => { setConfirmAplicar(null); toast.error(mensagemErro(e, "Erro ao aplicar no card.")); },
});
```

> **Importante:** `aplicar_simulacao` recebe o **id da unidade no banco** (`otb_simulacao_unidades.id`), não o id local (`u.id`). O botão Aplicar deve estar **desabilitado até o cenário estar salvo sem alterações pendentes** (`!dirty && !!selId`), e usar o id do banco. Como o `draft` local não guarda o db-id da unidade após `semear()`, **salvar antes de aplicar**: no `onClick` do Aplicar, se `dirty`, primeiro `await salvar.mutateAsync()`, depois re-ler a unidade do cenário salvo (casar por `subcolecao_id`) e chamar `aplicar`. Simplificação recomendada: **desabilitar Aplicar enquanto `dirty`** e, ao mapear o cenário salvo do banco (`mapCenarioFromDb`), **guardar `dbId` em cada `UnidadeSim`** (`type UnidadeSim` ganha `dbId?: string`). Aí `aplicar.mutate(u.dbId)`.

- [ ] **Step 2: Renderizar o botão** "Aplicar no card" por unidade (ao lado do resultado), abrindo `confirmAplicar`. `AlertDialog`:
  - Título: "Aplicar no card da coleção?"
  - Descrição: "Isto grava profundidade, cores e nº de modelos desta unidade **no plano da coleção**. Não altera os cards já criados no Planejamento."
  - Ação → `aplicar.mutate(confirmAplicar.unidadeId)`.

- [ ] **Step 3: Type-check + build** — `npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551|TS2339" || echo OK` → OK; `npm run build` → sucesso.

- [ ] **Step 4: Commit**

```bash
git add src/components/otb/SimulacaoSheet.tsx
git commit -m "feat(otb): write-back do simulador (Aplicar no card) com AlertDialog + invalidações"
```

---

### Task 10: Botão "Simular" no `otb.index.tsx`

**Files:**
- Modify: `src/routes/_authenticated/otb.index.tsx`

**Interfaces:**
- Consumes: `SimulacaoSheet` (tasks 8–9).

- [ ] **Step 1: Import + estado**

Adicionar `import { SimulacaoSheet } from "@/components/otb/SimulacaoSheet";` e, junto dos outros `useState` (linha ~44):
```ts
const [simOpen, setSimOpen] = useState<{ colecaoId: string; tipo: string } | null>(null);
```

- [ ] **Step 2: Converter o card de `<button>` para `<div role="button">`** (o `<button>` envolve tudo hoje — `otb.index.tsx:203`; um `<button>` Simular aninhado seria HTML inválido). Trocar a linha 203:
```tsx
// antes: <button key={c.id} onClick={() => abrirColecao(c)} title={orcTitle} className={`text-left rounded-lg border border-l-4 ${borderCor} p-3 hover:bg-muted`}>
<div key={c.id} role="button" tabIndex={0} onClick={() => abrirColecao(c)}
  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrirColecao(c); } }}
  title={orcTitle} className={`relative text-left rounded-lg border border-l-4 ${borderCor} p-3 hover:bg-muted cursor-pointer`}>
```
e o `</button>` de fecho (linha 282) vira `</div>`.

- [ ] **Step 3: Adicionar o botão Simular** (dentro do card, no cluster do topo — `otb.index.tsx:206-210`, junto dos badges), com `stopPropagation` pra não abrir o editor:
```tsx
<Button variant="ghost" size="iconSm" title="Simular uso de OC"
  onClick={(e) => { e.stopPropagation(); setSimOpen({ colecaoId: c.id, tipo: c.tipo }); }}>
  <Calculator className="h-4 w-4 text-muted-foreground" />
</Button>
```
(Importar `Calculator` de `lucide-react`.)

- [ ] **Step 4: Montar o Sheet** (perto de onde `ColecaoPVSheet`/`PadraoMixSheet` são montados — `otb.index.tsx:291-296`):
```tsx
{simOpen && <SimulacaoSheet colecaoId={simOpen.colecaoId} tipo={simOpen.tipo} onClose={() => setSimOpen(null)} />}
```

- [ ] **Step 5: Type-check + build** — `npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551|TS2339" || echo OK` → OK; `npm run build` → sucesso.

- [ ] **Step 6: Commit**

```bash
git add src/routes/_authenticated/otb.index.tsx
git commit -m "feat(otb): botão Simular por card abre o SimulacaoSheet"
```

---

### Task 11: Docs, memória e verificação final

**Files:**
- Modify: `CLAUDE.md` (bloco **otb**), memória (`project_otb_open_to_buy.md` + índice se necessário)

- [ ] **Step 1: CLAUDE.md** — no bloco **otb** do "Mapa de rotas", acrescentar uma frase:
  > **Simulador de Uso de OC** (`SimulacaoSheet`, botão Simular por card): "Consumo por OC" simulado — atribui um item de OC real (metragem = espelho de `consumo_por_oc`), digita consumo por modelo, mostra sobra/estoura; cenários em `otb_simulacoes/_unidades/_linhas/_modelos` (RPCs INVOKER `salvar_simulacao`/`excluir_simulacao`/`aplicar_simulacao`). Write-back grava **só o alvo do plano** (`colecao_pv_itens`/`colecao_semanas`), nunca cards; Orçamento bloqueia se quebraria Σcat ≤ qtd. Invalida `["otb-orcamento"]` ao aplicar.

- [ ] **Step 2: Memória** — atualizar `project_otb_open_to_buy.md`: trocar o "PENDENTE simulador" por "FEITO (jul/2026): Simulador de Uso de OC…" com o resumo das RPCs e do write-back desacoplado. (Papel do `docs-keeper`.)

- [ ] **Step 3: Verificação final da suíte**

Run: `npm run build` → sucesso
Run: `npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551|TS2339" || echo OK` → `OK`
Run: `npm test -- tests/unit/simulacao.test.ts` → passed
Run: `npm run test:int -- tests/integration/otb-simulador.test.ts` → passed

- [ ] **Step 4: Commit + push**

```bash
git add -A && git commit -m "docs(otb): registra o Simulador de Uso de OC (CLAUDE.md + memória)"
git push origin main
```

---

## Notas de execução (side effects a revisar por task)

- **Embeds PostgREST**: os `select` do `SimulacaoSheet` usam embeds aninhados (`otb_simulacao_unidades(... linhas(... modelos(...)))` e `ocs_tecido(... itens(... artigo(...)))`). Confirmar que os nomes de FK batem após o `types.ts` regenerado (Task 6 antes das tasks de front).
- **queryKeys**: `["otb-simulacoes", colecaoId]`, `["otb-sim-plano", colecaoId, tipo]`, `["otb-sim-modelos", colecaoId]`, `["otb-sim-ocs"]`, `["padrao-linhas"]` (reusada — mesmo shape `{id,nome}`). Ao aplicar, invalidar `["otb-orcamento"]` + `["colecao-pv", colecaoId]` + `["otb-colecoes"]`.
- **RLS**: as 4 tabelas só têm policies `TO authenticated`; a leitura no app é sempre autenticada. Módulo off → o botão Simular ainda aparece (a tela OTB só existe com módulo on), então sem gate extra no front.
- **Ordem**: Tasks 1–5 (backend) → 6 (types) → 7 (lib) → 8–9 (Sheet) → 10 (wire) → 11 (docs). O front (8+) depende do `types.ts` regenerado (6).
