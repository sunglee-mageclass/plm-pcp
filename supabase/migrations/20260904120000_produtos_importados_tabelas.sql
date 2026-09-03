-- Produtos Importados — Fase 1: tabelas-base, RLS, REF automática, vínculo único, modgate.
-- Espelha ESTRUTURALMENTE a feature Produto Acabado/Revenda (ver
-- 20260807140000_produto_acabado_tabelas.sql + 20260811110000_modgate_produto_acabado.sql):
-- mesmo padrão de espelho 1:1 com `modelos` (trigger enforce_unique_fk, NUNCA UNIQUE),
-- mesma REF automática por sigla+contador (advisory lock PRÓPRIO — não colide com o da
-- revenda), mesma RLS tenant-scoped + modgate RESTRICTIVE de módulo opt-in.
-- Diferenças de domínio (compra internacional, não peça pronta nacional):
--   - moeda de compra/intermediária + cadeia de cotação (M1→M2→BRL ou M1→BRL direto)
--   - frete por peso (peso_kg × transporte_m2)
--   - markup atacado/varejo próprios do card (mercadoria importada)
--   - `produto_importado_etapas`: cronograma de pagamento em % por etapa (mercadoria/frete),
--     nova — não existe equivalente na revenda.
-- Custo/preço final continuam DERIVADOS e persistidos no espelho `modelos` (Fase 2+, RPCs)
-- — esta migration só cria o schema-base.
-- Idempotente (guards IF EXISTS/IF NOT EXISTS); altera constraint/dados ⇒ BEGIN/COMMIT.

BEGIN;

-- A) Origem do modelo: adiciona 'importado' ao CHECK existente (preserva interno/revenda).
alter table public.modelos drop constraint if exists modelos_origem_check;
alter table public.modelos add constraint modelos_origem_check
  check (origem in ('interno','revenda','importado'));

-- B) Tabela principal (espelho do card) --------------------------------------------------
create table if not exists public.produtos_importados (
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
  foto_url text,
  data_pedido date,
  data_prevista date,
  data_entrega date,
  moeda_compra text not null default 'RMB',      -- M1: moeda em que o fornecedor cobra
  moeda_intermediaria text,                      -- M2; NULL = cadeia direta M1→BRL
  valor_unitario_m1 numeric(14,4) not null default 0,
  cotacao_ref numeric(14,6) not null default 0,  -- cotação de referência/pré-cotação: M1 por 1 M2
  peso_kg numeric(12,4) not null default 0,      -- frete: peso por peça
  transporte_m2 numeric(14,4) not null default 0, -- frete: custo por kg, em M2
  desconto_pct numeric(6,2) not null default 0,
  cotacao_final numeric(14,6) not null default 0, -- BRL por 1 M2; cadeia direta (moeda_intermediaria NULL) = 1
  markup_atacado numeric(8,3),
  markup_varejo numeric(8,3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- C) Variantes por cor (cópia exata do shape de produto_acabado_variantes) ----------------
create table if not exists public.produto_importado_variantes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  produto_importado_id uuid not null references public.produtos_importados(id) on delete cascade,
  ordem integer not null,
  cor_id uuid references public.cores(id),
  cor_apelido_id uuid references public.cores_apelido(id),
  peso numeric(8,2) not null default 0,
  qtd integer not null default 0,
  unique (produto_importado_id, ordem)
);

-- D) Etapas de pagamento (cronograma % por etapa — mercadoria ou frete). NOVA, sem
--    equivalente na revenda: importação paga fornecedor/transportadora em parcelas
--    separadas, cada uma com sua própria cotação no momento do pagamento.
create table if not exists public.produto_importado_etapas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  produto_importado_id uuid not null references public.produtos_importados(id) on delete cascade,
  ordem integer not null,
  rotulo varchar(80),
  base text not null check (base in ('mercadoria','frete')),
  percentual numeric(6,2) not null default 0,
  data_vencimento date,
  cotacao numeric(14,6) not null default 0,
  unique (produto_importado_id, ordem)
);

-- RLS padrão por tenant (mesmo shape de produtos_acabados/produto_acabado_variantes) -----
alter table public.produtos_importados enable row level security;
alter table public.produto_importado_variantes enable row level security;
alter table public.produto_importado_etapas enable row level security;

drop policy if exists tenant_select on public.produtos_importados;
drop policy if exists tenant_insert on public.produtos_importados;
drop policy if exists tenant_update on public.produtos_importados;
drop policy if exists tenant_delete on public.produtos_importados;
create policy tenant_select on public.produtos_importados for select to authenticated
  using (tenant_id = get_user_tenant_id());
create policy tenant_insert on public.produtos_importados for insert to authenticated
  with check (tenant_id = get_user_tenant_id());
create policy tenant_update on public.produtos_importados for update to authenticated
  using (tenant_id = get_user_tenant_id()) with check (tenant_id = get_user_tenant_id());
create policy tenant_delete on public.produtos_importados for delete to authenticated
  using (tenant_id = get_user_tenant_id());

drop policy if exists tenant_select on public.produto_importado_variantes;
drop policy if exists tenant_insert on public.produto_importado_variantes;
drop policy if exists tenant_update on public.produto_importado_variantes;
drop policy if exists tenant_delete on public.produto_importado_variantes;
create policy tenant_select on public.produto_importado_variantes for select to authenticated
  using (tenant_id = get_user_tenant_id());
create policy tenant_insert on public.produto_importado_variantes for insert to authenticated
  with check (tenant_id = get_user_tenant_id());
create policy tenant_update on public.produto_importado_variantes for update to authenticated
  using (tenant_id = get_user_tenant_id()) with check (tenant_id = get_user_tenant_id());
create policy tenant_delete on public.produto_importado_variantes for delete to authenticated
  using (tenant_id = get_user_tenant_id());

drop policy if exists tenant_select on public.produto_importado_etapas;
drop policy if exists tenant_insert on public.produto_importado_etapas;
drop policy if exists tenant_update on public.produto_importado_etapas;
drop policy if exists tenant_delete on public.produto_importado_etapas;
create policy tenant_select on public.produto_importado_etapas for select to authenticated
  using (tenant_id = get_user_tenant_id());
create policy tenant_insert on public.produto_importado_etapas for insert to authenticated
  with check (tenant_id = get_user_tenant_id());
create policy tenant_update on public.produto_importado_etapas for update to authenticated
  using (tenant_id = get_user_tenant_id()) with check (tenant_id = get_user_tenant_id());
create policy tenant_delete on public.produto_importado_etapas for delete to authenticated
  using (tenant_id = get_user_tenant_id());

-- E) tenant_id automático (função global já existe — só os triggers). Nome com prefixo
--    "set_" para ordenar (alfabético) ANTES dos demais BEFORE INSERT ("trg_...").
drop trigger if exists set_tenant_id_trg on public.produtos_importados;
create trigger set_tenant_id_trg before insert on public.produtos_importados
  for each row execute function public.set_tenant_id();
drop trigger if exists set_tenant_id_trg on public.produto_importado_variantes;
create trigger set_tenant_id_trg before insert on public.produto_importado_variantes
  for each row execute function public.set_tenant_id();
drop trigger if exists set_tenant_id_trg on public.produto_importado_etapas;
create trigger set_tenant_id_trg before insert on public.produto_importado_etapas
  for each row execute function public.set_tenant_id();

-- G) 1:1 produto→modelo (NUNCA UNIQUE em coluna embedada — regra "O que NÃO fazer")
drop trigger if exists trg_pi_unique_modelo on public.produtos_importados;
create trigger trg_pi_unique_modelo
  before insert or update of modelo_id on public.produtos_importados
  for each row execute function public.enforce_unique_fk('modelo_id');
create index if not exists idx_pi_modelo on public.produtos_importados(modelo_id);

-- H) REF automática (espelha fn_produto_acabado_ref / _produto_acabado_ref_next).
--    Reusa _norm3/_grupo_eh_acessorio (já existem, globais) — NÃO recriar.
--    Advisory-lock key PRÓPRIO ('produto_importado_ref:'||tenant) para não colidir com o
--    contador da revenda ('modelo_ref_rev:'||tenant).
create or replace function public._produto_importado_ref_next(_tenant uuid) returns bigint
language plpgsql as $$
declare v bigint;
begin
  perform pg_advisory_xact_lock(hashtext('produto_importado_ref:'||_tenant::text));
  select coalesce(max((substring(ref from '([0-9]{7})$'))::bigint),0)+1 into v
    from public.produtos_importados where tenant_id=_tenant and ref ~ '[0-9]{7}$';
  return v;
end $$;

create or replace function public.fn_produto_importado_ref() returns trigger
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
  new.ref := v_sig || lpad(public._produto_importado_ref_next(new.tenant_id)::text, 7, '0');
  return new;
end $$;
drop trigger if exists trg_pi_ref on public.produtos_importados;
create trigger trg_pi_ref before insert on public.produtos_importados
  for each row execute function public.fn_produto_importado_ref();

revoke execute on function public._produto_importado_ref_next(uuid) from public, anon, authenticated;

-- I) Modgate RESTRICTIVE (módulo opt-in 'produto_importado') — mesmo shape de
--    20260811110000_modgate_produto_acabado.sql, já de cara nesta feature (não como
--    fast-follow separado).
DO $modgate_pi$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['produtos_importados','produto_importado_variantes','produto_importado_etapas'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS modgate_pi_sel ON public.%I', v_tbl);
    EXECUTE format('CREATE POLICY modgate_pi_sel ON public.%I AS RESTRICTIVE FOR SELECT USING (public.tenant_module_enabled(%L))', v_tbl, 'produto_importado');
    EXECUTE format('DROP POLICY IF EXISTS modgate_pi_ins ON public.%I', v_tbl);
    EXECUTE format('CREATE POLICY modgate_pi_ins ON public.%I AS RESTRICTIVE FOR INSERT WITH CHECK (public.tenant_module_enabled(%L))', v_tbl, 'produto_importado');
    EXECUTE format('DROP POLICY IF EXISTS modgate_pi_upd ON public.%I', v_tbl);
    EXECUTE format('CREATE POLICY modgate_pi_upd ON public.%I AS RESTRICTIVE FOR UPDATE USING (public.tenant_module_enabled(%L))', v_tbl, 'produto_importado');
    EXECUTE format('DROP POLICY IF EXISTS modgate_pi_del ON public.%I', v_tbl);
    EXECUTE format('CREATE POLICY modgate_pi_del ON public.%I AS RESTRICTIVE FOR DELETE USING (public.tenant_module_enabled(%L))', v_tbl, 'produto_importado');
  END LOOP;
END
$modgate_pi$;

COMMIT;
