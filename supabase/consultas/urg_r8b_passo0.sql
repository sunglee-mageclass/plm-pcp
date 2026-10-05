-- urg_r8b_passo0.sql — PASSO 0 SÓ-LEITURA da urg R8b, ANTES da ida 20261103191000_urg_r8_titulo_sublinha_reprocesso (P-303 A).
-- A ida refaz SÓ o título das sublinhas dos produtos INTEGRÁVEIS cujo retrato não é v=4 (todos ganham v=4 + rev + 1 Log, mesmo sem
-- "titulo" marcado); INTEGRADOS ficam intocados. Esta consulta conta, por loja:
--   estado / v / titulo_marcado / n   integráveis e integrados por versão do retrato e se o campo Título está marcado
--   total_a_reprocessar               Σ integráveis com v<>4 (teto da ida: 1000 — acima disso a ida RECUSA; dividir a janela)
--   backup_ausente                    true = a 191000 nunca rodou neste banco (ida normal); false = já rodou (reaplicar = 0)
-- Regra do kit: anote a linha dos INTEGRADOS de cada loja — depois da ida o n deles tem de ser o MESMO (intocados).
-- Cópia 54422/copia2 (05/out): 0 integráveis; 2 integrados (v=3, título marcado) na Loja Teste.
-- Funciona ANTES e DEPOIS da ida. Regras do arquivo (embutível pelo psql): um único SELECT, SEM ponto e vírgula, sem meta-comando.
WITH g AS (
  SELECT p.tenant_id, p.estado, coalesce(p.retrato ->> 'v', 'null') AS v, ('titulo' = ANY (p.campos)) AS titulo_marcado,
         count(*) AS n
    FROM public.integracao_produtos p
   WHERE p.estado IN ('integravel', 'integrado')
   GROUP BY 1, 2, 3, 4
)
SELECT coalesce(t.nome, '?') AS loja, g.tenant_id, g.estado, g.v, g.titulo_marcado, g.n,
       coalesce(sum(g.n) FILTER (WHERE g.estado = 'integravel' AND g.v <> '4') OVER (), 0) AS total_a_reprocessar,
       to_regclass('public._bkp_r8_titulo_sublinha') IS NULL AS backup_ausente
  FROM g
  LEFT JOIN public.tenants t ON t.id = g.tenant_id
 ORDER BY 1, 3, 4, 5
