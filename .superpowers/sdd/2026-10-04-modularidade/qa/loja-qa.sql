BEGIN;
-- ============================================================================================================================
-- T0 Modularidade (P-257 A): loja de QA "QA Modularidade (local)" SO NA COPIA LOCAL (127.0.0.1:54422). Idempotente: UUIDs fixos e
-- cada INSERT so entra se a linha ainda nao existe (reexecutar nao muda nada; os modulos/kanban so sao gravados quando a loja
-- NASCE nesta execucao - para trocar modulos use combo.sh). So INSERT/UPDATE (nenhum DDL). Escreve SEM claims (postgres),
-- exceto a aprovacao da M.O. do QA2, que usa a claim do usuario qa-mod-admin (o gatilho de aprovacao pede user_can_edit).
-- ============================================================================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $g$
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7688706257618321447
     OR current_setting('shared_preload_libraries') LIKE '%supautils%' THEN
    RAISE EXCEPTION 'loja_qa: banco nao e a copia local';
  END IF;
END
$g$;

-- A loja nasce nesta execucao? (decide se grava modulos/kanban iniciais; reexecucao nao desfaz o que a QA mudou)
SELECT NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = '0a0d1000-0000-4000-8000-00000000a001') AS nova \gset

-- 1) Loja. O gatilho trg_criar_tenant_config roda _seed_tenant_defaults (config, meses, anos, Corte/Oficina/PL, lojas do
--    Direcionamento, categorias de fornecedor, tipos de insumo, integracao).
INSERT INTO public.tenants (id, nome, ativo)
SELECT '0a0d1000-0000-4000-8000-00000000a001', 'QA Modularidade (local)', true
 WHERE NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = '0a0d1000-0000-4000-8000-00000000a001');

-- 2) Modulos iniciais = combo `completo` (os 11) + board com a coluna "Liberado" depois de "Aprovado" + requisitos de kanban.
--    Sem claims: MOD-1 deixa passar. kanban_automatico NAO e tocado (fica false; a QA liga pela tela como qa-mod-admin).
\if :nova
UPDATE public.tenant_config
   SET modules = '{"cadastro": true, "entrada_saida": true, "criacao": true, "producao": true, "financeiro": true, "dashboard": true, "otb": true, "distribuicao": true, "produto_acabado": true, "produto_importado": true, "etapas_pl": true}'::jsonb,
       status_kanban = status_kanban || '["Liberado"]'::jsonb,
       kanban_requisitos = '{"aprovado": ["ordem_criacao_enviada"], "liberado": ["cq_liberado"]}'::jsonb
 WHERE tenant_id = '0a0d1000-0000-4000-8000-00000000a001';
\endif

-- 3) Usuarios de login (GoTrue local): comum (role user) e admin da loja (role tenant_admin). Mesmo formato dos usuarios da
--    Ave Rara; colunas de token '' (NULL quebra o GoTrue); senha so da copia (README).
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_token, recovery_token,
                        email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.email,
       extensions.crypt('QaMod@Local2026', extensions.gen_salt('bf')), now(), '', '', '', '',
       '{"provider": "email", "providers": ["email"]}'::jsonb,
       jsonb_build_object('full_name', v.nome, 'email_verified', true), now(), now()
  FROM (VALUES
    ('0a0d1000-0000-4000-8000-00000000b001'::uuid, 'qa-mod-comum@local.test', 'QA Modularidade Comum'),
    ('0a0d1000-0000-4000-8000-00000000b002'::uuid, 'qa-mod-admin@local.test', 'QA Modularidade Admin')
  ) AS v(id, email, nome)
 WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v.id);

INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'full_name', u.raw_user_meta_data ->> 'full_name',
                          'email_verified', true, 'phone_verified', false),
       'email', now(), now(), now()
  FROM auth.users u
 WHERE u.id IN ('0a0d1000-0000-4000-8000-00000000b001', '0a0d1000-0000-4000-8000-00000000b002')
   AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email');

INSERT INTO public.users (id, tenant_id, nome, email, role, ativo)
SELECT v.id, '0a0d1000-0000-4000-8000-00000000a001', v.nome, v.email, v.role, true
  FROM (VALUES
    ('0a0d1000-0000-4000-8000-00000000b001'::uuid, 'QA Modularidade Comum', 'qa-mod-comum@local.test', 'user'),
    ('0a0d1000-0000-4000-8000-00000000b002'::uuid, 'QA Modularidade Admin', 'qa-mod-admin@local.test', 'tenant_admin')
  ) AS v(id, nome, email, role)
 WHERE NOT EXISTS (SELECT 1 FROM public.users x WHERE x.id = v.id);

INSERT INTO public.user_roles (user_id, role)
SELECT v.id, v.role::public.app_role
  FROM (VALUES
    ('0a0d1000-0000-4000-8000-00000000b001'::uuid, 'user'),
    ('0a0d1000-0000-4000-8000-00000000b002'::uuid, 'tenant_admin')
  ) AS v(id, role)
 WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = v.id AND r.role = v.role::public.app_role);

-- O comum: ver + editar em TODAS as paginas de ALL_PAGE_KEYS (src/lib/permissions-catalog.ts) menos `integracao*` (67 chaves,
-- conferido por diff com o catalogo em 04/out; o gatilho de integracao ignoraria essas linhas). O admin da loja nao usa
-- user_permissions (admin fura), como a Iris/Lara da Ave Rara.
INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT '0a0d1000-0000-4000-8000-00000000b001', '0a0d1000-0000-4000-8000-00000000a001', k.pagina, true, true
  FROM unnest(ARRAY[
   'cadastro_atributos', 'cadastro_atributos:anos', 'cadastro_atributos:cat_aviamento', 'cadastro_atributos:cat_fornecedor',
   'cadastro_atributos:cat_produto', 'cadastro_atributos:cat_tecido', 'cadastro_atributos:cat_terceirizado', 'cadastro_atributos:cores',
   'cadastro_atributos:cores_apelido', 'cadastro_atributos:grupo_produto', 'cadastro_atributos:intervalo_largura', 'cadastro_atributos:linhas',
   'cadastro_atributos:mat_aviamento', 'cadastro_atributos:meses', 'cadastro_atributos:subcat1_produto', 'cadastro_atributos:subcat2_produto',
   'cadastro_atributos:subcat_aviamento', 'cadastro_atributos:tipo_insumo', 'cadastro_aviamentos', 'cadastro_colaboradores',
   'cadastro_destinos', 'cadastro_etiquetas', 'cadastro_lojas', 'cadastro_servico',
   'cadastro_tecidos', 'criacao_desenvolvimento', 'criacao_desenvolvimento:custos', 'criacao_plan_tecido',
   'criacao_planejamento', 'criacao_planejamento:custos', 'criacao_planejamento:preco_venda', 'criacao_produto_acabado',
   'criacao_produto_importado', 'dashboard_colecao', 'dashboard_comercial', 'dashboard_comercial_colecao',
   'dashboard_custo_financeiro', 'dashboard_custos', 'dashboard_desenvolvimento', 'dashboard_estoque',
   'dashboard_financeiro', 'dashboard_leadtime', 'dashboard_producao', 'dashboard_producao_qualidade',
   'entrada_alertas_tecido', 'entrada_oc_aviamento', 'entrada_oc_insumo', 'entrada_oc_p_acabado',
   'entrada_oc_p_importado', 'entrada_oc_tecido', 'entrada_os_aviamento', 'entrada_os_tecido',
   'financeiro_calendario', 'financeiro_parcelas', 'financeiro_resumo', 'financeiro_servicos',
   'importar', 'otb', 'producao_cq', 'producao_direcionamento',
   'producao_etapas', 'producao_explosao', 'producao_lancamentos', 'producao_oficina',
   'producao_servico_aprovacao', 'producao_terceirizados', 'producao_terceirizados:precos'
  ]) AS k(pagina)
 WHERE NOT EXISTS (SELECT 1 FROM public.user_permissions p
                    WHERE p.user_id = '0a0d1000-0000-4000-8000-00000000b001' AND p.pagina = k.pagina);

-- 4) Cadastro minimo: grupo > categoria > subcategoria 1, linha, cor, categoria de tecido, tecido (artigo) com 1 variante de cor,
--    categoria de aviamento + aviamento, fornecedor.
INSERT INTO public.grupos_produto (id, tenant_id, nome)
SELECT '0a0d1000-0000-4000-8000-0000000c0001', '0a0d1000-0000-4000-8000-00000000a001', 'QA Grupo'
 WHERE NOT EXISTS (SELECT 1 FROM public.grupos_produto WHERE id = '0a0d1000-0000-4000-8000-0000000c0001');
INSERT INTO public.categorias_produto (id, tenant_id, nome, grupo_id)
SELECT '0a0d1000-0000-4000-8000-0000000c0002', '0a0d1000-0000-4000-8000-00000000a001', 'QA Categoria', '0a0d1000-0000-4000-8000-0000000c0001'
 WHERE NOT EXISTS (SELECT 1 FROM public.categorias_produto WHERE id = '0a0d1000-0000-4000-8000-0000000c0002');
INSERT INTO public.subcategorias1_produto (id, tenant_id, nome, categoria_id)
SELECT '0a0d1000-0000-4000-8000-0000000c0003', '0a0d1000-0000-4000-8000-00000000a001', 'QA Subcategoria', '0a0d1000-0000-4000-8000-0000000c0002'
 WHERE NOT EXISTS (SELECT 1 FROM public.subcategorias1_produto WHERE id = '0a0d1000-0000-4000-8000-0000000c0003');
INSERT INTO public.linhas (id, tenant_id, nome, markup)
SELECT '0a0d1000-0000-4000-8000-0000000c0004', '0a0d1000-0000-4000-8000-00000000a001', 'QA Linha', 3
 WHERE NOT EXISTS (SELECT 1 FROM public.linhas WHERE id = '0a0d1000-0000-4000-8000-0000000c0004');
INSERT INTO public.cores (id, tenant_id, nome)
SELECT '0a0d1000-0000-4000-8000-0000000c0005', '0a0d1000-0000-4000-8000-00000000a001', 'QA Preto'
 WHERE NOT EXISTS (SELECT 1 FROM public.cores WHERE id = '0a0d1000-0000-4000-8000-0000000c0005');
INSERT INTO public.categorias_tecido (id, tenant_id, nome)
SELECT '0a0d1000-0000-4000-8000-0000000c0006', '0a0d1000-0000-4000-8000-00000000a001', 'QA Malha'
 WHERE NOT EXISTS (SELECT 1 FROM public.categorias_tecido WHERE id = '0a0d1000-0000-4000-8000-0000000c0006');
INSERT INTO public.categorias_aviamento (id, tenant_id, nome)
SELECT '0a0d1000-0000-4000-8000-0000000c0007', '0a0d1000-0000-4000-8000-00000000a001', 'QA Armarinho'
 WHERE NOT EXISTS (SELECT 1 FROM public.categorias_aviamento WHERE id = '0a0d1000-0000-4000-8000-0000000c0007');
INSERT INTO public.empresas (id, tenant_id, nome_fantasia, tipo, categoria_fornecedor_id)
SELECT '0a0d1000-0000-4000-8000-0000000c0008', '0a0d1000-0000-4000-8000-00000000a001', 'QA Fornecedor', 'material',
       (SELECT cf.id FROM public.categorias_fornecedor cf
         WHERE cf.tenant_id = '0a0d1000-0000-4000-8000-00000000a001' AND cf.nome = 'Tecido')
 WHERE NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = '0a0d1000-0000-4000-8000-0000000c0008');
INSERT INTO public.artigos (id, tenant_id, nome, empresa_id, categoria_tecido_id, preco, unidade_medida, largura_estimada, composicao)
SELECT '0a0d1000-0000-4000-8000-0000000c0009', '0a0d1000-0000-4000-8000-00000000a001', 'QA Tecido Malha',
       '0a0d1000-0000-4000-8000-0000000c0008', '0a0d1000-0000-4000-8000-0000000c0006', 30, 'metro', 1.5, '100% algodao'
 WHERE NOT EXISTS (SELECT 1 FROM public.artigos WHERE id = '0a0d1000-0000-4000-8000-0000000c0009');
INSERT INTO public.artigo_categorias_tecido (tenant_id, artigo_id, categoria_tecido_id)
SELECT '0a0d1000-0000-4000-8000-00000000a001', '0a0d1000-0000-4000-8000-0000000c0009', '0a0d1000-0000-4000-8000-0000000c0006'
 WHERE NOT EXISTS (SELECT 1 FROM public.artigo_categorias_tecido
                    WHERE artigo_id = '0a0d1000-0000-4000-8000-0000000c0009' AND categoria_tecido_id = '0a0d1000-0000-4000-8000-0000000c0006');
INSERT INTO public.variantes_tecido (id, tenant_id, artigo_id, cor_id)
SELECT '0a0d1000-0000-4000-8000-0000000c000a', '0a0d1000-0000-4000-8000-00000000a001',
       '0a0d1000-0000-4000-8000-0000000c0009', '0a0d1000-0000-4000-8000-0000000c0005'
 WHERE NOT EXISTS (SELECT 1 FROM public.variantes_tecido WHERE id = '0a0d1000-0000-4000-8000-0000000c000a');
INSERT INTO public.aviamentos (id, tenant_id, codigo_nome, empresa_id, categoria_aviamento_id, preco)
SELECT '0a0d1000-0000-4000-8000-0000000c000b', '0a0d1000-0000-4000-8000-00000000a001', 'QA Botao 15mm',
       '0a0d1000-0000-4000-8000-0000000c0008', '0a0d1000-0000-4000-8000-0000000c0007', 1.2
 WHERE NOT EXISTS (SELECT 1 FROM public.aviamentos WHERE id = '0a0d1000-0000-4000-8000-0000000c000b');

-- 5) OTB: "QA Col A" (com a subcolecao "QA Sub A", recebe os 3 cards) e "QA Col Vazia" (sem card nenhum).
INSERT INTO public.colecoes (id, tenant_id, nome, status, tipo)
SELECT v.id, '0a0d1000-0000-4000-8000-00000000a001', v.nome, 'rascunho', 'orcamento'
  FROM (VALUES
    ('0a0d1000-0000-4000-8000-0000000c0010'::uuid, 'QA Col A'),
    ('0a0d1000-0000-4000-8000-0000000c0011'::uuid, 'QA Col Vazia')
  ) AS v(id, nome)
 WHERE NOT EXISTS (SELECT 1 FROM public.colecoes c WHERE c.id = v.id);
INSERT INTO public.colecao_subcolecoes (id, tenant_id, colecao_id, nome, ordem)
SELECT '0a0d1000-0000-4000-8000-0000000c0012', '0a0d1000-0000-4000-8000-00000000a001',
       '0a0d1000-0000-4000-8000-0000000c0010', 'QA Sub A', 1
 WHERE NOT EXISTS (SELECT 1 FROM public.colecao_subcolecoes WHERE id = '0a0d1000-0000-4000-8000-0000000c0012');

-- 6) Cards (modelos, interno). Todos na colecao "QA Col A"; QA1 com o TEXTO da colecao vazio (so o id: Parte 12).
--    QA1: Planejamento (sem Ordem de Criacao).
--    QA2: Ordem enviada, 'aprovado', 1 linha de M.O. aprovada (abaixo), data_lancamento vazia (Parte 6 / Lancar).
--    QA3: Ordem enviada, 'aprovado' (o gate padrao da Explosao exige a etapa Aprovado ou posterior), 1 tecido/variante + grade
--         (para Enviar a Explosao pela tela). Obs.: o plano dizia "em Desenvolvimento" sem etapa; aprovado e a que libera o envio.
INSERT INTO public.modelos (id, tenant_id, nome, colecao, colecao_id, subcolecao, categoria_principal_id, subcategoria1_id, linha_id,
                            status_planejamento, status_desenvolvimento, ordem_criacao_enviada, ordem_criacao_enviada_at, origem,
                            tecidos_planejados)
SELECT v.id, '0a0d1000-0000-4000-8000-00000000a001', v.nome, v.colecao, '0a0d1000-0000-4000-8000-0000000c0010', 'QA Sub A',
       '0a0d1000-0000-4000-8000-0000000c0002', '0a0d1000-0000-4000-8000-0000000c0003', '0a0d1000-0000-4000-8000-0000000c0004',
       v.st_plan, v.st_dev, v.ordem, CASE WHEN v.ordem THEN now() END, 'interno', v.tecidos
  FROM (VALUES
    ('0a0d1000-0000-4000-8000-0000000d0001'::uuid, 'QA1 Vestido Planejamento', ''::varchar,         'em_planejamento'::varchar, NULL::varchar,      false, '{}'::uuid[]),
    ('0a0d1000-0000-4000-8000-0000000d0002'::uuid, 'QA2 Vestido Lancar',       'QA Col A'::varchar, 'planejado'::varchar,       'aprovado'::varchar, true,  '{}'::uuid[]),
    ('0a0d1000-0000-4000-8000-0000000d0003'::uuid, 'QA3 Vestido Explosao',     'QA Col A'::varchar, 'planejado'::varchar,       'aprovado'::varchar, true,
       ARRAY['0a0d1000-0000-4000-8000-0000000c0009'::uuid])
  ) AS v(id, nome, colecao, st_plan, st_dev, ordem, tecidos)
 WHERE NOT EXISTS (SELECT 1 FROM public.modelos m WHERE m.id = v.id);

-- QA3: BOM minimo (tecido 1 + variante + grade planejada).
INSERT INTO public.modelo_tecidos (id, modelo_id, artigo_id, numero, tipo, consumo, loss_percent)
SELECT '0a0d1000-0000-4000-8000-0000000d0101', '0a0d1000-0000-4000-8000-0000000d0003', '0a0d1000-0000-4000-8000-0000000c0009', 1, 'tecido', 1.5, 5
 WHERE NOT EXISTS (SELECT 1 FROM public.modelo_tecidos WHERE id = '0a0d1000-0000-4000-8000-0000000d0101');
INSERT INTO public.modelo_tecido_variantes (id, modelo_tecido_id, variante_tecido_id, ordem)
SELECT '0a0d1000-0000-4000-8000-0000000d0102', '0a0d1000-0000-4000-8000-0000000d0101', '0a0d1000-0000-4000-8000-0000000c000a', 1
 WHERE NOT EXISTS (SELECT 1 FROM public.modelo_tecido_variantes WHERE id = '0a0d1000-0000-4000-8000-0000000d0102');
INSERT INTO public.modelo_grades (id, modelo_id, variante_numero, grades, grade_total)
SELECT '0a0d1000-0000-4000-8000-0000000d0103', '0a0d1000-0000-4000-8000-0000000d0003', 1,
       '{"34|PPP": 4, "36|PP": 4, "38|P": 8, "40|M": 8, "42|G": 4, "44|GG": 4}'::jsonb, 32
 WHERE NOT EXISTS (SELECT 1 FROM public.modelo_grades WHERE id = '0a0d1000-0000-4000-8000-0000000d0103');

-- QA2: 1 linha de M.O. APROVADA (servico Corte, R$ 70). O gatilho pede user_can_edit('producao_servico_aprovacao'): claim do
-- admin da loja de QA so neste INSERT (depois zera). O rollup do gatilho repinta modelos.custo_terceirizados_aprovado.
SELECT set_config('request.jwt.claims', '{"sub": "0a0d1000-0000-4000-8000-00000000b002", "role": "authenticated"}', true);
INSERT INTO public.modelo_servico_mo (id, tenant_id, modelo_id, categoria_terceirizado_id, valor, aprovado)
SELECT '0a0d1000-0000-4000-8000-0000000d0201', '0a0d1000-0000-4000-8000-00000000a001', '0a0d1000-0000-4000-8000-0000000d0002',
       (SELECT ct.id FROM public.categorias_terceirizado ct
         WHERE ct.tenant_id = '0a0d1000-0000-4000-8000-00000000a001' AND ct.nome = 'Corte'), 70, true
 WHERE NOT EXISTS (SELECT 1 FROM public.modelo_servico_mo WHERE id = '0a0d1000-0000-4000-8000-0000000d0201');
SELECT set_config('request.jwt.claims', '', true);

-- 7) Resumo (NOTICE): contagens da loja por tabela (a impressao ajuda a comparar a 1a e a 2a execucao).
DO $r$
DECLARE r record; n bigint; s text := ''; tot bigint := 0;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
           WHERE ns.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1', r.relname)
       INTO n USING '0a0d1000-0000-4000-8000-00000000a001'::uuid;
    IF n > 0 THEN s := s || r.relname || '=' || n || ' '; tot := tot + n; END IF;
  END LOOP;
  RAISE NOTICE 'loja_qa: total de linhas com tenant_id = % (%)', tot, s;
END
$r$;
SELECT t.id AS loja_id, t.nome, c.modules::text AS modulos, c.kanban_automatico FROM public.tenants t
  JOIN public.tenant_config c ON c.tenant_id = t.id WHERE t.id = '0a0d1000-0000-4000-8000-00000000a001';
COMMIT;
