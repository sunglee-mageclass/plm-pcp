-- ============================================================================
-- Explosão: "A separar/enviar" do AVIAMENTO editável POR VARIANTE (espelha o
-- metragem_enviada do tecido). Fundação: cad_aviamentos vira POR aviamento×variante.
-- ----------------------------------------------------------------------------
-- Item 1 (fundação, 20260820120000) criou cad_aviamentos.variante_aviamento_id INERTE;
-- item 2 (20260820130000) passou a gravá-la nos saves de BOM/CAD. FALTAVA a via de
-- MATERIALIZAÇÃO do CAD a partir do BOM (`_enviar_modelo_para_cad_core`), que copiava
-- só (aviamento_id, consumo) — deixando o CAD "sem variante" quando o card não é re-salvo.
-- Aqui:
--   1) `_enviar_modelo_para_cad_core` passa a copiar `variante_aviamento_id`
--      (modelo_aviamentos → cad_aviamentos). CREATE OR REPLACE preserva o resto
--      byte-a-byte (diff-validado antes/depois); idempotente.
--   2) Backfill dos cad_aviamentos existentes (variante NULL) a partir do
--      modelo_aviamentos correspondente pelo par 1:1 (aviamento_id, numero) — que o
--      envio ao CAD preserva (numero é único por modelo → join sem ambiguidade). Onde
--      não resolve (numero sem par ou variante do BOM NULL) fica NULL = legado "sem
--      variante", sem perda.
--   3) RPC nova `salvar_explosao_aviamento_separar` — espelha `salvar_explosao_metragem`:
--      grava `cad_aviamentos.quantidade_separar` por aviamento×variante. Como pode haver
--      VÁRIAS entradas do mesmo aviamento×variante no CAD, a atribuição é DETERMINÍSTICA:
--      o valor cheio vai na entrada de MENOR numero do grupo; as demais do grupo zeram
--      (a Explosão SOMA o quantidade_separar do grupo → o total exibido == o valor
--      editado). Legado "sem variante" = grupo com variante_aviamento_id NULL
--      (IS NOT DISTINCT FROM trata o NULL). Grupo sem entrada no CAD → no-op (a Explosão
--      cai no default = necessária).
--
-- Transacional (backfill = mutação de dado). ACLs: RPC nova revogada de PUBLIC/anon,
-- concedida a authenticated (idêntico a salvar_explosao_metragem).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) _enviar_modelo_para_cad_core — copia variante_aviamento_id p/ cad_aviamentos.
--    (idêntico ao vigente, salvo o SELECT + INSERT dos aviamentos.)
-- ---------------------------------------------------------------------------
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

  -- Gate de etapa (configurável por loja, tenant_config.explosao_envio_status): o modelo
  -- só é enviado à Explosão A PARTIR da etapa configurada (ou de qualquer etapa POSTERIOR
  -- na ordem do board). Ausente ⇒ 'aprovado'. Órfã ⇒ fallback 'aprovado'.
  -- ERRCODE P0001 (NÃO 23514 — senão erro-mensagem.ts engole a mensagem PT).
  SELECT g.ok, g.req_label INTO v_gate_ok, v_gate_label
    FROM public._explosao_envio_gate(v_tenant, (SELECT status_desenvolvimento FROM public.modelos WHERE id = _modelo_id)) AS g;
  IF NOT COALESCE(v_gate_ok, false) THEN
    RAISE EXCEPTION 'O modelo precisa estar na etapa "%" (ou posterior) para ser enviado à Explosão.', v_gate_label
      USING ERRCODE = 'P0001';
  END IF;

  -- IDEMPOTENTE: se o CAD já existe (o save do card cria/sincroniza), NÃO recria.
  -- Só atualiza observações/ficha (se informadas) e marca o modelo como enviado à Explosão.
  SELECT id INTO v_cad_id FROM public.cad WHERE modelo_id = _modelo_id;
  IF v_cad_id IS NOT NULL THEN
    UPDATE public.cad
       SET observacoes_tecnicas = COALESCE(_observacoes_tecnicas, observacoes_tecnicas),
           ficha_medida_url     = COALESCE(_ficha_medida_url, ficha_medida_url)
     WHERE id = v_cad_id;
    UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;
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
       quantidade_folhas, metragem_planejada, metragem_enviada)
    SELECT v_new_tid, mtv.variante_tecido_id, mtv.ordem,
           COALESCE(mtv.multiplicador, 1), 0, 0, 0
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

  UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;

  RETURN v_cad_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2) Backfill dos cad_aviamentos existentes (variante NULL) pelo par (aviamento_id, numero).
--    numero é único por modelo → o join casa no MÁXIMO 1 linha do BOM. Só preenche
--    quando o BOM tem variante; caso contrário fica NULL = legado "sem variante".
-- ---------------------------------------------------------------------------
UPDATE public.cad_aviamentos ca
   SET variante_aviamento_id = ma.variante_aviamento_id
  FROM public.cad k
  JOIN public.modelo_aviamentos ma ON ma.modelo_id = k.modelo_id
 WHERE ca.cad_id = k.id
   AND ca.variante_aviamento_id IS NULL
   AND ma.aviamento_id = ca.aviamento_id
   AND ma.numero = ca.numero
   AND ma.variante_aviamento_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) RPC estreita p/ a Explosão: grava a "a separar/enviar" por aviamento×variante.
--    Espelha salvar_explosao_metragem (gate criacao + tenant + updates escopados ao CAD).
--    _linhas = [{aviamento_id, variante_aviamento_id?, quantidade_separar}] (estado por grupo).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salvar_explosao_aviamento_separar(_cad_id uuid, _linhas jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  it jsonb;
  v_avi uuid;
  v_var uuid;
  v_val numeric;
  v_first uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'CAD não encontrado';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  IF jsonb_typeof(_linhas) = 'array' THEN
    FOR it IN SELECT value FROM jsonb_array_elements(_linhas) LOOP
      v_avi := NULLIF(it->>'aviamento_id','')::uuid;
      v_var := NULLIF(it->>'variante_aviamento_id','')::uuid;
      v_val := GREATEST(COALESCE((it->>'quantidade_separar')::numeric, 0), 0);
      IF v_avi IS NULL THEN CONTINUE; END IF;

      -- Entrada determinística que recebe o valor cheio (menor numero do grupo). Só
      -- linhas DESTE cad — trava cross-cad/tenant (o cad já é do tenant).
      SELECT id INTO v_first
        FROM public.cad_aviamentos
       WHERE cad_id = _cad_id
         AND aviamento_id = v_avi
         AND variante_aviamento_id IS NOT DISTINCT FROM v_var
       ORDER BY numero NULLS LAST, id
       LIMIT 1;

      -- Sem entrada no CAD p/ este aviamento×variante → nada a gravar (default = necessária).
      IF v_first IS NULL THEN CONTINUE; END IF;

      UPDATE public.cad_aviamentos
         SET quantidade_separar = CASE WHEN id = v_first THEN v_val ELSE 0 END
       WHERE cad_id = _cad_id
         AND aviamento_id = v_avi
         AND variante_aviamento_id IS NOT DISTINCT FROM v_var;
    END LOOP;
  END IF;

  RETURN _cad_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.salvar_explosao_aviamento_separar(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salvar_explosao_aviamento_separar(uuid, jsonb) TO authenticated;

COMMIT;
