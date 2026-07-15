-- Histórico de preço da variante: aparecer JÁ ao DEFINIR o preço (não só após uma 2ª mudança).
-- Antes logava o preço ANTERIOR e só quando havia anterior (OLD.preco NOT NULL) → o 1º set
-- (null→valor, ex.: botão "Aplicar a todas") não gerava entrada e o histórico ficava vazio.
-- Agora loga o valor DEFINIDO (NEW.preco) em cada set/mudança (INSERT com preço OU UPDATE que
-- muda o preço) — o histórico vira um log da progressão (o mais recente = preço atual).
CREATE OR REPLACE FUNCTION public.variantes_tecido_log_preco()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.preco IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.preco IS DISTINCT FROM OLD.preco) THEN
    NEW.historico_precos := COALESCE(NEW.historico_precos, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('preco', NEW.preco, 'data', now()));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_variantes_tecido_log_preco ON public.variantes_tecido;
CREATE TRIGGER trg_variantes_tecido_log_preco
  BEFORE INSERT OR UPDATE ON public.variantes_tecido
  FOR EACH ROW EXECUTE FUNCTION public.variantes_tecido_log_preco();

-- Backfill: variantes JÁ com preço mas sem histórico (definidas antes desta mudança) ganham uma
-- entrada inicial com o preço atual (data aproximada = agora), p/ o histórico aparecer já. Não
-- toca `preco` → não dispara os triggers de log/sync. Idempotente (só semeia as vazias).
UPDATE public.variantes_tecido
SET historico_precos = jsonb_build_array(jsonb_build_object('preco', preco, 'data', now()))
WHERE preco IS NOT NULL AND COALESCE(jsonb_array_length(historico_precos), 0) = 0;
