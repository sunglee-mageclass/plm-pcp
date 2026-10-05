-- Inverso NEUTRO de supabase/migrations/20261103180000_urg_r4_mo_fornecedor.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-b.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-b.md (Task 1 / R4a; Rulings 1 e 2).
-- NEUTRO: devolve os 3 textos de ANTES (md5 conferido; ja ANTES = no-op idempotente). A coluna empresa_id FICA (inerte:
-- ninguem le nem grava). Remover de fato = _down_drop (opcional, depois, horario calmo, site ja voltado). So catalogo.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._salvar_modelo_servico_mo_core(uuid,jsonb)
--     ANTES  540d04a79171518731a1b084c7976cb7
--     DEPOIS 4d13d632ae2c5b931632e93536ae2ddd
--   public.enforce_servico_mo_aprovacao()
--     ANTES  a2115ce0538b76b7cbe1740a6227bd2e
--     DEPOIS 1643b69db26e2034905866356b80232e
--   public._modelo_mo_resumo_core(uuid[])
--     ANTES  13b124236df405b9b3843da7a6071b63
--     DEPOIS f1bdb88458e469eb24c3e6f58b3ce870
-- ====================================================================================
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._salvar_modelo_servico_mo_core(uuid,jsonb)', '540d04a79171518731a1b084c7976cb7', '4d13d632ae2c5b931632e93536ae2ddd'),
      ('public.enforce_servico_mo_aprovacao()', 'a2115ce0538b76b7cbe1740a6227bd2e', '1643b69db26e2034905866356b80232e'),
      ('public._modelo_mo_resumo_core(uuid[])', '13b124236df405b9b3843da7a6071b63', 'f1bdb88458e469eb24c3e6f58b3ce870')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'urg_r4a_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

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

CREATE OR REPLACE FUNCTION public.enforce_servico_mo_aprovacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reaberta boolean := false;  -- [contas-certas 8]
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.aprovado IS NOT NULL AND NOT public.user_can_edit('producao_servico_aprovacao') THEN
      RAISE EXCEPTION 'Sem permissão para aprovar/reprovar o custo de mão de obra' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- [contas-certas 8] P-163 A (+ ruling: vale tambem p/ a REPROVADA): linha ja decidida (aprovada ou reprovada)
    -- que muda de VALOR ou de SERVICO volta a PENDENTE (aprovado NULL, motivo limpo) - precisa aprovar de novo.
    -- Voltar a pendente nunca e escalada: por isso o teste de permissao abaixo nao vale neste caso (v_reaberta).
    -- Mudanca que tambem mexe em `aprovado` (so via aprovar_servico_mo) nao entra aqui.
    IF NEW.aprovado IS NOT DISTINCT FROM OLD.aprovado AND OLD.aprovado IS NOT NULL
       AND (NEW.valor IS DISTINCT FROM OLD.valor
            OR NEW.categoria_terceirizado_id IS DISTINCT FROM OLD.categoria_terceirizado_id) THEN
      NEW.aprovado := NULL;
      NEW.motivo_reprovacao := NULL;
      v_reaberta := true;
    END IF;
    IF NOT v_reaberta AND NEW.aprovado IS DISTINCT FROM OLD.aprovado
       AND NOT public.user_can_edit('producao_servico_aprovacao') THEN
      RAISE EXCEPTION 'Sem permissão para aprovar/reprovar o custo de mão de obra' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

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

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._salvar_modelo_servico_mo_core(uuid,jsonb)', '540d04a79171518731a1b084c7976cb7', '{postgres=X/postgres,service_role=X/postgres}'),
      ('public.enforce_servico_mo_aprovacao()', 'a2115ce0538b76b7cbe1740a6227bd2e', '{postgres=X/postgres,service_role=X/postgres}'),
      ('public._modelo_mo_resumo_core(uuid[])', '13b124236df405b9b3843da7a6071b63', '{postgres=X/postgres,service_role=X/postgres}')
    ) AS x(f, m, acl) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r4a_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r4a_down: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
