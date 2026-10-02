-- CONSULTA SO-LEITURA (achados MEDIOS R15a, fix round 1, M1): entradas de cad.deficit_corte fora do formato que o corte
-- grava ({tipo, numero inteiro, ordem inteira, deficit numerico, ...}). O _completar_deficit_corte_variante (P-203 A) MANTEM
-- essas entradas como estao e so as conta (nao desliga mais a loja), mas o kit deve mostrar a contagem ao dono antes da
-- ida: entrada malformada = o "Faltou estoque" daquela linha nunca e completado sozinho (so um reenvio ao corte refaz).
-- `authenticated` tem UPDATE em cad.deficit_corte (privilegio de coluna) - dado legado ou write do cliente bastam.
-- Nao chama funcao do sistema, nao grava nada: REPEATABLE READ, READ ONLY e ROLLBACK, como o Passo 0.
-- Saida 1: por loja (cad com deficit | entradas | malformadas | cad com alguma malformada). Saida 2: a lista (loja, cad8,
-- entrada como texto).

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;

WITH ent AS (
  SELECT cd.tenant_id, cd.id AS cad_id, e,
         NOT (jsonb_typeof(e) = 'object'
              AND COALESCE(e->>'tipo', '') <> ''
              AND COALESCE(e->>'numero', '') ~ '^[0-9]+$'
              AND COALESCE(e->>'ordem', '') ~ '^[0-9]+$'
              AND COALESCE(e->>'deficit', '') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
              AND (e->>'baixada' IS NULL OR e->>'baixada' ~ '^\s*[0-9]+(\.[0-9]+)?\s*$')) AS ruim
    FROM public.cad cd
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(cd.deficit_corte) = 'array' THEN cd.deficit_corte ELSE '[]'::jsonb END) e
   WHERE cd.deficit_corte IS NOT NULL
)
SELECT COALESCE(tn.nome::text, '?') AS loja,
       count(DISTINCT ent.cad_id) AS cad_com_deficit,
       count(*) AS entradas,
       count(*) FILTER (WHERE ent.ruim) AS malformadas,
       count(DISTINCT ent.cad_id) FILTER (WHERE ent.ruim) AS cad_com_malformada
  FROM ent LEFT JOIN public.tenants tn ON tn.id = ent.tenant_id
 GROUP BY 1 ORDER BY 1;

-- deficit_corte que nem e array (escalar/objeto) tambem conta como malformado
SELECT COALESCE(tn.nome::text, '?') AS loja, left(cd.id::text, 8) AS cad8, cd.deficit_corte::text AS deficit_corte
  FROM public.cad cd LEFT JOIN public.tenants tn ON tn.id = cd.tenant_id
 WHERE cd.deficit_corte IS NOT NULL AND jsonb_typeof(cd.deficit_corte) IS DISTINCT FROM 'array'
UNION ALL
SELECT COALESCE(tn.nome::text, '?'), left(cd.id::text, 8), e::text
  FROM public.cad cd
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(cd.deficit_corte) = 'array' THEN cd.deficit_corte ELSE '[]'::jsonb END) e
  LEFT JOIN public.tenants tn ON tn.id = cd.tenant_id
 WHERE NOT (jsonb_typeof(e) = 'object'
            AND COALESCE(e->>'tipo', '') <> ''
            AND COALESCE(e->>'numero', '') ~ '^[0-9]+$'
            AND COALESCE(e->>'ordem', '') ~ '^[0-9]+$'
            AND COALESCE(e->>'deficit', '') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
            AND (e->>'baixada' IS NULL OR e->>'baixada' ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'))
 ORDER BY 1, 2;

ROLLBACK;
