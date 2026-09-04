-- Produtos Importados — Fase 2: etapas da OC → contas a pagar (parcelas).
-- Diferente da revenda (que rateia o total por prazo-dias "30/60/90"), aqui cada ETAPA da OC vira
-- UMA parcela: numero_parcela = etapa.ordem, data_vencimento = etapa.data_vencimento (fallback:
-- data_pedido), valor = valor BRL da etapa (via `_imp_etapas_brl_oc`, que já converte moeda→BRL —
-- parcelas é BRL-only). Neta contra parcelas já pagas (padrão `_recalcular_parcelas_core`).
-- Idempotente + BEGIN/COMMIT.

BEGIN;

-- Gera/regenera as parcelas a pagar de uma OC de importação a partir das etapas.
create or replace function public._gerar_parcelas_importado(_oc_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  o record;
  et record;
  v_venc date;
begin
  select id, tenant_id, empresa_id, data_pedido, status
    into o from public.ocs_importado where id = _oc_id;
  if not found then return; end if;

  -- Apaga só as NÃO-pagas (preserva pagas — mesma regra do core).
  delete from public.parcelas
   where oc_importado_id = _oc_id
     and tipo_oc = 'p_importado'
     and status is distinct from 'pago'
     and data_pagamento is null;

  -- 1 parcela por etapa (numero_parcela = ordem). Pula slots já ocupados por parcela PAGA
  -- (não recria — preserva o pagamento). Valor BRL vem de `_imp_etapas_brl_oc` (já convertido).
  for et in select ordem, valor_brl, data_vencimento from public._imp_etapas_brl_oc(_oc_id) loop
    -- se já existe parcela paga nesse número, não mexe
    if exists (select 1 from public.parcelas where oc_importado_id = _oc_id and numero_parcela = et.ordem
                 and (status = 'pago' or data_pagamento is not null)) then
      continue;
    end if;
    if coalesce(et.valor_brl,0) <= 0 then
      continue; -- etapa sem valor (cotação 0 etc.) não vira parcela
    end if;
    v_venc := coalesce(et.data_vencimento, o.data_pedido, current_date);
    insert into public.parcelas (tenant_id, tipo_oc, oc_importado_id, empresa_id, numero_parcela, valor, data_vencimento, status)
    values (o.tenant_id, 'p_importado', _oc_id, o.empresa_id, et.ordem, et.valor_brl, v_venc, 'a_pagar');
  end loop;
end $$;
revoke execute on function public._gerar_parcelas_importado(uuid) from public, anon, authenticated;

-- Trigger na OC: valores/cotações/data mudaram → regenera.
create or replace function public.trg_fn_parcelas_importado_oc() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public._gerar_parcelas_importado(NEW.id);
  return NEW;
end $$;
drop trigger if exists trg_parcelas_importado_oc on public.ocs_importado;
create trigger trg_parcelas_importado_oc
  after insert or update of valor_unitario_m1, qtd_total, peso_kg, transporte_m2, desconto_pct, cotacao_final, data_pedido, empresa_id
  on public.ocs_importado
  for each row execute function public.trg_fn_parcelas_importado_oc();

-- Trigger nas ETAPAS: %/cotação/data de uma etapa mudou → regenera a OC toda.
create or replace function public.trg_fn_parcelas_importado_etapa() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_oc uuid;
begin
  v_oc := coalesce(NEW.oc_importado_id, OLD.oc_importado_id);
  if v_oc is not null then perform public._gerar_parcelas_importado(v_oc); end if;
  return coalesce(NEW, OLD);
end $$;
drop trigger if exists trg_parcelas_importado_etapa on public.ocs_importado_etapas;
create trigger trg_parcelas_importado_etapa
  after insert or update or delete on public.ocs_importado_etapas
  for each row execute function public.trg_fn_parcelas_importado_etapa();

COMMIT;
