-- Mão de obra: MÚLTIPLAS instâncias do MESMO serviço (set/2026, pedido do dono).
--
-- Antes: UNIQUE (modelo_id, categoria_terceirizado_id) — 1 linha por serviço; o dropdown escondia
-- serviços já usados. Agora: o mesmo serviço pode aparecer N vezes; o card soma o total; a
-- APROVAÇÃO é POR INSTÂNCIA (id), não mais por serviço.
--
-- Mudanças:
--   • DROP do UNIQUE (modelo_id, categoria_terceirizado_id). A identidade passa a ser o `id` da linha.
--   • _salvar_modelo_servico_mo_core: diff por `id` (update por id / insert sem id / delete dos ids
--     ausentes), em vez de upsert por categoria. Preserva o `aprovado` das linhas mantidas.
--   • aprovar_servico_mo / _aprovar_servico_mo_core: recebem `_linha_id` (a instância), não mais
--     `_categoria_terceirizado_id`. ⚠️ ASSINATURA MUDA → DROP da antiga (senão vira overload ambíguo).
--   • _modelo_mo_resumo_core: a lista de linhas passa a expor `id` (p/ o front aprovar por instância);
--     o `estado`/`total`/`total_aprovado` já agregam por modelo (INTACTOS — somam todas as instâncias).
--   • enforce triggers (aprovação por linha, inv. #12): intactos — já operam sobre NEW/OLD da linha.
--   • rollup (_mo_liberada / fn_modelo_servico_mo_rollup): intactos — `_mo_liberada` = NOT EXISTS linha
--     com aprovado IS DISTINCT FROM true, que continua correto por instância.
--
-- Corpos COPIADOS byte-a-byte do pg_get_functiondef vigente; só a lógica de CHAVE muda. Teste txn.

BEGIN;

-- ── 1) Remove o UNIQUE (modelo, categoria) — permite N instâncias do mesmo serviço ──────────────
ALTER TABLE public.modelo_servico_mo DROP CONSTRAINT IF EXISTS modelo_servico_mo_modelo_categoria_key;

-- ── 2) Save: diff por `id` (não mais upsert por categoria) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public._salvar_modelo_servico_mo_core(_modelo_id uuid, _linhas jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_keep uuid[] := '{}';   -- ids de linha presentes no payload (mantidos)
  r jsonb; v_id uuid; v_cat uuid; v_valor numeric; v_obs text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(_linhas) <> 'array' THEN
    RAISE EXCEPTION 'Formato inválido: as linhas de MO devem ser uma lista' USING ERRCODE = 'P0001';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(_linhas) LOOP
    v_id  := NULLIF(r->>'id','')::uuid;
    v_cat := NULLIF(r->>'categoria_terceirizado_id','')::uuid;
    v_valor := COALESCE((r->>'valor')::numeric, 0);
    v_obs := NULLIF(r->>'observacoes','');

    -- Categoria (quando informada) tem que ser do tenant.
    IF v_cat IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.categorias_terceirizado WHERE id = v_cat AND tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'Serviço inválido' USING ERRCODE = 'P0001';
    END IF;

    IF v_id IS NOT NULL THEN
      -- Linha EXISTENTE (por id): atualiza valor/obs/categoria; preserva `aprovado`. Só do próprio modelo.
      UPDATE public.modelo_servico_mo
         SET valor = v_valor, observacoes = v_obs, categoria_terceirizado_id = v_cat, updated_at = now()
       WHERE id = v_id AND modelo_id = _modelo_id AND tenant_id = v_tenant;
      IF FOUND THEN
        v_keep := array_append(v_keep, v_id);
      ELSE
        -- id não é deste modelo/tenant (payload inconsistente) — ignora silenciosamente (não vaza).
        CONTINUE;
      END IF;
    ELSE
      -- Linha NOVA (sem id): categoria real precisa estar ATIVA (soft-hide barra novo serviço).
      -- "Geral (legado)" (v_cat NULL) segue permitido como linha nova.
      IF v_cat IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.categorias_terceirizado WHERE id = v_cat AND tenant_id = v_tenant AND ativo = true
      ) THEN
        RAISE EXCEPTION 'Serviço desativado' USING ERRCODE = 'P0001';
      END IF;
      INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, observacoes)
      VALUES (v_tenant, _modelo_id, v_cat, v_valor, v_obs)
      RETURNING id INTO v_id;
      v_keep := array_append(v_keep, v_id);
    END IF;
  END LOOP;

  -- Estado completo: apaga as linhas do modelo cujo id NÃO veio no payload.
  DELETE FROM public.modelo_servico_mo
   WHERE modelo_id = _modelo_id
     AND NOT (id = ANY(v_keep));
END $function$;

-- ── 3) Aprovar: por `id` da instância (assinatura MUDA → dropar a antiga p/ evitar overload) ──────
DROP FUNCTION IF EXISTS public.aprovar_servico_mo(uuid, uuid, boolean, text);
DROP FUNCTION IF EXISTS public._aprovar_servico_mo_core(uuid, uuid, boolean, text);

CREATE OR REPLACE FUNCTION public._aprovar_servico_mo_core(_modelo_id uuid, _linha_id uuid, _aprovado boolean, _motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF _aprovado = false AND COALESCE(btrim(_motivo),'') = '' THEN
    RAISE EXCEPTION 'Informe o motivo da reprovação.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.modelo_servico_mo
     SET aprovado = _aprovado,
         motivo_reprovacao = CASE WHEN _aprovado THEN NULL ELSE _motivo END,
         updated_at = now()
   WHERE id = _linha_id
     AND modelo_id = _modelo_id
     AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha de mão de obra não encontrada.' USING ERRCODE = 'P0001';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.aprovar_servico_mo(_modelo_id uuid, _linha_id uuid, _aprovado boolean, _motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._aprovar_servico_mo_core(_modelo_id, _linha_id, _aprovado, _motivo);
END $function$;

-- EXECUTE do _core revogado (invariante #9); o wrapper continua acessível a authenticated.
REVOKE EXECUTE ON FUNCTION public._aprovar_servico_mo_core(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;

-- ── 4) Resumo: expõe `id` por linha (p/ aprovar por instância). Agregados INTACTOS. ─────────────
CREATE OR REPLACE FUNCTION public._modelo_mo_resumo_core(_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_ver boolean := public._pode_ver_custos();
  v_result jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  SELECT coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    'estado',
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM modelo_servico_mo s WHERE s.modelo_id = m.id) THEN 'sem_servico'
        WHEN EXISTS (SELECT 1 FROM modelo_servico_mo s WHERE s.modelo_id = m.id AND s.aprovado = false) THEN 'reprovada'
        WHEN EXISTS (SELECT 1 FROM modelo_servico_mo s WHERE s.modelo_id = m.id AND s.aprovado IS NULL) THEN 'pendente'
        ELSE 'aprovada'
      END,
    'total', CASE WHEN v_ver THEN coalesce((SELECT sum(s.valor) FROM modelo_servico_mo s WHERE s.modelo_id = m.id), 0) ELSE NULL END,
    'total_aprovado', CASE WHEN v_ver THEN coalesce((SELECT sum(s.valor) FROM modelo_servico_mo s WHERE s.modelo_id = m.id AND s.aprovado = true), 0) ELSE NULL END,
    'linhas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'categoria_terceirizado_id', s.categoria_terceirizado_id,
        'nome', COALESCE(ct.nome, 'Geral (legado)'),
        'valor', CASE WHEN v_ver THEN s.valor ELSE NULL END,
        'aprovado', s.aprovado,
        'motivo_reprovacao', s.motivo_reprovacao
      ) ORDER BY (s.categoria_terceirizado_id IS NOT NULL), ct.ordem, ct.nome, s.created_at, s.id)
      FROM modelo_servico_mo s
      LEFT JOIN categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id
      WHERE s.modelo_id = m.id
    ), '[]'::jsonb)
  )), '{}'::jsonb)
  INTO v_result
  FROM modelos m
  WHERE m.tenant_id = v_tenant AND m.id = ANY(_ids);
  RETURN v_result;
END $function$;

COMMIT;
