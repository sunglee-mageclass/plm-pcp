-- Reforma da Peca Teste por TIPO - migration 1 de 5 (DADOS): a chave da trilha passa de (mo_linha_id, tipo, numero) para
-- (modelo_id, tipo, numero). Spec: docs/superpowers/specs/2026-11-13-reforma-peca-teste-e-condicoes-pl-design.md (A1, A5).
-- O que faz (so catalogo + dado da tabela modelo_peca_teste_tentativas; NADA em auth/storage/realtime):
--   1) backup _bkp_mpt_reforma_20261129 (copia INTEIRA da tabela, uma vez; RLS ligado, sem policy, REVOKE ALL).
--   2) DROP do UNIQUE antigo mpt_trilha_numero_ux (por linha) ANTES de renumerar.
--   3) RENUMERA, por created_at/id, so os grupos (modelo, tipo) em que a uniao por tipo produz "numero" repetido.
--   4) GUARDA de coerencia: no grupo (modelo, tipo) so a ULTIMA tentativa pode estar fora de 'reprovado'; senao ABORTA
--      (o dono resolve a mao antes - consulta supabase/consultas/peca_teste_tipo_passo0.sql).
--   5) novo UNIQUE mpt_trilha_tipo_numero_uq (modelo_id, categoria_terceirizado_id, numero).
--   6) BACKFILL: tentativa EM TESTE sem fornecedor ganha o fornecedor vigente da M.O. (mo_linha_id) quando houver.
-- Idempotente (2a vez: nada a renumerar/copiar/preencher). lock_timeout 1500ms: 55P03 = nada mudou, rodar de novo.
-- Aplicar FORA de transacao: psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261129100000_peca_teste_tipo_dados.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK. Banco ANTES do site. Volta: supabase/rollback/20261129100000_peca_teste_tipo_dados_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DO $pre$
BEGIN
  IF to_regclass('public.modelo_peca_teste_tentativas') IS NULL THEN
    RAISE EXCEPTION 'reforma_pt_dados: tabela modelo_peca_teste_tentativas ausente' USING ERRCODE = 'P0001';
  END IF;
END
$pre$;

-- 1) backup (copia inteira, so as linhas ainda nao copiadas)
CREATE TABLE IF NOT EXISTS public._bkp_mpt_reforma_20261129 (LIKE public.modelo_peca_teste_tentativas INCLUDING DEFAULTS);
ALTER TABLE public._bkp_mpt_reforma_20261129 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_mpt_reforma_20261129 FROM PUBLIC, anon, authenticated;
INSERT INTO public._bkp_mpt_reforma_20261129
SELECT t.* FROM public.modelo_peca_teste_tentativas t
 WHERE NOT EXISTS (SELECT 1 FROM public._bkp_mpt_reforma_20261129 b WHERE b.id = t.id);

-- 2) chave antiga fora (o UPDATE em lote abaixo nao pode tropecar nela)
DROP INDEX IF EXISTS public.mpt_trilha_numero_ux;

-- 3) renumera so os grupos (modelo, tipo) com numero repetido
WITH colide AS (
  SELECT modelo_id, categoria_terceirizado_id
    FROM public.modelo_peca_teste_tentativas
   GROUP BY modelo_id, categoria_terceirizado_id
  HAVING count(*) <> count(DISTINCT numero)
), nova AS (
  SELECT t.id, row_number() OVER (PARTITION BY t.modelo_id, t.categoria_terceirizado_id ORDER BY t.created_at, t.id) AS nn
    FROM public.modelo_peca_teste_tentativas t
    JOIN colide c ON c.modelo_id = t.modelo_id AND c.categoria_terceirizado_id = t.categoria_terceirizado_id
)
UPDATE public.modelo_peca_teste_tentativas t
   SET numero = n.nn, updated_at = now()
  FROM nova n
 WHERE n.id = t.id AND t.numero <> n.nn;

-- 4) coerencia da trilha unida: so a ultima tentativa do tipo pode estar fora de 'reprovado'
DO $coer$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.modelo_peca_teste_tentativas t
   WHERE t.aprovacao IS DISTINCT FROM 'reprovado'
     AND EXISTS (SELECT 1 FROM public.modelo_peca_teste_tentativas o
                  WHERE o.modelo_id = t.modelo_id AND o.categoria_terceirizado_id = t.categoria_terceirizado_id
                    AND o.numero > t.numero);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'reforma_pt_dados: % tentativa(s) nao reprovada(s) ficariam no meio da trilha do tipo - rode supabase/consultas/peca_teste_tipo_passo0.sql e resolva antes', v_n
      USING ERRCODE = 'P0001';
  END IF;
END
$coer$;

-- 5) novo UNIQUE por tipo
DO $uq$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.modelo_peca_teste_tentativas'::regclass AND conname = 'mpt_trilha_tipo_numero_uq') THEN
    ALTER TABLE public.modelo_peca_teste_tentativas
      ADD CONSTRAINT mpt_trilha_tipo_numero_uq UNIQUE (modelo_id, categoria_terceirizado_id, numero);
  END IF;
END
$uq$;

-- 6) backfill do fornecedor da tentativa EM TESTE (a decidida ja o tem congelado)
UPDATE public.modelo_peca_teste_tentativas t
   SET empresa_id = s.empresa_id, updated_at = now()
  FROM public.modelo_servico_mo s
 WHERE s.id = t.mo_linha_id
   AND t.empresa_id IS NULL AND t.aprovacao IS NULL AND s.empresa_id IS NOT NULL;

-- pos-condicao
DO $pos$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.modelo_peca_teste_tentativas'::regclass AND conname = 'mpt_trilha_tipo_numero_uq') THEN
    RAISE EXCEPTION 'reforma_pt_dados: pos-condicao falhou - UNIQUE por tipo ausente' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'mpt_trilha_numero_ux') THEN
    RAISE EXCEPTION 'reforma_pt_dados: pos-condicao falhou - UNIQUE por linha ainda existe' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
