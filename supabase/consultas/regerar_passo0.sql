-- Passo 0 (SO LEITURA) do deploy dos botoes "Regerar REF" (card) e "Regerar todos os SKUs da loja". Rodar em PRODUCAO ANTES da ida:
--   psql "$(cat /tmp/dburl.txt)" -f supabase/consultas/regerar_passo0.sql
-- Nenhuma escrita. PARAR e chamar o controlador se (A) trouxer qualquer objeto ja existente, (B) trouxer md5 diferente do esperado, (D) mostrar
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
         when '6d68b20b0e5086a9a9dc0c87a8b42c69' then 'ok' when '858abf9fddb6e3ffb7bcc2b0d2c419d1' then 'ok'
         when '61e814868e4b8f014f227db28ee51495' then 'ok' when '82ecd0ea8f67bf9590a98cbd5851ee38' then 'ok'
         else 'DIVERGE - PARAR' end as confere
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('fn_modelo_ref_auto', '_aplicar_skus_modelo_core', '_skus_previa_core', '_skus_plano')
 order by 1::text;
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
