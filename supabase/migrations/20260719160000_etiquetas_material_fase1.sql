-- TAG/Etiquetas como material completo — FASE 1 (schema).
-- Estende `etiquetas` (unidade/fornecedor/preço) + `variantes_etiqueta` (matriz tamanho×cor,
-- preço por variante, base = MAX igual artigo/tecido) + `modelo_etiquetas` (BOM, espelha
-- modelo_aviamentos; cor escolhida no modelo). Ver docs/etiquetas-material-completo-design.md.

BEGIN;

-- 1) Cadastro rico: colunas novas em `etiquetas` (a coluna `tamanho` vira legada).
ALTER TABLE public.etiquetas
  ADD COLUMN IF NOT EXISTS unidade text NOT NULL DEFAULT 'unidade',  -- unidade|metro|rolo|milheiro
  ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES public.empresas(id),
  ADD COLUMN IF NOT EXISTS representante_id uuid REFERENCES public.representantes(id),
  ADD COLUMN IF NOT EXISTS preco numeric(10,2),
  ADD COLUMN IF NOT EXISTS observacoes text,
  ADD COLUMN IF NOT EXISTS foto_url text;

-- 2) Variantes por tamanho × cor.
CREATE TABLE IF NOT EXISTS public.variantes_etiqueta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id),
  etiqueta_id uuid NOT NULL REFERENCES public.etiquetas(id) ON DELETE CASCADE,
  tamanho text,                                    -- "38|P" (da grade); NULL = sem tamanho
  cor_id uuid REFERENCES public.cores(id),         -- cor da etiqueta; NULL = sem cor
  preco numeric(10,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Uma variante por combinação (NULLs contam via sentinelas).
CREATE UNIQUE INDEX IF NOT EXISTS ux_variantes_etiqueta_combo ON public.variantes_etiqueta
  (etiqueta_id, COALESCE(tamanho,''), COALESCE(cor_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS ix_variantes_etiqueta_etiqueta ON public.variantes_etiqueta (etiqueta_id);

ALTER TABLE public.variantes_etiqueta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON public.variantes_etiqueta;
DROP POLICY IF EXISTS tenant_insert ON public.variantes_etiqueta;
DROP POLICY IF EXISTS tenant_update ON public.variantes_etiqueta;
DROP POLICY IF EXISTS tenant_delete ON public.variantes_etiqueta;
CREATE POLICY tenant_select ON public.variantes_etiqueta FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY tenant_insert ON public.variantes_etiqueta FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY tenant_update ON public.variantes_etiqueta FOR UPDATE USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY tenant_delete ON public.variantes_etiqueta FOR DELETE USING (tenant_id = public.get_user_tenant_id());

DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.variantes_etiqueta;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.variantes_etiqueta
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.variantes_etiqueta TO authenticated;

-- Preço base da etiqueta = MAX das variantes (espelha variantes_tecido_sync_artigo_preco).
CREATE OR REPLACE FUNCTION public.variantes_etiqueta_sync_preco()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_etq uuid; v_max numeric;
BEGIN
  v_etq := COALESCE(NEW.etiqueta_id, OLD.etiqueta_id);
  SELECT MAX(preco) INTO v_max FROM public.variantes_etiqueta WHERE etiqueta_id = v_etq AND preco IS NOT NULL;
  IF v_max IS NOT NULL THEN
    UPDATE public.etiquetas SET preco = v_max WHERE id = v_etq AND preco IS DISTINCT FROM v_max;
  END IF;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS trg_variantes_etiqueta_sync_preco ON public.variantes_etiqueta;
CREATE TRIGGER trg_variantes_etiqueta_sync_preco AFTER INSERT OR UPDATE OR DELETE ON public.variantes_etiqueta
  FOR EACH ROW EXECUTE FUNCTION public.variantes_etiqueta_sync_preco();

-- 3) BOM: etiquetas por modelo (espelha modelo_aviamentos; cor escolhida no modelo).
CREATE TABLE IF NOT EXISTS public.modelo_etiquetas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id),
  modelo_id uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  etiqueta_id uuid REFERENCES public.etiquetas(id),
  cor_id uuid REFERENCES public.cores(id),          -- cor escolhida no modelo
  numero int,
  consumo numeric(10,4),
  loss_percent numeric(10,2),
  custo_previsto numeric(10,2),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_modelo_etiquetas_modelo ON public.modelo_etiquetas (modelo_id);

ALTER TABLE public.modelo_etiquetas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS child_all_modelo_etiquetas ON public.modelo_etiquetas;
DROP POLICY IF EXISTS modgate_ins ON public.modelo_etiquetas;
DROP POLICY IF EXISTS modgate_upd ON public.modelo_etiquetas;
DROP POLICY IF EXISTS modgate_del ON public.modelo_etiquetas;
CREATE POLICY child_all_modelo_etiquetas ON public.modelo_etiquetas FOR ALL
  USING (EXISTS (SELECT 1 FROM public.modelos p WHERE p.id = modelo_etiquetas.modelo_id AND p.tenant_id = public.get_user_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.modelos p WHERE p.id = modelo_etiquetas.modelo_id AND p.tenant_id = public.get_user_tenant_id()));
CREATE POLICY modgate_ins ON public.modelo_etiquetas AS RESTRICTIVE FOR INSERT WITH CHECK (public.tenant_module_enabled('criacao'));
CREATE POLICY modgate_upd ON public.modelo_etiquetas AS RESTRICTIVE FOR UPDATE USING (public.tenant_module_enabled('criacao'));
CREATE POLICY modgate_del ON public.modelo_etiquetas AS RESTRICTIVE FOR DELETE USING (public.tenant_module_enabled('criacao'));

DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.modelo_etiquetas;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.modelo_etiquetas
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.modelo_etiquetas TO authenticated;

COMMIT;

select pg_notify('pgrst','reload schema');
