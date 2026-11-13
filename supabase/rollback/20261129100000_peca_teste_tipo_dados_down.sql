-- Volta de 20261129100000 (dados da Peca Teste por TIPO): tira o UNIQUE por tipo, RESTAURA os numeros de antes (do backup
-- _bkp_mpt_reforma_20261129) nos grupos (modelo, tipo) 100% cobertos por ele (nenhuma tentativa criada depois da ida) e devolve o UNIQUE por
-- linha. O backfill do fornecedor da tentativa FICA (dado inofensivo). O backup FICA (a faxina o apaga depois). Idempotente.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

ALTER TABLE public.modelo_peca_teste_tentativas DROP CONSTRAINT IF EXISTS mpt_trilha_tipo_numero_uq;

UPDATE public.modelo_peca_teste_tentativas t
   SET numero = b.numero, updated_at = now()
  FROM public._bkp_mpt_reforma_20261129 b
 WHERE b.id = t.id AND t.numero <> b.numero
   AND NOT EXISTS (SELECT 1 FROM public.modelo_peca_teste_tentativas o
                    WHERE o.modelo_id = t.modelo_id AND o.categoria_terceirizado_id = t.categoria_terceirizado_id
                      AND NOT EXISTS (SELECT 1 FROM public._bkp_mpt_reforma_20261129 bb WHERE bb.id = o.id));

CREATE UNIQUE INDEX IF NOT EXISTS mpt_trilha_numero_ux
  ON public.modelo_peca_teste_tentativas (mo_linha_id, categoria_terceirizado_id, numero) WHERE mo_linha_id IS NOT NULL;

COMMIT;

select pg_notify('pgrst', 'reload schema');
