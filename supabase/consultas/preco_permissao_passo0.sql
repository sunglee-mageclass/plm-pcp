-- Passo 0 (SO LEITURA): quem GANHA as chaves novas por loja. Rodar antes da ida; conferir depois.
-- Criterio = o mesmo do backfill de 20261211100000_preco_permissao_atacado_gate_backfill.sql, que concede em user_permissions (USUARIOS)
-- E em papel_permissoes (PAPEIS). Usuario que so herda do papel NAO aparece no bloco de usuarios: conferir os dois blocos.
-- UMA chave por preco (Leitor=pode_ver, Editor=pode_editar): criacao_planejamento:preco_venda (varejo) e criacao_planejamento:preco_atacado.
-- 5 chaves de _pode_ver_custos: criacao_planejamento:custos, criacao_desenvolvimento:custos, producao_terceirizados:precos,
-- dashboard_custos, dashboard_comercial (pode_ver=true) => ganham pode_ver=true em preco_venda E preco_atacado (a linha de preco_venda
-- que ja existe como EDITAR GANHA o ver sem perder o pode_editar: ON CONFLICT DO UPDATE SET pode_ver=true).
-- criacao_planejamento:preco_venda OU criacao_produto_acabado (pode_editar=true) => ganham EDITAR (+ver) em preco_atacado.

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

-- DEPOIS da ida (conferencia): quantos papeis e usuarios tem pode_ver / pode_editar nas 2 chaves de preco. Antes da ida,
-- preco_atacado = 0 (chave nova) e preco_venda so tem as linhas de EDITAR ja existentes.
-- Depois da ida, tem_*_ver >= "ganham_ver_preco" acima e tem_atacado_editar >= "ganham_editar_atacado".
SELECT 'papeis' AS fonte,
       count(DISTINCT pp.papel_id) FILTER (WHERE pp.pagina = 'criacao_planejamento:preco_venda'   AND pp.pode_ver = true)    AS tem_preco_venda_ver,
       count(DISTINCT pp.papel_id) FILTER (WHERE pp.pagina = 'criacao_planejamento:preco_venda'   AND pp.pode_editar = true) AS tem_preco_venda_editar,
       count(DISTINCT pp.papel_id) FILTER (WHERE pp.pagina = 'criacao_planejamento:preco_atacado' AND pp.pode_ver = true)    AS tem_preco_atacado_ver,
       count(DISTINCT pp.papel_id) FILTER (WHERE pp.pagina = 'criacao_planejamento:preco_atacado' AND pp.pode_editar = true) AS tem_preco_atacado_editar
FROM public.papel_permissoes pp
UNION ALL
SELECT 'usuarios',
       count(DISTINCT up.user_id) FILTER (WHERE up.pagina = 'criacao_planejamento:preco_venda'   AND up.pode_ver = true),
       count(DISTINCT up.user_id) FILTER (WHERE up.pagina = 'criacao_planejamento:preco_venda'   AND up.pode_editar = true),
       count(DISTINCT up.user_id) FILTER (WHERE up.pagina = 'criacao_planejamento:preco_atacado' AND up.pode_ver = true),
       count(DISTINCT up.user_id) FILTER (WHERE up.pagina = 'criacao_planejamento:preco_atacado' AND up.pode_editar = true)
FROM public.user_permissions up;

-- ANTES da ida (ATENCAO, so leitura): linhas de preco_venda que ja tem pode_ver=true mas NAO estao no criterio de VER (nao veem custos).
-- Hoje elas nao veem preco (a leitura exigia ver_preco_venda); na nova chave unica elas PASSAM a ver. Esperado: 0 (ou conferir caso a caso).
SELECT 'usuarios' AS fonte, up.tenant_id, count(DISTINCT up.user_id) AS veem_preco_sem_ver_custos
FROM public.user_permissions up
WHERE up.pagina = 'criacao_planejamento:preco_venda' AND up.pode_ver = true
  AND NOT EXISTS (SELECT 1 FROM public.user_permissions o WHERE o.user_id = up.user_id AND o.pode_ver = true
                  AND o.pagina IN ('criacao_planejamento:custos','criacao_desenvolvimento:custos','producao_terceirizados:precos','dashboard_custos','dashboard_comercial'))
GROUP BY up.tenant_id
UNION ALL
SELECT 'papeis', pp.tenant_id, count(DISTINCT pp.papel_id)
FROM public.papel_permissoes pp
WHERE pp.pagina = 'criacao_planejamento:preco_venda' AND pp.pode_ver = true
  AND NOT EXISTS (SELECT 1 FROM public.papel_permissoes o WHERE o.papel_id = pp.papel_id AND o.pode_ver = true
                  AND o.pagina IN ('criacao_planejamento:custos','criacao_desenvolvimento:custos','producao_terceirizados:precos','dashboard_custos','dashboard_comercial'))
GROUP BY pp.tenant_id;
