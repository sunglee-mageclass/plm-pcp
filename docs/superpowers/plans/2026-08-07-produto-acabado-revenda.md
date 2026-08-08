# Produto Acabado (Revenda) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fluxo de revenda — planejador Produto Acabado + OC P. Acabado + card revenda no Plan. Produto, com recebimento fluindo pelo caminho único CQ→Direcionamento→Lançar e módulo opt-in por loja.

**Architecture:** Entidade separada (`produtos_acabados` + variantes) ligada 1:1 a um modelo espelho (`modelos.origem='revenda'`, coluna JÁ existente). A OC (`ocs_p_acabado`) guarda a grade destrinchada em jsonb; "Marcar Recebido" materializa `cad` + `cad_grades` + `controle_qualidade` atomicamente (SEM linhas fake de `cad_tecidos`) — CQ/Direcionamento/Lançar funcionam sem fork. Grade cor×tamanho do card revenda REUSA `modelo_grades` (chaveada por `variante_numero` = ordem da variante do produto). Parcelas reusam a tabela `parcelas` com `tipo_oc='p_acabado'`.

**Tech Stack:** Postgres/Supabase (migrations via `psql "$(cat /tmp/dburl.txt)" -f`), RPCs SECURITY DEFINER wrapper+`_core`, React+TanStack Router/Query, Tailwind/Radix, Vitest (unit + integração transacional).

**Spec:** `docs/superpowers/specs/2026-08-07-produto-acabado-revenda-design.md` (ler antes de cada task).

## Global Constraints

- Branch ativa `feature/plan-tecido-a1` — NUNCA push na main. Antes de cada commit: `npm run build` E `npx tsc --noEmit` (vite NÃO roda tsc).
- Migration: aplicar com `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/<arq>.sql`; idempotente (`IF NOT EXISTS`); destrutiva = `BEGIN;…COMMIT;`. Ao alterar função existente, diff-validar `pg_get_functiondef` antes/depois.
- **REVOKE dos TRÊS** em todo `_core`: `REVOKE EXECUTE ON FUNCTION public._x_core(...) FROM PUBLIC, anon, authenticated;` (invariante #9). Wrappers de escrita: `REVOKE ... FROM PUBLIC, anon;`.
- Erros de negócio: `RAISE EXCEPTION ... USING ERRCODE='P0001'` com mensagem PT (23514 é engolido pelo erro-mensagem.ts).
- NUNCA `UNIQUE`/FK-unique em coluna única embedada (PostgREST vira to-one) — usar TRIGGER `enforce_unique_fk` (padrão `20260619430000...sql:50-52`).
- UI segue `docs/design/ui-padroes.md` **§K–§P** (InfoStrip/⧉ p/ dado de outra tela; ações de ciclo na tela, Excluir preenchido; canvas colapsável+acordeão c/ resumo inline; grade com TODAS as size-keys, 0 placeholder; variante "cor base · apelido" via `src/lib/variante.ts`; bloco de compra empilhado 1 campo/linha rótulo ~150px; form padrão OC: Sheet 70vw + Dialog mesmo form + âncoras + anexos chip + abas por status). Datas = `<DateField>`; dinheiro = `<MoneyInput>` onde digitável; confirmação destrutiva = AlertDialog; `mensagemErro(e, fallback)` nos catches.
- **Gatilho de acessório = GRUPO** (nome normalizado contém `acessor`): grade única (sem tamanhos), REF = 2 letras grupo + 3 letras categoria, nº OC = 3 fornecedor + literal `ACE`.
- REF revenda: **7 dígitos** começando `0000001`, contador por loja com advisory lock próprio (`modelo_ref_rev:<tenant>`), gerada NA CRIAÇÃO do produto (não espera Dev).
- Distribuição por peso: **maior resto** — Σ células ≡ total, re-derivado/validado no servidor.
- Módulo `produto_acabado` **opt-in default OFF** nos DOIS pontos (`useTenantModules.DEFAULTS` + `admin/lojas MODULE_DEFAULTS`); RPCs gated `tenant_module_enabled('produto_acabado')`.
- Commits terminam com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Descobertas do código real (verificadas)

- `modelos.origem text NOT NULL DEFAULT 'interno' CHECK in ('interno','revenda')` **JÁ EXISTE** (`20260702180000_modelo_origem.sql`); `modelos.preco_venda numeric` existe; **`preco_atacado` NÃO existe** (criar). `ref VARCHAR(100)`, `ref_auto text`, `lancado bool`.
- `modelo_grades`: `(modelo_id, variante_numero int NOT NULL, grades jsonb NOT NULL, grade_total int)` — serve à revenda com `variante_numero` = `ordem` da variante do produto.
- `cad`: só `id` NOT NULL; `cad_grades (cad_id, variante_numero int NOT NULL, grades_planejadas jsonb NOT NULL, grades_reais jsonb, grade_total_planejada, grade_total_real)`; `controle_qualidade.status default 'pendente'`; **NÃO criar** `cad_tecidos`/`cad_tecido_variantes` fake — labels de variante p/ revenda vêm do produto (Task 6).
- Parcelas: tabela `parcelas` com `tipo_oc varchar NOT NULL` + FKs por tipo (`oc_tecido_id`, `oc_aviamento_id`) — adicionar `oc_p_acabado_id`. Gerador de referência: `gerar_parcelas_oc_aviamento_trg` (`20260611163853:150`, N parcelas `+i*30`, `status='a_pagar'`); recálculo `trg_recalc_parcelas_aviamento` só com `status='recebido'` (`20260717110000:52`). `recalcular_parcelas(_oc_id uuid, _tipo text)` (`20260619440000:11`).
- Códigos: `fn_aviamento_codigo` = MAX+1 por regex `^SIGLA-[0-9]+$` por tenant (`20260718150000:24-39`); `fn_modelo_ref_auto`/`_modelo_ref_next_num` = advisory lock `hashtext('modelo_ref:'||tenant)` + MAX por regex em `ref_auto` E `ref` (`20260736100000:73-79`).
- `custo_unitario_modelos(_ids uuid[]) RETURNS jsonb` → `{"<id>":{previsto,real,confirmado}}` (`20260702140000:7`); hoje é wrapper `_pode_ver_custos()` + `_custo_unitario_modelos_core` (`20260737100000`). Ramificar revenda NO CORE.
- Catálogos: `grupos_produto/categorias_produto/subcategorias1_produto/subcategorias2_produto` (`nome varchar`); `cores(id,nome)`, `cores_apelido(id,nome,cor_base_id)`.
- UI: `src/lib/permissions-catalog.ts` (`PageDef{key,label,...}`, `ModuleDef{module,label,basePath,pages,gate?}`, `PAGES_CATALOG`, `ALL_PAGE_KEYS`); `src/lib/nav.ts` (`PAGE_URLS`, `PAGE_ICONS`, `MODULE_META`); `useTenantModules.DEFAULTS` (`src/hooks/useTenantModules.ts:19`, `otb:false` l.26, fallback `?? true` l.66); `admin/lojas.tsx MODULE_DEFAULTS` (l.50).
- Plan. Tecido (referência §M): `src/components/plan-tecido/{PlanTecidoSheet,ResumoPanel,ModelCard}.tsx`, rota `criacao.plan-tecido.tsx`. OC (referência §O): `src/components/shared/OcModalShell.tsx` (Sheet `w-[70vw]` / Dialog `max-w-4xl`), `OcAnchorRail` é INTERNO a `entrada-saida.oc-tecido.tsx:593-622` (extrair), `src/components/oc-tecido/FileField.tsx`.
- Testes integração: `tests/integration/db.ts` → `hasDb, withTx, comoUsuario, um, TENANT_TESTE`; padrão `describe.skipIf(!hasDb)` + `withTx(async (c) => {...})` (tudo revertido).
- Última migration: `20260807130000_...` → estas começam em **`20260807140000_`**.

### DECISÕES DE ARQUITETURA (fixadas — não rediscutir no task)

1. **Grade da OC** em `ocs_p_acabado.grade_detalhe jsonb` = `{"<ordem>": {"<tamanho>": {"pedida":n,"recebida":n,"defeito":n}}}`; **grupo Acessórios** usa a size-key literal `"UN"` (grade única). Size-keys = as da grade de proporção do produto com peso>0.
2. **Espelho de produção no receber**: upsert `cad` (por `modelo_id`, trigger 1-CAD já garante) + `cad_grades` por variante (`grades_planejadas`=pedida, `grades_reais`=max(0,recebida−defeito), totais derivados) + `controle_qualidade` (status 'pendente') — TUDO numa txn na RPC `receber_oc_p_acabado`. Nada de `cad_tecidos` fake.
3. **Identidade**: produto nasce com `nome/grupo_id/categoria_id/subcategoria1_id/subcategoria2_id` próprios + `ref` gerada por trigger. `criar_card_produto_acabado` cria o modelo espelho herdando tudo (inclusive `ref` → `modelos.ref` DIRETO — revenda não passa pelo fluxo aprovar/ref_auto) e daí o MODELO é o dono (produto espelha via join).
4. **Acessório**: helper SQL `_grupo_eh_acessorio(_grupo_id uuid)` = `nome` do grupo normalizado (unaccent/lower) contém `'acessor'`; espelho TS `ehGrupoAcessorio(nome)` em `src/lib/produto-acabado.ts` (mesma normalização do `fornecedor-categoria.ts`).
5. **Vínculo OC**: `ocs_p_acabado.produto_acabado_id` nullable; **1 OC ativa por produto** = trigger `enforce_unique_fk('produto_acabado_id')` parcial? NÃO — `enforce_unique_fk` não é parcial; usar trigger próprio `enforce_oc_pa_vinculo_unico` (BEFORE INSERT/UPDATE OF produto_acabado_id: RAISE P0001 se já existe OUTRA OC do mesmo produto com `status <> 'cancelado'`… não há status cancelado no spec → regra: já existe outra OC vinculada → erro PT "Este produto já tem a OC X vinculada — desvincule antes").
6. **Parcelas**: `parcelas.oc_p_acabado_id` + `tipo_oc='p_acabado'`; `ocs_p_acabado.prazo_pagamento text` (ex. `"30/60/90"`); trigger AFTER INSERT/UPDATE gera 1 parcela por componente do prazo (`data_pedido + N dias`, valor = total_com_desconto ÷ n, `status='a_pagar'`) com a MESMA idempotência do gerador de aviamento (apaga não-pagas e regera preservando pagas via `_recalcular_parcelas_core` OU delete/insert de não-pagas — seguir o que o gerador de aviamento faz, verificado no arquivo).
7. **Estoque (aba)**: RPC leitura `estoque_p_acabado()` — por produto×variante: `real` (Σ `cad_grades.grades_reais` do cad do modelo espelho) − `direcionado` (Σ `direcionamento_lojas.grades`) = `em_maos`. Gate `tenant_module_enabled('produto_acabado')`.
8. **Gate por página**: adicionar `gate?: string` em `PageDef` (mesmo conceito do `ModuleDef.gate`); sidebar/hub escondem página cujo `gate` está off. As 2 páginas novas: `gate:'produto_acabado'`.

## File Structure

**Banco (criar):** `supabase/migrations/20260807140000_produto_acabado_tabelas.sql` (tabelas+RLS+códigos+módulo) · `...150000_produto_acabado_rpcs.sql` (salvar/criar card/aplicar/vincular) · `...160000_oc_p_acabado_receber_parcelas.sql` (receber + parcelas + estoque RPC) · `...170000_custo_preco_revenda.sql` (preco_atacado + ramo custo).
**Front (criar):** `src/lib/produto-acabado.ts` (helpers puros: maior resto, códigos preview, acessório, cadeia de valores) · `src/components/produto-acabado/{ProdutoAcabadoSheet,ProdutoCard,ResumoRevendaPanel,NovoProdutoDialog}.tsx` · `src/components/oc-p-acabado/{OcPaForm,GradeDestrinchada}.tsx` · `src/components/shared/{InfoStrip,OcAnchorRail}.tsx` (extração) · rotas `src/routes/_authenticated/criacao.produto-acabado.tsx` e `entrada-saida.oc-p-acabado.tsx`.
**Front (modificar):** `permissions-catalog.ts`, `nav.ts`, `useTenantModules.ts`, `admin/lojas.tsx`, `admin/configuracoes` (toggle), `criacao.planejamento.tsx` (card revenda: preço atacado + grade + botão criar produto/⧉), `expedicao.cq.$modeloId.tsx` + `expedicao.direcionamento.*` (labels de variante revenda), `entrada-saida.oc-tecido.tsx` (usar OcAnchorRail extraído).
**Testes:** `tests/unit/produto-acabado.test.ts` · `tests/integration/produto-acabado.test.ts` · `tests/integration/oc-p-acabado.test.ts`.

---

### Task 1: Banco — tabelas, RLS, códigos automáticos e módulo

**Files:** Create `supabase/migrations/20260807140000_produto_acabado_tabelas.sql` · Test `tests/integration/produto-acabado.test.ts` (parte 1)

**Interfaces (Produces):** tabelas `produtos_acabados`, `produto_acabado_variantes`, `ocs_p_acabado`; helpers `_grupo_eh_acessorio(uuid)→bool`, `_produto_acabado_ref_next(uuid)→bigint`, `_norm3(text)→text`; triggers de código; módulo `produto_acabado` reconhecido por `tenant_module_enabled`.

- [ ] **Step 1: escrever a migration** (idempotente; colar e ajustar):

```sql
-- Tabelas ------------------------------------------------------------
create table if not exists public.produtos_acabados (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  modelo_id uuid references public.modelos(id) on delete set null, -- espelho (1:1 via trigger)
  nome varchar(200) not null,
  ref text,                          -- gerada por trigger na criação
  grupo_id uuid references public.grupos_produto(id),
  categoria_id uuid references public.categorias_produto(id),
  subcategoria1_id uuid references public.subcategorias1_produto(id),
  subcategoria2_id uuid references public.subcategorias2_produto(id),
  colecao_id uuid references public.colecoes(id),
  subcolecao text,
  semana varchar(50),
  empresa_id uuid references public.empresas(id),
  representante_id uuid references public.representantes(id),
  ref_fornecedor varchar(120),
  composicao text,
  grade_proporcao jsonb not null default '{}'::jsonb, -- {"38":1,"40":1,...} peso por size-key; acessório = {}
  qtd_total integer not null default 0,
  valor_unitario numeric(12,2) not null default 0,
  desconto_pct numeric(6,2) not null default 0,
  insumos_total numeric(12,2) not null default 0,     -- Σ BOM (derivado, cache p/ card)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.produto_acabado_variantes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  produto_acabado_id uuid not null references public.produtos_acabados(id) on delete cascade,
  ordem integer not null,
  cor_id uuid references public.cores(id),
  cor_apelido_id uuid references public.cores_apelido(id),
  peso numeric(8,2) not null default 0,
  qtd integer not null default 0,
  unique (produto_acabado_id, ordem)
);
create table if not exists public.ocs_p_acabado (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  produto_acabado_id uuid references public.produtos_acabados(id) on delete set null,
  numero text,                       -- AUTO por trigger
  nome_produto varchar(200) not null,
  grupo_id uuid references public.grupos_produto(id),
  categoria_id uuid references public.categorias_produto(id),
  subcategoria1_id uuid references public.subcategorias1_produto(id),
  subcategoria2_id uuid references public.subcategorias2_produto(id),
  empresa_id uuid references public.empresas(id),
  representante_id uuid references public.representantes(id),
  ref_fornecedor varchar(120),
  composicao text,
  data_pedido date not null default current_date,
  data_prevista date,
  data_entrega date,
  prazo_pagamento text not null default '30',   -- "30/60/90"
  parcelas_entrega integer not null default 1,
  grade_proporcao jsonb not null default '{}'::jsonb,
  grade_detalhe jsonb not null default '{}'::jsonb, -- {"<ordem>":{"<tam>":{"pedida":n,"recebida":n,"defeito":n}}}
  variantes jsonb not null default '[]'::jsonb,     -- [{ordem,cor_id,cor_apelido_id,peso,qtd}] snapshot da OC
  qtd_total integer not null default 0,
  valor_unitario numeric(12,2) not null default 0,
  desconto_pct numeric(6,2) not null default 0,
  valor_bruto numeric(14,2) not null default 0,       -- derivados no servidor
  valor_total_desconto numeric(14,2) not null default 0,
  valor_unitario_real numeric(12,2) not null default 0,
  nota_fiscal varchar(120),
  responsavel_recebimento_id uuid references public.colaboradores(id),
  devolucao text,
  revisao text,
  status text not null default 'encomendado' check (status in ('encomendado','recebido')),
  anexo_pedido_url text,
  anexo_nf_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- RLS padrão por tenant (espelhar política de ocs_tecido: select/insert/update/delete com tenant_id = get_user_tenant_id())
alter table public.produtos_acabados enable row level security;
alter table public.produto_acabado_variantes enable row level security;
alter table public.ocs_p_acabado enable row level security;
-- (criar as 4 policies por tabela no padrão das tabelas vizinhas; conferir uma policy de ocs_tecido com \d+ e replicar)

-- 1:1 produto→modelo (NUNCA UNIQUE em coluna embedada)
drop trigger if exists trg_pa_unique_modelo on public.produtos_acabados;
create trigger trg_pa_unique_modelo
  before insert or update of modelo_id on public.produtos_acabados
  for each row execute function public.enforce_unique_fk('modelo_id');
create index if not exists idx_pa_modelo on public.produtos_acabados(modelo_id);
create index if not exists idx_ocpa_produto on public.ocs_p_acabado(produto_acabado_id);

-- Helpers de código ---------------------------------------------------
create or replace function public._grupo_eh_acessorio(_grupo_id uuid) returns boolean
language sql stable as $$
  select coalesce((select lower(translate(nome,'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç','AAAAEEIOOOUCaaaaeeiooouc')) like '%acessor%'
                   from public.grupos_produto where id = _grupo_id), false);
$$;
create or replace function public._norm3(_s text) returns text
language sql immutable as $$
  select upper(substr(regexp_replace(translate(coalesce(_s,''),'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç','AAAAEEIOOOUCaaaaeeiooouc'),'[^A-Za-z]','','g'),1,3));
$$;
-- REF do produto: sigla + 7 dígitos por tenant (advisory lock próprio)
create or replace function public._produto_acabado_ref_next(_tenant uuid) returns bigint
language plpgsql as $$
declare v bigint;
begin
  perform pg_advisory_xact_lock(hashtext('modelo_ref_rev:'||_tenant::text));
  select coalesce(max((substring(ref from '([0-9]{7})$'))::bigint),0)+1 into v
    from public.produtos_acabados where tenant_id=_tenant and ref ~ '[0-9]{7}$';
  return v;
end $$;
create or replace function public.fn_produto_acabado_ref() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_sig text;
begin
  if new.ref is not null and new.ref <> '' then return new; end if;
  if public._grupo_eh_acessorio(new.grupo_id) then
    v_sig := public._norm3((select nome from grupos_produto where id=new.grupo_id));
    v_sig := substr(v_sig,1,2) || public._norm3((select nome from categorias_produto where id=new.categoria_id)); -- 2 grupo + 3 categoria
  else
    v_sig := substr(public._norm3((select nome from grupos_produto where id=new.grupo_id)),1,2)
          || substr(public._norm3((select nome from categorias_produto where id=new.categoria_id)),1,1)
          || substr(public._norm3((select nome from subcategorias1_produto where id=new.subcategoria1_id)),1,2);
  end if;
  new.ref := v_sig || lpad(public._produto_acabado_ref_next(new.tenant_id)::text, 7, '0');
  return new;
end $$;
drop trigger if exists trg_pa_ref on public.produtos_acabados;
create trigger trg_pa_ref before insert on public.produtos_acabados
  for each row execute function public.fn_produto_acabado_ref();

-- Nº da OC: 3 fornecedor + (1 grupo + 2 categoria | 'ACE') + '-' + 5 díg por sigla (padrão fn_aviamento_codigo, MAX+1 regex)
create or replace function public.fn_oc_p_acabado_numero() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_sig text; v_num bigint;
begin
  if new.numero is not null and new.numero <> '' then return new; end if;
  v_sig := public._norm3((select nome from empresas where id=new.empresa_id));
  if v_sig = '' then v_sig := 'FOR'; end if;
  if public._grupo_eh_acessorio(new.grupo_id) then v_sig := v_sig || 'ACE';
  else v_sig := v_sig || substr(public._norm3((select nome from grupos_produto where id=new.grupo_id)),1,1)
                      || substr(public._norm3((select nome from categorias_produto where id=new.categoria_id)),1,2);
  end if;
  select coalesce(max((substring(numero from '([0-9]+)$'))::bigint),0)+1 into v_num
    from public.ocs_p_acabado where tenant_id=new.tenant_id and numero ~ ('^'||v_sig||'-[0-9]+$');
  new.numero := v_sig || '-' || lpad(v_num::text,5,'0');
  return new;
end $$;
drop trigger if exists trg_ocpa_numero on public.ocs_p_acabado;
create trigger trg_ocpa_numero before insert on public.ocs_p_acabado
  for each row execute function public.fn_oc_p_acabado_numero();

-- Vínculo único (1 OC ativa por produto)
create or replace function public.enforce_oc_pa_vinculo_unico() returns trigger
language plpgsql as $$
declare v_num text;
begin
  if new.produto_acabado_id is null then return new; end if;
  select numero into v_num from public.ocs_p_acabado
   where produto_acabado_id = new.produto_acabado_id and id is distinct from new.id limit 1;
  if v_num is not null then
    raise exception 'Este produto já tem a OC % vinculada — desvincule antes.', v_num using errcode='P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_ocpa_vinculo_unico on public.ocs_p_acabado;
create trigger trg_ocpa_vinculo_unico before insert or update of produto_acabado_id on public.ocs_p_acabado
  for each row execute function public.enforce_oc_pa_vinculo_unico();

revoke execute on function public._grupo_eh_acessorio(uuid) from public, anon, authenticated;
revoke execute on function public._norm3(text) from public, anon, authenticated;
revoke execute on function public._produto_acabado_ref_next(uuid) from public, anon, authenticated;
```

- [ ] **Step 2:** conferir como `tenant_module_enabled` valida chave de módulo (grep na migration que o define). Se há CHECK/lista de módulos, incluir `produto_acabado`; se lê `tenant_config.modules` livre, nada a fazer no banco.
- [ ] **Step 3:** aplicar com `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260807140000_produto_acabado_tabelas.sql`; smoke: `\d public.produtos_acabados`.
- [ ] **Step 4: teste de integração (falha→passa)** — `tests/integration/produto-acabado.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

describe.skipIf(!hasDb)("Produto Acabado — códigos automáticos", () => {
  it("REF não-acessório = 2G+1C+2S + 7 díg; acessório = 2G+3CAT; nº OC usa ACE p/ grupo Acessórios", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Feminino') returning id`);
      const ga = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Acessórios') returning id`);
      const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Vestido') returning id`);
      const catB = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Bolsa') returning id`);
      const s1 = await um<any>(c, `insert into subcategorias1_produto (tenant_id, nome, categoria_id) values ('${TENANT_TESTE}','Estampado','${cat.id}') returning id`);
      const p1 = await um<any>(c, `insert into produtos_acabados (tenant_id, nome, grupo_id, categoria_id, subcategoria1_id)
        values ('${TENANT_TESTE}','Vestido X','${g.id}','${cat.id}','${s1.id}') returning ref`);
      expect(p1.ref).toMatch(/^FEVES\d{7}$/);
      const p2 = await um<any>(c, `insert into produtos_acabados (tenant_id, nome, grupo_id, categoria_id)
        values ('${TENANT_TESTE}','Bolsa Y','${ga.id}','${catB.id}') returning ref`);
      expect(p2.ref).toMatch(/^ACBOL\d{7}$/);
      const emp = await um<any>(c, `insert into empresas (tenant_id, nome, tipo) values ('${TENANT_TESTE}','Bella Couros','material') returning id`);
      const oc = await um<any>(c, `insert into ocs_p_acabado (tenant_id, nome_produto, grupo_id, categoria_id, empresa_id)
        values ('${TENANT_TESTE}','Bolsa Y','${ga.id}','${catB.id}','${emp.id}') returning numero`);
      expect(oc.numero).toMatch(/^BELACE-\d{5}$/);
    });
  });
  it("vínculo único: 2ª OC no mesmo produto dá P0001", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Fem2') returning id`);
      const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Calça') returning id`);
      const p = await um<any>(c, `insert into produtos_acabados (tenant_id, nome, grupo_id, categoria_id) values ('${TENANT_TESTE}','P','${g.id}','${cat.id}') returning id`);
      await c.query(`insert into ocs_p_acabado (tenant_id, nome_produto, produto_acabado_id) values ('${TENANT_TESTE}','P','${p.id}')`);
      await expect(c.query(`insert into ocs_p_acabado (tenant_id, nome_produto, produto_acabado_id) values ('${TENANT_TESTE}','P','${p.id}')`)).rejects.toThrow(/vinculada/);
    });
  });
});
```
Nota: ajustar colunas NOT NULL reais de `empresas` conforme schema (conferir com `\d empresas`); rodar `npx vitest run tests/integration/produto-acabado.test.ts`.
- [ ] **Step 5:** commit `feat(revenda): tabelas produtos_acabados/ocs_p_acabado + códigos automáticos e vínculo único`.

### Task 2: Banco — RPCs de escrita (salvar produto, criar card, aplicar, vincular, salvar OC)

**Files:** Create `supabase/migrations/20260807150000_produto_acabado_rpcs.sql` · Test append `tests/integration/produto-acabado.test.ts`

**Interfaces (Produces):**
- `salvar_produto_acabado(_id uuid, _dados jsonb, _variantes jsonb) returns uuid` — upsert; `_dados` = colunas escalares; `_variantes` = `[{ordem,cor_id,cor_apelido_id,peso,qtd}]`. Servidor RE-DERIVA: `qtd` das variantes se `_dados->>'redistribuir'='true'` (maior resto sobre `qtd_total × peso/Σpeso`), senão VALIDA `Σ qtd = qtd_total` (P0001 PT "A soma das variantes (X) difere da quantidade total (Y)"); `valor_bruto = qtd_total×valor_unitario`; `valor_total_desconto = bruto×(1−desconto_pct/100)`; `valor_unitario_real = total÷qtd_total` (0 se qtd 0); `insumos_total` = Σ `modelo_etiquetas.custo_previsto×consumo` do modelo espelho (0 sem espelho).
- `criar_card_produto_acabado(_produto_id uuid) returns uuid` — cria `modelos` espelho: `origem='revenda'`, nome/grupo/cat/subcats/colecao_id/subcolecao/semana herdados, `ref = produtos_acabados.ref`, vincula `produtos_acabados.modelo_id`; cria `modelo_grades` inicial por variante (`variante_numero=ordem`, split da qtd da cor pelos pesos de tamanho — maior resto; acessório: `{"UN": qtd}`); idempotente (já tem espelho → RAISE P0001 "Este produto já tem card no Planejamento").
- `aplicar_produto_ao_modelo(_produto_id uuid) returns void` — re-empurra nome/taxonomia? NÃO (modelo é dono) — re-empurra APENAS `modelo_grades` (recalcula split) do produto p/ o espelho. P0001 se sem espelho.
- `vincular_oc_p_acabado(_oc_id uuid, _produto_id uuid) returns void` (NULL desvincula) — atualiza `ocs_p_acabado.produto_acabado_id` (trigger de unicidade cobre).
- `salvar_oc_p_acabado(_id uuid, _dados jsonb, _grade jsonb) returns uuid` — upsert; deriva valores como acima; valida células ≥0 e, se `qtd_total>0`, `Σ pedida = qtd_total` (P0001).
- Maior resto SQL: `_split_maior_resto(_total int, _pesos jsonb) returns jsonb` — pesos `{"k":peso}` → `{"k":qtd}` com Σ=_total (ordena por resto desc, desempate por chave).

Todos: wrapper com gate `tenant_module_enabled('produto_acabado')` (+ `user_can_edit` da página respectiva quando aplicável) → `_core` com REVOKE dos três; wrappers `REVOKE FROM PUBLIC, anon`.

- [ ] **Step 1:** escrever `_split_maior_resto` + teste SQL rápido (`select _split_maior_resto(100,'{"38":1,"40":1,"42":1}')` → soma 100; ex. `{"38":34,"40":33,"42":33}`).
- [ ] **Step 2:** escrever as RPCs (padrão wrapper+_core de `salvar_terceirizados` — copiar esqueleto de gate/tenant da migration `20260807110000`), aplicar com psql, diff-validar funções novas com `pg_get_functiondef`.
- [ ] **Step 3: testes transacionais** (append): criar produto → `criar_card_produto_acabado` → modelo espelho existe com origem revenda, ref copiada, `modelo_grades` com Σ = qtd da cor; `salvar_produto_acabado` com Σ variantes ≠ total rejeita (P0001); redistribuir=true rebate 100 em 3 cores peso 3:1:1 → 60/20/20; `salvar_oc_p_acabado` deriva 19.602→15.681,60→79,20 (usar os números canônicos 198×99−20%); vincular 2ª OC falha.
- [ ] **Step 4:** `npx vitest run tests/integration/produto-acabado.test.ts` verde; commit `feat(revenda): RPCs salvar/criar card/aplicar/vincular + maior resto`.

### Task 3: Banco — receber OC (espelho de produção), parcelas e aba Estoque

**Files:** Create `supabase/migrations/20260807160000_oc_p_acabado_receber_parcelas.sql` · Test `tests/integration/oc-p-acabado.test.ts`

**Interfaces (Produces):**
- `receber_oc_p_acabado(_oc_id uuid, _dados jsonb, _grade jsonb) returns jsonb` — ATÔMICO: grava recebimento (`data_entrega, nota_fiscal, responsavel_recebimento_id, devolucao, revisao`, grade_detalhe com recebida/defeito), `status='recebido'`; upsert `cad` do modelo espelho (INSERT `cad (tenant_id, modelo_id)` se não existe — trigger 1-CAD garante); upsert `cad_grades` por variante: `variante_numero=ordem`, `grades_planejadas` = pedida por tamanho, `grades_reais` = `max(0, recebida−defeito)` por tamanho, totais = Σ; upsert `controle_qualidade (cad_id, status)` mantendo `'pendente'` se não existe (NÃO tocar se já confirmado — nesse caso REGRAVA grades_reais e o trigger de rebaixa do Direcionamento existente cuida do resto). Exige OC vinculada a produto COM modelo espelho (P0001 PT "Crie o card no Planejamento antes de receber — o recebimento alimenta CQ e Direcionamento"). Retorna `{cad_id, total_real}`.
- Parcelas: `alter table parcelas add column if not exists oc_p_acabado_id uuid references ocs_p_acabado(id) on delete cascade;` conferir CHECK de `tipo_oc` (se existir, estender com `'p_acabado'`); trigger `trg_gerar_parcelas_ocpa AFTER INSERT OR UPDATE OF valor_total_desconto, prazo_pagamento, data_pedido ON ocs_p_acabado` → apaga parcelas `tipo_oc='p_acabado'` não-pagas da OC e insere 1 por componente do prazo (`string_to_array(prazo_pagamento,'/')`), `data_vencimento = data_pedido + N`, `valor = round(total/n,2)` com último = resto (paridade com o gerador de aviamento `20260611163853:135-142` — LER antes e espelhar a idempotência dele).
- `estoque_p_acabado() returns jsonb` — leitura: por produto (com espelho+cad): variante → `{real, direcionado, em_maos}` (real = Σ grades_reais; direcionado = Σ direcionamento_lojas.grades por variante_numero). Wrapper gate módulo; `_core` REVOKE.

- [ ] **Step 1:** ler o gerador de parcelas do aviamento (arquivo `20260611163853`, l.120-160) e o CHECK de `tipo_oc` (`\d parcelas`); escrever a migration completa.
- [ ] **Step 2:** aplicar; smoke: inserir OC de teste via psql com prazo `30/60/90` e total 15.681,60 → 3 parcelas 5.227,20 (a última absorve arredondamento).
- [ ] **Step 3: testes transacionais** `oc-p-acabado.test.ts`: (a) receber sem card → P0001 com "Crie o card"; (b) fluxo completo: produto→card→OC vinculada (grade 2 cores × 2 tamanhos)→receber → `cad_grades.grades_reais` = recebida−defeito por célula e `grade_total_real` correto; `controle_qualidade.status='pendente'`; (c) parcelas: 3 parcelas a_pagar somando o total; editar desconto regera não-pagas; (d) `estoque_p_acabado` retorna em_maos = real − direcionado após inserir uma linha em `direcionamento_lojas`; (e) módulo OFF (`tenant_config.modules.produto_acabado=false`) → wrapper RAISE.
- [ ] **Step 4:** vitest verde; commit `feat(revenda): receber OC materializa cad+grades+CQ; parcelas por prazo; estoque`.

### Task 4: Banco+lib — preço atacado, custo revenda e helpers TS puros

**Files:** Create `supabase/migrations/20260807170000_custo_preco_revenda.sql`, `src/lib/produto-acabado.ts` · Modify `src/lib/preco.ts` (NADA de mudança de fórmula — só ler) · Test `tests/unit/produto-acabado.test.ts`

**Interfaces (Produces):**
- `modelos.preco_atacado numeric` (coluna nova; RLS já cobre).
- `_custo_unitario_modelos_core` ramo revenda: p/ modelo `origem='revenda'`: `previsto = pa.valor_unitario×(1−desconto)+insumos_por_peça`, `real = oc.valor_unitario_real + insumos_por_peça` (OC vinculada recebida; senão null), `confirmado = (oc.status='recebido')` — insumos_por_peça = Σ modelo_etiquetas (consumo×custo_previsto). **Diff-validar** a função (só ADICIONA o ramo; caminho interno intacto byte-a-byte fora dele). Re-aplicar REVOKE do `_core` (DROP+CREATE reseta ACL).
- `src/lib/produto-acabado.ts` (puro, testado):
```ts
export function splitMaiorResto(total: number, pesos: Record<string, number>): Record<string, number>
export function ehGrupoAcessorio(nomeGrupo: string | null | undefined): boolean   // normaliza sem acento/lower, contém 'acessor'
export function cadeiaValores(qtd: number, valorUnit: number, descontoPct: number): { bruto: number; totalDesc: number; unitReal: number }
export function previewRefProduto(grupo: string, categoria: string, sub1: string | null, acessorio: boolean): string  // só a SIGLA (número é do banco)
export function previewNumeroOc(fornecedor: string, grupo: string, categoria: string, acessorio: boolean): string
```
- [ ] **Step 1: testes unit primeiro** (`tests/unit/produto-acabado.test.ts`): splitMaiorResto(198,{P:3,B:2,A:1})→{99,66,33}; (100,{a:1,b:1,c:1}) soma 100; cadeiaValores(198,99,20) → 19602/15681.6/79.2; ehGrupoAcessorio('Acessórios')=true/'Feminino'=false; previews `FEVES`, `ACBOL`, `AVEFVE`, `BELACE`. Rodar → falha.
- [ ] **Step 2:** implementar lib; `npx vitest run tests/unit/produto-acabado.test.ts` verde.
- [ ] **Step 3:** migration (coluna + ramo custo + REVOKE re-aplicado); aplicar; teste transacional rápido no arquivo de integração: modelo revenda com OC recebida → `custo_unitario_modelos` traz real = 79,20+insumos.
- [ ] **Step 4:** `npx tsc --noEmit` + build; commit `feat(revenda): preco_atacado + custo revenda + helpers puros`.

### Task 5: Front — módulo, permissões, nav e telas-esqueleto + OC P. Acabado completa

**Files:** Modify `src/lib/permissions-catalog.ts`, `src/lib/nav.ts`, `src/hooks/useTenantModules.ts`, `src/routes/_authenticated/admin/lojas.tsx`, tela de Config da Loja (toggle), `entrada-saida.oc-tecido.tsx` (extração) · Create `src/components/shared/OcAnchorRail.tsx`, `src/components/shared/InfoStrip.tsx`, `src/components/oc-p-acabado/*`, rota `entrada-saida.oc-p-acabado.tsx`

**Interfaces:** Consumes RPCs Tasks 2-3. Produces: `InfoStrip({itens:[{label,valor,hi?}]})`, `OcAnchorRail({secoes:[{id,label,locked?}]})` reutilizáveis.

- [ ] **Step 1: módulo + catálogo.** `useTenantModules`: adicionar `produto_acabado: false, // opt-in` no DEFAULTS (l.19+); `admin/lojas.tsx MODULE_DEFAULTS` idem (l.50+); toggle na tela de Config da Loja (espelhar o do OTB). `permissions-catalog.ts`: `gate?: string` no `PageDef`; páginas `{ key:'criacao_produto_acabado', label:'Produto Acabado', gate:'produto_acabado' }` (módulo criacao, entre plan-tecido e planejamento) e `{ key:'entrada_oc_p_acabado', label:'OC P. Acabado', gate:'produto_acabado' }` (entrada_saida, após alertas-tecido). Sidebar/hub: onde `ModuleDef.gate` é consumido, aplicar também `PageDef.gate` (grep pelo consumo de `.gate`).
- [ ] **Step 2:** `nav.ts`: `PAGE_URLS` + `PAGE_ICONS` das 2 páginas (`/criacao/produto-acabado`, `/entrada-saida/oc-p-acabado`; ícones `Package`/`ShoppingCart` na ordem certa da sidebar).
- [ ] **Step 3: extrair `OcAnchorRail`** de `entrada-saida.oc-tecido.tsx:593-622` p/ `src/components/shared/OcAnchorRail.tsx` (mesma API; a OC Tecido importa do novo caminho); criar `InfoStrip` (§K: flex-wrap, pares label/valor, `tabular-nums`, variante `hi`). `npx tsc --noEmit` + smoke da OC Tecido (dev server, abrir uma OC).
- [ ] **Step 4: rota OC P. Acabado** (`entrada-saida.oc-p-acabado.tsx`): lista com abas **Encomendadas · Recebidas · Estoque** (Estoque via `estoque_p_acabado()`); `OcModalShell` (editar=Sheet 70vw, novo=Dialog MESMO form); `OcPaForm` com seções contínuas "1 · Dados do pedido" (campos do spec §3.1 + InfoStrip do produto vinculado/aviso avulsa), "2 · Grade, variantes & valores" (proporção com TODAS as size-keys 0-placeholder; grupo Acessórios esconde a linha; `GradeDestrinchada` cor×tamanho auto `splitMaiorResto` + células editáveis; bloco de valores EMPILHADO 1/linha rótulo 150px; InfoStrip bruto/total/unit real), "3 · Anexos" (`FileField` chips pedido+NF), "4 · Recebimento" (locked até salvo; DateField entrega, NF, Responsável pelo recebimento (colaboradores), devolução, revisão, grades Recebida/Defeito destrinchadas) — âncoras via `OcAnchorRail`. Rodapé: Voltar · Excluir (destructive filled, AlertDialog) · **Marcar Recebido** (`receber_oc_p_acabado`, AlertDialog de confirmação) · Salvar (`salvar_oc_p_acabado`). Guarda dirty (`useUnsavedGuard`+`UnsavedIndicator`); rótulos de variante via `variante.ts`-style "cor base · apelido"; erros `mensagemErro`.
- [ ] **Step 5:** QA visual (dev :5174, Playwright do repo — screenshot claro+escuro, desktop+mobile) contra o mockup (artifact a6204a84) e §K–§P; `npx tsc --noEmit` + `npm run build`; commit `feat(revenda): módulo+nav+OC P. Acabado (lista com abas, Sheet 70vw, recebimento)`.

### Task 6: Front — planejador Produto Acabado

**Files:** Create `src/routes/_authenticated/criacao.produto-acabado.tsx`, `src/components/produto-acabado/{ProdutoAcabadoSheet,ProdutoCard,ResumoRevendaPanel,NovoProdutoDialog}.tsx`

**Interfaces:** Consumes `salvar_produto_acabado`, `criar_card_produto_acabado`, `aplicar_produto_ao_modelo`, `vincular_oc_p_acabado`, `InfoStrip`, helpers da lib. Segue a ESTRUTURA REAL do Plan. Tecido (`PlanTecidoSheet` como referência de navegação/visual — NÃO copiar arquivo inteiro; replicar padrões).

- [ ] **Step 1: rota-lista** = grid de cards de coleções (filtro por módulo ligado) → `ProdutoAcabadoSheet` full-screen com Breadcrumb sticky + `UnsavedIndicator`; view "subcoleções" (grid) → view canvas.
- [ ] **Step 2: canvas** — `ResumoRevendaPanel` (aside esquerdo colapsável): Poder de venda (Σ preco_venda×qtd dos espelhos, regra `preco.ts`), Custo previsto (Σ `valor_total_desconto`), Produtos·peças, OTB comprometido (qtd da subcoleção ÷ alvo `colecao_semanas`, barra), Tipos de itens por categoria. Lanes por CATEGORIA com header "N produtos · X pç"; cards colapsados default (chevron CSS ▸/▾).
- [ ] **Step 3: `ProdutoCard`** aberto = header 2 linhas (nome; REF AUTO · fornecedor · Σpç; taxonomia › coleção · ⧉ Plan. Produto) + menu ⋯ (Criar card em Planejamento / Aplicar ao modelo / Excluir produto — AlertDialogs) + 3 setores acordeão: **1 Compra & variantes** (fstack 1 campo/linha: FornecedorSelect, REF forn., qtd total, valor unitário; grade proporção todas-as-size-keys — some p/ grupo Acessórios; tabela variantes cor·apelido peso→qtd com redistribuição `splitMaiorResto` ao editar total/peso e células editáveis; Desconto + InfoStrip derivados), **2 Preço** (colapsado com pill-resumo "Varejo R$ · Atacado R$ · base R$"; expandido = InfoStrip v.unit real/Σ insumos/base/markup linha — SOMENTE leitura, §K), **3 OC vinculada** (InfoStrip nº ⧉/status/pedida/recebida/unit real + Vincular OC existente (dialog de busca) + Fazer pedido → cria OC preenchida e navega).
- [ ] **Step 4:** rodapé da TELA: Subcoleções · Fazer pedido · Salvar (§L, padrão Plan. Tecido — sem Excluir de tela); `+ Novo produto` = `NovoProdutoDialog` (nome, grupo, categoria, subcats, fornecedor — REF nasce no INSERT); dirty-guard; queryKeys próprias (`["produtos-acabados", colecaoId]` etc.) e invalidação de `["otb-orcamento"]` ao criar card.
- [ ] **Step 5:** QA visual vs mockup (desktop+mobile, claro+escuro); tsc+build; commit `feat(revenda): planejador Produto Acabado (canvas, acordeão, OC vinculada)`.

### Task 7: Front — Plan. Produto (card revenda) + CQ/Direcionamento labels

**Files:** Modify `src/routes/_authenticated/criacao.planejamento.tsx`, `expedicao.cq.$modeloId.tsx`, tela(s) de Direcionamento (grep `direcionamento` route), `entrada-saida.explosao.index.tsx`/OC Insumo (verificação de escopo)

- [ ] **Step 1: card revenda no Planejamento** — quando `origem='revenda'` E módulo on: setor Preço ganha **Preço atacado** (input novo, grava `modelos.preco_atacado`) ao lado do Preço p/ venda (varejo), com markup real derivado dos DOIS exibido (preço ÷ base; base = custo previsto do `custo_unitario_modelos` que já traz insumos); seção **grade cor×tamanho** editável gravando `modelo_grades` (variante_numero=ordem; rótulos das variantes vêm do produto via embed `produtos_acabados!modelo_id → produto_acabado_variantes → cores/cores_apelido`); atalho ⧉ "Ver no Produto Acabado"; botão "criar produto acabado" quando origem=revenda sem produto vinculado (INSERT produto herdando identidade + vincula). Setores fabris (Tecido Planejado, Simulação, Mão de obra) ficam ocultos p/ revenda.
- [ ] **Step 2: labels de variante revenda** — CQ (`expedicao.cq.$modeloId.tsx`) e Direcionamento montam `labelByNumero` a partir de `cad_tecido_variantes`; adicionar fallback: se modelo `origem='revenda'`, buscar variantes do produto (1 query por cad/modelo, keyed `["pa-variantes", modeloId]`) e rotular "cor · apelido" por `ordem`. NÃO mexer no merge/colab do CQ — só a fonte do rótulo/variantList.
- [ ] **Step 3: Insumos/Explosão** — verificar o agregado que alimenta OC Insumo (necessidade por etiqueta): confirmar que modelos revenda (com `modelo_etiquetas`) entram no cálculo; se o agregado filtra por CAD/produção, incluir ramo p/ revenda (modelos lancáveis com BOM de insumos). Documentar no report o que foi encontrado + mudança mínima.
- [ ] **Step 4: teste manual do fluxo inteiro** (dev): produto → card → OC → receber → CQ abre com grade real e rótulos certos → confirmar CQ → Direcionamento distribui → Lançar habilita. tsc+build+`npx vitest run tests/unit`; commit `feat(revenda): card revenda no Planejamento + labels CQ/Direcionamento + insumos`.

### Task 8: Docs, varredura final e gates

**Files:** Modify `CLAUDE.md` (bloco revenda no mapa de rotas + invariantes se preciso), `docs/design/ui-padroes.md` §P (marcar telas novas ✓), docs locais gitignored (`docs/mapeamento-campos-calculos.md`, `docs/api-integracao-erp.md` — papel docs-keeper)

- [ ] **Step 1:** atualizar CLAUDE.md (rotas novas, módulo `produto_acabado` opt-in, decisões: espelho sem cad_tecidos, grade da OC em jsonb, 1 OC ativa/produto, parcelas tipo 'p_acabado'); §P do ui-padroes: linha "Produto Acabado + OC P. Acabado" → ✓ implementado.
- [ ] **Step 2:** varredura de segurança: `has_function_privilege` = false p/ anon/authenticated em TODOS os `_core` novos; RLS presente nas 3 tabelas; wrappers sem PUBLIC/anon.
- [ ] **Step 3:** gates completos: `npx tsc --noEmit` 0 · `npm run build` · `npx vitest run tests/unit` · `npx vitest run tests/integration/produto-acabado.test.ts tests/integration/oc-p-acabado.test.ts` (e a suíte de integração existente p/ regressão).
- [ ] **Step 4:** commit `docs(revenda): CLAUDE.md + ui-padroes §P + docs locais` e push da branch.

## Self-Review (feita)

- **Cobertura do spec:** entidades/códigos (T1), RPCs+contas (T2), receber/parcelas/estoque (T3), preço/custo (T4), módulo/nav/OC-tela (T5), planejador (T6), Plan. Produto+CQ/Direcionamento+insumos (T7), docs (T8). Toggle Config da Loja: T5 Step 1. Abas: T5 Step 4. Caminho OC-primeiro: vincular (T2) + UI busca (T6 Step 3).
- **Sem placeholders:** cada task com código/SQL concreto ou instrução de LER arquivo específico antes de espelhar (gerador de parcelas, policies RLS) — padrão aceito nos planos anteriores deste repo.
- **Consistência de nomes:** `salvar_produto_acabado/criar_card_produto_acabado/aplicar_produto_ao_modelo/vincular_oc_p_acabado/salvar_oc_p_acabado/receber_oc_p_acabado/estoque_p_acabado`, `splitMaiorResto/ehGrupoAcessorio/cadeiaValores`, module key `produto_acabado`, page keys `criacao_produto_acabado`/`entrada_oc_p_acabado` — usados uniformemente nas tasks.
