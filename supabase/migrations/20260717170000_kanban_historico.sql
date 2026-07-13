-- Leadtime — Fase 1: histórico de transições de coluna do kanban (status_desenvolvimento).
-- Tabela + trigger (grava cada troca daqui pra frente) + backfill do audit_log (recupera
-- o histórico já registrado desde jun/2026). Base do "tempo em cada coluna" do Leadtime.

BEGIN;

CREATE TABLE IF NOT EXISTS public.modelo_kanban_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  modelo_id uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  status text NOT NULL,
  entrou_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mkh_modelo ON public.modelo_kanban_historico(modelo_id, entrou_at);
CREATE INDEX IF NOT EXISTS idx_mkh_tenant ON public.modelo_kanban_historico(tenant_id);

ALTER TABLE public.modelo_kanban_historico ENABLE ROW LEVEL SECURITY;
-- Leitura por tenant (a RPC do dashboard lê via DEFINER; policy é defesa). Escrita só
-- pelo trigger/backfill (owner=postgres, bypassa RLS) — sem policy de INSERT p/ cliente.
DROP POLICY IF EXISTS mkh_tenant_select ON public.modelo_kanban_historico;
CREATE POLICY mkh_tenant_select ON public.modelo_kanban_historico FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

-- Trigger: grava a entrada em cada coluna (INSERT com status, ou troca de status).
CREATE OR REPLACE FUNCTION public.fn_kanban_historico()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status_desenvolvimento IS NOT NULL THEN
      INSERT INTO public.modelo_kanban_historico(tenant_id, modelo_id, status, entrou_at)
      VALUES (NEW.tenant_id, NEW.id, NEW.status_desenvolvimento, COALESCE(NEW.created_at, now()));
    END IF;
  ELSIF NEW.status_desenvolvimento IS DISTINCT FROM OLD.status_desenvolvimento
        AND NEW.status_desenvolvimento IS NOT NULL THEN
    INSERT INTO public.modelo_kanban_historico(tenant_id, modelo_id, status, entrou_at)
    VALUES (NEW.tenant_id, NEW.id, NEW.status_desenvolvimento, now());
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_historico ON public.modelos;
CREATE TRIGGER trg_kanban_historico
  AFTER INSERT OR UPDATE OF status_desenvolvimento ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_kanban_historico();

-- Backfill 1: cada entrada em coluna registrada no audit_log (o "para" das trocas).
INSERT INTO public.modelo_kanban_historico(tenant_id, modelo_id, status, entrou_at)
SELECT m.tenant_id, m.id, a.dados->'status_desenvolvimento'->>'para', a.created_at
FROM public.audit_log a
JOIN public.modelos m ON m.id = a.registro_id
WHERE a.entidade = 'Modelo'
  AND a.dados ? 'status_desenvolvimento'
  AND (a.dados->'status_desenvolvimento'->>'para') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.modelo_kanban_historico h
    WHERE h.modelo_id = m.id AND h.entrou_at = a.created_at
  );

-- Backfill 2: o status INICIAL (o "de" da 1ª troca registrada), entrando na criação do modelo.
INSERT INTO public.modelo_kanban_historico(tenant_id, modelo_id, status, entrou_at)
SELECT m.tenant_id, m.id, x.first_de, m.created_at
FROM (
  SELECT DISTINCT ON (a.registro_id) a.registro_id,
         a.dados->'status_desenvolvimento'->>'de' AS first_de
  FROM public.audit_log a
  WHERE a.entidade = 'Modelo' AND a.dados ? 'status_desenvolvimento'
  ORDER BY a.registro_id, a.created_at ASC
) x
JOIN public.modelos m ON m.id = x.registro_id
WHERE x.first_de IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.modelo_kanban_historico h
    WHERE h.modelo_id = m.id AND h.entrou_at = m.created_at
  );

COMMIT;
