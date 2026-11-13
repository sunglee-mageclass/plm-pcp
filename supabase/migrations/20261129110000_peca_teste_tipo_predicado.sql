-- Reforma da Peca Teste por TIPO - migration 2 de 5 (PREDICADO): "peca teste aprovada" passa a ser lida por (modelo, tipo).
-- Spec A4. O que faz (so catalogo: CREATE OR REPLACE FUNCTION + REVOKE; nenhum dado):
--   1) funcao NOVA _peca_teste_aprovada_tipo(_modelo_id, _categoria_id): a tentativa ATUAL (maior numero) do tipo esta 'aprovado'.
--      PREDICADO UNICO novo. Nao olha fornecedor (e da tentativa), nem a M.O., nem o switch exige_peca_teste (o chamador decide).
--   2) _peca_teste_aprovada(uuid,uuid,uuid) REDEFINIDA como CASCA de compatibilidade: mesma assinatura (os avaliadores do kanban do
--      Dev e do PL, a trava e o status em lote a chamam por (linha, tipo, fornecedor) e ficam BYTE A BYTE como estao - o avaliador do
--      Dev e o motor ficam INTOCADOS); _mo_linha_id so resolve o modelo; _empresa_id e IGNORADO. Limpeza da assinatura = backlog.
-- EFEITO NO KANBAN (Review Focus 2): trocar a leitura de "por linha+fornecedor" para "por tipo" pode mudar o resultado de
-- peca_teste_aprovada em cards existentes (ex.: fornecedor da M.O. diferente do congelado = antes false, agora true). Os cards se
-- movem no 1o recalculo da fila. Rode ANTES o Passo 0 (supabase/consultas/peca_teste_tipo_passo0.sql).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._peca_teste_aprovada(uuid,uuid,uuid)   ANTES 417fa9850a5a52204f62476818dc408c
--   public._peca_teste_aprovada_tipo(uuid,uuid)   ANTES ausente
-- ====================================================================================
-- Aplicar FORA de transacao: psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261129110000_peca_teste_tipo_predicado.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK. Banco ANTES do site. Volta: supabase/rollback/20261129110000_peca_teste_tipo_predicado_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DO $pre$
DECLARE
  v_old text := md5(pg_get_functiondef('public._peca_teste_aprovada(uuid,uuid,uuid)'::regprocedure));
BEGIN
  IF v_old <> '417fa9850a5a52204f62476818dc408c'
     AND position('[reforma pt]' in pg_get_functiondef('public._peca_teste_aprovada(uuid,uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'reforma_pt_predicado: _peca_teste_aprovada divergente (md5 %), esperado 417fa9850a5a52204f62476818dc408c', v_old
      USING ERRCODE = 'P0001';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public._peca_teste_aprovada_tipo(_modelo_id uuid, _categoria_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [reforma pt] PREDICADO UNICO de "peca teste aprovada" da trilha (modelo x tipo de servico): a tentativa ATUAL (maior numero) esta
  -- 'aprovado'. O fornecedor e da tentativa (nao compara com a M.O.). Sem tentativa = false. Nao olha o switch exige_peca_teste nem
  -- a M.O. aprovada (o chamador decide). Usado pelas leituras da secao/quadro/lote, pela casca _peca_teste_aprovada e, por ela, pela
  -- condicao peca_teste_aprovada do kanban (Dev e PL). EXECUTE so postgres/service_role.
  SELECT coalesce((SELECT t.aprovacao = 'aprovado'
                     FROM public.modelo_peca_teste_tentativas t
                    WHERE t.modelo_id = _modelo_id AND t.categoria_terceirizado_id = _categoria_id
                    ORDER BY t.numero DESC LIMIT 1), false)
$function$;

CREATE OR REPLACE FUNCTION public._peca_teste_aprovada(_mo_linha_id uuid, _categoria_id uuid, _empresa_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [reforma pt] CASCA de compatibilidade (assinatura antiga mantida p/ os avaliadores do kanban): le por (modelo da linha, tipo).
  -- _empresa_id e IGNORADO (o fornecedor agora e da tentativa). Linha inexistente = false.
  SELECT public._peca_teste_aprovada_tipo(
           (SELECT s.modelo_id FROM public.modelo_servico_mo s WHERE s.id = _mo_linha_id), _categoria_id)
$function$;

REVOKE EXECUTE ON FUNCTION public._peca_teste_aprovada_tipo(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._peca_teste_aprovada(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname IN ('_peca_teste_aprovada', '_peca_teste_aprovada_tipo')
                AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))
                AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'reforma_pt_predicado: pos-condicao falhou - ACL com EXECUTE para PUBLIC/anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
