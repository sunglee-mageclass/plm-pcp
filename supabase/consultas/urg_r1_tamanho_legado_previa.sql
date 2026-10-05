-- urg_r1_tamanho_legado_previa.sql - PREVIA (SO LEITURA) da correcao unica do tamanho legado (urg R1 T2b, P-307 B, migration
-- 20261103170500_urg_r1_tamanho_legado). Reaproveita o vinculo de tamanho da 1a versao (etiquetas.tamanho, fora da tela desde
-- 15/jul, sem leitor) para a coluna nova etiquetas.tamanho_vinculado (20261103170000) - SO com a lista aprovada pelo dono.
-- SELECT PURO: nao chama nenhuma funcao do sistema (so as nativas do Postgres) e roda ANTES ou DEPOIS da 170000 (o vinculo atual e
-- lido por to_jsonb(e), que da NULL se a coluna ainda nao existe). A funcao public._urg_r1_tamanho_legado_lista() da 170500 tem de
-- dar o MESMO resultado, linha a linha (teste tests/integration/urg-a1b-tamanho-legado.test.ts).
-- Regras do arquivo (pode ser embutido pelo psql como variavel dentro de um COPY): um unico SELECT, SEM ponto e virgula, sem
-- meta-comando do psql e sem dois-pontos seguido de letra fora de strings (por isso CAST, nunca o atalho de dois-pontos).
--
-- Universo: todo insumo com etiquetas.tamanho nao vazio (todas as lojas). ELEGIVEL quando as 3 regras valem:
--   1) btrim(tamanho) existe EXATAMENTE em tenant_config.tamanhos_grade da loja do insumo         (senao: fora_da_grade)
--   2) o insumo e "sem tamanho" pela regra de _insumo_tamanho_efetivo: formato 'nenhum' OU nenhuma variante com tamanho nao vazio
--                                                                                                    (senao: com_tamanho_proprio)
--   3) o NOME casa com o valor, sem acento e sem caixa: o lado numerico (ex.: 34 de "34|PPP") como palavra inteira, OU a sigla
--      (ex.: PPP) logo depois de "TAM." ou "TAMANHO "                                                (senao: nome_nao_casa)
-- A 4a regra (tamanho_vinculado ainda vazio - nunca sobrescreve o que a pessoa ligou) NAO entra no hash: e conferida na hora de
-- gravar (situacao 'ja_vinculado' = sera pulado). Assim a lista aprovada continua valendo numa 2a execucao (idempotente).
--
-- Saida (ordem: elegivel, nao_elegivel, hash_lista, dentro de cada secao por loja e id):
--   secao = 'elegivel'      -> linha_canonica = tenant_id|etiqueta_id|nome|valor|n_modelos , situacao = a_ligar | ja_vinculado <valor>
--   secao = 'nao_elegivel'  -> situacao = o motivo (fora_da_grade | com_tamanho_proprio | nome_nao_casa)
--   secao = 'hash_lista'    -> linha_canonica = hash_lista = md5 das linhas canonicas dos ELEGIVEIS unidas por quebra de linha na
--                              ordem (tenant_id, etiqueta_id) - md5('') se nenhum, situacao = 'n=<quantidade de elegiveis>'
-- n_modelos = modelos DISTINTOS da mesma loja que usam o insumo no BOM (modelo_etiquetas). O kit roda, numa transacao so:
--   BEGIN, SET LOCAL app.confirmo_tamanho_legado = 'sim',
--   SELECT public._urg_r1_tamanho_legado_rodar('<array jsonb das linhas aprovadas>', '<hash_lista>', <n>), COMMIT
WITH base AS (
  SELECT e.id AS etiqueta_id,
         e.tenant_id,
         CAST(e.nome AS text) AS nome,
         btrim(e.tamanho) AS valor,
         coalesce(e.formato_tamanho, 'ambos') AS formato,
         nullif(btrim(to_jsonb(e) ->> 'tamanho_vinculado'), '') AS vinculo_atual,
         EXISTS (SELECT 1 FROM public.variantes_etiqueta v
                  WHERE v.etiqueta_id = e.id AND nullif(btrim(v.tamanho), '') IS NOT NULL) AS tem_var,
         CAST((SELECT count(DISTINCT me.modelo_id)
                 FROM public.modelo_etiquetas me
                 JOIN public.modelos m ON m.id = me.modelo_id AND m.tenant_id = e.tenant_id
                WHERE me.etiqueta_id = e.id) AS integer) AS n_modelos,
         EXISTS (SELECT 1 FROM public.tenant_config tc
                  WHERE tc.tenant_id = e.tenant_id AND jsonb_typeof(tc.tamanhos_grade) = 'array'
                    AND tc.tamanhos_grade ? btrim(e.tamanho)) AS na_grade,
         upper(regexp_replace(normalize(CAST(e.nome AS text), NFD), '[\u0300-\u036f]', '', 'g')) AS nome_n
    FROM public.etiquetas e
   WHERE nullif(btrim(e.tamanho), '') IS NOT NULL
), lados AS (
  SELECT b.*,
         CASE WHEN split_part(b.valor, '|', 1) ~ '^[0-9]+$' THEN split_part(b.valor, '|', 1) END AS num,
         CASE WHEN strpos(b.valor, '|') > 0 THEN nullif(upper(split_part(b.valor, '|', 2)), '')
              WHEN b.valor !~ '^[0-9]+$' THEN upper(b.valor) END AS sigla
    FROM base b
), cls AS (
  SELECT l.*,
         CASE WHEN NOT l.na_grade THEN 'fora_da_grade'
              WHEN NOT (l.formato = 'nenhum' OR NOT l.tem_var) THEN 'com_tamanho_proprio'
              WHEN NOT ((l.num IS NOT NULL AND l.nome_n ~ ('\y' || l.num || '\y'))
                        OR (l.sigla ~ '^[A-Z0-9]+$' AND l.nome_n ~ ('\yTAM(\.|ANHO\s)\s*' || l.sigla || '\y')))
                THEN 'nome_nao_casa'
         END AS motivo,
         coalesce(CAST(l.tenant_id AS text), '') || '|' || CAST(l.etiqueta_id AS text) || '|' || l.nome || '|' || l.valor || '|'
           || CAST(l.n_modelos AS text) AS linha
    FROM lados l
)
SELECT x.secao, x.tenant_id, x.etiqueta_id, x.nome, x.valor, x.n_modelos, x.situacao, x.linha_canonica
  FROM (
    SELECT CASE WHEN c.motivo IS NULL THEN 1 ELSE 2 END AS ordem,
           CASE WHEN c.motivo IS NULL THEN 'elegivel' ELSE 'nao_elegivel' END AS secao,
           c.tenant_id, c.etiqueta_id, c.nome, c.valor, c.n_modelos,
           CASE WHEN c.motivo IS NOT NULL THEN c.motivo
                WHEN c.vinculo_atual IS NULL THEN 'a_ligar'
                ELSE 'ja_vinculado: ' || c.vinculo_atual END AS situacao,
           CASE WHEN c.motivo IS NULL THEN c.linha END AS linha_canonica
      FROM cls c
    UNION ALL
    SELECT 3, 'hash_lista', NULL, NULL, NULL, NULL, NULL,
           'n=' || CAST(count(*) FILTER (WHERE c.motivo IS NULL) AS text),
           md5(coalesce(string_agg(c.linha, E'\n' ORDER BY c.tenant_id, c.etiqueta_id) FILTER (WHERE c.motivo IS NULL), ''))
      FROM cls c
  ) x
 ORDER BY x.ordem, x.tenant_id, x.etiqueta_id
