-- Direcionamento multi-lojas — fix round 1 (review da Task 3), 1 achado MEDIUM:
-- os 2 RAISE novos do confirmar estrito (Falta/Sobra) usavam `USING ERRCODE = '23514'`.
-- `src/lib/erro-mensagem.ts` mapeia 23514 pra mensagem genérica "Um dos valores informados
-- é inválido." (POR_CODIGO["23514"]), que VENCE a mensagem detalhada do RAISE — o usuário
-- nunca via o tamanho/diferença. O padrão do repo pra RAISE nosso em PT é P0001
-- (erro-mensagem.ts deixa `code === 'P0001' && msg` passar a mensagem como está).
-- Corrige trocando SÓ o código das 2 mensagens novas pra 'P0001'. Resto do corpo
-- byte-idêntico (diff-validado via pg_get_functiondef antes/depois) — inclusive o
-- `USING ERRCODE = '42501'` do gate de módulo, que é padrão preexistente e fora do
-- escopo deste achado. Mesma assinatura do core → CREATE OR REPLACE preserva o ACL
-- (REVOKE abaixo é reassert idempotente, não correção).
BEGIN;

CREATE OR REPLACE FUNCTION public._salvar_direcionamento_core(_cad_id uuid, _rows jsonb, _strict boolean, _confirmar boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  r jsonb; t text;
  v_keep uuid[] := '{}';
  v_loja uuid; v_num int;
  v_loja_tenant uuid; v_ativa boolean; v_nome text;
  v_real jsonb; v_grades jsonb;
  v_q int; v_row_id uuid;
  v_rt int; v_dir int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  IF NOT public.tenant_module_enabled('producao') THEN
    RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'Formato inválido: as linhas do direcionamento devem ser uma lista';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    v_loja := (r->>'loja_id')::uuid;
    v_num  := (r->>'variante_numero')::int;
    IF v_loja IS NULL OR v_num IS NULL THEN
      RAISE EXCEPTION 'Linha inválida: cada linha precisa de loja_id e variante_numero';
    END IF;

    SELECT tenant_id, ativo, nome INTO v_loja_tenant, v_ativa, v_nome
      FROM public.lojas_direcionamento WHERE id = v_loja;
    IF v_loja_tenant IS NULL OR v_loja_tenant <> v_tenant THEN
      RAISE EXCEPTION 'Loja não encontrada nesta conta';
    END IF;

    -- Real AUTORITATIVO da variante (ignora totais do cliente).
    SELECT COALESCE(grades_reais, '{}'::jsonb) INTO v_real
      FROM public.cad_grades WHERE cad_id = _cad_id AND variante_numero = v_num;
    v_real := COALESCE(v_real, '{}'::jsonb);

    -- Sanitiza: só tamanhos presentes na grade real; inteiro ≥ 0.
    v_grades := '{}'::jsonb;
    FOR t IN SELECT jsonb_object_keys(v_real) LOOP
      v_q := GREATEST(COALESCE((r->'grades'->>t)::int, 0), 0);
      v_grades := v_grades || jsonb_build_object(t, v_q);
    END LOOP;

    SELECT id INTO v_row_id FROM public.direcionamento_lojas
     WHERE cad_id = _cad_id AND loja_id = v_loja AND variante_numero = v_num;
    IF v_row_id IS NULL THEN
      -- Linha NOVA: só loja ativa (linhas históricas de loja desativada seguem editáveis).
      IF NOT v_ativa THEN
        RAISE EXCEPTION 'A loja "%" está desativada — reative-a no Cadastro > Lojas ou remova a linha', v_nome;
      END IF;
      INSERT INTO public.direcionamento_lojas (tenant_id, cad_id, loja_id, variante_numero, grades)
      VALUES (v_tenant, _cad_id, v_loja, v_num, v_grades)
      RETURNING id INTO v_row_id;
    ELSE
      UPDATE public.direcionamento_lojas
         SET grades = v_grades, updated_at = now()
       WHERE id = v_row_id;
    END IF;
    v_keep := array_append(v_keep, v_row_id);
  END LOOP;

  -- Payload é o estado completo: o que ficou de fora sai (diff, como no legado).
  DELETE FROM public.direcionamento_lojas
   WHERE cad_id = _cad_id AND NOT (id = ANY(v_keep));

  IF _strict THEN
    -- Confirmar: Σ lojas = grade real POR TAMANHO em TODA variante com grade real.
    FOR v_num, v_real IN
      SELECT g.variante_numero, COALESCE(g.grades_reais, '{}'::jsonb)
        FROM public.cad_grades g WHERE g.cad_id = _cad_id
    LOOP
      FOR t IN SELECT jsonb_object_keys(v_real) LOOP
        v_rt := COALESCE((v_real->>t)::int, 0);
        SELECT COALESCE(SUM(COALESCE((dl.grades->>t)::int, 0)), 0) INTO v_dir
          FROM public.direcionamento_lojas dl
         WHERE dl.cad_id = _cad_id AND dl.variante_numero = v_num;
        IF v_dir < v_rt THEN
          RAISE EXCEPTION 'Falta direcionar % peça(s) no tamanho % (variante %) — direcionado %, grade real %.',
            v_rt - v_dir, t, v_num, v_dir, v_rt USING ERRCODE = 'P0001';
        ELSIF v_dir > v_rt THEN
          RAISE EXCEPTION 'Direcionado % peça(s) a mais no tamanho % (variante %) — direcionado %, grade real %.',
            v_dir - v_rt, t, v_num, v_dir, v_rt USING ERRCODE = 'P0001';
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  IF _confirmar THEN
    UPDATE public.cad
       SET direcionamento_status = 'separado', direcionamento_confirmado_at = now()
     WHERE id = _cad_id;
  END IF;
END;
$function$;

-- Invariante #9: reassert idempotente (mesma assinatura → ACL já preservado pelo REPLACE).
REVOKE EXECUTE ON FUNCTION public._salvar_direcionamento_core(uuid, jsonb, boolean, boolean) FROM PUBLIC, anon, authenticated;

COMMIT;
SELECT pg_notify('pgrst', 'reload schema');
