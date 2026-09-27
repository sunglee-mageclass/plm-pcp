-- Inverso de 20261007130000_integracao_4_trava.sql — MONTADO pela Task 4 (os 2 recálculos voltam ao texto de ANTES,
-- gerado por .superpowers/integracao/mig/dump_antes.sh — nunca editar à mão). Rodar SÓ depois do inverso 5 (LIFO).
-- Tira TODA a trava (produtos integráveis/integrados ficam editáveis) e devolve a foto ao gatilho original (sem WHEN).
-- D40/revisão T1 #1: o $guarda$ recusa se QUALQUER um dos 2 recálculos mudou depois da migration 4 (aceita só o
-- "antes" exato ou "antes"+TRECHO_B1 de CADA UM — nunca sobrescreve uma mudança de outra frente em silêncio).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_pa text;
  v_imp text;
BEGIN
  IF to_regprocedure('public.integracao_salvar(jsonb,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_4_down: volte a migration 5 antes (LIFO)' USING ERRCODE = 'P0001';
  END IF;
  v_pa := pg_get_functiondef('public._pa_recomputar_precos_modelo(uuid)'::regprocedure);
  v_imp := pg_get_functiondef('public._imp_recomputar_precos_modelo(uuid)'::regprocedure);
  IF md5(v_pa) <> '72c96c624de8f4530c862d8abb6a1283'
     AND NOT (position('[integracao v1]' IN v_pa) > 0
              AND md5(replace(v_pa,
'  -- [integracao v1] B1: produto travado pela Integração com "Preço de venda" marcado — o recálculo automático (OC, MO,
  -- markup, preço fixo) NÃO mexe no preco_venda: fica congelado (o retrato já tem o valor enviado). O atacado segue.
  if public._integracao_campo_travado(v_modelo_id, ''preco_venda'') then
    v_preco_venda := v_venda_atual;
  end if;

', '')) = '72c96c624de8f4530c862d8abb6a1283') THEN
    RAISE EXCEPTION 'integracao_4_down: _pa_recomputar_precos_modelo mudou depois da migration 4 - refazer o inverso' USING ERRCODE = 'P0001';
  END IF;
  IF md5(v_imp) <> '5baca24d0de45b8c5f291fef39472238'
     AND NOT (position('[integracao v1]' IN v_imp) > 0
              AND md5(replace(v_imp,
'  -- [integracao v1] B1: produto travado pela Integração com "Preço de venda" marcado — o recálculo automático (OC, MO,
  -- markup, preço fixo) NÃO mexe no preco_venda: fica congelado (o retrato já tem o valor enviado). O atacado segue.
  if public._integracao_campo_travado(v_modelo_id, ''preco_venda'') then
    v_preco_venda := v_venda_atual;
  end if;

', '')) = '5baca24d0de45b8c5f291fef39472238') THEN
    RAISE EXCEPTION 'integracao_4_down: _imp_recomputar_precos_modelo mudou depois da migration 4 - refazer o inverso' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_zz_integracao_trava ON public.modelos;
DROP TRIGGER IF EXISTS trg_zz_integracao_trava_del ON public.modelos;
DROP TRIGGER IF EXISTS trg_zz_integracao_trava ON public.modelo_skus;
DROP TRIGGER IF EXISTS trg_zz_integracao_trava ON public.produtos_acabados;
DROP TRIGGER IF EXISTS trg_zz_integracao_trava ON public.produtos_importados;
DROP TRIGGER IF EXISTS trg_zz_integracao_trava_var ON public.produto_acabado_variantes;
DROP TRIGGER IF EXISTS trg_zz_integracao_trava_var ON public.produto_importado_variantes;
DROP TRIGGER IF EXISTS trg_sync_foto_modelo_acabado_upd ON public.produtos_acabados;
CREATE OR REPLACE TRIGGER trg_sync_foto_modelo_acabado AFTER INSERT OR UPDATE OF foto_url, modelo_id ON public.produtos_acabados
  FOR EACH ROW EXECUTE FUNCTION public._sync_foto_modelo_do_produto();
DROP TRIGGER IF EXISTS trg_sync_foto_modelo_importado_upd ON public.produtos_importados;
CREATE OR REPLACE TRIGGER trg_sync_foto_modelo_importado AFTER INSERT OR UPDATE OF foto_url, modelo_id ON public.produtos_importados
  FOR EACH ROW EXECUTE FUNCTION public._sync_foto_modelo_do_produto();
DROP FUNCTION IF EXISTS public.fn_integracao_trava_variantes();
DROP FUNCTION IF EXISTS public.fn_integracao_trava_espelho();
DROP FUNCTION IF EXISTS public.fn_integracao_trava_skus();
DROP FUNCTION IF EXISTS public.fn_integracao_trava_modelos_del();
DROP FUNCTION IF EXISTS public.fn_integracao_trava_modelos();

CREATE OR REPLACE FUNCTION public._pa_recomputar_precos_modelo(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modelo_id uuid;
  v_valor_unitario numeric;
  v_desconto_pct numeric;
  v_markup_atacado numeric;
  v_markup_varejo numeric;
  v_preco_atacado_fixo numeric;
  v_preco_varejo_fixo numeric;
  v_insumos numeric := 0;
  v_mao_obra numeric := 0;
  v_custo numeric;
  v_atacado_atual numeric;
  v_venda_atual numeric;
  v_preco_atacado numeric;
  v_preco_venda numeric;
begin
  select p.modelo_id, p.valor_unitario, p.desconto_pct, p.markup_atacado, p.markup_varejo,
         p.preco_atacado_fixo, p.preco_varejo_fixo
    into v_modelo_id, v_valor_unitario, v_desconto_pct, v_markup_atacado, v_markup_varejo,
         v_preco_atacado_fixo, v_preco_varejo_fixo
    from public.produtos_acabados p where p.id = _produto_id;

  if v_modelo_id is null then
    return; -- sem espelho no Planejamento ainda — nada a recomputar
  end if;

  select coalesce(sum(me.consumo * me.custo_previsto), 0) into v_insumos
    from public.modelo_etiquetas me where me.modelo_id = v_modelo_id;

  -- MO na base (mesma fonte modelo_servico_mo do card do Planejamento; BRL por peça).
  select coalesce(sum(s.valor), 0) into v_mao_obra
    from public.modelo_servico_mo s where s.modelo_id = v_modelo_id;

  v_custo := coalesce(v_valor_unitario, 0) * (1 - coalesce(v_desconto_pct, 0) / 100.0) + v_insumos + v_mao_obra;

  select m.preco_atacado, m.preco_venda into v_atacado_atual, v_venda_atual
    from public.modelos m where m.id = v_modelo_id;

  -- Preço FIXO manda; senão deriva do markup (base × markup); senão NULL (sem markup nem fixo = não há
  -- preço — NÃO manter o valor antigo, que vira lixo exibido como "fixado" que o usuário nunca digitou).
  v_preco_atacado := case
    when v_preco_atacado_fixo is not null then v_preco_atacado_fixo
    when v_markup_atacado is not null then round(v_custo * v_markup_atacado, 2)
    else null end;
  -- VAREJO INDEPENDENTE: base(custo) × markup_varejo, NÃO preço_atacado × markup_varejo.
  v_preco_venda := case
    when v_preco_varejo_fixo is not null then v_preco_varejo_fixo
    when v_markup_varejo is not null then round(v_custo * v_markup_varejo, 2)
    else null end;

  update public.modelos set preco_atacado = v_preco_atacado, preco_venda = v_preco_venda
    where id = v_modelo_id
      and (preco_atacado is distinct from v_preco_atacado or preco_venda is distinct from v_preco_venda);
end;
$function$
;

CREATE OR REPLACE FUNCTION public._imp_recomputar_precos_modelo(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modelo_id uuid;
  v_markup_atacado numeric;
  v_markup_varejo numeric;
  v_preco_atacado_fixo numeric;
  v_preco_varejo_fixo numeric;
  v_mao_obra numeric := 0;
  v_custo numeric;
  v_atacado_atual numeric;
  v_venda_atual numeric;
  v_preco_atacado numeric;
  v_preco_venda numeric;
begin
  select p.modelo_id, p.markup_atacado, p.markup_varejo, p.preco_atacado_fixo, p.preco_varejo_fixo
    into v_modelo_id, v_markup_atacado, v_markup_varejo, v_preco_atacado_fixo, v_preco_varejo_fixo
    from public.produtos_importados p where p.id = _produto_id;
  if v_modelo_id is null then
    return; -- sem espelho ainda
  end if;

  -- MO na base (mesma fonte modelo_servico_mo; BRL por peça — soma limpa ao landed, já em BRL).
  select coalesce(sum(s.valor), 0) into v_mao_obra
    from public.modelo_servico_mo s where s.modelo_id = v_modelo_id;

  v_custo := public._imp_custo_landed(_produto_id) + v_mao_obra;

  select m.preco_atacado, m.preco_venda into v_atacado_atual, v_venda_atual
    from public.modelos m where m.id = v_modelo_id;

  v_preco_atacado := case
    when v_preco_atacado_fixo is not null then v_preco_atacado_fixo
    when v_markup_atacado is not null and v_markup_atacado > 0 then round(v_custo * v_markup_atacado, 2)
    else null end;
  -- VAREJO INDEPENDENTE: custo landed × markup_varejo, NÃO preço_atacado × markup_varejo.
  v_preco_venda := case
    when v_preco_varejo_fixo is not null then v_preco_varejo_fixo
    when v_markup_varejo is not null and v_markup_varejo > 0 then round(v_custo * v_markup_varejo, 2)
    else null end;

  update public.modelos set preco_atacado = v_preco_atacado, preco_venda = v_preco_venda
    where id = v_modelo_id
      and (preco_atacado is distinct from v_preco_atacado or preco_venda is distinct from v_preco_venda);
end $function$
;

DROP FUNCTION IF EXISTS public._integracao_campo_travado(uuid, text);

DO $pos$
BEGIN
  IF md5(pg_get_functiondef('public._pa_recomputar_precos_modelo(uuid)'::regprocedure)) <> '72c96c624de8f4530c862d8abb6a1283'
     OR md5(pg_get_functiondef('public._imp_recomputar_precos_modelo(uuid)'::regprocedure)) <> '5baca24d0de45b8c5f291fef39472238' THEN
    RAISE EXCEPTION 'integracao_4_down: recalculos nao voltaram ao texto de antes' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE 'trg_zz_integracao%' OR tgname LIKE 'trg_sync_foto_modelo_%_upd') THEN
    RAISE EXCEPTION 'integracao_4_down: gatilhos da trava ainda existem' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
