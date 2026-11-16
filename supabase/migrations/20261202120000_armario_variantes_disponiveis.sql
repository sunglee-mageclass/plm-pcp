-- F7 · Armario - Task C1, BANCO: RPC de LEITURA public.armario_variantes_disponiveis(_colecao_id, _subcolecao, _armario_id).
-- Plano: docs/superpowers/plans/2026-11-16-f7-armario.md (Task C1). Molde de leitura sem portao de pagina: opcoes_colecao_modelos
-- (20261103145000_bk_opcoes_colecao.sql). Depende das tabelas da A1 (armarios, armario_itens).
--
-- O dialog "adicionar variante" do Armario chama esta RPC: devolve os MINI-CARDS (1 por modelo da subcolecao) com as variantes
-- (produto x cor) compostas a partir das 3 ORIGENS, marcando quem esta "em desenvolvimento" (sem cor) e quem "ja esta em outro armario".
--
-- RETORNO (jsonb, ARRAY de mini-cards, ordenado por nome/id; sem modelos = []):
--   [{ "modelo_id": uuid, "nome": text, "ref": text|null, "foto_path": text|null, "origem": "interno"|"revenda"|"importado",
--      "em_desenvolvimento": bool,
--      "variantes": [{ "variante_tecido_id": uuid|null, "produto_variante_id": uuid|null, "cor_id": uuid, "cor_apelido_id": uuid|null,
--                      "cor_nome": text|null, "cor_apelido_nome": text|null, "ordem": int,
--                      "ja_em_outro": bool, "armarios_com": [{ "id": uuid, "nome": text }] }] }]
--   - ref   = ref oficial do card, senao ref_auto (mesma regra de EditarMixDialog: `ref ?? ref_auto`).
--   - foto_path = capa: 1o nao vazio de [fotos_modelo[1], desenho_tecnico_url, croqui_url] (ModeloFotoHover). Caminho do bucket `modelos`.
--   - em_desenvolvimento = a origem do modelo NAO tem NENHUMA variante com cor cadastrada (interno sem Tecido 1/variante; revenda/
--     importado sem linha em *_variantes). Nesse caso `variantes` = [] (o front nao deixa arrastar).
--   - ja_em_outro = EXISTS em armario_itens da MESMA loja com a TUPLA DE IDENTIDADE igual (modelo_id | variante_tecido_id |
--     produto_variante_id | cor_id | cor_apelido_id - IS NOT DISTINCT FROM; espelho de chaveVariante em src/lib/armario/variante-chave.ts),
--     em armario com id <> _armario_id (qualquer armario se _armario_id for NULL). CROSS-COLECAO de proposito (nao filtra por colecao).
--     armarios_com = os armarios (id, nome) onde ja esta, por ordem/nome.
--   - variante interna: ponteiro = variante_tecido_id (Tecido 1 do BOM: modelo_tecidos tipo 'tecido' numero 1 -> modelo_tecido_variantes
--     -> variantes_tecido; = variantesDoTecido1 de peca-teste-mini.ts); revenda/importado: ponteiro = produto_variante_id (id da linha de
--     produto_acabado_variantes / produto_importado_variantes do produto espelho do modelo; despacho = PRODUTO_POR_ORIGEM de useGradeComprado).
--     So entra variante com cor_id preenchido (sem cor = nao e "variante de cor").
--
-- FILTRO: modelos da loja do usuario com subcolecao = _subcolecao (texto; NULL e '' sao a mesma "sem subcolecao") e ROTULO da colecao
-- igual ao nome da colecao _colecao_id (mesma regra de _modelo_colecao_rotulo / rotuloColecao: nome da colecao do OTB pelo colecao_id,
-- senao o texto livre `colecao` com trim). _colecao_id NULL = modelos sem rotulo de colecao; _colecao_id inexistente na loja = [].
--
-- SEGURANCA: SECURITY DEFINER + SET search_path TO 'public'. Leitura: SEM gate de pagina (nem de modulo) - o dado e o que a RLS de SELECT
-- de modelos/produtos ja deixa o usuario ler. Confere LOGIN (auth.uid() nulo -> 42501 ASCII) e devolve SO modelos da loja ativa do usuario
-- (get_user_tenant_id(): loja inativa de nao-super = sentinela = []). Como e DEFINER (ignora RLS), TODA tabela lida e filtrada por tenant
-- explicitamente (modelos, produtos espelho, armarios, armario_itens). Sem `_core`: nao ha gate a separar (o REVOKE dos 3 vale p/ os
-- `_core` das RPCs de escrita, C2/C3). EXECUTE: revogado de PUBLIC e anon; authenticated (a tela chama) e service_role.
--
-- Trava: so catalogo (CREATE FUNCTION + GRANT/REVOKE). Nada em auth/storage/realtime; nenhuma policy/gatilho/tabela. Idempotente.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
-- Volta: supabase/rollback/20261202120000_armario_variantes_disponiveis_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
BEGIN
  IF to_regclass('public.armarios') IS NULL OR to_regclass('public.armario_itens') IS NULL THEN
    RAISE EXCEPTION 'armario_c1_dep: tabelas armarios/armario_itens ausentes (aplicar a A1 antes)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_user_tenant_id()')
                  AND p.prosecdef AND p.prorettype = 'uuid'::regtype) THEN
    RAISE EXCEPTION 'armario_c1_dep: get_user_tenant_id() ausente ou diferente (DEFINER, uuid)' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 'armario_c1_pos: funcao ausente' USING ERRCODE = 'P0001';
  END IF;
  SELECT p.prosecdef, p.proconfig, p.provolatile, p.prorettype INTO v_p FROM pg_proc p WHERE p.oid = v_oid;
  IF NOT v_p.prosecdef OR v_p.proconfig IS DISTINCT FROM ARRAY['search_path=public']
     OR v_p.provolatile <> 's' OR v_p.prorettype <> 'jsonb'::regtype THEN
    RAISE EXCEPTION 'armario_c1_pos: secdef % config % volatil % (esperado t, {search_path=public}, s)',
      v_p.prosecdef, v_p.proconfig, v_p.provolatile USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_oid AND a.grantee = 0) THEN
    RAISE EXCEPTION 'armario_c1_pos: grants errados (%)', (SELECT proacl::text FROM pg_proc WHERE oid = v_oid)
      USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
