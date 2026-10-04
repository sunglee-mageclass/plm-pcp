-- Inverso de supabase/migrations/20261103110000_mod_lancar_colecao.sql — GERADO por .superpowers/sdd/2026-10-04-modularidade/mig/gerar-mod2.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md (§0 M2, §4 T2, §13); desenho.md (+ RESPOSTAS DO DONO, P-252 A/P-255 A).
-- NEUTRO: devolve os 2 textos de ANTES (md5 conferido). Sem DROP.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.lancar_modelo(uuid,date,boolean)  [P-252 A]
--     ANTES  efe52aaad9a1e6055d758cf93e1950d5
--     DEPOIS 3a79fd6fa5ca7959640618057b385620
--   public.otb_excluir_colecao(uuid)  [P-255 A]
--     ANTES  5557291079763a24fdf202c46671d3c0
--     DEPOIS b5abbfad66773c3c4d7789418b9107a1
-- ====================================================================================
-- Trava: so catalogo (CREATE OR REPLACE FUNCTION): nenhuma tabela, nada de auth/storage/realtime. Sem DROP, sem TRIGGER/POLICY.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
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
      ('public.otb_excluir_colecao(uuid)', '5557291079763a24fdf202c46671d3c0', 'b5abbfad66773c3c4d7789418b9107a1')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'mod2_lancar_colecao_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
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
    IF v_cad IS NULL OR NOT public._cq_liberado(v_cad) THEN
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

  perform 1 from colecoes where id = _colecao_id and tenant_id = v_tenant;
  if not found then raise exception 'Coleção não encontrada'; end if;

  select count(*) into v_planejados from modelos
    where tenant_id = v_tenant and colecao_id = _colecao_id and status_planejamento = 'planejado';
  if v_planejados > 0 then
    raise exception 'Não é possível excluir: % modelo(s) desta coleção já está(ão) em status planejado. Remova/reprove antes.', v_planejados;
  end if;

  perform set_config('app.otb_reconciling', 'on', true);
  delete from modelos where tenant_id = v_tenant and colecao_id = _colecao_id;
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
      ('public.lancar_modelo(uuid,date,boolean)', 'efe52aaad9a1e6055d758cf93e1950d5', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.otb_excluir_colecao(uuid)', '5557291079763a24fdf202c46671d3c0', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
    ) AS x(f, m, acl) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'mod2_lancar_colecao_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef AND p.proconfig = ARRAY['search_path=public'])
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'mod2_lancar_colecao_down: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
