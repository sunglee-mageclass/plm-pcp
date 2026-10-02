-- PREVIA EXATA (achados MEDIOS R15a, P-214 B, dono 01/out): o que a correcao unica _p214_completar_faltas completaria
-- AGORA - a lista 'cad_id|variante_id|metros', o HASH e o ESPERADO por loja que o dono aprova e o kit passa a ela.
-- Exige a ida da R15a com a 20261025310000 (a funcao _p214_previa). Nao grava nada: a _p214_previa roda o helper P-203 de
-- verdade (sem drift entre previa e execucao) num sub-bloco que ela mesma SEMPRE desfaz, e esta consulta ainda termina em
-- ROLLBACK. NAO pode ser READ ONLY: o helper escreve (e desfaz) dentro do sub-bloco; por isso pega a trava do corte de cada
-- loja envolvida por um instante (ate 3 s). Rodar em horario calmo. Rodar de novo no pos-deploy (L8): lista vazia = nada
-- parado; lista com itens = completacao que falhou ou ficou para o proximo evento.
-- Saida 1: hash e esperado (cole os dois na aprovacao). Saida 2: a lista, com loja e modelo para o dono conferir.

BEGIN;

SELECT p->>'hash' AS hash, p->'esperado' AS esperado, jsonb_array_length(p->'linhas') AS linhas
  FROM (SELECT public._p214_previa() AS p) x;

SELECT COALESCE(tn.nome::text, '?') AS loja, left(split_part(l, '|', 1), 8) AS cad8, m.nome AS modelo,
       left(split_part(l, '|', 2), 8) AS variante8, split_part(l, '|', 3) AS metros, l AS linha_canonica
  FROM (SELECT public._p214_previa() AS p) x
  CROSS JOIN LATERAL jsonb_array_elements_text(x.p->'linhas') l
  LEFT JOIN public.cad cd ON cd.id = split_part(l, '|', 1)::uuid
  LEFT JOIN public.modelos m ON m.id = cd.modelo_id
  LEFT JOIN public.tenants tn ON tn.id = cd.tenant_id
 ORDER BY 1, 2, 4;

ROLLBACK;
