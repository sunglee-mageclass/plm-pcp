-- FIX do gate de preço de venda (20260911120000): o trigger `fn_modelo_preco_venda_gate` mordia
-- em QUALQUER mudança de `preco_venda`, inclusive no recompute DERIVADO da revenda/importado
-- (`_pa_recomputar_precos_modelo`, chamado por `receber_oc_p_acabado`, `salvar_markups_produto_
-- acabado`, etc.). Como `user_can_edit` lê o `sub` do JWT — que `SECURITY DEFINER` NÃO troca (muda
-- o role executor, não a identidade) —, o trigger julgava o USUÁRIO REAL (ex.: usuário de estoque
-- recebendo a OC, sem `criacao_planejamento:preco_venda`) → RAISE 42501 → a transação atômica de
-- recebimento/save de markup falhava inteira.
--
-- CORREÇÃO: o preço de comprado (revenda/importado) é SEMPRE derivado no servidor, nunca digitado
-- por cliente (o front bloqueia via `ehOrigemComprada`; invariante 13/§Revenda). Então o gate só
-- deve morder para origem INTERNA (manufaturada) — o único caso em que o cliente edita o preço.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_modelo_preco_venda_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Só morde para origem INTERNA (o preço de revenda/importado é derivado no servidor — o recompute
  -- definer muda `preco_venda` mas roda com o JWT de quem RECEBE a OC / salva markups, que não tem
  -- esta section). Origem comprada nunca é editável por cliente no card/Sheet (front já bloqueia).
  IF NEW.preco_venda IS DISTINCT FROM OLD.preco_venda
     AND COALESCE(NEW.origem, 'interno') NOT IN ('revenda', 'importado')
     AND NOT public.user_can_edit('criacao_planejamento:preco_venda') THEN
    RAISE EXCEPTION 'Sem permissão para editar o preço de venda'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;

-- REVOKE dos TRÊS (invariante #9 — CREATE OR REPLACE reconcede EXECUTE a PUBLIC por padrão).
REVOKE EXECUTE ON FUNCTION public.fn_modelo_preco_venda_gate() FROM PUBLIC, anon, authenticated;

COMMIT;

SELECT pg_notify('pgrst', 'reload schema');
