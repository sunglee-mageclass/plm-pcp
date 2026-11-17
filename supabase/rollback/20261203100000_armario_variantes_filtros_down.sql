-- Volta da F7 Armario - Melhorias T4: reemite armario_variantes_disponiveis SEM os campos de filtro (corpo do deploy do Armario, 20261202120000).
-- Seguro rodar com o front novo ainda no ar? O front T5 le os campos novos: rodar com o SITE ja voltado. Idempotente.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v_oid oid := to_regprocedure('public.armario_variantes_disponiveis(uuid,text,uuid)');
  v_md5 text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'armario_filtros_down_dep: armario_variantes_disponiveis ausente (aplicar 20261202120000 antes)' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._grupo_eh_acessorio(uuid)') IS NULL THEN
    RAISE EXCEPTION 'armario_filtros_down_dep: _grupo_eh_acessorio(uuid) ausente' USING ERRCODE = 'P0001';
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = v_oid;
  -- so reemite se o corpo vivo e o do deploy do Armario (md5 bb4e9e646f555c6fc9c9fc18286ff060) ou ja o desta migration (85bdc5cabf90c87c951a12a7f8aae310); deriva = aborta.
  IF v_md5 NOT IN ('bb4e9e646f555c6fc9c9fc18286ff060', '85bdc5cabf90c87c951a12a7f8aae310') THEN
    RAISE EXCEPTION 'armario_filtros_down_dep: corpo vivo de armario_variantes_disponiveis difere do esperado (md5 %)', v_md5 USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.armario_variantes_disponiveis(_colecao_id uuid, _subcolecao text, _armario_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_nome   text;
  v_res    jsonb;
BEGIN
  -- [F7 armario C1] LEITURA: so confere login + loja; sem gate de pagina/modulo (decisao do plano: leitura segue RLS/loja).
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'armario_nao_autenticado' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();

  IF _colecao_id IS NOT NULL THEN
    SELECT c.nome::text INTO v_nome FROM public.colecoes c WHERE c.id = _colecao_id AND c.tenant_id = v_tenant;
    IF v_nome IS NULL THEN
      RETURN '[]'::jsonb; -- colecao de outra loja / inexistente: nada (nao cai no "sem colecao")
    END IF;
  END IF;

  WITH mods AS (
    SELECT m.id, m.nome::text AS nome, m.origem,
           coalesce(nullif(btrim(m.ref), ''), m.ref_auto) AS ref,
           coalesce(nullif(m.fotos_modelo[1], ''), nullif(m.desenho_tecnico_url, ''), nullif(m.croqui_url, '')) AS foto
      FROM public.modelos m
     WHERE m.tenant_id = v_tenant
       AND coalesce(m.subcolecao, '') = coalesce(_subcolecao, '')
       AND coalesce((SELECT c.nome::text FROM public.colecoes c WHERE c.id = m.colecao_id AND c.tenant_id = m.tenant_id),
                    nullif(btrim(coalesce(m.colecao, '')), '')) IS NOT DISTINCT FROM v_nome
  ),
  v_int AS (
    -- INTERNO = variantes do Tecido 1 do BOM (tipo 'tecido', numero 1); 1 por variante_tecido (menor ordem)
    SELECT DISTINCT ON (mo.id, vt.id)
           mo.id AS modelo_id, vt.id AS variante_tecido_id, NULL::uuid AS produto_variante_id,
           vt.cor_id, vt.cor_apelido_id, mtv.ordem
      FROM mods mo
      JOIN LATERAL (SELECT mt.id FROM public.modelo_tecidos mt
                     WHERE mt.modelo_id = mo.id AND mt.tipo = 'tecido' AND mt.numero = 1
                     ORDER BY mt.created_at, mt.id LIMIT 1) t1 ON true
      JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = t1.id
      JOIN public.variantes_tecido vt ON vt.id = mtv.variante_tecido_id
     WHERE mo.origem NOT IN ('revenda', 'importado') AND vt.cor_id IS NOT NULL
     ORDER BY mo.id, vt.id, mtv.ordem
  ),
  v_rev AS (
    SELECT mo.id AS modelo_id, NULL::uuid AS variante_tecido_id, pav.id AS produto_variante_id,
           pav.cor_id, pav.cor_apelido_id, pav.ordem
      FROM mods mo
      JOIN public.produtos_acabados pa ON pa.modelo_id = mo.id AND pa.tenant_id = v_tenant
      JOIN public.produto_acabado_variantes pav ON pav.produto_acabado_id = pa.id AND pav.tenant_id = v_tenant
     WHERE mo.origem = 'revenda' AND pav.cor_id IS NOT NULL
  ),
  v_imp AS (
    SELECT mo.id AS modelo_id, NULL::uuid AS variante_tecido_id, piv.id AS produto_variante_id,
           piv.cor_id, piv.cor_apelido_id, piv.ordem
      FROM mods mo
      JOIN public.produtos_importados pi ON pi.modelo_id = mo.id AND pi.tenant_id = v_tenant
      JOIN public.produto_importado_variantes piv ON piv.produto_importado_id = pi.id AND piv.tenant_id = v_tenant
     WHERE mo.origem = 'importado' AND piv.cor_id IS NOT NULL
  ),
  v_all AS (
    SELECT * FROM v_int UNION ALL SELECT * FROM v_rev UNION ALL SELECT * FROM v_imp
  ),
  v_json AS (
    SELECT v.modelo_id,
           jsonb_agg(jsonb_build_object(
             'variante_tecido_id',  v.variante_tecido_id,
             'produto_variante_id', v.produto_variante_id,
             'cor_id',              v.cor_id,
             'cor_apelido_id',      v.cor_apelido_id,
             'cor_nome',            (SELECT c.nome::text FROM public.cores c WHERE c.id = v.cor_id),
             'cor_apelido_nome',    (SELECT ca.nome::text FROM public.cores_apelido ca WHERE ca.id = v.cor_apelido_id),
             'ordem',               v.ordem,
             'ja_em_outro',         x.com <> '[]'::jsonb,
             'armarios_com',        x.com
           ) ORDER BY v.ordem, v.variante_tecido_id, v.produto_variante_id) AS variantes
      FROM v_all v
      CROSS JOIN LATERAL (
        -- tupla de identidade igual (espelho de chaveVariante), CROSS-colecao, mesma loja, armario <> o atual
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'nome', q.nome) ORDER BY q.ordem, q.nome, q.id), '[]'::jsonb) AS com
          FROM (SELECT DISTINCT a.id, a.nome::text AS nome, a.ordem
                  FROM public.armario_itens ai
                  JOIN public.armarios a ON a.id = ai.armario_id AND a.tenant_id = v_tenant
                 WHERE ai.tenant_id = v_tenant
                   AND ai.modelo_id = v.modelo_id
                   AND ai.variante_tecido_id  IS NOT DISTINCT FROM v.variante_tecido_id
                   AND ai.produto_variante_id IS NOT DISTINCT FROM v.produto_variante_id
                   AND ai.cor_id              IS NOT DISTINCT FROM v.cor_id
                   AND ai.cor_apelido_id      IS NOT DISTINCT FROM v.cor_apelido_id
                   AND (_armario_id IS NULL OR a.id <> _armario_id)) q
      ) x
     GROUP BY v.modelo_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'modelo_id',          mo.id,
           'nome',               mo.nome,
           'ref',                mo.ref,
           'foto_path',          mo.foto,
           'origem',             mo.origem,
           'em_desenvolvimento', j.variantes IS NULL,
           'variantes',          coalesce(j.variantes, '[]'::jsonb)
         ) ORDER BY mo.nome, mo.id), '[]'::jsonb)
    INTO v_res
    FROM mods mo
    LEFT JOIN v_json j ON j.modelo_id = mo.id;

  RETURN v_res;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.armario_variantes_disponiveis(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.armario_variantes_disponiveis(uuid, text, uuid) TO authenticated, service_role;

DO $pos$
DECLARE
  v_oid oid := to_regprocedure('public.armario_variantes_disponiveis(uuid,text,uuid)');
  v_p record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'armario_filtros_pos: funcao ausente' USING ERRCODE = 'P0001';
  END IF;
  SELECT p.prosecdef, p.proconfig, p.provolatile, p.prorettype INTO v_p FROM pg_proc p WHERE p.oid = v_oid;
  IF NOT v_p.prosecdef OR v_p.proconfig IS DISTINCT FROM ARRAY['search_path=public']
     OR v_p.provolatile <> 's' OR v_p.prorettype <> 'jsonb'::regtype THEN
    RAISE EXCEPTION 'armario_filtros_pos: secdef % config % volatil % (esperado t, {search_path=public}, s)',
      v_p.prosecdef, v_p.proconfig, v_p.provolatile USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_oid AND a.grantee = 0) THEN
    RAISE EXCEPTION 'armario_filtros_pos: grants errados (%)', (SELECT proacl::text FROM pg_proc WHERE oid = v_oid)
      USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
