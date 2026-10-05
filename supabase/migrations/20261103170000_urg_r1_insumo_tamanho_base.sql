-- Urgentes R1 T2 - coluna etiquetas.tamanho_vinculado + 6 helpers do insumo vinculado a UM tamanho.
-- GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a1.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-a.md (Task 2; Rulings A1-A3; P-307 B vira a correcao unica 20261103170500).
-- O que muda:
--   1) coluna NOVA public.etiquetas.tamanho_vinculado text NULL (sem default, sem CHECK, SEM backfill - Ruling A1). Sem GRANT
--      novo: o cadastro grava direto e o authenticated ja tem UPDATE de TABELA em etiquetas.
--   2) 6 helpers NOVOS (SECURITY INVOKER, search_path=public, EXECUTE revogado de PUBLIC, anon, authenticated; quem chama e
--      SECURITY DEFINER ou roda como postgres): _insumo_tamanho_efetivo / _insumo_pecas / _insumo_fator_custo (IMMUTABLE, puros,
--      espelho de src/lib/insumo-tamanho.ts com a MESMA fixture) e _insumo_tamanho_de / _grade_mapa_modelo / _grade_mapa_cad
--      (STABLE, leem etiquetas+variantes_etiqueta / modelo_grades / cad_grades). Nenhum consumidor existente muda (T3..T5).
-- Nenhum dado muda. Insumo sem vinculo = comportamento de hoje.
-- Trava: ALTER TABLE ... ADD COLUMN (nullable, sem default = so catalogo) = AccessExclusiveLock em public.etiquetas por ms ate o
-- COMMIT (MEDIDO na copia, supautils carregado, por diferenca de pg_locks: AccessExclusive so em etiquetas; AccessShareLock em
-- variantes_etiqueta, modelo_grades e cad_grades pela validacao do corpo SQL dos leitores - nao bloqueia leitura nem escrita;
-- NADA em auth/storage/realtime). Enquanto a txn dura, leitura e escrita de etiquetas esperam (cadastro de insumo, BOM,
-- Explosao, OC Insumo). lock_timeout 1500ms; 55P03 = nada mudou, rodar o arquivo de novo. Idempotente (ADD COLUMN IF NOT EXISTS;
-- CREATE OR REPLACE com o mesmo texto).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._insumo_tamanho_efetivo(text,text,boolean)  DEPOIS c3cdade8a88d585492eeb6a01205ce3e
--   public._insumo_pecas(text,jsonb,numeric)  DEPOIS 2e1b701be975366933e9ad704cb25c18
--   public._insumo_fator_custo(text,jsonb,numeric)  DEPOIS c32298c26ec5ed77856fd860299d958a
--   public._insumo_tamanho_de(uuid)  DEPOIS 46fd6f65599f7de2d3ab12777fefa7d1
--   public._grade_mapa_modelo(uuid)  DEPOIS 96b2a9c7e16fc789965dbf482b23b4c5
--   public._grade_mapa_cad(uuid,boolean)  DEPOIS 44224a78f86abff7ac18f8e2051a7067
--   (ANTES: ausentes)
-- ====================================================================================
-- Volta: supabase/rollback/20261103170000_urg_r1_insumo_tamanho_base_down.sql (no-op documentado: coluna e helpers ficam inertes). DROP de verdade: supabase/rollback/20261103170000_urg_r1_insumo_tamanho_base_down_drop.sql
-- (opcional, depois, horario calmo; recusa enquanto alguma funcao de public citar os helpers ou a coluna - ex.: 170500..173000).
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
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'etiquetas'
                AND column_name = 'tamanho_vinculado' AND data_type <> 'text') THEN
    RAISE EXCEPTION 'urg_r1_170000: etiquetas.tamanho_vinculado existe com outro tipo' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._insumo_tamanho_efetivo(text,text,boolean)', 'c3cdade8a88d585492eeb6a01205ce3e', 'i'),
      ('public._insumo_pecas(text,jsonb,numeric)', '2e1b701be975366933e9ad704cb25c18', 'i'),
      ('public._insumo_fator_custo(text,jsonb,numeric)', 'c32298c26ec5ed77856fd860299d958a', 'i'),
      ('public._insumo_tamanho_de(uuid)', '46fd6f65599f7de2d3ab12777fefa7d1', 's'),
      ('public._grade_mapa_modelo(uuid)', '96b2a9c7e16fc789965dbf482b23b4c5', 's'),
      ('public._grade_mapa_cad(uuid,boolean)', '44224a78f86abff7ac18f8e2051a7067', 's')
    ) AS x(f, d, vol) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v <> r.d THEN
      RAISE EXCEPTION 'urg_r1_170000: % ja existe com texto inesperado (md5 %) - gere de novo', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

ALTER TABLE public.etiquetas ADD COLUMN IF NOT EXISTS tamanho_vinculado text NULL;
COMMENT ON COLUMN public.etiquetas.tamanho_vinculado IS
  'Insumo vinculado a UM tamanho da grade (urg R1): texto exato de tenant_config.tamanhos_grade (ex.: 40|M). Vazio = segue a grade inteira. So vale se o insumo nao tem tamanho proprio (formato nenhum ou nenhuma variante com tamanho) - regra em _insumo_tamanho_efetivo. A tela grava direto (grant de tabela do authenticated).';

CREATE OR REPLACE FUNCTION public._insumo_tamanho_efetivo(_tamanho_vinculado text, _formato_tamanho text, _tem_variante_com_tamanho boolean)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- [urg r1] insumo vinculado a UM tamanho (fonte unica SQL; espelho TS src/lib/insumo-tamanho.ts tamanhoEfetivoInsumo, mesma
  -- fixture tests/fixtures/insumo-tamanho-casos.ts). O vinculo e guardado SEM trim pela tela: btrim aqui (so espaco ASCII).
  -- Vazio/so espacos = sem vinculo. So vale se o insumo nao tem tamanho proprio: formato 'nenhum' (exato) OU nenhuma variante
  -- com tamanho nao vazio. Senao NULL (o insumo segue a grade inteira).
  SELECT CASE
           WHEN nullif(btrim(_tamanho_vinculado), '') IS NULL THEN NULL
           WHEN coalesce(_formato_tamanho, 'ambos') = 'nenhum' OR NOT coalesce(_tem_variante_com_tamanho, false)
             THEN btrim(_tamanho_vinculado)
         END
$function$;
REVOKE EXECUTE ON FUNCTION public._insumo_tamanho_efetivo(text,text,boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._insumo_pecas(_tam text, _mapa jsonb, _total numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- [urg r1] pecas que o insumo cobre (espelho TS pecasDoInsumo): sem tamanho -> o total (NULL = 0); com tamanho -> a celula
  -- daquele tamanho no mapa {tam: soma} (_grade_mapa_*), so se for numero >= 0 em texto; ausente/invalida = 0.
  SELECT CASE
           WHEN _tam IS NULL THEN coalesce(_total, 0)
           WHEN (_mapa ->> _tam) ~ '^[0-9]+(\.[0-9]+)?$' THEN (_mapa ->> _tam)::numeric
           ELSE 0::numeric
         END
$function$;
REVOKE EXECUTE ON FUNCTION public._insumo_pecas(text,jsonb,numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._insumo_fator_custo(_tam text, _mapa jsonb, _total numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- [urg r1] fator do custo por peca (Ruling A3; espelho TS fatorCustoInsumo): sem tamanho ou total <= 0 (grade vazia) -> 1;
  -- senao pecas do tamanho / total da grade, SEM limitar a 1.
  SELECT CASE
           WHEN _tam IS NULL OR coalesce(_total, 0) <= 0 THEN 1::numeric
           ELSE public._insumo_pecas(_tam, _mapa, _total) / _total
         END
$function$;
REVOKE EXECUTE ON FUNCTION public._insumo_fator_custo(text,jsonb,numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._insumo_tamanho_de(_etiqueta_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- [urg r1] tamanho efetivo do insumo gravado (NULL se o id nao existe ou o insumo nao tem vinculo valido). Le o cadastro sem
  -- filtrar loja: quem chama ja resolveu o insumo pela loja do modelo/CAD.
  SELECT public._insumo_tamanho_efetivo(
           e.tamanho_vinculado,
           e.formato_tamanho,
           EXISTS (SELECT 1 FROM public.variantes_etiqueta v
                    WHERE v.etiqueta_id = e.id AND nullif(btrim(v.tamanho), '') IS NOT NULL))
    FROM public.etiquetas e
   WHERE e.id = _etiqueta_id
$function$;
REVOKE EXECUTE ON FUNCTION public._insumo_tamanho_de(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._grade_mapa_modelo(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- [urg r1] grade do modelo por tamanho: {tam: soma} das linhas de modelo_grades (espelho TS gradeMapa). So entram celulas
  -- numero >= 0 em texto; grades que nao e objeto JSON conta como vazia. Sem linhas = '{}'.
  SELECT coalesce(jsonb_object_agg(s.k, s.v), '{}'::jsonb)
    FROM (SELECT kv.key AS k,
                 sum(CASE WHEN kv.value ~ '^[0-9]+(\.[0-9]+)?$' THEN kv.value::numeric END) AS v
            FROM public.modelo_grades g
            CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(g.grades) = 'object' THEN g.grades ELSE '{}'::jsonb END) kv
           WHERE g.modelo_id = _modelo_id
             AND kv.value ~ '^[0-9]+(\.[0-9]+)?$'
           GROUP BY kv.key) s
$function$;
REVOKE EXECUTE ON FUNCTION public._grade_mapa_modelo(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._grade_mapa_cad(_cad_id uuid, _real boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- [urg r1] grade do CAD por tamanho: {tam: soma}. Por linha de cad_grades: com _real e grade_total_real preenchido -> a grade
  -- real; senao a planejada. Mesmas regras de celula de _grade_mapa_modelo. Sem linhas = '{}'.
  SELECT coalesce(jsonb_object_agg(s.k, s.v), '{}'::jsonb)
    FROM (SELECT kv.key AS k,
                 sum(CASE WHEN kv.value ~ '^[0-9]+(\.[0-9]+)?$' THEN kv.value::numeric END) AS v
            FROM public.cad_grades g
            CROSS JOIN LATERAL (SELECT CASE WHEN coalesce(_real, false) AND g.grade_total_real IS NOT NULL
                                            THEN g.grades_reais ELSE g.grades_planejadas END AS gr) x
            CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(x.gr) = 'object' THEN x.gr ELSE '{}'::jsonb END) kv
           WHERE g.cad_id = _cad_id
             AND kv.value ~ '^[0-9]+(\.[0-9]+)?$'
           GROUP BY kv.key) s
$function$;
REVOKE EXECUTE ON FUNCTION public._grade_mapa_cad(uuid,boolean) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._insumo_tamanho_efetivo(text,text,boolean)', 'c3cdade8a88d585492eeb6a01205ce3e', 'i'),
      ('public._insumo_pecas(text,jsonb,numeric)', '2e1b701be975366933e9ad704cb25c18', 'i'),
      ('public._insumo_fator_custo(text,jsonb,numeric)', 'c32298c26ec5ed77856fd860299d958a', 'i'),
      ('public._insumo_tamanho_de(uuid)', '46fd6f65599f7de2d3ab12777fefa7d1', 's'),
      ('public._grade_mapa_modelo(uuid)', '96b2a9c7e16fc789965dbf482b23b4c5', 's'),
      ('public._grade_mapa_cad(uuid,boolean)', '44224a78f86abff7ac18f8e2051a7067', 's')
    ) AS x(f, d, vol) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 'urg_r1_170000: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.d USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND NOT p.prosecdef AND p.provolatile::text = r.vol
                     AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r1_170000: pos-condicao falhou na ACL/secdef/search_path/volatilidade de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'etiquetas'
                   AND column_name = 'tamanho_vinculado' AND data_type = 'text' AND is_nullable = 'YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'urg_r1_170000: pos-condicao falhou na coluna etiquetas.tamanho_vinculado' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.etiquetas', 'tamanho_vinculado', 'UPDATE')
     OR has_column_privilege('anon', 'public.etiquetas', 'tamanho_vinculado', 'SELECT') THEN
    RAISE EXCEPTION 'urg_r1_170000: pos-condicao falhou nos privilegios da coluna tamanho_vinculado' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
