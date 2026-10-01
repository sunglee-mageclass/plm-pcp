-- PREVIA SO-LEITURA (achados MEDIOS R15a, P-203 A): quantos cad com "Faltou estoque" (cad.deficit_corte) o
-- _completar_deficit_corte_variante COMPLETARIA se rodasse HOJE para todas as variantes. A migration 20261025300000 NAO
-- roda nenhuma correcao unica (o dono nao pediu): o efeito so vale quando um item de OC passar a contar (gatilho). Esta
-- consulta serve para o kit/dono saberem o que esta "parado" hoje.
-- Nao chama funcao do sistema, nao grava nada: rodar em REPEATABLE READ, READ ONLY e ROLLBACK, como o Passo 0.
-- ESTIMATIVA: considera so o FIFO (ignora o teto quantidade_m dos vinculos do modo por_oc e a exclusao dos itens vinculados
-- da linha no FIFO); a ordem e a do helper (corte mais antigo primeiro). Saldo do item = regra do core/saldo_oc_item_m
-- (OC recebida, item nao cancelado, recebida senao pedida - 0 se troca -, kg->m, menos as baixas do item); item com
-- rolos_planejados ainda nao separado nao conta (como no helper).
-- Saida 1: resumo por loja (cad com deficit | metros em deficit | cad completados inteiros | cad completados em parte |
-- metros que baixaria). Saida 2: a lista por cad (loja, cad8, modelo, variante8, deficit, completaria).

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;

WITH def AS (
  SELECT cd.tenant_id, cd.id AS cad_id, cd.modelo_id, cd.data_enviado_corte,
         ctv.variante_tecido_id AS vid, (e->>'deficit')::numeric AS deficit,
         row_number() OVER () AS k
    FROM public.cad cd
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(cd.deficit_corte) = 'array' THEN cd.deficit_corte ELSE '[]'::jsonb END) e
    JOIN public.cad_tecidos ct ON ct.cad_id = cd.id AND ct.tipo = (e->>'tipo') AND ct.numero = (e->>'numero')::int
    JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id AND ctv.ordem = (e->>'ordem')::int
   WHERE cd.enviado_corte AND COALESCE((e->>'deficit')::numeric, 0) > 0.0001 AND ctv.variante_tecido_id IS NOT NULL
), saldo AS (
  SELECT oc.tenant_id, it.variante_tecido_id AS vid,
         SUM(GREATEST(0,
           (CASE WHEN a.unidade_medida = 'kg'
                 THEN COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) * COALESCE(a.rendimento, 0)
                 ELSE COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) END)
           - COALESCE((SELECT SUM(b.quantidade) FROM public.estoque_tecido_baixas b WHERE b.oc_tecido_item_id = it.id), 0))) AS m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id AND oc.status = 'recebido'
    LEFT JOIN public.artigos a ON a.id = it.artigo_id
   WHERE COALESCE(it.cancelado, false) = false AND it.variante_tecido_id IS NOT NULL
     AND NOT (COALESCE(oc.is_rolo, false) = false
              AND (CASE WHEN jsonb_typeof(it.rolos_planejados) = 'array' THEN jsonb_array_length(it.rolos_planejados) > 0 ELSE false END)
              AND NOT EXISTS (SELECT 1 FROM public.estoque_tecido_baixas bs WHERE bs.oc_tecido_item_id = it.id AND bs.origem = 'separacao_rolo'))
   GROUP BY 1, 2
), fila AS (
  SELECT d.*, COALESCE(s.m, 0) AS saldo_var,
         SUM(d.deficit) OVER (PARTITION BY d.tenant_id, d.vid ORDER BY d.data_enviado_corte NULLS LAST, d.cad_id, d.k
                              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS antes
    FROM def d LEFT JOIN saldo s ON s.tenant_id = d.tenant_id AND s.vid = d.vid
), calc AS (
  SELECT f.*, GREATEST(0, LEAST(f.deficit, f.saldo_var - COALESCE(f.antes, 0))) AS baixaria FROM fila f
), por_cad AS (
  SELECT tenant_id, cad_id, SUM(deficit) AS deficit, SUM(baixaria) AS baixaria FROM calc GROUP BY 1, 2
)
SELECT COALESCE(tn.nome::text, '?') AS loja,
       count(*) AS cad_com_deficit,
       round(SUM(p.deficit), 2) AS metros_em_deficit,
       count(*) FILTER (WHERE p.baixaria >= p.deficit - 0.0001) AS cad_completados_inteiros,
       count(*) FILTER (WHERE p.baixaria > 0 AND p.baixaria < p.deficit - 0.0001) AS cad_completados_em_parte,
       round(SUM(p.baixaria), 2) AS metros_que_baixaria
  FROM por_cad p LEFT JOIN public.tenants tn ON tn.id = p.tenant_id
 GROUP BY 1 ORDER BY 1;

WITH def AS (
  SELECT cd.tenant_id, cd.id AS cad_id, cd.modelo_id, cd.data_enviado_corte,
         ctv.variante_tecido_id AS vid, (e->>'deficit')::numeric AS deficit
    FROM public.cad cd
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(cd.deficit_corte) = 'array' THEN cd.deficit_corte ELSE '[]'::jsonb END) e
    JOIN public.cad_tecidos ct ON ct.cad_id = cd.id AND ct.tipo = (e->>'tipo') AND ct.numero = (e->>'numero')::int
    JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id AND ctv.ordem = (e->>'ordem')::int
   WHERE cd.enviado_corte AND COALESCE((e->>'deficit')::numeric, 0) > 0.0001 AND ctv.variante_tecido_id IS NOT NULL
)
SELECT COALESCE(tn.nome::text, '?') AS loja, left(d.cad_id::text, 8) AS cad8, m.nome AS modelo, left(d.vid::text, 8) AS variante8,
       d.data_enviado_corte, round(d.deficit, 2) AS deficit_m
  FROM def d LEFT JOIN public.tenants tn ON tn.id = d.tenant_id LEFT JOIN public.modelos m ON m.id = d.modelo_id
 ORDER BY 1, d.data_enviado_corte NULLS LAST, d.cad_id;

ROLLBACK;
