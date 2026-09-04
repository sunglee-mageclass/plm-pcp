-- Produtos Importados — Fase 2: helpers de câmbio por ETAPA da OC + recompute do landed real.
-- As PARCELAS a pagar do importado nascem das etapas (1 por etapa), e cada valor precisa ser
-- convertido de moeda→BRL (parcelas é BRL-only). O `_imp_custo_landed` (Fase 1) só devolve o total
-- somado; aqui fatoramos a MESMA fórmula ETAPA-A-ETAPA, lendo da OC (ocs_importado + _etapas).
-- Espelha src/lib/moeda.ts (custoLanded) por etapa. Idempotente; BEGIN/COMMIT.

BEGIN;

-- Valor BRL de CADA etapa de uma OC (o valor cheio do pedido, não unitário — é o que vai pra parcela).
-- Fórmula (mesma de _imp_custo_landed, mas por etapa):
--   merc_liq_M1 = valor_unitario_m1 × qtd × (1-desc/100)
--   frete_liq_M2 = peso_kg × transporte_m2 × qtd × (1-desc/100)
--   mercadoria: (merc_liq_M1 × %/100) ÷ cotacao (M1→M2, cotacao≤0 → 0) × cotacao_final (M2→BRL)
--   frete:      (frete_liq_M2 × %/100) ÷ (cotacao se >0 e ≠1, senão 1) × cotacao_final
-- Retorna 1 linha por etapa: (ordem, rotulo, base, data_vencimento, valor_brl).
create or replace function public._imp_etapas_brl_oc(_oc_id uuid)
returns table (ordem int, rotulo text, base text, data_vencimento date, valor_brl numeric)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  o record;
  v_desc numeric;
  v_merc_liq_m1 numeric;
  v_frete_liq_m2 numeric;
begin
  select valor_unitario_m1, qtd_total, peso_kg, transporte_m2, desconto_pct, cotacao_final
    into o from public.ocs_importado where id = _oc_id;
  if not found or coalesce(o.qtd_total,0) <= 0 then
    return;
  end if;
  v_desc := 1 - coalesce(o.desconto_pct,0) / 100.0;
  v_merc_liq_m1 := coalesce(o.valor_unitario_m1,0) * o.qtd_total * v_desc;
  v_frete_liq_m2 := coalesce(o.peso_kg,0) * coalesce(o.transporte_m2,0) * o.qtd_total * v_desc;

  return query
  select e.ordem, e.rotulo::text, e.base::text, e.data_vencimento,
    round(
      case
        when e.base = 'mercadoria' then
          case when coalesce(e.cotacao,0) > 0
            then (v_merc_liq_m1 * (coalesce(e.percentual,0)/100.0)) / e.cotacao
            else 0 end
        else -- frete: já em M2
          case when coalesce(e.cotacao,0) > 0 and e.cotacao <> 1
            then (v_frete_liq_m2 * (coalesce(e.percentual,0)/100.0)) / e.cotacao
            else (v_frete_liq_m2 * (coalesce(e.percentual,0)/100.0)) end
      end * coalesce(o.cotacao_final,0)
    , 2) as valor_brl
  from public.ocs_importado_etapas e
  where e.oc_importado_id = _oc_id
  order by e.ordem;
end $$;
revoke execute on function public._imp_etapas_brl_oc(uuid) from public, anon, authenticated;

-- Recalcula o custo landed REAL unitário da OC = Σ (valor BRL das etapas) ÷ qtd_total.
-- Grava em ocs_importado.custo_unitario_landed_real. Chamado ao salvar/receber a OC.
-- Nota: Σ das etapas de mercadoria (100%) + frete (100%) reproduz exatamente o total do
-- _imp_custo_landed quando as etapas cobrem 100% de cada base (invariante Σ%=100 validada no save).
create or replace function public._imp_recalcular_landed_real_oc(_oc_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_qtd int; v_total_brl numeric;
begin
  select qtd_total into v_qtd from public.ocs_importado where id = _oc_id;
  if coalesce(v_qtd,0) <= 0 then
    update public.ocs_importado set custo_unitario_landed_real = 0 where id = _oc_id;
    return;
  end if;
  select coalesce(sum(valor_brl),0) into v_total_brl from public._imp_etapas_brl_oc(_oc_id);
  update public.ocs_importado
    set custo_unitario_landed_real = round(v_total_brl / v_qtd, 4)
    where id = _oc_id;
end $$;
revoke execute on function public._imp_recalcular_landed_real_oc(uuid) from public, anon, authenticated;

COMMIT;
