-- Inverso NEUTRO de supabase/migrations/20261103181000_urg_r4_servicos_da_mo.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-b.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-b.md (Task 2 / R4b; Rulings 4-9, 12, 22 + B2 da revisao da Task 1).
-- NEUTRO: devolve _enviar_modelo_para_cad_core e _aprovar_servico_mo_core aos textos de ANTES (md5 conferido; ja ANTES =
-- no-op idempotente). As 2 funcoes novas FICAM (sem chamador = inertes), a coluna mo_linha_id e o indice FICAM (os
-- blocos ja criados seguem como blocos normais do PCP). Remover de fato = _down_drop (opcional, depois). So catalogo.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._enviar_modelo_para_cad_core(uuid,text,text)
--     ANTES  bf28796bcd86538a3a5b516e9cf356c6
--     DEPOIS 47488eabb37b6ee180e17740269bebd5
--   public._aprovar_servico_mo_core(uuid,uuid,boolean,text)
--     ANTES  859dd63992e86cc75b7abeab41dee954
--     DEPOIS 5ce4cc9e8696b1495e8248eccce3f8d3
--   public._servicos_da_mo_criar(uuid,uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 92c0edd9037824726acadab8afc80648
--   public._servico_mo_preencher_preco(uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS f8c56394f5adb07c7a42378978d77aa0
-- ====================================================================================
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
      ('public._enviar_modelo_para_cad_core(uuid,text,text)', 'bf28796bcd86538a3a5b516e9cf356c6', '47488eabb37b6ee180e17740269bebd5'),
      ('public._aprovar_servico_mo_core(uuid,uuid,boolean,text)', '859dd63992e86cc75b7abeab41dee954', '5ce4cc9e8696b1495e8248eccce3f8d3')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'urg_r4b_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- funcoes NOVAS deste bloco: ausentes ou ja com o texto de DEPOIS
  FOR r IN SELECT * FROM (VALUES
      ('public._servicos_da_mo_criar(uuid,uuid)', '92c0edd9037824726acadab8afc80648'),
      ('public._servico_mo_preencher_preco(uuid)', 'f8c56394f5adb07c7a42378978d77aa0')
    ) AS x(f, d) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v <> r.d THEN
      RAISE EXCEPTION 'urg_r4b_down: % (nova) com texto inesperado (md5 %) - gere de novo', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._enviar_modelo_para_cad_core(_modelo_id uuid, _observacoes_tecnicas text DEFAULT NULL::text, _ficha_medida_url text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_cad_id uuid;
  v_new_tid uuid;
  v_grade_total numeric;
  rt record;
  rg record;
  ra record;
  v_idx int := 0;
  v_gate_ok boolean;
  v_gate_label text;
  v_status text;
  v_status_plan text;
  v_status_gate text;
  v_explosao_antes text;  -- [seg s1 M2] GUC app.explosao_sistema (liga e RESTAURA)
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.modelos WHERE id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este modelo';
  END IF;

  -- leves L3 kanban #11: serializa envios do MESMO card. Mesma chave do enforce_unique_fk de cad.modelo_id (o INSERT abaixo
  -- pede de novo a mesma trava - reentrante na mesma transacao): o 2o envio simultaneo espera o 1o e, depois do COMMIT dele,
  -- acha o CAD e segue o caminho idempotente (antes: unique_violation "Ja existe registro em cad...").
  PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || _modelo_id::text));

  -- Gate de etapa (configurável por loja, tenant_config.explosao_envio_status): o modelo
  -- só é enviado à Explosão A PARTIR da etapa configurada (ou de qualquer etapa POSTERIOR
  -- na ordem do board). Ausente ⇒ 'aprovado'. Órfã ⇒ fallback 'aprovado'.
  -- ERRCODE P0001 (NÃO 23514 — senão erro-mensagem.ts engole a mensagem PT).
  SELECT status_desenvolvimento, status_planejamento INTO v_status, v_status_plan FROM public.modelos WHERE id = _modelo_id;
  v_status_gate := public._kanban_status_gate(v_tenant, _modelo_id, v_status);
  -- leves L3 (R14 msg reprovado, P-190 A): com a chave ligada, card em 'reprovado' nao tem posicao (gate NULL) - o motivo e o
  -- reprovado, nao a etapa. ASCII com prefixo (a tela traduz: src/lib/erro-mensagem.ts).
  -- [fix round 1, A1 / P-213 A] reprovado = Dev OU Planejamento; reprovado no PLANEJAMENTO nunca vai a Explosao (qualquer
  -- chave - o _kanban_status_gate da 20261027140000 tambem o tira da regua; aqui fica independente dela).
  IF public._kanban_norm(v_status_plan) = 'reprovado'
     OR (v_status_gate IS NULL AND public._kanban_norm(v_status) = 'reprovado') THEN
    RAISE EXCEPTION 'reprovado_explosao: Card reprovado nao vai a Explosao' USING ERRCODE = 'P0001';
  END IF;
  SELECT g.ok, g.req_label INTO v_gate_ok, v_gate_label
    FROM public._explosao_envio_gate(v_tenant, v_status_gate) AS g;
  IF NOT COALESCE(v_gate_ok, false) THEN
    RAISE EXCEPTION 'O modelo precisa estar na etapa "%" (ou posterior) para ser enviado à Explosão.', v_gate_label
      USING ERRCODE = 'P0001';
  END IF;

  -- IDEMPOTENTE: se o CAD já existe (o save do card cria/sincroniza), NÃO recria.
  -- Só atualiza observações/ficha (se informadas) e marca o modelo como enviado à Explosão.
  SELECT id INTO v_cad_id FROM public.cad WHERE modelo_id = _modelo_id ORDER BY id LIMIT 1;
  IF v_cad_id IS NOT NULL THEN
    UPDATE public.cad
       SET observacoes_tecnicas = COALESCE(_observacoes_tecnicas, observacoes_tecnicas),
           ficha_medida_url     = COALESCE(_ficha_medida_url, ficha_medida_url)
     WHERE id = v_cad_id;
    v_explosao_antes := current_setting('app.explosao_sistema', true);  -- [seg s1 M2] a guarda de modelos so aceita enviado_cad com a GUC
    PERFORM set_config('app.explosao_sistema', 'on', true);
    UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;
    PERFORM set_config('app.explosao_sistema', coalesce(v_explosao_antes, ''), true);
    RETURN v_cad_id;
  END IF;

  INSERT INTO public.cad (modelo_id, observacoes_tecnicas, ficha_medida_url, status_corte)
  VALUES (_modelo_id, _observacoes_tecnicas, _ficha_medida_url, 'pendente')
  RETURNING id INTO v_cad_id;

  -- Copia tecidos + variantes (preserva ordem e multiplicador).
  FOR rt IN
    SELECT id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto
    FROM public.modelo_tecidos WHERE modelo_id = _modelo_id ORDER BY numero
  LOOP
    INSERT INTO public.cad_tecidos
      (cad_id, artigo_id, numero, tipo, consumo_cad, loss_percent_cad, custo_cad, tamanho_folha)
    VALUES
      (v_cad_id, rt.artigo_id, rt.numero, rt.tipo,
       COALESCE(rt.consumo, 0), COALESCE(rt.loss_percent, 0), COALESCE(rt.custo_previsto, 0), 0)
    RETURNING id INTO v_new_tid;

    INSERT INTO public.cad_tecido_variantes
      (cad_tecido_id, variante_tecido_id, ordem, multiplicador,
       quantidade_folhas, metragem_planejada, metragem_enviada, complementa_variante_ids)
    SELECT v_new_tid, mtv.variante_tecido_id, mtv.ordem,
           COALESCE(mtv.multiplicador, 1), 0, 0, 0, mtv.complementa_variante_ids
    FROM public.modelo_tecido_variantes mtv
    WHERE mtv.modelo_tecido_id = rt.id;
  END LOOP;

  -- Copia grade planejada -> cad_grades (planejada = real).
  v_grade_total := 0;
  FOR rg IN
    SELECT variante_numero, grades, grade_total
    FROM public.modelo_grades WHERE modelo_id = _modelo_id
  LOOP
    INSERT INTO public.cad_grades
      (cad_id, variante_numero, grades_planejadas, grades_reais,
       grade_total_planejada, grade_total_real)
    VALUES
      (v_cad_id, rg.variante_numero,
       COALESCE(rg.grades, '{}'::jsonb), COALESCE(rg.grades, '{}'::jsonb),
       COALESCE(rg.grade_total, 0), COALESCE(rg.grade_total, 0));
    v_grade_total := v_grade_total + COALESCE(rg.grade_total, 0);
  END LOOP;

  -- Copia aviamentos (qtd = consumo * grade total geral; numero sequencial).
  -- [NOVO] leva a variante_aviamento_id do BOM p/ o CAD → cad_aviamentos vira
  -- POR aviamento×variante (base da "a separar" editável por variante na Explosão).
  FOR ra IN
    SELECT aviamento_id, consumo, variante_aviamento_id
    FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id ORDER BY numero
  LOOP
    v_idx := v_idx + 1;
    INSERT INTO public.cad_aviamentos
      (cad_id, aviamento_id, numero, consumo, quantidade_enviar, quantidade_separar, variante_aviamento_id)
    VALUES
      (v_cad_id, ra.aviamento_id, v_idx,
       COALESCE(ra.consumo, 0),
       ROUND(COALESCE(ra.consumo, 0) * v_grade_total, 4),
       ROUND(COALESCE(ra.consumo, 0) * v_grade_total, 4),
       ra.variante_aviamento_id);
  END LOOP;

  v_explosao_antes := current_setting('app.explosao_sistema', true);  -- [seg s1 M2] idem
  PERFORM set_config('app.explosao_sistema', 'on', true);
  UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;
  PERFORM set_config('app.explosao_sistema', coalesce(v_explosao_antes, ''), true);

  RETURN v_cad_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._aprovar_servico_mo_core(_modelo_id uuid, _linha_id uuid, _aprovado boolean, _motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF _aprovado = false AND COALESCE(btrim(_motivo),'') = '' THEN
    RAISE EXCEPTION 'Informe o motivo da reprovação.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.modelo_servico_mo
     SET aprovado = _aprovado,
         motivo_reprovacao = CASE WHEN _aprovado THEN NULL ELSE _motivo END,
         updated_at = now()
   WHERE id = _linha_id
     AND modelo_id = _modelo_id
     AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha de mão de obra não encontrada.' USING ERRCODE = 'P0001';
  END IF;
END $function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._enviar_modelo_para_cad_core(uuid,text,text)', 'bf28796bcd86538a3a5b516e9cf356c6', '{postgres=X/postgres,service_role=X/postgres}'),
      ('public._aprovar_servico_mo_core(uuid,uuid,boolean,text)', '859dd63992e86cc75b7abeab41dee954', '{postgres=X/postgres,service_role=X/postgres}')
    ) AS x(f, m, acl) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r4b_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r4b_down: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- funcoes NOVAS deste bloco: ausentes ou ja com o texto de DEPOIS
  FOR r IN SELECT * FROM (VALUES
      ('public._servicos_da_mo_criar(uuid,uuid)', '92c0edd9037824726acadab8afc80648'),
      ('public._servico_mo_preencher_preco(uuid)', 'f8c56394f5adb07c7a42378978d77aa0')
    ) AS x(f, d) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v <> r.d THEN
      RAISE EXCEPTION 'urg_r4b_down: % (nova) com texto inesperado (md5 %) - gere de novo', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
