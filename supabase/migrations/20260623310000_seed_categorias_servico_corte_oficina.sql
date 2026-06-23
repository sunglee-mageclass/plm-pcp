-- "Corte" e "Oficina" como categorias de SERVIÇO sempre presentes por loja, p/ evitar
-- que uma loja fique sem esses dois processos. "Oficina" tem significado de sistema
-- (detecção ILIKE 'oficina' no fluxo CQ→financeiro); "Corte" garante o processo de
-- corte como serviço terceirizável. A proteção contra exclusão/rename fica no front
-- (AttributeTab.protectedNames), espelhando os tipos fixos de colaboradores.

-- Backfill: adiciona Corte/Oficina às lojas que ainda não têm (case-insensitive, p/
-- não duplicar quem já tem 'corte'/'oficina' em qualquer caixa).
INSERT INTO public.categorias_terceirizado (tenant_id, nome, ordem)
SELECT t.id, c.nome, c.ordem
FROM public.tenants t
CROSS JOIN (VALUES ('Corte', 0), ('Oficina', 1)) AS c(nome, ordem)
WHERE NOT EXISTS (
  SELECT 1 FROM public.categorias_terceirizado ct
  WHERE ct.tenant_id = t.id AND ct.nome ILIKE c.nome
);

-- Lojas novas: o trigger de criação também semeia Corte e Oficina.
CREATE OR REPLACE FUNCTION public.criar_tenant_config_padrao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.tenant_config (tenant_id) VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  -- Categorias de serviço sempre presentes (Corte e Oficina).
  INSERT INTO public.categorias_terceirizado (tenant_id, nome, ordem)
  VALUES (NEW.id, 'Corte', 0), (NEW.id, 'Oficina', 1)
  ON CONFLICT (tenant_id, nome) DO NOTHING;
  RETURN NEW;
END;
$function$;
