
-- ============ SYSTEM TABLES ============
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome VARCHAR(255) NOT NULL,
  cnpj VARCHAR(18),
  logo_url TEXT,
  contato TEXT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'user',
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated;
GRANT ALL ON public.users TO service_role;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id),
  pagina VARCHAR(255) NOT NULL,
  pode_ver BOOLEAN DEFAULT false,
  pode_editar BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, pagina)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_permissions TO authenticated;
GRANT ALL ON public.user_permissions TO service_role;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.tenant_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) UNIQUE,
  usa_pl BOOLEAN DEFAULT true,
  corte_interno BOOLEAN DEFAULT false,
  oficina_interna BOOLEAN DEFAULT false,
  oficina_posicao VARCHAR(50) DEFAULT 'terceirizados',
  formato_mes VARCHAR(50) DEFAULT 'numeral',
  etapas_acabamento JSONB DEFAULT '["caseado","botao","passadoria"]',
  tamanhos_grade JSONB DEFAULT '["34|PPP","36|PP","38|P","40|M","42|G","44|GG"]',
  status_kanban JSONB DEFAULT '["Em Modelagem","Corte de Piloto I","Corte de Piloto II","Corte de Piloto III","Em Pilotagem","Prova de Roupa I","Prova de Roupa II","Prova de Roupa III","Prova de Roupa IV","Prova de Roupa V","Em Ajuste","Stand By","Reprovado","Aprovado"]',
  campos_editaveis JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_config TO authenticated;
GRANT ALL ON public.tenant_config TO service_role;
ALTER TABLE public.tenant_config ENABLE ROW LEVEL SECURITY;

-- ============ MÓDULO 1: CADASTRO ============
CREATE TABLE public.cores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, nome)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cores TO authenticated;
GRANT ALL ON public.cores TO service_role;
ALTER TABLE public.cores ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.anos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  ano VARCHAR(10) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, ano)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anos TO authenticated;
GRANT ALL ON public.anos TO service_role;
ALTER TABLE public.anos ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.meses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  mes VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, mes)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meses TO authenticated;
GRANT ALL ON public.meses TO service_role;
ALTER TABLE public.meses ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.categorias_fornecedor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, nome)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categorias_fornecedor TO authenticated;
GRANT ALL ON public.categorias_fornecedor TO service_role;
ALTER TABLE public.categorias_fornecedor ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.categorias_tecido (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, nome)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categorias_tecido TO authenticated;
GRANT ALL ON public.categorias_tecido TO service_role;
ALTER TABLE public.categorias_tecido ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.categorias_aviamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, nome)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categorias_aviamento TO authenticated;
GRANT ALL ON public.categorias_aviamento TO service_role;
ALTER TABLE public.categorias_aviamento ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.subcategorias_aviamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  categoria_aviamento_id UUID REFERENCES public.categorias_aviamento(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, nome)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcategorias_aviamento TO authenticated;
GRANT ALL ON public.subcategorias_aviamento TO service_role;
ALTER TABLE public.subcategorias_aviamento ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.materiais_aviamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, nome)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.materiais_aviamento TO authenticated;
GRANT ALL ON public.materiais_aviamento TO service_role;
ALTER TABLE public.materiais_aviamento ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.intervalos_largura (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  intervalo VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, intervalo)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intervalos_largura TO authenticated;
GRANT ALL ON public.intervalos_largura TO service_role;
ALTER TABLE public.intervalos_largura ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.categorias_produto (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, nome)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categorias_produto TO authenticated;
GRANT ALL ON public.categorias_produto TO service_role;
ALTER TABLE public.categorias_produto ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.linhas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, nome)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.linhas TO authenticated;
GRANT ALL ON public.linhas TO service_role;
ALTER TABLE public.linhas ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.categorias_terceirizado (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, nome)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categorias_terceirizado TO authenticated;
GRANT ALL ON public.categorias_terceirizado TO service_role;
ALTER TABLE public.categorias_terceirizado ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.colaboradores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  tipo VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.colaboradores TO authenticated;
GRANT ALL ON public.colaboradores TO service_role;
ALTER TABLE public.colaboradores ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.empresas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome_fantasia VARCHAR(255) NOT NULL,
  categoria_fornecedor_id UUID REFERENCES public.categorias_fornecedor(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.empresas TO authenticated;
GRANT ALL ON public.empresas TO service_role;
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.representantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  empresa_id UUID REFERENCES public.empresas(id),
  nome VARCHAR(255),
  cnpj VARCHAR(18),
  razao_social VARCHAR(255),
  logradouro TEXT,
  contato VARCHAR(50),
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.representantes TO authenticated;
GRANT ALL ON public.representantes TO service_role;
ALTER TABLE public.representantes ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.terceirizados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome_responsavel VARCHAR(255) NOT NULL,
  categoria_terceirizado_id UUID REFERENCES public.categorias_terceirizado(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.terceirizados TO authenticated;
GRANT ALL ON public.terceirizados TO service_role;
ALTER TABLE public.terceirizados ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.artigos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  empresa_id UUID REFERENCES public.empresas(id),
  largura_estimada NUMERIC(10,2),
  categoria_tecido_id UUID REFERENCES public.categorias_tecido(id),
  composicao TEXT,
  mes_id UUID REFERENCES public.meses(id),
  ano_id UUID REFERENCES public.anos(id),
  preco NUMERIC(10,2),
  rendimento NUMERIC(10,4),
  preco_por_metro NUMERIC(10,2),
  unidade_medida VARCHAR(10) NOT NULL DEFAULT 'metro',
  historico_precos JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.artigos TO authenticated;
GRANT ALL ON public.artigos TO service_role;
ALTER TABLE public.artigos ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.variantes_tecido (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  artigo_id UUID REFERENCES public.artigos(id) ON DELETE CASCADE,
  cor_id UUID REFERENCES public.cores(id),
  nome_variante VARCHAR(255),
  codigo_variante VARCHAR(100),
  foto_url TEXT,
  rua VARCHAR(50),
  prateleira VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.variantes_tecido TO authenticated;
GRANT ALL ON public.variantes_tecido TO service_role;
ALTER TABLE public.variantes_tecido ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.aviamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  codigo_nome VARCHAR(255) NOT NULL,
  empresa_id UUID REFERENCES public.empresas(id),
  categoria_aviamento_id UUID REFERENCES public.categorias_aviamento(id),
  subcategoria_aviamento_id UUID REFERENCES public.subcategorias_aviamento(id),
  material_aviamento_id UUID REFERENCES public.materiais_aviamento(id),
  composicao TEXT,
  preco NUMERIC(10,2),
  intervalo_largura_id UUID REFERENCES public.intervalos_largura(id),
  largura_exata NUMERIC(10,2),
  intervalo_vazado_id UUID REFERENCES public.intervalos_largura(id),
  largura_exata_vazado NUMERIC(10,2),
  foto_url TEXT,
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aviamentos TO authenticated;
GRANT ALL ON public.aviamentos TO service_role;
ALTER TABLE public.aviamentos ENABLE ROW LEVEL SECURITY;

-- ============ HELPERS (created AFTER public.users exists) ============
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.users WHERE id = auth.uid()
$$;
REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_tenant_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.get_user_tenant_id();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_tenant_id() FROM PUBLIC, anon, authenticated;

-- ============ AUTO-FILL tenant_id TRIGGERS ============
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'tenant_config','cores','anos','meses','categorias_fornecedor','categorias_tecido',
    'categorias_aviamento','subcategorias_aviamento','materiais_aviamento','intervalos_largura',
    'categorias_produto','linhas','categorias_terceirizado','colaboradores','empresas',
    'representantes','terceirizados','artigos','variantes_tecido','aviamentos','user_permissions'
  ])
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id()', t
    );
  END LOOP;
END $$;

-- ============ RLS POLICIES ============

CREATE POLICY "View own tenant" ON public.tenants FOR SELECT TO authenticated
  USING (id = public.get_user_tenant_id());
CREATE POLICY "Insert tenant" ON public.tenants FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Update own tenant" ON public.tenants FOR UPDATE TO authenticated
  USING (id = public.get_user_tenant_id())
  WITH CHECK (id = public.get_user_tenant_id());
CREATE POLICY "Delete own tenant" ON public.tenants FOR DELETE TO authenticated
  USING (id = public.get_user_tenant_id());

CREATE POLICY "View users same tenant" ON public.users FOR SELECT TO authenticated
  USING (id = auth.uid() OR tenant_id = public.get_user_tenant_id());
CREATE POLICY "Insert self user" ON public.users FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "Update users same tenant" ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid() OR tenant_id = public.get_user_tenant_id())
  WITH CHECK (id = auth.uid() OR tenant_id = public.get_user_tenant_id());
CREATE POLICY "Delete users same tenant" ON public.users FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'tenant_config','cores','anos','meses','categorias_fornecedor','categorias_tecido',
    'categorias_aviamento','subcategorias_aviamento','materiais_aviamento','intervalos_largura',
    'categorias_produto','linhas','categorias_terceirizado','colaboradores','empresas',
    'representantes','terceirizados','artigos','variantes_tecido','aviamentos','user_permissions'
  ])
  LOOP
    EXECUTE format('CREATE POLICY "tenant_select" ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id())', t);
    EXECUTE format('CREATE POLICY "tenant_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id() OR tenant_id IS NULL)', t);
    EXECUTE format('CREATE POLICY "tenant_update" ON public.%I FOR UPDATE TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id())', t);
    EXECUTE format('CREATE POLICY "tenant_delete" ON public.%I FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id())', t);
  END LOOP;
END $$;
