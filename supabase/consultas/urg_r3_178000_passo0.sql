-- Passo 0 (SO LEITURA) da 20261103178000_urg_r3_audit_registro_idx (urgentes R3 T14, fix round 1 M1) - rodar LOGO ANTES da ida.
-- O CREATE INDEX CONCURRENTLY espera TODA transacao aberta antes dele terminar (fases 2/3), e essa espera conta no lock_timeout da ida
-- (60s) - uma transacao velha (idle in transaction, backup/pg_dump, consulta analitica, conexao presa do pooler) faz a ida esperar ou,
-- passando de 60 s, cair no meio e deixar o indice INVALIDO (saida: o _down_drop e a ida de novo).
-- Lista as transacoes abertas ha mais de 30 s no banco (fora esta sessao). Vazio = pode rodar. Linhas = esperar terminarem ou tratar
-- (avisar o dono antes de encerrar qualquer sessao). Nada e gravado.
SELECT a.pid,
       a.usename,
       a.application_name,
       a.client_addr,
       a.state,
       a.backend_type,
       now() - a.xact_start AS transacao_aberta_ha,
       now() - a.state_change AS no_estado_ha,
       a.wait_event_type,
       a.wait_event,
       left(regexp_replace(a.query, '\s+', ' ', 'g'), 160) AS consulta
  FROM pg_stat_activity a
 WHERE a.pid <> pg_backend_pid()
   AND a.datname = current_database()
   AND a.xact_start IS NOT NULL
   AND a.xact_start < now() - interval '30 seconds'
 ORDER BY a.xact_start;
