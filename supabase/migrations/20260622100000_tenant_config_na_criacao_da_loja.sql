-- Item 11 (Fase 1): loja sem linha em tenant_config caía no fallback ALL_ON; e,
-- após o P0-6 (leituras filtradas por tenant_id), a leitura devolvia 0 linhas.
-- Garante 1 tenant_config por tenant. A tabela já tem DEFAULT para todas as
-- colunas (modules todos-on, timezone, status_kanban, tamanhos_grade, etc.), só
-- falta o tenant_id. UNIQUE(tenant_id) já existe (os upserts dependem dele).

-- 1) Backfill dos tenants existentes sem config (havia 1: 3 tenants, 2 configs).
INSERT INTO public.tenant_config (tenant_id)
SELECT t.id FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_config c WHERE c.tenant_id = t.id)
ON CONFLICT (tenant_id) DO NOTHING;

-- 2) Toda nova loja passa a ganhar sua tenant_config (defaults da tabela).
CREATE OR REPLACE FUNCTION public.criar_tenant_config_padrao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.tenant_config (tenant_id) VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_criar_tenant_config ON public.tenants;
CREATE TRIGGER trg_criar_tenant_config
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.criar_tenant_config_padrao();
