-- Integração > Produtos: "Versão de produto já integrado" (P-156 C + R7; T5 da frente Preço anterior e Título por versão —
-- plano .superpowers/sdd/2026-09-30-preco-anterior/plan.md §3.2/§6). GERADA por
-- .superpowers/sdd/2026-09-30-preco-anterior/mig/gerar_t5.py (função nova escrita à mão — não editar aqui).
-- • RPC só-leitura integracao_versoes_integradas(uuid[]) -> jsonb: para cada card da loja, a versão MENOR mais alta da
--   família que já está Integrável/Integrada + a comparação de variantes (iguais / novas / saíram) com o RETRATO que ela
--   enviou ao ERP. DEFINER + _integracao_exige(false) (R7a) + teto de 500 ids + REVOKE PUBLIC/anon (só authenticated).
-- • Sem dado: o inverso é só DROP FUNCTION. LIFO: o inverso desta roda ANTES do inverso da 20261018100000.
-- Aplicar fora de transação (psql -v ON_ERROR_STOP=1 -f), DEPOIS da 20261018100000.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.integracao_versoes_integradas(uuid[])')));
  IF v IS NOT NULL AND v <> '8576ce537ede3ebbf041f6f6739f475a' THEN
    RAISE EXCEPTION 'versao_integrada: integracao_versoes_integradas com texto inesperado (md5 %) - outra frente mexeu; gere de novo', v
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._integracao_exige(boolean)') IS NULL OR to_regprocedure('public._skus_calc_ref_tipo(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'versao_integrada: a Integracao (_integracao_exige) e o SKU (_skus_calc_ref_tipo) precisam estar no banco' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.integracao_versoes_integradas(_modelo_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);
  v_out jsonb := '[]'::jsonb;
  v_a jsonb;
  v_b jsonb;
  r record;
BEGIN
  -- [versao-integrada v1] P-156 C + R7 (T5 da frente Preço anterior/Título por versão). SÓ LEITURA. Para cada id DA LOJA,
  -- a MAIOR versão MENOR da família (mesma loja; desempate created_at mais novo, depois id — a regra da P-149 A) que está
  -- Integrável/Integrada (R7b: qualquer versão menor, mostra a mais alta). Variantes da versão integrada = o RETRATO
  -- GRAVADO (o que o ERP recebeu): variante_key das linhas tipo 'variante'; nomes = valores.cor_base/cor_apelido do retrato
  -- quando marcados, senão a matriz viva da vN (_skus_calc_ref_tipo — a vN está travada), senão NULL. Variantes deste card
  -- = a MESMA fonte das sublinhas da Integração (_skus_calc_ref_tipo). iguais = A∩B, novas = B−A, saíram = A−B, pela
  -- variante_key (cor base + apelido). Gate = _integracao_exige(false) (R7a, igual a integracao_listar). Teto 500 ids.
  IF coalesce(cardinality(_modelo_ids), 0) > 500 THEN
    RAISE EXCEPTION 'versoes_integradas: limite de 500 ids' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN
    SELECT DISTINCT ON (a.id)
           a.id AS alvo_id, a.ref AS alvo_ref, a.tamanho_tipo AS alvo_tipo,
           p.id AS ant_id, p.versao AS ant_versao, p.ref AS ant_ref, p.tamanho_tipo AS ant_tipo,
           ip.estado AS ant_estado, ip.marcado_em AS ant_marcado_em, ip.integrado_em AS ant_integrado_em, ip.retrato AS ant_retrato
      FROM public.modelos a
      JOIN public.modelos p
        ON p.tenant_id = a.tenant_id
       AND (p.id = coalesce(a.modelo_base_id, a.id) OR p.modelo_base_id = coalesce(a.modelo_base_id, a.id))
       AND p.id <> a.id AND p.versao < a.versao
      JOIN public.integracao_produtos ip
        ON ip.modelo_id = p.id AND ip.tenant_id = a.tenant_id AND ip.estado IN ('integravel', 'integrado')
     WHERE a.id = ANY(_modelo_ids) AND a.tenant_id = v_tenant
     ORDER BY a.id, p.versao DESC, p.created_at DESC NULLS LAST, p.id DESC
  LOOP
    WITH ret AS (
      SELECT DISTINCT ON (e.l ->> 'variante_key')
             (e.l ->> 'variante_key')::uuid AS k, e.l -> 'valores' AS v, e.n
        FROM jsonb_array_elements(coalesce(r.ant_retrato -> 'linhas', '[]'::jsonb)) WITH ORDINALITY AS e(l, n)
       WHERE e.l ->> 'tipo' = 'variante' AND e.l ->> 'variante_key' IS NOT NULL
       ORDER BY e.l ->> 'variante_key', e.n
    ), viva AS (
      SELECT DISTINCT ON (s.variante_key) s.variante_key AS k, s.cor_nome, s.apelido_nome
        FROM public._skus_calc_ref_tipo(r.ant_id, r.ant_ref, coalesce(r.ant_tipo, 'letra')) s
       ORDER BY s.variante_key, s.variante_ordem NULLS LAST
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'variante_key', ret.k,
             'cor_nome', CASE WHEN ret.v ? 'cor_base' THEN ret.v ->> 'cor_base' ELSE viva.cor_nome END,
             'apelido_nome', CASE WHEN ret.v ? 'cor_apelido' THEN ret.v ->> 'cor_apelido' ELSE viva.apelido_nome END)
             ORDER BY ret.n), '[]'::jsonb)
      INTO v_a
      FROM ret
      LEFT JOIN viva ON viva.k = ret.k;
    SELECT coalesce(jsonb_agg(jsonb_build_object('variante_key', x.variante_key, 'cor_nome', x.cor_nome, 'apelido_nome', x.apelido_nome)
             ORDER BY x.variante_ordem NULLS LAST, x.variante_key), '[]'::jsonb)
      INTO v_b
      FROM (SELECT DISTINCT ON (s.variante_key) s.variante_key, s.variante_ordem, s.cor_nome, s.apelido_nome
              FROM public._skus_calc_ref_tipo(r.alvo_id, r.alvo_ref, coalesce(r.alvo_tipo, 'letra')) s
             ORDER BY s.variante_key, s.variante_ordem NULLS LAST) x;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'modelo_id', r.alvo_id,
      'anterior_id', r.ant_id,
      'anterior_versao', r.ant_versao,
      'anterior_estado', r.ant_estado,
      'anterior_marcado_em', r.ant_marcado_em,
      'anterior_integrado_em', r.ant_integrado_em,
      'iguais', (SELECT coalesce(jsonb_agg(b.x ORDER BY b.n), '[]'::jsonb)
                   FROM jsonb_array_elements(v_b) WITH ORDINALITY AS b(x, n)
                  WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_a) AS a(x) WHERE a.x ->> 'variante_key' = b.x ->> 'variante_key')),
      'novas', (SELECT coalesce(jsonb_agg(b.x ORDER BY b.n), '[]'::jsonb)
                  FROM jsonb_array_elements(v_b) WITH ORDINALITY AS b(x, n)
                 WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_a) AS a(x) WHERE a.x ->> 'variante_key' = b.x ->> 'variante_key')),
      'sairam', (SELECT coalesce(jsonb_agg(a.x ORDER BY a.n), '[]'::jsonb)
                   FROM jsonb_array_elements(v_a) WITH ORDINALITY AS a(x, n)
                  WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_b) AS b(x) WHERE b.x ->> 'variante_key' = a.x ->> 'variante_key'))));
  END LOOP;
  RETURN v_out;
END
$function$
;

REVOKE ALL ON FUNCTION public.integracao_versoes_integradas(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integracao_versoes_integradas(uuid[]) TO authenticated;

DO $pos$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.integracao_versoes_integradas(uuid[])')));
  IF v IS DISTINCT FROM '8576ce537ede3ebbf041f6f6739f475a' THEN
    RAISE EXCEPTION 'versao_integrada: pos-condicao - md5 %', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.integracao_versoes_integradas(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.integracao_versoes_integradas(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'versao_integrada: pos-condicao - ACL' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
