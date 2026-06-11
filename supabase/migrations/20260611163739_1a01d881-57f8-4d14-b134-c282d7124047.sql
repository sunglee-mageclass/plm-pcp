
-- MÓDULO 2: ENTRADA E SAÍDA
CREATE TABLE public.ocs_tecido (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  numero_pedido VARCHAR(50),
  responsavel_id UUID REFERENCES public.colaboradores(id),
  responsavel_nome VARCHAR(255),
  empresa_id UUID REFERENCES public.empresas(id),
  data_pedido DATE,
  data_prevista_entrega DATE,
  data_entrega DATE,
  prazo_pagamento VARCHAR(255),
  quantidade_prazos INTEGER,
  modelo_sugerido_url TEXT,
  observacoes_entrega TEXT,
  observacoes_defeitos TEXT,
  anexo_pedido_url TEXT,
  nf_url TEXT,
  etiqueta_lavagem_urls TEXT[],
  status VARCHAR(20) DEFAULT 'encomendado',
  valor_previsto_total NUMERIC(12,2),
  valor_real_total NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.ocs_tecido_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oc_tecido_id UUID REFERENCES public.ocs_tecido(id) ON DELETE CASCADE,
  artigo_id UUID REFERENCES public.artigos(id),
  artigo_numero INTEGER DEFAULT 1,
  variante_tecido_id UUID REFERENCES public.variantes_tecido(id),
  quantidade_pedida NUMERIC(10,2),
  quantidade_recebida NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.ocs_aviamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  numero_pedido VARCHAR(50),
  responsavel_nome VARCHAR(255),
  empresa_id UUID REFERENCES public.empresas(id),
  data_pedido DATE,
  data_prevista_entrega DATE,
  data_entrega DATE,
  prazo_pagamento VARCHAR(255),
  quantidade_prazos INTEGER,
  nf_url TEXT,
  status VARCHAR(20) DEFAULT 'encomendado',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.ocs_aviamento_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oc_aviamento_id UUID REFERENCES public.ocs_aviamento(id) ON DELETE CASCADE,
  aviamento_id UUID REFERENCES public.aviamentos(id),
  quantidade_pedida NUMERIC(10,2),
  quantidade_recebida NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- MÓDULO 3: CRIAÇÃO
CREATE TABLE public.modelos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  ref VARCHAR(100),
  estilista_id UUID REFERENCES public.colaboradores(id),
  colecao VARCHAR(255),
  semana VARCHAR(50),
  mes_id UUID REFERENCES public.meses(id),
  ano_id UUID REFERENCES public.anos(id),
  categoria_principal_id UUID REFERENCES public.categorias_produto(id),
  categoria_secundaria_id UUID REFERENCES public.categorias_produto(id),
  linha_id UUID REFERENCES public.linhas(id),
  modelista_id UUID REFERENCES public.colaboradores(id),
  piloteiro1_id UUID REFERENCES public.colaboradores(id),
  piloteiro2_id UUID REFERENCES public.colaboradores(id),
  piloteiro3_id UUID REFERENCES public.colaboradores(id),
  data_piloto1 DATE,
  data_piloto2 DATE,
  data_piloto3 DATE,
  data_desenho_tecnico DATE,
  data_aprovacao DATE,
  status_planejamento VARCHAR(50) DEFAULT 'em_planejamento',
  status_desenvolvimento VARCHAR(100),
  motivo_cancelamento TEXT,
  ajustes_prova TEXT,
  observacoes_tecnicas TEXT,
  observacoes_gerais TEXT,
  fotos_modelo TEXT[],
  fotos_referencia TEXT[],
  ficha_medida_url TEXT,
  enviado_cad BOOLEAN DEFAULT false,
  proporcoes JSONB DEFAULT '{}',
  custo_tecido_total NUMERIC(10,2),
  custo_aviamento_total NUMERIC(10,2),
  custo_forro_total NUMERIC(10,2),
  custo_entretela_total NUMERIC(10,2),
  custo_terceirizados_previsto NUMERIC(10,2),
  custo_peca_previsto NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.modelo_tecidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id UUID REFERENCES public.modelos(id) ON DELETE CASCADE,
  artigo_id UUID REFERENCES public.artigos(id),
  numero INTEGER NOT NULL,
  tipo VARCHAR(20) NOT NULL DEFAULT 'tecido',
  consumo NUMERIC(10,4),
  loss_percent NUMERIC(5,2),
  custo_previsto NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.modelo_tecido_variantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_tecido_id UUID REFERENCES public.modelo_tecidos(id) ON DELETE CASCADE,
  variante_tecido_id UUID REFERENCES public.variantes_tecido(id),
  ordem INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.modelo_aviamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id UUID REFERENCES public.modelos(id) ON DELETE CASCADE,
  aviamento_id UUID REFERENCES public.aviamentos(id),
  numero INTEGER NOT NULL,
  consumo NUMERIC(10,4),
  loss_percent NUMERIC(5,2),
  custo_previsto NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.modelo_grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id UUID REFERENCES public.modelos(id) ON DELETE CASCADE,
  variante_numero INTEGER NOT NULL,
  grades JSONB NOT NULL,
  grade_total INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- MÓDULO 4: PRODUÇÃO
CREATE TABLE public.cad (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  modelo_id UUID REFERENCES public.modelos(id),
  proporcoes_replanejadas JSONB DEFAULT '{}',
  enviado_corte BOOLEAN DEFAULT false,
  data_enviado_corte DATE,
  data_previsao_corte DATE,
  data_corte_pronto DATE,
  status_corte VARCHAR(50),
  observacoes_tecnicas TEXT,
  ficha_medida_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.cad_tecidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cad_id UUID REFERENCES public.cad(id) ON DELETE CASCADE,
  artigo_id UUID REFERENCES public.artigos(id),
  numero INTEGER NOT NULL,
  tipo VARCHAR(20) NOT NULL DEFAULT 'tecido',
  consumo_cad NUMERIC(10,4),
  loss_percent_cad NUMERIC(5,2),
  custo_cad NUMERIC(10,2),
  tamanho_folha NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.cad_tecido_variantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cad_tecido_id UUID REFERENCES public.cad_tecidos(id) ON DELETE CASCADE,
  variante_tecido_id UUID REFERENCES public.variantes_tecido(id),
  ordem INTEGER NOT NULL,
  quantidade_folhas INTEGER,
  metragem_planejada NUMERIC(10,2),
  metragem_enviada NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.cad_grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cad_id UUID REFERENCES public.cad(id) ON DELETE CASCADE,
  variante_numero INTEGER NOT NULL,
  grades_planejadas JSONB NOT NULL,
  grades_reais JSONB,
  grade_total_planejada INTEGER,
  grade_total_real INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.cad_aviamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cad_id UUID REFERENCES public.cad(id) ON DELETE CASCADE,
  aviamento_id UUID REFERENCES public.aviamentos(id),
  numero INTEGER NOT NULL,
  consumo NUMERIC(10,4),
  quantidade_enviar NUMERIC(10,2),
  quantidade_separar NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.producao_terceirizados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cad_id UUID REFERENCES public.cad(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id),
  categoria_terceirizado_id UUID REFERENCES public.categorias_terceirizado(id),
  terceirizado_id UUID REFERENCES public.terceirizados(id),
  ativo BOOLEAN DEFAULT false,
  preco_metro_unidade NUMERIC(10,2),
  quantidade_enviada INTEGER,
  quantidade_recebida INTEGER,
  quantidade_defeito INTEGER,
  data_enviado DATE,
  data_prevista DATE,
  data_entregue DATE,
  status VARCHAR(50) DEFAULT 'pendente',
  observacao TEXT,
  aviamentos_enviados JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.producao_oficina (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cad_id UUID REFERENCES public.cad(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id),
  terceirizado_id UUID REFERENCES public.terceirizados(id),
  preco_por_peca NUMERIC(10,2),
  quantidade_enviada INTEGER,
  quantidade_recebida INTEGER,
  quantidade_defeito INTEGER,
  data_enviado DATE,
  data_prevista DATE,
  data_entregue DATE,
  status VARCHAR(50) DEFAULT 'pendente',
  observacao TEXT,
  observacoes_molde TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.controle_qualidade (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cad_id UUID REFERENCES public.cad(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id),
  observacoes_cq TEXT,
  pecas_incompletas INTEGER DEFAULT 0,
  pecas_faltantes INTEGER DEFAULT 0,
  pecas_sem_etiqueta INTEGER DEFAULT 0,
  data_conserto_enviado DATE,
  data_conserto_prevista DATE,
  data_conserto_entregue DATE,
  data_lavagem_enviado DATE,
  data_lavagem_entregue DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.cq_variantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  controle_qualidade_id UUID REFERENCES public.controle_qualidade(id) ON DELETE CASCADE,
  variante_numero INTEGER NOT NULL,
  etapa VARCHAR(20) NOT NULL,
  grades JSONB NOT NULL,
  grade_total INTEGER,
  destino_defeito VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.producao_acabamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cad_id UUID REFERENCES public.cad(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id),
  tipo VARCHAR(50) NOT NULL,
  ativo BOOLEAN DEFAULT false,
  terceirizado_id UUID REFERENCES public.terceirizados(id),
  preco_por_peca NUMERIC(10,2),
  quantidade_enviada INTEGER,
  quantidade_recebida INTEGER,
  quantidade_defeito INTEGER,
  data_enviado DATE,
  data_prevista DATE,
  data_entregue DATE,
  status VARCHAR(50) DEFAULT 'pendente',
  observacao TEXT,
  aviamentos_utilizados JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.direcionamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cad_id UUID REFERENCES public.cad(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id),
  variante_numero INTEGER NOT NULL,
  ecommerce JSONB DEFAULT '{}',
  ecommerce_total INTEGER,
  loja_fisica JSONB DEFAULT '{}',
  loja_fisica_total INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.lancamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cad_id UUID REFERENCES public.cad(id),
  modelo_id UUID REFERENCES public.modelos(id),
  tenant_id UUID REFERENCES public.tenants(id),
  data_lancamento DATE,
  mes_lancamento VARCHAR(50),
  ano_lancamento VARCHAR(10),
  semana_lancamento VARCHAR(50),
  verificado BOOLEAN DEFAULT false,
  foto_peca_amostra TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- MÓDULO 5: FINANCEIRO
CREATE TABLE public.parcelas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  tipo_oc VARCHAR(20) NOT NULL,
  oc_tecido_id UUID REFERENCES public.ocs_tecido(id),
  oc_aviamento_id UUID REFERENCES public.ocs_aviamento(id),
  empresa_id UUID REFERENCES public.empresas(id),
  numero_parcela INTEGER NOT NULL,
  valor NUMERIC(12,2) NOT NULL,
  data_vencimento DATE NOT NULL,
  data_pagamento DATE,
  status VARCHAR(20) DEFAULT 'a_pagar',
  comprovante_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- GRANTs + RLS + Policies + tenant trigger for all tables
DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'ocs_tecido','ocs_aviamento','modelos','cad',
    'producao_terceirizados','producao_oficina','controle_qualidade',
    'producao_acabamento','direcionamento','lancamentos','parcelas'
  ];
  child_tables TEXT[] := ARRAY[
    'ocs_tecido_itens','ocs_aviamento_itens',
    'modelo_tecidos','modelo_tecido_variantes','modelo_aviamentos','modelo_grades',
    'cad_tecidos','cad_tecido_variantes','cad_grades','cad_aviamentos','cq_variantes'
  ];
  all_tables TEXT[];
BEGIN
  all_tables := tenant_tables || child_tables;

  FOREACH t IN ARRAY all_tables LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;

  -- Tenant-scoped policies + auto-set trigger
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('CREATE POLICY "tenant_select" ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id())', t);
    EXECUTE format('CREATE POLICY "tenant_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id())', t);
    EXECUTE format('CREATE POLICY "tenant_update" ON public.%I FOR UPDATE TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id())', t);
    EXECUTE format('CREATE POLICY "tenant_delete" ON public.%I FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id())', t);
    EXECUTE format('CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id()', t);
  END LOOP;
END $$;

-- Child tables: access mediated by parent tenant via FK
CREATE POLICY "child_all_ocs_tecido_itens" ON public.ocs_tecido_itens FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ocs_tecido p WHERE p.id = oc_tecido_id AND p.tenant_id = public.get_user_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ocs_tecido p WHERE p.id = oc_tecido_id AND p.tenant_id = public.get_user_tenant_id()));

CREATE POLICY "child_all_ocs_aviamento_itens" ON public.ocs_aviamento_itens FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ocs_aviamento p WHERE p.id = oc_aviamento_id AND p.tenant_id = public.get_user_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ocs_aviamento p WHERE p.id = oc_aviamento_id AND p.tenant_id = public.get_user_tenant_id()));

CREATE POLICY "child_all_modelo_tecidos" ON public.modelo_tecidos FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.modelos p WHERE p.id = modelo_id AND p.tenant_id = public.get_user_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.modelos p WHERE p.id = modelo_id AND p.tenant_id = public.get_user_tenant_id()));

CREATE POLICY "child_all_modelo_tecido_variantes" ON public.modelo_tecido_variantes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.modelo_tecidos mt JOIN public.modelos p ON p.id = mt.modelo_id WHERE mt.id = modelo_tecido_id AND p.tenant_id = public.get_user_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.modelo_tecidos mt JOIN public.modelos p ON p.id = mt.modelo_id WHERE mt.id = modelo_tecido_id AND p.tenant_id = public.get_user_tenant_id()));

CREATE POLICY "child_all_modelo_aviamentos" ON public.modelo_aviamentos FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.modelos p WHERE p.id = modelo_id AND p.tenant_id = public.get_user_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.modelos p WHERE p.id = modelo_id AND p.tenant_id = public.get_user_tenant_id()));

CREATE POLICY "child_all_modelo_grades" ON public.modelo_grades FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.modelos p WHERE p.id = modelo_id AND p.tenant_id = public.get_user_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.modelos p WHERE p.id = modelo_id AND p.tenant_id = public.get_user_tenant_id()));

CREATE POLICY "child_all_cad_tecidos" ON public.cad_tecidos FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cad p WHERE p.id = cad_id AND p.tenant_id = public.get_user_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cad p WHERE p.id = cad_id AND p.tenant_id = public.get_user_tenant_id()));

CREATE POLICY "child_all_cad_tecido_variantes" ON public.cad_tecido_variantes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cad_tecidos ct JOIN public.cad p ON p.id = ct.cad_id WHERE ct.id = cad_tecido_id AND p.tenant_id = public.get_user_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cad_tecidos ct JOIN public.cad p ON p.id = ct.cad_id WHERE ct.id = cad_tecido_id AND p.tenant_id = public.get_user_tenant_id()));

CREATE POLICY "child_all_cad_grades" ON public.cad_grades FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cad p WHERE p.id = cad_id AND p.tenant_id = public.get_user_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cad p WHERE p.id = cad_id AND p.tenant_id = public.get_user_tenant_id()));

CREATE POLICY "child_all_cad_aviamentos" ON public.cad_aviamentos FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cad p WHERE p.id = cad_id AND p.tenant_id = public.get_user_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cad p WHERE p.id = cad_id AND p.tenant_id = public.get_user_tenant_id()));

CREATE POLICY "child_all_cq_variantes" ON public.cq_variantes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.controle_qualidade p WHERE p.id = controle_qualidade_id AND p.tenant_id = public.get_user_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.controle_qualidade p WHERE p.id = controle_qualidade_id AND p.tenant_id = public.get_user_tenant_id()));
