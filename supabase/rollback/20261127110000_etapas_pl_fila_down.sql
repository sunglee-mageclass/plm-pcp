-- Volta da 20261127110000 (Kanban PL Onda 2, motor da fila: Tasks 2/4/3). Tudo NOVO (tabela, funcoes, gatilhos
-- com nomes proprios etapas_pl_*) -> DROP seguro (nada na base nem na tela usa ainda; etapas_pl_automatico default
-- false). Idempotente (IF EXISTS). Os gatilhos ficam em tabelas de NEGOCIO (nao auth/storage), entao DROP TRIGGER
-- NAO trava o login -> um unico _down (sem _down_drop separado). Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/20261127110000_etapas_pl_fila_down.sql
SET client_encoding = 'UTF8';
BEGIN;

-- Task 3: CONSTRAINT TRIGGER + processador
DROP TRIGGER IF EXISTS trg_etapas_pl_processar_fila ON public.etapas_pl_recalculo_fila;
DROP TRIGGER IF EXISTS trg_etapas_pl_processar_fila_upd ON public.etapas_pl_recalculo_fila;
DROP FUNCTION IF EXISTS public.fn_etapas_pl_processar_fila();

-- Task 4: historico + aplicador
DROP TRIGGER IF EXISTS trg_etapas_pl_historico ON public.modelos;
DROP FUNCTION IF EXISTS public.fn_etapas_pl_historico();
DROP FUNCTION IF EXISTS public._etapas_pl_aplicar(uuid, uuid[], text, uuid);

-- Task 2: gatilhos-fonte
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_upd ON public.modelos;
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_ins ON public.modelos;
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_cad_ins ON public.cad;
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_cad_upd ON public.cad;
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_cad_del ON public.cad;
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_cat_upd ON public.categorias_terceirizado;
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_cat_del ON public.categorias_terceirizado;
DO $do$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['modelo_servico_mo','modelo_peca_teste_tentativas','controle_qualidade','producao_terceirizados'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_etapas_pl_fila_ins ON public.%I', r);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_etapas_pl_fila_upd ON public.%I', r);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_etapas_pl_fila_del ON public.%I', r);
  END LOOP;
END
$do$;
DROP FUNCTION IF EXISTS public.fn_etapas_pl_fila_modelo();
DROP FUNCTION IF EXISTS public.fn_etapas_pl_fila_por_modelo();
DROP FUNCTION IF EXISTS public.fn_etapas_pl_fila_por_cad();
DROP FUNCTION IF EXISTS public.fn_etapas_pl_fila_cad();
DROP FUNCTION IF EXISTS public.fn_etapas_pl_fila_categoria();
DROP FUNCTION IF EXISTS public._etapas_pl_enfileirar(uuid[]);
DROP FUNCTION IF EXISTS public._etapas_pl_enfileirar_tenant(uuid);

-- Task 2: fila
DROP TABLE IF EXISTS public.etapas_pl_recalculo_fila;

COMMIT;
