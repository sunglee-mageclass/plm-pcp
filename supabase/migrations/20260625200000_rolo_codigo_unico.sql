-- Código de rolo ÚNICO por loja. Antes proximo_codigo_rolo usava count(*)+1 → ao
-- deletar/recriar rolos (troca/ajuste) o número RECICLAVA e gerava códigos iguais.
-- Agora: contador monotônico por loja (rolo_counters, nunca volta) + UNIQUE.

CREATE TABLE IF NOT EXISTS public.rolo_counters (
  tenant_id uuid PRIMARY KEY,
  seq int NOT NULL DEFAULT 0
);
ALTER TABLE public.rolo_counters ENABLE ROW LEVEL SECURITY; -- acesso só via função definer

-- Seed: maior sequência já usada por loja (lê o número R#### do código existente).
INSERT INTO public.rolo_counters (tenant_id, seq)
SELECT tenant_id, COALESCE(MAX(NULLIF(substring(rolo_codigo from 2 for 4), '')::int), 0)
FROM public.ocs_tecido
WHERE is_rolo = true AND rolo_codigo ~ '^R[0-9]{4}'
GROUP BY tenant_id
ON CONFLICT (tenant_id) DO NOTHING;

-- Limpa duplicados existentes (mantém o 1º; nos demais acrescenta sufixo p/ ficar único).
WITH dups AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id, rolo_codigo ORDER BY created_at, id) AS rn
  FROM public.ocs_tecido WHERE is_rolo = true AND rolo_codigo IS NOT NULL
)
UPDATE public.ocs_tecido o
   SET rolo_codigo = o.rolo_codigo || '-' || d.rn,
       numero_pedido = COALESCE(o.numero_pedido, o.rolo_codigo) || '-' || d.rn
FROM dups d WHERE d.id = o.id AND d.rn > 1;

-- proximo_codigo_rolo: incrementa o contador (atômico, nunca recicla).
CREATE OR REPLACE FUNCTION public.proximo_codigo_rolo(_artigo_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_cat text := '';
  v_seq int;
BEGIN
  IF v_tenant IS NULL THEN RETURN ''; END IF;
  IF _artigo_id IS NOT NULL THEN
    SELECT UPPER(LEFT(COALESCE(ct.nome, ''), 1)) INTO v_cat
    FROM public.artigos a
    LEFT JOIN public.categorias_tecido ct ON ct.id = a.categoria_tecido_id
    WHERE a.id = _artigo_id;
  END IF;
  INSERT INTO public.rolo_counters (tenant_id, seq) VALUES (v_tenant, 1)
  ON CONFLICT (tenant_id) DO UPDATE SET seq = public.rolo_counters.seq + 1
  RETURNING seq INTO v_seq;
  RETURN 'R' || LPAD(v_seq::text, 4, '0') || COALESCE(v_cat, '')
         || to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYMMDD');
END;
$function$;

-- Garantia: não dá mais para ter dois rolos com o mesmo código na mesma loja.
CREATE UNIQUE INDEX IF NOT EXISTS ocs_tecido_rolo_codigo_uidx
  ON public.ocs_tecido (tenant_id, rolo_codigo) WHERE is_rolo = true;

REVOKE ALL ON public.rolo_counters FROM public, anon, authenticated;
