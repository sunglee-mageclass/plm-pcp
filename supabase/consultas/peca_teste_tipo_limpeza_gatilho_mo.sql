-- Limpeza POS-DEPLOY (ESCRITA, horario calmo) - Reforma da Peca Teste por TIPO: apaga o gatilho INERTE trg_peca_teste_trava_fornecedor de
-- modelo_servico_mo e a funcao NEUTRA fn_peca_teste_trava_fornecedor() (a trava de fornecedor mora agora em
-- trg_peca_teste_trava_fornecedor_tentativa). DROP TRIGGER pede lock forte na tabela: lock_timeout curto, 55P03 = nada mudou, rodar de novo.
-- Rodar SO depois da reforma estavel em producao (>= 1 dia), fora do horario de uso. Nao e revertido pelos _down da reforma: se precisar voltar,
-- rode ANTES o 20261129120000_peca_teste_tipo_salvar_down.sql (devolve o corpo antigo da funcao) e recrie o gatilho com:
--   CREATE TRIGGER trg_peca_teste_trava_fornecedor BEFORE UPDATE OF empresa_id ON public.modelo_servico_mo FOR EACH ROW
--     WHEN (OLD.empresa_id IS DISTINCT FROM NEW.empresa_id) EXECUTE FUNCTION public.fn_peca_teste_trava_fornecedor();
-- Rodar: psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/consultas/peca_teste_tipo_limpeza_gatilho_mo.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DO $guard$
BEGIN
  IF position('[reforma pt]' in pg_get_functiondef('public.fn_peca_teste_trava_fornecedor()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'limpeza_pt: fn_peca_teste_trava_fornecedor ainda NAO e a versao neutra da reforma - nao apague' USING ERRCODE = 'P0001';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS trg_peca_teste_trava_fornecedor ON public.modelo_servico_mo;
DROP FUNCTION IF EXISTS public.fn_peca_teste_trava_fornecedor();

COMMIT;
