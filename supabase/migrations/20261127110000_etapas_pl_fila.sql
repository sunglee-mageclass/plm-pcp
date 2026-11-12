-- Kanban PL configuravel - Onda 2: MOTOR da fila do board PL (Tasks 2, 4 e 3, nesta ordem).
-- ADITIVA e idempotente (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP/CREATE TRIGGER). SO BANCO;
-- nenhuma tela usa ainda (etapas_pl_automatico default false - a frente so liga na Onda 3). Espelha o motor do Dev
-- (20260930120000 tabela, 20261027100000 enfileiradores/processador, 20260930140000 gatilhos-fonte/historico,
-- 20261027140000 aplicador) para o board PL, com NOMES PROPRIOS etapas_pl_* e GUCs app.etapas_pl_*.
--
-- Diferencas do Dev (board PL):
--   - fila enfileira modelo de loja com etapas_pl_automatico E status_etapa_pl IS NOT NULL (esta no PL),
--     NAO "ordem_criacao_enviada AND NOT lancado".
--   - gatilhos-fonte so nas tabelas das condicoes PL: modelos (por linha), cad/producao_terceirizados/
--     controle_qualidade (statement-level via cad_id), modelo_servico_mo/modelo_peca_teste_tentativas (via modelo_id),
--     categorias_terceirizado (loja inteira).
--   - aplicador grava SO status_etapa_pl (PL nao revela REF - sem a clausula ref/ref_auto do Dev).
--   - historico escreve em modelo_etapa_pl_historico (ja existe, 20261126100000).
--   - guarda de recursao: GUC app.etapas_pl_sistema (nao app.kanban_sistema).
--
-- REUSA as puras do Dev via _etapas_pl_derivar_lote (Task 1, 20261127100000). Ordem interna: T2 (fila) -> T4
-- (aplicador+historico, pois o processador o chama) -> T3 (processador + CONSTRAINT TRIGGER).
--
-- RAISE 5xx so ASCII. Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261127110000_etapas_pl_fila.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza). Trava: so catalogo + tabela nova + gatilhos em tabelas de
-- NEGOCIO (nao auth/storage), ms.
-- Volta: supabase/rollback/20261127110000_etapas_pl_fila_down.sql (DROP triggers+funcoes+tabela - tudo NOVO, seguro).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '60s';

-- ════════════════════════════════════════════════════════════════════════════
-- TASK 2 - Fila + enfileiradores + gatilhos-fonte das condicoes PL
-- ════════════════════════════════════════════════════════════════════════════

-- Fila do recalculo adiado do PL (espelho de kanban_recalculo_fila, 20260930120000:40).
CREATE TABLE IF NOT EXISTS public.etapas_pl_recalculo_fila (
  modelo_id uuid PRIMARY KEY REFERENCES public.modelos(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  criado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_etapas_pl_fila_tenant ON public.etapas_pl_recalculo_fila (tenant_id);
ALTER TABLE public.etapas_pl_recalculo_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.etapas_pl_recalculo_fila FROM PUBLIC, anon, authenticated;

-- Enfileirar por ids (espelho de _kanban_enfileirar, 20261027100000:192). So entra modelo de loja com a CHAVE
-- LIGADA e no PL (status_etapa_pl IS NOT NULL), e so com GUC vazio (escrita do motor nao re-enfileira - recursao).
CREATE OR REPLACE FUNCTION public._etapas_pl_enfileirar(_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _ids IS NULL OR cardinality(_ids) = 0 THEN RETURN; END IF;
  IF coalesce(current_setting('app.etapas_pl_sistema', true), '') <> '' THEN RETURN; END IF;
  INSERT INTO public.etapas_pl_recalculo_fila AS f (modelo_id, tenant_id)
  SELECT m.id, m.tenant_id
    FROM public.modelos m
    JOIN public.tenant_config tc ON tc.tenant_id = m.tenant_id AND tc.etapas_pl_automatico
   WHERE m.id = ANY (_ids)
     AND m.status_etapa_pl IS NOT NULL
   ORDER BY m.id
  -- linha que SOBROU de transacao anterior REARMADA: o UPDATE OF criado_at redispara o gatilho adiado. Linha ja
  -- escrita por ESTA transacao: nada (criterio xmin, igual ao Dev).
  ON CONFLICT (modelo_id) DO UPDATE SET criado_at = clock_timestamp()
   WHERE f.xmin <> pg_current_xact_id()::xid;
END;
$function$;

-- Enfileirar a loja inteira (espelho de _kanban_enfileirar_tenant, 20261027100000:222).
CREATE OR REPLACE FUNCTION public._etapas_pl_enfileirar_tenant(_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _tenant IS NULL THEN RETURN; END IF;
  IF coalesce(current_setting('app.etapas_pl_sistema', true), '') <> '' THEN RETURN; END IF;
  IF NOT public._etapas_pl_ligado(_tenant) THEN RETURN; END IF;
  INSERT INTO public.etapas_pl_recalculo_fila AS f (modelo_id, tenant_id)
  SELECT m.id, m.tenant_id
    FROM public.modelos m
   WHERE m.tenant_id = _tenant
     AND m.status_etapa_pl IS NOT NULL
   ORDER BY m.id
  ON CONFLICT (modelo_id) DO UPDATE SET criado_at = clock_timestamp()
   WHERE f.xmin <> pg_current_xact_id()::xid;
END;
$function$;

-- ── gatilhos-fonte (espelho de 20260930140000:264-491 com nomes PL, so as tabelas das condicoes PL) ──

-- modelos: POR LINHA, so quando muda coluna lida pelo core PL (lancado/status_etapa_pl/origem). O Sheet do Dev
-- manda ~40 colunas por save; limitamos ao que o avaliador PL usa + status_etapa_pl (entrou/saiu do PL).
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_fila_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._etapas_pl_enfileirar(ARRAY[NEW.id]);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_etapas_pl_fila_upd ON public.modelos;
CREATE TRIGGER trg_etapas_pl_fila_upd
  AFTER UPDATE ON public.modelos
  FOR EACH ROW
  WHEN (OLD.status_etapa_pl IS DISTINCT FROM NEW.status_etapa_pl
     OR OLD.lancado IS DISTINCT FROM NEW.lancado
     OR OLD.origem IS DISTINCT FROM NEW.origem)
  EXECUTE FUNCTION public.fn_etapas_pl_fila_modelo();

DROP TRIGGER IF EXISTS trg_etapas_pl_fila_ins ON public.modelos;
CREATE TRIGGER trg_etapas_pl_fila_ins
  AFTER INSERT ON public.modelos
  FOR EACH ROW
  WHEN (NEW.status_etapa_pl IS NOT NULL)
  EXECUTE FUNCTION public.fn_etapas_pl_fila_modelo();

-- Tabelas com coluna modelo_id: modelo_servico_mo, modelo_peca_teste_tentativas (condicoes peca_teste_aprovada).
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_fila_por_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.etapas_pl_sistema', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.modelo_id) INTO v_ids FROM novas n WHERE n.modelo_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.modelo_id) INTO v_ids FROM antigas o WHERE o.modelo_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT u.modelo_id) INTO v_ids
      FROM (SELECT n.modelo_id FROM novas n UNION SELECT o.modelo_id FROM antigas o) u
     WHERE u.modelo_id IS NOT NULL;
  END IF;
  PERFORM public._etapas_pl_enfileirar(v_ids);
  RETURN NULL;
END;
$function$;

-- Tabelas com coluna cad_id: controle_qualidade, producao_terceirizados (condicoes materiais/grade/oficina/cq).
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_fila_por_cad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.etapas_pl_sistema', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT c.modelo_id) INTO v_ids
      FROM novas n JOIN public.cad c ON c.id = n.cad_id WHERE c.modelo_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT c.modelo_id) INTO v_ids
      FROM antigas o JOIN public.cad c ON c.id = o.cad_id WHERE c.modelo_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT c.modelo_id) INTO v_ids
      FROM (SELECT n.cad_id FROM novas n UNION SELECT o.cad_id FROM antigas o) u
      JOIN public.cad c ON c.id = u.cad_id
     WHERE c.modelo_id IS NOT NULL;
  END IF;
  PERFORM public._etapas_pl_enfileirar(v_ids);
  RETURN NULL;
END;
$function$;

-- cad: POR LINHA (enviado_corte muda a condicao enviado_a_servicos; cad e o pai das filhas por cad_id).
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_fila_cad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('app.etapas_pl_sistema', true), '') <> '' THEN RETURN NULL; END IF;
  PERFORM public._etapas_pl_enfileirar(ARRAY[coalesce(NEW.modelo_id, OLD.modelo_id)]);
  RETURN NULL;
END;
$function$;

-- categorias_terceirizado (exige_peca_teste/etapa/ativo -> peca_teste/cq de muitos modelos): a LOJA inteira.
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_fila_categoria()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._etapas_pl_enfileirar_tenant(coalesce(NEW.tenant_id, OLD.tenant_id));
  RETURN NULL;
END;
$function$;

-- 3 gatilhos statement-level por tabela-filha com modelo_id/cad_id (nomes iguais: trg_etapas_pl_fila_{ins,upd,del}).
DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('modelo_servico_mo',            'fn_etapas_pl_fila_por_modelo'),
      ('modelo_peca_teste_tentativas', 'fn_etapas_pl_fila_por_modelo'),
      ('controle_qualidade',           'fn_etapas_pl_fila_por_cad'),
      ('producao_terceirizados',       'fn_etapas_pl_fila_por_cad')
    ) AS t(tabela, fn)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_etapas_pl_fila_ins ON public.%I', r.tabela);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_etapas_pl_fila_upd ON public.%I', r.tabela);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_etapas_pl_fila_del ON public.%I', r.tabela);
    EXECUTE format('CREATE TRIGGER trg_etapas_pl_fila_ins AFTER INSERT ON public.%I '
                   || 'REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.%I()', r.tabela, r.fn);
    EXECUTE format('CREATE TRIGGER trg_etapas_pl_fila_upd AFTER UPDATE ON public.%I '
                   || 'REFERENCING OLD TABLE AS antigas NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.%I()', r.tabela, r.fn);
    EXECUTE format('CREATE TRIGGER trg_etapas_pl_fila_del AFTER DELETE ON public.%I '
                   || 'REFERENCING OLD TABLE AS antigas FOR EACH STATEMENT EXECUTE FUNCTION public.%I()', r.tabela, r.fn);
  END LOOP;
END
$do$;

-- cad: por linha (INS/UPD/DEL).
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_cad_ins ON public.cad;
CREATE TRIGGER trg_etapas_pl_fila_cad_ins
  AFTER INSERT ON public.cad FOR EACH ROW EXECUTE FUNCTION public.fn_etapas_pl_fila_cad();
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_cad_upd ON public.cad;
CREATE TRIGGER trg_etapas_pl_fila_cad_upd
  AFTER UPDATE ON public.cad FOR EACH ROW
  WHEN (OLD.enviado_corte IS DISTINCT FROM NEW.enviado_corte OR OLD.modelo_id IS DISTINCT FROM NEW.modelo_id)
  EXECUTE FUNCTION public.fn_etapas_pl_fila_cad();
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_cad_del ON public.cad;
CREATE TRIGGER trg_etapas_pl_fila_cad_del
  AFTER DELETE ON public.cad FOR EACH ROW EXECUTE FUNCTION public.fn_etapas_pl_fila_cad();

-- categorias_terceirizado: loja inteira em UPD (campos lidos) e DEL.
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_cat_upd ON public.categorias_terceirizado;
CREATE TRIGGER trg_etapas_pl_fila_cat_upd
  AFTER UPDATE ON public.categorias_terceirizado FOR EACH ROW
  WHEN (OLD.etapa IS DISTINCT FROM NEW.etapa
     OR OLD.nome IS DISTINCT FROM NEW.nome
     OR OLD.ativo IS DISTINCT FROM NEW.ativo
     OR OLD.exige_peca_teste IS DISTINCT FROM NEW.exige_peca_teste)
  EXECUTE FUNCTION public.fn_etapas_pl_fila_categoria();
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_cat_del ON public.categorias_terceirizado;
CREATE TRIGGER trg_etapas_pl_fila_cat_del
  AFTER DELETE ON public.categorias_terceirizado FOR EACH ROW
  EXECUTE FUNCTION public.fn_etapas_pl_fila_categoria();

COMMIT;

select pg_notify('pgrst', 'reload schema');
