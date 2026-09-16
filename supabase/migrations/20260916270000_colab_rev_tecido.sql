-- Fase 3 — Onda CADASTROS (parte 1): rev em artigos p/ trava leve de conflito no cadastro de Tecido.
--
-- O cadastro de Tecido salva com UPDATE DIRETO (não RPC), então a trava é "leve": o front faz
-- `update artigos ... where id=X and rev=REVBASE` — 0 linhas afetadas = conflito (recarrega+avisa).
-- Aqui o banco só precisa: coluna `rev` + trigger de bump (touch na raiz + bump-via-filha das
-- variantes). `artigos` já está publicada no Realtime (nada a fazer lá). NÃO há RPC nova.
--
-- Escopo (decisão do dono): Tecido = ring + trava leve; o resto dos cadastros fica sem colab.

BEGIN;

ALTER TABLE public.artigos ADD COLUMN IF NOT EXISTS rev integer NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS trg_colab_rev_artigo ON public.artigos;
CREATE TRIGGER trg_colab_rev_artigo
  BEFORE UPDATE ON public.artigos
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_touch_rev();

-- bump-via-filha: mudança em variantes_tecido bumpa artigos.rev (truque do UPDATE no-op na raiz).
CREATE OR REPLACE FUNCTION public.fn_colab_bump_artigo_via_variante()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.artigos SET id = id WHERE id = COALESCE(NEW.artigo_id, OLD.artigo_id);
  RETURN NULL;
END $function$;
REVOKE EXECUTE ON FUNCTION public.fn_colab_bump_artigo_via_variante() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_colab_bump_artigo_variante ON public.variantes_tecido;
CREATE TRIGGER trg_colab_bump_artigo_variante
  AFTER INSERT OR UPDATE OR DELETE ON public.variantes_tecido
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_bump_artigo_via_variante();

COMMIT;
