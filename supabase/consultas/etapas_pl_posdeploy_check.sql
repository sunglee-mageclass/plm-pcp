-- Pos-deploy (SO LEITURA) — confere que a cadeia do Kanban PL (Ondas 1+2+3) ficou completa no banco.
-- Esperado: funcoes_chave = 7 (todas presentes), coluna_status = 1, duplicatas_restantes = 0.
SELECT
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN
       ('_avaliar_condicoes_etapas_pl_core','_etapas_pl_entrada_avaliar','etapas_pl_mover',
        'etapas_pl_definir_automatico','_kanban_pl_seed_etapas','fn_etapas_pl_entrada_cad','_etapas_pl_derivar_lote')
  ) AS funcoes_chave_de_7,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name='modelos' AND column_name='status_etapa_pl') AS coluna_status_etapa_pl,
  (SELECT count(*) FROM pg_trigger WHERE tgname='trg_etapas_pl_entrada_cad' AND NOT tgisinternal) AS gatilho_entrada_cad,
  (SELECT count(*) FROM (
      SELECT modelo_id FROM public.modelo_servico_mo s
      JOIN public.categorias_terceirizado ct ON ct.id=s.categoria_terceirizado_id AND ct.exige_peca_teste
      WHERE s.categoria_terceirizado_id IS NOT NULL
      GROUP BY modelo_id, categoria_terceirizado_id HAVING count(*)>1) d) AS duplicatas_mo_restantes,
  (SELECT count(*) FROM tenant_config WHERE etapas_pl_automatico IS TRUE) AS lojas_com_chave_ligada
