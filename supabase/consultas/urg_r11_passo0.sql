-- Urgentes R11 (plan-r11, Peca Teste - mini explosao) - PASSO 0 do kit (SO LEITURA). Rodar ANTES da ida da R11
-- (199000 -> 199100 -> 199200 -> 199300 -> 199400), DEPOIS da R9 (192000..196000) ja estar no banco.
-- Como `postgres` (dono das tabelas): psql -X -v ON_ERROR_STOP=1 -f supabase/consultas/urg_r11_passo0.sql
-- Tudo numa txn READ ONLY que termina em ROLLBACK (nada grava). Funciona com o banco ANTES da R11 (sem as 3 tabelas/coluna/funcoes
-- novas: usa to_regclass/to_regprocedure para nao quebrar) e DEPOIS dela (os md5 aceitam {ANTES, DEPOIS} nos 2 cores redefinidos).
-- PARE (leve ao dono) se: 0-A com algum ok = f; 0-B > 0; 0-C com algum "presente" = t (banco ANTES da R11); 0-D com R9/R1b = f;
-- 0-E varredura > 0 em qualquer das 6 colunas; 0-G > 0.
\pset pager off
BEGIN READ ONLY;

\echo '== 0-A: quem roda + md5 dos 7 objetos que a R11 redefine/cria por cima da R9 (aceita ANTES ou DEPOIS) + default ACL =='
SELECT 'current_user' AS item, current_user::text AS valor, (current_user = 'postgres') AS ok;
SELECT x.f AS funcao, coalesce(substring(md5(pg_get_functiondef(to_regprocedure(x.f))),1,12), 'ausente') AS md5_vivo, x.esperado,
       md5(pg_get_functiondef(to_regprocedure(x.f))) = ANY (x.aceitos) AS ok
  FROM (VALUES
    -- os 2 cores da R9 que a 199400 redefine: ANTES = R9 | DEPOIS = R11
    ('public._salvar_peca_teste_core(uuid,jsonb,jsonb)', 'eccde92e (antes R9) | 3e3b9db2 (depois R11)',
      ARRAY['eccde92e1c6687045f8f7c9ae61caf8f', '3e3b9db2d04dd176a4712898293f8545']),
    ('public._peca_teste_trilhas_core(uuid,uuid)', '5ae0f702 (antes R9) | ef860a61 (depois R11)',
      ARRAY['5ae0f7025744d63508d7617e6e3a7487', 'ef860a61e25750d2d12131062a23202d'])
  ) AS x(f, esperado, aceitos)
 ORDER BY 1;
-- funcoes novas da R11 (199300/199400): "ausente" ANTES da ida; o md5 e conferido na POS-IDA pelo cabecalho das migrations.
SELECT x.f AS funcao_nova, (to_regprocedure(x.f) IS NOT NULL) AS presente_ja
  FROM (VALUES
    ('public._peca_teste_mini_aplicar(uuid,uuid,jsonb)'),
    ('public._peca_teste_trilha_mini(uuid)'),  -- r11e (199400)
    ('public._peca_teste_mini_baixar(uuid,jsonb)'),
    ('public._peca_teste_mini_estornar(uuid)'),
    ('public._peca_teste_mini_linhas(uuid,text,uuid,jsonb)'),
    ('public.peca_teste_mini_estoque(uuid)')
  ) AS x(f) ORDER BY 1;

\echo '== 0-B: nenhuma funcao _custo%/custo_unitario% le o ledger novo nem as tabelas da mini (P-343 A, inv. 15) - esperado 0 =='
SELECT count(*) AS custo_cita_ledger_ou_mini
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND (p.proname LIKE '\_custo%' OR p.proname LIKE 'custo\_unitario%')
   AND p.prosrc ~ '(estoque_peca_teste_baixas|modelo_peca_teste_mini)';

\echo '== 0-C: 3 tabelas da mini + a coluna do ledger do tecido - "presente" deve ser f ANTES da ida (t = a R11 ja esta aplicada) =='
SELECT 'modelo_peca_teste_mini' AS obj, (to_regclass('public.modelo_peca_teste_mini') IS NOT NULL) AS presente
UNION ALL SELECT 'modelo_peca_teste_mini_linhas', (to_regclass('public.modelo_peca_teste_mini_linhas') IS NOT NULL)
UNION ALL SELECT 'estoque_peca_teste_baixas', (to_regclass('public.estoque_peca_teste_baixas') IS NOT NULL)
UNION ALL SELECT 'estoque_tecido_baixas.peca_teste_tentativa_id',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
            AND table_name='estoque_tecido_baixas' AND column_name='peca_teste_tentativa_id');

\echo '== 0-D: a R9 (Peca Teste) e a R1b (Enviar a Explosao) estao vivas (dependencias da R11) =='
SELECT x.f AS objeto, (to_regprocedure(x.f) IS NOT NULL) AS existe
  FROM (VALUES
    ('public.salvar_peca_teste(uuid,jsonb,jsonb)'),
    ('public.peca_teste_modelo(uuid)'),
    ('public.peca_teste_quadro()'),
    ('public._peca_teste_aprovada(uuid,uuid,uuid)'),
    ('public._urg_r1b_enviar_previa()')
  ) AS x(f) ORDER BY 1;

\echo '== 0-E: varredura do extrato = 0 nas 6 colunas *_diverge/*_fora (reconciliacao; fonte: urg_r3_extrato_varredura.sql) =='
-- inline do SELECT de supabase/consultas/urg_r3_extrato_varredura.sql (o arquivo canonico e a fonte do anti-drift
-- urg-a3-extrato-reconcilia.test.ts). Copia LITERAL aqui so para o Passo 0 rodar via stdin (sem \i de caminho do host).
WITH tc AS (SELECT t.id AS tenant, x.variante_tecido_id AS item, x.recebido_m AS rec, x.baixa FROM public.tenants t CROSS JOIN LATERAL public._estoque_tecido_core(t.id) x),
te AS (SELECT c.tenant, c.item, e.* FROM tc c CROSS JOIN LATERAL public._estoque_extrato_tecido_core(c.tenant, c.item) e),
ts AS (SELECT tenant, item, sum(quantidade) AS s, count(*) AS n FROM te GROUP BY 1, 2),
ac AS (SELECT t.id AS tenant, x.id AS item, x.variante_id AS var, x.recebido AS rec, x.baixa FROM public.tenants t CROSS JOIN LATERAL public._estoque_aviamento_core(t.id) x),
ae AS (SELECT i.tenant, i.item, e.* FROM (SELECT DISTINCT tenant, item FROM ac) i CROSS JOIN LATERAL public._estoque_extrato_aviamento_core(i.tenant, i.item) e),
asx AS (SELECT tenant, item, bucket_variante_id AS var, sum(quantidade) AS s, count(*) AS n FROM ae GROUP BY 1, 2, 3),
ic AS (SELECT tenant, item, tam, cn, sum(rec) AS rec, sum(baixa) AS baixa
         FROM (SELECT DISTINCT t.id AS tenant, x.etiqueta_id AS item, x.tamanho AS tam, x.cor_nome AS cn, x.recebido AS rec, x.prev_receb, x.baixa, x.fisico
                 FROM public.tenants t CROSS JOIN LATERAL public._estoque_etiqueta_core(t.id) x) d GROUP BY 1, 2, 3, 4),
ie AS (SELECT i.tenant, i.item, e.* FROM (SELECT DISTINCT tenant, item FROM ic) i CROSS JOIN LATERAL public._estoque_extrato_insumo_core(i.tenant, i.item) e),
isx AS (SELECT tenant, item, bucket_tamanho AS tam, bucket_cor_nome AS cn, sum(quantidade) AS s, count(*) AS n FROM ie GROUP BY 1, 2, 3, 4)
SELECT (SELECT count(*) FROM tc c LEFT JOIN ts s ON s.tenant = c.tenant AND s.item = c.item WHERE coalesce(s.s, 0) <> c.rec - c.baixa)::int AS tecido_diverge,
       (SELECT count(*) FROM te WHERE bucket_variante_id IS DISTINCT FROM item)::int AS tecido_fora,
       (SELECT count(*) FROM ac c LEFT JOIN asx s ON s.tenant = c.tenant AND s.item = c.item AND s.var IS NOT DISTINCT FROM c.var
         WHERE coalesce(s.s, 0) <> c.rec - c.baixa)::int AS aviamento_diverge,
       (SELECT count(*) FROM asx s WHERE NOT EXISTS (SELECT 1 FROM ac c WHERE c.tenant = s.tenant AND c.item = s.item AND c.var IS NOT DISTINCT FROM s.var))::int AS aviamento_fora,
       (SELECT count(*) FROM ic c LEFT JOIN isx s ON s.tenant = c.tenant AND s.item = c.item AND s.tam IS NOT DISTINCT FROM c.tam AND s.cn IS NOT DISTINCT FROM c.cn
         WHERE coalesce(s.s, 0) <> c.rec - c.baixa)::int AS insumo_diverge,
       (SELECT count(*) FROM isx s WHERE NOT EXISTS (SELECT 1 FROM ic c WHERE c.tenant = s.tenant AND c.item = s.item AND c.tam IS NOT DISTINCT FROM s.tam
                                                       AND c.cn IS NOT DISTINCT FROM s.cn))::int AS insumo_fora;

\echo '== 0-F: tamanho da fila do kanban (so informativo; a R11 enfileira recalculos inocuos pelo cabecalho da mini) =='
SELECT count(*) AS kanban_recalculo_fila FROM public.kanban_recalculo_fila;

\echo '== 0-G: lojas com Criacao e SEM Entrada e Saida (nelas a mini fica escondida; o servidor recusa mini) - esperado 0 =='
SELECT count(*) AS lojas_criacao_sem_es
  FROM public.tenant_config tc
 WHERE public._tenant_modulo_ligado(tc.tenant_id, 'criacao')
   AND NOT public._tenant_modulo_ligado(tc.tenant_id, 'entrada_saida');

ROLLBACK;
