-- urg_r1b_enviar_previa.sql - PREVIA (SO LEITURA) da correcao unica do "a enviar" dos insumos vinculados a UM tamanho (urg R1b,
-- P-337 A, migration 20261103198000_urg_r1b_enviar_tamanho). Roda DEPOIS da ida da 198000 (que so cria funcoes e a tabela de backup,
-- sem mudar dado): le public._urg_r1b_enviar_previa() - a MESMA lista que _urg_r1b_enviar_rodar recalcula e confere pelo hash. A regra
-- do vinculo vem SO dos helpers da 20261103170000 (nunca reimplementada aqui). Roda como postgres (EXECUTE revogado dos 3 papeis).
-- Regras do arquivo (pode ser embutido pelo psql como variavel dentro de um COPY): um unico SELECT, SEM ponto e virgula, sem
-- meta-comando do psql e sem dois-pontos seguido de letra fora de strings (por isso CAST, nunca o atalho de dois-pontos).
--
-- Universo: toda linha de cad_etiquetas (todas as lojas) cujo insumo tem tamanho_vinculado preenchido. ELEGIVEL quando valem todas:
--   CAD de modelo INTERNO (senao revenda_importado_sem_paridade | cad_sem_modelo | insumo_de_outra_loja), CAD NAO enviado ao PCP
--   (enviado_ao_pcp), vinculo EFETIVO (sem_vinculo_efetivo: insumo com tamanho proprio), grade do CAD COERENTE (grade_incompleta:
--   alguma variante sem celula por tamanho ou com soma das celulas diferente do total - as pecas do tamanho sao desconhecidas, nao 0),
--   enviar_por_tamanho vazio (enviar_por_tamanho_preenchido), "a enviar" gravado (a_enviar_vazio), antes <> depois (ja_no_valor_novo) e
--   antes = o AUTOMATICO ANTIGO round(consumo x grade total planejada do CAD, 2) com tolerancia 0,0001 (editado_a_mao).
--   depois = round(consumo x pecas do tamanho, 2) = a "necessaria" da Explosao (consumo x pecas de grades_planejadas do CAD).
--
-- Saida (ordem: resumo, elegivel, nao_elegivel, aviso_kanban, hash_lista - dentro da secao por loja, CAD e linha):
--   secao = 'resumo'        -> por loja e situacao/motivo: n = quantidade de linhas
--   secao = 'elegivel'      -> linha_canonica = tenant_id|cad_id|cad_etiqueta_id|modelo|insumo|tamanho|antes|depois ,
--                              situacao = a_corrigir | ja_corrigido - aviso (SO informativo, fora do hash) = fora_da_grade (o
--                              tamanho nao tem peca numa grade coerente: o "a enviar" vai a 0)
--   secao = 'nao_elegivel'  -> situacao = o motivo - info (SO informativo): editado_a_mao = gravado x automatico antigo (e "parece
--                              automatico de outra grade" quando o gravado e consumo x N inteiro - a grade mudou depois sem regravar o
--                              CAD; corrigir pelo Sheet) - grade_incompleta = as variantes que nao fecham (celulas x total)
--   secao = 'aviso_kanban'  -> CAD com linha elegivel que vai a 0 numa loja cujo kanban usa a condicao separar_enviar_preenchido:
--                              situacao = fica_falso (corrigindo TODAS as elegiveis do CAD, nada mais no CAD satisfaz a condicao: o card
--                              pode recuar no kanban automatico) | continua_verdadeiro
--   secao = 'hash_lista'    -> linha_canonica = md5 das linhas canonicas dos ELEGIVEIS unidas por quebra de linha na ordem
--                              (tenant_id, cad_id, cad_etiqueta_id) - md5('') se nenhum - situacao = 'n=<quantidade de elegiveis>'
-- O kit roda a correcao com o rodador NAO interativo supabase/consultas/urg_r1b_enviar_rodar.sql (psql -f com -v lista/hash/n).
WITH p AS (
  SELECT * FROM public._urg_r1b_enviar_previa()
), zero AS (
  SELECT DISTINCT p.tenant_id, p.cad_id, p.modelo
    FROM p
   WHERE p.elegivel AND p.depois = 0
     AND EXISTS (SELECT 1
                   FROM public.tenant_config tc
                   CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(tc.kanban_requisitos) = 'object'
                                                      THEN tc.kanban_requisitos ELSE CAST('{}' AS jsonb) END) r
                   CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.value) = 'array'
                                                                     THEN r.value ELSE CAST('[]' AS jsonb) END) k
                  WHERE tc.tenant_id = p.tenant_id AND k.value = 'separar_enviar_preenchido')
), kanban AS (
  SELECT z.tenant_id, z.cad_id, z.modelo,
         CASE WHEN EXISTS (SELECT 1 FROM public.cad_tecidos ct
                             JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
                            WHERE ct.cad_id = z.cad_id AND coalesce(ctv.metragem_enviada, 0) > 0)
                OR EXISTS (SELECT 1 FROM public.cad_aviamentos ca
                            WHERE ca.cad_id = z.cad_id AND coalesce(ca.quantidade_separar, 0) > 0)
                OR EXISTS (SELECT 1 FROM public.cad_etiquetas ce
                            WHERE ce.cad_id = z.cad_id AND coalesce(ce.quantidade_enviar, 0) > 0
                              AND NOT EXISTS (SELECT 1 FROM p p2
                                               WHERE p2.cad_etiqueta_id = ce.id AND p2.elegivel AND p2.depois = 0))
              THEN 'continua_verdadeiro' ELSE 'fica_falso' END AS situacao
    FROM zero z
)
SELECT x.secao, x.tenant_id, x.cad_id, x.cad_etiqueta_id, x.modelo, x.insumo, x.tamanho, x.antes, x.depois, x.situacao, x.aviso,
       x.info, x.n, x.linha_canonica
  FROM (
    SELECT 1 AS ordem, 'resumo' AS secao, p.tenant_id, CAST(NULL AS uuid) AS cad_id, CAST(NULL AS uuid) AS cad_etiqueta_id,
           CAST(NULL AS text) AS modelo, CAST(NULL AS text) AS insumo, CAST(NULL AS text) AS tamanho,
           CAST(NULL AS numeric) AS antes, CAST(NULL AS numeric) AS depois,
           coalesce(p.motivo, 'elegivel ' || p.situacao) AS situacao, CAST(NULL AS text) AS aviso, CAST(NULL AS text) AS info,
           CAST(count(*) AS integer) AS n, CAST(NULL AS text) AS linha_canonica
      FROM p
     GROUP BY p.tenant_id, coalesce(p.motivo, 'elegivel ' || p.situacao)
    UNION ALL
    SELECT CASE WHEN p.elegivel THEN 2 ELSE 3 END,
           CASE WHEN p.elegivel THEN 'elegivel' ELSE 'nao_elegivel' END,
           p.tenant_id, p.cad_id, p.cad_etiqueta_id, p.modelo, p.insumo, p.tamanho, p.antes, p.depois,
           CASE WHEN p.elegivel THEN p.situacao ELSE p.motivo END,
           p.aviso, p.info, CAST(NULL AS integer),
           CASE WHEN p.elegivel THEN p.linha END
      FROM p
    UNION ALL
    SELECT 4, 'aviso_kanban', k.tenant_id, k.cad_id, NULL, k.modelo, NULL, NULL, NULL, NULL, k.situacao, NULL, NULL, NULL, NULL
      FROM kanban k
    UNION ALL
    SELECT 5, 'hash_lista', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           'n=' || CAST(count(*) FILTER (WHERE p.elegivel) AS text), NULL, NULL,
           CAST(count(*) FILTER (WHERE p.elegivel) AS integer),
           md5(coalesce(string_agg(p.linha, E'\n' ORDER BY p.tenant_id, p.cad_id, p.cad_etiqueta_id) FILTER (WHERE p.elegivel), ''))
      FROM p
  ) x
 ORDER BY x.ordem, x.tenant_id, CASE WHEN x.ordem = 1 THEN x.situacao END, x.cad_id, x.cad_etiqueta_id
