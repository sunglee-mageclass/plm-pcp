-- Volta de 20261129110000: devolve o corpo de ANTES de _peca_teste_aprovada(uuid,uuid,uuid) (por linha + fornecedor). A funcao NOVA _peca_teste_aprovada_tipo fica (so cai no _down_drop, depois de TODOS os _down). So catalogo.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
CREATE OR REPLACE FUNCTION public._peca_teste_aprovada(_mo_linha_id uuid, _categoria_id uuid, _empresa_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [urg r9b] PREDICADO UNICO de "peca teste aprovada" de uma trilha (linha de M.O. x tipo de servico): a tentativa ATUAL (maior
  -- numero) esta 'aprovado' E o fornecedor congelado na decisao = o fornecedor ATUAL da linha (_empresa_id). Revisao T1, achado 1:
  -- trocar o tipo da linha ou o switch exige_peca_teste ida-e-volta com o fornecedor trocado no meio NAO transfere a aprovacao a
  -- quem nunca fez a peca. Sem tentativa = false. Nao olha o switch nem a M.O. aprovada (o chamador decide). Usado pela trava de
  -- fornecedor, pelas leituras da secao e do quadro e pela condicao do kanban (194000). EXECUTE so postgres/service_role.
  SELECT coalesce((SELECT t.aprovacao = 'aprovado' AND t.empresa_id IS NOT DISTINCT FROM _empresa_id
                     FROM public.modelo_peca_teste_tentativas t
                    WHERE t.mo_linha_id = _mo_linha_id AND t.categoria_terceirizado_id = _categoria_id
                    ORDER BY t.numero DESC LIMIT 1), false)
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_aprovada(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
COMMIT;

select pg_notify('pgrst', 'reload schema');
