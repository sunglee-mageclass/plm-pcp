-- FORNECEDORES — FASE 2 (schema): ESPELHO empresa(servico) → terceirizados.
-- A tela passa a gerenciar serviço como EMPRESA, mas a Produção lê `terceirizado_id` até a F3
-- (e _ranking_oficinas_core usa INNER JOIN → serviço sem terceirizado sumiria do ranking/SLA sem
-- erro). Então mantemos o espelho `terceirizados`/`terceirizado_categorias` sincronizado por
-- gatilho FORWARD-ONLY (empresa é o mestre; terceirizado é mirror legado só-leitura da Produção).
-- Loop-guard GUC `app.terc_mirror` (padrão do OTB `app.otb_reconciling`). Nada de RPC muda aqui.
-- Ver docs/superpowers/plans/2026-07-07-fornecedores-*.

-- (0) RE-SYNC idempotente da F1 (pega serviços/categorias criados no intervalo F1→F2). Roda ANTES
--     dos gatilhos existirem, então não os dispara.
insert into public.empresas (tenant_id, nome_fantasia, tipo, origem_terceirizado_id)
select t.tenant_id, t.nome_responsavel, 'servico', t.id from public.terceirizados t
where not exists (select 1 from public.empresas e where e.origem_terceirizado_id = t.id);

insert into public.empresa_categorias_servico (empresa_id, categoria_terceirizado_id, tenant_id)
select e.id, tc.categoria_terceirizado_id, e.tenant_id
from public.terceirizado_categorias tc
join public.empresas e on e.origem_terceirizado_id = tc.terceirizado_id
on conflict (empresa_id, categoria_terceirizado_id) do nothing;

update public.producao_terceirizados pt set empresa_id = e.id
from public.empresas e where e.origem_terceirizado_id = pt.terceirizado_id and pt.empresa_id is null;

-- (1) T1 — empresa(servico) → terceirizados (nome). AFTER INSERT OR UPDATE.
--     INSERT de empresa serviço nova (via tela) cria o terceirizado espelho e liga por
--     origem_terceirizado_id; UPDATE propaga o nome. Guard impede o self-update reentrar.
create or replace function public.fn_mirror_empresa_terceirizado()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_terc uuid;
begin
  if coalesce(current_setting('app.terc_mirror', true), '') = 'on' then return NEW; end if;
  if NEW.tipo <> 'servico' then return NEW; end if;
  perform set_config('app.terc_mirror', 'on', true);
  if NEW.origem_terceirizado_id is null then
    insert into public.terceirizados (tenant_id, nome_responsavel)
      values (NEW.tenant_id, NEW.nome_fantasia) returning id into v_terc;
    update public.empresas set origem_terceirizado_id = v_terc where id = NEW.id;
  else
    update public.terceirizados set nome_responsavel = NEW.nome_fantasia
      where id = NEW.origem_terceirizado_id;
  end if;
  perform set_config('app.terc_mirror', 'off', true);
  return NEW;
end $$;
revoke execute on function public.fn_mirror_empresa_terceirizado() from public, anon, authenticated;
drop trigger if exists trg_mirror_empresa_terc on public.empresas;
create trigger trg_mirror_empresa_terc after insert or update on public.empresas
  for each row execute function public.fn_mirror_empresa_terceirizado();

-- (2) T2 — empresa_categorias_servico → terceirizado_categorias. AFTER INSERT OR DELETE.
--     O save da tela reescreve categorias com delete+insert; o DELETE aqui evita categoria fantasma.
create or replace function public.fn_mirror_emp_cat_servico()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_terc uuid; v_tenant uuid;
begin
  if coalesce(current_setting('app.terc_mirror', true), '') = 'on' then return coalesce(NEW, OLD); end if;
  perform set_config('app.terc_mirror', 'on', true);
  if TG_OP = 'INSERT' then
    select origem_terceirizado_id, tenant_id into v_terc, v_tenant from public.empresas where id = NEW.empresa_id;
    if v_terc is not null then
      insert into public.terceirizado_categorias (terceirizado_id, categoria_terceirizado_id, tenant_id)
        values (v_terc, NEW.categoria_terceirizado_id, v_tenant)
        on conflict (terceirizado_id, categoria_terceirizado_id) do nothing;
    end if;
  elsif TG_OP = 'DELETE' then
    select origem_terceirizado_id into v_terc from public.empresas where id = OLD.empresa_id;
    if v_terc is not null then
      delete from public.terceirizado_categorias
        where terceirizado_id = v_terc and categoria_terceirizado_id = OLD.categoria_terceirizado_id;
    end if;
  end if;
  perform set_config('app.terc_mirror', 'off', true);
  return coalesce(NEW, OLD);
end $$;
revoke execute on function public.fn_mirror_emp_cat_servico() from public, anon, authenticated;
drop trigger if exists trg_mirror_emp_cat_serv on public.empresa_categorias_servico;
create trigger trg_mirror_emp_cat_serv after insert or delete on public.empresa_categorias_servico
  for each row execute function public.fn_mirror_emp_cat_servico();

-- (3) producao_terceirizados.empresa_id derivado de terceirizado_id em qualquer escrita
--     (salvar_terceirizados só grava terceirizado_id). Mantém o dual consistente. BEFORE INS/UPD.
create or replace function public.fn_prod_terc_empresa()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if NEW.terceirizado_id is not null and NEW.empresa_id is null then
    select id into NEW.empresa_id from public.empresas where origem_terceirizado_id = NEW.terceirizado_id;
  end if;
  return NEW;
end $$;
revoke execute on function public.fn_prod_terc_empresa() from public, anon, authenticated;
drop trigger if exists trg_prod_terc_empresa on public.producao_terceirizados;
create trigger trg_prod_terc_empresa before insert or update on public.producao_terceirizados
  for each row execute function public.fn_prod_terc_empresa();

select pg_notify('pgrst', 'reload schema');
