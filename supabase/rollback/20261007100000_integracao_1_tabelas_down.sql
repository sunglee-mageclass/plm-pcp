-- Inverso de 20261007100000_integracao_1_tabelas.sql — MONTADO pela Task 1 (o bloco de _seed_tenant_defaults é o texto de
-- ANTES, gerado por .superpowers/integracao/mig/dump_antes.sh a partir da cópia — nunca editar à mão). Rodar SÓ depois
-- dos inversos 6..2 (guarda LIFO). APAGA as 7 tabelas da integração (config, chaves, acessos, log, espelho) e o que houver nelas.
-- ruling do controlador, revisão T1 #1: o $guarda$ recusa se _seed_tenant_defaults mudou depois da migration 1 (aceita
-- só o "antes" exato ou "antes"+TRECHO_SEED — nunca sobrescreve uma mudança de outra frente em silêncio).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_def text;
BEGIN
  IF to_regprocedure('public._integracao_retrato_core(uuid,text[],jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_1_down: volte a migration 2 antes (LIFO)' USING ERRCODE = 'P0001';
  END IF;
  v_def := pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure);
  IF md5(v_def) <> '01bd241680e24fdb665ca8ae81a6a1a3'
     AND NOT (position('[integracao v1]' IN v_def) > 0
              AND md5(replace(v_def, '
  -- [integracao v1] Integração + API (set/2026): a config nasce com o padrão (campos do layout #1-#17 marcados, Foto
  -- desmarcada — P-83 A). reset_loja e a criação de loja passam por aqui (N9/n6).
  INSERT INTO public.integracao_config (tenant_id) VALUES (_tid)
  ON CONFLICT (tenant_id) DO NOTHING;
', '')) = '01bd241680e24fdb665ca8ae81a6a1a3') THEN
    RAISE EXCEPTION 'integracao_1_down: _seed_tenant_defaults mudou depois da migration 1 - refazer o inverso' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP TABLE IF EXISTS public.integracao_log;
DROP TABLE IF EXISTS public.integracao_acessos;
DROP TABLE IF EXISTS public.integracao_chaves;
DROP TABLE IF EXISTS public.integracao_linhas;
DROP TABLE IF EXISTS public.integracao_produtos;
DROP TABLE IF EXISTS public.integracao_config;
DROP TABLE IF EXISTS public.integracao_segredo;
DROP FUNCTION IF EXISTS public._integracao_layout();

CREATE OR REPLACE FUNCTION public._seed_tenant_defaults(_tid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.tenant_config (tenant_id) VALUES (_tid)
  ON CONFLICT (tenant_id) DO NOTHING;

  INSERT INTO public.categorias_terceirizado (tenant_id, nome, ordem) VALUES
    (_tid, 'Corte', 0), (_tid, 'Oficina', 1), (_tid, 'PL', 2)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- 12 meses FIXOS (ordem 1..12) — a UI não deixa criar (atributo `fixed`), então precisam
  -- existir sempre; senão o dropdown de Mês (Planejamento/CAD/CQ/OTB/Lançamentos) fica vazio.
  INSERT INTO public.meses (tenant_id, mes, ordem) VALUES
    (_tid, 'Janeiro', 1), (_tid, 'Fevereiro', 2), (_tid, 'Março', 3),
    (_tid, 'Abril', 4), (_tid, 'Maio', 5), (_tid, 'Junho', 6),
    (_tid, 'Julho', 7), (_tid, 'Agosto', 8), (_tid, 'Setembro', 9),
    (_tid, 'Outubro', 10), (_tid, 'Novembro', 11), (_tid, 'Dezembro', 12)
  ON CONFLICT (tenant_id, mes) DO NOTHING;

  -- Ano corrente + próximo, p/ a loja já posicionar modelos no calendário ao abrir/resetar.
  INSERT INTO public.anos (tenant_id, ano) VALUES
    (_tid, EXTRACT(YEAR FROM CURRENT_DATE)::int::text),
    (_tid, (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)::text)
  ON CONFLICT (tenant_id, ano) DO NOTHING;

  -- Lojas do Direcionamento: E-commerce (padrão) + Loja Física — renomeáveis depois.
  INSERT INTO public.lojas_direcionamento (tenant_id, nome, ativo, is_default, ordem) VALUES
    (_tid, 'E-commerce', true, true, 1),
    (_tid, 'Loja Física', true, false, 2)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- Categorias de fornecedor fixas (Aviamento/Insumo/Produto Acabado/Tecido/Produto Importado).
  INSERT INTO public.categorias_fornecedor (tenant_id, nome, fixa) VALUES
    (_tid, 'Aviamento', true),
    (_tid, 'Insumo', true),
    (_tid, 'Produto Acabado', true),
    (_tid, 'Tecido', true),
    (_tid, 'Produto Importado', true)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- 7º BLOCO (D2): tipos de insumo iniciais — Cartão/Croqui/Etiqueta (protegido: não excluíveis).
  INSERT INTO public.tipos_insumo (tenant_id, nome, protegido) VALUES
    (_tid, 'Cartão', true),
    (_tid, 'Croqui', true),
    (_tid, 'Etiqueta', true)
  ON CONFLICT (tenant_id, nome) DO NOTHING;
END;
$function$
;

DO $pos$
DECLARE
  t text;
BEGIN
  IF md5(pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure)) <> '01bd241680e24fdb665ca8ae81a6a1a3' THEN
    RAISE EXCEPTION 'integracao_1_down: _seed_tenant_defaults nao voltou ao texto de antes' USING ERRCODE = 'P0001';
  END IF;
  FOREACH t IN ARRAY ARRAY['integracao_config', 'integracao_segredo', 'integracao_produtos', 'integracao_linhas',
                            'integracao_chaves', 'integracao_acessos', 'integracao_log'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      RAISE EXCEPTION 'integracao_1_down: tabela % ainda existe', t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regprocedure('public._integracao_layout()') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_1_down: _integracao_layout ainda existe' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
