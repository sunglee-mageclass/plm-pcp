-- Data da Nota de Entrada — tira a trava "não pode ser anterior à data do pedido" (D7 PARCIALMENTE REVOGADA pelo
-- dono em 25/set/2026: "está me barrando a entrada da data da nota de entrada porque é uma data anterior a data do
-- pedido, deixe sem essa trava"). A regra "não pode ser no FUTURO" CONTINUA (não foi pedido tirar).
-- Spec/plano: .superpowers/sdd/2026-09-25-nota-sem-trava-pedido/brief.md
-- ARQUIVO GERADO por .superpowers/nota/mig/gerar_sql.py a partir do texto VIVO de fn_oc_nota_entrada_valida()
-- (migration 20261002100000, aplicada em produção em 25/set) — o mesmo texto MENOS o bloco:
--   IF NEW.data_pedido IS NOT NULL AND NEW.data_nota_entrada < NEW.data_pedido THEN … END IF;
-- e comentário atualizado. NÃO editar à mão — regenerar.
-- Os gatilhos `trg_nota_entrada_valida` (BEFORE INSERT OR UPDATE OF data_nota_entrada, data_pedido) continuam
-- escutando as DUAS colunas — inofensivo agora (a função não usa mais data_pedido, mas não há necessidade de
-- recriar os 5 gatilhos por uma coluna a mais no OF; menos DDL, menos trava). ACL igual (invariante #9): função
-- interna, EXECUTE revogado de PUBLIC/anon/authenticated — CREATE OR REPLACE preserva o ACL; reafirma no fim.
-- Sem DDL de policy (nenhum CREATE/DROP/ALTER POLICY): o hook supautils.policy_grants não dispara.
-- Inverso: supabase/rollback/20261004100000_nota_entrada_sem_trava_pedido_down.sql (recria a versão ANTIGA byte a byte).
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

-- 0) Guarda de md5 EXATO: a função tem de estar no texto de produção (20261002100000, md5-depois da Nota) OU já no
--    desta migration (reaplicação idempotente). Qualquer outro texto = outra frente mudou depois → recusa.
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.fn_oc_nota_entrada_valida()') IS NULL THEN
    RAISE EXCEPTION 'nota_sem_trava_pedido: public.fn_oc_nota_entrada_valida() não existe neste banco — a migration 20261002100000 (Data da Nota de Entrada) precisa estar aplicada antes desta';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.fn_oc_nota_entrada_valida()')));
  IF v_md5 NOT IN ('0c3614b75fd6bdbac1b3c862a35b796b', '96ef34c2bb9014ad92dedfbfa40dc932') THEN
    RAISE EXCEPTION 'nota_sem_trava_pedido: public.fn_oc_nota_entrada_valida() não está nem no texto da Nota (20261002100000) nem no desta migration (md5 %) — outra frente mudou; regenerar antes de aplicar',
      v_md5 USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- 1) A função: texto de 20261002100000 MENOS o bloco "anterior à data do pedido" (D7 parcialmente revogada, 25/set).
--    "não pode ser no FUTURO" continua intacta.
CREATE OR REPLACE FUNCTION public.fn_oc_nota_entrada_valida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date;
BEGIN
  -- Data da Nota de Entrada (24/set) — D7: não pode ser FUTURA (hoje no fuso da loja). A trava "não pode ser
  -- ANTERIOR à data do pedido" foi REVOGADA pelo dono em 25/set (pedido explícito no chat: "deixe sem essa trava").
  -- Valida quando a data OU o pedido MUDAM (M1, revisão Opus, mantido: um UPDATE que só move data_pedido ainda
  -- revalida — hoje só a regra do futuro pode disparar, mas o gatilho continua escutando as duas colunas). Linhas
  -- antigas e saves sem mudança em nenhuma das duas passam. Mensagem = a do front (src/lib/nota-entrada.ts,
  -- validarDataNota). P0001: o erro-mensagem.ts mostra o texto.
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
  RETURN NEW;
END;
$function$;

-- 2) ACL (#9): interna, sem EXECUTE para PUBLIC/anon/authenticated (CREATE OR REPLACE preserva o ACL; reafirma).
REVOKE EXECUTE ON FUNCTION public.fn_oc_nota_entrada_valida() FROM PUBLIC, anon, authenticated;

-- 3) Pós-condição (falha alto e desfaz tudo se algo não ficou como o plano)
DO $pos$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.fn_oc_nota_entrada_valida()') IS NULL THEN
    RAISE EXCEPTION 'nota_sem_trava_pedido: public.fn_oc_nota_entrada_valida() sumiu';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.fn_oc_nota_entrada_valida()')));
  IF v_md5 <> '96ef34c2bb9014ad92dedfbfa40dc932' THEN
    RAISE EXCEPTION 'nota_sem_trava_pedido: fn_oc_nota_entrada_valida() não ficou no texto desta migration (md5 %)', v_md5;
  END IF;
  IF has_function_privilege('anon', 'public.fn_oc_nota_entrada_valida()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_oc_nota_entrada_valida()', 'EXECUTE') THEN
    RAISE EXCEPTION 'nota_sem_trava_pedido: fn_oc_nota_entrada_valida() executável por anon/authenticated (invariante #9)';
  END IF;
END
$pos$;

select pg_notify('pgrst', 'reload schema');
COMMIT;
