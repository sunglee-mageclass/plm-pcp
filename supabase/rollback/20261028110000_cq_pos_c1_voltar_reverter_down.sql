-- INVERSO de supabase/migrations/20261028110000_cq_pos_c1_voltar_reverter.sql (achados LEVES L6: R13 Pos [C1], prod #13,
-- R13 N1 + R15a L2 e completar o "Faltou estoque" ao reverter corte).
-- Devolve o texto de ANTES das 3 funcoes: _salvar_cq_pos_core ([C1] so no clique "Confirmar"), _voltar_cq_para_servico_core
-- (sem zerar o grade_detalhe, sem repor a Grade Real, sem limpar direcionamento_confirmado_at, sem travar cedo) e
-- _reverter_corte_tecido_core (blocos antes do CQ, sem advisory). Nada gravado muda (o que ja foi zerado/
-- completado fica como esta).
-- Guarda: so roda se as 3 estao EXATAMENTE com o texto da ida (md5 de depois) e o helper da R15a segue com o texto
-- conferido; outro -> P0001 e nada muda (rodar 2x = a 2a recusa).
-- LIFO: roda DEPOIS do inverso 20261028120000 e ANTES do 20261028100000_down e dos inversos da R15a e da R13.
-- Travas: so CREATE OR REPLACE FUNCTION. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._salvar_cq_pos_core(uuid,jsonb,jsonb,boolean)', '677a4272cdb2232e06c953af7d073b33'),
      ('public._voltar_cq_para_servico_core(uuid)', '263d1d86801f8d281776a8f50ad21f81'),
      ('public._reverter_corte_tecido_core(uuid)', 'c3ca9c2102f75b085f92380f24f371c0'),
      ('public._completar_deficit_corte_variante(uuid,uuid)', '70a91eef1ac40cce86ff7da8e6b14c7f')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'leves_l6_cq (volta): % nao existe', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l6_cq (volta): % nao esta com o texto esperado da 20261028110000 (md5 %) - nada a desfazer ou outra frente mexeu', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE TEMP TABLE _l6bv_acl_antes ON COMMIT DROP AS
  SELECT v.s AS assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v.s)) AS acl
    FROM (VALUES ('public._salvar_cq_pos_core(uuid,jsonb,jsonb,boolean)'),
                 ('public._voltar_cq_para_servico_core(uuid)'),
                 ('public._reverter_corte_tecido_core(uuid)')) v(s);

CREATE OR REPLACE FUNCTION public._salvar_cq_pos_core(_cad_id uuid, _cq_pos jsonb, _itens jsonb, _confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_cq_id uuid; v_status_atual text; v_status_pre text;
  v_status text; v_confirmado_at timestamptz; v_total_pos int; r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  SELECT id, status_pos, status INTO v_cq_id, v_status_atual, v_status_pre
  FROM public.controle_qualidade WHERE cad_id = _cad_id;

  IF _confirmar AND COALESCE(v_status_pre,'') <> 'confirmado' THEN
    RAISE EXCEPTION 'Confirme o CQ (Pré) deste modelo antes de confirmar o CQ Pós.';
  END IF;

  IF _confirmar THEN
    SELECT COALESCE(SUM((SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(e->'grades','{}'::jsonb)) x)), 0)
      INTO v_total_pos FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e;
    IF v_total_pos = 0 THEN
      RAISE EXCEPTION 'Conte ao menos uma peça no CQ Pós (acabamento) antes de confirmar.';
    END IF;
  END IF;

  v_status := CASE
    WHEN _confirmar THEN 'confirmado'
    WHEN v_cq_id IS NOT NULL THEN COALESCE(v_status_atual, 'pendente')
    ELSE 'pendente'
  END;
  v_confirmado_at := CASE WHEN v_status = 'confirmado' THEN now() ELSE NULL END;

  IF v_cq_id IS NULL THEN
    INSERT INTO public.controle_qualidade
      (cad_id, tenant_id, status_pos, confirmado_pos_at, observacoes_cq_pos, fotografado_variantes_pos, datas_conserto_pos)
    VALUES (_cad_id, v_tenant, v_status, v_confirmado_at,
            _cq_pos->>'observacoes_cq_pos', COALESCE(_cq_pos->'fotografado_variantes_pos','{}'::jsonb),
            COALESCE(_cq_pos->'datas_conserto_pos','{}'::jsonb))
    RETURNING id INTO v_cq_id;
  ELSE
    UPDATE public.controle_qualidade SET
      status_pos = v_status,
      confirmado_pos_at = CASE WHEN v_status = 'confirmado' THEN COALESCE(confirmado_pos_at, now()) ELSE NULL END,
      observacoes_cq_pos = _cq_pos->>'observacoes_cq_pos',
      fotografado_variantes_pos = COALESCE(_cq_pos->'fotografado_variantes_pos','{}'::jsonb),
      datas_conserto_pos = COALESCE(_cq_pos->'datas_conserto_pos','{}'::jsonb)
    WHERE id = v_cq_id;
  END IF;

  DELETE FROM public.cq_pos_variantes WHERE controle_qualidade_id = v_cq_id;
  IF jsonb_typeof(_itens) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(_itens) LOOP
      INSERT INTO public.cq_pos_variantes
        (controle_qualidade_id, producao_terceirizado_id, variante_numero, etapa, grades, grade_total, destino_defeito)
      VALUES (
        v_cq_id, (r->>'producao_terceirizado_id')::uuid, (r->>'variante_numero')::int, r->>'etapa',
        COALESCE(r->'grades','{}'::jsonb),
        (SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(r->'grades','{}'::jsonb)) x),
        NULLIF(r->>'destino_defeito','')
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('cq_id', v_cq_id, 'status_pos', v_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public._voltar_cq_para_servico_core(_cad_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_modelo uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id, modelo_id INTO v_tenant, v_modelo FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'CAD não encontrado';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  -- Desfaz o CQ (cascateia cq_variantes/cq_pos_variantes) e o direcionamento (defensivo,
  -- as duas tabelas — legado + multi-lojas).
  DELETE FROM public.controle_qualidade WHERE cad_id = _cad_id;
  DELETE FROM public.direcionamento     WHERE cad_id = _cad_id;
  DELETE FROM public.direcionamento_lojas WHERE cad_id = _cad_id;

  -- Reabre TODOS os serviços ativos (pré E pós-costura): desfaz o recebimento → deixam de estar
  -- "finalizados" → o modelo sai do CQ e volta pra Serviços. O trigger auto_status_prod_terc_trg
  -- reajusta o status. NÃO apaga o serviço nem a conta a pagar, e NÃO mexe no corte.
  UPDATE public.producao_terceirizados
     SET data_entregue = NULL,
         quantidade_recebida = 0,
         quantidade_defeito = 0
   WHERE cad_id = _cad_id
     AND COALESCE(ativo, true) = true;

  -- Reseta direcionamento_status e limpa flags de #Erro (por último).
  UPDATE public.cad SET direcionamento_status = 'pendente' WHERE id = _cad_id;
  UPDATE public.modelos
     SET revisao_pendente = (COALESCE(revisao_pendente, '{}'::jsonb) - 'cq' - 'direcionamento' - 'lancamentos'),
         lancado = false
   WHERE id = v_modelo;
END;
$function$;

CREATE OR REPLACE FUNCTION public._reverter_corte_tecido_core(_cad_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_modelo uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id, modelo_id INTO v_tenant, v_modelo FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'CAD não encontrado';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  -- Guarda financeira: não desfaz serviço com conta a pagar JÁ PAGA.
  IF EXISTS (
    SELECT 1 FROM public.parcelas_servico ps
    JOIN public.producao_terceirizados pt ON pt.id = ps.producao_terceirizado_id
    WHERE pt.cad_id = _cad_id AND ps.status = 'pago'
  ) THEN
    RAISE EXCEPTION 'Não é possível voltar: há conta a pagar de serviço já paga. Cancele o pagamento antes de reverter.' USING ERRCODE='42501';
  END IF;

  -- Apaga o downstream do corte (serviços cascateiam parcelas_servico NÃO pagas;
  -- controle_qualidade cascateia cq_variantes/cq_pos_variantes).
  DELETE FROM public.producao_terceirizados WHERE cad_id = _cad_id;
  DELETE FROM public.producao_oficina       WHERE cad_id = _cad_id;
  DELETE FROM public.controle_qualidade      WHERE cad_id = _cad_id;
  DELETE FROM public.direcionamento          WHERE cad_id = _cad_id;
  DELETE FROM public.direcionamento_lojas    WHERE cad_id = _cad_id;
  DELETE FROM public.estoque_tecido_baixas   WHERE cad_id = _cad_id;

  -- Volta o CAD pro estado pré-corte ANTES de mexer na grade — com direcionamento_status
  -- já 'pendente', o trg_rebaixa_direcionamento_grade não re-acende #Erro no UPDATE de cad_grades.
  UPDATE public.cad
     SET enviado_corte = false,
         status_corte = 'pendente',
         data_enviado_corte = NULL,
         direcionamento_status = 'pendente'
   WHERE id = _cad_id;

  -- A grade REAL vinha do CQ (agora apagado): volta a espelhar a planejada.
  UPDATE public.cad_grades
     SET grades_reais = grades_planejadas,
         grade_total_real = grade_total_planejada
   WHERE cad_id = _cad_id;

  -- Limpa flags de #Erro e "lançado" no modelo POR ÚLTIMO (neutraliza qualquer flag que os
  -- triggers de rebaixa (cad_grades / controle_qualidade) tenham re-acendido nos passos acima).
  UPDATE public.modelos
     SET revisao_pendente = (COALESCE(revisao_pendente, '{}'::jsonb)
                             - 'terceirizados' - 'oficina' - 'cq' - 'direcionamento' - 'lancamentos'),
         lancado = false
   WHERE id = v_modelo;
END;
$function$;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._salvar_cq_pos_core(uuid,jsonb,jsonb,boolean)', 'b68afafc8dfa6b71e94876e4f6665f10'),
      ('public._voltar_cq_para_servico_core(uuid)', '15105995fa5aeac934f29808721917f4'),
      ('public._reverter_corte_tecido_core(uuid)', 'aa5b0e56aea76d11a815c064e2cb1b0c')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l6_cq (volta): pos-condicao falhou - % nao voltou ao texto de antes (md5 %)', r.s,
        md5(pg_get_functiondef(to_regprocedure(r.s))) USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT assinatura, acl FROM _l6bv_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'leves_l6_cq (volta): pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', to_regprocedure(r.assinatura), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.assinatura), 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.assinatura) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l6_cq (volta): % ficou executavel por PUBLIC/anon/authenticated (inv. #9)', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
