-- DROP do que a reforma da Peca Teste por TIPO criou. Rodar SO DEPOIS de TODOS os _down (140000, 130000, 120000, 110000, 100000), em horario calmo
-- (DROP TRIGGER pede lock na tabela de tentativas). Recusa se alguma funcao ainda citar as que vao cair.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DO $guard$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname NOT IN ('_peca_teste_aprovada_tipo', '_peca_teste_valida_fornecedor', '_peca_teste_fornecedores_tipo', 'fn_peca_teste_trava_fornecedor_tentativa')
     AND (p.prosrc ILIKE '%_peca_teste_aprovada_tipo%' OR p.prosrc ILIKE '%_peca_teste_valida_fornecedor%'
          OR p.prosrc ILIKE '%_peca_teste_fornecedores_tipo%' OR p.prosrc ILIKE '%fn_peca_teste_trava_fornecedor_tentativa%');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'reforma_pt_down_drop: % funcao(oes) ainda citam as funcoes novas - rode antes TODOS os _down', v_n USING ERRCODE = 'P0001';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS trg_peca_teste_trava_fornecedor_tentativa ON public.modelo_peca_teste_tentativas;
DROP FUNCTION IF EXISTS public.fn_peca_teste_trava_fornecedor_tentativa();
DROP FUNCTION IF EXISTS public._peca_teste_valida_fornecedor(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public._peca_teste_fornecedores_tipo(uuid, uuid);
DROP FUNCTION IF EXISTS public._peca_teste_aprovada_tipo(uuid, uuid);

COMMIT;

select pg_notify('pgrst', 'reload schema');
