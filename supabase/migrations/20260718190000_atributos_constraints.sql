-- Cadastro > Atributos: defesa no SERVIDOR (o "required"/"fixed"/proteção era só no client).
-- Pré-checados no banco: 0 duplicados, 0 negativos, 0 NULLs (exceto categorias_produto.grupo_id
-- = 1 órfão → fica de fora do NOT NULL). Meses semeados por _seed_tenant_defaults (DEFINER),
-- então RESTRICTIVE não quebra a criação de loja.
BEGIN;

-- 1) UNIQUE: nomes duplicados eram criáveis (4 tabelas sem UNIQUE). O tradutor 23505→PT
--    (erro-mensagem.ts) já dá a mensagem amigável de graça.
ALTER TABLE public.grupos_produto
  ADD CONSTRAINT grupos_produto_tenant_nome_key UNIQUE (tenant_id, nome);
ALTER TABLE public.subcategorias1_produto
  ADD CONSTRAINT subcat1_produto_tenant_cat_nome_key UNIQUE (tenant_id, categoria_id, nome);
ALTER TABLE public.subcategorias2_produto
  ADD CONSTRAINT subcat2_produto_tenant_cat_nome_key UNIQUE (tenant_id, categoria_id, nome);
ALTER TABLE public.cores_apelido
  ADD CONSTRAINT cores_apelido_tenant_base_nome_key UNIQUE (tenant_id, cor_base_id, nome);

-- 2) NOT NULL nos "extra" obrigatórios (required no client). grupo_id fica de fora (1 órfão).
ALTER TABLE public.cores_apelido ALTER COLUMN cor_base_id SET NOT NULL;
ALTER TABLE public.subcategorias_aviamento ALTER COLUMN categoria_aviamento_id SET NOT NULL;
ALTER TABLE public.subcategorias1_produto ALTER COLUMN categoria_id SET NOT NULL;
ALTER TABLE public.subcategorias2_produto ALTER COLUMN categoria_id SET NOT NULL;

-- 3) CHECK >= 0: markup negativo quebra preco.ts; SLA negativo quebra o Leadtime.
ALTER TABLE public.linhas
  ADD CONSTRAINT linhas_markup_nonneg CHECK (markup IS NULL OR markup >= 0);
ALTER TABLE public.subcategorias1_produto
  ADD CONSTRAINT subcat1_sla_nonneg CHECK (sla_oficina IS NULL OR sla_oficina >= 0);

-- 4) Meses = 12 FIXOS (semeados por _seed_tenant_defaults DEFINER, que bypassa RLS). Bloqueia
--    INSERT/DELETE via API para não-super (rename/UPDATE segue livre — não quebra ordenação,
--    que usa a coluna `ordem`). RESTRICTIVE = AND com as policies permissivas.
CREATE POLICY meses_no_insert ON public.meses AS RESTRICTIVE FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY meses_no_delete ON public.meses AS RESTRICTIVE FOR DELETE USING (is_super_admin());

COMMIT;
