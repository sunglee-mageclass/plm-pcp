-- Fase 5: Ordem de Saída manual (modo só-estoque) + cadastro de Destinos.
-- Espelha a Ordem de Compra: OS Tecido e OS Aviamento separadas. A loja só-estoque
-- não tem CAD, então a baixa de estoque é lançada manualmente por estas ordens.

-- Cadastro de destinos da saída (Novidade, Repetição, etc.) — cadastrável por loja.
CREATE TABLE IF NOT EXISTS public.destinos_saida (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, nome)
);

-- OS Tecido — cabeçalho.
CREATE TABLE IF NOT EXISTS public.ordens_saida_tecido (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  numero INTEGER,
  responsavel VARCHAR(255),
  data_solicitacao DATE,
  data_corte DATE,
  destino_id UUID REFERENCES public.destinos_saida(id),
  baixado BOOLEAN NOT NULL DEFAULT false,
  observacao TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT now()
);
-- OS Tecido — itens (reserva digitada na criação; baixa = "utilizado" ao confirmar).
CREATE TABLE IF NOT EXISTS public.ordens_saida_tecido_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  ordem_saida_id UUID NOT NULL REFERENCES public.ordens_saida_tecido(id) ON DELETE CASCADE,
  variante_tecido_id UUID REFERENCES public.variantes_tecido(id),
  reserva NUMERIC(12,3) DEFAULT 0,
  baixa NUMERIC(12,3) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- OS Aviamento — cabeçalho.
CREATE TABLE IF NOT EXISTS public.ordens_saida_aviamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  numero INTEGER,
  responsavel VARCHAR(255),
  data_solicitacao DATE,
  data_corte DATE,
  destino_id UUID REFERENCES public.destinos_saida(id),
  baixado BOOLEAN NOT NULL DEFAULT false,
  observacao TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT now()
);
-- OS Aviamento — itens.
CREATE TABLE IF NOT EXISTS public.ordens_saida_aviamento_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  ordem_saida_id UUID NOT NULL REFERENCES public.ordens_saida_aviamento(id) ON DELETE CASCADE,
  aviamento_id UUID REFERENCES public.aviamentos(id),
  reserva NUMERIC(12,3) DEFAULT 0,
  baixa NUMERIC(12,3) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Índices p/ os FKs mais consultados (agregação por variante/aviamento no estoque).
CREATE INDEX IF NOT EXISTS idx_ost_itens_ordem ON public.ordens_saida_tecido_itens(ordem_saida_id);
CREATE INDEX IF NOT EXISTS idx_ost_itens_variante ON public.ordens_saida_tecido_itens(variante_tecido_id);
CREATE INDEX IF NOT EXISTS idx_osa_itens_ordem ON public.ordens_saida_aviamento_itens(ordem_saida_id);
CREATE INDEX IF NOT EXISTS idx_osa_itens_aviamento ON public.ordens_saida_aviamento_itens(aviamento_id);

-- Grants + RLS + policies tenant + trigger set_tenant_id (padrão do projeto). Idempotente.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'destinos_saida','ordens_saida_tecido','ordens_saida_tecido_itens',
    'ordens_saida_aviamento','ordens_saida_aviamento_itens'
  ])
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "tenant_select" ON public.%I', t);
    EXECUTE format('CREATE POLICY "tenant_select" ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS "tenant_insert" ON public.%I', t);
    EXECUTE format('CREATE POLICY "tenant_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id() OR tenant_id IS NULL)', t);
    EXECUTE format('DROP POLICY IF EXISTS "tenant_update" ON public.%I', t);
    EXECUTE format('CREATE POLICY "tenant_update" ON public.%I FOR UPDATE TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS "tenant_delete" ON public.%I', t);
    EXECUTE format('CREATE POLICY "tenant_delete" ON public.%I FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id())', t);
    EXECUTE format('DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id()', t);
  END LOOP;
END $$;
