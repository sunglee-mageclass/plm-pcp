-- Preço de revenda/importado: VAREJO independente do atacado (set/2026, pedido do dono).
--
-- Antes: preço_varejo = preço_atacado × markup_varejo (ENCADEADO — varejo dependia do atacado).
-- Depois: preço_varejo = base(custo) × markup_varejo — atacado e varejo INDEPENDENTES, mesma base.
-- Efeito colateral desejado: setar SÓ o markup_varejo (sem atacado) já produz preço de varejo (antes
-- ficava null porque preço_atacado era null). A base NÃO muda (Acabado: valor_unit×(1−desc)+insumos;
-- Importado: custo landed).
--
-- Corpos COPIADOS byte-a-byte do pg_get_functiondef vigente; só muda a linha do v_preco_venda (a
-- condição passa a olhar v_custo e a multiplicação usa v_custo). Diff-validar: só essa linha.
-- Mesma assinatura (uuid) → CREATE OR REPLACE substitui, sem overload.

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

  v_custo := coalesce(v_valor_unitario, 0) * (1 - coalesce(v_desconto_pct, 0) / 100.0) + v_insumos;

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

  v_custo := public._imp_custo_landed(_produto_id);

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

COMMIT;
