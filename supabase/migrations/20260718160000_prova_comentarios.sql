-- Ajustes na Prova como comentários. Tabela dedicada (fio de 2 níveis via parent_id,
-- resolvido, autor/data). Leitura por RLS (tenant); escrita por RPCs DEFINER (comentar/
-- resolver/excluir). Backfill do texto legado (modelos.ajustes_prova) como 1º comentário.

BEGIN;

CREATE TABLE IF NOT EXISTS public.modelo_prova_comentarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  modelo_id uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.modelo_prova_comentarios(id) ON DELETE CASCADE,  -- null = fio de topo
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,                      -- null = importado
  texto text NOT NULL,
  resolvido boolean NOT NULL DEFAULT false,      -- só no fio de topo
  resolvido_at timestamptz,
  resolvido_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mpc_modelo ON public.modelo_prova_comentarios(modelo_id, parent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mpc_tenant ON public.modelo_prova_comentarios(tenant_id);

ALTER TABLE public.modelo_prova_comentarios ENABLE ROW LEVEL SECURITY;
-- Leitura por tenant. Escrita SÓ via RPC (DEFINER, owner postgres bypassa RLS) — sem policy
-- de INSERT/UPDATE/DELETE p/ cliente, então texto/autor ficam sob controle das RPCs.
DROP POLICY IF EXISTS mpc_tenant_select ON public.modelo_prova_comentarios;
CREATE POLICY mpc_tenant_select ON public.modelo_prova_comentarios FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

-- Comentar/responder. Reancora a resposta pro fio de TOPO (2 níveis). tenant/user do contexto.
CREATE OR REPLACE FUNCTION public.prova_comentar(_modelo_id uuid, _texto text, _parent_id uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_uid uuid := auth.uid();
  v_top uuid := NULL;
  v_new uuid;
BEGIN
  IF v_tenant IS NULL OR v_uid IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  IF _texto IS NULL OR btrim(_texto) = '' THEN RAISE EXCEPTION 'Comentário vazio'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos m WHERE m.id = _modelo_id AND m.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = '42501';
  END IF;
  IF _parent_id IS NOT NULL THEN
    SELECT COALESCE(c.parent_id, c.id) INTO v_top          -- resposta de resposta achata no topo
      FROM public.modelo_prova_comentarios c
      WHERE c.id = _parent_id AND c.tenant_id = v_tenant AND c.modelo_id = _modelo_id;
    IF v_top IS NULL THEN RAISE EXCEPTION 'Comentário pai inválido'; END IF;
  END IF;
  INSERT INTO public.modelo_prova_comentarios (tenant_id, modelo_id, parent_id, user_id, texto)
  VALUES (v_tenant, _modelo_id, v_top, v_uid, btrim(_texto))
  RETURNING id INTO v_new;
  RETURN v_new;
END;
$function$;

-- Resolver/reabrir (só fio de topo). Qualquer usuário do tenant.
CREATE OR REPLACE FUNCTION public.prova_resolver(_id uuid, _resolvido boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_uid uuid := auth.uid();
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant' USING ERRCODE = '42501'; END IF;
  UPDATE public.modelo_prova_comentarios
     SET resolvido = _resolvido,
         resolvido_at = CASE WHEN _resolvido THEN now() ELSE NULL END,
         resolvido_por = CASE WHEN _resolvido THEN v_uid ELSE NULL END
   WHERE id = _id AND tenant_id = v_tenant AND parent_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fio não encontrado'; END IF;
END;
$function$;

-- Excluir — SÓ o autor. CASCADE apaga as respostas do fio.
CREATE OR REPLACE FUNCTION public.prova_excluir(_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_uid uuid := auth.uid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.modelo_prova_comentarios
    WHERE id = _id AND tenant_id = v_tenant AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Só o autor pode excluir' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.modelo_prova_comentarios WHERE id = _id AND tenant_id = v_tenant AND user_id = v_uid;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.prova_comentar(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prova_resolver(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prova_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prova_comentar(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prova_resolver(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prova_excluir(uuid) TO authenticated;

-- Backfill: texto legado vira 1º comentário (importado, sem autor, data = criação do modelo).
-- Idempotente: pula se o modelo já tem comentário importado (user_id null).
INSERT INTO public.modelo_prova_comentarios (tenant_id, modelo_id, parent_id, user_id, texto, created_at)
SELECT m.tenant_id, m.id, NULL, NULL, btrim(m.ajustes_prova), m.created_at
FROM public.modelos m
WHERE m.ajustes_prova IS NOT NULL AND btrim(m.ajustes_prova) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.modelo_prova_comentarios c WHERE c.modelo_id = m.id AND c.user_id IS NULL
  );

COMMIT;
