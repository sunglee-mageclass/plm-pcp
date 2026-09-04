-- Produtos Importados — Fase 2: OC (ocs_importado) + etapas de pagamento na OC.
-- Espelha ESTRUTURALMENTE a OC de Produto Acabado/Revenda (ver
-- 20260807140000_produto_acabado_tabelas.sql, linhas 41-145 = ocs_p_acabado + RLS +
-- triggers set_tenant_id/numero/vínculo) — mesmo padrão de 1-OC-por-produto, número
-- automático por sigla+contador, grade_detalhe/variantes snapshot, RLS tenant-scoped.
-- Reusa os campos de câmbio já definidos em produtos_importados (Fase 1, ver
-- 20260904120000_produtos_importados_tabelas.sql) — a OC congela a cotação/condições
-- de compra no momento do pedido, assim como ocs_tecido congela o preço do tecido
-- (ver invariante "Custo congelado pela OC vinculada").
-- Diferença de domínio: importado paga por ETAPAS (cronograma % mercadoria/frete,
-- cada uma com sua própria cotação no pagamento) — NÃO por prazo_pagamento/
-- parcelas_entrega (dias) como a revenda. `ocs_importado_etapas` é o snapshot
-- EDITÁVEL dessas etapas na OC (cópia de produto_importado_etapas no momento da
-- criação; a OC pode divergir do cadastro depois).
-- Idempotente (guards IF EXISTS/IF NOT EXISTS); BEGIN/COMMIT (cria policy/trigger).

BEGIN;

-- A) Tabela principal ---------------------------------------------------------------------
create table if not exists public.ocs_importado (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  produto_importado_id uuid references public.produtos_importados(id) on delete set null,
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
  grade_proporcao jsonb not null default '{}'::jsonb,
  grade_detalhe jsonb not null default '{}'::jsonb, -- {"<ordem>":{"<tam>":{"pedida":n,"recebida":n,"defeito":n}}}
  variantes jsonb not null default '[]'::jsonb,     -- [{ordem,cor_id,cor_apelido_id,peso,qtd}] snapshot da OC
  qtd_total integer not null default 0,
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
  -- Câmbio (mesmos tipos/semântica de produtos_importados — congelados no momento do pedido) --
  moeda_compra text not null default 'RMB',      -- M1: moeda em que o fornecedor cobra
  moeda_intermediaria text,                      -- M2; NULL = cadeia direta M1→BRL
  valor_unitario_m1 numeric(14,4) not null default 0,
  cotacao_ref numeric(14,6) not null default 0,  -- cotação de referência/pré-cotação: M1 por 1 M2
  peso_kg numeric(12,4) not null default 0,      -- frete: peso por peça
  transporte_m2 numeric(14,4) not null default 0, -- frete: custo por kg, em M2
  desconto_pct numeric(6,2) not null default 0,
  cotacao_final numeric(14,6) not null default 0, -- BRL por 1 M2; cadeia direta (moeda_intermediaria NULL) = 1
  -- Derivado: custo landed real da OC (a partir das etapas efetivamente pagas/cotação real de
  -- cada uma) — preenchido por RPC na Fase 3 (recebimento/pagamento das etapas), NÃO nesta migration.
  custo_unitario_landed_real numeric(14,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- B) Etapas de pagamento NA OC (snapshot editável do cronograma) ---------------------------
create table if not exists public.ocs_importado_etapas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  oc_importado_id uuid not null references public.ocs_importado(id) on delete cascade,
  ordem int not null,
  rotulo varchar(80),
  base text not null check (base in ('mercadoria','frete')),
  percentual numeric(6,2) not null default 0,
  data_vencimento date,
  cotacao numeric(14,6) not null default 0,
  unique (oc_importado_id, ordem)
);

-- RLS padrão por tenant (espelha ocs_p_acabado) --------------------------------------------
alter table public.ocs_importado enable row level security;
alter table public.ocs_importado_etapas enable row level security;

drop policy if exists tenant_select on public.ocs_importado;
drop policy if exists tenant_insert on public.ocs_importado;
drop policy if exists tenant_update on public.ocs_importado;
drop policy if exists tenant_delete on public.ocs_importado;
create policy tenant_select on public.ocs_importado for select to authenticated
  using (tenant_id = get_user_tenant_id());
create policy tenant_insert on public.ocs_importado for insert to authenticated
  with check (tenant_id = get_user_tenant_id());
create policy tenant_update on public.ocs_importado for update to authenticated
  using (tenant_id = get_user_tenant_id()) with check (tenant_id = get_user_tenant_id());
create policy tenant_delete on public.ocs_importado for delete to authenticated
  using (tenant_id = get_user_tenant_id());

drop policy if exists tenant_select on public.ocs_importado_etapas;
drop policy if exists tenant_insert on public.ocs_importado_etapas;
drop policy if exists tenant_update on public.ocs_importado_etapas;
drop policy if exists tenant_delete on public.ocs_importado_etapas;
create policy tenant_select on public.ocs_importado_etapas for select to authenticated
  using (tenant_id = get_user_tenant_id());
create policy tenant_insert on public.ocs_importado_etapas for insert to authenticated
  with check (tenant_id = get_user_tenant_id());
create policy tenant_update on public.ocs_importado_etapas for update to authenticated
  using (tenant_id = get_user_tenant_id()) with check (tenant_id = get_user_tenant_id());
create policy tenant_delete on public.ocs_importado_etapas for delete to authenticated
  using (tenant_id = get_user_tenant_id());

-- C) tenant_id automático (função global já existe — só os triggers). Nome com prefixo
--    "set_" para ordenar (alfabético) ANTES dos demais BEFORE INSERT ("trg_...").
drop trigger if exists set_tenant_id_trg on public.ocs_importado;
create trigger set_tenant_id_trg before insert on public.ocs_importado
  for each row execute function public.set_tenant_id();
drop trigger if exists set_tenant_id_trg on public.ocs_importado_etapas;
create trigger set_tenant_id_trg before insert on public.ocs_importado_etapas
  for each row execute function public.set_tenant_id();

-- D) Nº da OC: 3 fornecedor + (1 grupo + 2 categoria | 'ACE') + '-' + 5 díg por sigla
--    (espelha fn_oc_p_acabado_numero EXATAMENTE, trocando ocs_p_acabado → ocs_importado).
--    Reusa _norm3/_grupo_eh_acessorio (já existem, globais) — NÃO recriar.
create or replace function public.fn_oc_importado_numero() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_sig text; v_num bigint;
begin
  if new.numero is not null and new.numero <> '' then return new; end if;
  v_sig := public._norm3((select nome_fantasia from empresas where id=new.empresa_id));
  if v_sig = '' then v_sig := 'FOR'; end if;
  if public._grupo_eh_acessorio(new.grupo_id) then v_sig := v_sig || 'ACE';
  else v_sig := v_sig || substr(public._norm3((select nome from grupos_produto where id=new.grupo_id)),1,1)
                      || substr(public._norm3((select nome from categorias_produto where id=new.categoria_id)),1,2);
  end if;
  select coalesce(max((substring(numero from '([0-9]+)$'))::bigint),0)+1 into v_num
    from public.ocs_importado where tenant_id=new.tenant_id and numero ~ ('^'||v_sig||'-[0-9]+$');
  new.numero := v_sig || '-' || lpad(v_num::text,5,'0');
  return new;
end $$;
drop trigger if exists trg_oci_numero on public.ocs_importado;
create trigger trg_oci_numero before insert on public.ocs_importado
  for each row execute function public.fn_oc_importado_numero();

-- E) Vínculo único (1 OC ativa por produto) — espelha enforce_oc_pa_vinculo_unico.
create or replace function public.enforce_oc_importado_vinculo_unico() returns trigger
language plpgsql as $$
declare v_num text;
begin
  if new.produto_importado_id is null then return new; end if;
  select numero into v_num from public.ocs_importado
   where produto_importado_id = new.produto_importado_id and id is distinct from new.id limit 1;
  if v_num is not null then
    raise exception 'Este produto já tem a OC % vinculada — desvincule antes.', v_num using errcode='P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_oci_vinculo_unico on public.ocs_importado;
create trigger trg_oci_vinculo_unico before insert or update of produto_importado_id on public.ocs_importado
  for each row execute function public.enforce_oc_importado_vinculo_unico();
create index if not exists idx_oci_produto on public.ocs_importado(produto_importado_id);

-- F) Índice único do número por tenant.
create unique index if not exists ux_ocs_importado_tenant_numero on public.ocs_importado(tenant_id, numero) where numero is not null;

-- G) Modgate RESTRICTIVE (módulo opt-in 'produto_importado', já default-OFF em
--    tenant_module_enabled desde 20260904180000) — mesmo shape do modgate de
--    20260904120000_produtos_importados_tabelas.sql.
DO $modgate_oci$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['ocs_importado','ocs_importado_etapas'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS modgate_oci_sel ON public.%I', v_tbl);
    EXECUTE format('CREATE POLICY modgate_oci_sel ON public.%I AS RESTRICTIVE FOR SELECT USING (public.tenant_module_enabled(%L))', v_tbl, 'produto_importado');
    EXECUTE format('DROP POLICY IF EXISTS modgate_oci_ins ON public.%I', v_tbl);
    EXECUTE format('CREATE POLICY modgate_oci_ins ON public.%I AS RESTRICTIVE FOR INSERT WITH CHECK (public.tenant_module_enabled(%L))', v_tbl, 'produto_importado');
    EXECUTE format('DROP POLICY IF EXISTS modgate_oci_upd ON public.%I', v_tbl);
    EXECUTE format('CREATE POLICY modgate_oci_upd ON public.%I AS RESTRICTIVE FOR UPDATE USING (public.tenant_module_enabled(%L))', v_tbl, 'produto_importado');
    EXECUTE format('DROP POLICY IF EXISTS modgate_oci_del ON public.%I', v_tbl);
    EXECUTE format('CREATE POLICY modgate_oci_del ON public.%I AS RESTRICTIVE FOR DELETE USING (public.tenant_module_enabled(%L))', v_tbl, 'produto_importado');
  END LOOP;
END
$modgate_oci$;

COMMIT;
