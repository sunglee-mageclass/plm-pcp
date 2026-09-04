-- Produtos Importados — Fase 2: coluna de vínculo das parcelas a pagar com a OC de importação.
-- Espelha `parcelas.oc_p_acabado_id` (ON DELETE CASCADE + índice único parcial por nº de parcela).
-- `tipo_oc='p_importado'` (varchar(20) sem check — cabe). As parcelas do importado nascem das
-- ETAPAS da OC (1 por etapa), com valor já convertido moeda→BRL (parcelas é BRL-only). O gerador
-- vem na próxima migration. Aditivo, idempotente.

ALTER TABLE public.parcelas
  ADD COLUMN IF NOT EXISTS oc_importado_id uuid REFERENCES public.ocs_importado(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS parcelas_oc_importado_numero_key
  ON public.parcelas (oc_importado_id, numero_parcela)
  WHERE oc_importado_id IS NOT NULL;
