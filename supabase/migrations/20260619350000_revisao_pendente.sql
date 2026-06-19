-- Revisão pendente por etapa após edição (badge #Erro até "Verificado").
ALTER TABLE public.modelos
  ADD COLUMN IF NOT EXISTS revisao_pendente jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Marca etapas como "revisão pendente" (após editar grade/consumo/aviamentos).
CREATE OR REPLACE FUNCTION public.marcar_revisao_pendente(_modelo_id uuid, _etapas text[])
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  UPDATE public.modelos
     SET revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb)
                            || COALESCE((SELECT jsonb_object_agg(e, true) FROM unnest(_etapas) e), '{}'::jsonb)
   WHERE id = _modelo_id AND tenant_id = public.get_user_tenant_id()
     AND array_length(_etapas, 1) > 0;
$function$;

-- "Verificado": remove uma etapa da revisão pendente (some o #Erro).
CREATE OR REPLACE FUNCTION public.marcar_etapa_verificada(_modelo_id uuid, _etapa text)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  UPDATE public.modelos
     SET revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb) - _etapa
   WHERE id = _modelo_id AND tenant_id = public.get_user_tenant_id();
$function$;

REVOKE EXECUTE ON FUNCTION public.marcar_revisao_pendente(uuid, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.marcar_etapa_verificada(uuid, text) FROM anon;
