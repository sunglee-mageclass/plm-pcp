-- Inverso de supabase/migrations/20261101240000_seg_s5_privilegios.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s5.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§S5). Por cima da S4 (o "antes" é o estado de depois da S3a..S4).
-- Devolve EXATAMENTE a ACL de antes (tabela, colunas e as 4 funções, na MESMA ORDEM dos aclitems: reconstrói por tabela).
-- Trava: GRANT/REVOKE = catálogo (medido em seg-s5.test.ts): nenhuma tabela acima de AccessShare, nada de auth/storage.
-- Sem CREATE TRIGGER/POLICY e sem DROP. Idempotente (a guarda aceita o estado de antes OU o de depois).
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
    RAISE EXCEPTION 's5_privilegios_down: papeis anon/authenticated/service_role ausentes' USING ERRCODE = 'P0001';
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
      RAISE EXCEPTION 's5_privilegios_down: tabela % ausente', r.t USING ERRCODE = 'P0001';
    END IF;
    IF NOT ((v_acl = r.a_acl AND v_cols = r.a_cols) OR (v_acl = r.d_acl AND v_cols = r.d_cols)) THEN
      RAISE EXCEPTION 's5_privilegios_down: ACL inesperada em % (relacl ordenada %, colunas %) - confira o Passo 0 (a S3/S4 aplicadas?); nada foi mudado', r.t, v_acl, v_cols
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
      RAISE EXCEPTION 's5_privilegios_down: EXECUTE inesperado em % (%)', r.f, coalesce(v_acl, 'ausente') USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  v_acl := (SELECT coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(d.defaclacl) x), '') FROM pg_default_acl d  WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r');
  IF v_acl IS NULL OR v_acl NOT IN ('authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres') THEN
    RAISE EXCEPTION 's5_privilegios_down: default ACL de tabelas do postgres em public inesperado (%)', coalesce(v_acl, 'ausente') USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT MAINTAIN ON TABLES TO authenticated;
REVOKE EXECUTE ON FUNCTION public.tenant_module_enabled(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_module_enabled(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_module_enabled(text) TO anon;
GRANT EXECUTE ON FUNCTION public.tenant_module_enabled(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_module_enabled(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.user_can_edit(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_edit(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_edit(text) TO anon;
GRANT EXECUTE ON FUNCTION public.user_can_edit(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_edit(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.user_can_view(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_view(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_view(text) TO anon;
GRANT EXECUTE ON FUNCTION public.user_can_view(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_view(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.meu_tenant_ativo() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meu_tenant_ativo() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.meu_tenant_ativo() TO anon;
GRANT EXECUTE ON FUNCTION public.meu_tenant_ativo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.meu_tenant_ativo() TO service_role;
REVOKE ALL ON TABLE public.anos FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.anos TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.anos TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.anos TO service_role;
REVOKE ALL ON TABLE public.artigo_categorias_tecido FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.artigo_categorias_tecido TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.artigo_categorias_tecido TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.artigo_categorias_tecido TO service_role;
REVOKE ALL ON TABLE public.artigos FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.artigos TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.artigos TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.artigos TO service_role;
REVOKE ALL ON TABLE public.aviamentos FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.aviamentos TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.aviamentos TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.aviamentos TO service_role;
REVOKE ALL ON TABLE public.cad FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad TO service_role;
GRANT UPDATE (observacoes_molde) ON TABLE public.cad TO authenticated;
GRANT UPDATE (direcionamento_status) ON TABLE public.cad TO authenticated;
GRANT UPDATE (direcionamento_confirmado_at) ON TABLE public.cad TO authenticated;
GRANT UPDATE (sem_acabamento) ON TABLE public.cad TO authenticated;
REVOKE ALL ON TABLE public.cad_aviamentos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_aviamentos TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_aviamentos TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_aviamentos TO service_role;
REVOKE ALL ON TABLE public.cad_etiquetas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_etiquetas TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_etiquetas TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_etiquetas TO service_role;
REVOKE ALL ON TABLE public.cad_grades FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_grades TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_grades TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_grades TO service_role;
REVOKE ALL ON TABLE public.cad_tecido_variantes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_tecido_variantes TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_tecido_variantes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_tecido_variantes TO service_role;
REVOKE ALL ON TABLE public.cad_tecidos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_tecidos TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_tecidos TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cad_tecidos TO service_role;
REVOKE ALL ON TABLE public.categorias_aviamento FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_aviamento TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_aviamento TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_aviamento TO service_role;
REVOKE ALL ON TABLE public.categorias_fornecedor FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_fornecedor TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_fornecedor TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_fornecedor TO service_role;
REVOKE ALL ON TABLE public.categorias_produto FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_produto TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_produto TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_produto TO service_role;
REVOKE ALL ON TABLE public.categorias_tecido FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_tecido TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_tecido TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_tecido TO service_role;
REVOKE ALL ON TABLE public.categorias_terceirizado FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_terceirizado TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_terceirizado TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.categorias_terceirizado TO service_role;
REVOKE ALL ON TABLE public.colaboradores FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colaboradores TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colaboradores TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colaboradores TO service_role;
REVOKE ALL ON TABLE public.colecao_mixes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_mixes TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_mixes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_mixes TO service_role;
REVOKE ALL ON TABLE public.colecao_pv_itens FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_pv_itens TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_pv_itens TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_pv_itens TO service_role;
REVOKE ALL ON TABLE public.colecao_semana_categorias FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_semana_categorias TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_semana_categorias TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_semana_categorias TO service_role;
REVOKE ALL ON TABLE public.colecao_semanas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_semanas TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_semanas TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_semanas TO service_role;
REVOKE ALL ON TABLE public.colecao_subcolecoes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_subcolecoes TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_subcolecoes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecao_subcolecoes TO service_role;
REVOKE ALL ON TABLE public.colecoes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecoes TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecoes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.colecoes TO service_role;
REVOKE ALL ON TABLE public.controle_qualidade FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.controle_qualidade TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.controle_qualidade TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.controle_qualidade TO service_role;
GRANT UPDATE (fotografado_variantes) ON TABLE public.controle_qualidade TO authenticated;
REVOKE ALL ON TABLE public.cores FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cores TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cores TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cores TO service_role;
REVOKE ALL ON TABLE public.cores_apelido FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cores_apelido TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cores_apelido TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cores_apelido TO service_role;
REVOKE ALL ON TABLE public.cq_pos_variantes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cq_pos_variantes TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cq_pos_variantes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cq_pos_variantes TO service_role;
REVOKE ALL ON TABLE public.cq_variantes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cq_variantes TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cq_variantes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.cq_variantes TO service_role;
REVOKE ALL ON TABLE public.destinos_saida FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.destinos_saida TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.destinos_saida TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.destinos_saida TO service_role;
REVOKE ALL ON TABLE public.direcionamento FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.direcionamento TO anon;
GRANT SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.direcionamento TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.direcionamento TO service_role;
REVOKE ALL ON TABLE public.direcionamento_controle FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.direcionamento_controle TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.direcionamento_controle TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.direcionamento_controle TO service_role;
REVOKE ALL ON TABLE public.direcionamento_lojas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.direcionamento_lojas TO anon;
GRANT SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.direcionamento_lojas TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.direcionamento_lojas TO service_role;
REVOKE ALL ON TABLE public.empresa_categorias_fornecedor FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.empresa_categorias_fornecedor TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.empresa_categorias_fornecedor TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.empresa_categorias_fornecedor TO service_role;
REVOKE ALL ON TABLE public.empresa_categorias_servico FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.empresa_categorias_servico TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.empresa_categorias_servico TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.empresa_categorias_servico TO service_role;
REVOKE ALL ON TABLE public.empresas FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.empresas TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.empresas TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.empresas TO service_role;
REVOKE ALL ON TABLE public.enderecamento_tecido FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.enderecamento_tecido TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.enderecamento_tecido TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.enderecamento_tecido TO service_role;
REVOKE ALL ON TABLE public.estoque_tecido_baixas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.estoque_tecido_baixas TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.estoque_tecido_baixas TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.estoque_tecido_baixas TO service_role;
REVOKE ALL ON TABLE public.etiquetas FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.etiquetas TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.etiquetas TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.etiquetas TO service_role;
REVOKE ALL ON TABLE public.grupos_produto FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.grupos_produto TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.grupos_produto TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.grupos_produto TO service_role;
REVOKE ALL ON TABLE public.intervalos_largura FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.intervalos_largura TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.intervalos_largura TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.intervalos_largura TO service_role;
REVOKE ALL ON TABLE public.lancamentos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.lancamentos TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.lancamentos TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.lancamentos TO service_role;
REVOKE ALL ON TABLE public.linhas FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.linhas TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.linhas TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.linhas TO service_role;
REVOKE ALL ON TABLE public.lojas_direcionamento FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.lojas_direcionamento TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.lojas_direcionamento TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.lojas_direcionamento TO service_role;
REVOKE ALL ON TABLE public.materiais_aviamento FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.materiais_aviamento TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.materiais_aviamento TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.materiais_aviamento TO service_role;
REVOKE ALL ON TABLE public.meses FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.meses TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.meses TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.meses TO service_role;
REVOKE ALL ON TABLE public.mix_padrao_linhas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.mix_padrao_linhas TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.mix_padrao_linhas TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.mix_padrao_linhas TO service_role;
REVOKE ALL ON TABLE public.mix_padroes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.mix_padroes TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.mix_padroes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.mix_padroes TO service_role;
REVOKE ALL ON TABLE public.modelo_aviamentos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_aviamentos TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_aviamentos TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_aviamentos TO service_role;
REVOKE ALL ON TABLE public.modelo_etiquetas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_etiquetas TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_etiquetas TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_etiquetas TO service_role;
REVOKE ALL ON TABLE public.modelo_grades FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_grades TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_grades TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_grades TO service_role;
REVOKE ALL ON TABLE public.modelo_kanban_historico FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_kanban_historico TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_kanban_historico TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_kanban_historico TO service_role;
REVOKE ALL ON TABLE public.modelo_observacoes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_observacoes TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_observacoes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_observacoes TO service_role;
REVOKE ALL ON TABLE public.modelo_prova_comentarios FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_prova_comentarios TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_prova_comentarios TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_prova_comentarios TO service_role;
REVOKE ALL ON TABLE public.modelo_servico_mo FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_servico_mo TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_servico_mo TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_servico_mo TO service_role;
REVOKE ALL ON TABLE public.modelo_tecido_oc_links FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_tecido_oc_links TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_tecido_oc_links TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_tecido_oc_links TO service_role;
REVOKE ALL ON TABLE public.modelo_tecido_variantes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_tecido_variantes TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_tecido_variantes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_tecido_variantes TO service_role;
REVOKE ALL ON TABLE public.modelo_tecidos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_tecidos TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_tecidos TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelo_tecidos TO service_role;
REVOKE ALL ON TABLE public.modelos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelos TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelos TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.modelos TO service_role;
REVOKE ALL ON TABLE public.ocs_aviamento FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_aviamento TO anon;
GRANT SELECT, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_aviamento TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_aviamento TO service_role;
GRANT UPDATE (nfs) ON TABLE public.ocs_aviamento TO authenticated;
REVOKE ALL ON TABLE public.ocs_aviamento_itens FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_aviamento_itens TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_aviamento_itens TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_aviamento_itens TO service_role;
REVOKE ALL ON TABLE public.ocs_etiqueta FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_etiqueta TO anon;
GRANT SELECT, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_etiqueta TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_etiqueta TO service_role;
GRANT UPDATE (data_nota_entrada) ON TABLE public.ocs_etiqueta TO authenticated;
REVOKE ALL ON TABLE public.ocs_etiqueta_itens FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_etiqueta_itens TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_etiqueta_itens TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_etiqueta_itens TO service_role;
REVOKE ALL ON TABLE public.ocs_importado FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_importado TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_importado TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_importado TO service_role;
REVOKE ALL ON TABLE public.ocs_importado_etapas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_importado_etapas TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_importado_etapas TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_importado_etapas TO service_role;
REVOKE ALL ON TABLE public.ocs_p_acabado FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_p_acabado TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_p_acabado TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_p_acabado TO service_role;
REVOKE ALL ON TABLE public.ocs_tecido FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_tecido TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_tecido TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_tecido TO service_role;
GRANT UPDATE (numero_pedido) ON TABLE public.ocs_tecido TO authenticated;
GRANT UPDATE (rolo_codigo) ON TABLE public.ocs_tecido TO authenticated;
GRANT UPDATE (rolo_rua) ON TABLE public.ocs_tecido TO authenticated;
GRANT UPDATE (rolo_prateleira) ON TABLE public.ocs_tecido TO authenticated;
GRANT UPDATE (nfs) ON TABLE public.ocs_tecido TO authenticated;
GRANT UPDATE (recebimento_responsavel_id) ON TABLE public.ocs_tecido TO authenticated;
GRANT UPDATE (recebimento_responsavel_nome) ON TABLE public.ocs_tecido TO authenticated;
REVOKE ALL ON TABLE public.ocs_tecido_itens FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_tecido_itens TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_tecido_itens TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ocs_tecido_itens TO service_role;
GRANT UPDATE (cancelado) ON TABLE public.ocs_tecido_itens TO authenticated;
GRANT UPDATE (cq_observacao) ON TABLE public.ocs_tecido_itens TO authenticated;
GRANT UPDATE (cq_ok) ON TABLE public.ocs_tecido_itens TO authenticated;
GRANT UPDATE (cq_alerta_status) ON TABLE public.ocs_tecido_itens TO authenticated;
REVOKE ALL ON TABLE public.ordens_saida_aviamento FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_aviamento TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_aviamento TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_aviamento TO service_role;
REVOKE ALL ON TABLE public.ordens_saida_aviamento_itens FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_aviamento_itens TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_aviamento_itens TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_aviamento_itens TO service_role;
REVOKE ALL ON TABLE public.ordens_saida_tecido FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_tecido TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_tecido TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_tecido TO service_role;
REVOKE ALL ON TABLE public.ordens_saida_tecido_itens FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_tecido_itens TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_tecido_itens TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ordens_saida_tecido_itens TO service_role;
REVOKE ALL ON TABLE public.otb_simulacao_linhas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_linhas TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_linhas TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_linhas TO service_role;
REVOKE ALL ON TABLE public.otb_simulacao_modelos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_modelos TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_modelos TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_modelos TO service_role;
REVOKE ALL ON TABLE public.otb_simulacao_unidades FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_unidades TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_unidades TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_unidades TO service_role;
REVOKE ALL ON TABLE public.otb_simulacao_variantes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_variantes TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_variantes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacao_variantes TO service_role;
REVOKE ALL ON TABLE public.otb_simulacoes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacoes TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacoes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.otb_simulacoes TO service_role;
REVOKE ALL ON TABLE public.papeis FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.papeis TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.papeis TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.papeis TO service_role;
REVOKE ALL ON TABLE public.papel_permissoes FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.papel_permissoes TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.papel_permissoes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.papel_permissoes TO service_role;
REVOKE ALL ON TABLE public.parcelas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.parcelas TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.parcelas TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.parcelas TO service_role;
GRANT UPDATE (data_vencimento) ON TABLE public.parcelas TO authenticated;
GRANT UPDATE (data_pagamento) ON TABLE public.parcelas TO authenticated;
GRANT UPDATE (status) ON TABLE public.parcelas TO authenticated;
GRANT UPDATE (comprovante_url) ON TABLE public.parcelas TO authenticated;
REVOKE ALL ON TABLE public.parcelas_servico FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.parcelas_servico TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.parcelas_servico TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.parcelas_servico TO service_role;
GRANT UPDATE (data_vencimento) ON TABLE public.parcelas_servico TO authenticated;
GRANT UPDATE (status) ON TABLE public.parcelas_servico TO authenticated;
GRANT UPDATE (data_pagamento) ON TABLE public.parcelas_servico TO authenticated;
GRANT UPDATE (comprovante_url) ON TABLE public.parcelas_servico TO authenticated;
REVOKE ALL ON TABLE public.plan_tecido FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido TO service_role;
REVOKE ALL ON TABLE public.plan_tecido_linhas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_linhas TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_linhas TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_linhas TO service_role;
REVOKE ALL ON TABLE public.plan_tecido_materiais FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_materiais TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_materiais TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_materiais TO service_role;
REVOKE ALL ON TABLE public.plan_tecido_oc_aplicada FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_oc_aplicada TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_oc_aplicada TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_oc_aplicada TO service_role;
REVOKE ALL ON TABLE public.plan_tecido_ocs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_ocs TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_ocs TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_ocs TO service_role;
REVOKE ALL ON TABLE public.plan_tecido_paleta FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_paleta TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_paleta TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_paleta TO service_role;
REVOKE ALL ON TABLE public.plan_tecido_pedido_fotos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_pedido_fotos TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_pedido_fotos TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_pedido_fotos TO service_role;
REVOKE ALL ON TABLE public.plan_tecido_slot_oc FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_slot_oc TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_slot_oc TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_slot_oc TO service_role;
REVOKE ALL ON TABLE public.plan_tecido_slots FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_slots TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_slots TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_slots TO service_role;
REVOKE ALL ON TABLE public.plan_tecido_subcolecao_categorias FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_subcolecao_categorias TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_subcolecao_categorias TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_subcolecao_categorias TO service_role;
REVOKE ALL ON TABLE public.plan_tecido_subcolecoes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_subcolecoes TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_subcolecoes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_subcolecoes TO service_role;
REVOKE ALL ON TABLE public.plan_tecido_variantes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_variantes TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_variantes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.plan_tecido_variantes TO service_role;
REVOKE ALL ON TABLE public.producao_oficina FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.producao_oficina TO anon;
GRANT INSERT, SELECT, UPDATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.producao_oficina TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.producao_oficina TO service_role;
REVOKE ALL ON TABLE public.producao_terceirizados FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.producao_terceirizados TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.producao_terceirizados TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.producao_terceirizados TO service_role;
REVOKE ALL ON TABLE public.produto_acabado_variantes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produto_acabado_variantes TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produto_acabado_variantes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produto_acabado_variantes TO service_role;
REVOKE ALL ON TABLE public.produto_importado_etapas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produto_importado_etapas TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produto_importado_etapas TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produto_importado_etapas TO service_role;
REVOKE ALL ON TABLE public.produto_importado_variantes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produto_importado_variantes TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produto_importado_variantes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produto_importado_variantes TO service_role;
REVOKE ALL ON TABLE public.produtos_acabados FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produtos_acabados TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produtos_acabados TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produtos_acabados TO service_role;
GRANT UPDATE (modelo_id) ON TABLE public.produtos_acabados TO authenticated;
GRANT UPDATE (mix_id) ON TABLE public.produtos_acabados TO authenticated;
REVOKE ALL ON TABLE public.produtos_importados FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produtos_importados TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produtos_importados TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.produtos_importados TO service_role;
GRANT UPDATE (modelo_id) ON TABLE public.produtos_importados TO authenticated;
GRANT UPDATE (mix_id) ON TABLE public.produtos_importados TO authenticated;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.profiles TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.profiles TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.profiles TO service_role;
REVOKE ALL ON TABLE public.ref_sequencia FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ref_sequencia TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ref_sequencia TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ref_sequencia TO service_role;
REVOKE ALL ON TABLE public.representantes FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.representantes TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.representantes TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.representantes TO service_role;
REVOKE ALL ON TABLE public.subcategorias1_produto FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.subcategorias1_produto TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.subcategorias1_produto TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.subcategorias1_produto TO service_role;
REVOKE ALL ON TABLE public.subcategorias2_produto FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.subcategorias2_produto TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.subcategorias2_produto TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.subcategorias2_produto TO service_role;
REVOKE ALL ON TABLE public.subcategorias_aviamento FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.subcategorias_aviamento TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.subcategorias_aviamento TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.subcategorias_aviamento TO service_role;
REVOKE ALL ON TABLE public.system_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.system_settings TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.system_settings TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.system_settings TO service_role;
REVOKE ALL ON TABLE public.tenant_config FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tenant_config TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tenant_config TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tenant_config TO service_role;
REVOKE ALL ON TABLE public.tenants FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tenants TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tenants TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tenants TO service_role;
REVOKE ALL ON TABLE public.tipos_colaborador FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tipos_colaborador TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tipos_colaborador TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tipos_colaborador TO service_role;
REVOKE ALL ON TABLE public.tipos_insumo FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tipos_insumo TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tipos_insumo TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tipos_insumo TO service_role;
REVOKE ALL ON TABLE public.user_permissions FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.user_permissions TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.user_permissions TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.user_permissions TO service_role;
REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.user_roles TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.user_roles TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.user_roles TO service_role;
REVOKE ALL ON TABLE public.user_ui_prefs FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.user_ui_prefs TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.user_ui_prefs TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.user_ui_prefs TO service_role;
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.users TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.users TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.users TO service_role;
REVOKE ALL ON TABLE public.variantes_aviamento FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.variantes_aviamento TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.variantes_aviamento TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.variantes_aviamento TO service_role;
REVOKE ALL ON TABLE public.variantes_etiqueta FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.variantes_etiqueta TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.variantes_etiqueta TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.variantes_etiqueta TO service_role;
REVOKE ALL ON TABLE public.variantes_tecido FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.variantes_tecido TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.variantes_tecido TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.variantes_tecido TO service_role;

DO $pos$
DECLARE
  r record;
BEGIN
  -- a ACL CRUA (com a ordem dos aclitems) e as colunas voltam EXATAMENTE as de antes
  FOR r IN SELECT * FROM (VALUES
      ('anos', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('artigo_categorias_tecido', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('artigos', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('aviamentos', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('cad', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[{"col":"observacoes_molde","acl":"{authenticated=w/postgres}"},{"col":"direcionamento_status","acl":"{authenticated=w/postgres}"},{"col":"direcionamento_confirmado_at","acl":"{authenticated=w/postgres}"},{"col":"sem_acabamento","acl":"{authenticated=w/postgres}"}]'),
      ('cad_aviamentos', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('cad_etiquetas', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('cad_grades', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('cad_tecido_variantes', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('cad_tecidos', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('categorias_aviamento', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('categorias_fornecedor', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('categorias_produto', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('categorias_tecido', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('categorias_terceirizado', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('colaboradores', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('colecao_mixes', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('colecao_pv_itens', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('colecao_semana_categorias', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('colecao_semanas', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('colecao_subcolecoes', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('colecoes', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('controle_qualidade', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[{"col":"fotografado_variantes","acl":"{authenticated=w/postgres}"}]'),
      ('cores', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('cores_apelido', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('cq_pos_variantes', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('cq_variantes', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('destinos_saida', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('direcionamento', '{postgres=arwdDxtm/postgres,anon=rDxtm/postgres,authenticated=rDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('direcionamento_controle', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('direcionamento_lojas', '{postgres=arwdDxtm/postgres,anon=rDxtm/postgres,authenticated=rDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('empresa_categorias_fornecedor', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('empresa_categorias_servico', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('empresas', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('enderecamento_tecido', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('estoque_tecido_baixas', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('etiquetas', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('grupos_produto', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('intervalos_largura', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('lancamentos', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('linhas', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('lojas_direcionamento', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('materiais_aviamento', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('meses', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('mix_padrao_linhas', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('mix_padroes', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('modelo_aviamentos', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('modelo_etiquetas', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('modelo_grades', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('modelo_kanban_historico', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('modelo_observacoes', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('modelo_prova_comentarios', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('modelo_servico_mo', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('modelo_tecido_oc_links', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('modelo_tecido_variantes', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('modelo_tecidos', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('modelos', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('ocs_aviamento', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rdxtm/postgres,service_role=arwdDxtm/postgres}', '[{"col":"nfs","acl":"{authenticated=w/postgres}"}]'),
      ('ocs_aviamento_itens', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('ocs_etiqueta', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rdxtm/postgres,service_role=arwdDxtm/postgres}', '[{"col":"data_nota_entrada","acl":"{authenticated=w/postgres}"}]'),
      ('ocs_etiqueta_itens', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('ocs_importado', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('ocs_importado_etapas', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('ocs_p_acabado', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('ocs_tecido', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[{"col":"numero_pedido","acl":"{authenticated=w/postgres}"},{"col":"rolo_codigo","acl":"{authenticated=w/postgres}"},{"col":"rolo_rua","acl":"{authenticated=w/postgres}"},{"col":"rolo_prateleira","acl":"{authenticated=w/postgres}"},{"col":"nfs","acl":"{authenticated=w/postgres}"},{"col":"recebimento_responsavel_id","acl":"{authenticated=w/postgres}"},{"col":"recebimento_responsavel_nome","acl":"{authenticated=w/postgres}"}]'),
      ('ocs_tecido_itens', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[{"col":"cancelado","acl":"{authenticated=w/postgres}"},{"col":"cq_observacao","acl":"{authenticated=w/postgres}"},{"col":"cq_ok","acl":"{authenticated=w/postgres}"},{"col":"cq_alerta_status","acl":"{authenticated=w/postgres}"}]'),
      ('ordens_saida_aviamento', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('ordens_saida_aviamento_itens', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('ordens_saida_tecido', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('ordens_saida_tecido_itens', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('otb_simulacao_linhas', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('otb_simulacao_modelos', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('otb_simulacao_unidades', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('otb_simulacao_variantes', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('otb_simulacoes', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('papeis', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('papel_permissoes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('parcelas', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[{"col":"data_vencimento","acl":"{authenticated=w/postgres}"},{"col":"data_pagamento","acl":"{authenticated=w/postgres}"},{"col":"status","acl":"{authenticated=w/postgres}"},{"col":"comprovante_url","acl":"{authenticated=w/postgres}"}]'),
      ('parcelas_servico', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[{"col":"data_vencimento","acl":"{authenticated=w/postgres}"},{"col":"status","acl":"{authenticated=w/postgres}"},{"col":"data_pagamento","acl":"{authenticated=w/postgres}"},{"col":"comprovante_url","acl":"{authenticated=w/postgres}"}]'),
      ('plan_tecido', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('plan_tecido_linhas', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('plan_tecido_materiais', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('plan_tecido_oc_aplicada', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('plan_tecido_ocs', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('plan_tecido_paleta', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('plan_tecido_pedido_fotos', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('plan_tecido_slot_oc', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('plan_tecido_slots', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('plan_tecido_subcolecao_categorias', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('plan_tecido_subcolecoes', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('plan_tecido_variantes', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('producao_oficina', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('producao_terceirizados', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('produto_acabado_variantes', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('produto_importado_etapas', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('produto_importado_variantes', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('produtos_acabados', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[{"col":"modelo_id","acl":"{authenticated=w/postgres}"},{"col":"mix_id","acl":"{authenticated=w/postgres}"}]'),
      ('produtos_importados', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '[{"col":"modelo_id","acl":"{authenticated=w/postgres}"},{"col":"mix_id","acl":"{authenticated=w/postgres}"}]'),
      ('profiles', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('ref_sequencia', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('representantes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('subcategorias1_produto', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('subcategorias2_produto', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('subcategorias_aviamento', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('system_settings', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('tenant_config', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('tenants', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('tipos_colaborador', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('tipos_insumo', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('user_permissions', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('user_roles', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('user_ui_prefs', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('users', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('variantes_aviamento', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('variantes_etiqueta', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]'),
      ('variantes_tecido', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '[]')
    ) AS x(t, acl, cols) LOOP
    IF (SELECT coalesce(c.relacl::text, '') FROM pg_class c WHERE c.oid = to_regclass('public.' || r.t)) IS DISTINCT FROM r.acl
       OR (SELECT coalesce(json_agg(json_build_object('col', a.attname, 'acl', a.attacl::text) ORDER BY a.attnum), '[]'::json)::text FROM pg_attribute a
            WHERE a.attrelid = to_regclass('public.' || r.t) AND a.attacl IS NOT NULL AND NOT a.attisdropped)::jsonb IS DISTINCT FROM r.cols::jsonb THEN
      RAISE EXCEPTION 's5_privilegios_down: pos-condicao falhou: ACL de % nao voltou exatamente a de antes', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF (SELECT proacl::text FROM pg_proc WHERE oid = to_regprocedure('public.tenant_module_enabled(text)')) IS DISTINCT FROM '{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 's5_privilegios_down: pos-condicao falhou: EXECUTE de public.tenant_module_enabled(text) nao voltou exatamente o de antes' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT proacl::text FROM pg_proc WHERE oid = to_regprocedure('public.user_can_edit(text)')) IS DISTINCT FROM '{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 's5_privilegios_down: pos-condicao falhou: EXECUTE de public.user_can_edit(text) nao voltou exatamente o de antes' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT proacl::text FROM pg_proc WHERE oid = to_regprocedure('public.user_can_view(text)')) IS DISTINCT FROM '{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 's5_privilegios_down: pos-condicao falhou: EXECUTE de public.user_can_view(text) nao voltou exatamente o de antes' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT proacl::text FROM pg_proc WHERE oid = to_regprocedure('public.meu_tenant_ativo()')) IS DISTINCT FROM '{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 's5_privilegios_down: pos-condicao falhou: EXECUTE de public.meu_tenant_ativo() nao voltou exatamente o de antes' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
