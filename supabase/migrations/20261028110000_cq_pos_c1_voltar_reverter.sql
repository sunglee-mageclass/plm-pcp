-- Achados LEVES, release L6 (CQ, producao e completar falta) - parte 2: R13 Pos [C1], prod #13, R13 N1 + R15a L2 e a
-- completacao do "Faltou estoque" ao reverter um corte. So CREATE OR REPLACE de 3 funcoes (sem site obrigatorio).
--   R13 Pos [C1]  _salvar_cq_pos_core: o [C1] do Pos ("nao confirmar com 0 pecas") so rodava no clique "Confirmar"
--                 (IF _confirmar). Agora roda quando o status FINAL do save e 'confirmado' - tambem no Salvar de um Pos
--                 ja confirmado (mesmo furo do prod #4 do Pre, fechado na R13). Mesma mensagem P0001 em PT de hoje
--                 (P0001 = 400 no PostgREST; acento permitido - reference_raise_5xx_ascii). So o calculo do status subiu
--                 para antes do [C1]; o resto do texto e o de antes.
--   prod #13      _voltar_cq_para_servico_core ("Voltar para Servicos" no CQ): alem de apagar CQ/Direcionamento e zerar
--                 a recebida/defeito escalares, agora, na MESMA transacao: zera recebida/defeito em cada celula do
--                 grade_detalhe dos blocos ativos (o bloco-fonte incluido; cortada/enviada ficam), limpa
--                 cad.direcionamento_confirmado_at e volta a Grade Real a espelhar a planejada (cad_grades reais =
--                 planejadas, como o Reverter corte). Trava cedo: advisory do cad do PCP -> CQ (ordem global).
--   R13 N1 + R15a L2  _reverter_corte_tecido_core: trava, ANTES de tocar linha, a trava do corte da loja
--                 (pg_advisory_xact_lock 'corte_tenant:' - a do corte e do completar), a do cad do PCP (hashtext(cad))
--                 e o CQ (FOR UPDATE): ordem global corte da loja -> cad do PCP -> CQ -> blocos -> cad -> cad_grades
--                 (antes: blocos ANTES do CQ = 40P01 raro com o PCP; e a baixa de completar podia sobrar num cad
--                 revertido). Limpa tambem cad.direcionamento_confirmado_at e cad.deficit_corte do corte desfeito.
--                 [fix round 1, M1] o reverter NAO completa o "Faltou estoque" de outros cortes com o tecido devolvido
--                 (voltar -> corrigir -> reenviar nao pode entregar o tecido do card a cortes mais antigos); completar
--                 so pelo botao "Reprocessar faltas" (reprocessar_faltas_corte, 20261028120000).
-- Nada gravado muda na ida (as funcoes so agem no proximo save/clique).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public._salvar_cq_pos_core(uuid,jsonb,jsonb,boolean)
--     ANTES  b68afafc8dfa6b71e94876e4f6665f10  -- PROVISORIO (copia 54422; fora do Passo 0 dos MEDIOS): conferir no Passo 0 dos LEVES
--     DEPOIS 677a4272cdb2232e06c953af7d073b33  (este arquivo; reaplicar = no-op)
--   public._voltar_cq_para_servico_core(uuid)
--     ANTES  15105995fa5aeac934f29808721917f4  -- PROVISORIO (copia 54422): conferir no Passo 0 dos LEVES
--     DEPOIS 263d1d86801f8d281776a8f50ad21f81
--   public._reverter_corte_tecido_core(uuid)
--     ANTES  aa5b0e56aea76d11a815c064e2cb1b0c  -- PROVISORIO (copia 54422): conferir no Passo 0 dos LEVES
--     DEPOIS c3ca9c2102f75b085f92380f24f371c0
--   Sem mudanca (so guarda - dependencias):
--     public._completar_deficit_corte_variante(uuid,uuid)       70a91eef1ac40cce86ff7da8e6b14c7f  -- R15a "depois" (so ACL; o reverter nao o chama mais)
--     public.salvar_terceirizados(uuid,jsonb,text,jsonb)          e5a6f830516e463911529664a4940883  -- R13 "depois" (mesma ordem de travas)
--     public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb) 3e8dc987ed35806afbad8cece86562f0  -- R13 "depois" (mesma ordem de travas)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION (trava de objeto da propria funcao; nada em tabela, nada em auth/storage). Sem DDL
-- de tabela, sem DROP, sem funcao nova. ACL: CREATE OR REPLACE mantem a de hoje; a pos-condicao confere que ficou
-- IDENTICA e que os 3 _core seguem sem EXECUTE para PUBLIC/anon/authenticated (inv. #9) e os wrappers publicos
-- (salvar_cq_pos, voltar_cq_para_servico, reverter_corte_tecido) seguem COM authenticated e SEM PUBLIC/anon.
-- Volta: supabase/rollback/20261028110000_cq_pos_c1_voltar_reverter_down.sql (devolve os 3 textos de antes, com guarda
-- dos de depois). LIFO: o inverso desta roda DEPOIS do inverso 20261028120000 (que chama o mesmo helper) e ANTES do
-- 20261028100000_down e dos inversos da R15a (20261025300000: o helper) e da R13 (20261023100000: a ordem de travas).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _l6b_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _l6b_md5_aceitos VALUES
  ('public._salvar_cq_pos_core(uuid,jsonb,jsonb,boolean)', 'b68afafc8dfa6b71e94876e4f6665f10', 'antes'),  -- PROVISORIO (copia 54422): conferir no Passo 0 dos LEVES
  ('public._salvar_cq_pos_core(uuid,jsonb,jsonb,boolean)', '677a4272cdb2232e06c953af7d073b33', 'depois'),
  ('public._voltar_cq_para_servico_core(uuid)', '15105995fa5aeac934f29808721917f4', 'antes'),  -- PROVISORIO (copia 54422): conferir no Passo 0 dos LEVES
  ('public._voltar_cq_para_servico_core(uuid)', '263d1d86801f8d281776a8f50ad21f81', 'depois'),
  ('public._reverter_corte_tecido_core(uuid)', 'aa5b0e56aea76d11a815c064e2cb1b0c', 'antes'),  -- PROVISORIO (copia 54422): conferir no Passo 0 dos LEVES
  ('public._reverter_corte_tecido_core(uuid)', 'c3ca9c2102f75b085f92380f24f371c0', 'depois'),
  ('public._completar_deficit_corte_variante(uuid,uuid)', '70a91eef1ac40cce86ff7da8e6b14c7f', 'dep'),  -- R15a depois
  ('public.salvar_terceirizados(uuid,jsonb,text,jsonb)', 'e5a6f830516e463911529664a4940883', 'dep'),  -- R13 depois
  ('public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)', '3e8dc987ed35806afbad8cece86562f0', 'dep');  -- R13 depois

-- ACL de antes (a pos-condicao exige a MESMA depois), das 3 _core e dos 3 wrappers.
CREATE TEMP TABLE _l6b_acl_antes ON COMMIT DROP AS
  SELECT v.s AS assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v.s)) AS acl
    FROM (VALUES ('public._salvar_cq_pos_core(uuid,jsonb,jsonb,boolean)'),
                 ('public._voltar_cq_para_servico_core(uuid)'),
                 ('public._reverter_corte_tecido_core(uuid)'),
                 ('public.salvar_cq_pos(uuid,jsonb,jsonb,boolean)'),
                 ('public.voltar_cq_para_servico(uuid)'),
                 ('public.reverter_corte_tecido(uuid)')) v(s);

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _l6b_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'leves_l6_cq: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _l6b_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'leves_l6_cq: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES ('public.salvar_cq_pos(uuid,jsonb,jsonb,boolean)'),
                                 ('public.voltar_cq_para_servico(uuid)'),
                                 ('public.reverter_corte_tecido(uuid)')) v(s) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'leves_l6_cq: wrapper % nao existe neste banco', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

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

  v_status := CASE
    WHEN _confirmar THEN 'confirmado'
    WHEN v_cq_id IS NOT NULL THEN COALESCE(v_status_atual, 'pendente')
    ELSE 'pendente'
  END;
  v_confirmado_at := CASE WHEN v_status = 'confirmado' THEN now() ELSE NULL END;

  -- [C1] pelo STATUS FINAL (leves L6, "R13 Pós [C1]"; mesmo furo do prod #4 do Pré): vale no clique "Confirmar"
  -- E no Salvar de um Pós JÁ confirmado — não deixa um Pós confirmado com Σ = 0 peças. Mesma mensagem de sempre.
  IF v_status = 'confirmado' THEN
    SELECT COALESCE(SUM((SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(e->'grades','{}'::jsonb)) x)), 0)
      INTO v_total_pos FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e;
    IF v_total_pos = 0 THEN
      RAISE EXCEPTION 'Conte ao menos uma peça no CQ Pós (acabamento) antes de confirmar.';
    END IF;
  END IF;

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

  -- (leves L6) ordem GLOBAL das travas (a mesma do PCP salvar_terceirizados e das RPCs do CQ): trava do cad do PCP
  -- (advisory) -> CQ -> blocos -> cad -> cad_grades. Sem CQ = nenhuma linha travada.
  PERFORM pg_advisory_xact_lock(hashtext(_cad_id::text));
  PERFORM 1 FROM public.controle_qualidade WHERE cad_id = _cad_id FOR UPDATE;

  -- Desfaz o CQ (cascateia cq_variantes/cq_pos_variantes) e o direcionamento (defensivo,
  -- as duas tabelas — legado + multi-lojas).
  DELETE FROM public.controle_qualidade WHERE cad_id = _cad_id;
  DELETE FROM public.direcionamento     WHERE cad_id = _cad_id;
  DELETE FROM public.direcionamento_lojas WHERE cad_id = _cad_id;

  -- Reabre TODOS os serviços ativos (pré E pós-costura): desfaz o recebimento → deixam de estar
  -- "finalizados" → o modelo sai do CQ e volta pra Serviços. O trigger auto_status_prod_terc_trg
  -- reajusta o status. NÃO apaga o serviço nem a conta a pagar, e NÃO mexe no corte.
  -- (leves L6, prod #13) o recebimento destrinchado também volta: recebida/defeito = 0 em cada célula do
  -- grade_detalhe (o bloco-fonte da Grade Real incluído; cortada/enviada ficam) — senão o próximo CQ/PCP
  -- re-derivava a Grade Real do recebimento desfeito.
  UPDATE public.producao_terceirizados
     SET data_entregue = NULL,
         quantidade_recebida = 0,
         quantidade_defeito = 0,
         grade_detalhe = CASE
           WHEN jsonb_typeof(grade_detalhe) = 'object' THEN COALESCE((
             SELECT jsonb_object_agg(v.key, CASE
                      WHEN jsonb_typeof(v.value) = 'object' THEN COALESCE((
                        SELECT jsonb_object_agg(t.key, CASE
                                 WHEN jsonb_typeof(t.value) = 'object'
                                 THEN t.value || '{"recebida": 0, "defeito": 0}'::jsonb
                                 ELSE t.value END)
                          FROM jsonb_each(v.value) t), '{}'::jsonb)
                      ELSE v.value END)
               FROM jsonb_each(grade_detalhe) v), '{}'::jsonb)
           ELSE grade_detalhe END
   WHERE cad_id = _cad_id
     AND COALESCE(ativo, true) = true;

  -- Reseta direcionamento_status (+ a data do Confirmar, prod #13) ANTES da grade — com 'pendente' o
  -- trg_rebaixa_direcionamento_grade não re-acende #Erro no UPDATE de cad_grades.
  UPDATE public.cad
     SET direcionamento_status = 'pendente',
         direcionamento_confirmado_at = NULL
   WHERE id = _cad_id;

  -- (leves L6, prod #13) a Grade Real vinha do CQ (agora apagado): volta a espelhar a planejada (igual ao
  -- Reverter corte). Na mesma transação.
  UPDATE public.cad_grades
     SET grades_reais = grades_planejadas,
         grade_total_real = grade_total_planejada
   WHERE cad_id = _cad_id;

  -- Limpa flags de #Erro (por último: neutraliza o que os gatilhos de rebaixa re-acenderam acima).
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

  -- (leves L6) ordem GLOBAL das travas, ANTES de tocar qualquer linha:
  --   1. trava do corte da loja (R15a L2: a mesma do _baixar_estoque_tecido_corte_core e do completar o "Faltou
  --      estoque" - nenhum corte/completar da loja corre no meio do reverter, e a baixa de completar nunca sobra
  --      num cad revertido). O tecido devolvido NÃO completa a falta de outros cortes aqui (fix round 1, M1: voltar →
  --      corrigir → reenviar não pode entregar o tecido do card a cortes mais antigos); completar = botão
  --      "Reprocessar faltas" (reprocessar_faltas_corte);
  --   2. trava do cad do PCP (a mesma do salvar_terceirizados);
  --   3. CQ do cad (R13 N1: antes dos blocos, como o PCP e as RPCs do CQ) -> blocos -> cad -> cad_grades.
  PERFORM pg_advisory_xact_lock(hashtext('corte_tenant:' || v_tenant::text));
  PERFORM pg_advisory_xact_lock(hashtext(_cad_id::text));
  PERFORM 1 FROM public.controle_qualidade WHERE cad_id = _cad_id FOR UPDATE;

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
  -- (leves L6) também limpa a data do Confirmar do Direcionamento e o "Faltou estoque" do corte desfeito.
  UPDATE public.cad
     SET enviado_corte = false,
         status_corte = 'pendente',
         data_enviado_corte = NULL,
         direcionamento_status = 'pendente',
         direcionamento_confirmado_at = NULL,
         deficit_corte = NULL
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
  v_md5 text;
BEGIN
  FOR r IN SELECT assinatura, md5, papel FROM _l6b_md5_aceitos WHERE papel IN ('depois','dep') LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'leves_l6_cq: pos-condicao falhou - % nao ficou com o texto esperado (%, md5 %)', r.assinatura, r.papel, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT assinatura, acl FROM _l6b_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'leves_l6_cq: pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: os _core sem EXECUTE para PUBLIC/anon/authenticated.
  FOR r IN SELECT * FROM (VALUES ('public._salvar_cq_pos_core(uuid,jsonb,jsonb,boolean)'),
                                 ('public._voltar_cq_para_servico_core(uuid)'),
                                 ('public._reverter_corte_tecido_core(uuid)'),
                                 ('public._completar_deficit_corte_variante(uuid,uuid)')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l6_cq: % ficou executavel por PUBLIC/anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- wrappers publicos: authenticated SIM; anon e PUBLIC NAO (como hoje).
  FOR r IN SELECT * FROM (VALUES ('public.salvar_cq_pos(uuid,jsonb,jsonb,boolean)'),
                                 ('public.voltar_cq_para_servico(uuid)'),
                                 ('public.reverter_corte_tecido(uuid)')) v(s) LOOP
    IF NOT has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l6_cq: ACL do wrapper % fora do esperado (authenticated sim; anon/PUBLIC nao)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
