-- F6 Fluxo 2 (Bloco A + Bloco B): requisitos CONFIGURAVEIS do "Enviar a Explosao".
--   Task 1 (Bloco A):
--     1) coluna NOVA public.tenant_config.explosao_requisitos jsonb NOT NULL DEFAULT '[]'::jsonb (ADD COLUMN: AccessExclusive por ms em
--        tenant_config - tentativa atomica com lock_timeout 1500ms, ate 3x; padrao da R12/F1 C). [] = opt-in (banco identico a hoje).
--     2) salvar_config_loja (CREATE OR REPLACE por troca EXATA sobre o texto vivo, 3 ancoras 1x cada; ACL/DEFINER/search_path preservados):
--        a coluna entra na lista branca, na validacao (array nao-null, igual revenda_kanban_colunas) e no UPDATE estatico; o
--        compare-and-set por coluna e o generico (P0409 conflito_versao: config_loja, DETAIL explosao_requisitos). NAO entra em c_kanban.
--   Task 2 (Bloco B):
--     3) _enviar_modelo_para_cad_core (CREATE OR REPLACE por troca EXATA sobre o texto vivo, 1 ancora 1x): gate dos requisitos
--        CONFIGURADOS logo APOS o gate de etapa e ANTES da escrita. Lista vazia pula tudo (opt-in). Modulo desligado = satisfeita
--        (o avaliador ja aplica _kanban_cond_na). Recusa ASCII P0001 'explosao_requisito_faltando: <keys>'.
-- ATENCAO: o 4o arg de salvar_config_loja e BOOLEAN (_chave_kanban_esperada), NAO text.
-- ACCEPTED-MD5  public.salvar_config_loja(uuid,jsonb,jsonb,boolean)         ANTES 6d35eb844c03afebccdc110e970f46d0
-- ACCEPTED-MD5  public._enviar_modelo_para_cad_core(uuid,text,text)         ANTES 6c5fc00819b4211eb08d20a1d271c9b2
-- Volta: supabase/rollback/20261124100000_f6_explosao_requisitos_down.sql (devolve as 2 funcoes; a coluna fica inerte);
--        drop opcional da coluna: ..._down_drop.sql.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v text;
BEGIN
  -- aceita ANTES (6d35) e DEPOIS (36e6) para reaplicar sem erro (idempotente).
  v := md5(pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)')));
  IF v IS NULL OR v NOT IN ('6d35eb844c03afebccdc110e970f46d0', '36e6821ce97b3f2542cd3633c065a7a1') THEN
    RAISE EXCEPTION 'f6_explosao: salvar_config_loja com texto inesperado (md5 %) - outra frente mexeu; gere de novo', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
  -- (o guard do _core e do avaliador entra na Task 2, no mesmo bloco de guarda abaixo)
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tenant_config'::regclass AND attname = 'explosao_requisitos' AND NOT attisdropped)
     AND NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                      WHERE a.attrelid = 'public.tenant_config'::regclass AND a.attname = 'explosao_requisitos' AND NOT a.attisdropped
                        AND a.atttypid = 'jsonb'::regtype AND a.attnotnull AND pg_get_expr(d.adbin, d.adrelid) = '''[]''::jsonb') THEN
    RAISE EXCEPTION 'f6_explosao: tenant_config.explosao_requisitos existe com outra forma' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- 1) coluna NOVA (idempotente; tentativa atomica com AccessExclusive por ms, ate 3x)
DO $col$
DECLARE
  i int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tenant_config'::regclass AND attname = 'explosao_requisitos' AND NOT attisdropped) THEN
    RETURN;
  END IF;
  FOR i IN 1..3 LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '1500ms', true);
      LOCK TABLE public.tenant_config IN ACCESS EXCLUSIVE MODE;
      ALTER TABLE public.tenant_config ADD COLUMN explosao_requisitos jsonb NOT NULL DEFAULT '[]'::jsonb;
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      IF i = 3 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END
$col$;

COMMENT ON COLUMN public.tenant_config.explosao_requisitos IS 'F6 Fluxo 2: cond_keys (kanban-condicoes) que o Enviar a Explosao exige, todas em E; [] = opt-in (como hoje). Gravado SO por salvar_config_loja (compare-and-set por coluna).';

-- 2) salvar_config_loja: troca EXATA sobre o texto vivo (cada ancora tem que aparecer exatamente 1x; senao recusa e nada muda).
DO $troca$
DECLARE
  d text;
  a text[];
  b text[];
  i int;
BEGIN
  a := ARRAY[
    $x$    'tab_labels', 'campos_editaveis', 'insumos_padrao', 'aprovar_custo_auto_por_versao',
    'plan_tecido_oc_bloqueia_lancado'];$x$,
    $x$      WHEN 'revenda_kanban_colunas' THEN$x$,
    $x$                                           ELSE plan_tecido_oc_bloqueia_lancado END
  WHERE tenant_id = v_tenant$x$];
  b := ARRAY[
    $x$    'tab_labels', 'campos_editaveis', 'insumos_padrao', 'aprovar_custo_auto_por_versao',
    'plan_tecido_oc_bloqueia_lancado', 'explosao_requisitos'];$x$,
    $x$      WHEN 'explosao_requisitos' THEN
        IF v_t = 'null' THEN
          RAISE EXCEPTION 'O campo "%" não pode ficar vazio.', v_k USING ERRCODE = 'P0001';
        ELSIF v_t <> 'array' THEN
          RAISE EXCEPTION 'Formato inválido para o campo "%".', v_k USING ERRCODE = 'P0001';
        END IF;
      WHEN 'revenda_kanban_colunas' THEN$x$,
    $x$                                           ELSE plan_tecido_oc_bloqueia_lancado END,
    explosao_requisitos = CASE WHEN v_m ? 'explosao_requisitos' THEN v_m -> 'explosao_requisitos' ELSE explosao_requisitos END
  WHERE tenant_id = v_tenant$x$];
  d := pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'));
  IF position('explosao_requisitos' IN d) > 0 THEN
    RETURN;  -- ja trocada (reaplicar e inofensivo)
  END IF;
  FOR i IN 1..3 LOOP
    IF (length(d) - length(replace(d, a[i], ''))) / length(a[i]) <> 1 THEN
      RAISE EXCEPTION 'f6_explosao: ancora % nao aparece exatamente 1x em salvar_config_loja', i USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR i IN 1..3 LOOP
    d := replace(d, a[i], b[i]);
  END LOOP;
  EXECUTE d;
END
$troca$;

-- 3) _enviar_modelo_para_cad_core: gate F6 (Task 2, Bloco B) — ACRESCENTADO ABAIXO.

-- pos-condicoes
DO $pos$
BEGIN
  -- coluna NOVA, forma correta
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                  WHERE a.attrelid = 'public.tenant_config'::regclass AND a.attname = 'explosao_requisitos' AND NOT a.attisdropped
                    AND a.atttypid = 'jsonb'::regtype AND a.attnotnull AND pg_get_expr(d.adbin, d.adrelid) = '''[]''::jsonb') THEN
    RAISE EXCEPTION 'f6_explosao: pos-condicao falhou na coluna explosao_requisitos' USING ERRCODE = 'P0001';
  END IF;
  -- salvar_config_loja: ACL/secdef/search_path preservados + md5 MUDOU
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)') AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,authenticated=X/postgres}'
                  AND p.prosecdef AND p.proconfig = ARRAY['search_path=public'])
     OR has_function_privilege('anon', 'public.salvar_config_loja(uuid,jsonb,jsonb,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'f6_explosao: pos-condicao falhou na ACL/secdef/search_path de salvar_config_loja' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'))) = '6d35eb844c03afebccdc110e970f46d0' THEN
    RAISE EXCEPTION 'f6_explosao: salvar_config_loja NAO mudou (diff-validacao)' USING ERRCODE = 'P0001';
  END IF;
  -- (pos-condicao do _core entra na Task 2, no mesmo bloco de pos-condicao abaixo)
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
