-- Preço POR VARIANTE de tecido (Fase 1). O preço passa a viver na variante; o artigo mantém
-- o preço de REFERÊNCIA = MAX(variantes) (mantido por trigger, robusto por qualquer caminho).
-- Histórico de preço por variante (mesma mecânica do artigo, com data via now() — sem o bug '+00').

ALTER TABLE public.variantes_tecido
  ADD COLUMN IF NOT EXISTS preco numeric,
  ADD COLUMN IF NOT EXISTS historico_precos jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 1) Histórico por variante: loga o preço ANTERIOR quando muda (e só se havia preço antes).
CREATE OR REPLACE FUNCTION public.variantes_tecido_log_preco()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.preco IS DISTINCT FROM OLD.preco AND OLD.preco IS NOT NULL THEN
    NEW.historico_precos := COALESCE(OLD.historico_precos, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('preco', OLD.preco, 'data', now()));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_variantes_tecido_log_preco ON public.variantes_tecido;
CREATE TRIGGER trg_variantes_tecido_log_preco
  BEFORE UPDATE ON public.variantes_tecido
  FOR EACH ROW EXECUTE FUNCTION public.variantes_tecido_log_preco();

-- 2) artigo.preco = MAX(variantes.preco) — "o artigo é sempre o maior". Recomputa em qualquer
-- mudança de variante. Se nenhuma variante tem preço, NÃO mexe no artigo (mantém o atual).
-- O UPDATE em artigos dispara artigos_recalc_preco (histórico de referência + preco_por_metro).
CREATE OR REPLACE FUNCTION public.variantes_tecido_sync_artigo_preco()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_artigo uuid; v_max numeric;
BEGIN
  v_artigo := COALESCE(NEW.artigo_id, OLD.artigo_id);
  SELECT MAX(preco) INTO v_max
    FROM public.variantes_tecido WHERE artigo_id = v_artigo AND preco IS NOT NULL;
  IF v_max IS NOT NULL THEN
    UPDATE public.artigos SET preco = v_max WHERE id = v_artigo AND preco IS DISTINCT FROM v_max;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_variantes_tecido_sync_artigo_preco ON public.variantes_tecido;
CREATE TRIGGER trg_variantes_tecido_sync_artigo_preco
  AFTER INSERT OR DELETE OR UPDATE OF preco ON public.variantes_tecido
  FOR EACH ROW EXECUTE FUNCTION public.variantes_tecido_sync_artigo_preco();
