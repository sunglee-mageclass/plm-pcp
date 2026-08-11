-- FF3 (fast-follow Revenda, ago/2026): belt-and-suspenders de tenant-match nos 2 elos
-- opcionais da cadeia Produto Acabado — `produtos_acabados.modelo_id` (espelho pro card
-- do Planejamento) e `ocs_p_acabado.produto_acabado_id` (OC vinculada ao produto). As
-- policies `tenant_xxx` já bloqueiam cross-tenant via `tenant_id = get_user_tenant_id()`
-- em cada tabela isoladamente, mas nada impedia (por RLS) uma linha A apontar por FK pra
-- uma linha B de OUTRA loja com o MESMO `tenant_id` gravado em A — mesma classe de bug já
-- fechada em `enforce_empresa_tenant`/`enforce_representante_tenant` (fornecedor de outra
-- loja vinculado em OC) e `enforce_pv_itens_tenant` (OTB). Aqui fechamos o mesmo furo pros
-- 2 vínculos novos desta feature.

CREATE OR REPLACE FUNCTION public.enforce_produto_acabado_modelo_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_modelo_tenant uuid;
begin
  if NEW.modelo_id is not null then
    select tenant_id into v_modelo_tenant from public.modelos where id = NEW.modelo_id;
    if v_modelo_tenant is distinct from NEW.tenant_id then
      raise exception 'Modelo de outra loja não pode ser vinculado aqui.';
    end if;
  end if;
  return NEW;
end $function$;

DROP TRIGGER IF EXISTS trg_pa_modelo_tenant ON public.produtos_acabados;
CREATE TRIGGER trg_pa_modelo_tenant
  BEFORE INSERT OR UPDATE OF modelo_id ON public.produtos_acabados
  FOR EACH ROW EXECUTE FUNCTION public.enforce_produto_acabado_modelo_tenant();

CREATE OR REPLACE FUNCTION public.enforce_oc_pa_produto_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_produto_tenant uuid;
begin
  if NEW.produto_acabado_id is not null then
    select tenant_id into v_produto_tenant from public.produtos_acabados where id = NEW.produto_acabado_id;
    if v_produto_tenant is distinct from NEW.tenant_id then
      raise exception 'Produto acabado de outra loja não pode ser vinculado aqui.';
    end if;
  end if;
  return NEW;
end $function$;

DROP TRIGGER IF EXISTS trg_ocpa_produto_tenant ON public.ocs_p_acabado;
CREATE TRIGGER trg_ocpa_produto_tenant
  BEFORE INSERT OR UPDATE OF produto_acabado_id ON public.ocs_p_acabado
  FOR EACH ROW EXECUTE FUNCTION public.enforce_oc_pa_produto_tenant();
