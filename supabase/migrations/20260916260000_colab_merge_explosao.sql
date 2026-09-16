-- Fase 3 — Onda Explosão: merge de conflito colaborativo (rev + P0409) na tela de Explosão.
--
-- A Explosão edita `cad_tecido_variantes` (metragem), `cad_aviamentos` (separar), `cad_etiquetas`
-- (enviar) de UM cad por vez, via 3 RPCs estreitas salvas JUNTAS num só "Salvar". Âncora de rev =
-- `cad` (rev PRÓPRIO, molde PCP/CQ que também são FK-filha de cad). NÃO reusar modelos.rev (é do
-- Desenvolvimento/BOM; misturaria semânticas).
--
-- ⚠️ ESCOPO (decisão do dono): trava cobre Explosão↔Explosão. O cruzamento Explosão↔Desenvolvimento
-- (salvar_cad_completo também grava cad_*) fica como risco CONHECIDO, NÃO fechado aqui (não tocar no
-- salvar_cad_completo, RPC central e delicada). O "Enviar para PCP" (baixa estoque físico) TAMBÉM
-- ganha a trava (decisão do dono: não baixar estoque com metragem obsoleta).
--
-- ⚠️ `_rev_base int DEFAULT NULL` como 3º arg das 3 saves (a de 2 args resolve no default via
-- PostgREST — retrocompat, sem overload ambíguo pois cada função é única). O bump do cad vem por
-- trigger-de-filha nas 3 tabelas (truque dos 2 triggers: UPDATE no-op na raiz `cad`).

BEGIN;

-- ── 1. rev em cad + trigger touch + realtime ──────────────────────────────────
ALTER TABLE public.cad ADD COLUMN IF NOT EXISTS rev integer NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS trg_colab_rev_cad ON public.cad;
CREATE TRIGGER trg_colab_rev_cad
  BEFORE UPDATE ON public.cad
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_touch_rev();

ALTER TABLE public.cad REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='cad') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cad;
  END IF;
END $$;

-- ── 2. bump-via-filha: mudança em cad_tecido_variantes/cad_aviamentos/cad_etiquetas bumpa cad.rev ──
-- "Truque dos 2 triggers": UPDATE no-op na raiz cad (set id=id) re-dispara o trg_colab_rev_cad.
-- A filha resolve o cad_id: cad_tecido_variantes → via cad_tecidos.cad_id; as outras 2 têm cad_id direto.
CREATE OR REPLACE FUNCTION public.fn_colab_bump_cad_via_ctv()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
DECLARE v_cad uuid;
BEGIN
  SELECT ct.cad_id INTO v_cad FROM public.cad_tecidos ct
    WHERE ct.id = COALESCE(NEW.cad_tecido_id, OLD.cad_tecido_id);
  IF v_cad IS NOT NULL THEN UPDATE public.cad SET id = id WHERE id = v_cad; END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_cad_direto()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.cad SET id = id WHERE id = COALESCE(NEW.cad_id, OLD.cad_id);
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS trg_colab_bump_cad_ctv ON public.cad_tecido_variantes;
CREATE TRIGGER trg_colab_bump_cad_ctv
  AFTER INSERT OR UPDATE OR DELETE ON public.cad_tecido_variantes
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_bump_cad_via_ctv();

DROP TRIGGER IF EXISTS trg_colab_bump_cad_avi ON public.cad_aviamentos;
CREATE TRIGGER trg_colab_bump_cad_avi
  AFTER INSERT OR UPDATE OR DELETE ON public.cad_aviamentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_bump_cad_direto();

DROP TRIGGER IF EXISTS trg_colab_bump_cad_etq ON public.cad_etiquetas
;
CREATE TRIGGER trg_colab_bump_cad_etq
  AFTER INSERT OR UPDATE OR DELETE ON public.cad_etiquetas
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_bump_cad_direto();

REVOKE EXECUTE ON FUNCTION public.fn_colab_bump_cad_via_ctv() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_colab_bump_cad_direto() FROM public, anon, authenticated;

-- Helper: checa rev do cad (P0409). _rev_base null = bypass. Reusado pelas 3 saves + o enviar.
CREATE OR REPLACE FUNCTION public._explosao_check_rev(_cad_id uuid, _rev_base integer)
 RETURNS void LANGUAGE plpgsql
AS $function$
DECLARE v_rev int;
BEGIN
  IF _rev_base IS NULL THEN RETURN; END IF;
  SELECT rev INTO v_rev FROM public.cad WHERE id = _cad_id FOR UPDATE;
  IF v_rev IS DISTINCT FROM _rev_base THEN
    RAISE EXCEPTION 'conflito_versao: o registro foi salvo por outra pessoa' USING ERRCODE='P0409';
  END IF;
END $function$;
REVOKE EXECUTE ON FUNCTION public._explosao_check_rev(uuid, integer) FROM public, anon, authenticated;

-- ── 3. As 3 saves ganham _rev_base (3º arg, DEFAULT NULL) + a trava ────────────
-- ⚠️ LIÇÃO do overload ambíguo: CREATE OR REPLACE com um arg A MAIS (mesmo DEFAULT) NÃO substitui o
-- de 2 args — cria um 2º overload, e a chamada de 2 args (que o front usa) fica "not unique". DROPA
-- o de 2 args primeiro; o novo de 3 (com DEFAULT NULL) atende a chamada de 2 e de 3 args sem ambiguidade.
-- Corpos COPIADOS byte-a-byte do pg_get_functiondef vigente; só adiciona o arg + a chamada de trava.
DROP FUNCTION IF EXISTS public.salvar_explosao_metragem(uuid, jsonb);
DROP FUNCTION IF EXISTS public.salvar_explosao_aviamento_separar(uuid, jsonb);
DROP FUNCTION IF EXISTS public.salvar_explosao_etiqueta_enviar(uuid, jsonb);
DROP FUNCTION IF EXISTS public.baixar_estoque_tecido_corte(uuid);

CREATE OR REPLACE FUNCTION public.salvar_explosao_metragem(_cad_id uuid, _variantes jsonb, _rev_base integer DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; it jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
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

CREATE OR REPLACE FUNCTION public.salvar_explosao_aviamento_separar(_cad_id uuid, _linhas jsonb, _rev_base integer DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; it jsonb; v_avi uuid; v_var uuid; v_val numeric; v_first uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
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

CREATE OR REPLACE FUNCTION public.salvar_explosao_etiqueta_enviar(_cad_id uuid, _linhas jsonb, _rev_base integer DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; it jsonb; v_id uuid; v_val numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
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

-- Preserva ACL (authenticated sim, anon não) das 3 saves recriadas.
REVOKE EXECUTE ON FUNCTION public.salvar_explosao_metragem(uuid, jsonb, integer) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.salvar_explosao_aviamento_separar(uuid, jsonb, integer) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.salvar_explosao_etiqueta_enviar(uuid, jsonb, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.salvar_explosao_metragem(uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_explosao_aviamento_separar(uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_explosao_etiqueta_enviar(uuid, jsonb, integer) TO authenticated;

-- ── 4. "Enviar para PCP" (baixa estoque) também trava por rev ──────────────────
-- Wrapper ganha _rev_base (3º arg DEFAULT NULL); trava ANTES do _core (baixa estoque físico).
CREATE OR REPLACE FUNCTION public.baixar_estoque_tecido_corte(_cad_id uuid, _rev_base integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._explosao_check_rev(_cad_id, _rev_base);
  RETURN public._baixar_estoque_tecido_corte_core(_cad_id);
END $function$;

COMMIT;
