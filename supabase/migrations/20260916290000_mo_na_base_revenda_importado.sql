-- Mão de obra na BASE do markup de revenda/importado (set/2026, pedido do dono).
--
-- Contexto: revenda e importado passam a ter seção de Mão de Obra (mesma fonte `modelo_servico_mo`,
-- chaveada por modelo_id — a MESMA linha editada no card do Planejamento e nos Sheets de Produto
-- Acabado/Importado). A MO agora entra na BASE do markup:
--   base_revenda  = valor_unit×(1−desc%) + insumos + MO
--   base_importado = custo_landed + MO
-- MO = Σ modelo_servico_mo.valor (BRL por peça, mesma unidade das bases — soma limpa, sem câmbio).
--
-- ⚠️ `_custo_unitario_modelos_core` NÃO muda: o `previsto` continua sendo só o custo MATERIAL
-- (a separação materiais × mão-de-obra do card, invariante #8, seria quebrada se a MO entrasse nele).
-- A base composta (previsto + mao_obra_previsto) é montada NO FRONT; o `mao_obra_previsto` já vem
-- no JSON. Aqui só os 2 recomputes de PREÇO (que gravam modelos.preco_atacado/venda) somam a MO,
-- + o rollup da MO passa a disparar o recompute (senão o preço ficava defasado ao editar a MO).
--
-- Corpos COPIADOS byte-a-byte do pg_get_functiondef vigente; só as linhas da MO mudam.
-- Diff-validar: a variável v_mao_obra + o SELECT dela + o "+ v_mao_obra" no v_custo (em cada recompute)
-- e o bloco novo no rollup. Mesma assinatura (uuid) → CREATE OR REPLACE substitui, sem overload.

BEGIN;

-- ── Produto Acabado / Revenda ─────────────────────────────────────────────────
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
  v_insumos numeric := 0;
  v_mao_obra numeric := 0;
  v_custo numeric;
  v_atacado_atual numeric;
  v_venda_atual numeric;
  v_preco_atacado numeric;
  v_preco_venda numeric;
begin
  select p.modelo_id, p.valor_unitario, p.desconto_pct, p.markup_atacado, p.markup_varejo
    into v_modelo_id, v_valor_unitario, v_desconto_pct, v_markup_atacado, v_markup_varejo
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

  v_preco_atacado := case when v_markup_atacado is not null
    then round(v_custo * v_markup_atacado, 2)
    else v_atacado_atual end;
  -- VAREJO INDEPENDENTE: base(custo) × markup_varejo, NÃO preço_atacado × markup_varejo.
  v_preco_venda := case when v_markup_varejo is not null
    then round(v_custo * v_markup_varejo, 2)
    else v_venda_atual end;

  update public.modelos set preco_atacado = v_preco_atacado, preco_venda = v_preco_venda
    where id = v_modelo_id
      and (preco_atacado is distinct from v_preco_atacado or preco_venda is distinct from v_preco_venda);
end;
$function$;

-- ── Produto Importado ─────────────────────────────────────────────────────────
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
  v_mao_obra numeric := 0;
  v_custo numeric;
  v_atacado_atual numeric;
  v_venda_atual numeric;
  v_preco_atacado numeric;
  v_preco_venda numeric;
begin
  select p.modelo_id, p.markup_atacado, p.markup_varejo
    into v_modelo_id, v_markup_atacado, v_markup_varejo
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

  v_preco_atacado := case when v_markup_atacado is not null and v_markup_atacado > 0
    then round(v_custo * v_markup_atacado, 2) else v_atacado_atual end;
  -- VAREJO INDEPENDENTE: custo landed × markup_varejo, NÃO preço_atacado × markup_varejo.
  v_preco_venda := case when v_markup_varejo is not null and v_markup_varejo > 0
    then round(v_custo * v_markup_varejo, 2) else v_venda_atual end;

  update public.modelos set preco_atacado = v_preco_atacado, preco_venda = v_preco_venda
    where id = v_modelo_id
      and (preco_atacado is distinct from v_preco_atacado or preco_venda is distinct from v_preco_venda);
end $function$;

-- ── Rollup da MO: recompute do preço quando a MO muda ─────────────────────────
-- Antes: só repintava o flag `custo_terceirizados_aprovado`. Agora, como a MO entra na base do
-- markup de revenda/importado, uma mudança de MO precisa recomputar o preço do produto vinculado
-- (senão o preço fica defasado até o próximo save de markup/OC). Manufaturado: sem produto acabado/
-- importado vinculado → os dois selects não acham nada e nada é recomputado (preço interno intocado).
CREATE OR REPLACE FUNCTION public.fn_modelo_servico_mo_rollup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_modelo uuid := COALESCE(NEW.modelo_id, OLD.modelo_id);
  v_pa uuid;
  v_imp uuid;
BEGIN
  UPDATE public.modelos
     SET custo_terceirizados_aprovado = public._mo_liberada(v_modelo)
   WHERE id = v_modelo
     AND custo_terceirizados_aprovado IS DISTINCT FROM public._mo_liberada(v_modelo);

  -- Recompute do preço: a MO agora é base do markup de revenda/importado.
  select id into v_pa from public.produtos_acabados where modelo_id = v_modelo;
  if v_pa is not null then perform public._pa_recomputar_precos_modelo(v_pa); end if;

  select id into v_imp from public.produtos_importados where modelo_id = v_modelo;
  if v_imp is not null then perform public._imp_recomputar_precos_modelo(v_imp); end if;

  RETURN COALESCE(NEW, OLD);
END $function$;

COMMIT;
