-- Backend B2 — rev da raiz sobe UMA vez por transacao nas outras raizes colaborativas (desenho item 3). GERADO por .superpowers/sdd/2026-10-05-backend/mig/gerar-bk2.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-05-backend/plan.md (§3 B2, §0 K2/K3, §13; Rulings R1).
-- O que muda (troca de texto EXATA sobre o texto vivo; nada mais nas 8 funcoes de gatilho): o idioma da T5 da Modularidade
--   (fn_colab_bump_modelo, 20261103200000 + fix round 1) nas 8 fn_colab_bump_* que a T5 nao tocou. O 'update <raiz> set id =
--   id' (que soma 1 ao rev pelo BEFORE UPDATE de rev da raiz) so acontece se a linha da raiz AINDA nao foi escrita por esta
--   transacao: pula quando (1) xmin da raiz = xid de topo, ou (2) xmin da raiz = xmin da propria linha-filha (mesma
--   SUBtransacao). Efeito: +1 por TRANSACAO (antes: 1 por linha da filha). Quando a RPC grava a raiz DEPOIS das filhas
--   (salvar_oc_tecido/_aviamento/_etiqueta, salvar_cad_completo) fica +2 (a 1a filha sobe, o UPDATE da raiz soma 1).
--   Raizes: cad (cad_aviamentos, cad_etiquetas, cad_tecido_variantes), artigos (variantes_tecido), controle_qualidade
--   (cq_variantes), ocs_tecido/ocs_aviamento/ocs_etiqueta (itens), colecoes (plan_tecido, plan_tecido_oc_aplicada,
--   plan_tecido_slot_oc: plan_rev E otb_rev sobem juntos, como antes).
--   O P0409 segue igual: toda transacao que escreve uma filha de raiz existente sobe o rev >= 1 (a linha so e pulada se JA
--   foi escrita nesta transacao, e todo UPDATE da raiz soma 1) -> o Realtime recebe >= 1 UPDATE da raiz por transacao.
--   DELETE de filha dentro de subtransacao segue 1 por linha. Limite aceito: xmin de 32 bits (colisao com tupla congelada
--   antiga ~2^-32), o mesmo da T5/_custo_enfileirar.
--   K2: as 3 INVOKER (_cad_direto, _cad_via_ctv, _artigo_via_variante) seguem INVOKER, sem SET, RETURN NULL; as 5 DEFINER seguem
--   DEFINER/search_path=public, return coalesce(new, old).
-- Gatilhos, ACL, SECURITY e search_path ficam iguais (guarda/pos-condicao). Nenhum objeto novo (sem _down_drop). Nenhum dado muda.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_colab_bump_cad_direto()  [raiz cad; INVOKER]
--     ANTES  11de99c5d82533a5afe4cb84a77cf1d6
--     DEPOIS fc82f52d6fea2b38407e097f25a3c7d8
--   public.fn_colab_bump_cad_via_ctv()  [raiz cad; INVOKER]
--     ANTES  c7ecad42efaf2f92967e525ae0644e0b
--     DEPOIS 0ac9004c6ada8b0002a301c0ea5cf171
--   public.fn_colab_bump_artigo_via_variante()  [raiz artigos; INVOKER]
--     ANTES  ad046ad6a45b9bf313df91775583b740
--     DEPOIS 1a8259e5f4d8f8242d72da552b44fcb3
--   public.fn_colab_bump_cq()  [raiz controle_qualidade; DEFINER]
--     ANTES  3e80093567f8e1f2040c8fccaa23f014
--     DEPOIS e4107f6bb5ae69803fc8801c7fed0ad1
--   public.fn_colab_bump_oc()  [raiz ocs_tecido; DEFINER]
--     ANTES  e5d8da33662c90594690253b10d8f611
--     DEPOIS 7ebdbca9cccf758503aaa157582ddd9c
--   public.fn_colab_bump_oc_avi()  [raiz ocs_aviamento; DEFINER]
--     ANTES  acab05e51f702c0912d0138d49a4c555
--     DEPOIS edb1d74b4d5eb3a7a47d7d77d1e333e4
--   public.fn_colab_bump_oc_etq()  [raiz ocs_etiqueta; DEFINER]
--     ANTES  cd39911e71bab5e8ce304e1365f3f6b5
--     DEPOIS 11298265cdf5470d78e0c9867be62b48
--   public.fn_colab_bump_plan()  [raiz colecoes; DEFINER]
--     ANTES  73333b358aa6e3ea5064820bb0619fb3
--     DEPOIS 128de297e8065f4f2168132d66331b69
--   dependencias fixadas: public.fn_colab_touch_rev() = 292f1a1077df1e08fdca7f21eb0d856c; public.fn_colab_touch_plan_rev() = f726b1d23ee55127bc84506d52cdf352; public.fn_colab_touch_otb_rev() = 62b06535cdbe63bcf43ba000b44e8cb4
-- ====================================================================================
-- Trava: so catalogo (CREATE OR REPLACE FUNCTION de 8 funcoes de gatilho): nenhuma tabela (os gatilhos NAO sao recriados),
-- nada de auth/storage/realtime. Sem DROP, sem CREATE/DROP TRIGGER/POLICY, sem NOTIFY. Idempotente (a guarda aceita antes OU depois).
-- Volta: supabase/rollback/20261103141000_bk_rev_uma_vez_raizes_down.sql (LIFO: depois do inverso da B4 143000 e antes do da B1 140000;
-- e ANTES de qualquer inverso antigo que guarde estas funcoes por md5 - ver md5-bk2.txt: L9 20261029100000_down, S1 20261031130000).
-- 55P03/40P01 = nada mudou; rodar o arquivo de novo.
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
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_colab_bump_cad_direto()', '11de99c5d82533a5afe4cb84a77cf1d6', 'fc82f52d6fea2b38407e097f25a3c7d8'),
      ('public.fn_colab_bump_cad_via_ctv()', 'c7ecad42efaf2f92967e525ae0644e0b', '0ac9004c6ada8b0002a301c0ea5cf171'),
      ('public.fn_colab_bump_artigo_via_variante()', 'ad046ad6a45b9bf313df91775583b740', '1a8259e5f4d8f8242d72da552b44fcb3'),
      ('public.fn_colab_bump_cq()', '3e80093567f8e1f2040c8fccaa23f014', 'e4107f6bb5ae69803fc8801c7fed0ad1'),
      ('public.fn_colab_bump_oc()', 'e5d8da33662c90594690253b10d8f611', '7ebdbca9cccf758503aaa157582ddd9c'),
      ('public.fn_colab_bump_oc_avi()', 'acab05e51f702c0912d0138d49a4c555', 'edb1d74b4d5eb3a7a47d7d77d1e333e4'),
      ('public.fn_colab_bump_oc_etq()', 'cd39911e71bab5e8ce304e1365f3f6b5', '11298265cdf5470d78e0c9867be62b48'),
      ('public.fn_colab_bump_plan()', '73333b358aa6e3ea5064820bb0619fb3', '128de297e8065f4f2168132d66331b69')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'bk2_rev_uma_vez: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_colab_touch_rev()', '292f1a1077df1e08fdca7f21eb0d856c'),
      ('public.fn_colab_touch_plan_rev()', 'f726b1d23ee55127bc84506d52cdf352'),
      ('public.fn_colab_touch_otb_rev()', '62b06535cdbe63bcf43ba000b44e8cb4')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'bk2_rev_uma_vez: dependencia % com texto inesperado (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- premissa: toda escrita da raiz soma 1 ao rev (BEFORE UPDATE FOR EACH ROW, ligado, sem coluna e sem WHEN)
  FOR r IN SELECT * FROM (VALUES
      ('artigos', 'trg_colab_rev_artigo', 'public.fn_colab_touch_rev()'),
      ('cad', 'trg_colab_rev_cad', 'public.fn_colab_touch_rev()'),
      ('controle_qualidade', 'trg_colab_rev', 'public.fn_colab_touch_rev()'),
      ('ocs_tecido', 'trg_colab_rev', 'public.fn_colab_touch_rev()'),
      ('ocs_aviamento', 'trg_colab_rev_oc_avi', 'public.fn_colab_touch_rev()'),
      ('ocs_etiqueta', 'trg_colab_rev_oc_etq', 'public.fn_colab_touch_rev()'),
      ('colecoes', 'trg_colab_plan_rev', 'public.fn_colab_touch_plan_rev()'),
      ('colecoes', 'trg_colab_otb_rev', 'public.fn_colab_touch_otb_rev()')
    ) AS x(t, g, f) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.' || r.t) AND g.tgname = r.g AND NOT g.tgisinternal
                     AND g.tgfoid = to_regprocedure(r.f) AND g.tgenabled = 'O' AND g.tgattr::text = '' AND g.tgqual IS NULL
                     AND (g.tgtype & 1) = 1 AND (g.tgtype & 2) = 2 AND (g.tgtype & 16) = 16) THEN
      RAISE EXCEPTION 'bk2_rev_uma_vez: gatilho de rev % de % ausente ou diferente (premissa do rev)', r.g, r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- os gatilhos que chamam as 8 funcoes sao os de hoje (AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW, ligados) e nenhum outro
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_colab_bump_cad_direto()', 'cad_aviamentos.trg_colab_bump_cad_avi,cad_etiquetas.trg_colab_bump_cad_etq'),
      ('public.fn_colab_bump_cad_via_ctv()', 'cad_tecido_variantes.trg_colab_bump_cad_ctv'),
      ('public.fn_colab_bump_artigo_via_variante()', 'variantes_tecido.trg_colab_bump_artigo_variante'),
      ('public.fn_colab_bump_cq()', 'cq_variantes.trg_colab_bump'),
      ('public.fn_colab_bump_oc()', 'ocs_tecido_itens.trg_colab_bump'),
      ('public.fn_colab_bump_oc_avi()', 'ocs_aviamento_itens.trg_colab_bump_oc_avi'),
      ('public.fn_colab_bump_oc_etq()', 'ocs_etiqueta_itens.trg_colab_bump_oc_etq'),
      ('public.fn_colab_bump_plan()', 'plan_tecido.trg_colab_bump,plan_tecido_oc_aplicada.trg_colab_bump,plan_tecido_slot_oc.trg_colab_bump')
    ) AS x(f, ts) LOOP
    SELECT string_agg(c.relname || '.' || g.tgname, ',' ORDER BY c.relname, g.tgname) INTO v
      FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
     WHERE NOT g.tgisinternal AND g.tgfoid = to_regprocedure(r.f);
    IF v IS DISTINCT FROM r.ts OR EXISTS (
         SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
          WHERE NOT g.tgisinternal AND g.tgfoid = to_regprocedure(r.f)
            AND NOT (g.tgenabled = 'O' AND (g.tgtype & 1) = 1 AND (g.tgtype & 2) = 0 AND (g.tgtype & 28) = 28
                     AND (g.tgtype & 64) = 0 AND c.relnamespace = 'public'::regnamespace)) THEN
      RAISE EXCEPTION 'bk2_rev_uma_vez: gatilhos de % = % (esperado %, AFTER ROW I/U/D ligados)', r.f, coalesce(v, 'nenhum'), r.ts
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- o idioma le t.xmin da raiz e da filha por id: toda tabela envolvida tem id uuid
  FOR r IN SELECT unnest(ARRAY['artigos', 'cad', 'cad_aviamentos', 'cad_etiquetas', 'cad_tecido_variantes', 'colecoes', 'controle_qualidade', 'cq_variantes', 'ocs_aviamento', 'ocs_aviamento_itens', 'ocs_etiqueta', 'ocs_etiqueta_itens', 'ocs_tecido', 'ocs_tecido_itens', 'plan_tecido', 'plan_tecido_oc_aplicada', 'plan_tecido_slot_oc', 'variantes_tecido']) AS t LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.' || r.t) AND a.attname = 'id'
                     AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype) THEN
      RAISE EXCEPTION 'bk2_rev_uma_vez: tabela % sem coluna id uuid', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_cad_direto()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_id uuid := COALESCE(NEW.cad_id, OLD.cad_id);
  v_x xid;
  v_y xid;
BEGIN
  -- [backend B2] rev da raiz sobe UMA vez por TRANSACAO (idioma da T5 da Modularidade em fn_colab_bump_modelo): pula quando a
  -- linha da raiz ja foi escrita por ESTA transacao (todo UPDATE dela ja somou 1 pelo BEFORE UPDATE de rev): (1) xmin da raiz =
  -- xid de topo; (2) xmin da raiz = xmin da linha-filha (mesma SUBtransacao). DELETE em subtransacao segue 1 por linha.
  select r.xmin into v_x from public.cad r where r.id = v_id;
  if v_x is null or v_x = pg_current_xact_id()::xid then
    return NULL;
  end if;
  if tg_op <> 'DELETE' then
    execute format('select t.xmin from %I.%I t where t.id = $1', tg_table_schema, tg_table_name) into v_y using new.id;
    if v_y = v_x then
      return NULL;
    end if;
  end if;
  update public.cad set id = id where id = v_id and xmin <> pg_current_xact_id()::xid;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_cad_via_ctv()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_id uuid;
  v_x xid;
  v_y xid;
BEGIN
  SELECT ct.cad_id INTO v_id FROM public.cad_tecidos ct
    WHERE ct.id = COALESCE(NEW.cad_tecido_id, OLD.cad_tecido_id);
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- [backend B2] rev da raiz sobe UMA vez por TRANSACAO (idioma da T5 da Modularidade em fn_colab_bump_modelo): pula quando a
  -- linha da raiz ja foi escrita por ESTA transacao (todo UPDATE dela ja somou 1 pelo BEFORE UPDATE de rev): (1) xmin da raiz =
  -- xid de topo; (2) xmin da raiz = xmin da linha-filha (mesma SUBtransacao). DELETE em subtransacao segue 1 por linha.
  select r.xmin into v_x from public.cad r where r.id = v_id;
  if v_x is null or v_x = pg_current_xact_id()::xid then
    return NULL;
  end if;
  if tg_op <> 'DELETE' then
    execute format('select t.xmin from %I.%I t where t.id = $1', tg_table_schema, tg_table_name) into v_y using new.id;
    if v_y = v_x then
      return NULL;
    end if;
  end if;
  update public.cad set id = id where id = v_id and xmin <> pg_current_xact_id()::xid;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_artigo_via_variante()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_id uuid := COALESCE(NEW.artigo_id, OLD.artigo_id);
  v_x xid;
  v_y xid;
BEGIN
  -- [backend B2] rev da raiz sobe UMA vez por TRANSACAO (idioma da T5 da Modularidade em fn_colab_bump_modelo): pula quando a
  -- linha da raiz ja foi escrita por ESTA transacao (todo UPDATE dela ja somou 1 pelo BEFORE UPDATE de rev): (1) xmin da raiz =
  -- xid de topo; (2) xmin da raiz = xmin da linha-filha (mesma SUBtransacao). DELETE em subtransacao segue 1 por linha.
  select r.xmin into v_x from public.artigos r where r.id = v_id;
  if v_x is null or v_x = pg_current_xact_id()::xid then
    return NULL;
  end if;
  if tg_op <> 'DELETE' then
    execute format('select t.xmin from %I.%I t where t.id = $1', tg_table_schema, tg_table_name) into v_y using new.id;
    if v_y = v_x then
      return NULL;
    end if;
  end if;
  update public.artigos set id = id where id = v_id and xmin <> pg_current_xact_id()::xid;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_cq()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid := coalesce(new.controle_qualidade_id, old.controle_qualidade_id);
  v_x xid;
  v_y xid;
begin
  -- [backend B2] rev da raiz sobe UMA vez por TRANSACAO (idioma da T5 da Modularidade em fn_colab_bump_modelo): pula quando a
  -- linha da raiz ja foi escrita por ESTA transacao (todo UPDATE dela ja somou 1 pelo BEFORE UPDATE de rev): (1) xmin da raiz =
  -- xid de topo; (2) xmin da raiz = xmin da linha-filha (mesma SUBtransacao). DELETE em subtransacao segue 1 por linha.
  select r.xmin into v_x from public.controle_qualidade r where r.id = v_id;
  if v_x is null or v_x = pg_current_xact_id()::xid then
    return coalesce(new, old);
  end if;
  if tg_op <> 'DELETE' then
    execute format('select t.xmin from %I.%I t where t.id = $1', tg_table_schema, tg_table_name) into v_y using new.id;
    if v_y = v_x then
      return coalesce(new, old);
    end if;
  end if;
  update public.controle_qualidade set id = id where id = v_id and xmin <> pg_current_xact_id()::xid;
  return coalesce(new, old);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_oc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid := coalesce(new.oc_tecido_id, old.oc_tecido_id);
  v_x xid;
  v_y xid;
begin
  -- [backend B2] rev da raiz sobe UMA vez por TRANSACAO (idioma da T5 da Modularidade em fn_colab_bump_modelo): pula quando a
  -- linha da raiz ja foi escrita por ESTA transacao (todo UPDATE dela ja somou 1 pelo BEFORE UPDATE de rev): (1) xmin da raiz =
  -- xid de topo; (2) xmin da raiz = xmin da linha-filha (mesma SUBtransacao). DELETE em subtransacao segue 1 por linha.
  select r.xmin into v_x from public.ocs_tecido r where r.id = v_id;
  if v_x is null or v_x = pg_current_xact_id()::xid then
    return coalesce(new, old);
  end if;
  if tg_op <> 'DELETE' then
    execute format('select t.xmin from %I.%I t where t.id = $1', tg_table_schema, tg_table_name) into v_y using new.id;
    if v_y = v_x then
      return coalesce(new, old);
    end if;
  end if;
  update public.ocs_tecido set id = id where id = v_id and xmin <> pg_current_xact_id()::xid;
  return coalesce(new, old);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_oc_avi()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid := coalesce(new.oc_aviamento_id, old.oc_aviamento_id);
  v_x xid;
  v_y xid;
begin
  -- [backend B2] rev da raiz sobe UMA vez por TRANSACAO (idioma da T5 da Modularidade em fn_colab_bump_modelo): pula quando a
  -- linha da raiz ja foi escrita por ESTA transacao (todo UPDATE dela ja somou 1 pelo BEFORE UPDATE de rev): (1) xmin da raiz =
  -- xid de topo; (2) xmin da raiz = xmin da linha-filha (mesma SUBtransacao). DELETE em subtransacao segue 1 por linha.
  select r.xmin into v_x from public.ocs_aviamento r where r.id = v_id;
  if v_x is null or v_x = pg_current_xact_id()::xid then
    return coalesce(new, old);
  end if;
  if tg_op <> 'DELETE' then
    execute format('select t.xmin from %I.%I t where t.id = $1', tg_table_schema, tg_table_name) into v_y using new.id;
    if v_y = v_x then
      return coalesce(new, old);
    end if;
  end if;
  update public.ocs_aviamento set id = id where id = v_id and xmin <> pg_current_xact_id()::xid;
  return coalesce(new, old);
end
$function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_oc_etq()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid := coalesce(new.oc_etiqueta_id, old.oc_etiqueta_id);
  v_x xid;
  v_y xid;
begin
  -- [backend B2] rev da raiz sobe UMA vez por TRANSACAO (idioma da T5 da Modularidade em fn_colab_bump_modelo): pula quando a
  -- linha da raiz ja foi escrita por ESTA transacao (todo UPDATE dela ja somou 1 pelo BEFORE UPDATE de rev): (1) xmin da raiz =
  -- xid de topo; (2) xmin da raiz = xmin da linha-filha (mesma SUBtransacao). DELETE em subtransacao segue 1 por linha.
  select r.xmin into v_x from public.ocs_etiqueta r where r.id = v_id;
  if v_x is null or v_x = pg_current_xact_id()::xid then
    return coalesce(new, old);
  end if;
  if tg_op <> 'DELETE' then
    execute format('select t.xmin from %I.%I t where t.id = $1', tg_table_schema, tg_table_name) into v_y using new.id;
    if v_y = v_x then
      return coalesce(new, old);
    end if;
  end if;
  update public.ocs_etiqueta set id = id where id = v_id and xmin <> pg_current_xact_id()::xid;
  return coalesce(new, old);
end
$function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid := coalesce(new.colecao_id, old.colecao_id);
  v_x xid;
  v_y xid;
begin
  -- [backend B2] rev da raiz sobe UMA vez por TRANSACAO (idioma da T5 da Modularidade em fn_colab_bump_modelo): pula quando a
  -- linha da raiz ja foi escrita por ESTA transacao (todo UPDATE dela ja somou 1 pelo BEFORE UPDATE de rev): (1) xmin da raiz =
  -- xid de topo; (2) xmin da raiz = xmin da linha-filha (mesma SUBtransacao). DELETE em subtransacao segue 1 por linha.
  select r.xmin into v_x from public.colecoes r where r.id = v_id;
  if v_x is null or v_x = pg_current_xact_id()::xid then
    return coalesce(new, old);
  end if;
  if tg_op <> 'DELETE' then
    execute format('select t.xmin from %I.%I t where t.id = $1', tg_table_schema, tg_table_name) into v_y using new.id;
    if v_y = v_x then
      return coalesce(new, old);
    end if;
  end if;
  update public.colecoes set id = id where id = v_id and xmin <> pg_current_xact_id()::xid;
  return coalesce(new, old);
end $function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_colab_bump_cad_direto()', 'fc82f52d6fea2b38407e097f25a3c7d8', '{postgres=X/postgres,service_role=X/postgres}', false, ''),
      ('public.fn_colab_bump_cad_via_ctv()', '0ac9004c6ada8b0002a301c0ea5cf171', '{postgres=X/postgres,service_role=X/postgres}', false, ''),
      ('public.fn_colab_bump_artigo_via_variante()', '1a8259e5f4d8f8242d72da552b44fcb3', '{postgres=X/postgres,service_role=X/postgres}', false, ''),
      ('public.fn_colab_bump_cq()', 'e4107f6bb5ae69803fc8801c7fed0ad1', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public'),
      ('public.fn_colab_bump_oc()', '7ebdbca9cccf758503aaa157582ddd9c', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public'),
      ('public.fn_colab_bump_oc_avi()', 'edb1d74b4d5eb3a7a47d7d77d1e333e4', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public'),
      ('public.fn_colab_bump_oc_etq()', '11298265cdf5470d78e0c9867be62b48', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public'),
      ('public.fn_colab_bump_plan()', '128de297e8065f4f2168132d66331b69', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public')
    ) AS x(f, m, acl, sd, cfg) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'bk2_rev_uma_vez: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef = r.sd AND coalesce(array_to_string(p.proconfig, '|'), '') = r.cfg)
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'bk2_rev_uma_vez: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
