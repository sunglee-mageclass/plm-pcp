-- PREVIA SO-LEITURA (achados MEDIOS R15a, fix round 1, P-213 A, dono 01/out): o que a regra "reprovado = Desenvolvimento
-- OU Planejamento" tira da RESERVA de estoque. Sao os cards reprovados SO no Planejamento (status_desenvolvimento nao
-- 'reprovado'), ainda nao enviados ao corte. As migrations 20261025100000 (tecido) e 20261025150000 (aviamento) recalculam
-- a MESMA conta dentro da pre-condicao e abortam se a reserva mudar diferente disso; o kit roda esta consulta em producao
-- ANTES da ida e o dono confere a lista (copia 54422: 7 cards na Ave Rara; tecido -12,08 m em 3 variantes do TOP ALICIA;
-- aviamento 0 - os 2 cards com aviamento tem grade 0).
-- Nao chama funcao do sistema (a formula da reserva e repetida aqui; _grade_soma_pares so vale para tecido complementar -
-- na falta dela, a coluna "complementar" mostra quantas parcelas usam o par e o valor NAO inclui essas parcelas):
-- REPEATABLE READ, READ ONLY e ROLLBACK, como o Passo 0.
-- Saida 1: os cards (loja, card, nome, status planejamento/desenvolvimento). Saida 2: tecido por variante (reducao da
-- reserva em m). Saida 3: aviamento por bucket (reducao da reserva).

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;

SELECT COALESCE(tn.nome::text, '?') AS loja, left(m.id::text, 8) AS card8, m.nome, m.status_planejamento, m.status_desenvolvimento
  FROM public.modelos m LEFT JOIN public.tenants tn ON tn.id = m.tenant_id
 WHERE lower(COALESCE(m.status_desenvolvimento, '')) <> 'reprovado'
   AND lower(COALESCE(m.status_planejamento, '')) = 'reprovado'
   AND NOT EXISTS (SELECT 1 FROM public.cad c WHERE c.modelo_id = m.id AND c.enviado_corte)
 ORDER BY 1, 3;

WITH grade AS (
  SELECT modelo_id, variante_numero, SUM(COALESCE(grade_total, 0)) AS gt
    FROM public.modelo_grades WHERE variante_numero IS NOT NULL GROUP BY 1, 2
), parc AS (
  SELECT m.tenant_id, mv.variante_tecido_id AS vid, m.id AS mid,
         (mv.complementa_variante_ids IS NOT NULL AND cardinality(mv.complementa_variante_ids) > 0
          AND NOT (mt.tipo = 'tecido' AND mt.numero = 1)) AS complementar,
         COALESCE(mt.consumo, 0) * (1 + COALESCE(mt.loss_percent, 0) / 100.0) * COALESCE(g.gt, 0) * COALESCE(mv.multiplicador, 1) AS m
    FROM public.modelo_tecido_variantes mv
    JOIN public.modelo_tecidos mt ON mt.id = mv.modelo_tecido_id
    JOIN public.modelos m ON m.id = mt.modelo_id
     AND lower(COALESCE(m.status_desenvolvimento, '')) <> 'reprovado'
     AND lower(COALESCE(m.status_planejamento, '')) = 'reprovado'
     AND NOT EXISTS (SELECT 1 FROM public.cad c WHERE c.modelo_id = m.id AND c.enviado_corte)
    LEFT JOIN grade g ON g.modelo_id = mt.modelo_id AND g.variante_numero = mv.ordem
   WHERE mv.variante_tecido_id IS NOT NULL
)
SELECT COALESCE(tn.nome::text, '?') AS loja, left(p.vid::text, 8) AS variante8, count(DISTINCT p.mid) AS cards,
       round(SUM(p.m) FILTER (WHERE NOT p.complementar), 4) AS reducao_reserva_m,
       count(*) FILTER (WHERE p.complementar) AS parcelas_complementares_fora_da_soma
  FROM parc p LEFT JOIN public.tenants tn ON tn.id = p.tenant_id
 GROUP BY 1, 2 HAVING SUM(p.m) <> 0 OR count(*) FILTER (WHERE p.complementar) > 0
 ORDER BY 1, 2;

WITH mod_grade AS (
  SELECT modelo_id, SUM(COALESCE(grade_total, 0)) AS gt FROM public.modelo_grades GROUP BY modelo_id
)
SELECT COALESCE(tn.nome::text, '?') AS loja, left(ma.aviamento_id::text, 8) AS aviamento8,
       COALESCE(left(ma.variante_aviamento_id::text, 8), '(sem variante)') AS variante8, count(DISTINCT m.id) AS cards,
       round(SUM(COALESCE(ma.consumo, 0) * COALESCE(mg.gt, 0)), 4) AS reducao_reserva
  FROM public.modelo_aviamentos ma
  JOIN public.modelos m ON m.id = ma.modelo_id
   AND lower(COALESCE(m.status_desenvolvimento, '')) <> 'reprovado'
   AND lower(COALESCE(m.status_planejamento, '')) = 'reprovado'
   AND NOT EXISTS (SELECT 1 FROM public.cad c WHERE c.modelo_id = m.id AND c.enviado_corte)
  LEFT JOIN mod_grade mg ON mg.modelo_id = ma.modelo_id
  LEFT JOIN public.tenants tn ON tn.id = m.tenant_id
 WHERE ma.aviamento_id IS NOT NULL
 GROUP BY 1, 2, 3 HAVING SUM(COALESCE(ma.consumo, 0) * COALESCE(mg.gt, 0)) <> 0
 ORDER BY 1, 2, 3;

ROLLBACK;
