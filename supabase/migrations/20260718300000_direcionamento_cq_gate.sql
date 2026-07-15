-- Gate de CQ no Direcionamento no SERVIDOR (audit de saúde jul/2026, invariante #6/#10).
-- ANTES: a lista do Direcionamento filtrava por cqLiberado() (client), mas acessar o detalhe por
-- URL direta + confirmar não re-checava — dava p/ confirmar Direcionamento de um modelo com CQ não
-- liberado. Fix: helper server `_cq_liberado` (espelho de src/lib/cq-status.ts) + gate no
-- confirmar_direcionamento. Predicado: Pré confirmado E (se há serviço pós-costura ATIVO) Pós confirmado.

CREATE OR REPLACE FUNCTION public._cq_liberado(_cad_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE((SELECT cq.status = 'confirmado'
                FROM public.controle_qualidade cq WHERE cq.cad_id = _cad_id LIMIT 1), false)
    AND (
      -- sem serviço pós-costura ativo → basta o Pré
      NOT EXISTS (
        SELECT 1 FROM public.producao_terceirizados pt
        JOIN public.categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
        WHERE pt.cad_id = _cad_id
          AND COALESCE(pt.ativo, true) <> false
          AND COALESCE(ct.etapa, 'ate_costura') = 'pos_costura'
      )
      -- com pós ativo → precisa do Pós confirmado
      OR COALESCE((SELECT cq.status_pos = 'confirmado'
                     FROM public.controle_qualidade cq WHERE cq.cad_id = _cad_id LIMIT 1), false)
    );
$function$;

REVOKE EXECUTE ON FUNCTION public._cq_liberado(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.confirmar_direcionamento(_cad_id uuid, _rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public._cq_liberado(_cad_id) THEN
    RAISE EXCEPTION 'O Controle de Qualidade deste modelo não está liberado — confirme o CQ (Pré e, se houver acabamento, o Pós) antes de confirmar o Direcionamento.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public._salvar_direcionamento_core(_cad_id, _rows, true, true);
END;
$function$;

select pg_notify('pgrst','reload schema');
