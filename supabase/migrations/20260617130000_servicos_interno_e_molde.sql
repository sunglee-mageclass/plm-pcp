-- Serviços (Produção > Terceirizados): cada serviço pode ser Interno (feito na
-- loja) ou PL (externo). Default PL (false).
ALTER TABLE public.producao_terceirizados
  ADD COLUMN IF NOT EXISTS interno BOOLEAN NOT NULL DEFAULT false;

-- "Observação de Partes do Molde" passa a ter fonte única no CAD (Ficha de Corte).
-- A Oficina continua editando o mesmo campo, lendo/gravando em cad.observacoes_molde.
ALTER TABLE public.cad
  ADD COLUMN IF NOT EXISTS observacoes_molde TEXT;

-- Migra (uma vez) as observações de molde já preenchidas na Oficina para o CAD.
UPDATE public.cad c
SET observacoes_molde = po.observacoes_molde
FROM public.producao_oficina po
WHERE po.cad_id = c.id
  AND po.observacoes_molde IS NOT NULL
  AND btrim(po.observacoes_molde) <> ''
  AND (c.observacoes_molde IS NULL OR btrim(c.observacoes_molde) = '');
