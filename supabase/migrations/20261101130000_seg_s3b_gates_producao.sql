-- Reforço de segurança — sub-release S3b ("Produção, Expedição e Explosão"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3b.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.3-2.4, §3, §6 S3b); plano: plan.md (P-231 = D2 A; P-245 = A).
-- Permissao de PAGINA no servidor (P-231 = D2 A) nas RPCs de Producao/Expedicao/Explosao, com o helper _seg_exige_pagina da
-- S3a (42501 'sem_permissao_pagina: <chaves>'), logo depois da checagem de login/modulo que ja existe (o _core segue sem
-- EXECUTE, inv. 9): corte/Explosao (baixar_estoque_tecido_corte, salvar_explosao_metragem/_aviamento_separar/_etiqueta_enviar,
-- voltar_modelo_desenvolvimento) = Explosao; reverter_corte_tecido = PCP Servicos OU Explosao (C-06); salvar_terceirizados =
-- PCP Servicos OU Etapas (C-09); CQ Pre/Pos (salvar/desmarcar/voltar ao servico) = CQ; salvar/confirmar_direcionamento (as 4
-- sobrecargas) = Direcionamento; marcar_etapa_verificada (P-245 A) = modulo Criacao OU Producao + a pagina da ETAPA (C-08).
-- Nenhuma GUC nova (voltar_modelo_desenvolvimento, a unica INVOKER, segue com a app.explosao_sistema da S1).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.baixar_estoque_tecido_corte(uuid,integer)
--     ANTES  5dda094db517e00cfd33ec0cfbf20c4b
--     DEPOIS 9cac6689b615cc1eed1fa8de894dbb5a
--   public.salvar_explosao_metragem(uuid,jsonb,integer)
--     ANTES  2b5aba5b5950a2f1a518e272ce7d9119
--     DEPOIS 95fa0bdd1b1a5045781e2152edba4980
--   public.salvar_explosao_aviamento_separar(uuid,jsonb,integer)
--     ANTES  1845b1344db449e48bce8b7c130a21e3
--     DEPOIS e0f35d177abd29b05557f22837f9ef9c
--   public.salvar_explosao_etiqueta_enviar(uuid,jsonb,integer)
--     ANTES  4878cd5b60d6325eb61205cf4f457ee7
--     DEPOIS 9ba9b5dcb9917290db0b463dd12e7049
--   public.voltar_modelo_desenvolvimento(uuid)
--     ANTES  b5c893d56d4745b0a4e0938b20676ba7
--     DEPOIS f113c6d63fe95083b71238a21b0914ca
--   public.reverter_corte_tecido(uuid)
--     ANTES  a0618165459e6f108234568e2a9f2b55
--     DEPOIS 3828600c053a87149670e0cff9985f5e
--   public.salvar_terceirizados(uuid,jsonb,text,jsonb)
--     ANTES  e5a6f830516e463911529664a4940883
--     DEPOIS 7199a05fac6716ac110bfa637944c2e9
--   public.salvar_cq(uuid,jsonb,jsonb,jsonb,boolean,jsonb)
--     ANTES  f97b669067369880338e13ba0bd02da8
--     DEPOIS a8a4e3897521959ed703a3ed3334d2a1
--   public.desmarcar_cq(uuid)
--     ANTES  359e16a0cc30fa685400590938153441
--     DEPOIS 8f60caff1f81f138f7e94c8f422608e9
--   public.voltar_cq_para_servico(uuid)
--     ANTES  b59ab5ce0ac0508b1d12eee3a09c186f
--     DEPOIS 0864b68c5b72e7a3ad5962fe2436f76c
--   public.salvar_cq_pos(uuid,jsonb,jsonb,boolean)
--     ANTES  f286be52d2661accdf1a6e7b15967b3a
--     DEPOIS 3979153ea0aee5aea6456a3b225f5c35
--   public.desmarcar_cq_pos(uuid)
--     ANTES  769367d2984c389358b9271f90565abe
--     DEPOIS fe4290b5047b7e901f105ac310788e5e
--   public.salvar_direcionamento(uuid,jsonb)
--     ANTES  b3b3825d18cb62d9e128bf575aae4b84
--     DEPOIS 1ad733ba008eeede3c5448c8556c6a25
--   public.salvar_direcionamento(uuid,jsonb,jsonb)
--     ANTES  936e401662f35fe205c85d11e13e2d82
--     DEPOIS 7f5e84c87bcfe7f14d123053063da1d0
--   public.confirmar_direcionamento(uuid,jsonb)
--     ANTES  f77843db2651601c490bd3c64f4f8030
--     DEPOIS dfb42e20403796a8dfa227d9d29bcbcc
--   public.confirmar_direcionamento(uuid,jsonb,jsonb)
--     ANTES  eabcf06adce7b406982d69299c116d49
--     DEPOIS ae30cec520c8a1cc436e500b3b976396
--   public.marcar_etapa_verificada(uuid,text)
--     ANTES  4e959d07d13535aca36be38c6f19c3f3
--     DEPOIS 771b79bc4b30403c50f01256cfd6ba58
-- ====================================================================================
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION): nenhuma tabela de negócio, nada de auth/storage. Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261101130000_seg_s3b_gates_producao_down.sql (LIFO: 20261101150000_down → 140000_down → 130000_down, ANTES dos inversos da S3a/S2/S1 e
-- de releases anteriores que guardam por md5 as mesmas funções — ver s3b-report.md, seção "Cadeia md5").
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public._seg_exige_pagina(text[])'))) IS DISTINCT FROM '85eff0037e61fdecefb46154ac9479d2' THEN
    RAISE EXCEPTION 's3b_gates: rode antes a S3a 20261101100000 (_seg_exige_pagina ausente ou com texto inesperado)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.baixar_estoque_tecido_corte(uuid,integer)', '5dda094db517e00cfd33ec0cfbf20c4b', '9cac6689b615cc1eed1fa8de894dbb5a'),
      ('public.salvar_explosao_metragem(uuid,jsonb,integer)', '2b5aba5b5950a2f1a518e272ce7d9119', '95fa0bdd1b1a5045781e2152edba4980'),
      ('public.salvar_explosao_aviamento_separar(uuid,jsonb,integer)', '1845b1344db449e48bce8b7c130a21e3', 'e0f35d177abd29b05557f22837f9ef9c'),
      ('public.salvar_explosao_etiqueta_enviar(uuid,jsonb,integer)', '4878cd5b60d6325eb61205cf4f457ee7', '9ba9b5dcb9917290db0b463dd12e7049'),
      ('public.voltar_modelo_desenvolvimento(uuid)', 'b5c893d56d4745b0a4e0938b20676ba7', 'f113c6d63fe95083b71238a21b0914ca'),
      ('public.reverter_corte_tecido(uuid)', 'a0618165459e6f108234568e2a9f2b55', '3828600c053a87149670e0cff9985f5e'),
      ('public.salvar_terceirizados(uuid,jsonb,text,jsonb)', 'e5a6f830516e463911529664a4940883', '7199a05fac6716ac110bfa637944c2e9'),
      ('public.salvar_cq(uuid,jsonb,jsonb,jsonb,boolean,jsonb)', 'f97b669067369880338e13ba0bd02da8', 'a8a4e3897521959ed703a3ed3334d2a1'),
      ('public.desmarcar_cq(uuid)', '359e16a0cc30fa685400590938153441', '8f60caff1f81f138f7e94c8f422608e9'),
      ('public.voltar_cq_para_servico(uuid)', 'b59ab5ce0ac0508b1d12eee3a09c186f', '0864b68c5b72e7a3ad5962fe2436f76c'),
      ('public.salvar_cq_pos(uuid,jsonb,jsonb,boolean)', 'f286be52d2661accdf1a6e7b15967b3a', '3979153ea0aee5aea6456a3b225f5c35'),
      ('public.desmarcar_cq_pos(uuid)', '769367d2984c389358b9271f90565abe', 'fe4290b5047b7e901f105ac310788e5e'),
      ('public.salvar_direcionamento(uuid,jsonb)', 'b3b3825d18cb62d9e128bf575aae4b84', '1ad733ba008eeede3c5448c8556c6a25'),
      ('public.salvar_direcionamento(uuid,jsonb,jsonb)', '936e401662f35fe205c85d11e13e2d82', '7f5e84c87bcfe7f14d123053063da1d0'),
      ('public.confirmar_direcionamento(uuid,jsonb)', 'f77843db2651601c490bd3c64f4f8030', 'dfb42e20403796a8dfa227d9d29bcbcc'),
      ('public.confirmar_direcionamento(uuid,jsonb,jsonb)', 'eabcf06adce7b406982d69299c116d49', 'ae30cec520c8a1cc436e500b3b976396'),
      ('public.marcar_etapa_verificada(uuid,text)', '4e959d07d13535aca36be38c6f19c3f3', '771b79bc4b30403c50f01256cfd6ba58')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 's3b_gates: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.baixar_estoque_tecido_corte(_cad_id uuid, _rev_base integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_explosao.
  PERFORM public._seg_exige_pagina('producao_explosao');
  PERFORM public._explosao_check_rev(_cad_id, _rev_base);
  RETURN public._baixar_estoque_tecido_corte_core(_cad_id);
END $function$;

CREATE OR REPLACE FUNCTION public.salvar_explosao_metragem(_cad_id uuid, _variantes jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; it jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_explosao.
  PERFORM public._seg_exige_pagina('producao_explosao');
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  PERFORM public._explosao_check_rev(_cad_id, _rev_base);
  IF jsonb_typeof(_variantes) = 'array' THEN
    FOR it IN SELECT value FROM jsonb_array_elements(_variantes) LOOP
      UPDATE public.cad_tecido_variantes ctv
         SET metragem_enviada  = COALESCE((it->>'metragem_enviada')::numeric, ctv.metragem_enviada),
             quantidade_folhas = COALESCE((it->>'quantidade_folhas')::numeric, ctv.quantidade_folhas)
       WHERE ctv.id = (it->>'id')::uuid
         AND ctv.cad_tecido_id IN (SELECT ct.id FROM public.cad_tecidos ct WHERE ct.cad_id = _cad_id);
    END LOOP;
  END IF;
  RETURN _cad_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.salvar_explosao_aviamento_separar(_cad_id uuid, _linhas jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; it jsonb; v_avi uuid; v_var uuid; v_val numeric; v_first uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_explosao.
  PERFORM public._seg_exige_pagina('producao_explosao');
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  PERFORM public._explosao_check_rev(_cad_id, _rev_base);
  IF jsonb_typeof(_linhas) = 'array' THEN
    FOR it IN SELECT value FROM jsonb_array_elements(_linhas) LOOP
      v_avi := NULLIF(it->>'aviamento_id','')::uuid;
      v_var := NULLIF(it->>'variante_aviamento_id','')::uuid;
      v_val := GREATEST(COALESCE((it->>'quantidade_separar')::numeric, 0), 0);
      IF v_avi IS NULL THEN CONTINUE; END IF;
      SELECT id INTO v_first FROM public.cad_aviamentos
       WHERE cad_id = _cad_id AND aviamento_id = v_avi AND variante_aviamento_id IS NOT DISTINCT FROM v_var
       ORDER BY numero NULLS LAST, id LIMIT 1;
      IF v_first IS NULL THEN CONTINUE; END IF;
      UPDATE public.cad_aviamentos
         SET quantidade_separar = CASE WHEN id = v_first THEN v_val ELSE 0 END
       WHERE cad_id = _cad_id AND aviamento_id = v_avi AND variante_aviamento_id IS NOT DISTINCT FROM v_var;
    END LOOP;
  END IF;
  RETURN _cad_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.salvar_explosao_etiqueta_enviar(_cad_id uuid, _linhas jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; it jsonb; v_id uuid; v_val numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_explosao.
  PERFORM public._seg_exige_pagina('producao_explosao');
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  PERFORM public._explosao_check_rev(_cad_id, _rev_base);
  IF jsonb_typeof(_linhas) = 'array' THEN
    FOR it IN SELECT value FROM jsonb_array_elements(_linhas) LOOP
      v_id  := NULLIF(it->>'id','')::uuid;
      v_val := GREATEST(COALESCE((it->>'quantidade_enviar')::numeric, 0), 0);
      IF v_id IS NULL THEN CONTINUE; END IF;
      UPDATE public.cad_etiquetas SET quantidade_enviar = v_val WHERE id = v_id AND cad_id = _cad_id;
    END LOOP;
  END IF;
  RETURN _cad_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.voltar_modelo_desenvolvimento(_modelo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_explosao_antes text;  -- [seg s1 M2]
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo criação não habilitado' using errcode = '42501';
  end if;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_explosao.
  PERFORM public._seg_exige_pagina('producao_explosao');

  -- Verifica que o modelo pertence ao tenant do usuário (ou é super_admin).
  if not exists (
    select 1 from public.modelos
    where id = _modelo_id
      and (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
  ) then
    raise exception 'Modelo não encontrado' using errcode = 'P0002';
  end if;

  v_explosao_antes := current_setting('app.explosao_sistema', true);  -- [seg s1 M2] Voltar ao Desenvolvimento (Explosao)
  PERFORM set_config('app.explosao_sistema', 'on', true);
  update public.modelos
    set enviado_cad = false
  where id = _modelo_id;
  PERFORM set_config('app.explosao_sistema', coalesce(v_explosao_antes, ''), true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reverter_corte_tecido(_cad_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_terceirizados OU producao_explosao.
  PERFORM public._seg_exige_pagina('producao_terceirizados', 'producao_explosao');
  PERFORM public._reverter_corte_tecido_core(_cad_id);
END $function$;

CREATE OR REPLACE FUNCTION public.salvar_terceirizados(_cad_id uuid, _blocos jsonb, _observacoes_molde text DEFAULT NULL::text, _rev_base jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; b jsonb; v_id uuid; v_ids uuid[] := '{}';
  v_fonte uuid; v_cq_conf boolean; v_total_real int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_terceirizados OU producao_etapas.
  PERFORM public._seg_exige_pagina('producao_terceirizados', 'producao_etapas');
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  IF NOT public.tenant_module_enabled('producao') THEN
    RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_cad_id::text));
  -- (medios R13, L1) trava o CQ do cad JÁ AQUI, antes de qualquer bloco: mesma ordem das RPCs
  -- do CQ (controle_qualidade → bloco-fonte), sem deadlock com o rebaixamento do P-192 abaixo.
  -- Sem CQ = nenhuma linha, nenhum efeito.
  PERFORM 1 FROM public.controle_qualidade WHERE cad_id = _cad_id FOR UPDATE;

  -- Trava otimista POR BLOCO (spec 2026-08-07): _rev_base = { bloco_id: rev }. Cada bloco
  -- EXISTENTE (com id) presente no payload tem o rev conferido contra o base; divergência =
  -- P0409. Bloco novo (sem id) não trava. Bloco sem entrada no base = bypass. _rev_base
  -- null/ausente = bypass (compat + super_admin). Lê FOR UPDATE (segura o lock até o UPDATE).
  IF _rev_base IS NOT NULL AND jsonb_typeof(_blocos) = 'array' THEN
    DECLARE v_bid uuid; v_rev int; v_base int;
    BEGIN
      FOR b IN SELECT value FROM jsonb_array_elements(_blocos) LOOP
        v_bid := NULLIF(b->>'id','')::uuid;
        IF v_bid IS NULL THEN CONTINUE; END IF;                 -- bloco novo não trava
        IF NOT (_rev_base ? v_bid::text) THEN CONTINUE; END IF; -- sem base p/ este bloco = bypass
        IF (_rev_base->>v_bid::text) IS NULL THEN CONTINUE; END IF;
        v_base := (_rev_base->>v_bid::text)::int;
        SELECT rev INTO v_rev FROM public.producao_terceirizados
          WHERE id = v_bid AND cad_id = _cad_id FOR UPDATE;     -- cad já foi tenant-verificado acima
        IF v_rev IS DISTINCT FROM v_base THEN
          RAISE EXCEPTION 'conflito_versao: um servico foi salvo por outra pessoa'
            USING ERRCODE = 'P0409';
        END IF;
      END LOOP;
    END;
  END IF;

  IF jsonb_typeof(_blocos) = 'array' THEN
    FOR b IN SELECT value FROM jsonb_array_elements(_blocos) LOOP
      IF NULLIF(b->>'id','') IS NOT NULL THEN
        UPDATE public.producao_terceirizados SET
          categoria_terceirizado_id = NULLIF(b->>'categoria_terceirizado_id','')::uuid,
          interno = COALESCE((b->>'interno')::boolean, false),
          empresa_id = NULLIF(b->>'empresa_id','')::uuid,
          representante_id = NULLIF(b->>'representante_id','')::uuid,
          colaborador_id = NULLIF(b->>'colaborador_id','')::uuid,
          ativo = COALESCE((b->>'ativo')::boolean, true),
          preco_metro_unidade = NULLIF(b->>'preco_metro_unidade','')::numeric,
          quantidade_enviada = NULLIF(b->>'quantidade_enviada','')::int,
          quantidade_recebida = NULLIF(b->>'quantidade_recebida','')::int,
          quantidade_defeito = NULLIF(b->>'quantidade_defeito','')::int,
          desconto_total = COALESCE(NULLIF(b->>'desconto_total','')::numeric, 0),
          multa_total = COALESCE(NULLIF(b->>'multa_total','')::numeric, 0),
          numero_parcelas = GREATEST(COALESCE(NULLIF(b->>'numero_parcelas','')::int, 1), 1),
          data_enviado = NULLIF(b->>'data_enviado','')::date,
          data_prevista = NULLIF(b->>'data_prevista','')::date,
          data_entregue = NULLIF(b->>'data_entregue','')::date,
          observacao = b->>'observacao',
          aviamentos_enviados = COALESCE(b->'aviamentos_enviados', '[]'::jsonb),
          tecidos_enviados = COALESCE(b->'tecidos_enviados', '[]'::jsonb),
          detalhado = COALESCE((b->>'detalhado')::boolean, false),
          grade_detalhe = COALESCE(b->'grade_detalhe', '{}'::jsonb),
          pt_data_saida = NULLIF(b->>'pt_data_saida','')::date,
          pt_data_entrada = NULLIF(b->>'pt_data_entrada','')::date,
          pt_aprovacao = NULLIF(b->>'pt_aprovacao',''),
          nf_saida = COALESCE(b->'nf_saida', '[]'::jsonb),
          nf_entrada = COALESCE(b->'nf_entrada', '[]'::jsonb),
          peca_foto = COALESCE((b->>'peca_foto')::boolean, false),
          peca_foto_data = NULLIF(b->>'peca_foto_data','')::date
        WHERE id = (b->>'id')::uuid AND cad_id = _cad_id;
        v_id := (b->>'id')::uuid;
      ELSE
        INSERT INTO public.producao_terceirizados (
          cad_id, categoria_terceirizado_id, interno, empresa_id, representante_id,
          colaborador_id, ativo, preco_metro_unidade, quantidade_enviada, quantidade_recebida,
          quantidade_defeito, desconto_total, multa_total, numero_parcelas,
          data_enviado, data_prevista, data_entregue, observacao, aviamentos_enviados, tecidos_enviados,
          detalhado, grade_detalhe, pt_data_saida, pt_data_entrada, pt_aprovacao, nf_saida, nf_entrada,
          peca_foto, peca_foto_data
        ) VALUES (
          _cad_id, NULLIF(b->>'categoria_terceirizado_id','')::uuid, COALESCE((b->>'interno')::boolean, false),
          NULLIF(b->>'empresa_id','')::uuid, NULLIF(b->>'representante_id','')::uuid,
          NULLIF(b->>'colaborador_id','')::uuid, COALESCE((b->>'ativo')::boolean, true),
          NULLIF(b->>'preco_metro_unidade','')::numeric, NULLIF(b->>'quantidade_enviada','')::int,
          NULLIF(b->>'quantidade_recebida','')::int, NULLIF(b->>'quantidade_defeito','')::int,
          COALESCE(NULLIF(b->>'desconto_total','')::numeric, 0), COALESCE(NULLIF(b->>'multa_total','')::numeric, 0),
          GREATEST(COALESCE(NULLIF(b->>'numero_parcelas','')::int, 1), 1),
          NULLIF(b->>'data_enviado','')::date, NULLIF(b->>'data_prevista','')::date, NULLIF(b->>'data_entregue','')::date,
          b->>'observacao', COALESCE(b->'aviamentos_enviados', '[]'::jsonb), COALESCE(b->'tecidos_enviados', '[]'::jsonb),
          COALESCE((b->>'detalhado')::boolean, false), COALESCE(b->'grade_detalhe', '{}'::jsonb),
          NULLIF(b->>'pt_data_saida','')::date, NULLIF(b->>'pt_data_entrada','')::date, NULLIF(b->>'pt_aprovacao',''),
          COALESCE(b->'nf_saida','[]'::jsonb), COALESCE(b->'nf_entrada','[]'::jsonb),
          COALESCE((b->>'peca_foto')::boolean, false), NULLIF(b->>'peca_foto_data','')::date
        ) RETURNING id INTO v_id;
      END IF;
      v_ids := array_append(v_ids, v_id);
    END LOOP;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.producao_terceirizados pt
    JOIN public.parcelas_servico ps ON ps.producao_terceirizado_id = pt.id
    WHERE pt.cad_id = _cad_id AND NOT (pt.id = ANY(v_ids))
      AND (ps.status = 'pago' OR ps.data_pagamento IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Não é possível remover um serviço com parcela já paga (apagaria o histórico financeiro). Mantenha o bloco ou estorne a parcela antes.';
  END IF;

  DELETE FROM public.producao_terceirizados WHERE cad_id = _cad_id AND NOT (id = ANY(v_ids));

  -- FONTE ÚNICA: com CQ confirmado + bloco-fonte, re-deriva a Grade Real do grade_detalhe
  -- (editar recebida/defeito no PCP move a Grade Real). Mesma fórmula do _salvar_cq_core.
  v_fonte := public._resolver_fonte_confeccao(_cad_id);
  SELECT (status = 'confirmado') INTO v_cq_conf FROM public.controle_qualidade WHERE cad_id = _cad_id;
  IF v_fonte IS NOT NULL AND COALESCE(v_cq_conf, false) THEN
    PERFORM public._aplicar_reais_do_grade_detalhe(_cad_id, v_fonte);
    -- [C1] depois da re-derivação (medios R13, prod #4 / P-192 A): se a Grade Real da fonte ficou
    -- Σ = 0 (mesma conta do [C1] do _salvar_cq_core), o CQ deixa de estar confirmado — volta a
    -- PENDENTE (o Pós confirmado volta junto, como o [M2] do desmarcar) + #Erro na etapa 'cq'. O
    -- salvar do PCP NÃO é recusado. Lançado/Direcionamento rebaixam pelo trg_rebaixa_lancado_cq.
    SELECT COALESCE(SUM(GREATEST(0, COALESCE((cell->>'recebida')::int,0) - COALESCE((cell->>'defeito')::int,0))), 0)
      INTO v_total_real
      FROM public.producao_terceirizados pt, jsonb_path_query(COALESCE(pt.grade_detalhe,'{}'::jsonb),'$.*.*') cell
     WHERE pt.id = v_fonte;
    IF v_total_real = 0 THEN
      UPDATE public.controle_qualidade
         SET status = 'pendente', confirmado_at = NULL,
             status_pos = CASE WHEN status_pos = 'confirmado' THEN 'pendente' ELSE status_pos END,
             confirmado_pos_at = CASE WHEN status_pos = 'confirmado' THEN NULL ELSE confirmado_pos_at END
       WHERE cad_id = _cad_id AND status = 'confirmado';
      IF FOUND THEN  -- (L3) só acende o #Erro se o CQ de fato foi rebaixado
        UPDATE public.modelos
           SET revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb) || '{"cq": true}'::jsonb
         WHERE id = (SELECT modelo_id FROM public.cad WHERE id = _cad_id);
      END IF;
    END IF;
  END IF;

  UPDATE public.cad SET observacoes_molde = NULLIF(_observacoes_molde, '') WHERE id = _cad_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_cq(_cad_id uuid, _cq jsonb, _variantes jsonb, _reais jsonb, _confirmar boolean DEFAULT false, _rev_base jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_cq.
  PERFORM public._seg_exige_pagina('producao_cq');
  RETURN public._salvar_cq_core(_cad_id, _cq, _variantes, _reais, _confirmar, _rev_base);
END $function$;

CREATE OR REPLACE FUNCTION public.desmarcar_cq(_cad_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_cq.
  PERFORM public._seg_exige_pagina('producao_cq');
  RETURN public._desmarcar_cq_core(_cad_id);
END $function$;

CREATE OR REPLACE FUNCTION public.voltar_cq_para_servico(_cad_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN
    RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_cq.
  PERFORM public._seg_exige_pagina('producao_cq');
  PERFORM public._voltar_cq_para_servico_core(_cad_id);
END $function$;

CREATE OR REPLACE FUNCTION public.salvar_cq_pos(_cad_id uuid, _cq_pos jsonb, _itens jsonb, _confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_cq.
  PERFORM public._seg_exige_pagina('producao_cq');
  RETURN public._salvar_cq_pos_core(_cad_id, _cq_pos, _itens, _confirmar);
END $function$;

CREATE OR REPLACE FUNCTION public.desmarcar_cq_pos(_cad_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_cq.
  PERFORM public._seg_exige_pagina('producao_cq');
  RETURN public._desmarcar_cq_pos_core(_cad_id);
END $function$;

CREATE OR REPLACE FUNCTION public.salvar_direcionamento(_cad_id uuid, _rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_direcionamento.
  PERFORM public._seg_exige_pagina('producao_direcionamento');
  PERFORM public._salvar_direcionamento_core(_cad_id, _rows, false, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_direcionamento(_cad_id uuid, _rows jsonb, _rev_base jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_direcionamento.
  PERFORM public._seg_exige_pagina('producao_direcionamento');
  PERFORM public._salvar_direcionamento_core(_cad_id, _rows, false, false, _rev_base);
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_direcionamento(_cad_id uuid, _rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;  -- [seg s1 DIR-1]
BEGIN
  -- [seg s1 DIR-1] login + loja do CAD ANTES do _cq_liberado: sem isto, com um UUID, quem nao esta logado (ou outra loja)
  -- descobria se o CQ do CAD esta liberado. Nao encontrado = outra loja (mesma resposta: sem oraculo). ASCII.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: faca login de novo' USING ERRCODE = '42501';
  END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_direcionamento.
  PERFORM public._seg_exige_pagina('producao_direcionamento');
  SELECT c.tenant_id INTO v_tenant FROM public.cad c WHERE c.id = _cad_id;
  IF v_tenant IS NULL OR (v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'cad_nao_encontrado: CAD nao encontrado nesta loja' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._cq_liberado(_cad_id) THEN
    RAISE EXCEPTION 'O Controle de Qualidade deste modelo não está liberado — confirme o CQ (Pré e, se houver acabamento, o Pós) antes de confirmar o Direcionamento.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public._salvar_direcionamento_core(_cad_id, _rows, true, true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_direcionamento(_cad_id uuid, _rows jsonb, _rev_base jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;  -- [seg s1 DIR-1]
BEGIN
  -- [seg s1 DIR-1] login + loja do CAD ANTES do _cq_liberado: sem isto, com um UUID, quem nao esta logado (ou outra loja)
  -- descobria se o CQ do CAD esta liberado. Nao encontrado = outra loja (mesma resposta: sem oraculo). ASCII.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: faca login de novo' USING ERRCODE = '42501';
  END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_direcionamento.
  PERFORM public._seg_exige_pagina('producao_direcionamento');
  SELECT c.tenant_id INTO v_tenant FROM public.cad c WHERE c.id = _cad_id;
  IF v_tenant IS NULL OR (v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'cad_nao_encontrado: CAD nao encontrado nesta loja' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._cq_liberado(_cad_id) THEN
    RAISE EXCEPTION 'O Controle de Qualidade deste modelo não está liberado — confirme o CQ (Pré e, se houver acabamento, o Pós) antes de confirmar o Direcionamento.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public._salvar_direcionamento_core(_cad_id, _rows, true, true, _rev_base);
END;
$function$;

CREATE OR REPLACE FUNCTION public.marcar_etapa_verificada(_modelo_id uuid, _etapa text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [seg s3b] (Reforco de seguranca S3b; C14 + P-231 = D2 A + P-245 = A) "Marcar verificado" do #Erro: exige o modulo Criacao OU
-- Producao e EDITAR a pagina da ETAPA (kanban = Desenvolvimento OU Planejamento; terceirizados = PCP Servicos; cq = CQ;
-- direcionamento; lancamentos; oficina; outra etapa = qualquer uma delas). Espelho na tela: PAGINAS_POR_ETAPA (RevisaoErro.tsx).
-- O UPDATE e o de sempre (so o modelo da loja do usuario).
BEGIN
  IF NOT (public.tenant_module_enabled('criacao') OR public.tenant_module_enabled('producao')) THEN
    RAISE EXCEPTION 'Módulo criacao/producao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina(VARIADIC CASE _etapa
    WHEN 'kanban' THEN ARRAY['criacao_desenvolvimento', 'criacao_planejamento']
    WHEN 'terceirizados' THEN ARRAY['producao_terceirizados']
    WHEN 'cq' THEN ARRAY['producao_cq']
    WHEN 'direcionamento' THEN ARRAY['producao_direcionamento']
    WHEN 'lancamentos' THEN ARRAY['producao_lancamentos']
    WHEN 'oficina' THEN ARRAY['producao_oficina']
    ELSE ARRAY['criacao_desenvolvimento', 'criacao_planejamento', 'producao_terceirizados', 'producao_cq', 'producao_direcionamento', 'producao_lancamentos', 'producao_oficina']
  END);
  UPDATE public.modelos
     SET revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb) - _etapa
   WHERE id = _modelo_id AND tenant_id = public.get_user_tenant_id();
END
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.baixar_estoque_tecido_corte(uuid,integer)', '9cac6689b615cc1eed1fa8de894dbb5a'),
      ('public.salvar_explosao_metragem(uuid,jsonb,integer)', '95fa0bdd1b1a5045781e2152edba4980'),
      ('public.salvar_explosao_aviamento_separar(uuid,jsonb,integer)', 'e0f35d177abd29b05557f22837f9ef9c'),
      ('public.salvar_explosao_etiqueta_enviar(uuid,jsonb,integer)', '9ba9b5dcb9917290db0b463dd12e7049'),
      ('public.voltar_modelo_desenvolvimento(uuid)', 'f113c6d63fe95083b71238a21b0914ca'),
      ('public.reverter_corte_tecido(uuid)', '3828600c053a87149670e0cff9985f5e'),
      ('public.salvar_terceirizados(uuid,jsonb,text,jsonb)', '7199a05fac6716ac110bfa637944c2e9'),
      ('public.salvar_cq(uuid,jsonb,jsonb,jsonb,boolean,jsonb)', 'a8a4e3897521959ed703a3ed3334d2a1'),
      ('public.desmarcar_cq(uuid)', '8f60caff1f81f138f7e94c8f422608e9'),
      ('public.voltar_cq_para_servico(uuid)', '0864b68c5b72e7a3ad5962fe2436f76c'),
      ('public.salvar_cq_pos(uuid,jsonb,jsonb,boolean)', '3979153ea0aee5aea6456a3b225f5c35'),
      ('public.desmarcar_cq_pos(uuid)', 'fe4290b5047b7e901f105ac310788e5e'),
      ('public.salvar_direcionamento(uuid,jsonb)', '1ad733ba008eeede3c5448c8556c6a25'),
      ('public.salvar_direcionamento(uuid,jsonb,jsonb)', '7f5e84c87bcfe7f14d123053063da1d0'),
      ('public.confirmar_direcionamento(uuid,jsonb)', 'dfb42e20403796a8dfa227d9d29bcbcc'),
      ('public.confirmar_direcionamento(uuid,jsonb,jsonb)', 'ae30cec520c8a1cc436e500b3b976396'),
      ('public.marcar_etapa_verificada(uuid,text)', '771b79bc4b30403c50f01256cfd6ba58')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 's3b_gates: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE') OR NOT has_function_privilege('authenticated', r.f, 'EXECUTE') THEN
      RAISE EXCEPTION 's3b_gates: pos-condicao falhou no EXECUTE de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
