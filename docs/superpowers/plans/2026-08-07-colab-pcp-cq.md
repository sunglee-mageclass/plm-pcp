# Colaboração multi-usuário no PCP Serviços + CQ (rev + merge 3-vias) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proteger PCP Serviços (`pcp.servicos`) e CQ (`expedicao.cq`) contra lost-update com o padrão colab já provado (rev + `_rev_base` + P0409 + merge 3-vias), com grão fino: `rev` por bloco em `producao_terceirizados` e `rev` por cad em `controle_qualidade`, mais um merge NOVO por-célula da grade compartilhada (`grade_detalhe` do bloco-fonte da Grade Cortada).

**Architecture:** Reusa a infra existente (`useColabRegistro`, `mergeDraft`/`mergeLinhas`/`igual`, `ColabBanner`, `POR_CODIGO.P0409`, triggers `fn_colab_touch_rev`). Backend: `rev` aditivo nas 2 tabelas + triggers de bump + publicação Realtime; `salvar_terceirizados` checa `_rev_base` POR BLOCO; `salvar_cq`/`_salvar_cq_core` checam DOIS lados (`{cq, fonte}`). Front: `useColabRegistro` (estendido p/ as 2 tabelas novas + filtro por `cad_id`) + `ColabBanner` + refs-espelho + retry P0409 síncrono no `onError`, exatamente como o piloto OC Tecido. Peça NOVA: helper puro `mergeGrade(base, meu, fresh, tocadas)` por célula (variante×tamanho×campo), unit-testado.

**Tech Stack:** Postgres (PL/pgSQL, SECURITY DEFINER, triggers, Realtime publication) · React + TanStack Query · TypeScript · Vitest (unit puro + integração transacional revertida `BEGIN…ROLLBACK`).

## Global Constraints

Copiadas verbatim da spec (`docs/superpowers/specs/2026-08-07-colab-pcp-cq-design.md`) e das invariantes do `CLAUDE.md`. Todo task herda estas regras.

- **`rev` por bloco em `producao_terceirizados`** (cobre PCP + o `grade_detalhe` compartilhado, inclusive o do bloco-fonte que o CQ grava); **`rev` por cad em `controle_qualidade`** (só CQ: status/datas/`cq_variantes`). Colunas aditivas `rev int not null default 0`. (Nota: a infra existente usa `default 1` em `modelos`/`ocs_tecido`; a spec pediu `default 0` para estas duas — o valor default é irrelevante para a corretude, pois `fn_colab_touch_rev` faz `new.rev = old.rev + 1`.)
- **`salvar_terceirizados`** checa `_rev_base jsonb = {bloco_id: rev}` POR BLOCO; bloco novo (sem id) NÃO trava; `_rev_base` null/ausente = bypass (compat + super_admin); bump é automático (trigger BEFORE UPDATE em cada bloco tocado).
- **`salvar_cq`** checa `_rev_base jsonb = {cq: rev, fonte: rev|null}` — `cq` sempre (se a linha já existe), `fonte` só se há bloco-fonte E `_rev_base.fonte` não-nulo; bump do `cq` sempre (UPDATE em `controle_qualidade`) e do bloco-fonte quando grava `grade_detalhe` (ambos via trigger).
- **Trava tenant-uniforme com bypass `is_super_admin()`**: a SELECT do rev filtra `tenant_id = get_user_tenant_id() OR is_super_admin()` (registro de outra loja/inexistente → rev NULL → P0409 uniforme, sem vazar existência). **`_rev_base` null = bypass.**
- **ERRCODE `P0409`** com mensagem PT. Já mapeado em `src/lib/erro-mensagem.ts` (`POR_CODIGO.P0409`) — NÃO alterar o código.
- **Preservar byte-a-byte** as guardas atuais fora do trecho do rev-check: invariante #6 (`_salvar_cq_core`: `[C1]` não confirma com Σ grade real = 0, `[Σ]` grade_total derivado no servidor, fonte-única grava `grade_detalhe` + deriva `cad_grades`), `[C1]`/atomicidade de `salvar_terceirizados` (advisory lock, guarda de parcela paga, re-derivação de Grade Real), gate de módulo `tenant_module_enabled('producao')`.
- **Segurança RPC (invariante #9):** `_salvar_cq_core` mantém `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`. `salvar_terceirizados` NÃO tem `_core` (é wrapper+worker num único DEFINER com o gate inline) — o `_rev_base` é checado nela mesma; ela segue com `GRANT EXECUTE … TO authenticated`.
- **Migração DESTRUTIVA/DDL** (`DROP FUNCTION`): envolver em `BEGIN; … COMMIT;` e escrever idempotente (`IF EXISTS`/`IF NOT EXISTS`). Aplicar com `psql "$(cat /tmp/dburl.txt)" -f <arq>`. Diff-validar função existente com `pg_get_functiondef` antes/depois.
- **`vite build` NÃO roda tsc:** após mexer em imports/identificadores rodar `npx tsc --noEmit 2>&1 | grep TS2304`.
- **Front — peça NOVA** `src/lib/colab/merge-grade.ts` `mergeGrade(base, meu, fresh, tocadas)` por célula (variante_tecido_id × tamanho × campo ∈ {enviada,cortada,recebida,defeito}), usando `igual()`; null/ausente ≡ 0; unit-testado. `ROTULO_CONFLITO` cobre escalares de cada tela + `grade:{vid}:{tam}:{campo}`.
- **Fora de escopo (YAGNI):** presença com avatares ricos; lock pessimista; estender colab a outras telas de produção (CAD/Direcionamento/Oficina). Só PCP Serviços + CQ.

---

## File Structure

**Backend (migrations `supabase/migrations/`):**
- `20260807100000_colab_pcp_cq_rev_infra.sql` (T1) — `rev` + triggers + publication nas 2 tabelas.
- `20260807110000_salvar_terceirizados_rev_base.sql` (T2) — `_rev_base` por bloco em `salvar_terceirizados`.
- `20260807120000_salvar_cq_rev_base.sql` (T3) — `_rev_base` dos 2 lados em `salvar_cq`/`_salvar_cq_core`.

**Front (`src/`):**
- `src/lib/colab/merge-grade.ts` (T4, CRIAR) — helper puro `mergeGrade`.
- `src/hooks/useColabRegistro.ts` (T5, MODIFICAR) — aceitar as 2 tabelas novas + filtro por coluna (`cad_id`) + listeners extra.
- `src/routes/_authenticated/pcp.servicos.$modeloId.tsx` (T5, MODIFICAR) — adoção colab.
- `src/routes/_authenticated/expedicao.cq.$modeloId.tsx` (T6, MODIFICAR) — adoção colab.

**Testes (`tests/`):**
- `tests/integration/colab-trava.test.ts` (T2/T3, ESTENDER) — casos P0409 por bloco e dos 2 lados.
- `tests/unit/colab-merge-grade.test.ts` (T4, CRIAR) — `mergeGrade`.

**Docs (T7):** `CLAUDE.md` (bloco "Colaboração em tempo real"), `docs/mapeamento-campos-calculos.md`, `docs/plano-de-ataque.md`, memória `project_colab_concorrencia`.

**Padrões de referência (LER antes de tocar no código):**
- Piloto vivo: `src/routes/_authenticated/entrada-saida.oc-tecido.tsx` (linhas 400–428 `ROTULO_CONFLITO`; 658–905 refs/tracked setters/merge effect; 1160–1325 save + `onError` retry P0409).
- Merge existente: `src/lib/colab/merge.ts` (`mergeDraft`/`mergeLinhas`/`igual`). `src/lib/grade-cortada.ts` (`CelulaGrade`/`GradeDetalhe`).
- Migrations de referência: `20260803180000_colab_rev_infra.sql` (triggers/publication) e `20260803190000`/`200000` (padrão do rev-check com filtro de tenant).

---

## Task 1: Migração `rev` + triggers + publication (2 tabelas)

**Files:**
- Create: `supabase/migrations/20260807100000_colab_pcp_cq_rev_infra.sql`
- Test: `tests/integration/colab-trava.test.ts` (adicionar um `describe` novo; usa `tests/integration/db.ts`)

**Interfaces:**
- Produces: colunas `producao_terceirizados.rev int`, `controle_qualidade.rev int` (server-managed, bump a cada UPDATE); trigger de bump em `cq_variantes` (child → `controle_qualidade`); ambas as tabelas na publicação `supabase_realtime`. Consumido por T2/T3 (rev-check) e T5/T6 (front lê `rev` no SELECT + `postgres_changes`).

- [ ] **Step 1: Escrever o teste de integração falhando (bump + publication)**

Adicionar ao fim de `tests/integration/colab-trava.test.ts`, ANTES do último `});` do arquivo NÃO — como novo `describe` independente:

```ts
describe.skipIf(!hasDb)("colab PCP/CQ — rev infra (T1)", () => {
  it("producao_terceirizados: UPDATE bumpa rev (BEFORE UPDATE); rev é do servidor", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string }>(
        c, `insert into cad (tenant_id) values ($1) returning id`, [TENANT_TESTE]);
      const pt = await um<{ id: string; rev: number }>(
        c, `insert into producao_terceirizados (cad_id, tenant_id, ativo) values ($1,$2,true) returning id, rev`,
        [cad.id, TENANT_TESTE]);
      const r1 = await um<{ rev: number }>(
        c, `update producao_terceirizados set observacao='x' where id=$1 returning rev`, [pt.id]);
      expect(r1.rev).toBe(pt.rev + 1);
      // rev é do SERVIDOR: gravar rev na mão não rebaixa
      const r2 = await um<{ rev: number }>(
        c, `update producao_terceirizados set rev=0 where id=$1 returning rev`, [pt.id]);
      expect(r2.rev).toBe(r1.rev + 1);
    });
  });
  it("controle_qualidade: UPDATE bumpa rev; insert de cq_variantes bumpa a raiz", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string }>(
        c, `insert into cad (tenant_id) values ($1) returning id`, [TENANT_TESTE]);
      const cq = await um<{ id: string; rev: number }>(
        c, `insert into controle_qualidade (cad_id, tenant_id, status) values ($1,$2,'pendente') returning id, rev`,
        [cad.id, TENANT_TESTE]);
      const r1 = await um<{ rev: number }>(
        c, `update controle_qualidade set observacoes_cq='y' where id=$1 returning rev`, [cq.id]);
      expect(r1.rev).toBe(cq.rev + 1);
      await um(c, `insert into cq_variantes (controle_qualidade_id, variante_numero, etapa, grades, grade_total)
                   values ($1, 1, 'recebimento', '{}'::jsonb, 0)`, [cq.id]);
      const r2 = await um<{ rev: number }>(c, `select rev from controle_qualidade where id=$1`, [cq.id]);
      expect(r2.rev).toBeGreaterThan(r1.rev);
    });
  });
  it("publicação supabase_realtime contém producao_terceirizados e controle_qualidade", async () => {
    await withTx(async (c) => {
      const rows = await c.query(
        `select tablename from pg_publication_tables
          where pubname='supabase_realtime' and tablename in ('producao_terceirizados','controle_qualidade')`);
      expect(rows.rows.map((r: any) => r.tablename).sort())
        .toEqual(["controle_qualidade", "producao_terceirizados"]);
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test:int -- colab-trava`
Expected: FAIL nos 3 casos novos (`column "rev" does not exist` / publication não contém as tabelas).

- [ ] **Step 3: Escrever a migração**

Criar `supabase/migrations/20260807100000_colab_pcp_cq_rev_infra.sql`:

```sql
-- 20260807100000_colab_pcp_cq_rev_infra.sql
-- Colab PCP Serviços + CQ (spec 2026-08-07), Task 1: rev nos agregados + bump por filha.
-- Reusa fn_colab_touch_rev() da infra existente (20260803180000). rev é DO SERVIDOR
-- (BEFORE UPDATE sempre incrementa; valor do cliente é ignorado).
BEGIN;

-- rev por BLOCO (cobre PCP + o grade_detalhe compartilhado do bloco-fonte)
alter table public.producao_terceirizados add column if not exists rev int not null default 0;
-- rev por CAD (só CQ: status, datas, cq_variantes)
alter table public.controle_qualidade    add column if not exists rev int not null default 0;

-- BEFORE UPDATE: incrementa rev em cada UPDATE da raiz (reusa a função existente).
drop trigger if exists trg_colab_rev on public.producao_terceirizados;
create trigger trg_colab_rev before update on public.producao_terceirizados
  for each row execute function public.fn_colab_touch_rev();
drop trigger if exists trg_colab_rev on public.controle_qualidade;
create trigger trg_colab_rev before update on public.controle_qualidade
  for each row execute function public.fn_colab_touch_rev();

-- Bump da filha cq_variantes → controle_qualidade (padrão fn_colab_bump_*; SECURITY DEFINER
-- p/ o UPDATE no-op não esbarrar em RLS de fluxos DEFINER). O UPDATE no-op dispara o
-- BEFORE UPDATE acima (rev+1) E emite o evento Realtime que o front escuta.
create or replace function public.fn_colab_bump_cq() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid := coalesce(new.controle_qualidade_id, old.controle_qualidade_id);
begin update public.controle_qualidade set id = id where id = v_id; return coalesce(new, old); end $$;

drop trigger if exists trg_colab_bump on public.cq_variantes;
create trigger trg_colab_bump after insert or update or delete on public.cq_variantes
  for each row execute function public.fn_colab_bump_cq();

-- Publicação Realtime (sem isto o postgres_changes não dispara).
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and tablename='producao_terceirizados')
    then alter publication supabase_realtime add table public.producao_terceirizados; end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and tablename='controle_qualidade')
    then alter publication supabase_realtime add table public.controle_qualidade; end if;
end $$;

COMMIT;
```

- [ ] **Step 4: Aplicar a migração**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260807100000_colab_pcp_cq_rev_infra.sql`
Expected: `BEGIN`/`ALTER TABLE`/`CREATE TRIGGER`/`COMMIT` sem erro. (Idempotente: reaplicar não quebra.)

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `npm run test:int -- colab-trava`
Expected: PASS (os 3 casos novos + os pré-existentes intactos).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260807100000_colab_pcp_cq_rev_infra.sql tests/integration/colab-trava.test.ts
git commit -m "feat(colab): rev + triggers + realtime em producao_terceirizados e controle_qualidade"
```

---

## Task 2: `salvar_terceirizados` — `_rev_base` por bloco

**Files:**
- Create: `supabase/migrations/20260807110000_salvar_terceirizados_rev_base.sql`
- Test: `tests/integration/colab-trava.test.ts` (adicionar casos)

**Interfaces:**
- Consumes: `producao_terceirizados.rev` (T1).
- Produces: `salvar_terceirizados(_cad_id uuid, _blocos jsonb, _observacoes_molde text default null, _rev_base jsonb default null)` — 4º param `_rev_base = {bloco_id: rev}`. Consumido pelo front PCP (T5).

**Contexto REAL (verificado):** `salvar_terceirizados` NÃO tem `_core` — é um único `SECURITY DEFINER` com o gate `tenant_module_enabled('producao')` inline, advisory lock `pg_advisory_xact_lock(hashtext(_cad_id::text))`, guarda de parcela paga, e re-derivação de Grade Real via `_aplicar_reais_do_grade_detalhe`. Decisão: o `_rev_base` é checado DENTRO dela mesma, logo após o advisory lock e ANTES do loop de mutação (o loop faz UPDATE que bumpa rev via trigger). Como `CREATE OR REPLACE` com assinatura nova cria OVERLOAD, `DROP FUNCTION` a 3-arg antes e re-`GRANT` a 4-arg.

- [ ] **Step 1: Escrever os testes de integração falhando**

Adicionar ao `describe("colab — trava otimista (P0409)")` existente em `tests/integration/colab-trava.test.ts`:

```ts
  it("salvar_terceirizados: _rev_base de bloco EXISTENTE errado → P0409; correto passa e bumpa", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string }>(c, `insert into cad (tenant_id) values ($1) returning id`, [TENANT_TESTE]);
      const pt = await um<{ id: string; rev: number }>(
        c, `insert into producao_terceirizados (cad_id, tenant_id, ativo) values ($1,$2,true) returning id, rev`,
        [cad.id, TENANT_TESTE]);
      const bloco = (rev: number) => JSON.stringify([{ id: pt.id, rev }]);
      await c.query("SAVEPOINT sp1");
      await expect(
        um(c, `select salvar_terceirizados($1, $2::jsonb, null, jsonb_build_object($3::text, $4::int))`,
           [cad.id, JSON.stringify([{ id: pt.id }]), pt.id, pt.rev + 99]),
      ).rejects.toMatchObject({ code: "P0409" });
      await c.query("ROLLBACK TO SAVEPOINT sp1");
      // correto: passa e bumpa
      await um(c, `select salvar_terceirizados($1, $2::jsonb, null, jsonb_build_object($3::text, $4::int))`,
               [cad.id, JSON.stringify([{ id: pt.id, categoria_terceirizado_id: null }]), pt.id, pt.rev]);
      const r = await um<{ rev: number }>(c, `select rev from producao_terceirizados where id=$1`, [pt.id]);
      expect(r.rev).toBeGreaterThan(pt.rev);
    });
  });
  it("salvar_terceirizados: bloco NOVO (sem id) não trava mesmo com _rev_base presente; null bypassa", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string }>(c, `insert into cad (tenant_id) values ($1) returning id`, [TENANT_TESTE]);
      // bloco novo (sem id) + _rev_base '{}' → insere sem P0409
      await um(c, `select salvar_terceirizados($1, $2::jsonb, null, '{}'::jsonb)`,
               [cad.id, JSON.stringify([{ categoria_terceirizado_id: null }])]);
      // _rev_base null = bypass total
      await um(c, `select salvar_terceirizados($1, '[]'::jsonb, null, null)`, [cad.id]);
      const n = await um<{ n: string }>(c, `select count(*) n from producao_terceirizados where cad_id=$1`, [cad.id]);
      expect(Number(n.n)).toBeGreaterThanOrEqual(0);
    });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:int -- colab-trava`
Expected: FAIL — hoje `salvar_terceirizados` tem só 3 args (`function salvar_terceirizados(uuid, jsonb, unknown, jsonb) does not exist`).

- [ ] **Step 3: Snapshot da definição atual (diff-validação)**

Run: `psql "$(cat /tmp/dburl.txt)" -tAc "select pg_get_functiondef(oid) from pg_proc where oid='public.salvar_terceirizados(uuid,jsonb,text)'::regprocedure" > /tmp/def_salvar_terceirizados_antes.sql`
Expected: arquivo com a definição atual (referência p/ garantir que só o rev-check muda).

- [ ] **Step 4: Escrever a migração**

Criar `supabase/migrations/20260807110000_salvar_terceirizados_rev_base.sql`. É a função ATUAL VERBATIM com: (a) 4º param `_rev_base jsonb default null`; (b) bloco de rev-check inserido logo após `PERFORM pg_advisory_xact_lock(...)`. Nada mais muda.

```sql
-- 20260807110000_salvar_terceirizados_rev_base.sql
-- Colab PCP (spec 2026-08-07), Task 2: _rev_base POR BLOCO em salvar_terceirizados.
-- CREATE OR REPLACE com assinatura nova criaria OVERLOAD → DROP a 3-arg antes e re-GRANT.
-- Envolvido em BEGIN/COMMIT (há DROP). O corpo é a função atual VERBATIM + o rev-check.
BEGIN;

DROP FUNCTION IF EXISTS public.salvar_terceirizados(uuid, jsonb, text);

CREATE FUNCTION public.salvar_terceirizados(_cad_id uuid, _blocos jsonb, _observacoes_molde text DEFAULT NULL::text, _rev_base jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; b jsonb; v_id uuid; v_ids uuid[] := '{}';
  v_fonte uuid; v_cq_conf boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  IF NOT public.tenant_module_enabled('producao') THEN
    RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_cad_id::text));

  -- Trava otimista POR BLOCO (spec 2026-08-07): _rev_base = { bloco_id: rev }. Cada bloco
  -- EXISTENTE (com id) presente no payload tem o rev conferido contra o base; divergência =
  -- P0409. Bloco novo (sem id) não trava. Bloco sem entrada no base = bypass. _rev_base
  -- null/ausente = bypass (compat + super_admin). Lê FOR UPDATE (segura o lock até o UPDATE).
  IF _rev_base IS NOT NULL AND jsonb_typeof(_blocos) = 'array' THEN
    DECLARE v_bid uuid; v_rev int; v_base int;
    BEGIN
      FOR b IN SELECT value FROM jsonb_array_elements(_blocos) LOOP
        v_bid := NULLIF(b->>'id','')::uuid;
        IF v_bid IS NULL THEN CONTINUE; END IF;                 -- bloco novo não trava
        IF NOT (_rev_base ? v_bid::text) THEN CONTINUE; END IF; -- sem base p/ este bloco = bypass
        IF (_rev_base->>v_bid::text) IS NULL THEN CONTINUE; END IF;
        v_base := (_rev_base->>v_bid::text)::int;
        SELECT rev INTO v_rev FROM public.producao_terceirizados
          WHERE id = v_bid AND cad_id = _cad_id FOR UPDATE;     -- cad já foi tenant-verificado acima
        IF v_rev IS DISTINCT FROM v_base THEN
          RAISE EXCEPTION 'conflito_versao: um serviço foi salvo por outra pessoa'
            USING ERRCODE = 'P0409';
        END IF;
      END LOOP;
    END;
  END IF;

  IF jsonb_typeof(_blocos) = 'array' THEN
    FOR b IN SELECT value FROM jsonb_array_elements(_blocos) LOOP
      IF NULLIF(b->>'id','') IS NOT NULL THEN
        UPDATE public.producao_terceirizados SET
          categoria_terceirizado_id = NULLIF(b->>'categoria_terceirizado_id','')::uuid,
          interno = COALESCE((b->>'interno')::boolean, false),
          empresa_id = NULLIF(b->>'empresa_id','')::uuid,
          representante_id = NULLIF(b->>'representante_id','')::uuid,
          colaborador_id = NULLIF(b->>'colaborador_id','')::uuid,
          ativo = COALESCE((b->>'ativo')::boolean, true),
          preco_metro_unidade = NULLIF(b->>'preco_metro_unidade','')::numeric,
          quantidade_enviada = NULLIF(b->>'quantidade_enviada','')::int,
          quantidade_recebida = NULLIF(b->>'quantidade_recebida','')::int,
          quantidade_defeito = NULLIF(b->>'quantidade_defeito','')::int,
          desconto_total = COALESCE(NULLIF(b->>'desconto_total','')::numeric, 0),
          multa_total = COALESCE(NULLIF(b->>'multa_total','')::numeric, 0),
          numero_parcelas = GREATEST(COALESCE(NULLIF(b->>'numero_parcelas','')::int, 1), 1),
          data_enviado = NULLIF(b->>'data_enviado','')::date,
          data_prevista = NULLIF(b->>'data_prevista','')::date,
          data_entregue = NULLIF(b->>'data_entregue','')::date,
          observacao = b->>'observacao',
          aviamentos_enviados = COALESCE(b->'aviamentos_enviados', '[]'::jsonb),
          tecidos_enviados = COALESCE(b->'tecidos_enviados', '[]'::jsonb),
          detalhado = COALESCE((b->>'detalhado')::boolean, false),
          grade_detalhe = COALESCE(b->'grade_detalhe', '{}'::jsonb)
        WHERE id = (b->>'id')::uuid AND cad_id = _cad_id;
        v_id := (b->>'id')::uuid;
      ELSE
        INSERT INTO public.producao_terceirizados (
          cad_id, categoria_terceirizado_id, interno, empresa_id, representante_id,
          colaborador_id, ativo, preco_metro_unidade, quantidade_enviada, quantidade_recebida,
          quantidade_defeito, desconto_total, multa_total, numero_parcelas,
          data_enviado, data_prevista, data_entregue, observacao, aviamentos_enviados, tecidos_enviados,
          detalhado, grade_detalhe
        ) VALUES (
          _cad_id, NULLIF(b->>'categoria_terceirizado_id','')::uuid, COALESCE((b->>'interno')::boolean, false),
          NULLIF(b->>'empresa_id','')::uuid, NULLIF(b->>'representante_id','')::uuid,
          NULLIF(b->>'colaborador_id','')::uuid, COALESCE((b->>'ativo')::boolean, true),
          NULLIF(b->>'preco_metro_unidade','')::numeric, NULLIF(b->>'quantidade_enviada','')::int,
          NULLIF(b->>'quantidade_recebida','')::int, NULLIF(b->>'quantidade_defeito','')::int,
          COALESCE(NULLIF(b->>'desconto_total','')::numeric, 0), COALESCE(NULLIF(b->>'multa_total','')::numeric, 0),
          GREATEST(COALESCE(NULLIF(b->>'numero_parcelas','')::int, 1), 1),
          NULLIF(b->>'data_enviado','')::date, NULLIF(b->>'data_prevista','')::date, NULLIF(b->>'data_entregue','')::date,
          b->>'observacao', COALESCE(b->'aviamentos_enviados', '[]'::jsonb), COALESCE(b->'tecidos_enviados', '[]'::jsonb),
          COALESCE((b->>'detalhado')::boolean, false), COALESCE(b->'grade_detalhe', '{}'::jsonb)
        ) RETURNING id INTO v_id;
      END IF;
      v_ids := array_append(v_ids, v_id);
    END LOOP;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.producao_terceirizados pt
    JOIN public.parcelas_servico ps ON ps.producao_terceirizado_id = pt.id
    WHERE pt.cad_id = _cad_id AND NOT (pt.id = ANY(v_ids))
      AND (ps.status = 'pago' OR ps.data_pagamento IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Não é possível remover um serviço com parcela já paga (apagaria o histórico financeiro). Mantenha o bloco ou estorne a parcela antes.';
  END IF;

  DELETE FROM public.producao_terceirizados WHERE cad_id = _cad_id AND NOT (id = ANY(v_ids));

  -- FONTE ÚNICA: com CQ confirmado + bloco-fonte, re-deriva a Grade Real do grade_detalhe
  -- (editar recebida/defeito no PCP move a Grade Real). Mesma fórmula do _salvar_cq_core.
  v_fonte := public._resolver_fonte_confeccao(_cad_id);
  SELECT (status = 'confirmado') INTO v_cq_conf FROM public.controle_qualidade WHERE cad_id = _cad_id;
  IF v_fonte IS NOT NULL AND COALESCE(v_cq_conf, false) THEN
    PERFORM public._aplicar_reais_do_grade_detalhe(_cad_id, v_fonte);
  END IF;

  UPDATE public.cad SET observacoes_molde = NULLIF(_observacoes_molde, '') WHERE id = _cad_id;
END;
$function$;

-- salvar_terceirizados NÃO tem _core (worker+gate num só DEFINER) → só re-GRANT do wrapper.
GRANT EXECUTE ON FUNCTION public.salvar_terceirizados(uuid, jsonb, text, jsonb) TO authenticated;

COMMIT;
```

- [ ] **Step 5: Aplicar + diff-validar**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260807110000_salvar_terceirizados_rev_base.sql
psql "$(cat /tmp/dburl.txt)" -tAc "select pg_get_functiondef(oid) from pg_proc where oid='public.salvar_terceirizados(uuid,jsonb,text,jsonb)'::regprocedure" > /tmp/def_salvar_terceirizados_depois.sql
diff /tmp/def_salvar_terceirizados_antes.sql /tmp/def_salvar_terceirizados_depois.sql
```
Expected: o diff mostra APENAS o novo param `_rev_base` e o bloco de rev-check (nada mais mudou).

- [ ] **Step 6: Rodar os testes e ver passar**

Run: `npm run test:int -- colab-trava`
Expected: PASS (novos + pré-existentes).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260807110000_salvar_terceirizados_rev_base.sql tests/integration/colab-trava.test.ts
git commit -m "feat(colab): salvar_terceirizados checa _rev_base por bloco (P0409)"
```

---

## Task 3: `salvar_cq` — `_rev_base` dos 2 lados (cq + fonte)

**Files:**
- Create: `supabase/migrations/20260807120000_salvar_cq_rev_base.sql`
- Test: `tests/integration/colab-trava.test.ts` (adicionar casos)

**Interfaces:**
- Consumes: `controle_qualidade.rev`, `producao_terceirizados.rev` (T1); `_resolver_fonte_confeccao(_cad_id)`.
- Produces: `salvar_cq(_cad_id uuid, _cq jsonb, _variantes jsonb, _reais jsonb, _confirmar boolean default false, _rev_base jsonb default null)` — 6º param `_rev_base = {cq: rev, fonte: rev|null}`. Consumido pelo front CQ (T6).

**Contexto REAL (verificado):** `salvar_cq` é wrapper (gate) → `_salvar_cq_core`. O core resolve `v_fonte := _resolver_fonte_confeccao(_cad_id)` cedo (linha ~19) e ANTES do `[C1]` mescla recebida/defeito no `grade_detalhe` do bloco-fonte (UPDATE em producao_terceirizados → bumpa fonte rev via trigger T1) e depois grava `controle_qualidade` (bumpa cq rev). O rev-check dos 2 lados vai no TOPO do core, logo APÓS resolver `v_fonte` e ANTES do bloco de merge do grade_detalhe. `_salvar_cq_core` mantém REVOKE (invariante #9).

- [ ] **Step 1: Escrever os testes de integração falhando**

Adicionar ao `describe("colab — trava otimista (P0409)")`:

```ts
  it("salvar_cq: _rev_base.cq errado → P0409; correto passa e bumpa o cq", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string }>(c, `insert into cad (tenant_id) values ($1) returning id`, [TENANT_TESTE]);
      const cq = await um<{ id: string; rev: number }>(
        c, `insert into controle_qualidade (cad_id, tenant_id, status) values ($1,$2,'pendente') returning id, rev`,
        [cad.id, TENANT_TESTE]);
      await c.query("SAVEPOINT sp1");
      await expect(
        um(c, `select salvar_cq($1,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,false, jsonb_build_object('cq',$2::int,'fonte',null))`,
           [cad.id, cq.rev + 99]),
      ).rejects.toMatchObject({ code: "P0409" });
      await c.query("ROLLBACK TO SAVEPOINT sp1");
      await um(c, `select salvar_cq($1,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,false, jsonb_build_object('cq',$2::int,'fonte',null))`,
               [cad.id, cq.rev]);
      const r = await um<{ rev: number }>(c, `select rev from controle_qualidade where id=$1`, [cq.id]);
      expect(r.rev).toBeGreaterThan(cq.rev);
    });
  });
  it("salvar_cq: PCP mexe no bloco-fonte → _rev_base.fonte velho → P0409", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string }>(c, `insert into cad (tenant_id) values ($1) returning id`, [TENANT_TESTE]);
      // bloco-fonte: precisa ser confecção detalhada; usa uma categoria de confecção existente do tenant
      const catConf = await um<{ id: string }>(
        c, `select ct.id from categorias_terceirizado ct
             where ct.tenant_id=$1 and public._categoria_eh_confeccao(ct.nome) limit 1`, [TENANT_TESTE]);
      const cq = await um<{ id: string; rev: number }>(
        c, `insert into controle_qualidade (cad_id, tenant_id, status) values ($1,$2,'pendente') returning id, rev`,
        [cad.id, TENANT_TESTE]);
      const pt = await um<{ id: string; rev: number }>(
        c, `insert into producao_terceirizados (cad_id, tenant_id, ativo, detalhado, categoria_terceirizado_id)
            values ($1,$2,true,true,$3) returning id, rev`, [cad.id, TENANT_TESTE, catConf.id]);
      // simula PCP mexendo no bloco-fonte (bumpa fonte rev)
      await um(c, `update producao_terceirizados set observacao='pcp' where id=$1`, [pt.id]);
      await c.query("SAVEPOINT sp1");
      await expect(
        um(c, `select salvar_cq($1,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,false, jsonb_build_object('cq',$2::int,'fonte',$3::int))`,
           [cad.id, cq.rev, pt.rev]),  // pt.rev é o velho (antes do update do PCP)
      ).rejects.toMatchObject({ code: "P0409" });
      await c.query("ROLLBACK TO SAVEPOINT sp1");
    });
  });
  it("salvar_cq: modelo SEM bloco-fonte só checa o cq (_rev_base.fonte null ignorado)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string }>(c, `insert into cad (tenant_id) values ($1) returning id`, [TENANT_TESTE]);
      const cq = await um<{ id: string; rev: number }>(
        c, `insert into controle_qualidade (cad_id, tenant_id, status) values ($1,$2,'pendente') returning id, rev`,
        [cad.id, TENANT_TESTE]);
      // sem bloco-fonte: passa checando só o cq
      await um(c, `select salvar_cq($1,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,false, jsonb_build_object('cq',$2::int,'fonte',null))`,
               [cad.id, cq.rev]);
    });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:int -- colab-trava`
Expected: FAIL — hoje `salvar_cq` tem 5 args (`function salvar_cq(..., jsonb) does not exist`).

- [ ] **Step 3: Snapshot das definições atuais (diff-validação)**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -tAc "select pg_get_functiondef(oid) from pg_proc where oid='public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean)'::regprocedure" > /tmp/def_salvar_cq_core_antes.sql
psql "$(cat /tmp/dburl.txt)" -tAc "select has_function_privilege('anon','public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean)','EXECUTE')"
```
Expected: definição salva; privilégio `anon` = `false` (o core já é revogado hoje — manter após recriar).

- [ ] **Step 4: Escrever a migração**

Criar `supabase/migrations/20260807120000_salvar_cq_rev_base.sql`. O core é a função ATUAL VERBATIM + 6º param `_rev_base` + o bloco de rev-check inserido logo após `v_fonte := public._resolver_fonte_confeccao(_cad_id);` e ANTES do `IF v_fonte IS NOT NULL THEN` (merge do grade_detalhe). O wrapper ganha o 6º param e o repassa.

```sql
-- 20260807120000_salvar_cq_rev_base.sql
-- Colab CQ (spec 2026-08-07), Task 3: _rev_base DOS DOIS LADOS ({cq, fonte}) em salvar_cq.
-- CREATE OR REPLACE com assinatura nova criaria OVERLOAD → DROP as 5-arg antes; REVOKE core;
-- GRANT wrapper. Corpo = funções atuais VERBATIM + o rev-check dos 2 lados no topo do core.
BEGIN;

DROP FUNCTION IF EXISTS public.salvar_cq(uuid, jsonb, jsonb, jsonb, boolean);
DROP FUNCTION IF EXISTS public._salvar_cq_core(uuid, jsonb, jsonb, jsonb, boolean);

CREATE FUNCTION public._salvar_cq_core(_cad_id uuid, _cq jsonb, _variantes jsonb, _reais jsonb, _confirmar boolean DEFAULT false, _rev_base jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_cq_id uuid; v_status_atual text; v_status text; v_confirmado_at timestamptz;
  v_total_real int; r jsonb;
  v_fonte uuid; v_gd jsonb; v_vid uuid; v_tam text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  v_fonte := public._resolver_fonte_confeccao(_cad_id);

  -- Trava otimista DOS DOIS LADOS (spec 2026-08-07): _rev_base = { cq: rev, fonte: rev|null }.
  -- cq: confere controle_qualidade.rev — só se a linha já existe (CQ novo não trava). fonte:
  -- confere producao_terceirizados.rev do bloco-fonte — só se há fonte E base.fonte não-nula.
  -- _rev_base null/ausente = bypass (compat + super_admin). Lê FOR UPDATE (segura o lock).
  IF _rev_base IS NOT NULL THEN
    DECLARE v_rev_cq int; v_rev_ft int;
    BEGIN
      IF (_rev_base ? 'cq') AND (_rev_base->>'cq') IS NOT NULL THEN
        SELECT rev INTO v_rev_cq FROM public.controle_qualidade
          WHERE cad_id = _cad_id AND (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
          FOR UPDATE;
        IF v_rev_cq IS NOT NULL AND v_rev_cq IS DISTINCT FROM (_rev_base->>'cq')::int THEN
          RAISE EXCEPTION 'conflito_versao: o Controle de Qualidade foi salvo por outra pessoa'
            USING ERRCODE = 'P0409';
        END IF;
      END IF;
      IF v_fonte IS NOT NULL AND (_rev_base ? 'fonte') AND (_rev_base->>'fonte') IS NOT NULL THEN
        SELECT rev INTO v_rev_ft FROM public.producao_terceirizados WHERE id = v_fonte FOR UPDATE;
        IF v_rev_ft IS DISTINCT FROM (_rev_base->>'fonte')::int THEN
          RAISE EXCEPTION 'conflito_versao: a grade do serviço-fonte foi salva por outra pessoa'
            USING ERRCODE = 'P0409';
        END IF;
      END IF;
    END;
  END IF;

  -- FONTE ÚNICA (cedo, ANTES do [C1]): se há bloco-fonte, mescla recebida/defeito do payload no
  -- grade_detalhe do bloco (traduzindo variante_numero→variante_tecido_id via ordem). PRESERVA
  -- enviada/cortada. Rola quantidade_enviada/recebida/defeito = Σ das células (F2: enviada mantém o
  -- auto_status coerente). Feito antes do [C1] para que guard e Grade Real usem a MESMA fonte; se o
  -- [C1] abortar, este UPDATE é revertido na mesma txn.
  IF v_fonte IS NOT NULL THEN
    SELECT COALESCE(grade_detalhe, '{}'::jsonb) INTO v_gd FROM public.producao_terceirizados WHERE id = v_fonte;
    FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb))
             WHERE value->>'etapa' IN ('recebimento','defeito') LOOP
      SELECT ctv.variante_tecido_id INTO v_vid
        FROM public.cad_tecidos ct
        JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
       WHERE ct.cad_id = _cad_id AND ct.tipo='tecido' AND ct.numero=1 AND ctv.ordem = (r->>'variante_numero')::int
       LIMIT 1;
      IF v_vid IS NULL THEN CONTINUE; END IF;
      IF NOT (v_gd ? v_vid::text) THEN
        v_gd := v_gd || jsonb_build_object(v_vid::text, '{}'::jsonb);
      END IF;
      FOR v_tam IN SELECT jsonb_object_keys(COALESCE(r->'grades','{}'::jsonb)) LOOP
        v_gd := jsonb_set(v_gd, ARRAY[v_vid::text, v_tam],
          COALESCE(v_gd->v_vid::text->v_tam, '{}'::jsonb)
          || jsonb_build_object(CASE WHEN r->>'etapa'='recebimento' THEN 'recebida' ELSE 'defeito' END,
                                COALESCE((r->'grades'->>v_tam)::int,0)), true);
      END LOOP;
    END LOOP;
    UPDATE public.producao_terceirizados SET grade_detalhe = v_gd,
      quantidade_enviada  = (SELECT COALESCE(SUM((cell->>'enviada')::int),0)  FROM jsonb_path_query(v_gd,'$.*.*') cell),
      quantidade_recebida = (SELECT COALESCE(SUM((cell->>'recebida')::int),0) FROM jsonb_path_query(v_gd,'$.*.*') cell),
      quantidade_defeito  = (SELECT COALESCE(SUM((cell->>'defeito')::int),0)  FROM jsonb_path_query(v_gd,'$.*.*') cell)
    WHERE id = v_fonte;
  END IF;

  -- [C1] confirmar exige ter contado ao menos 1 peça (Σ da Grade Real > 0). COM fonte: Σ max(0,
  -- recebida−defeito) sobre as células do grade_detalhe (a MESMA fonte da Grade Real gravada).
  -- SEM fonte: Σ do _reais do cliente (comportamento atual).
  IF _confirmar THEN
    IF v_fonte IS NOT NULL THEN
      SELECT COALESCE(SUM(GREATEST(0, COALESCE((cell->>'recebida')::int,0) - COALESCE((cell->>'defeito')::int,0))), 0)
        INTO v_total_real FROM jsonb_path_query(COALESCE(v_gd,'{}'::jsonb),'$.*.*') cell;
    ELSE
      SELECT COALESCE(SUM((SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(e->'grades','{}'::jsonb)) x)), 0)
        INTO v_total_real FROM jsonb_array_elements(COALESCE(_reais,'[]'::jsonb)) e;
    END IF;
    IF v_total_real = 0 THEN
      RAISE EXCEPTION 'Conte ao menos uma peça no Recebimento antes de confirmar o Controle de Qualidade.';
    END IF;
  END IF;

  SELECT id, status INTO v_cq_id, v_status_atual FROM public.controle_qualidade WHERE cad_id = _cad_id;

  v_status := CASE
    WHEN _confirmar THEN 'confirmado'
    WHEN v_cq_id IS NOT NULL THEN COALESCE(v_status_atual, 'pendente')
    ELSE 'pendente'
  END;
  v_confirmado_at := CASE WHEN v_status = 'confirmado' THEN now() ELSE NULL END;

  IF v_cq_id IS NULL THEN
    INSERT INTO public.controle_qualidade (
      cad_id, tenant_id, observacoes_cq, pecas_incompletas, pecas_faltantes, pecas_sem_etiqueta,
      data_conserto_enviado, data_conserto_prevista, data_conserto_entregue,
      data_lavagem_enviado, data_lavagem_entregue,
      data_recebimento_enviado_oficina, data_recebimento_prevista, data_recebimento_entregue,
      fotografado_variantes, status, confirmado_at
    ) VALUES (
      _cad_id, v_tenant, _cq->>'observacoes_cq',
      NULLIF(_cq->>'pecas_incompletas','')::int, NULLIF(_cq->>'pecas_faltantes','')::int, NULLIF(_cq->>'pecas_sem_etiqueta','')::int,
      NULLIF(_cq->>'data_conserto_enviado','')::date, NULLIF(_cq->>'data_conserto_prevista','')::date, NULLIF(_cq->>'data_conserto_entregue','')::date,
      NULLIF(_cq->>'data_lavagem_enviado','')::date, NULLIF(_cq->>'data_lavagem_entregue','')::date,
      NULLIF(_cq->>'data_recebimento_enviado_oficina','')::date, NULLIF(_cq->>'data_recebimento_prevista','')::date, NULLIF(_cq->>'data_recebimento_entregue','')::date,
      COALESCE(_cq->'fotografado_variantes', '{}'::jsonb), v_status, v_confirmado_at
    ) RETURNING id INTO v_cq_id;
  ELSE
    UPDATE public.controle_qualidade SET
      observacoes_cq = _cq->>'observacoes_cq',
      pecas_incompletas = NULLIF(_cq->>'pecas_incompletas','')::int,
      pecas_faltantes = NULLIF(_cq->>'pecas_faltantes','')::int,
      pecas_sem_etiqueta = NULLIF(_cq->>'pecas_sem_etiqueta','')::int,
      data_conserto_enviado = NULLIF(_cq->>'data_conserto_enviado','')::date,
      data_conserto_prevista = NULLIF(_cq->>'data_conserto_prevista','')::date,
      data_conserto_entregue = NULLIF(_cq->>'data_conserto_entregue','')::date,
      data_lavagem_enviado = NULLIF(_cq->>'data_lavagem_enviado','')::date,
      data_lavagem_entregue = NULLIF(_cq->>'data_lavagem_entregue','')::date,
      data_recebimento_enviado_oficina = NULLIF(_cq->>'data_recebimento_enviado_oficina','')::date,
      data_recebimento_prevista = NULLIF(_cq->>'data_recebimento_prevista','')::date,
      data_recebimento_entregue = NULLIF(_cq->>'data_recebimento_entregue','')::date,
      fotografado_variantes = COALESCE(_cq->'fotografado_variantes', '{}'::jsonb),
      status = v_status,
      confirmado_at = CASE WHEN v_status = 'confirmado' THEN COALESCE(confirmado_at, now()) ELSE NULL END
    WHERE id = v_cq_id;
  END IF;

  DELETE FROM public.cq_variantes WHERE controle_qualidade_id = v_cq_id;
  IF jsonb_typeof(_variantes) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(_variantes) LOOP
      INSERT INTO public.cq_variantes (controle_qualidade_id, variante_numero, etapa, grades, grade_total, destino_defeito)
      VALUES (
        v_cq_id, (r->>'variante_numero')::int, r->>'etapa', COALESCE(r->'grades', '{}'::jsonb),
        (SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(r->'grades','{}'::jsonb)) x),
        NULLIF(r->>'destino_defeito','')
      );
    END LOOP;
  END IF;

  -- Grade Real → cad_grades quando confirmado. COM fonte: deriva do grade_detalhe (recebida−defeito).
  -- SEM fonte: usa _reais do cliente (comportamento atual, verbatim). Ambos preservam grades_planejadas.
  IF v_status = 'confirmado' THEN
    IF v_fonte IS NOT NULL THEN
      PERFORM public._aplicar_reais_do_grade_detalhe(_cad_id, v_fonte);
    ELSIF jsonb_typeof(_reais) = 'array' THEN
      FOR r IN SELECT value FROM jsonb_array_elements(_reais) LOOP
        INSERT INTO public.cad_grades
          (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
        VALUES (
          _cad_id, (r->>'variante_numero')::int, COALESCE(r->'grades', '{}'::jsonb), COALESCE(r->'grades', '{}'::jsonb),
          (SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(r->'grades','{}'::jsonb)) x),
          (SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(r->'grades','{}'::jsonb)) x)
        )
        ON CONFLICT (cad_id, variante_numero) DO UPDATE
          SET grades_reais = EXCLUDED.grades_reais, grade_total_real = EXCLUDED.grade_total_real;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object('cq_id', v_cq_id, 'status', v_status, 'fonte', v_fonte);
END;
$function$;

CREATE FUNCTION public.salvar_cq(_cad_id uuid, _cq jsonb, _variantes jsonb, _reais jsonb, _confirmar boolean DEFAULT false, _rev_base jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._salvar_cq_core(_cad_id, _cq, _variantes, _reais, _confirmar, _rev_base);
END $function$;

-- ACL (invariante #9): core revogado dos TRÊS; wrapper concedido a authenticated.
REVOKE EXECUTE ON FUNCTION public._salvar_cq_core(uuid, jsonb, jsonb, jsonb, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_cq(uuid, jsonb, jsonb, jsonb, boolean, jsonb) TO authenticated;

COMMIT;
```

- [ ] **Step 5: Aplicar + diff-validar + conferir ACL**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260807120000_salvar_cq_rev_base.sql
psql "$(cat /tmp/dburl.txt)" -tAc "select pg_get_functiondef(oid) from pg_proc where oid='public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)'::regprocedure" > /tmp/def_salvar_cq_core_depois.sql
diff /tmp/def_salvar_cq_core_antes.sql /tmp/def_salvar_cq_core_depois.sql
psql "$(cat /tmp/dburl.txt)" -tAc "select has_function_privilege('anon','public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)','EXECUTE'), has_function_privilege('authenticated','public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)','EXECUTE')"
```
Expected: diff mostra só o `_rev_base` + o bloco de rev-check; ACL `anon`/`authenticated` = `false,false` no core.

- [ ] **Step 6: Rodar os testes e ver passar**

Run: `npm run test:int -- colab-trava`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260807120000_salvar_cq_rev_base.sql tests/integration/colab-trava.test.ts
git commit -m "feat(colab): salvar_cq checa _rev_base dos 2 lados (cq + fonte) com P0409"
```

---

## Task 4: Helper puro `mergeGrade` + unit

**Files:**
- Create: `src/lib/colab/merge-grade.ts`
- Test: `tests/unit/colab-merge-grade.test.ts`

**Interfaces:**
- Consumes: `igual` de `src/lib/colab/merge.ts`; tipos `GradeDetalhe`/`CelulaGrade` de `src/lib/grade-cortada.ts`; `Conflito` de `src/lib/colab/merge.ts`.
- Produces: `mergeGrade({base, meu, fresh, tocadas}): { valor: GradeDetalhe; conflitos: Conflito[]; atualizados: string[] }`. Path do conflito/atualização = `grade:{variante_tecido_id}:{tamanho}:{campo}`. Consumido por T5 (PCP) e T6 (CQ).

**Semântica (spec §3):** itera por (variante_tecido_id × tamanho × campo ∈ {enviada,cortada,recebida,defeito}) sobre a UNIÃO de chaves de `base`/`meu`/`fresh`. Célula/campo NÃO tocado por mim + mudou no servidor → adota o `fresh`. Tocado por mim + mudou no servidor + valores divergem → conflito. Valores lidos como número (`null`/ausente ≡ 0), comparados com `igual()` sobre os normalizados.

- [ ] **Step 1: Escrever o teste unit falhando**

Criar `tests/unit/colab-merge-grade.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeGrade } from "../../src/lib/colab/merge-grade";
import type { GradeDetalhe } from "../../src/lib/grade-cortada";

const cel = (o: Partial<{ enviada: number; cortada: number; recebida: number; defeito: number }>) => ({ ...o });
const gd = (vid: string, tam: string, o: any): GradeDetalhe => ({ [vid]: { [tam]: cel(o) } });

describe("mergeGrade", () => {
  it("campo NÃO tocado + mudou no servidor → adota o fresh", () => {
    const base = gd("V", "M", { recebida: 1 });
    const meu = gd("V", "M", { recebida: 1 });
    const fresh = gd("V", "M", { recebida: 5 });
    const r = mergeGrade({ base, meu, fresh, tocadas: new Set() });
    expect(r.valor.V.M.recebida).toBe(5);
    expect(r.conflitos).toEqual([]);
    expect(r.atualizados).toEqual(["grade:V:M:recebida"]);
  });
  it("campo tocado + servidor NÃO mudou → mantém o meu, sem conflito", () => {
    const base = gd("V", "M", { recebida: 1 });
    const meu = gd("V", "M", { recebida: 9 });
    const fresh = gd("V", "M", { recebida: 1 });
    const r = mergeGrade({ base, meu, fresh, tocadas: new Set(["grade:V:M:recebida"]) });
    expect(r.valor.V.M.recebida).toBe(9);
    expect(r.conflitos).toEqual([]);
  });
  it("campo tocado + servidor mudou + valores divergem → conflito (mantém o meu)", () => {
    const base = gd("V", "M", { recebida: 1 });
    const meu = gd("V", "M", { recebida: 9 });
    const fresh = gd("V", "M", { recebida: 5 });
    const r = mergeGrade({ base, meu, fresh, tocadas: new Set(["grade:V:M:recebida"]) });
    expect(r.valor.V.M.recebida).toBe(9);
    expect(r.conflitos).toEqual([{ path: "grade:V:M:recebida", meu: 9, dele: 5 }]);
  });
  it("null/ausente ≡ 0 (sem conflito nem update fantasma)", () => {
    const base = gd("V", "M", { recebida: 0 });
    const meu: GradeDetalhe = { V: { M: {} as any } };            // sem 'recebida'
    const fresh: GradeDetalhe = { V: { M: { recebida: undefined } as any } };
    const r = mergeGrade({ base, meu, fresh, tocadas: new Set() });
    expect(r.conflitos).toEqual([]);
    expect(r.atualizados).toEqual([]);
  });
  it("célula nova no servidor (variante/tamanho ausente na base) é adotada quando não tocada", () => {
    const base: GradeDetalhe = {};
    const meu: GradeDetalhe = {};
    const fresh = gd("V", "G", { recebida: 3 });
    const r = mergeGrade({ base, meu, fresh, tocadas: new Set() });
    expect(r.valor.V.G.recebida).toBe(3);
    expect(r.atualizados).toEqual(["grade:V:G:recebida"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:unit -- colab-merge-grade`
Expected: FAIL (`Cannot find module '.../merge-grade'`).

- [ ] **Step 3: Escrever o helper**

Criar `src/lib/colab/merge-grade.ts`:

```ts
// Merge 3-vias por CÉLULA da grade destrinchada compartilhada (spec 2026-08-07).
// PURO. base = último visto do servidor · meu = o que estou vendo · fresh = chegou do
// servidor · tocadas = paths de célula/campo que EU editei ("grade:{vid}:{tam}:{campo}").
// Campo NÃO tocado + mudou no servidor → adota o fresh. Tocado + mudou no servidor +
// diverge → conflito (mantém o meu). null/ausente ≡ 0 (grade é numérica; célula ausente = 0).
import { igual, type Conflito } from "@/lib/colab/merge";
import type { GradeDetalhe, CelulaGrade } from "@/lib/grade-cortada";

const CAMPOS = ["enviada", "cortada", "recebida", "defeito"] as const;
type Campo = (typeof CAMPOS)[number];
const n = (v: unknown) => Number(v) || 0;
const pathDe = (vid: string, tam: string, campo: Campo) => `grade:${vid}:${tam}:${campo}`;

// Clona raso o suficiente p/ setar uma célula sem mutar `meu`.
function setCel(g: GradeDetalhe, vid: string, tam: string, campo: Campo, val: number): GradeDetalhe {
  const out: GradeDetalhe = { ...g, [vid]: { ...(g[vid] ?? {}) } };
  out[vid][tam] = { ...(g[vid]?.[tam] ?? {}), [campo]: val } as CelulaGrade;
  return out;
}

export function mergeGrade(o: {
  base: GradeDetalhe; meu: GradeDetalhe; fresh: GradeDetalhe; tocadas: ReadonlySet<string>;
}): { valor: GradeDetalhe; conflitos: Conflito[]; atualizados: string[] } {
  let valor = o.meu;
  const conflitos: Conflito[] = [];
  const atualizados: string[] = [];
  // UNIÃO de (vid, tam) das 3 fontes.
  const vids = new Set<string>([...Object.keys(o.base), ...Object.keys(o.meu), ...Object.keys(o.fresh)]);
  for (const vid of vids) {
    const tams = new Set<string>([
      ...Object.keys(o.base[vid] ?? {}), ...Object.keys(o.meu[vid] ?? {}), ...Object.keys(o.fresh[vid] ?? {}),
    ]);
    for (const tam of tams) {
      for (const campo of CAMPOS) {
        const vBase = n(o.base[vid]?.[tam]?.[campo]);
        const vMeu = n(o.meu[vid]?.[tam]?.[campo]);
        const vFresh = n(o.fresh[vid]?.[tam]?.[campo]);
        const mudouNoServidor = !igual(vBase, vFresh);
        const path = pathDe(vid, tam, campo);
        if (!o.tocadas.has(path)) {
          if (mudouNoServidor) { valor = setCel(valor, vid, tam, campo, vFresh); atualizados.push(path); }
        } else if (mudouNoServidor && !igual(vMeu, vFresh)) {
          conflitos.push({ path, meu: vMeu, dele: vFresh }); // mantém o meu no valor
        }
      }
    }
  }
  return { valor, conflitos, atualizados };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:unit -- colab-merge-grade`
Expected: PASS (5 casos).

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit 2>&1 | grep -E "merge-grade|TS2304" || echo "OK"`
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/colab/merge-grade.ts tests/unit/colab-merge-grade.test.ts
git commit -m "feat(colab): mergeGrade — merge 3-vias por célula da grade compartilhada"
```

---

## Task 5: Adoção colab no PCP Serviços (front)

**Files:**
- Modify: `src/hooks/useColabRegistro.ts`
- Modify: `src/routes/_authenticated/pcp.servicos.$modeloId.tsx`

**Interfaces:**
- Consumes: `mergeGrade` (T4), `mergeLinhas`/`igual`/`Conflito` (merge.ts), `ColabBanner`, `salvar_terceirizados(... _rev_base)` (T2), `producao_terceirizados.rev` (T1).
- Produces: `useColabRegistro` estendido (aceita tabelas `"producao_terceirizados"`/`"controle_qualidade"`, opção `filtroColuna` e `tabelasExtra`) — consumido também por T6.

**Contexto REAL (verificado):** os `blocos` do PCP são um ARRAY de estado `Bloco[]` (`id?`, `_key`, `grade_detalhe: GradeDetalhe`, mais escalares). Query `["producao-terc", cad?.id]` (`select("*")` → `rev` vem de graça). Hidratação hoje é one-shot (`hydrated` gate) + re-seed via `setHydrated(false)` no `onSuccess`. `useColabRegistro` atual só aceita `"ocs_tecido"|"modelos"|"colecoes"` e filtra `id=eq.${registroId}` — precisa aceitar filtro por `cad_id` (há N blocos por cad, sem id único de raiz).

- [ ] **Step 1: Estender `useColabRegistro` (tabelas novas + filtro por coluna + listeners extra)**

Editar `src/hooks/useColabRegistro.ts`. Trocar a assinatura e o corpo do `useEffect` de subscribe:

```ts
export type ColabTabela = "ocs_tecido" | "modelos" | "colecoes" | "producao_terceirizados" | "controle_qualidade";
export type ColabListener = { tabela: ColabTabela; filtroColuna: string; valor: string };

export function useColabRegistro(o: {
  canal: string | null;
  tabela: ColabTabela;
  registroId: string | null;
  onMudancaServidor: () => void;
  campoFocado?: string | null;
  // NOVO: coluna do filtro do postgres_changes (default "id"). PCP/CQ filtram por "cad_id"
  // (há N linhas por cad, sem id de raiz única).
  filtroColuna?: string;
  // NOVO: listeners extra no MESMO canal (ex.: CQ escuta controle_qualidade E o bloco-fonte
  // em producao_terceirizados). Sem presença própria — só reagem com onMudancaServidor.
  tabelasExtra?: ColabListener[];
}): { presentes: PresencaColab[] } {
```

No `useEffect` de subscribe (o que cria `const ch = supabase.channel(...)`), trocar o único `ch.on("postgres_changes", ...)` por um filtro configurável + os extras. Substituir a linha:

```ts
    ch.on("postgres_changes",
      { event: "UPDATE", schema: "public", table: o.tabela, filter: `id=eq.${o.registroId}` },
      () => onMudancaRef.current());
```

por:

```ts
    const col = o.filtroColuna ?? "id";
    ch.on("postgres_changes",
      { event: "*", schema: "public", table: o.tabela, filter: `${col}=eq.${o.registroId}` },
      () => onMudancaRef.current());
    for (const ex of o.tabelasExtra ?? []) {
      ch.on("postgres_changes",
        { event: "*", schema: "public", table: ex.tabela, filter: `${ex.filtroColuna}=eq.${ex.valor}` },
        () => onMudancaRef.current());
    }
```

(`event: "*"` cobre INSERT/UPDATE/DELETE de blocos/variantes — o PCP adiciona/remove blocos; o CQ recria `cq_variantes`. O merge no refetch continua idempotente.)

Ajustar as deps do effect para incluir os extras de forma estável (serializar):

```ts
  }, [chave, meuNome, o.filtroColuna, JSON.stringify(o.tabelasExtra ?? [])]);
```

- [ ] **Step 2: tsc do hook**

Run: `npx tsc --noEmit 2>&1 | grep -E "useColabRegistro|TS2304" || echo "OK"`
Expected: `OK`.

- [ ] **Step 3: Adicionar imports + `ROTULO_CONFLITO` + `rotuloConflito` no PCP**

Em `src/routes/_authenticated/pcp.servicos.$modeloId.tsx`, adicionar imports (junto dos existentes de `@/lib/grade-cortada` e `@/hooks`):

```ts
import { ColabBanner } from "@/components/shared/ColabBanner";
import { useColabRegistro } from "@/hooks/useColabRegistro";
import { mergeLinhas, igual, type Conflito } from "@/lib/colab/merge";
import { mergeGrade } from "@/lib/colab/merge-grade";
```

E, no escopo de módulo (perto do topo, fora do componente), o dicionário de rótulos + o resolvedor de path:

```ts
// Colab (spec 2026-08-07): rótulos PT dos paths do banner de resolução genérica.
const ROTULO_CONFLITO: Record<string, string> = {
  categoria_terceirizado_id: "Serviço",
  empresa_id: "Fornecedor",
  representante_id: "Representante",
  colaborador_id: "Colaborador",
  preco_metro_unidade: "Preço unit.",
  quantidade_enviada: "Qtd. enviada",
  quantidade_recebida: "Qtd. recebida",
  quantidade_defeito: "Qtd. defeito",
  desconto_total: "Desconto",
  multa_total: "Multa",
  numero_parcelas: "Nº de parcelas",
  data_enviado: "Data de envio",
  data_prevista: "Data prevista",
  data_entregue: "Data de entrega",
  observacao: "Observação",
};
const CAMPO_GRADE_PT: Record<string, string> = {
  enviada: "Enviada", cortada: "Cortada", recebida: "Recebida", defeito: "Defeito",
};
function rotuloConflito(path: string): string {
  if (path.startsWith("linha:")) return "Bloco de serviço";
  if (path.startsWith("grade:")) {
    const [, , tam, campo] = path.split(":");   // grade:{vid}:{tam}:{campo}
    return `${CAMPO_GRADE_PT[campo] ?? campo} · ${tam}`;
  }
  return ROTULO_CONFLITO[path] ?? path;
}
```

- [ ] **Step 4: Adicionar refs colab + `setBlocosTracked` + `revByBlocoRef`**

Dentro do componente, logo após `const [blocos, setBlocos] = useState<Bloco[]>([]);`, adicionar o maquinário colab (espelha o piloto OC Tecido, linhas 658–706). O `touched` cobre DUAS granularidades: id de bloco (escalares) e path de célula (`grade:{vid}:{tam}:{campo}`):

```ts
  // Colab (spec 2026-08-07): merge 3-vias no refetch/Realtime em vez de re-seed às cegas.
  const touchedBlocoIdsRef = useRef<Set<string>>(new Set());   // blocos com escalar editado
  const touchedGradeRef = useRef<Set<string>>(new Set());      // células "grade:{vid}:{tam}:{campo}"
  const baseBlocosRef = useRef<Bloco[] | null>(null);          // último "fresh" visto (por bloco)
  const revByBlocoRef = useRef<Record<string, number>>({});    // bloco.id → rev do servidor
  const retryRef = useRef(false);
  const savingRef = useRef(false);
  const blocosLiveRef = useRef(blocos);
  blocosLiveRef.current = blocos;
  const [ultimoMerge, setUltimoMerge] = useState<{ atualizados: number; conflitos: Conflito[] } | null>(null);
  const [conflitos, setConflitos] = useState<Conflito[]>([]);
  const conflitosRef = useRef<Conflito[]>([]);
  const [campoFocado, setCampoFocado] = useState<string | null>(null);

  // Setter rastreado: difere prev→next por bloco (id) e por célula da grade; marca o touched.
  // Mantém a assinatura de setBlocos (zero mudança nos filhos que já chamam setBlocos).
  const setBlocosTracked: typeof setBlocos = (upd) =>
    setBlocos((prev) => {
      const next = typeof upd === "function" ? (upd as (p: Bloco[]) => Bloco[])(prev) : upd;
      for (const b of next) {
        if (!b.id) continue;
        const p = prev.find((x) => x.id === b.id);
        if (!p) continue;
        // escalares do bloco (tudo menos grade_detalhe/_key)
        for (const k of Object.keys(b) as (keyof Bloco)[]) {
          if (k === "grade_detalhe" || k === "_key") continue;
          if (!igual(b[k], p[k])) touchedBlocoIdsRef.current.add(b.id);
        }
        // células da grade
        const vids = new Set([...Object.keys(b.grade_detalhe ?? {}), ...Object.keys(p.grade_detalhe ?? {})]);
        for (const vid of vids) {
          const tams = new Set([...Object.keys(b.grade_detalhe?.[vid] ?? {}), ...Object.keys(p.grade_detalhe?.[vid] ?? {})]);
          for (const tam of tams) for (const campo of ["enviada", "cortada", "recebida", "defeito"] as const) {
            const a = Number(b.grade_detalhe?.[vid]?.[tam]?.[campo]) || 0;
            const c = Number(p.grade_detalhe?.[vid]?.[tam]?.[campo]) || 0;
            if (a !== c) touchedGradeRef.current.add(`grade:${vid}:${tam}:${campo}`);
          }
        }
      }
      return next;
    });
```

**Nota de wiring:** trocar as chamadas de mutação de estado dos blocos de `setBlocos(...)` para `setBlocosTracked(...)` nas funções de edição (`updateBloco`, `addBloco`, `removeBloco`, e nos handlers de célula da grade). Manter `setBlocos` cru só na hidratação/merge/resolução (onde já sabemos o que aconteceu). Ver o piloto (`setDraftTracked`/`setItemsTracked`).

- [ ] **Step 5: Converter hidratação one-shot em merge 3-vias no refetch**

Substituir o `useEffect` de hidratação atual (o que checa `if (hydrated) return;` e faz `setBlocos(...)`) pela versão colab: 1ª carga semeia + baseline; refetch faz `mergeLinhas` (escalares por bloco) + `mergeGrade` (células de cada bloco) e sinaliza conflitos. Fora do `if (hydrated) return`, agora guiado por `baseBlocosRef`. O mapeamento server→Bloco fica numa função `blocosFromRows` reutilizável (extrair do corpo atual):

```ts
  const blocosFromRows = (rows: any[]): Bloco[] =>
    rows.map((r) => ({
      _key: r.id ?? crypto.randomUUID(),
      id: r.id,
      categoria_terceirizado_id: r.categoria_terceirizado_id,
      interno: Boolean(r.interno),
      empresa_id: r.empresa_id ?? null,
      representante_id: r.representante_id ?? null,
      colaborador_id: r.colaborador_id ?? null,
      preco_metro_unidade: Number(r.preco_metro_unidade ?? 0),
      aprovado: Boolean(r.aprovado),
      quantidade_enviada: Number(r.quantidade_enviada ?? 0),
      quantidade_recebida: Number(r.quantidade_recebida ?? 0),
      quantidade_defeito: Number(r.quantidade_defeito ?? 0),
      desconto_total: Number(r.desconto_total ?? 0),
      multa_total: Number(r.multa_total ?? 0),
      numero_parcelas: Number(r.numero_parcelas ?? 1),
      data_enviado: r.data_enviado,
      data_prevista: r.data_prevista,
      data_entregue: r.data_entregue,
      status: r.status,
      observacao: r.observacao ?? "",
      aviamentos_enviados: Array.isArray(r.aviamentos_enviados) ? r.aviamentos_enviados : [],
      tecidos_enviados: Array.isArray(r.tecidos_enviados) ? r.tecidos_enviados : [],
      detalhado: Boolean(r.detalhado),
      grade_detalhe: (r.grade_detalhe && typeof r.grade_detalhe === "object" ? r.grade_detalhe : {}) as GradeDetalhe,
    }));

  useEffect(() => {
    if (!cad?.id) return;
    if (!existingFetched || existingFetching) return;
    const fresh = blocosFromRows(existing as any[]);
    revByBlocoRef.current = Object.fromEntries((existing as any[]).filter((r) => r.id).map((r) => [r.id, Number(r.rev ?? 0)]));

    if (!baseBlocosRef.current) {
      // 1ª carga: seed normal.
      baseBlocosRef.current = fresh;
      setBlocos(fresh);
      setHydrated(true);
      touchedBlocoIdsRef.current = new Set();
      touchedGradeRef.current = new Set();
      conflitosRef.current = [];
      setConflitos([]);
      resetBaseline({ blocos: fresh, observacoesMolde });
      return;
    }
    // Refetch: MERGE. Escalares por bloco (mergeLinhas) + células (mergeGrade) por bloco.
    const ml = mergeLinhas({ base: baseBlocosRef.current, draft: blocos, fresh, touchedIds: touchedBlocoIdsRef.current });
    let out = ml.linhas;
    const gradeConf: Conflito[] = [];
    let gradeAtual = 0;
    out = out.map((b) => {
      if (!b.id) return b;
      const fb = fresh.find((x) => x.id === b.id);
      const bb = baseBlocosRef.current!.find((x) => x.id === b.id);
      if (!fb || !bb) return b;
      const mg = mergeGrade({ base: bb.grade_detalhe ?? {}, meu: b.grade_detalhe ?? {}, fresh: fb.grade_detalhe ?? {}, tocadas: touchedGradeRef.current });
      gradeConf.push(...mg.conflitos);
      gradeAtual += mg.atualizados.length;
      return mg.atualizados.length || mg.conflitos.length ? { ...b, grade_detalhe: mg.valor } : b;
    });
    const todos = [...ml.conflitos, ...gradeConf];
    const semResultado = ml.atualizadas.length === 0 && ml.conflitos.length === 0 && gradeConf.length === 0 && gradeAtual === 0;
    if (semResultado) { baseBlocosRef.current = fresh; return; }
    setBlocos(out);
    conflitosRef.current = todos;
    setConflitos(todos);
    setUltimoMerge({ atualizados: ml.atualizadas.length + gradeAtual, conflitos: todos });
    baseBlocosRef.current = fresh;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, cad?.id, existingFetched, existingFetching]);
```

(Remover o antigo gate `if (hydrated) return;` — o baseline agora é `baseBlocosRef`. O `setHydrated(true)` no seed mantém a lógica de trava por-aba/`abaFinalizada` que lê `hydrated` indiretamente via `existing`.)

- [ ] **Step 6: Presença + resolução de conflito + banner**

Adicionar, após os refs, a assinatura do canal e o resolvedor genérico (espelha o piloto, linhas 708–763):

```ts
  const { presentes } = useColabRegistro({
    canal: cad?.id ? `colab:pcp-servico:${cad.id}` : null,
    tabela: "producao_terceirizados",
    filtroColuna: "cad_id",
    registroId: cad?.id ?? null,
    onMudancaServidor: () => qc.invalidateQueries({ queryKey: ["producao-terc", cad?.id] }),
    campoFocado,
  });

  const resolverPorPath = (path: string, escolha: "meu" | "dele") => {
    const c = conflitos.find((x) => x.path === path);
    if (!c) return;
    if (escolha === "dele") {
      if (path.startsWith("grade:")) {
        const [, vid, tam, campo] = path.split(":");
        setBlocos((prev) => prev.map((b) => {
          const has = b.grade_detalhe?.[vid]?.[tam] !== undefined || b.grade_detalhe?.[vid] !== undefined;
          if (!b.id || !has) return b;
          const gd = { ...b.grade_detalhe, [vid]: { ...(b.grade_detalhe?.[vid] ?? {}) } };
          gd[vid][tam] = { ...(b.grade_detalhe?.[vid]?.[tam] ?? {} as any), [campo]: Number(c.dele) || 0 };
          return { ...b, grade_detalhe: gd };
        }));
        touchedGradeRef.current.delete(path);
      } else if (path.startsWith("linha:")) {
        const id = path.slice("linha:".length);
        setBlocos((prev) => c.dele ? prev.map((b) => (b.id === id ? (c.dele as Bloco) : b)) : prev.filter((b) => b.id !== id));
        touchedBlocoIdsRef.current.delete(id);
      } else {
        // conflito de escalar num bloco: aplica dele.[path] no bloco correspondente
        const id = (c.dele as any)?.id ?? (c.meu as any)?.id;
        if (id) { setBlocos((prev) => prev.map((b) => (b.id === id ? { ...b, ...(c.dele as any) } : b))); touchedBlocoIdsRef.current.delete(id); }
      }
    }
    setConflitos((prev) => { const nx = prev.filter((x) => x.path !== path); conflitosRef.current = nx; return nx; });
    setUltimoMerge((prev) => prev ? { ...prev, conflitos: prev.conflitos.filter((x) => x.path !== path) } : prev);
  };
```

**Nota:** `mergeLinhas` emite conflito de LINHA (`linha:{id}`) com o bloco inteiro em `meu`/`dele` (granularidade grossa nos escalares — aceitável: o overlap fino de interesse é a grade, coberto por `mergeGrade`). Por isso o ramo de escalar acima lê `c.dele.id`.

Renderizar o banner logo abaixo do header/topo do formulário (perto de onde o `<UnsavedIndicator>` já mora):

```tsx
      <ColabBanner
        presentes={presentes}
        ultimoMerge={ultimoMerge}
        conflitos={conflitos}
        onResolver={resolverPorPath}
        rotulo={rotuloConflito}
      />
```

- [ ] **Step 7: Enviar `_rev_base` no save + guard de conflito + retry P0409**

No `saveMut`, (a) montar `_rev_base` a partir de `revByBlocoRef`; (b) barrar o save com conflito pendente; (c) tratar P0409 no `onError`. Editar a `mutationFn` para incluir o `_rev_base`:

```ts
      if (conflitosRef.current.length > 0)
        throw new Error("Resolva os conflitos listados no aviso no topo antes de salvar.");
      const _rev_base = Object.fromEntries(
        blocos.filter((b) => b.id).map((b) => [b.id as string, revByBlocoRef.current[b.id as string] ?? 0]),
      );
      const { error } = await supabase.rpc("salvar_terceirizados" as any, {
        _cad_id: cad.id,
        _blocos,
        _observacoes_molde: observacoesMolde || null,
        _rev_base,
      });
      if (error) throw error;
```

No `onSuccess`, limpar o touched/conflitos e re-baselinar (o refetch existente já re-hidrata; agora via merge no-op):

```ts
    onSuccess: async () => {
      toast.success("Salvo com sucesso");
      markClean();
      setEditing(false);
      touchedBlocoIdsRef.current = new Set();
      touchedGradeRef.current = new Set();
      conflitosRef.current = [];
      setConflitos([]);
      setUltimoMerge(null);
      await qc.invalidateQueries({ queryKey: ["producao-terc", cad?.id] });
      await qc.invalidateQueries({ queryKey: ["terc-cad", modeloId] });
      await qc.invalidateQueries({ queryKey: ["producao-terc-list"] });
      qc.invalidateQueries({ queryKey: ["servicos-financeiro"] });
      await refetch();
      setMoldeHydrated(false);
      baselinedRef.current = false;
    },
```

(Remover o `setHydrated(false)` — o merge effect agora reconcilia via `baseBlocosRef`; deixar `setHydrated(false)` re-seedaria às cegas e apagaria o merge.)

Substituir `onError` pelo retry P0409 síncrono (espelha o piloto, linhas 1265–1324):

```ts
    onError: async (e: any) => {
      if (e?.code === "P0409" && !retryRef.current) {
        retryRef.current = true;
        savingRef.current = true;
        await qc.refetchQueries({ queryKey: ["producao-terc", cad?.id] });
        const rows = qc.getQueryData<any[]>(["producao-terc", cad?.id]) ?? [];
        const fresh = blocosFromRows(rows);
        revByBlocoRef.current = Object.fromEntries(rows.filter((r) => r.id).map((r) => [r.id, Number(r.rev ?? 0)]));
        const base = baseBlocosRef.current ?? fresh;
        const live = blocosLiveRef.current;
        const ml = mergeLinhas({ base, draft: live, fresh, touchedIds: touchedBlocoIdsRef.current });
        const gradeConf: Conflito[] = [];
        const out = ml.linhas.map((b) => {
          if (!b.id) return b;
          const fb = fresh.find((x) => x.id === b.id); const bb = base.find((x) => x.id === b.id);
          if (!fb || !bb) return b;
          const mg = mergeGrade({ base: bb.grade_detalhe ?? {}, meu: b.grade_detalhe ?? {}, fresh: fb.grade_detalhe ?? {}, tocadas: touchedGradeRef.current });
          gradeConf.push(...mg.conflitos);
          return mg.atualizados.length || mg.conflitos.length ? { ...b, grade_detalhe: mg.valor } : b;
        });
        setBlocos(out);
        const todos = [...ml.conflitos, ...gradeConf];
        conflitosRef.current = todos;
        setConflitos(todos);
        setUltimoMerge({ atualizados: ml.atualizadas.length, conflitos: todos });
        baseBlocosRef.current = fresh;
        if (todos.length === 0) {
          saveMut.mutate(undefined, { onSettled: () => { savingRef.current = false; retryRef.current = false; } });
          return;
        }
        savingRef.current = false; retryRef.current = false;
        toast.error(mensagemErro(e, "Erro ao salvar"));
        return;
      }
      toast.error(mensagemErro(e, "Erro ao salvar"));
    },
```

- [ ] **Step 8: build + tsc**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep TS2304 || echo "OK"`
Expected: build OK; `OK` (sem identificador indefinido).

- [ ] **Step 9: QA manual 2-contexts (mesmo usuário, 2 abas)**

Abrir o mesmo modelo em PCP Serviços em 2 abas. (a) Aba A edita preço do bloco X, aba B edita data do bloco Y → ambos salvam sem conflito (áreas/blocos diferentes). (b) As duas editam a MESMA célula recebida/defeito do bloco-fonte → a 2ª a salvar recebe P0409, o banner mostra `Recebida · M: meu N · novo M`, resolve e salva. (c) Presença: cada aba vê "Fulano também está nesta tela".
Expected: comportamentos acima.

- [ ] **Step 10: Commit**

```bash
git add src/hooks/useColabRegistro.ts src/routes/_authenticated/pcp.servicos.\$modeloId.tsx
git commit -m "feat(colab): PCP Serviços — merge 3-vias (blocos + grade) + _rev_base + P0409"
```

---

## Task 6: Adoção colab no CQ (front)

**Files:**
- Modify: `src/routes/_authenticated/expedicao.cq.$modeloId.tsx`

**Interfaces:**
- Consumes: `useColabRegistro` estendido (T5), `mergeDraft`/`igual`/`Conflito`, `mergeGrade` (T4), `ColabBanner`, `salvar_cq(... _rev_base)` (T3), `controle_qualidade.rev` + `producao_terceirizados.rev` (T1).

**Contexto REAL (verificado):** o CQ JÁ refetch pós-save (Task 4 da Grade Cortada): `onSuccess` invalida + `refetchCq()` + `refetchVars()` + invalida `["cq-blocos-fonte", cad.id]` + `setHydrated(false)` (re-seed one-shot). Estado editável: `form` (escalares: datas conserto/lavagem, obs, pecas_*), `grades` (por etapa/variante_numero/tamanho), `fotografado`. O overlap que importa é recebimento/defeito (vêm do `grade_detalhe` do bloco-fonte). `cqRow` (`["cq", cad.id]`, `select("*")` → `rev` de graça). `blocosFonte` (`["cq-blocos-fonte", cad.id]`) tem SELECT explícito — precisa adicionar `rev`. `fonte.fonteId` (via `resolverFonteConfeccao`) dá o bloco-fonte; seu `rev` é o `_rev_base.fonte`.

- [ ] **Step 1: Adicionar `rev` ao SELECT de `blocosFonte`**

Editar a query `["cq-blocos-fonte", cad?.id]`: trocar
`.select("id, categoria_terceirizado_id, detalhado, ativo, created_at, grade_detalhe")`
por
`.select("id, categoria_terceirizado_id, detalhado, ativo, created_at, grade_detalhe, rev")`.

- [ ] **Step 2: Imports + refs colab + rótulos**

Adicionar imports:

```ts
import { ColabBanner } from "@/components/shared/ColabBanner";
import { useColabRegistro } from "@/hooks/useColabRegistro";
import { mergeDraft, igual, type Conflito } from "@/lib/colab/merge";
import { mergeGrade } from "@/lib/colab/merge-grade";
```

Rótulos no escopo de módulo:

```ts
const ROTULO_CONFLITO: Record<string, string> = {
  observacoes_cq: "Observações do CQ",
  pecas_incompletas: "Peças incompletas",
  pecas_faltantes: "Peças faltantes",
  pecas_sem_etiqueta: "Peças sem etiqueta",
  data_conserto_enviado: "Conserto — envio",
  data_conserto_prevista: "Conserto — previsão",
  data_conserto_entregue: "Conserto — entrega",
  data_lavagem_enviado: "Lavagem — envio",
  data_lavagem_entregue: "Lavagem — entrega",
};
const CAMPO_GRADE_PT: Record<string, string> = { recebida: "Recebida", defeito: "Defeito", enviada: "Enviada", cortada: "Cortada" };
function rotuloConflito(path: string): string {
  if (path.startsWith("grade:")) { const [, , tam, campo] = path.split(":"); return `${CAMPO_GRADE_PT[campo] ?? campo} · ${tam}`; }
  return ROTULO_CONFLITO[path] ?? path;
}
```

Refs dentro do componente (após os `useState` de `form`/`grades`/`fotografado`):

```ts
  // Colab (spec 2026-08-07): merge no refetch em vez de re-seed one-shot.
  const touchedFormRef = useRef<Set<string>>(new Set());   // campos escalares do form
  const touchedGradeRef = useRef<Set<string>>(new Set());  // células "grade:{vid}:{tam}:{campo}" (recebida/defeito)
  const baseFormRef = useRef<typeof form | null>(null);
  const baseGradeRef = useRef<GradeDetalhe>({});           // recebida/defeito do fonteGrade da última carga
  const cqRevRef = useRef<number | null>(null);
  const fonteRevRef = useRef<number | null>(null);
  const retryRef = useRef(false);
  const savingRef = useRef(false);
  const formLiveRef = useRef(form); formLiveRef.current = form;
  const gradesLiveRef = useRef(grades); gradesLiveRef.current = grades;
  const [ultimoMerge, setUltimoMerge] = useState<{ atualizados: number; conflitos: Conflito[] } | null>(null);
  const [conflitos, setConflitos] = useState<Conflito[]>([]);
  const conflitosRef = useRef<Conflito[]>([]);
  const [campoFocado, setCampoFocado] = useState<string | null>(null);
```

**Nota:** trocar o `setForm(...)` das edições por um `setFormTracked` que marca `touchedFormRef` (mesmo idiom do piloto); e nos handlers de célula de recebimento/defeito, adicionar `touchedGradeRef.current.add("grade:${vid}:${tam}:${campo}")`. O `vid` vem de `vidByNum[variante_numero]`.

- [ ] **Step 3: Presença (2 tabelas) + banner**

```ts
  const { presentes } = useColabRegistro({
    canal: cad?.id ? `colab:cq:${cad.id}` : null,
    tabela: "controle_qualidade",
    filtroColuna: "cad_id",
    registroId: cad?.id ?? null,
    // escuta TAMBÉM o bloco-fonte (producao_terceirizados por cad) — quando o PCP grava
    // recebido/defeito, o fonte bumpa e o CQ aberto refaz o merge.
    tabelasExtra: cad?.id ? [{ tabela: "producao_terceirizados", filtroColuna: "cad_id", valor: cad.id }] : [],
    onMudancaServidor: () => {
      qc.invalidateQueries({ queryKey: ["cq", cad?.id] });
      qc.invalidateQueries({ queryKey: ["cq_variantes", cqRow?.id] });
      qc.invalidateQueries({ queryKey: ["cq-blocos-fonte", cad?.id] });
    },
    campoFocado,
  });
```

Banner (perto do topo do formulário):

```tsx
      <ColabBanner presentes={presentes} ultimoMerge={ultimoMerge} conflitos={conflitos} onResolver={resolverPorPath} rotulo={rotuloConflito} />
```

- [ ] **Step 4: Merge no refetch (form escalar + grade recebida/defeito)**

Converter o `useEffect` de hidratação (`if (hydrated || !cad?.id) return;`) para: 1ª carga = seed atual + captura de base/revs; refetch (base já existe) = `mergeDraft` no `form` + `mergeGrade` na grade recebida/defeito. Reutilizar o cálculo de `fonteGrade`/`vidByNum` já presentes. Adicionar, ao FINAL do bloco de seed (após `setHydrated(true)`), a captura das bases e revs:

```ts
      // Colab: captura base/rev p/ o merge do próximo refetch.
      baseFormRef.current = nextForm;
      cqRevRef.current = (cqRow as any)?.rev ?? null;
      fonteRevRef.current = temFonte
        ? (Number(((blocosFonte as any[]).find((x) => x.id === fonte.fonteId))?.rev) ?? null)
        : null;
      // base da grade = recebida/defeito derivados do fonteGrade nesta carga (por vid/tam).
      const bg: GradeDetalhe = {};
      if (temFonte) variantList.forEach(({ num }) => {
        const vid = vidByNum[num]; if (!vid) return; const cel = fonteGrade[vid] ?? {};
        bg[vid] = {}; tamanhos.forEach((t) => { bg[vid][t] = { enviada: 0, cortada: 0, recebida: Number(cel[t]?.recebida) || 0, defeito: Number(cel[t]?.defeito) || 0 }; });
      });
      baseGradeRef.current = bg;
```

E adicionar um `useEffect` de MERGE-no-refetch (roda quando `cqRow`/`varRows`/`blocosFonte` chegam frescos E `hydrated` já é true), que:
1. Monta `freshForm` (do `cqRow`) e `freshGrade` (recebida/defeito do `fonteGrade` fresco).
2. `mergeDraft({ base: baseFormRef.current, draft: formLiveRef.current, fresh: freshForm, touched: touchedFormRef.current })`.
3. `mergeGrade({ base: baseGradeRef.current, meu: <grade viva convertida p/ GradeDetalhe recebida/defeito>, fresh: freshGrade, tocadas: touchedGradeRef.current })`.
4. Se houve resultado: `setForm(md.valor)`, aplica as células resolvidas do `mergeGrade` de volta em `grades.recebimento`/`grades.defeito` (traduzindo vid→num), acumula conflitos, `setConflitos`, `setUltimoMerge`; atualiza `baseFormRef`/`baseGradeRef`/`cqRevRef`/`fonteRevRef`. No-op → só reajusta as bases (igual ao guard `semResultado` do piloto).

```ts
  useEffect(() => {
    if (!hydrated || !cad?.id) return;
    if (!(cqFetched && !cqFetching && blocosFetched && !blocosFetching)) return;
    const freshForm = {
      data_conserto_enviado: cqRow?.data_conserto_enviado ?? "",
      data_conserto_prevista: cqRow?.data_conserto_prevista ?? "",
      data_conserto_entregue: cqRow?.data_conserto_entregue ?? "",
      data_lavagem_enviado: cqRow?.data_lavagem_enviado ?? "",
      data_lavagem_entregue: cqRow?.data_lavagem_entregue ?? "",
      observacoes_cq: cqRow?.observacoes_cq ?? "",
      pecas_incompletas: Number(cqRow?.pecas_incompletas ?? 0),
      pecas_faltantes: Number(cqRow?.pecas_faltantes ?? 0),
      pecas_sem_etiqueta: Number(cqRow?.pecas_sem_etiqueta ?? 0),
    };
    const freshGrade: GradeDetalhe = {};
    if (temFonte) variantList.forEach(({ num }) => {
      const vid = vidByNum[num]; if (!vid) return; const cel = fonteGrade[vid] ?? {};
      freshGrade[vid] = {}; tamanhos.forEach((t) => { freshGrade[vid][t] = { enviada: 0, cortada: 0, recebida: Number(cel[t]?.recebida) || 0, defeito: Number(cel[t]?.defeito) || 0 }; });
    });
    // grade viva → GradeDetalhe (recebida/defeito) p/ o merge
    const meuGrade: GradeDetalhe = {};
    if (temFonte) variantList.forEach(({ num }) => {
      const vid = vidByNum[num]; if (!vid) return; meuGrade[vid] = {};
      tamanhos.forEach((t) => {
        meuGrade[vid][t] = { enviada: 0, cortada: 0,
          recebida: Number(gradesLiveRef.current.recebimento[num]?.grades?.[t]) || 0,
          defeito: Number(gradesLiveRef.current.defeito[num]?.grades?.[t]) || 0 };
      });
    });
    const md = mergeDraft({ base: baseFormRef.current ?? freshForm, draft: formLiveRef.current, fresh: freshForm, touched: touchedFormRef.current });
    const mg = mergeGrade({ base: baseGradeRef.current, meu: meuGrade, fresh: freshGrade, tocadas: touchedGradeRef.current });
    const todos = [...md.conflitos, ...mg.conflitos];
    if (md.atualizados.length === 0 && md.conflitos.length === 0 && mg.atualizados.length === 0 && mg.conflitos.length === 0) {
      baseFormRef.current = freshForm; baseGradeRef.current = freshGrade;
      cqRevRef.current = (cqRow as any)?.rev ?? null;
      fonteRevRef.current = temFonte ? (Number(((blocosFonte as any[]).find((x) => x.id === fonte.fonteId))?.rev) ?? null) : null;
      return;
    }
    if (md.atualizados.length || md.conflitos.length) setForm(md.valor);
    if (mg.atualizados.length || mg.conflitos.length) {
      setGrades((prev) => {
        const g = { ...prev, recebimento: { ...prev.recebimento }, defeito: { ...prev.defeito } };
        variantList.forEach(({ num }) => {
          const vid = vidByNum[num]; if (!vid) return; const rec: Record<string, number> = {}; const def: Record<string, number> = {}; let rT = 0, dT = 0;
          tamanhos.forEach((t) => { const rc = Number(mg.valor[vid]?.[t]?.recebida) || 0; const dc = Number(mg.valor[vid]?.[t]?.defeito) || 0; if (rc) { rec[t] = rc; rT += rc; } if (dc) { def[t] = dc; dT += dc; } });
          g.recebimento[num] = { variante_numero: num, grades: rec, grade_total: rT };
          g.defeito[num] = { ...(g.defeito[num] ?? { variante_numero: num }), grades: def, grade_total: dT } as any;
        });
        return g;
      });
    }
    conflitosRef.current = todos; setConflitos(todos);
    setUltimoMerge({ atualizados: md.atualizados.length + mg.atualizados.length, conflitos: todos });
    baseFormRef.current = freshForm; baseGradeRef.current = freshGrade;
    cqRevRef.current = (cqRow as any)?.rev ?? null;
    fonteRevRef.current = temFonte ? (Number(((blocosFonte as any[]).find((x) => x.id === fonte.fonteId))?.rev) ?? null) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cqRow, varRows, blocosFonte, fonteGrade, hydrated, temFonte]);
```

- [ ] **Step 5: Resolver conflito por path (form + grade)**

```ts
  const resolverPorPath = (path: string, escolha: "meu" | "dele") => {
    const c = conflitos.find((x) => x.path === path);
    if (!c) return;
    if (escolha === "dele") {
      if (path.startsWith("grade:")) {
        const [, vid, tam, campo] = path.split(":");
        const num = Number(Object.keys(vidByNum).find((k) => vidByNum[Number(k)] === vid));
        const et = campo === "recebida" ? "recebimento" : "defeito";
        setGrades((prev) => {
          const row = prev[et as "recebimento" | "defeito"][num] ?? { variante_numero: num, grades: {}, grade_total: 0 };
          const grades = { ...row.grades, [tam]: Number(c.dele) || 0 };
          const grade_total = Object.values(grades).reduce((s, v) => s + (Number(v) || 0), 0);
          return { ...prev, [et]: { ...prev[et as "recebimento" | "defeito"], [num]: { ...row, grades, grade_total } } };
        });
        touchedGradeRef.current.delete(path);
      } else {
        setForm((f) => ({ ...f, [path]: c.dele as any }));
        touchedFormRef.current.delete(path);
      }
    }
    setConflitos((prev) => { const nx = prev.filter((x) => x.path !== path); conflitosRef.current = nx; return nx; });
    setUltimoMerge((prev) => prev ? { ...prev, conflitos: prev.conflitos.filter((x) => x.path !== path) } : prev);
  };
```

- [ ] **Step 6: `_rev_base` no save + guard + retry P0409**

Em `saveCq`, montar `_rev_base` e barrar conflito pendente:

```ts
  const saveCq = async (confirmar: boolean) => {
    if (!cad?.id) throw new Error("CAD não encontrado. Abra o CAD desse modelo primeiro.");
    if (conflitosRef.current.length > 0) throw new Error("Resolva os conflitos listados no aviso no topo antes de salvar.");
    const { cq, variantes, reais } = buildCqData();
    const _rev_base = { cq: cqRevRef.current, fonte: temFonte ? fonteRevRef.current : null };
    const { error } = await supabase.rpc("salvar_cq" as any, {
      _cad_id: cad.id, _cq: cq, _variantes: variantes, _reais: reais, _confirmar: confirmar, _rev_base,
    });
    if (error) throw error;
  };
```

No `onSuccess` de `saveMut` e `confirmMut`, limpar touched/conflitos e NÃO fazer `setHydrated(false)` (o merge effect reconcilia). Manter os `refetchCq`/`refetchVars`/invalidações. Adicionar:

```ts
      touchedFormRef.current = new Set();
      touchedGradeRef.current = new Set();
      conflitosRef.current = []; setConflitos([]); setUltimoMerge(null);
```

No `onError` de `saveMut` (e igual em `confirmMut`, só trocando a mutation re-chamada), tratar P0409 com retry síncrono. Extrair num helper `reconciliarCq()` reutilizado pelos dois `onError` para não duplicar:

```ts
  // Reconcilia o estado a partir do servidor fresco (chamado no onError P0409). Retorna
  // os conflitos que sobraram; [] = pode re-salvar. Lê os refs-espelho (formLive/gradesLive)
  // p/ não perder tecla digitada durante o voo do save (janela do await) — igual ao piloto.
  const reconciliarCq = async (): Promise<Conflito[]> => {
    await qc.refetchQueries({ queryKey: ["cq", cad?.id] });
    await qc.refetchQueries({ queryKey: ["cq-blocos-fonte", cad?.id] });
    const freshCq = qc.getQueryData<any>(["cq", cad?.id]) ?? null;
    const freshBlocos = qc.getQueryData<any[]>(["cq-blocos-fonte", cad?.id]) ?? [];
    const freshFonte = freshBlocos.find((x) => x.id === fonte.fonteId);
    const freshFonteGrade = (freshFonte?.grade_detalhe ?? {}) as Record<string, Record<string, { recebida?: number; defeito?: number }>>;
    const freshForm = {
      data_conserto_enviado: freshCq?.data_conserto_enviado ?? "",
      data_conserto_prevista: freshCq?.data_conserto_prevista ?? "",
      data_conserto_entregue: freshCq?.data_conserto_entregue ?? "",
      data_lavagem_enviado: freshCq?.data_lavagem_enviado ?? "",
      data_lavagem_entregue: freshCq?.data_lavagem_entregue ?? "",
      observacoes_cq: freshCq?.observacoes_cq ?? "",
      pecas_incompletas: Number(freshCq?.pecas_incompletas ?? 0),
      pecas_faltantes: Number(freshCq?.pecas_faltantes ?? 0),
      pecas_sem_etiqueta: Number(freshCq?.pecas_sem_etiqueta ?? 0),
    };
    const freshGrade: GradeDetalhe = {}; const meuGrade: GradeDetalhe = {};
    if (temFonte) variantList.forEach(({ num }) => {
      const vid = vidByNum[num]; if (!vid) return; const cel = freshFonteGrade[vid] ?? {};
      freshGrade[vid] = {}; meuGrade[vid] = {};
      tamanhos.forEach((t) => {
        freshGrade[vid][t] = { enviada: 0, cortada: 0, recebida: Number(cel[t]?.recebida) || 0, defeito: Number(cel[t]?.defeito) || 0 };
        meuGrade[vid][t] = { enviada: 0, cortada: 0,
          recebida: Number(gradesLiveRef.current.recebimento[num]?.grades?.[t]) || 0,
          defeito: Number(gradesLiveRef.current.defeito[num]?.grades?.[t]) || 0 };
      });
    });
    const md = mergeDraft({ base: baseFormRef.current ?? freshForm, draft: formLiveRef.current, fresh: freshForm, touched: touchedFormRef.current });
    const mg = mergeGrade({ base: baseGradeRef.current, meu: meuGrade, fresh: freshGrade, tocadas: touchedGradeRef.current });
    if (md.atualizados.length || md.conflitos.length) setForm(md.valor);
    if (mg.atualizados.length || mg.conflitos.length) setGrades((prev) => {
      const g = { ...prev, recebimento: { ...prev.recebimento }, defeito: { ...prev.defeito } };
      variantList.forEach(({ num }) => {
        const vid = vidByNum[num]; if (!vid) return; const rec: Record<string, number> = {}; const def: Record<string, number> = {}; let rT = 0, dT = 0;
        tamanhos.forEach((t) => { const rc = Number(mg.valor[vid]?.[t]?.recebida) || 0; const dc = Number(mg.valor[vid]?.[t]?.defeito) || 0; if (rc) { rec[t] = rc; rT += rc; } if (dc) { def[t] = dc; dT += dc; } });
        g.recebimento[num] = { variante_numero: num, grades: rec, grade_total: rT };
        g.defeito[num] = { ...(g.defeito[num] ?? { variante_numero: num }), grades: def, grade_total: dT } as any;
      });
      return g;
    });
    const todos = [...md.conflitos, ...mg.conflitos];
    conflitosRef.current = todos; setConflitos(todos);
    setUltimoMerge({ atualizados: md.atualizados.length + mg.atualizados.length, conflitos: todos });
    baseFormRef.current = freshForm; baseGradeRef.current = freshGrade;
    cqRevRef.current = (freshCq as any)?.rev ?? null;
    fonteRevRef.current = temFonte ? (Number(freshFonte?.rev) ?? null) : null;
    return todos;
  };
```

`onError` do `saveMut` (o do `confirmMut` é idêntico, trocando `saveMut.mutate` por `confirmMut.mutate`):

```ts
    onError: async (e: any) => {
      if (e?.code === "P0409" && !retryRef.current) {
        retryRef.current = true; savingRef.current = true;
        const restantes = await reconciliarCq();
        if (restantes.length === 0) {
          saveMut.mutate(undefined, { onSettled: () => { savingRef.current = false; retryRef.current = false; } });
          return;
        }
        savingRef.current = false; retryRef.current = false;
        toast.error(mensagemErro(e, "Erro ao salvar"));
        return;
      }
      toast.error(mensagemErro(e, "Erro ao salvar"));
    },
```

- [ ] **Step 7: build + tsc**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep TS2304 || echo "OK"`
Expected: build OK; `OK`.

- [ ] **Step 8: QA manual 2-contexts + cross-tela**

(a) 2 abas no CQ do mesmo modelo: uma edita obs, outra edita datas de conserto → ambas salvam. (b) As duas editam a MESMA célula recebida → 2ª recebe P0409, banner `Recebida · M`, resolve, salva. (c) Cross-tela: abrir PCP Serviços e CQ do mesmo modelo; no PCP editar recebido de uma célula do bloco-fonte e salvar → o CQ aberto refaz o merge e mostra o número fresco na célula não-tocada (sem conflito). (d) No CQ, com `_rev_base.fonte` velho (PCP salvou no meio), o save do CQ dá P0409 e reconcilia.
Expected: comportamentos acima.

- [ ] **Step 9: Commit**

```bash
git add src/routes/_authenticated/expedicao.cq.\$modeloId.tsx
git commit -m "feat(colab): CQ — merge 3-vias (form + grade recebida/defeito) + _rev_base {cq,fonte} + P0409"
```

---

## Task 7: Docs + verificação final

**Files:**
- Modify: `CLAUDE.md` (bloco "Colaboração em tempo real")
- Modify: `docs/mapeamento-campos-calculos.md`, `docs/plano-de-ataque.md` (gitignored, locais)
- Modify: memória `project_colab_concorrencia` (via papel `docs-keeper`)

- [ ] **Step 1: Suíte completa**

Run: `npm test` (unit + integração) e `npm run build && npx tsc --noEmit 2>&1 | grep TS2304 || echo OK`
Expected: verde (incl. `colab-merge-grade`, `colab-trava` estendido, `colab-rev`). `OK` no tsc.

- [ ] **Step 2: Re-conferir ACL + publication (segurança/infra)**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -tAc "select has_function_privilege('anon','public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)','EXECUTE'), has_function_privilege('authenticated','public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)','EXECUTE')"
psql "$(cat /tmp/dburl.txt)" -tAc "select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename in ('producao_terceirizados','controle_qualidade') order by 1"
```
Expected: `false,false` no `_salvar_cq_core`; as 2 tabelas na publicação.

- [ ] **Step 3: Atualizar `CLAUDE.md`**

No bloco "Colaboração em tempo real (rev otimista)", acrescentar PCP Serviços + CQ à lista de telas adotadas, com as especificidades: `rev` por BLOCO em `producao_terceirizados` (cobre PCP + o `grade_detalhe` compartilhado do bloco-fonte) e `rev` por cad em `controle_qualidade`; `salvar_terceirizados` checa `_rev_base {bloco_id:rev}` por bloco (sem `_core` — worker+gate num só DEFINER); `salvar_cq` checa `{cq, fonte}` dos dois lados; peça nova `src/lib/colab/merge-grade.ts` (`mergeGrade`); `useColabRegistro` estendido (2 tabelas novas + `filtroColuna: "cad_id"` + `tabelasExtra`).

- [ ] **Step 4: Atualizar docs locais + memória**

Registrar em `docs/mapeamento-campos-calculos.md` (fluxo CQ/PCP e o `grade_detalhe` compartilhado agora com trava rev por bloco) e `docs/plano-de-ataque.md` (fecha a frente colab para PCP+CQ). Atualizar a memória `project_colab_concorrencia` (novo item: PCP Serviços + CQ com rev por-bloco/por-cad + mergeGrade + trava dos 2 lados).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/mapeamento-campos-calculos.md docs/plano-de-ataque.md
git commit -m "docs(colab): PCP Serviços + CQ adotam colab (rev por bloco/cad + mergeGrade)"
```

---

## Self-Review (rodado contra a spec)

**1. Cobertura da spec:**
- §1 (onde ficam os rev) → T1 (colunas + triggers + bump de `cq_variantes` + publication). ✔
- §2 (saves com `_rev_base`) → T2 (`salvar_terceirizados` por bloco) + T3 (`salvar_cq` dos 2 lados); trava tenant-uniforme com bypass super_admin (filtro `tenant_id = get_user_tenant_id() OR is_super_admin()`), `_rev_base` null = bypass, ERRCODE P0409, guardas #6/[C1]/gate preservadas verbatim, `_core` REVOKE. ✔
- §3 (merge 3-vias nas 2 telas) → T4 (`mergeGrade`) + T5 (PCP) + T6 (CQ); `useColabRegistro`+`ColabBanner`, reuso `mergeDraft`/`mergeLinhas`, refs-espelho + retry P0409, `ROTULO_CONFLITO` escalares + `grade:*`. ✔
- §4 (overlap) → coberto pelos QA de T5-Step9 e T6-Step8 (áreas distintas sem conflito; mesma célula = conflito; cross-tela fonte bumpa). ✔
- §5 (escopo/retrocompat/segurança) → `_rev_base` null bypassa (T2/T3), modelo sem fonte só trava o cq (T3 teste), REVOKE do core, presença fora de RLS (payload inofensivo, já documentado no hook). ✔
- Testes (integração + unit + QA) → T1/T2/T3 (integração `colab-trava`), T4 (unit `colab-merge-grade`), T5/T6 (QA 2-contexts + cross-tela). ✔

**2. Placeholder scan:** sem "TBD/TODO/similar a Task N"; todo step de código traz o código real (migrações completas verbatim + rev-check; `mergeGrade` completo; blocos de front reais). As "Notas de wiring" nomeiam os pontos exatos de troca (`setBlocos`→`setBlocosTracked`, `setForm`→`setFormTracked`, handlers de célula) — são instruções concretas, não placeholders.

**3. Consistência de tipos/nomes:**
- `mergeGrade({base, meu, fresh, tocadas})` → mesma assinatura em T4 (def), T5 e T6 (uso). ✔
- Path de conflito `grade:{vid}:{tam}:{campo}` idêntico em `mergeGrade`, `rotuloConflito`, `resolverPorPath` e nos `touchedGradeRef.add(...)`. ✔
- `_rev_base` = `{bloco_id: rev}` (T2/T5) e `{cq, fonte}` (T3/T6) — consistente RPC↔front. ✔
- `useColabRegistro` estendido (`filtroColuna`, `tabelasExtra`, tipos `ColabTabela`/`ColabListener`) definido em T5-Step1, consumido em T5-Step6 e T6-Step3. ✔
- Nomes de função SQL e assinaturas com args batem com os `DROP FUNCTION`/`GRANT`/`REVOKE` (T2: `(uuid,jsonb,text,jsonb)`; T3: `(uuid,jsonb,jsonb,jsonb,boolean,jsonb)`). ✔

**Achados de código que DIVERGIRAM da spec (ajustados no plano):**
1. **`salvar_terceirizados` NÃO tem `_core`** — é um único `SECURITY DEFINER` com o gate inline. A spec/tarefa falava em "`_core` REVOKE dos três"; na prática só `_salvar_cq_core` existe. Decisão: o rev-check por bloco vai DENTRO de `salvar_terceirizados` (após o advisory lock), e a função segue com `GRANT … TO authenticated` (sem `_core` a revogar). (T2)
2. **Front do PCP guarda os blocos como ARRAY de estado `Bloco[]`** (`id?`, `_key`, `grade_detalhe`), hidratado one-shot (`hydrated`). O `_rev_base` por bloco é montado de um `revByBlocoRef` (id→rev) semeado do `existing` (que já traz `rev` via `select("*")`). O merge combina `mergeLinhas` (escalares por bloco, granularidade de linha) + `mergeGrade` (células). (T5)
3. **O CQ JÁ refetch pós-save** (Task 4 da Grade Cortada: `refetchCq`+`refetchVars`+invalida `cq-blocos-fonte`+`setHydrated(false)`). O plano troca o re-seed one-shot por merge-no-refetch e remove o `setHydrated(false)` (que apagaria o merge). `blocosFonte` tem SELECT explícito → adicionar `rev`; `cqRow` usa `select("*")` (rev de graça). (T6)
4. **`useColabRegistro` só aceitava 3 tabelas e filtro por `id`** — PCP/CQ têm N linhas por cad, sem raiz única. Estendido para aceitar `producao_terceirizados`/`controle_qualidade`, `filtroColuna: "cad_id"` e `tabelasExtra` (o CQ escuta o bloco-fonte além do próprio CQ). (T5-Step1)
5. **Sem "trava tenant-uniforme" via GUC** — o termo na spec = o `_rev_base`-check com filtro `tenant_id = get_user_tenant_id() OR is_super_admin()` (mesmo idiom das migrações `20260803190000/200000`), não uma trava separada.
