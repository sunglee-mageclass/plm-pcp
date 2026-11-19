-- Passo 0 (SO LEITURA): quem GANHA as chaves novas por loja. Rodar antes da ida; conferir depois.
-- Criterio = o mesmo do backfill de 20261211100000_preco_permissao_atacado_gate_backfill.sql (user_permissions por usuario;
-- usuario so com papel nao aparece aqui - o backfill concede tambem em papel_permissoes pelos mesmos criterios).
SELECT u.tenant_id,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.user_permissions up
         WHERE up.user_id = u.id AND up.pode_ver = true
           AND up.pagina IN ('criacao_planejamento:custos','criacao_desenvolvimento:custos',
                             'producao_terceirizados:precos','dashboard_custos','dashboard_comercial')
       )) AS ganham_ver_preco,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.user_permissions up
         WHERE up.user_id = u.id AND up.pode_editar = true
           AND up.pagina IN ('criacao_planejamento:preco_venda','criacao_produto_acabado')
       )) AS ganham_editar_atacado
FROM public.users u
WHERE u.tenant_id IS NOT NULL
GROUP BY u.tenant_id
ORDER BY u.tenant_id;
