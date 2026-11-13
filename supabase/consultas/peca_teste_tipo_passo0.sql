-- Passo 0 (SO LEITURA) - Reforma da Peca Teste por TIPO: o que a migracao 20261129100000/110000 vai mudar.
-- Rodar ANTES do deploy, na PRODUCAO (so SELECT), e na copia local para ensaio:
--   psql "$(cat /tmp/dburl.txt)" -f supabase/consultas/peca_teste_tipo_passo0.sql
-- PARAR e chamar o controlador se: (B) aparecer qualquer linha; (C) aparecer qualquer linha; (D) tiver muitos cards (> ~10) ou algum
-- card em etapa avancada do kanban mudando de resultado; (A) tiver numeros inesperados.

\echo '=== (A) tentativas por loja, tipo e estado (aprovado / reprovado / em teste)'
SELECT t.nome AS loja, ct.nome AS tipo, count(*) AS tentativas,
       count(*) FILTER (WHERE x.aprovacao = 'aprovado') AS aprovadas,
       count(*) FILTER (WHERE x.aprovacao IS NULL) AS em_teste,
       count(*) FILTER (WHERE x.aprovacao IS NOT NULL AND x.aprovacao <> 'aprovado') AS decididas_outras,
       count(DISTINCT x.modelo_id) AS modelos
  FROM public.modelo_peca_teste_tentativas x
  JOIN public.tenants t ON t.id = x.tenant_id
  JOIN public.categorias_terceirizado ct ON ct.id = x.categoria_terceirizado_id
 GROUP BY t.nome, ct.nome ORDER BY t.nome, ct.nome;

\echo '=== (B) COLISAO: grupos (modelo, tipo) em que a uniao por tipo repete o numero (a migracao RENUMERA por created_at)'
SELECT m.ref, t.nome AS loja, ct.nome AS tipo, count(*) AS tentativas,
       count(DISTINCT x.mo_linha_id) AS linhas_de_mo, count(*) FILTER (WHERE x.mo_linha_id IS NULL) AS orfas,
       string_agg(x.numero::text || coalesce(':' || x.aprovacao, ':em_teste'), ', ' ORDER BY x.created_at, x.id) AS numero_e_estado
  FROM public.modelo_peca_teste_tentativas x
  JOIN public.modelos m ON m.id = x.modelo_id
  JOIN public.tenants t ON t.id = x.tenant_id
  JOIN public.categorias_terceirizado ct ON ct.id = x.categoria_terceirizado_id
 GROUP BY m.ref, t.nome, ct.nome, x.modelo_id, x.categoria_terceirizado_id
HAVING count(*) <> count(DISTINCT x.numero)
 ORDER BY t.nome, m.ref;

\echo '=== (C) INCOERENTES apos a uniao: tentativa fora de reprovado que ficaria NO MEIO da trilha (a migracao ABORTA se houver)'
WITH colide AS (
  SELECT modelo_id, categoria_terceirizado_id FROM public.modelo_peca_teste_tentativas
   GROUP BY 1, 2 HAVING count(*) <> count(DISTINCT numero)
), sim AS (
  SELECT x.id, x.modelo_id, x.categoria_terceirizado_id, x.aprovacao,
         CASE WHEN c.modelo_id IS NOT NULL
              THEN row_number() OVER (PARTITION BY x.modelo_id, x.categoria_terceirizado_id ORDER BY x.created_at, x.id)
              ELSE x.numero END AS numero_novo
    FROM public.modelo_peca_teste_tentativas x
    LEFT JOIN colide c ON c.modelo_id = x.modelo_id AND c.categoria_terceirizado_id = x.categoria_terceirizado_id
)
SELECT m.ref, t.nome AS loja, ct.nome AS tipo, s.numero_novo, coalesce(s.aprovacao, 'em_teste') AS estado
  FROM sim s
  JOIN public.modelos m ON m.id = s.modelo_id
  JOIN public.tenants t ON t.id = m.tenant_id
  JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id
 WHERE s.aprovacao IS DISTINCT FROM 'reprovado'
   AND EXISTS (SELECT 1 FROM sim o WHERE o.modelo_id = s.modelo_id AND o.categoria_terceirizado_id = s.categoria_terceirizado_id AND o.numero_novo > s.numero_novo)
 ORDER BY t.nome, m.ref;

\echo '=== (D) CARDS que mudam de resultado em peca_teste_aprovada (antes: por linha + fornecedor congelado; depois: por tipo). Eles podem MOVER no 1o recalculo do kanban'
WITH colide AS (
  SELECT modelo_id, categoria_terceirizado_id FROM public.modelo_peca_teste_tentativas
   GROUP BY 1, 2 HAVING count(*) <> count(DISTINCT numero)
), sim AS (
  SELECT x.modelo_id, x.categoria_terceirizado_id, x.aprovacao,
         CASE WHEN c.modelo_id IS NOT NULL
              THEN row_number() OVER (PARTITION BY x.modelo_id, x.categoria_terceirizado_id ORDER BY x.created_at, x.id)
              ELSE x.numero END AS numero_novo
    FROM public.modelo_peca_teste_tentativas x
    LEFT JOIN colide c ON c.modelo_id = x.modelo_id AND c.categoria_terceirizado_id = x.categoria_terceirizado_id
), linhas AS (
  SELECT s.modelo_id, s.id AS linha_id, s.categoria_terceirizado_id AS cat, s.aprovado, s.empresa_id,
         public._peca_teste_aprovada(s.id, s.categoria_terceirizado_id, s.empresa_id) AS ok_antes,
         coalesce((SELECT z.aprovacao = 'aprovado' FROM sim z
                    WHERE z.modelo_id = s.modelo_id AND z.categoria_terceirizado_id = s.categoria_terceirizado_id
                    ORDER BY z.numero_novo DESC LIMIT 1), false) AS ok_depois
    FROM public.modelo_servico_mo s
    JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.exige_peca_teste
), por_modelo AS (
  SELECT modelo_id,
         NOT EXISTS (SELECT 1 FROM linhas l WHERE l.modelo_id = p.modelo_id AND (l.aprovado IS NOT TRUE OR NOT l.ok_antes)) AS antes,
         NOT EXISTS (SELECT 1 FROM linhas l WHERE l.modelo_id = p.modelo_id AND (l.aprovado IS NOT TRUE OR NOT l.ok_depois)) AS depois
    FROM (SELECT DISTINCT modelo_id FROM linhas) p
)
SELECT m.ref, t.nome AS loja, pm.antes AS aprovada_antes, pm.depois AS aprovada_depois,
       m.status_desenvolvimento, m.status_etapa_pl
  FROM por_modelo pm
  JOIN public.modelos m ON m.id = pm.modelo_id
  JOIN public.tenants t ON t.id = m.tenant_id
 WHERE pm.antes IS DISTINCT FROM pm.depois
 ORDER BY t.nome, m.ref;

\echo '=== (E) FORNECEDOR sem vinculo ao tipo (o Select novo so lista vinculados; o ja congelado continua valendo, mas confira)'
SELECT t.nome AS loja, ct.nome AS tipo, e.nome_fantasia AS fornecedor, count(*) AS tentativas
  FROM public.modelo_peca_teste_tentativas x
  JOIN public.tenants t ON t.id = x.tenant_id
  JOIN public.categorias_terceirizado ct ON ct.id = x.categoria_terceirizado_id
  JOIN public.empresas e ON e.id = x.empresa_id
 WHERE NOT EXISTS (SELECT 1 FROM public.empresa_categorias_servico k WHERE k.empresa_id = x.empresa_id AND k.categoria_terceirizado_id = x.categoria_terceirizado_id)
 GROUP BY t.nome, ct.nome, e.nome_fantasia ORDER BY 1, 2, 3;
