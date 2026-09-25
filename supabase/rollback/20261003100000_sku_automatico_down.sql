-- INVERSO da migration 20261003100000_sku_automatico (F3.5a) — ⚠️ DESTRUTIVO.
-- ============================================================================================================
-- APAGA TUDO o que a F3.5a guardou: as SIGLAS SKU digitadas em Cor base/Cor apelido (cores.sigla_sku,
-- cores_apelido.sigla_sku) e na Grade de Tamanhos (tenant_config.tamanhos_sku), o FORMATO DO SKU
-- (tenant_config.sku_config), o "TAMANHO EM" (modelos/produtos_acabados/produtos_importados.tamanho_tipo) e TODOS
-- os SKUs gerados E os editados à mão (tabela modelo_skus). Não há como recuperar sem o backup/export.
-- Com dado presente, RECUSA sem a confirmação explícita (só com OK do dono, DEPOIS do export — Task 12 Step 5):
--   export EXTRA_SQL="SET LOCAL app.confirmo_apagar_skus = 'sim';"   (o aplica_v2 injeta logo depois do BEGIN)
-- Idempotente (IF EXISTS em tudo) e válido em qualquer estágio da migration (parte A, A+B ou A+B+C).
-- TRAVA tabelas EXISTENTES até o COMMIT: AccessExclusive nas tabelas das colunas (cores, cores_apelido, produtos_*,
-- modelos, tenant_config — lida pelas policies de TODAS as lojas) e, no DROP da tabela (por último), as policies dela
-- (hook supautils.policy_grants ⇒ auth/storage presos: login/refresh esperam). Não faz trabalho por linha (só count +
-- DROP): cabe folgado nas travas abaixo (500 ms de espera por trava, 3 s no total). Horário calmo.
-- Plano: docs/superpowers/plans/2026-09-24-sku-automatico-f35a.md (Task 3; round-trip na Task 5; ensaio na Task 6).

BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $do$
DECLARE
  v_n bigint := 0;
  v_c bigint;
  r record;
BEGIN
  IF to_regclass('public.modelo_skus') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.modelo_skus' INTO v_c;
    v_n := v_n + v_c;
  END IF;
  FOR r IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND (c.table_name::text, c.column_name::text) IN (('cores', 'sigla_sku'), ('cores_apelido', 'sigla_sku'),
             ('tenant_config', 'tamanhos_sku'), ('tenant_config', 'sku_config'), ('modelos', 'tamanho_tipo'),
             ('produtos_acabados', 'tamanho_tipo'), ('produtos_importados', 'tamanho_tipo'))
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NOT NULL', r.table_name, r.column_name) INTO v_c;
    v_n := v_n + v_c;
  END LOOP;
  IF v_n > 0 AND coalesce(current_setting('app.confirmo_apagar_skus', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'O inverso da F3.5a APAGA % dado(s) digitado(s) (siglas SKU, Formato do SKU, "Tamanho em" e SKUs gerados/editados). Só com OK do dono e depois do export: SET LOCAL app.confirmo_apagar_skus = ''sim''.', v_n
      USING ERRCODE = 'P0001';
  END IF;
END
$do$;

DROP TRIGGER IF EXISTS trg_tenant_config_sku ON public.tenant_config;
DROP TRIGGER IF EXISTS trg_pa_tamanho_tipo ON public.produtos_acabados;
DROP TRIGGER IF EXISTS trg_pi_tamanho_tipo ON public.produtos_importados;
DROP TRIGGER IF EXISTS trg_cores_sigla_sku ON public.cores;
DROP TRIGGER IF EXISTS trg_cores_apelido_sigla_sku ON public.cores_apelido;

DROP FUNCTION IF EXISTS public.skus_modelo(uuid);
DROP FUNCTION IF EXISTS public.gerar_skus_modelo(uuid, boolean);
DROP FUNCTION IF EXISTS public.salvar_sku_manual(uuid, text, integer, uuid, uuid, text);
DROP FUNCTION IF EXISTS public._gerar_skus_modelo_core(uuid, boolean);
DROP FUNCTION IF EXISTS public._salvar_sku_manual_core(uuid, text, integer, uuid, uuid, text);
DROP FUNCTION IF EXISTS public._skus_modelo_core(uuid);
DROP FUNCTION IF EXISTS public._skus_modelo_calc(uuid);
DROP FUNCTION IF EXISTS public._sku_guarda(uuid, boolean);
DROP FUNCTION IF EXISTS public.fn_tenant_config_sku_normaliza();
DROP FUNCTION IF EXISTS public.fn_produto_tamanho_tipo_handover();
DROP FUNCTION IF EXISTS public.fn_sigla_sku_normaliza();
DROP FUNCTION IF EXISTS public._sku_resolver(jsonb, text, jsonb, jsonb, text, text, jsonb);
DROP FUNCTION IF EXISTS public._sku_montar(jsonb, jsonb);
DROP FUNCTION IF EXISTS public._sku_tamanhos_normaliza(jsonb);
DROP FUNCTION IF EXISTS public._sku_config_normaliza(jsonb);
DROP FUNCTION IF EXISTS public._sku_tamanho_lado(text, text);
DROP FUNCTION IF EXISTS public._sku_tamanho_lados(text);
DROP FUNCTION IF EXISTS public._sku_variante_key(uuid, uuid);
DROP FUNCTION IF EXISTS public._sku_norm_manual(text);
DROP FUNCTION IF EXISTS public._sku_norm_ref(text);
DROP FUNCTION IF EXISTS public._sku_norm_sigla(text);
DROP FUNCTION IF EXISTS public._sku_sem_acento(text);

ALTER TABLE public.cores DROP COLUMN IF EXISTS sigla_sku;
ALTER TABLE public.cores_apelido DROP COLUMN IF EXISTS sigla_sku;
ALTER TABLE public.produtos_acabados DROP COLUMN IF EXISTS tamanho_tipo;
ALTER TABLE public.produtos_importados DROP COLUMN IF EXISTS tamanho_tipo;
ALTER TABLE public.modelos DROP COLUMN IF EXISTS tamanho_tipo;
ALTER TABLE public.tenant_config DROP COLUMN IF EXISTS sku_config, DROP COLUMN IF EXISTS tamanhos_sku;

-- A tabela POR ÚLTIMO (leva junto o gatilho trg_modelo_skus_unico e as 4 policies — hook supautils.policy_grants:
-- auth/storage presos até o COMMIT, então o mais perto dele possível). DROP TRIGGER … ON uma tabela que pode não
-- existir quebraria a idempotência (lição da F1) — por isso o DROP TABLE e, só depois, a função do gatilho dela.
DROP TABLE IF EXISTS public.modelo_skus;
DROP FUNCTION IF EXISTS public.fn_modelo_skus_unico();

NOTIFY pgrst, 'reload schema';

COMMIT;
