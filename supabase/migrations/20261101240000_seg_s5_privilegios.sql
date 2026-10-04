-- Reforço de segurança — sub-release S5 ("Faxina de privilégios": ANON-3, PRIV-1, auxiliares do ANON-1). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s5.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§S5). Por cima da S4 (o "antes" é o estado de depois da S3a..S4).
-- ANON-3: anon perde todo privilégio de tabela em public (116 tabelas), menos SELECT em system_settings (identidade da
-- tela de login/Home deslogada). PRIV-1: authenticated perde TRUNCATE/REFERENCES/TRIGGER/MAINTAIN (116 tabelas). ANON-1: os 4
-- auxiliares de RLS (tenant_module_enabled, user_can_edit, user_can_view, meu_tenant_ativo) perdem EXECUTE de PUBLIC e anon
-- (authenticated e service_role seguem com o grant explícito; nenhuma policy que o anon avalia os usa).
-- Trava: GRANT/REVOKE = catálogo (medido em seg-s5.test.ts): nenhuma tabela acima de AccessShare, nada de auth/storage.
-- Sem CREATE TRIGGER/POLICY e sem DROP. Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261101240000_seg_s5_privilegios_down.sql (LIFO: antes dos inversos da S4/S3).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v_acl text;
  v_cols text;
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 's5_privilegios: papeis anon/authenticated/service_role ausentes' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('anos', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('artigo_categorias_tecido', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('artigos', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('aviamentos', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cad', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'observacoes_molde={authenticated=w/postgres} direcionamento_status={authenticated=w/postgres} direcionamento_confirmado_at={authenticated=w/postgres} sem_acabamento={authenticated=w/postgres}', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'observacoes_molde={authenticated=w/postgres} direcionamento_status={authenticated=w/postgres} direcionamento_confirmado_at={authenticated=w/postgres} sem_acabamento={authenticated=w/postgres}'),
      ('cad_aviamentos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cad_etiquetas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cad_grades', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cad_tecido_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cad_tecidos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('categorias_aviamento', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('categorias_fornecedor', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('categorias_produto', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('categorias_tecido', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('categorias_terceirizado', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colaboradores', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecao_mixes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecao_pv_itens', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecao_semana_categorias', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecao_semanas', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecao_subcolecoes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecoes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('controle_qualidade', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'fotografado_variantes={authenticated=w/postgres}', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'fotografado_variantes={authenticated=w/postgres}'),
      ('cores', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cores_apelido', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cq_pos_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cq_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('destinos_saida', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('direcionamento', 'anon=rDxtm/postgres,authenticated=rDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('direcionamento_controle', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('direcionamento_lojas', 'anon=rDxtm/postgres,authenticated=rDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('empresa_categorias_fornecedor', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('empresa_categorias_servico', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('empresas', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('enderecamento_tecido', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('estoque_tecido_baixas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('etiquetas', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('grupos_produto', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('intervalos_largura', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('lancamentos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('linhas', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('lojas_direcionamento', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('materiais_aviamento', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('meses', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('mix_padrao_linhas', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('mix_padroes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_aviamentos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_etiquetas', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_grades', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_kanban_historico', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_observacoes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_prova_comentarios', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_servico_mo', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_tecido_oc_links', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_tecido_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_tecidos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelos', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_aviamento', 'anon=rxtm/postgres,authenticated=rdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'nfs={authenticated=w/postgres}', 'authenticated=rd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'nfs={authenticated=w/postgres}'),
      ('ocs_aviamento_itens', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_etiqueta', 'anon=rxtm/postgres,authenticated=rdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_nota_entrada={authenticated=w/postgres}', 'authenticated=rd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_nota_entrada={authenticated=w/postgres}'),
      ('ocs_etiqueta_itens', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_importado', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_importado_etapas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_p_acabado', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_tecido', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'numero_pedido={authenticated=w/postgres} rolo_codigo={authenticated=w/postgres} rolo_rua={authenticated=w/postgres} rolo_prateleira={authenticated=w/postgres} nfs={authenticated=w/postgres} recebimento_responsavel_id={authenticated=w/postgres} recebimento_responsavel_nome={authenticated=w/postgres}', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'numero_pedido={authenticated=w/postgres} rolo_codigo={authenticated=w/postgres} rolo_rua={authenticated=w/postgres} rolo_prateleira={authenticated=w/postgres} nfs={authenticated=w/postgres} recebimento_responsavel_id={authenticated=w/postgres} recebimento_responsavel_nome={authenticated=w/postgres}'),
      ('ocs_tecido_itens', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'cancelado={authenticated=w/postgres} cq_observacao={authenticated=w/postgres} cq_ok={authenticated=w/postgres} cq_alerta_status={authenticated=w/postgres}', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'cancelado={authenticated=w/postgres} cq_observacao={authenticated=w/postgres} cq_ok={authenticated=w/postgres} cq_alerta_status={authenticated=w/postgres}'),
      ('ordens_saida_aviamento', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ordens_saida_aviamento_itens', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ordens_saida_tecido', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ordens_saida_tecido_itens', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('otb_simulacao_linhas', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('otb_simulacao_modelos', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('otb_simulacao_unidades', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('otb_simulacao_variantes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('otb_simulacoes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('papeis', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('papel_permissoes', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('parcelas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_vencimento={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} status={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_vencimento={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} status={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}'),
      ('parcelas_servico', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_vencimento={authenticated=w/postgres} status={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_vencimento={authenticated=w/postgres} status={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}'),
      ('plan_tecido', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_linhas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_materiais', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_oc_aplicada', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_ocs', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_paleta', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_pedido_fotos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_slot_oc', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_slots', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_subcolecao_categorias', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_subcolecoes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('producao_oficina', 'anon=rxtm/postgres,authenticated=arwxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arw/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('producao_terceirizados', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('produto_acabado_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('produto_importado_etapas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('produto_importado_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('produtos_acabados', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'modelo_id={authenticated=w/postgres} mix_id={authenticated=w/postgres}', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'modelo_id={authenticated=w/postgres} mix_id={authenticated=w/postgres}'),
      ('produtos_importados', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'modelo_id={authenticated=w/postgres} mix_id={authenticated=w/postgres}', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'modelo_id={authenticated=w/postgres} mix_id={authenticated=w/postgres}'),
      ('profiles', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ref_sequencia', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('representantes', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('subcategorias1_produto', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('subcategorias2_produto', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('subcategorias_aviamento', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('system_settings', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=r/postgres,authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('tenant_config', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('tenants', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('tipos_colaborador', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('tipos_insumo', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('user_permissions', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('user_roles', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('user_ui_prefs', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('users', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('variantes_aviamento', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('variantes_etiqueta', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('variantes_tecido', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '')
    ) AS x(t, a_acl, a_cols, d_acl, d_cols) LOOP
    SELECT coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(c.relacl) x), ''),
           coalesce((SELECT string_agg(a.attname || '=' || a.attacl::text, ' ' ORDER BY a.attnum) FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL AND NOT a.attisdropped), '')
      INTO v_acl, v_cols
      FROM pg_class c WHERE c.oid = to_regclass('public.' || r.t);
    IF v_acl IS NULL THEN
      RAISE EXCEPTION 's5_privilegios: tabela % ausente', r.t USING ERRCODE = 'P0001';
    END IF;
    IF NOT ((v_acl = r.a_acl AND v_cols = r.a_cols) OR (v_acl = r.d_acl AND v_cols = r.d_cols)) THEN
      RAISE EXCEPTION 's5_privilegios: ACL inesperada em % (relacl ordenada %, colunas %) - confira o Passo 0 (a S3/S4 aplicadas?); nada foi mudado', r.t, v_acl, v_cols
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.tenant_module_enabled(text)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
      ('public.user_can_edit(text)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
      ('public.user_can_view(text)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
      ('public.meu_tenant_ativo()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres')
    ) AS x(f, a, d) LOOP
    v_acl := (SELECT coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(proacl) x), '') FROM pg_proc WHERE oid = to_regprocedure(r.f));
    IF v_acl IS NULL OR v_acl NOT IN (r.a, r.d) THEN
      RAISE EXCEPTION 's5_privilegios: EXECUTE inesperado em % (%)', r.f, coalesce(v_acl, 'ausente') USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  v_acl := (SELECT coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(d.defaclacl) x), '') FROM pg_default_acl d  WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r');
  IF v_acl IS NULL OR v_acl NOT IN ('authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres') THEN
    RAISE EXCEPTION 's5_privilegios: default ACL de tabelas do postgres em public inesperado (%)', coalesce(v_acl, 'ausente') USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.anos FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.artigo_categorias_tecido FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.artigos FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.aviamentos FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_aviamentos FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_etiquetas FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_grades FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_tecido_variantes FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_tecidos FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_aviamento FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_fornecedor FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_produto FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_tecido FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_terceirizado FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colaboradores FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_mixes FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_pv_itens FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_semana_categorias FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_semanas FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_subcolecoes FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecoes FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.controle_qualidade FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cores FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cores_apelido FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cq_pos_variantes FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cq_variantes FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.destinos_saida FROM anon;
REVOKE SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.direcionamento FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.direcionamento_controle FROM anon;
REVOKE SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.direcionamento_lojas FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.empresa_categorias_fornecedor FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.empresa_categorias_servico FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.empresas FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.enderecamento_tecido FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.estoque_tecido_baixas FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.etiquetas FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.grupos_produto FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.intervalos_largura FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.lancamentos FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.linhas FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.lojas_direcionamento FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.materiais_aviamento FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.meses FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.mix_padrao_linhas FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.mix_padroes FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_aviamentos FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_etiquetas FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_grades FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_kanban_historico FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_observacoes FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_prova_comentarios FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_servico_mo FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_tecido_oc_links FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_tecido_variantes FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_tecidos FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelos FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_aviamento FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_aviamento_itens FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_etiqueta FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_etiqueta_itens FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_importado FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_importado_etapas FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_p_acabado FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_tecido FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_tecido_itens FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_aviamento FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_aviamento_itens FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_tecido FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_tecido_itens FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_linhas FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_modelos FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_unidades FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_variantes FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacoes FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.papeis FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.papel_permissoes FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.parcelas FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.parcelas_servico FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_linhas FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_materiais FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_oc_aplicada FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_ocs FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_paleta FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_pedido_fotos FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_slot_oc FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_slots FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_subcolecao_categorias FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_subcolecoes FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_variantes FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.producao_oficina FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.producao_terceirizados FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produto_acabado_variantes FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produto_importado_etapas FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produto_importado_variantes FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produtos_acabados FROM anon;
REVOKE SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produtos_importados FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.profiles FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ref_sequencia FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.representantes FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.subcategorias_aviamento FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.subcategorias1_produto FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.subcategorias2_produto FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.system_settings FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tenant_config FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tenants FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tipos_colaborador FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tipos_insumo FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.user_permissions FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.user_roles FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.user_ui_prefs FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.users FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.variantes_aviamento FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.variantes_etiqueta FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.variantes_tecido FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.anos FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.artigo_categorias_tecido FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.artigos FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.aviamentos FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_aviamentos FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_etiquetas FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_grades FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_tecido_variantes FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_tecidos FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_aviamento FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_fornecedor FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_produto FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_tecido FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_terceirizado FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colaboradores FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_mixes FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_pv_itens FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_semana_categorias FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_semanas FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_subcolecoes FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecoes FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.controle_qualidade FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cores FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cores_apelido FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cq_pos_variantes FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cq_variantes FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.destinos_saida FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.direcionamento FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.direcionamento_controle FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.direcionamento_lojas FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.empresa_categorias_fornecedor FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.empresa_categorias_servico FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.empresas FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.enderecamento_tecido FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.estoque_tecido_baixas FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.etiquetas FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.grupos_produto FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.intervalos_largura FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.lancamentos FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.linhas FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.lojas_direcionamento FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.materiais_aviamento FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.meses FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.mix_padrao_linhas FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.mix_padroes FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_aviamentos FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_etiquetas FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_grades FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_kanban_historico FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_observacoes FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_prova_comentarios FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_servico_mo FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_tecido_oc_links FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_tecido_variantes FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_tecidos FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelos FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_aviamento FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_aviamento_itens FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_etiqueta FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_etiqueta_itens FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_importado FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_importado_etapas FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_p_acabado FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_tecido FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_tecido_itens FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_aviamento FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_aviamento_itens FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_tecido FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_tecido_itens FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_linhas FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_modelos FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_unidades FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_variantes FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacoes FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.papeis FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.papel_permissoes FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.parcelas FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.parcelas_servico FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_linhas FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_materiais FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_oc_aplicada FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_ocs FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_paleta FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_pedido_fotos FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_slot_oc FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_slots FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_subcolecao_categorias FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_subcolecoes FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_variantes FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.producao_oficina FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.producao_terceirizados FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produto_acabado_variantes FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produto_importado_etapas FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produto_importado_variantes FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produtos_acabados FROM authenticated;
REVOKE REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produtos_importados FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.profiles FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ref_sequencia FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.representantes FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.subcategorias_aviamento FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.subcategorias1_produto FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.subcategorias2_produto FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.system_settings FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tenant_config FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tenants FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tipos_colaborador FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tipos_insumo FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.user_permissions FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.user_roles FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.user_ui_prefs FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.users FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.variantes_aviamento FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.variantes_etiqueta FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.variantes_tecido FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.tenant_module_enabled(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_can_edit(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_can_view(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.meu_tenant_ativo() FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE MAINTAIN ON TABLES FROM authenticated;

DO $pos$
DECLARE
  r record;
BEGIN
  -- anti-drift: o anon só lê o que a tela deslogada usa (também pega tabela NOVA que tenha nascido com grant: aí, gere de novo)
  FOR r IN SELECT c.relname AS t, p.priv FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(priv)
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND has_table_privilege('anon', c.oid, p.priv) AND NOT ((c.relname = 'system_settings' AND p.priv IN ('SELECT'))) LOOP
    RAISE EXCEPTION 's5_privilegios: pos-condicao falhou: anon ainda tem % em %', r.priv, r.t USING ERRCODE = 'P0001';
  END LOOP;
  IF NOT has_table_privilege('anon', 'public.system_settings', 'SELECT') THEN
    RAISE EXCEPTION 's5_privilegios: pos-condicao falhou: a tela de login perdeu a identidade (system_settings)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT c.relname AS t FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND (has_table_privilege('authenticated', c.oid, 'TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'REFERENCES')
                   OR has_table_privilege('authenticated', c.oid, 'TRIGGER') OR has_table_privilege('authenticated', c.oid, 'MAINTAIN')) LOOP
    RAISE EXCEPTION 's5_privilegios: pos-condicao falhou: authenticated ainda tem TRUNCATE/REFERENCES/TRIGGER/MAINTAIN em %', r.t USING ERRCODE = 'P0001';
  END LOOP;
  IF (SELECT coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(d.defaclacl) x), '') FROM pg_default_acl d  WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r') IS DISTINCT FROM 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres' THEN
    RAISE EXCEPTION 's5_privilegios: pos-condicao falhou: default ACL de tabelas (MAINTAIN de authenticated)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT unnest(ARRAY['public.tenant_module_enabled(text)', 'public.user_can_edit(text)', 'public.user_can_view(text)', 'public.meu_tenant_ativo()']) AS f LOOP
    IF has_function_privilege('anon', to_regprocedure(r.f), 'EXECUTE')
       OR NOT has_function_privilege('authenticated', to_regprocedure(r.f), 'EXECUTE')
       OR NOT has_function_privilege('service_role', to_regprocedure(r.f), 'EXECUTE') THEN
      RAISE EXCEPTION 's5_privilegios: pos-condicao falhou no EXECUTE de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
