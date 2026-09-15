-- Fase 3 / Onda 1 — Merge de conflito colaborativo no Direcionamento detalhe.
-- Espelha o padrão do CQ (rev otimista + P0409). Ver spec
-- docs/superpowers/specs/2026-09-15-colab-merge-direcionamento.md.
--
-- Peças:
--   1. Tabela-ÂNCORA `direcionamento_controle` (1 linha por cad; só o Direcionamento a bumpa) — isola o
--      `rev` de outros writers de `cad`. RLS tenant-scoped + modgate('producao'), espelhando
--      direcionamento_lojas. Trigger BEFORE UPDATE fn_colab_touch_rev (função já existe) → rev+1.
--   2. `_salvar_direcionamento_core` recriada BYTE-A-BYTE + `_rev_base jsonb DEFAULT NULL`:
--      garante a âncora (INSERT ON CONFLICT DO NOTHING), rev-check FOR UPDATE + P0409, e bump da âncora
--      no fim (o UPDATE dispara o trigger → rev+1 → postgres_changes p/ os outros assinantes).
--      _rev_base NULL = bypass (mantém o save cru / super).
--   3. Overloads dos wrappers salvar/confirmar_direcionamento com `_rev_base` (os antigos de 2 args
--      seguem existindo p/ retrocompat).
--   4. Publica direcionamento_controle no realtime (o useColabRegistro precisa do postgres_changes).
--
-- Diff-validar `_salvar_direcionamento_core` antes/depois (só ADICIONA _rev_base + âncora; escrita de
-- linhas/DELETE/validação P0001 do Confirmar intactas).

BEGIN;

-- ── 1. Tabela-âncora ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.direcionamento_controle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cad_id uuid NOT NULL UNIQUE REFERENCES public.cad(id) ON DELETE CASCADE,
  rev integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_direcionamento_controle_cad ON public.direcionamento_controle(cad_id);

ALTER TABLE public.direcionamento_controle ENABLE ROW LEVEL SECURITY;

-- RLS tenant-scoped (espelha direcionamento_lojas: tenant OU super).
DROP POLICY IF EXISTS dircontrole_sel ON public.direcionamento_controle;
CREATE POLICY dircontrole_sel ON public.direcionamento_controle FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS dircontrole_ins ON public.direcionamento_controle;
CREATE POLICY dircontrole_ins ON public.direcionamento_controle FOR INSERT
  WITH CHECK (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS dircontrole_upd ON public.direcionamento_controle;
CREATE POLICY dircontrole_upd ON public.direcionamento_controle FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- Modgate RESTRICTIVE do módulo producao (igual às outras tabelas do fluxo).
DROP POLICY IF EXISTS modgate_dircontrole ON public.direcionamento_controle;
CREATE POLICY modgate_dircontrole ON public.direcionamento_controle AS RESTRICTIVE FOR ALL
  USING (public.tenant_module_enabled('producao'))
  WITH CHECK (public.tenant_module_enabled('producao'));

-- Trigger de bump de rev (reusa a função genérica: new.rev := old.rev + 1).
DROP TRIGGER IF EXISTS trg_colab_rev_dircontrole ON public.direcionamento_controle;
CREATE TRIGGER trg_colab_rev_dircontrole
  BEFORE UPDATE ON public.direcionamento_controle
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_touch_rev();

-- ── 2. _salvar_direcionamento_core + _rev_base ────────────────────────────────
CREATE OR REPLACE FUNCTION public._salvar_direcionamento_core(_cad_id uuid, _rows jsonb, _strict boolean, _confirmar boolean, _rev_base jsonb DEFAULT NULL)
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
  v_rev int;
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

  -- Âncora do rev colaborativo: garante a linha (idempotente; 1ª vez nasce rev=0).
  INSERT INTO public.direcionamento_controle (tenant_id, cad_id)
  VALUES (v_tenant, _cad_id)
  ON CONFLICT (cad_id) DO NOTHING;

  -- Rev-check otimista (espelho do _salvar_cq_core): _rev_base NULL = bypass (save cru / super).
  IF _rev_base IS NOT NULL AND (_rev_base ? 'dir') AND (_rev_base->>'dir') IS NOT NULL THEN
    SELECT rev INTO v_rev FROM public.direcionamento_controle
      WHERE cad_id = _cad_id FOR UPDATE;
    IF v_rev IS DISTINCT FROM (_rev_base->>'dir')::int THEN
      RAISE EXCEPTION 'conflito_versao: o Direcionamento foi salvo por outra pessoa'
        USING ERRCODE = 'P0409';
    END IF;
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

  -- Bump do rev da âncora (dispara o postgres_changes p/ os OUTROS assinantes; o próprio autor
  -- re-baselina no pós-save, então o eco é no-op). O trigger BEFORE UPDATE faz rev := rev+1.
  UPDATE public.direcionamento_controle SET updated_at = now() WHERE cad_id = _cad_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._salvar_direcionamento_core(uuid, jsonb, boolean, boolean, jsonb) FROM public, anon, authenticated;

-- ── 3. Wrappers com _rev_base (overloads; os de 2 args seguem existindo p/ retrocompat) ──
CREATE OR REPLACE FUNCTION public.salvar_direcionamento(_cad_id uuid, _rows jsonb, _rev_base jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._salvar_direcionamento_core(_cad_id, _rows, false, false, _rev_base);
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_direcionamento(_cad_id uuid, _rows jsonb, _rev_base jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public._cq_liberado(_cad_id) THEN
    RAISE EXCEPTION 'O Controle de Qualidade deste modelo não está liberado — confirme o CQ (Pré e, se houver acabamento, o Pós) antes de confirmar o Direcionamento.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public._salvar_direcionamento_core(_cad_id, _rows, true, true, _rev_base);
END;
$function$;

-- ── 4. Realtime: o useColabRegistro escuta postgres_changes da âncora ──────────
ALTER TABLE public.direcionamento_controle REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'direcionamento_controle'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direcionamento_controle;
  END IF;
END $$;

COMMIT;
