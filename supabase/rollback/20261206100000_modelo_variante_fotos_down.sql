-- Volta da FOTO POR VARIANTE (F7 Armario): DROP das 2 RPCs novas + DROP TABLE modelo_variante_fotos (guarda de confirmacao se
-- tiver dado) + RESTAURA armario_variantes_disponiveis(uuid) ao corpo do 31o deploy (ano/mes), md5 a37fdd555c684487f6c2df22ce41f838.
-- Rodar com o SITE ja voltado (o front novo chama as RPCs novas e le o 'foto_path' por variante; o corpo restaurado volta a
-- devolver a CAPA do modelo por variante, que e exatamente o comportamento pre-foto). Idempotente.
--
-- GUARDA DE DADO: se modelo_variante_fotos tiver linhas, o DROP TABLE exige confirmacao explicita (defina
--   \set mvf_confirmar_drop 1  ANTES do \i) — evita apagar fotos ja cadastradas sem intencao. Sem linhas: dropa direto.
-- Aplicar fora de transacao: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 [-v mvf_confirmar_drop=1] -f <arquivo>.
SET client_encoding = 'UTF8';
\if :{?mvf_confirmar_drop}
\else
\set mvf_confirmar_drop 0
\endif
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL transaction_timeout = '30s';
-- psql substitui :var SO fora de bloco dollar-quoted: passa a confirmacao para uma GUC lida com current_setting dentro dos DO.
SELECT set_config('mvf.confirmar_drop', :'mvf_confirmar_drop', true);

DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.armario_variantes_disponiveis(uuid)') IS NULL THEN
    RAISE EXCEPTION 'mvf_down_dep: armario_variantes_disponiveis(uuid) ausente' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._grupo_eh_acessorio(uuid)') IS NULL THEN
    RAISE EXCEPTION 'mvf_down_dep: _grupo_eh_acessorio(uuid) ausente' USING ERRCODE = 'P0001';
  END IF;
  -- so restaura se o corpo vivo for o DESTA frente (27d69302...) ou ja o restaurado (a37fdd55) = idempotente
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.armario_variantes_disponiveis(uuid)');
  IF v_md5 NOT IN ('27d69302b434b5ea4fbbdbc95cc4a4a3', 'a37fdd555c684487f6c2df22ce41f838') THEN
    RAISE EXCEPTION 'mvf_down_dep: corpo vivo de armario_variantes_disponiveis(uuid) inesperado (md5 %)', v_md5 USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- ── DROP das RPCs novas ────────────────────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.modelo_variante_foto_salvar(uuid, uuid, uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public._modelo_variante_foto_salvar_core(uuid, uuid, uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.modelo_variante_fotos_listar(uuid);

-- ── DROP TABLE (guarda de confirmacao se tiver dado) ───────────────────────────────────────────────────────────────
DO $drop$
DECLARE
  v_n bigint := 0;
BEGIN
  IF to_regclass('public.modelo_variante_fotos') IS NULL THEN
    RETURN;  -- ja removida
  END IF;
  SELECT count(*) INTO v_n FROM public.modelo_variante_fotos;
  IF v_n > 0 AND coalesce(current_setting('mvf.confirmar_drop', true), '0') <> '1' THEN
    RAISE EXCEPTION 'mvf_down_tem_dado: modelo_variante_fotos tem % linha(s); rode com -v mvf_confirmar_drop=1 para apagar', v_n USING ERRCODE = 'P0001';
  END IF;
  DROP TABLE public.modelo_variante_fotos;
END
$drop$;

-- ── RESTAURA armario_variantes_disponiveis(uuid) ao corpo a37fdd55 (byte-a-byte do 31o deploy) ─────────────────────
CREATE OR REPLACE FUNCTION public.armario_variantes_disponiveis(_armario_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_res    jsonb;
BEGIN
  -- [F7 armario ANO/MES] LEITURA: so confere login + loja; sem gate de pagina/modulo (leitura segue RLS/loja). TODAS as colecoes da loja.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'armario_nao_autenticado' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();

  WITH mods AS (
    SELECT m.id, m.nome::text AS nome, m.origem,
           coalesce(nullif(btrim(m.ref), ''), m.ref_auto) AS ref,
           coalesce(nullif(m.fotos_modelo[1], ''), nullif(m.desenho_tecnico_url, ''), nullif(m.croqui_url, '')) AS foto,
           m.categoria_principal_id, m.subcategoria1_id, m.linha_id, m.status_planejamento::text AS status_planejamento,
           m.mes_id, m.ano_id,
           -- faceta Colecao (rotulo): nome da colecao do OTB, senao o texto livre; vazio = null. Faceta Subcolecao: o texto do modelo.
           coalesce((SELECT c.nome::text FROM public.colecoes c WHERE c.id = m.colecao_id AND c.tenant_id = m.tenant_id),
                    nullif(btrim(coalesce(m.colecao, '')), '')) AS colecao_nome,
           nullif(btrim(coalesce(m.subcolecao, '')), '') AS subcolecao
      FROM public.modelos m
     WHERE m.tenant_id = v_tenant
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
           'variantes',          coalesce(j.variantes, '[]'::jsonb),
           -- facetas p/ os filtros do dialog: colecao/subcolecao/periodo + categoria/sub1/grupo(+Acessorios)/linha/status
           'colecao_nome',           mo.colecao_nome,
           'subcolecao',             mo.subcolecao,
           'categoria_principal_id', mo.categoria_principal_id,
           'categoria_nome',         cp.nome::text,
           'subcategoria1_id',       mo.subcategoria1_id,
           'subcategoria1_nome',     s1.nome::text,
           'grupo_id',               cp.grupo_id,
           'grupo_nome',             g.nome::text,
           'eh_acessorio',           coalesce(public._grupo_eh_acessorio(g.id), false),
           'linha_id',               mo.linha_id,
           'linha_nome',             li.nome::text,
           'status_planejamento',    mo.status_planejamento,
           'mes_id',                 mo.mes_id,
           'mes_nome',               me.mes::text,
           'mes_ordem',              me.ordem,
           'ano_id',                 mo.ano_id,
           'ano',                    an.ano
         ) ORDER BY mo.nome, mo.id), '[]'::jsonb)
    INTO v_res
    FROM mods mo
    LEFT JOIN v_json j ON j.modelo_id = mo.id
    -- todo join de apoio filtrado pela loja (a RPC e DEFINER: ignora RLS); grupo derivado via categoria (modelos nao tem grupo_id)
    LEFT JOIN public.categorias_produto     cp ON cp.id = mo.categoria_principal_id AND cp.tenant_id = v_tenant
    LEFT JOIN public.subcategorias1_produto s1 ON s1.id = mo.subcategoria1_id       AND s1.tenant_id = v_tenant
    LEFT JOIN public.grupos_produto         g  ON g.id  = cp.grupo_id               AND g.tenant_id  = v_tenant
    LEFT JOIN public.linhas                 li ON li.id = mo.linha_id               AND li.tenant_id = v_tenant
    LEFT JOIN public.meses                  me ON me.id = mo.mes_id                 AND me.tenant_id = v_tenant
    LEFT JOIN public.anos                   an ON an.id = mo.ano_id                 AND an.tenant_id = v_tenant;

  RETURN v_res;
END;
$function$;

-- ── ACL do corpo restaurado (igual ao 31o deploy) ─────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.armario_variantes_disponiveis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.armario_variantes_disponiveis(uuid)  TO authenticated, service_role;

DO $pos$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.armario_variantes_disponiveis(uuid)');
  IF v_md5 <> 'a37fdd555c684487f6c2df22ce41f838' THEN
    RAISE EXCEPTION 'mvf_down_pos: restauracao de armario_variantes_disponiveis divergiu (md5 %)', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.modelo_variante_fotos') IS NOT NULL AND coalesce(current_setting('mvf.confirmar_drop', true), '0') <> '1' THEN
    RAISE EXCEPTION 'mvf_down_pos: tabela ainda presente' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
