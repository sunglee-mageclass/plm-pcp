-- Preço FIXADO para revenda/importado (set/2026) — resolve "digito 298 e vira 297,84".
--
-- Até aqui o preço de revenda/importado era 100% DERIVADO do markup: preco = round(base × markup, 2).
-- Como o markup é arredondado, o preço digitado nunca voltava exato (298 → markup 4,38 → 297,84).
-- Decisão do dono (set/2026): o PREÇO DIGITADO é gravado EXATO e MANDA — o markup passa a ser o
-- derivado/exibido (preço ÷ custo). Se o custo muda depois (ex.: OC recebida), o preço fixo PERMANECE
-- (o markup exibido é que se reajusta). Digitar o MARKUP de novo DESTRAVA aquele canal (limpa o fixo,
-- volta a derivar preço do markup). Atacado e varejo são canais INDEPENDENTES — cada um fixa/destrava só a si.
--
-- Modelo: colunas `preco_atacado_fixo`/`preco_varejo_fixo` em produtos_acabados e produtos_importados
-- (null = "não fixado", usa markup — comportamento de sempre). O recompute (ponto único que os 12
-- gatilhos atravessam) passa a gravar `coalesce(preco_fixo, round(base × markup, 2))` em modelos —
-- então TODOS os gatilhos respeitam o fixo sem serem tocados, e os ~10 consumidores de front seguem
-- lendo modelos.preco_venda/preco_atacado como fonte única. Invariante #13 (preço "sempre derivado")
-- passa a: preço derivado do markup, SALVO quando fixado.

BEGIN;

ALTER TABLE public.produtos_acabados
  ADD COLUMN IF NOT EXISTS preco_atacado_fixo numeric(12,2),
  ADD COLUMN IF NOT EXISTS preco_varejo_fixo  numeric(12,2);

ALTER TABLE public.produtos_importados
  ADD COLUMN IF NOT EXISTS preco_atacado_fixo numeric(12,2),
  ADD COLUMN IF NOT EXISTS preco_varejo_fixo  numeric(12,2);

-- ── Recompute REVENDA: preço fixo tem prioridade sobre o derivado do markup ────────────────────
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
$function$;

-- ── Recompute IMPORTADO: mesma prioridade do fixo ─────────────────────────────────────────────
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
end $function$;

-- ── RPC: salvar PREÇO FIXO de revenda (por canal, independente) ───────────────────────────────
-- `_tocar_atacado`/`_tocar_varejo` dizem QUAIS canais mexer (o outro fica intacto — salvar só o
-- varejo NÃO destrava o atacado). No canal tocado: preço não-null = FIXA (grava exato + limpa o
-- markup daquele canal, o preço manda); preço NULL = DESTRAVA (limpa o fixo, mantém o markup → volta
-- a derivar). Atacado e varejo são independentes.
CREATE OR REPLACE FUNCTION public._salvar_precos_fixo_produto_acabado_core(
  _produto_id uuid, _tocar_atacado boolean, _preco_atacado_fixo numeric,
  _tocar_varejo boolean, _preco_varejo_fixo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  if (_tocar_atacado and _preco_atacado_fixo is not null and _preco_atacado_fixo <= 0)
     or (_tocar_varejo and _preco_varejo_fixo is not null and _preco_varejo_fixo <= 0) then
    raise exception 'O preço precisa ser maior que zero.' using errcode = 'P0001';
  end if;

  update public.produtos_acabados
    set preco_atacado_fixo = case when _tocar_atacado then _preco_atacado_fixo else preco_atacado_fixo end,
        markup_atacado = case when _tocar_atacado and _preco_atacado_fixo is not null then null else markup_atacado end,
        preco_varejo_fixo = case when _tocar_varejo then _preco_varejo_fixo else preco_varejo_fixo end,
        markup_varejo = case when _tocar_varejo and _preco_varejo_fixo is not null then null else markup_varejo end,
        updated_at = now()
    where id = _produto_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Produto não encontrado';
  end if;

  perform public._pa_recomputar_precos_modelo(_produto_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_precos_fixo_produto_acabado(
  _produto_id uuid, _tocar_atacado boolean, _preco_atacado_fixo numeric,
  _tocar_varejo boolean, _preco_varejo_fixo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._salvar_precos_fixo_produto_acabado_core(
    _produto_id, _tocar_atacado, _preco_atacado_fixo, _tocar_varejo, _preco_varejo_fixo);
end;
$function$;

-- Fixar MARKUP destrava o canal (limpa o preço fixo daquele canal) — espelho inverso. Atualiza a RPC
-- existente `_salvar_markups_produto_acabado_core` p/ zerar o fixo do canal cujo markup foi definido.
CREATE OR REPLACE FUNCTION public._salvar_markups_produto_acabado_core(
  _produto_id uuid, _markup_atacado numeric, _markup_varejo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  if (_markup_atacado is not null and _markup_atacado <= 0)
     or (_markup_varejo is not null and _markup_varejo <= 0) then
    raise exception 'O markup precisa ser maior que zero.' using errcode = 'P0001';
  end if;

  -- Definir markup num canal DESTRAVA aquele canal (limpa o preço fixo) — o markup volta a mandar.
  update public.produtos_acabados
    set markup_atacado = _markup_atacado,
        preco_atacado_fixo = case when _markup_atacado is not null then null else preco_atacado_fixo end,
        markup_varejo = _markup_varejo,
        preco_varejo_fixo = case when _markup_varejo is not null then null else preco_varejo_fixo end,
        updated_at = now()
    where id = _produto_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Produto não encontrado';
  end if;

  perform public._pa_recomputar_precos_modelo(_produto_id);
end;
$function$;

-- Limpa a 1ª tentativa (assinatura de 3 args, aplicada durante o desenvolvimento — evita função órfã).
DROP FUNCTION IF EXISTS public._salvar_precos_fixo_produto_acabado_core(uuid, numeric, numeric);
DROP FUNCTION IF EXISTS public.salvar_precos_fixo_produto_acabado(uuid, numeric, numeric);

REVOKE EXECUTE ON FUNCTION public._salvar_precos_fixo_produto_acabado_core(uuid, boolean, numeric, boolean, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.salvar_precos_fixo_produto_acabado(uuid, boolean, numeric, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_precos_fixo_produto_acabado(uuid, boolean, numeric, boolean, numeric) TO authenticated;

-- BACKFILL: limpa preços RESIDUAIS de revenda/importado — canais sem markup NEM preço fixo tinham um
-- valor antigo preso em modelos.preco_* (recompute antigo fazia `else v_atual`), exibido no card como
-- um preço "fixado" que o usuário nunca digitou (ex.: CLUTCH LILLY atacado 2,72). Recompute agora dá
-- NULL nesse caso; roda uma vez p/ os já existentes.
update public.modelos m
  set preco_atacado = null
  from public.produtos_acabados pa
  where pa.modelo_id = m.id
    and pa.markup_atacado is null and pa.preco_atacado_fixo is null
    and m.preco_atacado is not null;
update public.modelos m
  set preco_venda = null
  from public.produtos_acabados pa
  where pa.modelo_id = m.id
    and pa.markup_varejo is null and pa.preco_varejo_fixo is null
    and m.preco_venda is not null;
update public.modelos m
  set preco_atacado = null
  from public.produtos_importados pi
  where pi.modelo_id = m.id
    and pi.markup_atacado is null and pi.preco_atacado_fixo is null
    and m.preco_atacado is not null;
update public.modelos m
  set preco_venda = null
  from public.produtos_importados pi
  where pi.modelo_id = m.id
    and pi.markup_varejo is null and pi.preco_varejo_fixo is null
    and m.preco_venda is not null;

COMMIT;

SELECT pg_notify('pgrst', 'reload schema');
