-- Contas certas, bloco B, item 8 (prod #3, P-163 A + ruling do controlador): linha de M.O. JA DECIDIDA (aprovada ou
-- reprovada) que muda de VALOR ou de SERVICO volta a PENDENTE - precisa aprovar de novo.
-- Causa (conferida): _salvar_modelo_servico_mo_core (UPDATE por id) grava valor/categoria e preserva `aprovado`, e
-- enforce_servico_mo_aprovacao (BEFORE INSERT/UPDATE em modelo_servico_mo) so barrava quando `aprovado` mudava: um valor
-- novo numa linha aprovada ficava "aprovado" sem ninguem aprovar o valor novo.
-- Correcao (1 funcao, [contas-certas 8]): no ramo UPDATE, ANTES do teste de permissao, se `aprovado` nao muda, a linha ja
-- estava decidida (OLD.aprovado IS NOT NULL) e valor OU categoria_terceirizado_id mudam -> NEW.aprovado := NULL e
-- NEW.motivo_reprovacao := NULL. Voltar a pendente NUNCA e escalada: o teste de permissao que vem depois pula esse caso
-- (v_reaberta) - quem NAO tem producao_servico_aprovacao pode mudar o valor (como hoje) e a linha fica pendente, sem 42501.
-- Efeitos que seguem sozinhos (nada novo): fn_modelo_servico_mo_rollup repinta modelos.custo_terceirizados_aprovado
-- (false); o kanban regride pela F2 (com a chave ligada, sem #Erro - decisao 14); Lancar volta a exigir aprovacao.
-- Modelo JA lancado nao e rebaixado (igual a adicionar uma linha pendente hoje). Mesmo valor = continua aprovada.
-- aprovar_servico_mo (muda `aprovado`) e o INSERT (replicar/linha nova) nao mudam. Sem backfill (P-163 A: daqui p/ frente).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public.enforce_servico_mo_aprovacao()
--     ANTES  b8e6f2297ee8e679808f57119d0ae662  (copia local 54422 E producao (Passo 0 30/set 11:22))
--     PRODUCAO = b8e6f2297ee8e679808f57119d0ae662 (igual a copia)  (Passo 0 somente leitura, 30/set 11:22 - passo0-funcoes-2026-09-30-112215.csv)
--     DEPOIS a2115ce0538b76b7cbe1740a6227bd2e  (este arquivo; reaplicar = no-op)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Volta: supabase/rollback/20261019110000_mo_linha_aprovada_volta_pendente_down.sql - recoloca o texto EXATO que estava vivo (guardado por esta
-- migration em public._bkp_funcoes_contas_certas; vale mesmo se producao != copia). Ordem de volta = LIFO da APLICACAO.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

-- ACCEPTED-MD5 (a lista unica usada pela guarda e pela pos-condicao)
CREATE TEMP TABLE _cc_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _cc_md5_aceitos VALUES
  ('public.enforce_servico_mo_aprovacao()', 'b8e6f2297ee8e679808f57119d0ae662', 'antes'),   -- copia local 54422 E producao (Passo 0 30/set 11:22)
  ('public.enforce_servico_mo_aprovacao()', 'a2115ce0538b76b7cbe1740a6227bd2e', 'depois');

-- Copia do texto vivo de cada funcao trocada (para a volta; vale mesmo se producao != copia).
-- RLS ligada SEM policy + REVOKE ALL: so o dono (postgres) le.
CREATE TABLE IF NOT EXISTS public._bkp_funcoes_contas_certas (
  migracao    text        NOT NULL,
  assinatura  text        NOT NULL,
  md5         text        NOT NULL,
  definicao   text        NOT NULL,
  guardado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (migracao, assinatura)
);
ALTER TABLE public._bkp_funcoes_contas_certas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_funcoes_contas_certas FROM PUBLIC, anon, authenticated;

DO $guarda$
DECLARE
  r record;
  v_md5 text;
  v_papel text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _cc_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'contas_certas_8: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    SELECT a.papel INTO v_papel FROM _cc_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5 LIMIT 1;
    IF v_papel IS NULL THEN
      RAISE EXCEPTION 'contas_certas_8: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
    IF v_papel = 'antes' THEN
      INSERT INTO public._bkp_funcoes_contas_certas (migracao, assinatura, md5, definicao)
      VALUES ('20261019110000', r.assinatura, v_md5, pg_get_functiondef(to_regprocedure(r.assinatura)))
      ON CONFLICT (migracao, assinatura) DO NOTHING;
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public.enforce_servico_mo_aprovacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reaberta boolean := false;  -- [contas-certas 8]
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.aprovado IS NOT NULL AND NOT public.user_can_edit('producao_servico_aprovacao') THEN
      RAISE EXCEPTION 'Sem permissão para aprovar/reprovar o custo de mão de obra' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- [contas-certas 8] P-163 A (+ ruling: vale tambem p/ a REPROVADA): linha ja decidida (aprovada ou reprovada)
    -- que muda de VALOR ou de SERVICO volta a PENDENTE (aprovado NULL, motivo limpo) - precisa aprovar de novo.
    -- Voltar a pendente nunca e escalada: por isso o teste de permissao abaixo nao vale neste caso (v_reaberta).
    -- Mudanca que tambem mexe em `aprovado` (so via aprovar_servico_mo) nao entra aqui.
    IF NEW.aprovado IS NOT DISTINCT FROM OLD.aprovado AND OLD.aprovado IS NOT NULL
       AND (NEW.valor IS DISTINCT FROM OLD.valor
            OR NEW.categoria_terceirizado_id IS DISTINCT FROM OLD.categoria_terceirizado_id) THEN
      NEW.aprovado := NULL;
      NEW.motivo_reprovacao := NULL;
      v_reaberta := true;
    END IF;
    IF NOT v_reaberta AND NEW.aprovado IS DISTINCT FROM OLD.aprovado
       AND NOT public.user_can_edit('producao_servico_aprovacao') THEN
      RAISE EXCEPTION 'Sem permissão para aprovar/reprovar o custo de mão de obra' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- Funcao de gatilho: a ACL fica como estava (CREATE OR REPLACE nao muda; gatilho nao se chama por RPC).

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT assinatura, md5 FROM _cc_md5_aceitos WHERE papel = 'depois' LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.assinatura))) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'contas_certas_8: pos-condicao falhou - % nao ficou com o texto deste arquivo', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public._bkp_funcoes_contas_certas b WHERE b.migracao = '20261019110000' AND b.assinatura = r.assinatura) THEN
      RAISE EXCEPTION 'contas_certas_8: copia do texto de antes de % nao foi guardada (a volta nao teria o que restaurar)', r.assinatura
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_enforce_servico_mo_aprovacao'
                 AND tgrelid = 'public.modelo_servico_mo'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'contas_certas_8: gatilho trg_enforce_servico_mo_aprovacao ausente em modelo_servico_mo' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
