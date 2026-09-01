-- Agrupamento por Mix — uma classificação nomeada e reutilizável (ex.: "ALFAIATARIA
-- SUZY", "ANGELIM") que agrupa MODELOS por (coleção, subcoleção). Criada/editada no
-- Plan. Tecido; consumida como eixo "Agrupar por Mix" no Plan. Produto.
--
-- CONCEITO DIFERENTE de `mix_padroes` (template de proporção por linha do OTB) — nome
-- `colecao_mixes` evita colisão. Pertencimento ÚNICO: 1 FK `modelos.mix_id` (não N-N).
--
-- Mix vive em DOIS lugares (a vaga vazia do Plan. Tecido pode reservar um mix):
--   plan_tecido_slots.mix_id  → a VAGA (slot sem modelo ainda)
--   modelos.mix_id            → a fonte que o Plan. Produto consome
-- Ao materializar a vaga (_plan_tecido_criar_card_core), o mix do slot é copiado pro
-- modelo (feito em migration separada que altera aquela RPC).
--
-- Segurança: RLS por tenant (mesmo bloco de mix_padroes). RPCs SECURITY INVOKER — a RLS
-- + o trigger set_tenant_id fazem o gate; sem _core/bypass de tenant (mesma escolha de
-- salvar_mix_padrao). Sem modgate RESTRICTIVE (padrão otb/produto_acabado — módulo
-- enforçado nas escritas). Idempotente.

begin;

create table if not exists public.colecao_mixes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  colecao_id uuid references public.colecoes(id) on delete cascade,
  subcolecao text,                       -- casa com modelos.subcolecao (texto)
  nome varchar not null,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

-- mix_id nos DOIS lugares (SET NULL: excluir mix desassocia, não apaga o modelo/slot).
alter table public.modelos
  add column if not exists mix_id uuid references public.colecao_mixes(id) on delete set null;
alter table public.plan_tecido_slots
  add column if not exists mix_id uuid references public.colecao_mixes(id) on delete set null;

create index if not exists idx_colecao_mixes_colecao_sub on public.colecao_mixes(colecao_id, subcolecao);
create index if not exists idx_modelos_mix on public.modelos(mix_id);
create index if not exists idx_pt_slots_mix on public.plan_tecido_slots(mix_id);

-- Unicidade do nome por escopo (coleção, subcoleção) — case-insensitive. Barra "Este mix já existe".
create unique index if not exists uq_colecao_mixes_nome
  on public.colecao_mixes(tenant_id, colecao_id, subcolecao, lower(nome));

-- tenant_id automático + grants + RLS por tenant (padrão do projeto, copiado de mix_padroes).
do $$
declare t text := 'colecao_mixes';
begin
  execute format('create or replace trigger set_tenant_id_trg before insert on public.%I for each row execute function public.set_tenant_id()', t);
  execute format('grant all on public.%I to anon, authenticated, service_role', t);
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists tenant_select on public.%I', t);
  execute format('create policy tenant_select on public.%I for select to authenticated using (tenant_id = public.get_user_tenant_id())', t);
  execute format('drop policy if exists tenant_insert on public.%I', t);
  execute format('create policy tenant_insert on public.%I for insert to authenticated with check (tenant_id = public.get_user_tenant_id() or tenant_id is null)', t);
  execute format('drop policy if exists tenant_update on public.%I', t);
  execute format('create policy tenant_update on public.%I for update to authenticated using (tenant_id = public.get_user_tenant_id()) with check (tenant_id = public.get_user_tenant_id())', t);
  execute format('drop policy if exists tenant_delete on public.%I', t);
  execute format('create policy tenant_delete on public.%I for delete to authenticated using (tenant_id = public.get_user_tenant_id())', t);
end $$;

-- Criar ou renomear um mix. Nome duplicado no escopo → RAISE PT (backstop do índice único).
-- SECURITY INVOKER: RLS + set_tenant_id gateiam; sem bypass de tenant.
create or replace function public.salvar_colecao_mix(_id uuid, _colecao_id uuid, _subcolecao text, _nome text)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_id uuid := _id;
  v_nome text := btrim(coalesce(_nome, ''));
begin
  if v_nome = '' then
    raise exception 'Informe o nome do mix.';
  end if;

  begin
    if v_id is null then
      insert into public.colecao_mixes (colecao_id, subcolecao, nome,
             ordem)
      values (_colecao_id, _subcolecao, v_nome,
             coalesce((select max(ordem) + 1 from public.colecao_mixes
                       where colecao_id = _colecao_id and subcolecao is not distinct from _subcolecao), 0))
      returning id into v_id;
    else
      update public.colecao_mixes set nome = v_nome where id = v_id;  -- RLS restringe ao tenant
    end if;
  exception when unique_violation then
    raise exception 'Este mix já existe nesta subcoleção.';
  end;

  return v_id;
end;
$$;

revoke execute on function public.salvar_colecao_mix(uuid, uuid, text, text) from public, anon;
grant  execute on function public.salvar_colecao_mix(uuid, uuid, text, text) to authenticated;

-- Excluir um mix. `on delete set null` limpa modelos.mix_id e plan_tecido_slots.mix_id.
create or replace function public.excluir_colecao_mix(_id uuid)
returns void
language sql
set search_path to 'public'
as $$
  delete from public.colecao_mixes where id = _id;  -- RLS restringe ao tenant
$$;

revoke execute on function public.excluir_colecao_mix(uuid) from public, anon;
grant  execute on function public.excluir_colecao_mix(uuid) to authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
