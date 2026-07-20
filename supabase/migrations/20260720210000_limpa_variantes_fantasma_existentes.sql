-- Limpeza one-time dos FANTASMAS já existentes: variantes que ficaram em
-- cad_grades/modelo_grades/cq_variantes/cq_pos_variantes/direcionamento após terem sido
-- DELETADAS do tecido-1 (antes da poda em _salvar_cad_completo_core). Só toca em CADs que
-- TÊM variantes no tecido-1 (senão o conjunto válido seria desconhecido e não se apaga nada).
BEGIN;

WITH v1 AS (
  SELECT ct.cad_id, array_agg(DISTINCT ctv.ordem) AS nums
  FROM public.cad_tecidos ct
  JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
  WHERE ct.tipo = 'tecido' AND ct.numero = 1 AND ctv.ordem IS NOT NULL
  GROUP BY ct.cad_id
)
DELETE FROM public.cad_grades cg USING v1
 WHERE cg.cad_id = v1.cad_id AND cg.variante_numero <> ALL(v1.nums);

WITH v1 AS (
  SELECT c.modelo_id, array_agg(DISTINCT ctv.ordem) AS nums
  FROM public.cad c
  JOIN public.cad_tecidos ct ON ct.cad_id = c.id
  JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
  WHERE ct.tipo = 'tecido' AND ct.numero = 1 AND ctv.ordem IS NOT NULL
  GROUP BY c.modelo_id
)
DELETE FROM public.modelo_grades mg USING v1
 WHERE mg.modelo_id = v1.modelo_id AND mg.variante_numero <> ALL(v1.nums);

WITH v1 AS (
  SELECT ct.cad_id, array_agg(DISTINCT ctv.ordem) AS nums
  FROM public.cad_tecidos ct
  JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
  WHERE ct.tipo = 'tecido' AND ct.numero = 1 AND ctv.ordem IS NOT NULL
  GROUP BY ct.cad_id
)
DELETE FROM public.direcionamento d USING v1
 WHERE d.cad_id = v1.cad_id AND d.variante_numero <> ALL(v1.nums);

WITH v1 AS (
  SELECT q.id AS cq_id, array_agg(DISTINCT ctv.ordem) AS nums
  FROM public.controle_qualidade q
  JOIN public.cad_tecidos ct ON ct.cad_id = q.cad_id
  JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
  WHERE ct.tipo = 'tecido' AND ct.numero = 1 AND ctv.ordem IS NOT NULL
  GROUP BY q.id
)
DELETE FROM public.cq_variantes cv USING v1
 WHERE cv.controle_qualidade_id = v1.cq_id AND cv.variante_numero <> ALL(v1.nums);

WITH v1 AS (
  SELECT q.id AS cq_id, array_agg(DISTINCT ctv.ordem) AS nums
  FROM public.controle_qualidade q
  JOIN public.cad_tecidos ct ON ct.cad_id = q.cad_id
  JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
  WHERE ct.tipo = 'tecido' AND ct.numero = 1 AND ctv.ordem IS NOT NULL
  GROUP BY q.id
)
DELETE FROM public.cq_pos_variantes cv USING v1
 WHERE cv.controle_qualidade_id = v1.cq_id AND cv.variante_numero <> ALL(v1.nums);

COMMIT;
