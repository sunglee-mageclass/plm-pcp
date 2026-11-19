BEGIN;

-- Evita travar o app se houver transacao longa segurando artigo_categorias_tecido (ALTER TABLE/CREATE TRIGGER pedem lock).
SET LOCAL lock_timeout = '5s';

-- Subcategoria de tecido (molde de subcategorias_aviamento). Pertence a uma categoria de tecido.
CREATE TABLE IF NOT EXISTS public.subcategorias_tecido (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  categoria_tecido_id UUID NOT NULL REFERENCES public.categorias_tecido(id) ON DELETE CASCADE,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, categoria_tecido_id, nome)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcategorias_tecido TO authenticated;
GRANT ALL ON public.subcategorias_tecido TO service_role;
ALTER TABLE public.subcategorias_tecido ENABLE ROW LEVEL SECURITY;

-- set_tenant_id ao inserir (mesmo gatilho generico que as outras tabelas de atributo usam).
CREATE OR REPLACE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.subcategorias_tecido
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

-- RLS: espelha EXATAMENTE o molde subcategorias_aviamento (tenant + permissao por atributo cadastro_atributos:<attr>).
-- SELECT so tenant; INSERT aceita tenant_id NULL (o gatilho set_tenant_id preenche); escrita exige user_can_edit.
DROP POLICY IF EXISTS "tenant select subtec" ON public.subcategorias_tecido;
DROP POLICY IF EXISTS "tenant insert subtec" ON public.subcategorias_tecido;
DROP POLICY IF EXISTS "tenant update subtec" ON public.subcategorias_tecido;
DROP POLICY IF EXISTS "tenant delete subtec" ON public.subcategorias_tecido;
DROP POLICY IF EXISTS "tenant_select" ON public.subcategorias_tecido;
DROP POLICY IF EXISTS "tenant_insert" ON public.subcategorias_tecido;
DROP POLICY IF EXISTS "tenant_update" ON public.subcategorias_tecido;
DROP POLICY IF EXISTS "tenant_delete" ON public.subcategorias_tecido;
CREATE POLICY "tenant_select" ON public.subcategorias_tecido FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant_insert" ON public.subcategorias_tecido FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = public.get_user_tenant_id()) OR (tenant_id IS NULL)) AND public.user_can_edit('cadastro_atributos:subcat_tecido'));
CREATE POLICY "tenant_update" ON public.subcategorias_tecido FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.user_can_edit('cadastro_atributos:subcat_tecido'))
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.user_can_edit('cadastro_atributos:subcat_tecido'));
CREATE POLICY "tenant_delete" ON public.subcategorias_tecido FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.user_can_edit('cadastro_atributos:subcat_tecido'));

CREATE INDEX IF NOT EXISTS idx_subtec_tenant ON public.subcategorias_tecido(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subtec_categoria ON public.subcategorias_tecido(categoria_tecido_id);

-- A sub escolhida para o par (tecido, categoria). ON DELETE SET NULL: apagar a sub nao apaga o vinculo.
ALTER TABLE public.artigo_categorias_tecido
  ADD COLUMN IF NOT EXISTS subcategoria_tecido_id UUID REFERENCES public.subcategorias_tecido(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_act_subtec ON public.artigo_categorias_tecido(subcategoria_tecido_id) WHERE subcategoria_tecido_id IS NOT NULL;

-- A sub (se houver) tem de pertencer a MESMA categoria do par. Fecha o furo de sub de outra categoria por API.
CREATE OR REPLACE FUNCTION public.fn_act_sub_mesma_categoria() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_cat uuid;
BEGIN
  IF NEW.subcategoria_tecido_id IS NULL THEN RETURN NEW; END IF;
  SELECT categoria_tecido_id INTO v_cat FROM public.subcategorias_tecido WHERE id = NEW.subcategoria_tecido_id;
  IF v_cat IS DISTINCT FROM NEW.categoria_tecido_id THEN
    RAISE EXCEPTION 'subcategoria_categoria_diferente' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_act_sub_mesma_categoria() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_act_sub_mesma_categoria ON public.artigo_categorias_tecido;
CREATE TRIGGER trg_act_sub_mesma_categoria BEFORE INSERT OR UPDATE OF subcategoria_tecido_id, categoria_tecido_id
  ON public.artigo_categorias_tecido FOR EACH ROW EXECUTE FUNCTION public.fn_act_sub_mesma_categoria();

-- Backfill da permissao da section nova (espelha 20260908280000_atributos_permissao_por_atributo.sql): quem ja podia
-- EDITAR a pagina-mae cadastro_atributos ganha cadastro_atributos:subcat_tecido (senao perderia acesso ao atributo novo
-- quando a RLS passa a exigir user_can_edit). Idempotente: ON CONFLICT DO NOTHING (nao sobrescreve excecao ja existente).
INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT up.user_id, up.tenant_id, 'cadastro_atributos:subcat_tecido', true, true
FROM public.user_permissions up
WHERE up.pagina = 'cadastro_atributos' AND up.pode_editar = true
ON CONFLICT (user_id, pagina) DO NOTHING;

INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT pp.papel_id, pp.tenant_id, 'cadastro_atributos:subcat_tecido', true, true
FROM public.papel_permissoes pp
WHERE pp.pagina = 'cadastro_atributos' AND pp.pode_editar = true
ON CONFLICT (papel_id, pagina) DO NOTHING;

COMMIT;
