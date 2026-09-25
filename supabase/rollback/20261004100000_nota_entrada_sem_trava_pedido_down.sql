-- INVERSO de supabase/migrations/20261004100000_nota_entrada_sem_trava_pedido.sql
-- Recria public.fn_oc_nota_entrada_valida() byte a byte como estava em 20261002100000 (com a trava "anterior à data
-- do pedido" de volta). NÃO destrutivo em dado (nenhuma coluna/tabela é tocada) — só o texto da função volta.
-- ARQUIVO GERADO por .superpowers/nota/mig/gerar_sql.py — NÃO editar à mão.
-- transaction_timeout 30s por convenção de TODO inverso desta frente (R9-a) — este inverso não tem laço (é só
-- CREATE OR REPLACE de 1 função), mas segue o mesmo padrão do aplica_v2_inverso/harness de teste.
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

-- 0) Guarda de md5 EXATO: aceita o texto desta migration (md5_depois) OU já o antigo de 20261002100000 (reaplicação
--    idempotente do inverso). Qualquer outro texto = outra frente mudou depois → PARE.
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.fn_oc_nota_entrada_valida()') IS NULL THEN
    RAISE EXCEPTION 'nota_sem_trava_pedido (inverso): public.fn_oc_nota_entrada_valida() não existe';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.fn_oc_nota_entrada_valida()')));
  IF v_md5 NOT IN ('96ef34c2bb9014ad92dedfbfa40dc932', '0c3614b75fd6bdbac1b3c862a35b796b') THEN
    RAISE EXCEPTION 'nota_sem_trava_pedido (inverso): fn_oc_nota_entrada_valida() foi mudada por outra frente depois da migration (md5 %) — PARE e refaça o inverso contra o texto VIVO',
      v_md5 USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- 1) A função de volta ao texto de 20261002100000 (com a trava "anterior à data do pedido")
CREATE OR REPLACE FUNCTION public.fn_oc_nota_entrada_valida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date;
BEGIN
  -- Data da Nota de Entrada (24/set) — D7 decidida pelo dono em 24/set: não pode ser FUTURA (hoje no fuso da loja)
  -- nem ANTERIOR à data do pedido da OC. Valida quando a data OU o pedido MUDAM (M1, revisão Opus: um UPDATE que só
  -- move data_pedido pra depois da nota também tem de revalidar — senão a D7 é contornável). Linhas antigas e saves
  -- sem mudança em nenhuma das duas passam. Mensagens = as do front (src/lib/nota-entrada.ts, validarDataNota).
  -- P0001: o erro-mensagem.ts mostra o texto.
  IF NEW.data_nota_entrada IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.data_nota_entrada IS NOT DISTINCT FROM OLD.data_nota_entrada
                       AND NEW.data_pedido IS NOT DISTINCT FROM OLD.data_pedido THEN
    RETURN NEW;
  END IF;
  SELECT (now() AT TIME ZONE coalesce(nullif(tc.timezone, ''), 'America/Sao_Paulo'))::date INTO v_hoje
    FROM public.tenant_config tc WHERE tc.tenant_id = NEW.tenant_id;
  v_hoje := coalesce(v_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  IF NEW.data_nota_entrada > v_hoje THEN
    RAISE EXCEPTION 'A Data da Nota de Entrada (%) não pode ser no futuro.', to_char(NEW.data_nota_entrada, 'DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.data_pedido IS NOT NULL AND NEW.data_nota_entrada < NEW.data_pedido THEN
    RAISE EXCEPTION 'A Data da Nota de Entrada (%) não pode ser anterior à data do pedido (%).',
      to_char(NEW.data_nota_entrada, 'DD/MM/YYYY'), to_char(NEW.data_pedido, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) ACL (#9): interna, sem EXECUTE para PUBLIC/anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.fn_oc_nota_entrada_valida() FROM PUBLIC, anon, authenticated;

-- 3) Pós-condição
DO $pos$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.fn_oc_nota_entrada_valida()')));
  IF v_md5 <> '0c3614b75fd6bdbac1b3c862a35b796b' THEN
    RAISE EXCEPTION 'nota_sem_trava_pedido (inverso): fn_oc_nota_entrada_valida() não voltou ao texto de 20261002100000 (md5 %)', v_md5;
  END IF;
  IF has_function_privilege('anon', 'public.fn_oc_nota_entrada_valida()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_oc_nota_entrada_valida()', 'EXECUTE') THEN
    RAISE EXCEPTION 'nota_sem_trava_pedido (inverso): fn_oc_nota_entrada_valida() executável por anon/authenticated (invariante #9)';
  END IF;
END
$pos$;

select pg_notify('pgrst', 'reload schema');
COMMIT;
