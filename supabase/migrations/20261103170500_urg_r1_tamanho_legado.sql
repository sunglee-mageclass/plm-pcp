-- Urgentes R1 T2b - correcao UNICA do tamanho legado (P-307 B): reaproveita etiquetas.tamanho em etiquetas.tamanho_vinculado
-- SO com a lista aprovada pelo dono. GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a1.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/a-task-2b-brief.md (padrao da correcao de custo P-166, 20261019310000).
-- Esta migration NAO muda dado: cria
--   1) public._bkp_urg_r1_tamanho_legado (backup antes/depois; RLS ligada SEM policy; REVOKE ALL de PUBLIC, anon, authenticated, service_role);
--   2) _urg_r1_tamanho_legado_lista() (STABLE, DEFINER): a lista com o veredito por insumo e a linha canonica - o MESMO resultado
--      do SELECT so-leitura supabase/consultas/urg_r1_tamanho_legado_previa.sql (o Passo 0 do kit roda a previa; o dono aprova);
--   3) _urg_r1_tamanho_legado_rodar(_aprovado jsonb, _hash text, _n int) (DEFINER): a correcao, que o KIT roda com a lista aprovada:
--        BEGIN, SET LOCAL app.confirmo_tamanho_legado = 'sim', SELECT public._urg_r1_tamanho_legado_rodar(...), COMMIT
--      (sem a GUC recusa; hash/n da lista de agora diferentes do aprovado = P0001 lista_mudou e nada grava; liga SO os aprovados com
--      vinculo vazio, nunca sobrescreve; idempotente).
-- As 2 funcoes: SECURITY DEFINER, search_path=public, EXECUTE revogado de PUBLIC, anon, authenticated.
-- Efeito colateral DA CORRECAO (nao desta migration): com a 171000 viva, ligar o vinculo enfileira o custo previsto dos modelos
-- internos NAO cortados que usam o insumo (cortados ficam congelados - Ruling A4).
-- Trava: so catalogo e a tabela NOVA (CREATE TABLE/FUNCTION; AccessShare em etiquetas, variantes_etiqueta, modelo_etiquetas,
-- modelos e tenant_config pela validacao do corpo SQL da lista - nao bloqueia leitura nem escrita). MEDIDO na copia (supautils
-- carregado, por diferenca de pg_locks): nada em auth/storage/realtime. Qualquer hora. Idempotente.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._urg_r1_tamanho_legado_lista()  DEPOIS f4445fa3dda66d27ba08faa7c8030991  NEUTRO ec571c054460a10676852e532c931e03
--   public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)  DEPOIS cb855927bc56a6edb0391c78cc390621  NEUTRO f7d613fb53dbaef6be59c467bbaad580
--   (ANTES: ausentes) - exige a 20261103170000 viva: public._insumo_tamanho_efetivo = c3cdade8a88d585492eeb6a01205ce3e
-- ====================================================================================
-- Volta (LIFO): supabase/rollback/20261103170500_urg_r1_tamanho_legado_down.sql (devolve o "antes" SO onde ainda vale o "depois", relata o que a pessoa
-- mudou e NEUTRALIZA as 2 funcoes; a tabela de backup fica) - ANTES do 20261103170000_down. DROP: supabase/rollback/20261103170500_urg_r1_tamanho_legado_down_drop.sql
-- (opcional, depois; apagar o backup com linhas exige SET LOCAL app.confirmo_apagar_backup_tamanho_legado = 'sim').
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public._insumo_tamanho_efetivo(text,text,boolean)'))) IS DISTINCT FROM 'c3cdade8a88d585492eeb6a01205ce3e'
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'etiquetas'
                      AND column_name = 'tamanho_vinculado' AND data_type = 'text') THEN
    RAISE EXCEPTION 'urg_r1_170500: a 20261103170000 (coluna tamanho_vinculado + helpers) nao esta aplicada - aplique-a antes' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._urg_r1_tamanho_legado_lista()', 'f4445fa3dda66d27ba08faa7c8030991', 'ec571c054460a10676852e532c931e03'),
      ('public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)', 'cb855927bc56a6edb0391c78cc390621', 'f7d613fb53dbaef6be59c467bbaad580')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'urg_r1_170500: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regclass('public._bkp_urg_r1_tamanho_legado') IS NOT NULL
     AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
            FROM pg_attribute a WHERE a.attrelid = to_regclass('public._bkp_urg_r1_tamanho_legado') AND a.attnum > 0 AND NOT a.attisdropped)
         IS DISTINCT FROM 'id:bigint:true,etiqueta_id:uuid:true,tenant_id:uuid:true,antes:text:false,depois:text:true,rodado_em:timestamp with time zone:true,restaurado_em:timestamp with time zone:false' THEN
    RAISE EXCEPTION 'urg_r1_170500: public._bkp_urg_r1_tamanho_legado ja existe com outro formato' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE TABLE IF NOT EXISTS public._bkp_urg_r1_tamanho_legado (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  etiqueta_id uuid        NOT NULL,
  tenant_id   uuid        NOT NULL,
  antes       text,
  depois      text        NOT NULL,
  rodado_em   timestamptz NOT NULL DEFAULT now(),
  restaurado_em timestamptz
);
COMMENT ON TABLE public._bkp_urg_r1_tamanho_legado IS
  'Correcao unica do tamanho legado (urg R1 T2b, P-307 B, 20261103170500): vinculo de tamanho de cada insumo ANTES e DEPOIS de _urg_r1_tamanho_legado_rodar. O _down devolve o antes onde ainda vale o depois e marca restaurado_em (cada gravacao volta uma vez so). RLS sem policy e sem grant: so o dono (postgres) le.';
ALTER TABLE public._bkp_urg_r1_tamanho_legado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_urg_r1_tamanho_legado FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public._bkp_urg_r1_tamanho_legado_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._urg_r1_tamanho_legado_lista()
 RETURNS TABLE(tenant_id uuid, etiqueta_id uuid, nome text, valor text, n_modelos integer, elegivel boolean, motivo text, vinculo_atual text, linha text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [urg r1 T2b] lista da correcao unica do tamanho legado (P-307 B): todo insumo com etiquetas.tamanho nao vazio, de todas as
  -- lojas, com o veredito. ELEGIVEL = (1) btrim(tamanho) existe exato em tenant_config.tamanhos_grade da loja (fora_da_grade);
  -- (2) _insumo_tamanho_efetivo(valor, formato, tem variante com tamanho) devolve o valor (com_tamanho_proprio); (3) o NOME, sem
  -- acento e sem caixa, tem o lado numerico como palavra inteira OU a sigla logo depois de "TAM." / "TAMANHO " (nome_nao_casa).
  -- A 4a regra (vinculo ainda vazio) fica FORA do veredito e do hash: vinculo_atual e conferido na hora de gravar. A regra 3 nunca
  -- passa por NULL (valor so-numero ou terminado em barra, sem sigla: so o lado numerico vale).
  -- linha = tenant_id|etiqueta_id|nome|valor|n_modelos (forma canonica; o hash aprovado = md5 das linhas elegiveis unidas por
  -- quebra de linha na ordem tenant_id, etiqueta_id). Espelho SO-LEITURA: supabase/consultas/urg_r1_tamanho_legado_previa.sql.
  WITH base AS (
    SELECT e.id AS etiqueta_id,
           e.tenant_id,
           CAST(e.nome AS text) AS nome,
           btrim(e.tamanho) AS valor,
           e.formato_tamanho AS formato,
           nullif(btrim(e.tamanho_vinculado), '') AS vinculo_atual,
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
                WHEN public._insumo_tamanho_efetivo(l.valor, l.formato, l.tem_var) IS NULL THEN 'com_tamanho_proprio'
                WHEN NOT coalesce((l.num IS NOT NULL AND l.nome_n ~ ('\y' || l.num || '\y'))
                                  OR (l.sigla IS NOT NULL AND l.sigla ~ '^[A-Z0-9]+$'
                                      AND l.nome_n ~ ('\yTAM(\.|ANHO\s)\s*' || l.sigla || '\y')), false)
                  THEN 'nome_nao_casa'
           END AS motivo,
           coalesce(CAST(l.tenant_id AS text), '') || '|' || CAST(l.etiqueta_id AS text) || '|' || l.nome || '|' || l.valor || '|'
             || CAST(l.n_modelos AS text) AS linha
      FROM lados l
  )
  SELECT c.tenant_id, c.etiqueta_id, c.nome, c.valor, c.n_modelos, c.motivo IS NULL, c.motivo, c.vinculo_atual, c.linha
    FROM cls c
$function$;
REVOKE EXECUTE ON FUNCTION public._urg_r1_tamanho_legado_lista() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._urg_r1_tamanho_legado_rodar(_aprovado jsonb, _hash text, _n integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg r1 T2b] correcao UNICA do tamanho legado (P-307 B), SO com a lista aprovada pelo dono (padrao da P-166):
--   BEGIN, SET LOCAL app.confirmo_tamanho_legado = 'sim', SELECT _urg_r1_tamanho_legado_rodar(<linhas>, <hash_lista>, <n>), COMMIT.
-- _aprovado = array jsonb das linhas canonicas aprovadas (todas ou parte das elegiveis da previa); _hash/_n = o hash_lista e o n da
-- previa INTEIRA. 1) sem a GUC: recusa. 2) recalcula a lista de agora (travas: variantes_etiqueta em SHARE e depois as linhas de
-- etiquetas com tamanho legado FOR UPDATE - a mesma ordem de quem grava variante, cujo gatilho de preco grava etiquetas) e confere
-- hash e n: divergiu = P0001 lista_mudou (nada grava). 3) linha aprovada fora da lista de agora = P0001 fora_da_lista. 4) grava SO
-- os aprovados com vinculo ainda vazio (btrim) - nunca sobrescreve - com backup antes/depois em _bkp_urg_r1_tamanho_legado.
-- Devolve {ligados, pulados:[{id, motivo}], hash, n}; motivo = ja_corrigido_antes (ja tem gravacao no backup: nunca religa o que
-- a pessoa desligou depois; so gravacao ainda nao devolvida pelo _down) | ja_vinculado | nao_aprovado | o motivo da lista. Idempotente: a 2a execucao liga 0. Efeito colateral: com a 171000 viva, o gatilho de etiquetas enfileira o custo previsto
-- dos modelos internos NAO cortados que usam o insumo (os cortados ficam congelados).
DECLARE
  v_aprov text[];
  v_hash text;
  v_n integer;
  v_fora integer;
  v_fora_ids text;
  v_ligados integer := 0;
  v_pulados jsonb;
BEGIN
  IF coalesce(current_setting('app.confirmo_tamanho_legado', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'confirmacao_ausente: rode dentro de BEGIN com SET LOCAL app.confirmo_tamanho_legado = sim'
      USING ERRCODE = 'P0001';
  END IF;
  IF _aprovado IS NULL OR jsonb_typeof(_aprovado) <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(_aprovado) x WHERE jsonb_typeof(x) <> 'string') THEN
    RAISE EXCEPTION 'lista_invalida: _aprovado tem de ser um array jsonb de linhas canonicas (texto)' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(array_agg(x ORDER BY x), '{}'::text[]) INTO v_aprov FROM jsonb_array_elements_text(_aprovado) x;
  IF cardinality(v_aprov) <> (SELECT count(DISTINCT x) FROM unnest(v_aprov) x) THEN
    RAISE EXCEPTION 'lista_invalida: linha repetida na lista aprovada' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('lock_timeout', '3s', true);
  LOCK TABLE public.variantes_etiqueta IN SHARE MODE;
  PERFORM 1 FROM public.etiquetas e WHERE nullif(btrim(e.tamanho), '') IS NOT NULL ORDER BY e.id FOR UPDATE;

  SELECT md5(coalesce(string_agg(l.linha, E'\n' ORDER BY l.tenant_id, l.etiqueta_id), '')), count(*)::integer
    INTO v_hash, v_n
    FROM public._urg_r1_tamanho_legado_lista() l
   WHERE l.elegivel;
  IF v_hash IS DISTINCT FROM _hash OR v_n IS DISTINCT FROM _n THEN
    RAISE EXCEPTION 'lista_mudou: a lista de agora tem hash % e n % (aprovado: hash %, n %) - gere a previa e aprove de novo',
      v_hash, v_n, coalesce(_hash, 'null'), coalesce(_n::text, 'null') USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer,
         string_agg(CASE WHEN split_part(a, '|', 2) ~ '^[0-9a-f-]{36}$' THEN split_part(a, '|', 2) ELSE '?' END, ', ')
    INTO v_fora, v_fora_ids
    FROM unnest(v_aprov) a
   WHERE NOT EXISTS (SELECT 1 FROM public._urg_r1_tamanho_legado_lista() l WHERE l.elegivel AND l.linha = a);
  IF v_fora > 0 THEN
    RAISE EXCEPTION 'fora_da_lista: % linha(s) aprovada(s) nao estao na lista de agora (etiqueta %)', v_fora, v_fora_ids
      USING ERRCODE = 'P0001';
  END IF;

  -- [M-1] correcao UNICA: insumo que ja tem gravacao EM VIGOR no backup (corrigido numa rodada anterior e ainda nao devolvido por
  -- um _down - restaurado_em vazio) nunca e religado - a pessoa pode te-lo desligado de proposito depois. [M-1b] gravacao ja
  -- devolvida nao conta: _down -> ida -> nova rodada aprovada liga de novo (a auditoria da 1a rodada fica no backup).
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.etiqueta_id, 'motivo',
           CASE WHEN NOT l.elegivel THEN l.motivo
                WHEN NOT (l.linha = ANY (v_aprov)) THEN 'nao_aprovado'
                WHEN EXISTS (SELECT 1 FROM public._bkp_urg_r1_tamanho_legado k WHERE k.etiqueta_id = l.etiqueta_id AND k.restaurado_em IS NULL)
                  THEN 'ja_corrigido_antes'
                ELSE 'ja_vinculado' END) ORDER BY l.tenant_id, l.etiqueta_id), '[]'::jsonb)
    INTO v_pulados
    FROM public._urg_r1_tamanho_legado_lista() l
   WHERE NOT l.elegivel OR NOT (l.linha = ANY (v_aprov)) OR l.vinculo_atual IS NOT NULL
      OR EXISTS (SELECT 1 FROM public._bkp_urg_r1_tamanho_legado k WHERE k.etiqueta_id = l.etiqueta_id AND k.restaurado_em IS NULL);

  WITH alvo AS (
    SELECT l.etiqueta_id, l.tenant_id, l.valor, e.tamanho_vinculado AS antes
      FROM public._urg_r1_tamanho_legado_lista() l
      JOIN public.etiquetas e ON e.id = l.etiqueta_id
     WHERE l.elegivel AND l.linha = ANY (v_aprov) AND l.vinculo_atual IS NULL
       AND NOT EXISTS (SELECT 1 FROM public._bkp_urg_r1_tamanho_legado k WHERE k.etiqueta_id = l.etiqueta_id AND k.restaurado_em IS NULL)
  ), upd AS (
    UPDATE public.etiquetas e
       SET tamanho_vinculado = a.valor
      FROM alvo a
     WHERE e.id = a.etiqueta_id AND e.tenant_id = a.tenant_id
       AND nullif(btrim(e.tamanho_vinculado), '') IS NULL
    RETURNING e.id, e.tenant_id, a.antes, a.valor
  ), ins AS (
    INSERT INTO public._bkp_urg_r1_tamanho_legado (etiqueta_id, tenant_id, antes, depois)
    SELECT u.id, u.tenant_id, u.antes, u.valor FROM upd u
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_ligados FROM ins;

  IF EXISTS (SELECT 1 FROM public._urg_r1_tamanho_legado_lista() l
              WHERE l.elegivel AND l.linha = ANY (v_aprov) AND l.vinculo_atual IS NULL
                AND NOT EXISTS (SELECT 1 FROM public._bkp_urg_r1_tamanho_legado k WHERE k.etiqueta_id = l.etiqueta_id AND k.restaurado_em IS NULL)) THEN
    RAISE EXCEPTION 'pos_condicao: insumo aprovado ficou sem vinculo - nada gravado' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('ligados', v_ligados, 'pulados', v_pulados, 'hash', v_hash, 'n', v_n);
END
$function$;
REVOKE EXECUTE ON FUNCTION public._urg_r1_tamanho_legado_rodar(jsonb,text,integer) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  r record;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public._urg_r1_tamanho_legado_lista()'))) IS DISTINCT FROM 'f4445fa3dda66d27ba08faa7c8030991'
     OR md5(pg_get_functiondef(to_regprocedure('public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)'))) IS DISTINCT FROM 'cb855927bc56a6edb0391c78cc390621' THEN
    RAISE EXCEPTION 'urg_r1_170500: pos-condicao falhou no texto das funcoes' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('public._urg_r1_tamanho_legado_lista()'), ('public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)')) AS x(f) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND p.prosecdef
                     AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r1_170500: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public._bkp_urg_r1_tamanho_legado'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public._bkp_urg_r1_tamanho_legado'::regclass)
     OR has_table_privilege('anon', 'public._bkp_urg_r1_tamanho_legado', 'SELECT') OR has_table_privilege('authenticated', 'public._bkp_urg_r1_tamanho_legado', 'SELECT')
     OR has_table_privilege('authenticated', 'public._bkp_urg_r1_tamanho_legado', 'INSERT') OR has_table_privilege('authenticated', 'public._bkp_urg_r1_tamanho_legado', 'UPDATE')
     OR has_table_privilege('authenticated', 'public._bkp_urg_r1_tamanho_legado', 'DELETE') THEN
    RAISE EXCEPTION 'urg_r1_170500: pos-condicao falhou na RLS/privilegios de public._bkp_urg_r1_tamanho_legado' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
