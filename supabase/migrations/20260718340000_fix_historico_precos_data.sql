-- Fix "invalid date" no histórico de preços do tecido (cadastro.tecidos).
-- CAUSA: o trigger gravava a data com to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF') — o 'OF'
-- produz o offset como '+00' (2 dígitos), que NÃO é ISO 8601 válido → new Date('...+00') =
-- Invalid Date no JS. FIX: gravar now() direto — o jsonb serializa timestamptz como ISO com
-- offset '+00:00' (parseável). Também: só logar quando HAVIA preço anterior (OLD.preco NOT NULL),
-- evitando entradas-fantasma "R$ 0,00"; e limpa as entradas de preço nulo já gravadas.

CREATE OR REPLACE FUNCTION public.artigos_recalc_preco()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.unidade_medida = 'kg' AND COALESCE(NEW.rendimento,0) > 0 THEN
    NEW.preco_por_metro := NEW.preco / NEW.rendimento;
  ELSIF NEW.unidade_medida = 'metro' THEN
    NEW.preco_por_metro := NEW.preco;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.preco IS DISTINCT FROM OLD.preco AND OLD.preco IS NOT NULL THEN
    NEW.historico_precos := COALESCE(OLD.historico_precos, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object(
        'preco', OLD.preco,
        'preco_por_metro', OLD.preco_por_metro,
        'data', now()   -- timestamptz → jsonb ISO '+00:00' (parseável no JS)
      ));
  END IF;

  RETURN NEW;
END;
$function$;

-- Limpa entradas antigas com preço nulo (ruído "R$ 0,00" + data '+00' inválida).
UPDATE public.artigos
SET historico_precos = COALESCE((
  SELECT jsonb_agg(e) FROM jsonb_array_elements(historico_precos) e
  WHERE (e->>'preco') IS NOT NULL
), '[]'::jsonb)
WHERE jsonb_typeof(historico_precos) = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(historico_precos) e WHERE (e->>'preco') IS NULL);
