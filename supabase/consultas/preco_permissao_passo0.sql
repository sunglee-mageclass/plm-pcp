-- Passo 0 (SO LEITURA): quem GANHA as chaves novas por loja. Rodar antes da ida; conferir depois.
-- Criterio = o mesmo do backfill de 20261211100000_preco_permissao_atacado_gate_backfill.sql, que concede em user_permissions (USUARIOS)
-- E em papel_permissoes (PAPEIS). Usuario que so herda do papel NAO aparece no bloco de usuarios: conferir os dois blocos.
-- 5 chaves de _pode_ver_custos: criacao_planejamento:custos, criacao_desenvolvimento:custos, producao_terceirizados:precos,
-- dashboard_custos, dashboard_comercial (pode_ver=true) => ganham VER varejo + VER atacado.
-- criacao_planejamento:preco_venda OU criacao_produto_acabado (pode_editar=true) => ganham EDITAR atacado.

-- ===================== USUARIOS (user_permissions) =====================
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

-- ===================== PAPEIS (papel_permissoes) =====================
-- ANTES da ida: papeis que ganham (mesmos criterios do backfill). Papel sem nenhuma dessas chaves nao aparece.
SELECT p.tenant_id,
       count(*) AS papeis_na_loja,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.papel_permissoes pp
         WHERE pp.papel_id = p.id AND pp.pode_ver = true
           AND pp.pagina IN ('criacao_planejamento:custos','criacao_desenvolvimento:custos',
                             'producao_terceirizados:precos','dashboard_custos','dashboard_comercial')
       )) AS papeis_ganham_ver_preco,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.papel_permissoes pp
         WHERE pp.papel_id = p.id AND pp.pode_editar = true
           AND pp.pagina IN ('criacao_planejamento:preco_venda','criacao_produto_acabado')
       )) AS papeis_ganham_editar_atacado
FROM public.papeis p
GROUP BY p.tenant_id
ORDER BY p.tenant_id;

-- DEPOIS da ida (conferencia): quantos papeis e usuarios JA tem as chaves novas. Antes da ida = tudo 0.
-- Depois da ida, as colunas "ganham" acima devem bater com estas (nao ha papel/usuario com a chave de origem sem a nova).
SELECT 'papeis' AS fonte,
       count(DISTINCT pp.papel_id) FILTER (WHERE pp.pagina = 'criacao_planejamento:ver_preco_venda'   AND pp.pode_ver = true)    AS tem_ver_preco_venda,
       count(DISTINCT pp.papel_id) FILTER (WHERE pp.pagina = 'criacao_planejamento:ver_preco_atacado' AND pp.pode_ver = true)    AS tem_ver_preco_atacado,
       count(DISTINCT pp.papel_id) FILTER (WHERE pp.pagina = 'criacao_planejamento:preco_atacado'     AND pp.pode_editar = true) AS tem_preco_atacado_editar
FROM public.papel_permissoes pp
UNION ALL
SELECT 'usuarios',
       count(DISTINCT up.user_id) FILTER (WHERE up.pagina = 'criacao_planejamento:ver_preco_venda'   AND up.pode_ver = true),
       count(DISTINCT up.user_id) FILTER (WHERE up.pagina = 'criacao_planejamento:ver_preco_atacado' AND up.pode_ver = true),
       count(DISTINCT up.user_id) FILTER (WHERE up.pagina = 'criacao_planejamento:preco_atacado'     AND up.pode_editar = true)
FROM public.user_permissions up;
