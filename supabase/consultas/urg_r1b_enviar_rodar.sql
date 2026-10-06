-- urg_r1b_enviar_rodar.sql - RODADOR do kit da correcao unica do "a enviar" dos insumos vinculados a UM tamanho (urg R1b, P-337 A,
-- migration 20261103198000). GRAVA DADO: so com a lista que o DONO aprovou na previa supabase/consultas/urg_r1b_enviar_previa.sql
-- (rodada no MESMO passo, logo antes). Rodar SEMPRE num UNICO comando NAO interativo (nunca colar no psql interativo: a transacao
-- aberta seguraria as travas do _rodar - linhas de cad/cad_etiquetas dos CADs candidatos e SHARE em variantes_etiqueta de TODAS as
-- lojas - enquanto alguem le a tela):
--   psql <url> -X -v ON_ERROR_STOP=1 -A -t \
--        -v lista='<array jsonb das linhas canonicas aprovadas>' -v hash='<hash_lista da previa>' -v n=<n da previa> \
--        -f supabase/consultas/urg_r1b_enviar_rodar.sql
-- (as variaveis do psql so sao trocadas em arquivo -f; o kit confere ANTES o sha256 da lista aprovada). Receita (molde da correcao
-- unica da release 8 e da correcao-r1 da Onda 1): BEGIN, timeouts LOCAIS, SET LOCAL app.confirmo_enviar_tamanho = 'sim',
-- SELECT _urg_r1b_enviar_rodar(...), COMMIT. A confirmacao e LOCAL (morre no COMMIT/ROLLBACK). Se a funcao recusar (P0001
-- lista_mudou / fora_da_lista / confirmacao_ausente / lista_invalida / pos_condicao) ou estourar um tempo, NADA fica gravado (uma
-- transacao so). Trava/impasse (55P03/40P01): nada gravou; rodar de novo (refazendo a previa), em horario calmo.
-- Tempos: lock_timeout 1500ms (cada espera de trava - a funcao respeita este valor), statement_timeout 60s (o _rodar recalcula a
-- lista algumas vezes: ~0,3 s na copia), transaction_timeout 60s, idle_in_transaction_session_timeout 15s (se algo parar entre os
-- comandos, a sessao cai e a transacao e desfeita). Conferir o JSON devolvido DEPOIS do COMMIT (ele tambem fica no backup
-- _bkp_urg_r1b_enviar).
\set ON_ERROR_STOP on
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL idle_in_transaction_session_timeout = '15s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '60s';
SET LOCAL lock_timeout = '1500ms';
SET LOCAL app.confirmo_enviar_tamanho = 'sim';
SELECT 'r1b_correcao_resultado ' || public._urg_r1b_enviar_rodar(:'lista'::jsonb, :'hash', :n)::text AS resultado;
COMMIT;
