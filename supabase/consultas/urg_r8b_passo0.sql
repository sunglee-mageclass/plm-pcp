-- urg_r8b_passo0.sql — PASSO 0 SÓ-LEITURA da urg R8b, ANTES da ida 20261103191000_urg_r8_titulo_sublinha_reprocesso (P-303 A).
-- A ida refaz SÓ o título das sublinhas dos produtos INTEGRÁVEIS cujo retrato não é v=4 (todos ganham v=4 + rev + 1 Log, mesmo sem
-- "titulo" marcado); INTEGRADOS ficam intocados. Uma linha por LOJA que tem integrável/integrado:
--   integraveis_por_v / integrados_por_v   {v: n} (v "null" = retrato sem marcador)
--   a_reprocessar                          integráveis com v<>4 nesta loja (teto da ida: 1000 NO BANCO TODO — total_a_reprocessar)
--   integrados                             anote: depois da ida tem de ser o MESMO número (intocados)
--   aborta_retrato_invalido                integrável com retrato sem linhas/campos, OU v<>4 que não é 2/3 (v=1, sem v…)
--   aborta_variante_ausente                integrável v<>4 com "titulo" marcado cuja sublinha precisa da cor VIVA (P-129: o campo de cor
--                                          que entra no título não está no retrato) e a variante_key NÃO acha mais a variante no
--                                          cadastro (3 origens — o MESMO SELECT da ida/release 4)
--   aborta_titulo_api                      integrável cujas linhas da API (integracao_linhas) não batem com o retrato DEPOIS da ida:
--                                          contagem diferente, linha faltando, ou título ≠ retrato numa linha que a ida NÃO reescreve
--                                          (a ida só reescreve as sublinhas dos v<>4 com "titulo" marcado)
--   modelos_que_abortam                    os modelo_id dos 3 casos acima (para o dono corrigir ANTES da janela)
--   total_aborta                           Σ no banco todo — regra do kit: total_aborta > 0 OU total_a_reprocessar > 1000 → PARE
--                                          ANTES da janela (a ida recusaria inteira, P0001, nada muda — mas a janela se perde)
--   backup_ausente                         true = a 191000 nunca rodou neste banco; false = já rodou (reaplicar = 0)
-- Cópia 54422/copia2 (05/out): 1 linha — Loja Teste, 0 integráveis, 2 integrados v=3; total_aborta 0.
-- Funciona ANTES e DEPOIS da ida. Regras do arquivo (embutível pelo psql): um único SELECT, SEM ponto e vírgula, sem meta-comando.
-- Roda como o dono das funções (postgres): chama _integracao_cor_no_nome/_sku_variante_key (EXECUTE revogado de authenticated).
WITH ip AS (
  SELECT p.tenant_id, p.modelo_id, p.estado, p.retrato, coalesce(p.retrato ->> 'v', 'null') AS v,
         (p.retrato IS NULL OR jsonb_typeof(p.retrato -> 'linhas') IS DISTINCT FROM 'array'
          OR jsonb_typeof(p.retrato -> 'campos') IS DISTINCT FROM 'array') AS estrutura_ruim
    FROM public.integracao_produtos p
   WHERE p.estado IN ('integravel', 'integrado')
), alvo AS (
  -- integráveis que a ida reprocessa (v<>4) e cuja estrutura ela consegue ler
  SELECT ip.tenant_id, ip.modelo_id, ip.retrato,
         ARRAY(SELECT jsonb_array_elements_text(ip.retrato -> 'campos')) AS campos,
         public._integracao_cor_no_nome((SELECT tc.sku_config FROM public.tenant_config tc WHERE tc.tenant_id = ip.tenant_id)) AS modo,
         coalesce((SELECT m.origem FROM public.modelos m WHERE m.id = ip.modelo_id), 'interno') AS origem
    FROM ip
   WHERE ip.estado = 'integravel' AND ip.v <> '4' AND NOT ip.estrutura_ruim AND ip.v IN ('2', '3')
), invalido AS (
  SELECT ip.tenant_id, ip.modelo_id FROM ip
   WHERE ip.estado = 'integravel' AND (ip.estrutura_ruim OR (ip.v <> '4' AND ip.v NOT IN ('2', '3')))
), variante_ausente AS (
  SELECT DISTINCT a.tenant_id, a.modelo_id
    FROM alvo a
   CROSS JOIN LATERAL jsonb_array_elements(a.retrato -> 'linhas') AS e(l)
   WHERE 'titulo' = ANY (a.campos)
     AND e.l ->> 'tipo' = 'variante'
     AND (e.l ->> 'variante_key')::uuid IS DISTINCT FROM public._sku_variante_key(NULL::uuid, NULL::uuid)
     AND (CASE WHEN a.modo = 'cor_apelido'
               THEN NOT ('cor_apelido' = ANY (a.campos))
                    OR (nullif(btrim(e.l -> 'valores' ->> 'cor_apelido'), '') IS NULL AND NOT ('cor_base' = ANY (a.campos)))
               ELSE NOT ('cor_base' = ANY (a.campos)) END)
     AND NOT EXISTS (
       SELECT 1
         FROM (SELECT vt.cor_id AS vcor, vt.cor_apelido_id AS vapelido
                 FROM public.modelo_tecidos mt
                 JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = mt.id
                 JOIN public.variantes_tecido vt ON vt.id = mtv.variante_tecido_id
                WHERE a.origem = 'interno' AND mt.modelo_id = a.modelo_id AND mt.tipo = 'tecido' AND mt.numero = 1
               UNION ALL
               SELECT pv.cor_id, pv.cor_apelido_id
                 FROM public.produtos_acabados pa
                 JOIN public.produto_acabado_variantes pv ON pv.produto_acabado_id = pa.id
                WHERE a.origem = 'revenda' AND pa.modelo_id = a.modelo_id
               UNION ALL
               SELECT iv.cor_id, iv.cor_apelido_id
                 FROM public.produtos_importados pi
                 JOIN public.produto_importado_variantes iv ON iv.produto_importado_id = pi.id
                WHERE a.origem = 'importado' AND pi.modelo_id = a.modelo_id) AS va
        WHERE public._sku_variante_key(va.vcor, va.vapelido) = (e.l ->> 'variante_key')::uuid)
), titulo_api AS (
  SELECT ip.tenant_id, ip.modelo_id
    FROM ip
   WHERE ip.estado = 'integravel'
     -- CASE: o Postgres não garante a ordem do AND; retrato sem linhas já conta em aborta_retrato_invalido
     AND CASE WHEN ip.estrutura_ruim THEN false ELSE
         ((SELECT count(*) FROM public.integracao_linhas il WHERE il.modelo_id = ip.modelo_id) <> jsonb_array_length(ip.retrato -> 'linhas')
          OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements(ip.retrato -> 'linhas') AS e(x)
              LEFT JOIN public.integracao_linhas il ON il.modelo_id = ip.modelo_id AND il.ordem = (e.x ->> 'ordem')::integer
             WHERE il.id IS NULL
                OR (CASE WHEN e.x ->> 'tipo' = 'variante' AND ip.v <> '4' AND ip.v IN ('2', '3') AND ip.retrato -> 'campos' ? 'titulo'
                         -- a ida reescreve esta sublinha (UPDATE … AND tipo = 'variante', ROW_COUNT = 1 obrigatório)
                         THEN il.tipo IS DISTINCT FROM 'variante'
                         ELSE il.titulo IS DISTINCT FROM e.x -> 'valores' ->> 'titulo' END))) END
), por_loja AS (
  SELECT t.tenant_id,
         (SELECT jsonb_object_agg(x.v, x.n) FROM (SELECT v, count(*) AS n FROM ip WHERE ip.tenant_id = t.tenant_id
                                                     AND estado = 'integravel' GROUP BY v) x) AS integraveis_por_v,
         (SELECT jsonb_object_agg(x.v, x.n) FROM (SELECT v, count(*) AS n FROM ip WHERE ip.tenant_id = t.tenant_id
                                                     AND estado = 'integrado' GROUP BY v) x) AS integrados_por_v,
         (SELECT count(*) FROM ip WHERE ip.tenant_id = t.tenant_id AND estado = 'integravel' AND v <> '4') AS a_reprocessar,
         (SELECT count(*) FROM ip WHERE ip.tenant_id = t.tenant_id AND estado = 'integrado') AS integrados,
         (SELECT count(*) FROM invalido x WHERE x.tenant_id = t.tenant_id) AS aborta_retrato_invalido,
         (SELECT count(*) FROM variante_ausente x WHERE x.tenant_id = t.tenant_id) AS aborta_variante_ausente,
         (SELECT count(*) FROM titulo_api x WHERE x.tenant_id = t.tenant_id) AS aborta_titulo_api,
         (SELECT array_agg(DISTINCT u.modelo_id ORDER BY u.modelo_id)
            FROM (SELECT modelo_id FROM invalido WHERE tenant_id = t.tenant_id
                  UNION SELECT modelo_id FROM variante_ausente WHERE tenant_id = t.tenant_id
                  UNION SELECT modelo_id FROM titulo_api WHERE tenant_id = t.tenant_id) u) AS modelos_que_abortam
    FROM (SELECT DISTINCT tenant_id FROM ip) t
)
SELECT coalesce(tn.nome, '?') AS loja, l.tenant_id, coalesce(l.integraveis_por_v, '{}'::jsonb) AS integraveis_por_v,
       coalesce(l.integrados_por_v, '{}'::jsonb) AS integrados_por_v, l.a_reprocessar, l.integrados,
       l.aborta_retrato_invalido, l.aborta_variante_ausente, l.aborta_titulo_api, coalesce(l.modelos_que_abortam, '{}'::uuid[]) AS modelos_que_abortam,
       sum(l.a_reprocessar) OVER () AS total_a_reprocessar,
       sum(l.aborta_retrato_invalido + l.aborta_variante_ausente + l.aborta_titulo_api) OVER () AS total_aborta,
       to_regclass('public._bkp_r8_titulo_sublinha') IS NULL AS backup_ausente
  FROM por_loja l
  LEFT JOIN public.tenants tn ON tn.id = l.tenant_id
 ORDER BY 1
