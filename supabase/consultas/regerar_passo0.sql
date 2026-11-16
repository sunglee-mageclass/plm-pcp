-- Passo 0 (SO LEITURA) do deploy dos botoes "Regerar REF" (card) e "Regerar todos os SKUs da loja". Rodar em PRODUCAO ANTES da ida:
--   psql "$(cat /tmp/dburl.txt)" -f supabase/consultas/regerar_passo0.sql
-- Nenhuma escrita (so SELECT/\echo). Inclui as pre-condicoes do DEPLOY UNICO (G, H). PARAR e chamar o controlador se (A) trouxer qualquer objeto ja existente, (B) trouxer md5 diferente do esperado, (D) mostrar
-- integraveis/integrados/exportados onde o dono disse zero, ou (C) destoar muito dos numeros do dono (Ave Rara: 132 REF = ref_auto, 253 manuais, 19 replicas).
\pset pager off
\echo === (A) a ida ainda NAO foi aplicada: todas as colunas abaixo devem ser NULL
select to_regprocedure('public._regerar_pulo_integracao(uuid)') as pulo,
       to_regprocedure('public._regerar_ref_calcular(uuid)') as ref_calc,
       to_regprocedure('public.ref_regerar_previa(uuid)') as ref_previa,
       to_regprocedure('public.regerar_ref_card(uuid,text,boolean,text)') as ref_card,
       to_regprocedure('public.regerar_skus_loja_previa(uuid,uuid,integer)') as loja_previa,
       to_regprocedure('public.regerar_skus_loja_aplicar(uuid,jsonb)') as loja_aplicar;
\echo === (B) funcoes que a ida SO LE (o calculo espelha o fn_modelo_ref_auto): os md5 abaixo sao os da copia local em 16/nov; a ida RECUSA se divergirem
select p.oid::regprocedure as funcao, md5(pg_get_functiondef(p.oid)) as md5,
       case md5(pg_get_functiondef(p.oid))
         when '6d68b20b0e5086a9a9dc0c87a8b42c69' then 'ok' when '858abf9fddb6e3ffb7bcc2b0d2c419d1' then 'ok' when 'fd7ac0cf1b778711ac2098d41e16ead6' then 'ok'
         when '61e814868e4b8f014f227db28ee51495' then 'ok' when '82ecd0ea8f67bf9590a98cbd5851ee38' then 'ok'
         when 'f2e513e6f1b6754c968d98b2ee0ea7c1' then 'ok' when '5980345a105818b26329c8a4e594fee2' then 'ok'
         else 'DIVERGE - PARAR' end as confere
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('fn_modelo_ref_auto', '_aplicar_skus_modelo_core', '_skus_previa_core', '_skus_plano')
 order by p.proname;
\echo === (C) por loja: cards INTERNOS por tipo de REF (automatica = ref = ref_auto; manual = ref <> ref_auto; vazia) e sem numero reaproveitavel
select t.nome as loja,
       count(*) filter (where m.origem = 'interno') as internos,
       count(*) filter (where m.origem = 'interno' and coalesce(m.ref, '') <> '' and m.ref = m.ref_auto) as ref_automatica,
       count(*) filter (where m.origem = 'interno' and coalesce(m.ref, '') <> '' and m.ref is distinct from m.ref_auto) as ref_manual,
       count(*) filter (where m.origem = 'interno' and coalesce(m.ref, '') = '') as ref_vazia,
       count(*) filter (where m.origem = 'interno' and coalesce(m.ref_auto, '') !~ '[0-9]+$') as sem_numero_no_ref_auto,
       count(*) filter (where m.modelo_base_id is not null) as replicas,
       count(*) as modelos_total
  from public.modelos m join public.tenants t on t.id = m.tenant_id
 group by t.nome order by modelos_total desc;
\echo === (D) Integracao: produtos integraveis/integrados e rastros de exportacao POR LOJA (o dono informou ZERO integraveis/integrados)
select t.nome as loja,
       count(*) filter (where ip.estado = 'integravel') as integraveis,
       count(*) filter (where ip.estado = 'integrado') as integrados,
       count(*) filter (where ip.integrado_em is not null or ip.desfeito_em is not null) as com_rastro_no_produto,
       (select count(distinct l.modelo_id) from public.integracao_log l where l.tenant_id = t.id and l.acao in ('integrado', 'desfazer')) as com_log_integrado_ou_desfazer,
       (select count(distinct il.modelo_id) from public.integracao_linhas il where il.tenant_id = t.id) as com_linhas_no_espelho
  from public.tenants t left join public.integracao_produtos ip on ip.tenant_id = t.id
 group by t.id, t.nome order by t.nome;
\echo === (E) lote da loja: Formato do SKU por loja e quantos produtos cada pagina de 25 vai percorrer
select t.nome as loja, (tc.sku_config is not null and coalesce(tc.sku_config -> 'partes', 'null'::jsonb) <> '[]'::jsonb) as tem_formato_sku,
       (select count(*) from public.modelos m where m.tenant_id = t.id) as produtos,
       ceil((select count(*) from public.modelos m where m.tenant_id = t.id) / 25.0) as paginas_de_25,
       (select count(*) from public.modelo_skus s where s.tenant_id = t.id) as skus_gravados
  from public.tenants t left join public.tenant_config tc on tc.tenant_id = t.id order by produtos desc;
\echo === (F) arquivos: o maior numero de migration no repo deve ser menor que 20261201100000 (conferir com: ls supabase/migrations | tail -3)
\echo === (G) "Exportar dados" (20261122100000): as 2 colunas abaixo devem trazer o NOME da funcao. NULL = aplicar 20261122100000_exportar_dados ANTES da Peca Teste (o site novo quebra sem ela; o _down e 20261122100000_exportar_dados_down.sql e NAO esta na volta LIFO deste kit)
select to_regprocedure('public.exportar_produtos(text,text,text[],text[],integer)') as exportar_produtos,
       to_regprocedure('public.exportar_subcolecoes(text)') as exportar_subcolecoes;
\echo === (H) linha de base de PRODUCAO (producao NAO tem schema_migrations): objetos das migrations 20261124..20261128 devem existir (todos 'sim'); e os 8 textos que a Peca Teste (20261129*) vai trocar devem estar no ANTES (coluna 'estado' = 'ANTES ok'). Qualquer 'NAO' ou 'DIVERGE - PARAR' = a base de producao difere do esperado: PARAR e chamar o controlador (a ordem da ida pode mudar). Na COPIA LOCAL, onde a Peca Teste ja esta aplicada, 'estado' mostra 'DEPOIS (ja aplicada)' - normal.
select m.migration, m.objeto, case when m.existe then 'sim' else 'NAO' end as existe from (values
  ('20261124100000 f6_explosao_requisitos', 'tenant_config.explosao_requisitos',
     exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_config' and column_name = 'explosao_requisitos')),
  ('20261125100000 peca_teste_status_lote', 'peca_teste_status_lote(uuid[])', to_regprocedure('public.peca_teste_status_lote(uuid[])') is not null),
  ('20261126100000 kanban_pl_onda1', 'modelos.status_etapa_pl', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'modelos' and column_name = 'status_etapa_pl')),
  ('20261126100000 kanban_pl_onda1', 'tabela modelo_etapa_pl_historico', to_regclass('public.modelo_etapa_pl_historico') is not null),
  ('20261126110000 kanban_pl_avaliador', 'avaliar_condicoes_etapas_pl(uuid[])', to_regprocedure('public.avaliar_condicoes_etapas_pl(uuid[])') is not null),
  ('20261127100000 etapas_pl_cfg', '_etapas_pl_cfg(uuid)', to_regprocedure('public._etapas_pl_cfg(uuid)') is not null),
  ('20261127110000 etapas_pl_fila', 'tabela etapas_pl_recalculo_fila', to_regclass('public.etapas_pl_recalculo_fila') is not null),
  ('20261127120000 etapas_pl_guard_mover', 'etapas_pl_mover(uuid,text)', to_regprocedure('public.etapas_pl_mover(uuid,text)') is not null),
  ('20261127130000 etapas_pl_chave', 'tabela etapas_pl_snapshot', to_regclass('public.etapas_pl_snapshot') is not null),
  ('20261127140000 etapas_pl_entrada', '_etapas_pl_entrada_avaliar(uuid)', to_regprocedure('public._etapas_pl_entrada_avaliar(uuid)') is not null),
  ('20261127150000 etapas_pl_board_vazio', '_etapas_pl_derivar_lote(uuid,uuid[],jsonb)', to_regprocedure('public._etapas_pl_derivar_lote(uuid,uuid[],jsonb)') is not null),
  ('20261128100000 etapas_pl_entrada_configuravel', '_kanban_pl_seed_etapas(uuid)', to_regprocedure('public._kanban_pl_seed_etapas(uuid)') is not null),
  ('20261128100000 etapas_pl_entrada_configuravel', 'fn_etapas_pl_entrada_cad()', to_regprocedure('public.fn_etapas_pl_entrada_cad()') is not null),
  ('20261128110000 etapas_pl_mover_manual', 'etapas_pl_mover(uuid,text) md5 cb0861a0 (copia local em 16/nov)',
     coalesce((select left(md5(pg_get_functiondef(p.oid)), 8) = 'cb0861a0' from pg_proc p where p.oid = to_regprocedure('public.etapas_pl_mover(uuid,text)')), false))
) as m(migration, objeto, existe) order by 1, 2;
select p.oid::regprocedure as funcao, left(md5(pg_get_functiondef(p.oid)), 8) as md5,
       case left(md5(pg_get_functiondef(p.oid)), 8)
         when a.antes then 'ANTES ok' when a.depois then 'DEPOIS (ja aplicada)' else 'DIVERGE - PARAR' end as estado
  from pg_proc p
  join (values
    ('_peca_teste_aprovada', '417fa985', '04c14fd4'), ('_salvar_peca_teste_core', '3e3b9db2', 'c80bdd3b'),
    ('_peca_teste_mini_aplicar', 'e6c43399', 'd6bcaf59'), ('fn_peca_teste_trava_fornecedor', '982769d4', '7ddd1abd'),
    ('_peca_teste_trilhas_core', 'ef860a61', '19888461'), ('_peca_teste_quadro_core', '6e191644', '70042cda'),
    ('_peca_teste_status_lote_core', 'fff007eb', 'b0f16878'), ('_avaliar_condicoes_etapas_pl_core', 'f1b0fb72', '04a8d5cd')
  ) as a(proname, antes, depois) on a.proname = p.proname
 where p.pronamespace = 'public'::regnamespace
 order by p.proname;
