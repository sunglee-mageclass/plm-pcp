-- l9_reaplicar_checagem.sql — CHECAGEM SÓ-LEITURA antes de REAPLICAR a ida 20261029100000 depois da volta (L9, fix round 1 L1;
-- fix round 3 R2: compara também a COR, pois desde a P-216 A o preço do cadastro depende da cor).
-- Com o core antigo no ar (depois do _down), um save pode trocar o aviamento_id OU a variante_aviamento_id de um item SEM
-- tocar o preço; reaplicada a ida, esse item passaria a valer o preço da seleção ANTIGA. Lista os itens com preço gravado
-- cujo aviamento ou cor MUDOU desde o retrato tirado ANTES da volta (CSV l9-itens-pre-down.csv: id, aviamento_id,
-- variante_aviamento_id dos itens com preço).
-- Uso (fora de transação READ ONLY: a tabela temporária precisa ser criada; nada fora de pg_temp é gravado):
--   CREATE TEMP TABLE _l9_pre_down (id uuid, aviamento_id uuid, variante_aviamento_id uuid);
--   \copy _l9_pre_down from 'l9-itens-pre-down.csv' csv header
--   <este SELECT>
-- Cada linha listada: o kit mostra ao dono e, com OK, anula o preço (passa a valer o cadastro da seleção ATUAL), antes da ida:
--   UPDATE public.ocs_aviamento_itens SET preco = NULL WHERE id IN (<ids listados>)
-- Sem o CSV (não guardado): listar os itens cujo preço gravado ≠ cadastro da seleção ATUAL pela regra da ida (cor > 0 da mesma
-- família, senão geral) e conferir um a um (inclui preços negociados legítimos):
--   SELECT it.id, it.oc_aviamento_id, it.aviamento_id, it.variante_aviamento_id, it.preco,
--          COALESCE(CASE WHEN va.preco > 0 THEN va.preco END, a.preco) AS preco_cadastro_agora
--     FROM public.ocs_aviamento_itens it
--     LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
--     LEFT JOIN public.variantes_aviamento va ON va.id = it.variante_aviamento_id AND va.aviamento_id = it.aviamento_id
--    WHERE it.preco IS NOT NULL
--      AND it.preco IS DISTINCT FROM COALESCE(CASE WHEN va.preco > 0 THEN va.preco END, a.preco)
-- Regras do arquivo (embutível pelo psql): um único SELECT, SEM ponto e vírgula, sem meta-comando do psql.
SELECT it.id AS item_id, it.oc_aviamento_id AS oc_id, o.numero_pedido::text AS oc, coalesce(tn.nome::text, '?') AS loja,
       p.aviamento_id AS aviamento_antes, it.aviamento_id AS aviamento_agora, a.codigo_nome::text AS aviamento_agora_nome,
       p.variante_aviamento_id AS cor_antes, it.variante_aviamento_id AS cor_agora,
       it.preco AS preco_gravado,
       COALESCE(CASE WHEN va.preco > 0 THEN va.preco END, a.preco) AS preco_cadastro_agora
  FROM pg_temp._l9_pre_down p
  JOIN public.ocs_aviamento_itens it ON it.id = p.id
  JOIN public.ocs_aviamento o ON o.id = it.oc_aviamento_id
  LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
  LEFT JOIN public.variantes_aviamento va ON va.id = it.variante_aviamento_id AND va.aviamento_id = it.aviamento_id
  LEFT JOIN public.tenants tn ON tn.id = o.tenant_id
 WHERE it.preco IS NOT NULL
   AND (it.aviamento_id IS DISTINCT FROM p.aviamento_id OR it.variante_aviamento_id IS DISTINCT FROM p.variante_aviamento_id)
 ORDER BY 4, 3, 1
