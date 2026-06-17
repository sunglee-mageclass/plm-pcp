-- Endereçamento múltiplo por variante: uma variante pode ocupar vários locais.
-- enderecos = [{ "rua": "A", "prateleira": "3" }, ...]. Mantém rua/prateleira
-- (legado) e migra o valor único existente para o array.
ALTER TABLE public.variantes_tecido
  ADD COLUMN IF NOT EXISTS enderecos jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.variantes_tecido
  SET enderecos = jsonb_build_array(
    jsonb_build_object('rua', COALESCE(rua, ''), 'prateleira', COALESCE(prateleira, ''))
  )
  WHERE (enderecos IS NULL OR enderecos = '[]'::jsonb)
    AND (COALESCE(rua, '') <> '' OR COALESCE(prateleira, '') <> '');
