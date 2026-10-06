-- VARREDURA DE RECONCILIACAO DO EXTRATO DE ESTOQUE (Urgentes R3, T14; migration 20261103177000).
-- Proposito: provar, em TODAS as lojas e TODOS os itens, que a soma do extrato por bucket (_estoque_extrato_<fam>_core) e igual a
-- recebido - baixa do _estoque_<fam>_core: tecido por variante_tecido_id; aviamento por (item, variante); insumo por (item, tamanho, cor).
-- SO LEITURA: um unico SELECT (sem ';' final, sem escrita, sem tabela temporaria); roda em BEGIN TRANSACTION READ ONLY.
-- Roda como postgres, sem JWT: chama so as funcoes internas _core (os wrappers com JWT nao sao usados).
-- RESULTADO ESPERADO: UMA linha com tecido_diverge, tecido_fora, aviamento_diverge, aviamento_fora, insumo_diverge, insumo_fora
-- TODOS = 0. Qualquer valor > 0 = o extrato nao fecha com o estoque: PARAR e avisar. As colunas *_buckets / *_linhas sao so volume
-- (informativas; variam com os dados).
--   *_diverge = buckets do core cuja soma do extrato (0 se nao tiver linha) difere de recebido - baixa;
--   *_fora    = linhas/buckets do extrato que nao existem no core.
-- Uso: kit da Onda 1, depois do bloco 3 (ida da 20261103177000). Fonte da logica: VARRE_177 de gerar-a3.mjs e o teste
-- tests/integration/urg-a3-extrato-reconcilia.test.ts. Pode demorar (varre todas as lojas); em producao, rodar em horario calmo.
WITH tc AS (SELECT t.id AS tenant, x.variante_tecido_id AS item, x.recebido_m AS rec, x.baixa FROM public.tenants t CROSS JOIN LATERAL public._estoque_tecido_core(t.id) x),
te AS (SELECT c.tenant, c.item, e.* FROM tc c CROSS JOIN LATERAL public._estoque_extrato_tecido_core(c.tenant, c.item) e),
ts AS (SELECT tenant, item, sum(quantidade) AS s, count(*) AS n FROM te GROUP BY 1, 2),
ac AS (SELECT t.id AS tenant, x.id AS item, x.variante_id AS var, x.recebido AS rec, x.baixa FROM public.tenants t CROSS JOIN LATERAL public._estoque_aviamento_core(t.id) x),
ae AS (SELECT i.tenant, i.item, e.* FROM (SELECT DISTINCT tenant, item FROM ac) i CROSS JOIN LATERAL public._estoque_extrato_aviamento_core(i.tenant, i.item) e),
asx AS (SELECT tenant, item, bucket_variante_id AS var, sum(quantidade) AS s, count(*) AS n FROM ae GROUP BY 1, 2, 3),
ic AS (SELECT tenant, item, tam, cn, sum(rec) AS rec, sum(baixa) AS baixa
         FROM (SELECT DISTINCT t.id AS tenant, x.etiqueta_id AS item, x.tamanho AS tam, x.cor_nome AS cn, x.recebido AS rec, x.prev_receb, x.baixa, x.fisico
                 FROM public.tenants t CROSS JOIN LATERAL public._estoque_etiqueta_core(t.id) x) d GROUP BY 1, 2, 3, 4),
ie AS (SELECT i.tenant, i.item, e.* FROM (SELECT DISTINCT tenant, item FROM ic) i CROSS JOIN LATERAL public._estoque_extrato_insumo_core(i.tenant, i.item) e),
isx AS (SELECT tenant, item, bucket_tamanho AS tam, bucket_cor_nome AS cn, sum(quantidade) AS s, count(*) AS n FROM ie GROUP BY 1, 2, 3, 4)
SELECT (SELECT count(*) FROM tc c LEFT JOIN ts s ON s.tenant = c.tenant AND s.item = c.item WHERE coalesce(s.s, 0) <> c.rec - c.baixa)::int AS tecido_diverge,
       (SELECT count(*) FROM te WHERE bucket_variante_id IS DISTINCT FROM item)::int AS tecido_fora,
       (SELECT count(*) FROM ac c LEFT JOIN asx s ON s.tenant = c.tenant AND s.item = c.item AND s.var IS NOT DISTINCT FROM c.var
         WHERE coalesce(s.s, 0) <> c.rec - c.baixa)::int AS aviamento_diverge,
       (SELECT count(*) FROM asx s WHERE NOT EXISTS (SELECT 1 FROM ac c WHERE c.tenant = s.tenant AND c.item = s.item AND c.var IS NOT DISTINCT FROM s.var))::int AS aviamento_fora,
       (SELECT count(*) FROM ic c LEFT JOIN isx s ON s.tenant = c.tenant AND s.item = c.item AND s.tam IS NOT DISTINCT FROM c.tam AND s.cn IS NOT DISTINCT FROM c.cn
         WHERE coalesce(s.s, 0) <> c.rec - c.baixa)::int AS insumo_diverge,
       (SELECT count(*) FROM isx s WHERE NOT EXISTS (SELECT 1 FROM ic c WHERE c.tenant = s.tenant AND c.item = s.item AND c.tam IS NOT DISTINCT FROM s.tam
                                                       AND c.cn IS NOT DISTINCT FROM s.cn))::int AS insumo_fora,
       (SELECT count(*) FROM tc)::int AS tecido_buckets, (SELECT coalesce(sum(n), 0) FROM ts)::int AS tecido_linhas,
       (SELECT count(*) FROM ac)::int AS aviamento_buckets, (SELECT coalesce(sum(n), 0) FROM asx)::int AS aviamento_linhas,
       (SELECT count(*) FROM ic)::int AS insumo_buckets, (SELECT coalesce(sum(n), 0) FROM isx)::int AS insumo_linhas
