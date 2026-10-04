-- Inverso de supabase/migrations/20261101240000_seg_s5_privilegios.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s5.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§S5). Por cima da S4 (o "antes" é o estado de depois da S3a..S4).
-- Devolve EXATAMENTE o que a ida tirou (lista por tabela e papel, do aclexplode de antes).
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
      ('anos', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('artigo_categorias_tecido', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('artigos', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('aviamentos', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cad', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'observacoes_molde={authenticated=w/postgres} direcionamento_status={authenticated=w/postgres} direcionamento_confirmado_at={authenticated=w/postgres} sem_acabamento={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'observacoes_molde={authenticated=w/postgres} direcionamento_status={authenticated=w/postgres} direcionamento_confirmado_at={authenticated=w/postgres} sem_acabamento={authenticated=w/postgres}'),
      ('cad_aviamentos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cad_etiquetas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cad_grades', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cad_tecido_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cad_tecidos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('categorias_aviamento', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('categorias_fornecedor', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('categorias_produto', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('categorias_tecido', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('categorias_terceirizado', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colaboradores', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecao_mixes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecao_pv_itens', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecao_semana_categorias', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecao_semanas', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecao_subcolecoes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecoes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('controle_qualidade', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'fotografado_variantes={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'fotografado_variantes={authenticated=w/postgres}'),
      ('cores', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cores_apelido', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cq_pos_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cq_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('destinos_saida', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('direcionamento', 'anon=rDxtm/postgres,authenticated=rDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('direcionamento_controle', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('direcionamento_lojas', 'anon=rDxtm/postgres,authenticated=rDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('empresa_categorias_fornecedor', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('empresa_categorias_servico', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('empresas', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('enderecamento_tecido', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('estoque_tecido_baixas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('etiquetas', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('grupos_produto', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('intervalos_largura', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('lancamentos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('linhas', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('lojas_direcionamento', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('materiais_aviamento', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('meses', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('mix_padrao_linhas', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('mix_padroes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_aviamentos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_etiquetas', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_grades', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_kanban_historico', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_observacoes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_prova_comentarios', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_servico_mo', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_tecido_oc_links', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_tecido_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_tecidos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelos', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_aviamento', 'anon=rxtm/postgres,authenticated=rdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'nfs={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'nfs={authenticated=w/postgres}'),
      ('ocs_aviamento_itens', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_etiqueta', 'anon=rxtm/postgres,authenticated=rdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_nota_entrada={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_nota_entrada={authenticated=w/postgres}'),
      ('ocs_etiqueta_itens', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_importado', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_importado_etapas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_p_acabado', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_tecido', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'numero_pedido={authenticated=w/postgres} rolo_codigo={authenticated=w/postgres} rolo_rua={authenticated=w/postgres} rolo_prateleira={authenticated=w/postgres} nfs={authenticated=w/postgres} recebimento_responsavel_id={authenticated=w/postgres} recebimento_responsavel_nome={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'numero_pedido={authenticated=w/postgres} rolo_codigo={authenticated=w/postgres} rolo_rua={authenticated=w/postgres} rolo_prateleira={authenticated=w/postgres} nfs={authenticated=w/postgres} recebimento_responsavel_id={authenticated=w/postgres} recebimento_responsavel_nome={authenticated=w/postgres}'),
      ('ocs_tecido_itens', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'cancelado={authenticated=w/postgres} cq_observacao={authenticated=w/postgres} cq_ok={authenticated=w/postgres} cq_alerta_status={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'cancelado={authenticated=w/postgres} cq_observacao={authenticated=w/postgres} cq_ok={authenticated=w/postgres} cq_alerta_status={authenticated=w/postgres}'),
      ('ordens_saida_aviamento', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ordens_saida_aviamento_itens', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ordens_saida_tecido', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ordens_saida_tecido_itens', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('otb_simulacao_linhas', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('otb_simulacao_modelos', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('otb_simulacao_unidades', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('otb_simulacao_variantes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('otb_simulacoes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('papeis', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('papel_permissoes', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('parcelas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_vencimento={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} status={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_vencimento={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} status={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}'),
      ('parcelas_servico', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_vencimento={authenticated=w/postgres} status={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_vencimento={authenticated=w/postgres} status={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}'),
      ('plan_tecido', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_linhas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_materiais', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_oc_aplicada', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_ocs', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_paleta', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_pedido_fotos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_slot_oc', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_slots', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_subcolecao_categorias', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_subcolecoes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('producao_oficina', 'anon=rxtm/postgres,authenticated=arwxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('producao_terceirizados', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('produto_acabado_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('produto_importado_etapas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('produto_importado_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('produtos_acabados', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'modelo_id={authenticated=w/postgres} mix_id={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'modelo_id={authenticated=w/postgres} mix_id={authenticated=w/postgres}'),
      ('produtos_importados', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'modelo_id={authenticated=w/postgres} mix_id={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'modelo_id={authenticated=w/postgres} mix_id={authenticated=w/postgres}'),
      ('profiles', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ref_sequencia', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('representantes', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('subcategorias1_produto', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('subcategorias2_produto', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('subcategorias_aviamento', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('system_settings', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=rm/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('tenant_config', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('tenants', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('tipos_colaborador', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('tipos_insumo', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('user_permissions', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('user_roles', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('user_ui_prefs', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('users', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('variantes_aviamento', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('variantes_etiqueta', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('variantes_tecido', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '')
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
END
$guarda$;

GRANT EXECUTE ON FUNCTION public.tenant_module_enabled(text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_edit(text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_view(text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_tenant_ativo() TO PUBLIC, anon;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.anos TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.artigo_categorias_tecido TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.artigos TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.aviamentos TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.cad TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.cad_aviamentos TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.cad_etiquetas TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.cad_grades TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.cad_tecido_variantes TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.cad_tecidos TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.categorias_aviamento TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.categorias_fornecedor TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.categorias_produto TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.categorias_tecido TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.categorias_terceirizado TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.colaboradores TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.colecao_mixes TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.colecao_pv_itens TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.colecao_semana_categorias TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.colecao_semanas TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.colecao_subcolecoes TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.colecoes TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.controle_qualidade TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.cores TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.cores_apelido TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.cq_pos_variantes TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.cq_variantes TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.destinos_saida TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.direcionamento TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.direcionamento_controle TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.direcionamento_lojas TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.empresa_categorias_fornecedor TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.empresa_categorias_servico TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.empresas TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.enderecamento_tecido TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.estoque_tecido_baixas TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.etiquetas TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.grupos_produto TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.intervalos_largura TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.lancamentos TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.linhas TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lojas_direcionamento TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.materiais_aviamento TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.meses TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.mix_padrao_linhas TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.mix_padroes TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.modelo_aviamentos TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.modelo_etiquetas TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.modelo_grades TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.modelo_kanban_historico TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.modelo_observacoes TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.modelo_prova_comentarios TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.modelo_servico_mo TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.modelo_tecido_oc_links TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.modelo_tecido_variantes TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.modelo_tecidos TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.modelos TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.ocs_aviamento TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.ocs_aviamento_itens TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.ocs_etiqueta TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.ocs_etiqueta_itens TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.ocs_importado TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.ocs_importado_etapas TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.ocs_p_acabado TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.ocs_tecido TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.ocs_tecido_itens TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.ordens_saida_aviamento TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.ordens_saida_aviamento_itens TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.ordens_saida_tecido TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.ordens_saida_tecido_itens TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.otb_simulacao_linhas TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.otb_simulacao_modelos TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.otb_simulacao_unidades TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.otb_simulacao_variantes TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.otb_simulacoes TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.papeis TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.papel_permissoes TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.parcelas TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.parcelas_servico TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.plan_tecido TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.plan_tecido_linhas TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.plan_tecido_materiais TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.plan_tecido_oc_aplicada TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.plan_tecido_ocs TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.plan_tecido_paleta TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.plan_tecido_pedido_fotos TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.plan_tecido_slot_oc TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.plan_tecido_slots TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.plan_tecido_subcolecao_categorias TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.plan_tecido_subcolecoes TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.plan_tecido_variantes TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.producao_oficina TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.producao_terceirizados TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.produto_acabado_variantes TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.produto_importado_etapas TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.produto_importado_variantes TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.produtos_acabados TO authenticated;
GRANT REFERENCES, TRIGGER ON TABLE public.produtos_importados TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.profiles TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ref_sequencia TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.representantes TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.subcategorias_aviamento TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.subcategorias1_produto TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.subcategorias2_produto TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.system_settings TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tenant_config TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tenants TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tipos_colaborador TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tipos_insumo TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.user_permissions TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.user_roles TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.user_ui_prefs TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.users TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.variantes_aviamento TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.variantes_etiqueta TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.variantes_tecido TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.anos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.artigo_categorias_tecido TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.artigos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.aviamentos TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.cad TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.cad_aviamentos TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.cad_etiquetas TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.cad_grades TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.cad_tecido_variantes TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.cad_tecidos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.categorias_aviamento TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.categorias_fornecedor TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.categorias_produto TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.categorias_tecido TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.categorias_terceirizado TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.colaboradores TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.colecao_mixes TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.colecao_pv_itens TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.colecao_semana_categorias TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.colecao_semanas TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.colecao_subcolecoes TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.colecoes TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.controle_qualidade TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.cores TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.cores_apelido TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.cq_pos_variantes TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.cq_variantes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.destinos_saida TO anon;
GRANT SELECT, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.direcionamento TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.direcionamento_controle TO anon;
GRANT SELECT, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.direcionamento_lojas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.empresa_categorias_fornecedor TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.empresa_categorias_servico TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.empresas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.enderecamento_tecido TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.estoque_tecido_baixas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.etiquetas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.grupos_produto TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.intervalos_largura TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.lancamentos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.linhas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lojas_direcionamento TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.materiais_aviamento TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.meses TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.mix_padrao_linhas TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.mix_padroes TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.modelo_aviamentos TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.modelo_etiquetas TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.modelo_grades TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.modelo_kanban_historico TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.modelo_observacoes TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.modelo_prova_comentarios TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.modelo_servico_mo TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.modelo_tecido_oc_links TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.modelo_tecido_variantes TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.modelo_tecidos TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.modelos TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.ocs_aviamento TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.ocs_aviamento_itens TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.ocs_etiqueta TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.ocs_etiqueta_itens TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.ocs_importado TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.ocs_importado_etapas TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.ocs_p_acabado TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.ocs_tecido TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.ocs_tecido_itens TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.ordens_saida_aviamento TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.ordens_saida_aviamento_itens TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.ordens_saida_tecido TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.ordens_saida_tecido_itens TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.otb_simulacao_linhas TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.otb_simulacao_modelos TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.otb_simulacao_unidades TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.otb_simulacao_variantes TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.otb_simulacoes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.papeis TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.papel_permissoes TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.parcelas TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.parcelas_servico TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.plan_tecido TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.plan_tecido_linhas TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.plan_tecido_materiais TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.plan_tecido_oc_aplicada TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.plan_tecido_ocs TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.plan_tecido_paleta TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.plan_tecido_pedido_fotos TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.plan_tecido_slot_oc TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.plan_tecido_slots TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.plan_tecido_subcolecao_categorias TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.plan_tecido_subcolecoes TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.plan_tecido_variantes TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.producao_oficina TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.producao_terceirizados TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.produto_acabado_variantes TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.produto_importado_etapas TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.produto_importado_variantes TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.produtos_acabados TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.produtos_importados TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ref_sequencia TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.representantes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.subcategorias_aviamento TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.subcategorias1_produto TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.subcategorias2_produto TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.system_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tenant_config TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tenants TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tipos_colaborador TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tipos_insumo TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.user_permissions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.user_roles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.user_ui_prefs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.users TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.variantes_aviamento TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.variantes_etiqueta TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.variantes_tecido TO anon;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('anos', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('artigo_categorias_tecido', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('artigos', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('aviamentos', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cad', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'observacoes_molde={authenticated=w/postgres} direcionamento_status={authenticated=w/postgres} direcionamento_confirmado_at={authenticated=w/postgres} sem_acabamento={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'observacoes_molde={authenticated=w/postgres} direcionamento_status={authenticated=w/postgres} direcionamento_confirmado_at={authenticated=w/postgres} sem_acabamento={authenticated=w/postgres}'),
      ('cad_aviamentos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cad_etiquetas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cad_grades', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cad_tecido_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cad_tecidos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('categorias_aviamento', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('categorias_fornecedor', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('categorias_produto', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('categorias_tecido', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('categorias_terceirizado', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colaboradores', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecao_mixes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecao_pv_itens', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecao_semana_categorias', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecao_semanas', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecao_subcolecoes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('colecoes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('controle_qualidade', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'fotografado_variantes={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'fotografado_variantes={authenticated=w/postgres}'),
      ('cores', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cores_apelido', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cq_pos_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('cq_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('destinos_saida', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('direcionamento', 'anon=rDxtm/postgres,authenticated=rDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('direcionamento_controle', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('direcionamento_lojas', 'anon=rDxtm/postgres,authenticated=rDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('empresa_categorias_fornecedor', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('empresa_categorias_servico', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('empresas', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('enderecamento_tecido', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('estoque_tecido_baixas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('etiquetas', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('grupos_produto', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('intervalos_largura', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('lancamentos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('linhas', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('lojas_direcionamento', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('materiais_aviamento', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('meses', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('mix_padrao_linhas', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('mix_padroes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_aviamentos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_etiquetas', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_grades', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_kanban_historico', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_observacoes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_prova_comentarios', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_servico_mo', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_tecido_oc_links', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_tecido_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelo_tecidos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('modelos', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_aviamento', 'anon=rxtm/postgres,authenticated=rdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'nfs={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'nfs={authenticated=w/postgres}'),
      ('ocs_aviamento_itens', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_etiqueta', 'anon=rxtm/postgres,authenticated=rdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_nota_entrada={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_nota_entrada={authenticated=w/postgres}'),
      ('ocs_etiqueta_itens', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_importado', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_importado_etapas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_p_acabado', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ocs_tecido', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'numero_pedido={authenticated=w/postgres} rolo_codigo={authenticated=w/postgres} rolo_rua={authenticated=w/postgres} rolo_prateleira={authenticated=w/postgres} nfs={authenticated=w/postgres} recebimento_responsavel_id={authenticated=w/postgres} recebimento_responsavel_nome={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'numero_pedido={authenticated=w/postgres} rolo_codigo={authenticated=w/postgres} rolo_rua={authenticated=w/postgres} rolo_prateleira={authenticated=w/postgres} nfs={authenticated=w/postgres} recebimento_responsavel_id={authenticated=w/postgres} recebimento_responsavel_nome={authenticated=w/postgres}'),
      ('ocs_tecido_itens', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'cancelado={authenticated=w/postgres} cq_observacao={authenticated=w/postgres} cq_ok={authenticated=w/postgres} cq_alerta_status={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'cancelado={authenticated=w/postgres} cq_observacao={authenticated=w/postgres} cq_ok={authenticated=w/postgres} cq_alerta_status={authenticated=w/postgres}'),
      ('ordens_saida_aviamento', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ordens_saida_aviamento_itens', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ordens_saida_tecido', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ordens_saida_tecido_itens', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('otb_simulacao_linhas', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('otb_simulacao_modelos', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('otb_simulacao_unidades', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('otb_simulacao_variantes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('otb_simulacoes', 'anon=rxtm/postgres,authenticated=arwdxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('papeis', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('papel_permissoes', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('parcelas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_vencimento={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} status={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_vencimento={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} status={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}'),
      ('parcelas_servico', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_vencimento={authenticated=w/postgres} status={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'data_vencimento={authenticated=w/postgres} status={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}'),
      ('plan_tecido', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_linhas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_materiais', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_oc_aplicada', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_ocs', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_paleta', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_pedido_fotos', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_slot_oc', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_slots', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_subcolecao_categorias', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_subcolecoes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('plan_tecido_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('producao_oficina', 'anon=rxtm/postgres,authenticated=arwxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('producao_terceirizados', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('produto_acabado_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('produto_importado_etapas', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('produto_importado_variantes', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('produtos_acabados', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'modelo_id={authenticated=w/postgres} mix_id={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'modelo_id={authenticated=w/postgres} mix_id={authenticated=w/postgres}'),
      ('produtos_importados', 'anon=rxtm/postgres,authenticated=rxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'modelo_id={authenticated=w/postgres} mix_id={authenticated=w/postgres}', 'anon=m/postgres,authenticated=rm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', 'modelo_id={authenticated=w/postgres} mix_id={authenticated=w/postgres}'),
      ('profiles', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('ref_sequencia', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('representantes', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('subcategorias1_produto', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('subcategorias2_produto', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('subcategorias_aviamento', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('system_settings', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=rm/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('tenant_config', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('tenants', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('tipos_colaborador', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('tipos_insumo', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('user_permissions', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('user_roles', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('user_ui_prefs', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('users', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('variantes_aviamento', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('variantes_etiqueta', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', ''),
      ('variantes_tecido', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '', 'anon=m/postgres,authenticated=arwdm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres', '')
    ) AS x(t, a_acl, a_cols, d_acl, d_cols) LOOP
    IF (SELECT coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(c.relacl) x), '') FROM pg_class c
         WHERE c.oid = to_regclass('public.' || r.t)) IS DISTINCT FROM r.a_acl THEN
      RAISE EXCEPTION 's5_privilegios_down: pos-condicao falhou: ACL de % nao voltou a de antes', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
