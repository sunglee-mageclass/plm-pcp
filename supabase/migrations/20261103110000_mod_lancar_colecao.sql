-- Modularidade T2 — Lancar sem Producao + excluir colecao com cards (Partes 6 e 10). GERADO por .superpowers/sdd/2026-10-04-modularidade/mig/gerar-mod2.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md (§0 M2, §4 T2, §13); desenho.md (+ RESPOSTAS DO DONO, P-252 A/P-255 A).
-- O que muda (troca de texto EXATA sobre o texto vivo; nada mais nas 2 funcoes):
--   lancar_modelo (P-252 A): o CQ liberado so e exigido se a LOJA tem o modulo Producao (_tenant_modulo_ligado da T1: sem
--     JWT e sem atalho de super admin - M2). M.O. aprovada e Data de Lancamento seguem obrigatorias; _send=false igual.
--   otb_excluir_colecao (P-255 A): colecao com QUALQUER card (antes: so 'planejado') e recusada com P0001
--     'colecao_com_cards: N' (ASCII); nada e apagado. Sem cards: apaga a colecao + o plano de tecido dela, como antes.
--     Fix corrida: a linha da colecao e travada (FOR UPDATE) ANTES de contar - quem grava modelos.colecao_id pega FOR KEY
--     SHARE nela pela FK e serializa; o 'delete from modelos' SAIU (card nunca e apagado; a FK NO ACTION barra o delete
--     da colecao se sobrar card). O texto livre modelos.colecao (sem FK) nunca foi apagado por esta funcao.
-- ACL, SECURITY DEFINER e search_path ficam iguais (pos-condicao). Nenhum objeto novo (sem _down_drop).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.lancar_modelo(uuid,date,boolean)  [P-252 A]
--     ANTES  efe52aaad9a1e6055d758cf93e1950d5
--     DEPOIS 3a79fd6fa5ca7959640618057b385620
--   public.otb_excluir_colecao(uuid)  [P-255 A]
--     ANTES  5557291079763a24fdf202c46671d3c0
--     DEPOIS 4ba36eb4972d10832ed8eb1e8b89adea
--   dependencias fixadas: public._tenant_modulo_ligado(uuid,text) = 0c9655642d6b570f9adaf136bcaa09c7; public._cq_liberado(uuid) = 55a5f7ad704a061087e0fc154d4605e7
-- ====================================================================================
-- Trava: so catalogo (CREATE OR REPLACE FUNCTION): nenhuma tabela, nada de auth/storage/realtime. Sem DROP, sem TRIGGER/POLICY.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261103110000_mod_lancar_colecao_down.sql (LIFO: depois do inverso de 20261103120000 desta frente e ANTES do inverso da T1
-- (20261103100000_down/_down_drop: o _down_drop da T1 recusa enquanto lancar_modelo citar _tenant_modulo_ligado) e de qualquer
-- inverso antigo que guarde estas funcoes por md5 - S3d 20261101190000_down (lancar_modelo); ver md5-mod2.txt).
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
      ('public.lancar_modelo(uuid,date,boolean)', 'efe52aaad9a1e6055d758cf93e1950d5', '3a79fd6fa5ca7959640618057b385620'),
      ('public.otb_excluir_colecao(uuid)', '5557291079763a24fdf202c46671d3c0', '4ba36eb4972d10832ed8eb1e8b89adea')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'mod2_lancar_colecao: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._tenant_modulo_ligado(uuid,text)', '0c9655642d6b570f9adaf136bcaa09c7'),
      ('public._cq_liberado(uuid)', '55a5f7ad704a061087e0fc154d4605e7')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'mod2_lancar_colecao: dependencia % com texto inesperado (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.lancar_modelo(_modelo_id uuid, _data_lancamento date, _send boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_cad uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_planejamento OU producao_lancamentos.
  PERFORM public._seg_exige_pagina('criacao_planejamento', 'producao_lancamentos');
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado';
  END IF;

  IF _send THEN
    SELECT id INTO v_cad FROM public.cad WHERE modelo_id = _modelo_id LIMIT 1;
    -- [modularidade P-252 A] sem o modulo Producao da LOJA (sem atalho de super admin) o Lancar nao exige o CQ;
    -- M.O. aprovada e Data de Lancamento seguem obrigatorias.
    IF public._tenant_modulo_ligado(v_tenant, 'producao') AND (v_cad IS NULL OR NOT public._cq_liberado(v_cad)) THEN
      RAISE EXCEPTION 'Confirme o Controle de Qualidade antes de lançar.' USING ERRCODE='42501';
    END IF;
    IF NOT COALESCE((SELECT custo_terceirizados_aprovado FROM public.modelos
                      WHERE id = _modelo_id AND tenant_id = v_tenant), false) THEN
      RAISE EXCEPTION 'Aprove a mão de obra antes de lançar.' USING ERRCODE='42501';
    END IF;
    IF _data_lancamento IS NULL THEN
      RAISE EXCEPTION 'Informe a Data de Lançamento.' USING ERRCODE='42501';
    END IF;

    UPDATE public.modelos
       SET lancado = true,
           data_lancamento = _data_lancamento,
           revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb) - 'lancamentos'
     WHERE id = _modelo_id AND tenant_id = v_tenant;
  ELSE
    UPDATE public.modelos
       SET lancado = false
     WHERE id = _modelo_id AND tenant_id = v_tenant;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.otb_excluir_colecao(_colecao_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_planejados int;
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  -- [modularidade P-255 A] trava a linha da colecao ANTES de contar: card que grava colecao_id pega FOR KEY SHARE nela (FK)
  -- e conflita com FOR UPDATE - o card em voo termina antes (e e contado) ou espera esta transacao (e falha na FK depois).
  perform 1 from colecoes where id = _colecao_id and tenant_id = v_tenant for update;
  if not found then raise exception 'Coleção não encontrada'; end if;

  -- [modularidade P-255 A] colecao com QUALQUER card no Planejamento e recusada (antes: so 'planejado'; os demais eram apagados).
  -- O plano de tecido da colecao segue apagado junto (o front avisa).
  select count(*) into v_planejados from modelos
    where tenant_id = v_tenant and colecao_id = _colecao_id;
  if v_planejados > 0 then
    raise exception 'colecao_com_cards: %', v_planejados using errcode = 'P0001';
  end if;

  perform set_config('app.otb_reconciling', 'on', true);
  -- [modularidade P-255 A] o 'delete from modelos' saiu: card NUNCA e apagado com a colecao (a FK NO ACTION de
  -- modelos.colecao_id recusa o delete da colecao se ainda houver card apontando para ela).
  -- apaga a árvore de Plan. Tecido antes do cascade de colecoes (FK NO ACTION em subcolecao_id)
  delete from plan_tecido where colecao_id = _colecao_id;
  delete from colecoes where id = _colecao_id and tenant_id = v_tenant;
end;
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.lancar_modelo(uuid,date,boolean)', '3a79fd6fa5ca7959640618057b385620', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.otb_excluir_colecao(uuid)', '4ba36eb4972d10832ed8eb1e8b89adea', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
    ) AS x(f, m, acl) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'mod2_lancar_colecao: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef AND p.proconfig = ARRAY['search_path=public'])
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'mod2_lancar_colecao: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
