-- Contas certas, bloco A, item 1 (fin #3, P-165 A + ruling RA2): o vencimento ajustado A MAO numa parcela de OC
-- NAO se perde quando o sistema recalcula as parcelas.
-- Causa (conferida): o financeiro edita parcelas.data_vencimento com UPDATE direto (financeiro.tsx, detalhe e lista), e
-- as regeradoras APAGAM toda parcela nao paga e recriam com a data calculada: _recalcular_parcelas_core (recalcular_parcelas,
-- recalc_parcelas_on_valor, recalc_parcelas_aviamento_on_item, fn_oc_nota_entrada_recalc, saves de OC tecido/aviamento),
-- recalcular_parcelas_etiqueta, gerar_parcelas_oc_p_acabado (gatilho em TODO save) e _gerar_parcelas_importado. RA2: o
-- "desmarcar recebimento" (_desmarcar_recebimento_oc_core, desmarcar_recebimento_oc_etiqueta) tambem apaga as nao pagas e
-- o re-receber (gerar_parcelas_oc_*) recria com a data calculada. Nenhuma funcao do servidor faz UPDATE em parcelas: todo
-- UPDATE de data_vencimento e da pessoa. Prova: audit_log (Loja Teste) 2cb8f5b3/2d2b73a6 editadas 30/06, apagadas 07/07.
--
-- Correcao (desenho por GATILHOS - nenhuma funcao existente e reescrita):
--   1. parcelas.vencimento_manual boolean NOT NULL DEFAULT false (ADD COLUMN com default constante = so catalogo). O
--      authenticated so tem UPDATE em 4 colunas de parcelas -> nao grava esta coluna.
--   2. trg_parcela_vencimento_manual (BEFORE UPDATE OF data_vencimento): data mudou e a parcela nao esta paga ->
--      vencimento_manual := true. Pulado com a GUC de transacao app.parcelas_sistema = 'on' (reserva p/ o servidor).
--   3. trg_parcela_vencimento_guarda (BEFORE DELETE): parcela NAO paga com vencimento_manual que e apagada (por QUALQUER
--      caminho: as 4 regeradoras, o desmarcar, a exclusao da OC) tem a data guardada em parcelas_vencimento_guardado,
--      chave (tipo_oc, OC, numero_parcela).
--   4. trg_parcela_vencimento_reaplica (BEFORE INSERT): parcela nova NAO paga cuja chave tem data guardada nasce com ESSA
--      data e vencimento_manual = true (a guarda e consumida). O VALOR segue redistribuido pela regeradora (so a data e
--      preservada). Vale para o recalculo na mesma transacao E para o re-receber dias depois (RA2).
--   5. Limpeza no COMMIT (CONSTRAINT TRIGGER adiado na guarda): se a OC sumiu, ou se no fim da transacao a OC tem parcela
--      NAO paga (a regeneradora terminou e aquele numero nao voltou: o prazo encurtou, ex. 3 -> 2), a guarda daquele numero
--      e apagada ("a data manual dela some", plano). Sem parcela nao paga (desmarcar recebimento; total zerado) ela fica
--      ate o numero voltar.
--   P-165 A: mudar a Data da Nota, o prazo ou a data da etapa do importado NAO mexe na data ajustada (igual Servicos).
--   Parcela PAGA nunca e mexida (nao e apagada pelas regeradoras; o gatilho de guarda ignora paga).
-- Por que gatilhos e nao a "receita" em cada regeradora (desvio do texto do plano, mesmo resultado nos testes dele):
--   cobre os 9 caminhos que apagam/criam parcela (4 regeradoras + 2 desmarcar + 3 re-receber) com UM mecanismo, cobre RA2
--   sem guardar estado nas OCs, e nao reescreve nenhuma das funcoes (cujo texto em producao ainda nao foi conferido - RG1).
-- Ordem dos gatilhos BEFORE INSERT em parcelas: set_tenant_id_trg -> trg_parcela_vencimento_reaplica (alfabetica).
-- Dados: a correcao unica (marcar as parcelas ja ajustadas a mao que ainda estao de pe) e o arquivo SEPARADO
-- 20261019200100_parcelas_vencimento_manual_correcao.sql (P-166 A; contagem esperada do Passo 0.3).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
-- Nenhuma funcao existente e trocada. As funcoes abaixo sao so CONFERIDAS: o mecanismo depende de elas apagarem/criarem
-- parcela por (tipo_oc, OC, numero_parcela).
--   Guarda DURA (papel 'dep'; texto diferente -> P0001) - md5 da copia = md5 de PRODUCAO (Passo 0 somente leitura,
--   30/set 11:22, passo0-funcoes-2026-09-30-112215.csv):
--     public._recalcular_parcelas_core(uuid,text)        1b03dbd69233d761fd150ab45722b7f6
--     public.recalcular_parcelas_etiqueta(uuid)          cf86f487ca3d643f625087a55395ef73
--     public.gerar_parcelas_oc_p_acabado()               2229a974f172a8302085f15ab2d63ae9
--     public._gerar_parcelas_importado(uuid)             6eb370cc35bf882bb4c0e243318b84b3
--     public._desmarcar_recebimento_oc_core(text,uuid)   b21bf3da0acb441c905994534dde11d7
--     public.desmarcar_recebimento_oc_etiqueta(uuid)     39a58a5518ec508830747ee70be58372
--   Guarda de AVISO (papel 'aviso'; texto diferente -> WARNING, segue): o Passo 0 nao as leu; o re-receber so INSERE
--   parcela por elas, e o gatilho de reaplicar vale para qualquer INSERT - o texto delas nao muda o resultado.
--     public.gerar_parcelas_oc_tecido()                  fc5ce68cc48762f681d30168b1e172b6  (copia 30/set)
--     public.gerar_parcelas_oc_aviamento()               e98640190802afd6de9f82ac4ecb39c3  (copia 30/set)
--     public.gerar_parcelas_oc_etiqueta()                b05942e71d0aa87fd68e50530e748e94  (copia 30/set)
--   Premissa conferida (DURA): nenhuma funcao do schema public faz UPDATE em parcelas (nem INSERT ... ON CONFLICT DO
--   UPDATE) sem ligar app.parcelas_sistema = 'on' (senao o gatilho marcaria um ajuste do sistema como "manual").
--   Mesma varredura num teste anti-drift (M3). Fix round 1 (L1): a data guardada so e consumida pela parcela da mesma loja.
--   Funcoes NOVAS deste arquivo (pos-condicao): fn_parcela_vencimento_manual, fn_parcela_vencimento_guarda,
--   fn_parcela_vencimento_reaplica, fn_parcelas_vencimento_guardado_limpa (md5 conferidos no fim).
-- =====================================================================================================================
-- Travas (medidas na copia): ALTER TABLE parcelas pega AccessExclusiveLock em parcelas por um instante (ADD COLUMN com
-- default constante nao reescreve a tabela) + os CREATE TRIGGER pegam ShareRowExclusive em parcelas. Nada em
-- auth/storage/realtime. lock_timeout 500ms; horario calmo. Os gatilhos vem por ULTIMO (depois da tabela/funcoes).
-- Volta: supabase/rollback/20261019200000_parcelas_vencimento_manual_down.sql - DESLIGA os 4 gatilhos (DISABLE TRIGGER:
-- o DROP TRIGGER trava auth/storage no Supabase); NAO apaga a coluna vencimento_manual, a tabela parcelas_vencimento_guardado
-- nem as funcoes (RD1: aposentar = ocultar primeiro). Reaplicar esta migration religa.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

-- ACCEPTED-MD5 (a lista unica usada pela guarda)
CREATE TEMP TABLE _cc_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _cc_md5_aceitos VALUES
  ('public._recalcular_parcelas_core(uuid,text)',      '1b03dbd69233d761fd150ab45722b7f6', 'dep'),    -- copia = producao (Passo 0)
  ('public.recalcular_parcelas_etiqueta(uuid)',        'cf86f487ca3d643f625087a55395ef73', 'dep'),    -- copia = producao (Passo 0)
  ('public.gerar_parcelas_oc_p_acabado()',             '2229a974f172a8302085f15ab2d63ae9', 'dep'),    -- copia = producao (Passo 0)
  ('public._gerar_parcelas_importado(uuid)',           '6eb370cc35bf882bb4c0e243318b84b3', 'dep'),    -- copia = producao (Passo 0)
  ('public._desmarcar_recebimento_oc_core(text,uuid)', 'b21bf3da0acb441c905994534dde11d7', 'dep'),    -- copia = producao (Passo 0)
  ('public.desmarcar_recebimento_oc_etiqueta(uuid)',   '39a58a5518ec508830747ee70be58372', 'dep'),    -- copia = producao (Passo 0)
  ('public.gerar_parcelas_oc_tecido()',                'fc5ce68cc48762f681d30168b1e172b6', 'aviso'),  -- copia 30/set (fora do Passo 0)
  ('public.gerar_parcelas_oc_aviamento()',             'e98640190802afd6de9f82ac4ecb39c3', 'aviso'),  -- copia 30/set (fora do Passo 0)
  ('public.gerar_parcelas_oc_etiqueta()',              'b05942e71d0aa87fd68e50530e748e94', 'aviso');  -- copia 30/set (fora do Passo 0)

DO $guarda$
DECLARE
  r record;
  v_md5 text;
  v_lista text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura, papel FROM _cc_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'contas_certas_a1: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _cc_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      IF r.papel = 'aviso' THEN
        RAISE WARNING 'contas_certas_a1: % com texto diferente do conferido na copia (md5 %) - so aviso; o gatilho de reaplicar vale p/ qualquer INSERT', r.assinatura, v_md5;
      ELSE
        RAISE EXCEPTION 'contas_certas_a1: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;
  -- premissa: nenhuma funcao faz UPDATE em parcelas (todo UPDATE de data_vencimento e da pessoa) - a nao ser as que
  -- ligam a GUC app.parcelas_sistema (ex.: parcela_voltar_vencimento_automatico, P-171 A). Idem INSERT ... ON CONFLICT
  -- DO UPDATE. O teste anti-drift tests/integration/parcelas-vencimento-manual.test.ts confere o mesmo (M3).
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_lista
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (p.prosrc ~* 'update\s+(public\.)?parcelas\y'
          OR p.prosrc ~* 'insert\s+into\s+(public\.)?parcelas\y[^;]*on\s+conflict[^;]*do\s+update')
     AND p.prosrc !~ 'app\.parcelas_sistema';
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'contas_certas_a1: funcao(oes) do servidor fazem UPDATE em parcelas (%): o gatilho marcaria o ajuste do sistema como manual - revisar', v_lista
      USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

-- 1. coluna (so catalogo: default constante)
ALTER TABLE public.parcelas ADD COLUMN IF NOT EXISTS vencimento_manual boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.parcelas.vencimento_manual IS
  'true = vencimento ajustado A MAO (UPDATE da pessoa). As regeradoras preservam a data por numero da parcela (contas certas A1, P-165 A).';

-- 2. guarda das datas manuais das parcelas apagadas (ate o numero voltar). RLS sem policy + REVOKE ALL: so gatilho DEFINER.
CREATE TABLE IF NOT EXISTS public.parcelas_vencimento_guardado (
  tipo_oc         text        NOT NULL,
  oc_id           uuid        NOT NULL,
  numero_parcela  integer     NOT NULL,
  tenant_id       uuid,
  data_vencimento date        NOT NULL,
  guardado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tipo_oc, oc_id, numero_parcela)
);
COMMENT ON TABLE public.parcelas_vencimento_guardado IS
  'Datas de vencimento ajustadas a mao de parcelas NAO pagas que foram apagadas (recalculo/desmarcar recebimento). Reaplicadas quando a parcela de mesmo numero renasce (contas certas A1/RA2).';
ALTER TABLE public.parcelas_vencimento_guardado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.parcelas_vencimento_guardado FROM PUBLIC, anon, authenticated;

-- 3. funcoes dos gatilhos
CREATE OR REPLACE FUNCTION public.fn_parcela_vencimento_manual()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [contas-certas A1] UPDATE da data de vencimento de parcela NAO paga = ajuste a mao (nenhuma funcao do servidor faz
-- UPDATE em parcelas). GUC de transacao app.parcelas_sistema = 'on' pula (reserva p/ um ajuste do proprio sistema).
BEGIN
  IF COALESCE(current_setting('app.parcelas_sistema', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.data_vencimento IS DISTINCT FROM OLD.data_vencimento
     AND NEW.status IS DISTINCT FROM 'pago' AND NEW.data_pagamento IS NULL THEN
    NEW.vencimento_manual := true;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_parcela_vencimento_guarda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [contas-certas A1/RA2] parcela NAO paga com vencimento ajustado a mao que esta sendo apagada: guarda a data por
-- (tipo_oc, OC, numero_parcela) p/ a parcela de mesmo numero que renascer (recalculo agora ou re-receber depois).
DECLARE
  v_oc uuid := COALESCE(OLD.oc_tecido_id, OLD.oc_aviamento_id, OLD.oc_etiqueta_id, OLD.oc_p_acabado_id, OLD.oc_importado_id);
BEGIN
  IF COALESCE(OLD.vencimento_manual, false)
     AND OLD.status IS DISTINCT FROM 'pago' AND OLD.data_pagamento IS NULL
     AND v_oc IS NOT NULL THEN
    INSERT INTO public.parcelas_vencimento_guardado (tipo_oc, oc_id, numero_parcela, tenant_id, data_vencimento)
    VALUES (OLD.tipo_oc, v_oc, OLD.numero_parcela, OLD.tenant_id, OLD.data_vencimento)
    ON CONFLICT (tipo_oc, oc_id, numero_parcela)
      DO UPDATE SET data_vencimento = EXCLUDED.data_vencimento, tenant_id = EXCLUDED.tenant_id, guardado_em = now();
  END IF;
  RETURN OLD;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_parcela_vencimento_reaplica()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [contas-certas A1/RA2] parcela NOVA nao paga cujo numero tem data ajustada a mao guardada: nasce com ESSA data
-- (so a data - o valor e o da regeradora) e com vencimento_manual = true; a guarda e consumida.
DECLARE
  v_oc uuid := COALESCE(NEW.oc_tecido_id, NEW.oc_aviamento_id, NEW.oc_etiqueta_id, NEW.oc_p_acabado_id, NEW.oc_importado_id);
  v_data date;
BEGIN
  IF v_oc IS NULL OR NEW.status = 'pago' OR NEW.data_pagamento IS NOT NULL THEN
    RETURN NEW;
  END IF;
  DELETE FROM public.parcelas_vencimento_guardado g
   WHERE g.tipo_oc = NEW.tipo_oc AND g.oc_id = v_oc AND g.numero_parcela = NEW.numero_parcela
     AND g.tenant_id IS NOT DISTINCT FROM NEW.tenant_id  -- L1: so a parcela da MESMA loja consome a data guardada
  RETURNING g.data_vencimento INTO v_data;
  IF FOUND THEN
    NEW.data_vencimento := v_data;
    NEW.vencimento_manual := true;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_parcelas_vencimento_guardado_limpa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [contas-certas A1] roda no COMMIT (adiado). Apaga a guarda deste numero quando: a OC nao existe mais (excluida), OU a
-- OC terminou a transacao com parcela NAO paga (a regeneradora rodou e este numero nao voltou - o prazo encurtou).
-- Sem parcela nao paga (desmarcar recebimento, total zerado) a guarda fica ate o numero voltar.
DECLARE
  v_oc_existe boolean;
  v_tem_aberta boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.parcelas_vencimento_guardado g
                  WHERE g.tipo_oc = NEW.tipo_oc AND g.oc_id = NEW.oc_id AND g.numero_parcela = NEW.numero_parcela) THEN
    RETURN NULL;  -- ja consumida
  END IF;
  v_oc_existe := CASE NEW.tipo_oc
    WHEN 'tecido'      THEN EXISTS (SELECT 1 FROM public.ocs_tecido     WHERE id = NEW.oc_id)
    WHEN 'aviamento'   THEN EXISTS (SELECT 1 FROM public.ocs_aviamento  WHERE id = NEW.oc_id)
    WHEN 'etiqueta'    THEN EXISTS (SELECT 1 FROM public.ocs_etiqueta   WHERE id = NEW.oc_id)
    WHEN 'p_acabado'   THEN EXISTS (SELECT 1 FROM public.ocs_p_acabado  WHERE id = NEW.oc_id)
    WHEN 'p_importado' THEN EXISTS (SELECT 1 FROM public.ocs_importado  WHERE id = NEW.oc_id)
    ELSE true END;
  v_tem_aberta := EXISTS (
    SELECT 1 FROM public.parcelas p
     WHERE p.tipo_oc = NEW.tipo_oc
       AND COALESCE(p.oc_tecido_id, p.oc_aviamento_id, p.oc_etiqueta_id, p.oc_p_acabado_id, p.oc_importado_id) = NEW.oc_id
       AND p.status IS DISTINCT FROM 'pago' AND p.data_pagamento IS NULL);
  IF NOT v_oc_existe OR v_tem_aberta THEN
    DELETE FROM public.parcelas_vencimento_guardado g
     WHERE g.tipo_oc = NEW.tipo_oc AND g.oc_id = NEW.oc_id AND g.numero_parcela = NEW.numero_parcela;
  END IF;
  RETURN NULL;
END
$function$;

-- funcoes de gatilho: ninguem chama por RPC (precedente fn_oc_nota_entrada_valida)
REVOKE EXECUTE ON FUNCTION public.fn_parcela_vencimento_manual() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_parcela_vencimento_guarda() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_parcela_vencimento_reaplica() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_parcelas_vencimento_guardado_limpa() FROM PUBLIC, anon, authenticated;

-- 4. gatilhos POR ULTIMO. Idempotente SEM "DROP TRIGGER IF EXISTS": no Supabase o DROP TRIGGER (mesmo de gatilho que nao
--    existe) pega AccessExclusiveLock em ~23 tabelas de auth/storage/realtime ate o COMMIT (supautils; medido na copia).
--    Cria so o que falta; reaplicar = no-op (a definicao e conferida na pos-condicao). A VOLTA desliga os gatilhos
--    (ALTER TABLE ... DISABLE TRIGGER, sem a trava de auth) em vez de apaga-los: aqui eles sao religados se preciso.
DO $gatilhos$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_parcelas_vencimento_guardado_limpa'
                 AND tgrelid = 'public.parcelas_vencimento_guardado'::regclass) THEN
    CREATE CONSTRAINT TRIGGER trg_parcelas_vencimento_guardado_limpa
      AFTER INSERT OR UPDATE ON public.parcelas_vencimento_guardado
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION public.fn_parcelas_vencimento_guardado_limpa();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_parcela_vencimento_manual' AND tgrelid = 'public.parcelas'::regclass) THEN
    CREATE TRIGGER trg_parcela_vencimento_manual
      BEFORE UPDATE OF data_vencimento ON public.parcelas
      FOR EACH ROW EXECUTE FUNCTION public.fn_parcela_vencimento_manual();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_parcela_vencimento_guarda' AND tgrelid = 'public.parcelas'::regclass) THEN
    CREATE TRIGGER trg_parcela_vencimento_guarda
      BEFORE DELETE ON public.parcelas
      FOR EACH ROW EXECUTE FUNCTION public.fn_parcela_vencimento_guarda();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_parcela_vencimento_reaplica' AND tgrelid = 'public.parcelas'::regclass) THEN
    CREATE TRIGGER trg_parcela_vencimento_reaplica
      BEFORE INSERT ON public.parcelas
      FOR EACH ROW EXECUTE FUNCTION public.fn_parcela_vencimento_reaplica();
  END IF;
  FOR r IN SELECT t.tgname, t.tgrelid::regclass AS tabela FROM pg_trigger t
            WHERE NOT t.tgisinternal AND t.tgenabled <> 'O'
              AND ((t.tgrelid = 'public.parcelas'::regclass AND t.tgname IN ('trg_parcela_vencimento_manual',
                     'trg_parcela_vencimento_guarda', 'trg_parcela_vencimento_reaplica'))
                OR (t.tgrelid = 'public.parcelas_vencimento_guardado'::regclass AND t.tgname = 'trg_parcelas_vencimento_guardado_limpa')) LOOP
    EXECUTE format('ALTER TABLE %s ENABLE TRIGGER %I', r.tabela, r.tgname);
  END LOOP;
END $gatilhos$;

DO $pos$
DECLARE
  r record;
BEGIN
  -- coluna
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'parcelas'
                 AND column_name = 'vencimento_manual' AND is_nullable = 'NO' AND column_default = 'false') THEN
    RAISE EXCEPTION 'contas_certas_a1: coluna parcelas.vencimento_manual ausente ou diferente' USING ERRCODE = 'P0001';
  END IF;
  -- o cliente NAO grava a coluna por UPDATE (so as 4 colunas de sempre)
  IF has_column_privilege('authenticated', 'public.parcelas', 'vencimento_manual', 'UPDATE') THEN
    RAISE EXCEPTION 'contas_certas_a1: authenticated ficou com UPDATE em parcelas.vencimento_manual' USING ERRCODE = 'P0001';
  END IF;
  -- funcoes novas: texto deste arquivo + ACL fechada
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_parcela_vencimento_manual()',          '4b56d7ad6d44a8e5dd5d11e71ee951cf'),
      ('public.fn_parcela_vencimento_guarda()',          '506e431966a4891a178f38df08c88086'),
      ('public.fn_parcela_vencimento_reaplica()',        '5896aac11ce8c1b80dec651f30e57a24'),
      ('public.fn_parcelas_vencimento_guardado_limpa()', '82ff69b72802c292e07d8de7a705e0d6')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'contas_certas_a1: % nao ficou com o texto deste arquivo (md5 %)', r.s, md5(pg_get_functiondef(to_regprocedure(r.s)))
        USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.s, 'EXECUTE') OR has_function_privilege('authenticated', r.s, 'EXECUTE') THEN
      RAISE EXCEPTION 'contas_certas_a1: % ficou executavel por anon/authenticated', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- gatilhos
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O' AND (
        (tgrelid = 'public.parcelas'::regclass AND tgname IN ('trg_parcela_vencimento_manual', 'trg_parcela_vencimento_guarda',
                                                                'trg_parcela_vencimento_reaplica'))
     OR (tgrelid = 'public.parcelas_vencimento_guardado'::regclass AND tgname = 'trg_parcelas_vencimento_guardado_limpa'))) <> 4 THEN
    RAISE EXCEPTION 'contas_certas_a1: os 4 gatilhos novos nao estao todos ligados' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('trg_parcela_vencimento_manual',   'CREATE TRIGGER trg_parcela_vencimento_manual BEFORE UPDATE OF data_vencimento ON public.parcelas FOR EACH ROW EXECUTE FUNCTION fn_parcela_vencimento_manual()'),
      ('trg_parcela_vencimento_guarda',   'CREATE TRIGGER trg_parcela_vencimento_guarda BEFORE DELETE ON public.parcelas FOR EACH ROW EXECUTE FUNCTION fn_parcela_vencimento_guarda()'),
      ('trg_parcela_vencimento_reaplica', 'CREATE TRIGGER trg_parcela_vencimento_reaplica BEFORE INSERT ON public.parcelas FOR EACH ROW EXECUTE FUNCTION fn_parcela_vencimento_reaplica()'),
      ('trg_parcelas_vencimento_guardado_limpa', 'CREATE CONSTRAINT TRIGGER trg_parcelas_vencimento_guardado_limpa AFTER INSERT OR UPDATE ON public.parcelas_vencimento_guardado DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_parcelas_vencimento_guardado_limpa()')
    ) v(n, d) LOOP
    IF (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgname = r.n AND NOT t.tgisinternal
          AND t.tgrelid IN ('public.parcelas'::regclass, 'public.parcelas_vencimento_guardado'::regclass)) IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 'contas_certas_a1: gatilho % existe com outra definicao', r.n USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- guarda: nenhum acesso de cliente
  IF has_table_privilege('authenticated', 'public.parcelas_vencimento_guardado', 'SELECT')
     OR has_table_privilege('anon', 'public.parcelas_vencimento_guardado', 'SELECT') THEN
    RAISE EXCEPTION 'contas_certas_a1: parcelas_vencimento_guardado ficou legivel por anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
