-- Contas certas, bloco A, item 2 (fin #5): parcela de SERVICO paga passa a guardar o VALOR PAGO (nao muda para tras).
-- Causa (conferida): parcelas_servico nao tinha coluna de valor; servicos_financeiro() recalculava valor_parcela A CADA
-- LEITURA pela formula (preco x qtd enviada - desconto + multa) / n_eff (a ultima leva o resto) - inclusive das PAGAS.
-- salvar_terceirizados so barra EXCLUIR bloco com parcela paga: preco/qtd/desconto/multa seguem livres, entao a parcela
-- paga mudava de valor para tras e a diferenca nunca virava saldo. Mais 2 defeitos na mesma funcao: (a) o WHERE
-- `interno = false AND ativo` escondia parcela PAGA de bloco inativo/interno; (b) parcela paga com numero > n_eff recebia
-- "o resto" (CASE numero >= n_eff) e a soma passava do liquido.
-- Correcao (espelha _recalcular_parcelas_core: congela as pagas e divide o saldo):
--   1. parcelas_servico.valor_pago numeric(12,2) (NULL = nao paga). ADD COLUMN sem default = so catalogo.
--   2. _servico_parcelas_valores(_pt) - FONTE UNICA da conta (DEFINER, EXECUTE revogado dos TRES - inv. #9): paga = seu
--      valor_pago; nao pagas em 1..n_eff dividem (liquido - pago), a ultima leva o arredondamento; saldo <= 0 -> 0.
--      Legado pago sem valor_pago (so se a correcao unica nao rodar): cai na formula antiga (= o que a tela mostrava).
--   3. trg_servico_parcela_valor_pago (BEFORE INSERT OR UPDATE) - quem manda na coluna (o authenticated tem UPDATE na
--      tabela inteira): virou paga (ou INSERT ja paga, RA3) -> congela o valor de ANTES da mudanca, sob
--      pg_advisory_xact_lock do bloco; deixou de ser paga -> NULL; outro caso -> mantem o antigo (ignora o cliente).
--      GUC (RA3): app.servico_valor_pago_correcao = 'on' desliga o gatilho SO na correcao unica 20261019210100.
--   4. servicos_financeiro(): valor_parcela vem do helper; parcela PAGA aparece SEMPRE (corrige (a)); (b) some (a paga leva
--      o proprio valor). A geracao/sincronizacao das parcelas (o LOOP) e a saida (mesmas chaves) nao mudam.
--   RA1: a parcela "complemento n_eff+1" (saldo sem vaga quando todas ja estao pagas) NAO entra (virou MEDIA): nesse caso
--   o saldo novo nao aparece em parcela nenhuma, como hoje nas OCs.
--   Efeito esperado: numa parcela NAO paga de bloco com pagas, o centavo do arredondamento pode trocar de parcela
--   (ex.: 100 em 3, paga a 1a 33,33 -> 33,34 + 33,33 em vez de 33,33 + 33,34); a soma e a mesma.
-- Dados: congelar o valor das pagas de hoje e a correcao unica SEPARADA 20261019210100 (P-166 A; Passo 0.4 = 1 parcela,
-- 0 edicoes depois do pagamento). Sem ela, a tela segue igual (fallback da formula antiga).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public.servicos_financeiro()
--     ANTES  b30f66972cc453f5fe092dae2995e21a  (copia local 54422 E producao (Passo 0 30/set 11:22) = texto da 20260824150000)
--     PRODUCAO = b30f66972cc453f5fe092dae2995e21a (igual a copia)  (Passo 0 somente leitura, 30/set 11:22 - passo0-funcoes-2026-09-30-112215.csv)
--     DEPOIS daec320c497c283929b33b55303aba89  (este arquivo; reaplicar = no-op)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas (medidas na copia): ALTER TABLE parcelas_servico pega AccessExclusiveLock em parcelas_servico por um instante
-- (ADD COLUMN sem default nao reescreve) e o CREATE TRIGGER, ShareRowExclusive. Nada em auth/storage/realtime (sem DROP
-- TRIGGER: no Supabase ele trava ~23 tabelas de auth/storage - cria so se faltar). Gatilho POR ULTIMO.
-- Volta: supabase/rollback/20261019210000_servico_parcela_valor_pago_down.sql - RD1: restaura servicos_financeiro (texto
-- exato guardado em public._bkp_funcoes_contas_certas) ANTES de desligar o gatilho (DISABLE TRIGGER); NAO apaga a coluna
-- valor_pago (guarda o valor pago congelado) nem o helper. Reaplicar esta migration religa o gatilho.
-- Se a correcao unica 20261019210100 foi aplicada, a volta dela vem ANTES (LIFO).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

-- ACCEPTED-MD5 (a lista unica usada pela guarda e pela pos-condicao)
CREATE TEMP TABLE _cc_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _cc_md5_aceitos VALUES
  ('public.servicos_financeiro()', 'b30f66972cc453f5fe092dae2995e21a', 'antes'),   -- copia local 54422 E producao (Passo 0 30/set 11:22) = texto da 20260824150000
  ('public.servicos_financeiro()', 'daec320c497c283929b33b55303aba89', 'depois');

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
      RAISE EXCEPTION 'contas_certas_a2: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    SELECT a.papel INTO v_papel FROM _cc_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5 LIMIT 1;
    IF v_papel IS NULL THEN
      RAISE EXCEPTION 'contas_certas_a2: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
    IF v_papel = 'antes' THEN
      INSERT INTO public._bkp_funcoes_contas_certas (migracao, assinatura, md5, definicao)
      VALUES ('20261019210000', r.assinatura, v_md5, pg_get_functiondef(to_regprocedure(r.assinatura)))
      ON CONFLICT (migracao, assinatura) DO NOTHING;
    END IF;
  END LOOP;
END $guarda$;

-- 1. coluna (sem default: so catalogo)
ALTER TABLE public.parcelas_servico ADD COLUMN IF NOT EXISTS valor_pago numeric(12,2);
COMMENT ON COLUMN public.parcelas_servico.valor_pago IS
  'Valor congelado no pagamento (NULL = nao paga). Quem grava e o gatilho trg_servico_parcela_valor_pago (contas certas A2).';

-- 2. fonte unica do valor das parcelas do bloco
CREATE OR REPLACE FUNCTION public._servico_parcelas_valores(_pt uuid)
 RETURNS TABLE(numero_parcela integer, valor numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [contas-certas A2] FONTE UNICA do valor das parcelas de um bloco de servico (producao_terceirizados):
--   liquido = preco x qtd enviada - desconto + multa;
--   PAGA  -> o valor_pago congelado no pagamento (legado sem valor_pago: a formula antiga, igual a tela de antes);
--   NAO PAGAS dentro de 1..n_eff -> dividem o saldo (liquido - soma das pagas) em partes iguais; a ultima nao paga leva
--   o arredondamento; saldo <= 0 -> valem 0. n_eff = a mesma conta de servicos_financeiro (nº de prazos da empresa,
--   senao numero_parcelas; entre 1 e 24). Espelha _recalcular_parcelas_core (congela as pagas e divide o saldo).
-- Devolve uma linha por parcela PAGA (qualquer numero) e por numero NAO pago em 1..n_eff (exista a linha ou nao).
DECLARE
  v_liq numeric;
  v_neff int;
  v_pago numeric := 0;
  v_pagos int[] := '{}';
  v_k int;
  v_saldo numeric;
  v_parte numeric;
  v_idx int := 0;
  r record;
  i int;
BEGIN
  SELECT (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)),
         LEAST(GREATEST(
           COALESCE(NULLIF(array_length(ARRAY(SELECT 1 FROM regexp_split_to_table(COALESCE(emp.prazo_pagamento,''),'[^0-9]+') AS t WHERE t ~ '^[0-9]+$'),1),0),
                    GREATEST(COALESCE(pt.numero_parcelas,1),1)),
         1), 24)
    INTO v_liq, v_neff
    FROM public.producao_terceirizados pt
    LEFT JOIN public.empresas emp ON emp.id = pt.empresa_id
   WHERE pt.id = _pt;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  FOR r IN SELECT ps.numero_parcela AS n, ps.valor_pago AS vp
             FROM public.parcelas_servico ps
            WHERE ps.producao_terceirizado_id = _pt AND (ps.status = 'pago' OR ps.data_pagamento IS NOT NULL)
            ORDER BY ps.numero_parcela LOOP
    numero_parcela := r.n;
    valor := COALESCE(r.vp,
               CASE WHEN r.n >= v_neff THEN v_liq - round(v_liq / v_neff, 2) * (v_neff - 1)
                    ELSE round(v_liq / v_neff, 2) END);
    v_pago := v_pago + valor;
    v_pagos := v_pagos || r.n;
    RETURN NEXT;
  END LOOP;

  SELECT count(*) INTO v_k FROM generate_series(1, v_neff) g(n) WHERE NOT (g.n = ANY (v_pagos));
  IF v_k = 0 THEN
    RETURN;
  END IF;
  v_saldo := GREATEST(v_liq - v_pago, 0);
  v_parte := round(v_saldo / v_k, 2);
  FOR i IN 1..v_neff LOOP
    CONTINUE WHEN i = ANY (v_pagos);
    v_idx := v_idx + 1;
    numero_parcela := i;
    valor := CASE WHEN v_idx = v_k THEN v_saldo - v_parte * (v_k - 1) ELSE v_parte END;
    RETURN NEXT;
  END LOOP;
END
$function$;
REVOKE EXECUTE ON FUNCTION public._servico_parcelas_valores(uuid) FROM PUBLIC, anon, authenticated;

-- 3. funcao do gatilho
CREATE OR REPLACE FUNCTION public.fn_servico_parcela_valor_pago()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [contas-certas A2] quem manda em parcelas_servico.valor_pago e ESTE gatilho (o cliente tem UPDATE na tabela inteira):
--   vira PAGA (status 'pago' ou data_pagamento preenchida, vindo de nao paga - ou INSERT ja paga) -> congela o valor
--     que a parcela tinha ANTES desta mudanca (_servico_parcelas_valores), sob trava do bloco;
--   deixa de ser paga -> NULL;
--   qualquer outro caso -> mantem o valor antigo (ignora o que o cliente mandar).
-- GUC de transacao app.servico_valor_pago_correcao = 'on': so a correcao unica 20261019210100 grava o valor da tela.
DECLARE
  v_pago_novo boolean := (NEW.status = 'pago' OR NEW.data_pagamento IS NOT NULL);
  v_pago_antigo boolean;
  v_valor numeric;
BEGIN
  IF COALESCE(current_setting('app.servico_valor_pago_correcao', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_pago_antigo := (OLD.status = 'pago' OR OLD.data_pagamento IS NOT NULL);
  ELSE
    v_pago_antigo := false;
  END IF;

  IF v_pago_novo AND NOT v_pago_antigo THEN
    PERFORM pg_advisory_xact_lock(hashtext('parcelas_servico:' || NEW.producao_terceirizado_id::text));
    SELECT v.valor INTO v_valor
      FROM public._servico_parcelas_valores(NEW.producao_terceirizado_id) v
     WHERE v.numero_parcela = NEW.numero_parcela;
    NEW.valor_pago := round(COALESCE(v_valor, 0), 2);
  ELSIF NOT v_pago_novo THEN
    NEW.valor_pago := NULL;
  ELSE
    NEW.valor_pago := OLD.valor_pago;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_servico_parcela_valor_pago() FROM PUBLIC, anon, authenticated;

-- 4. servicos_financeiro (1 troca de valor + 1 WHERE; resto byte a byte, marcado [contas-certas A2])
CREATE OR REPLACE FUNCTION public.servicos_financeiro()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id(); r record; v_out jsonb;
  v_prazo text; v_dias int[]; v_n int; v_base date; v_venc date; v_off int; i int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  FOR r IN
    SELECT pt.id, pt.cad_id, GREATEST(COALESCE(pt.numero_parcelas,1),1) AS n,
           pt.numero_parcelas, pt.empresa_id,
           (COALESCE(ct.nome,'') ILIKE 'oficina') AS is_oficina, pt.data_enviado, pt.data_entregue
    FROM producao_terceirizados pt
    JOIN cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
    LEFT JOIN categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
    WHERE COALESCE(pt.interno,false) = false AND COALESCE(pt.ativo,true)
  LOOP
    IF (NOT r.is_oficina AND r.data_enviado IS NOT NULL AND r.data_entregue IS NOT NULL)
       OR (r.is_oficina AND EXISTS (SELECT 1 FROM controle_qualidade cq WHERE cq.cad_id = r.cad_id AND cq.status = 'confirmado'))
    THEN
      v_base := COALESCE(r.data_entregue, r.data_enviado);
      v_prazo := (SELECT prazo_pagamento FROM public.empresas WHERE id = r.empresa_id);
      v_dias := ARRAY(
        SELECT t::int FROM regexp_split_to_table(COALESCE(v_prazo,''),'[^0-9]+') AS t
        WHERE t ~ '^[0-9]+$'
      );
      IF array_length(v_dias,1) >= 1 THEN
        v_n := LEAST(array_length(v_dias,1), 24);
      ELSE
        -- Cap em 24 IGUAL ao n_eff do display (LEAST(...,24)): sem isso, um bloco sem prazo
        -- com numero_parcelas > 24 gera >24 parcelas mas o display mostra/divide por 24 —
        -- parcela a-pagar oculta reaparece só quando paga, inflando o total exibido (money path).
        v_n := LEAST(GREATEST(COALESCE(r.numero_parcelas,1), 1), 24);
      END IF;

      -- Deleta só parcelas NÃO pagas acima de v_n (nunca apaga paga).
      DELETE FROM parcelas_servico ps
       WHERE ps.producao_terceirizado_id = r.id
         AND ps.numero_parcela > v_n
         AND ps.status <> 'pago' AND ps.data_pagamento IS NULL;

      -- Gera/atualiza 1..v_n preservando pagas e vencimentos editados à mão.
      FOR i IN 1..v_n LOOP
        -- Só escalona quando existe o i-ésimo prazo; sem prazo (ou índice além do array)
        -- cai na DATA-BASE única = comportamento flat de sempre (NÃO usar i*30).
        IF array_length(v_dias,1) >= i THEN v_venc := v_base + v_dias[i]; v_off := v_dias[i];
        ELSE v_venc := v_base; v_off := NULL; END IF;

        INSERT INTO parcelas_servico (tenant_id, producao_terceirizado_id, numero_parcela, data_vencimento)
        VALUES (v_tenant, r.id, i, v_venc)
        ON CONFLICT (producao_terceirizado_id, numero_parcela) DO NOTHING;

        -- Só corrige o vencimento de parcela a_pagar que AINDA está na data-base "crua"
        -- (nunca editada à mão, nunca paga). Preserva ajuste manual e pagas.
        UPDATE parcelas_servico ps
           SET data_vencimento = v_venc
         WHERE ps.producao_terceirizado_id = r.id AND ps.numero_parcela = i
           AND ps.status <> 'pago' AND ps.data_pagamento IS NULL
           AND (ps.data_vencimento IS NULL OR ps.data_vencimento = v_base);
      END LOOP;
    END IF;
  END LOOP;

  -- [contas-certas A2] valores por bloco calculados 1x por bloco da loja (nao por parcela)
  WITH vals AS (
    SELECT b.id AS pt_id, v.numero_parcela, v.valor
      FROM (SELECT DISTINCT ps0.producao_terceirizado_id AS id FROM parcelas_servico ps0 WHERE ps0.tenant_id = v_tenant) b
      CROSS JOIN LATERAL public._servico_parcelas_valores(b.id) v
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.data_entrega DESC NULLS LAST, t.servico, t.numero_parcela), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT ps.id AS parcela_id, ps.producao_terceirizado_id, ps.numero_parcela,
           neff.n_eff AS numero_parcelas,
           COALESCE(ct.nome,'—') AS servico,
           COALESCE(rep.nome, emp.nome_fantasia, col.nome, '—') AS responsavel,
           COALESCE(rep.cnpj, emp.cnpj) AS responsavel_cnpj,
           emp.nome_fantasia AS empresa_nome, emp.cnpj AS empresa_cnpj,
           rep.nome AS representante_nome, rep.cnpj AS representante_cnpj,
           (COALESCE(ct.nome,'') ILIKE 'oficina') AS is_oficina,
           m.ref, m.nome AS modelo_nome,
           (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0)) AS custo_bruto,
           COALESCE(pt.desconto_total,0) AS desconto, COALESCE(pt.multa_total,0) AS multa,
           (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)) AS custo_liquido,
           -- [contas-certas A2] valor da parcela = fonte unica _servico_parcelas_valores: PAGA leva o valor_pago
           -- congelado; as nao pagas (1..n_eff) dividem o saldo (liquido - pago). Mesmo formato de saida.
           COALESCE(vp.valor, 0) AS valor_parcela,
           pt.data_entregue AS data_entrega, ps.data_vencimento, ps.status, ps.data_pagamento, ps.comprovante_url,
           (ARRAY(SELECT t::int FROM regexp_split_to_table(COALESCE(emp.prazo_pagamento,''),'[^0-9]+') AS t WHERE t ~ '^[0-9]+$'))[ps.numero_parcela] AS dias_offset
    FROM parcelas_servico ps
    JOIN producao_terceirizados pt ON pt.id = ps.producao_terceirizado_id
    JOIN cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    LEFT JOIN categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
    LEFT JOIN representantes rep ON rep.id = pt.representante_id
    LEFT JOIN empresas emp ON emp.id = pt.empresa_id
    LEFT JOIN colaboradores col ON col.id = pt.colaborador_id
    -- Contagem EFETIVA de parcelas (mesma lógica do v_n da geração): nº de prazos válidos
    -- em emp.prazo_pagamento (capado em 24, casando LEAST(...,24)); sem prazo → numero_parcelas.
    -- Usada no output numero_parcelas, no rateio do valor e na visibilidade — display ≡ geração.
    LEFT JOIN vals vp ON vp.pt_id = ps.producao_terceirizado_id AND vp.numero_parcela = ps.numero_parcela
    CROSS JOIN LATERAL (SELECT LEAST(GREATEST(
        COALESCE(NULLIF(array_length(ARRAY(SELECT 1 FROM regexp_split_to_table(COALESCE(emp.prazo_pagamento,''),'[^0-9]+') AS t WHERE t ~ '^[0-9]+$'),1),0),
                 GREATEST(COALESCE(pt.numero_parcelas,1),1)),
      1), 24) AS n_eff) neff
    WHERE ps.tenant_id = v_tenant
      AND (
        -- [contas-certas A2] parcela PAGA sempre aparece - mesmo de bloco inativo ou interno (dinheiro pago nao some)
        (ps.status = 'pago' OR ps.data_pagamento IS NOT NULL)
        OR (COALESCE(pt.interno,false) = false AND COALESCE(pt.ativo,true)
            -- nao paga: so dentro da faixa efetiva n_eff
            AND ps.numero_parcela <= neff.n_eff
            -- bloco elegível OU que já tenha alguma parcela paga (não esconde dinheiro pago)
            AND ((COALESCE(ct.nome,'') NOT ILIKE 'oficina' AND pt.data_enviado IS NOT NULL AND pt.data_entregue IS NOT NULL)
                 OR (COALESCE(ct.nome,'') ILIKE 'oficina' AND EXISTS (SELECT 1 FROM controle_qualidade cq WHERE cq.cad_id = pt.cad_id AND cq.status = 'confirmado'))
                 OR EXISTS (SELECT 1 FROM parcelas_servico ps2 WHERE ps2.producao_terceirizado_id = pt.id AND (ps2.status = 'pago' OR ps2.data_pagamento IS NOT NULL))))
      )
  ) t;

  RETURN v_out;
END;
$function$;
-- invariante #1: EXECUTE revogado de PUBLIC/anon, so authenticated (reafirmado)
REVOKE EXECUTE ON FUNCTION public.servicos_financeiro() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.servicos_financeiro() TO authenticated;

-- 5. gatilho POR ULTIMO (cria se falta; religa se a volta desligou)
DO $gatilho$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_servico_parcela_valor_pago'
                 AND tgrelid = 'public.parcelas_servico'::regclass) THEN
    CREATE TRIGGER trg_servico_parcela_valor_pago
      BEFORE INSERT OR UPDATE ON public.parcelas_servico
      FOR EACH ROW EXECUTE FUNCTION public.fn_servico_parcela_valor_pago();
  ELSIF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_servico_parcela_valor_pago'
                AND tgrelid = 'public.parcelas_servico'::regclass AND tgenabled <> 'O') THEN
    ALTER TABLE public.parcelas_servico ENABLE TRIGGER trg_servico_parcela_valor_pago;
  END IF;
END $gatilho$;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT assinatura, md5 FROM _cc_md5_aceitos WHERE papel = 'depois' LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.assinatura))) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'contas_certas_a2: pos-condicao falhou - % nao ficou com o texto deste arquivo', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public._bkp_funcoes_contas_certas b WHERE b.migracao = '20261019210000' AND b.assinatura = r.assinatura) THEN
      RAISE EXCEPTION 'contas_certas_a2: copia do texto de antes de % nao foi guardada (a volta nao teria o que restaurar)', r.assinatura
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'parcelas_servico'
                 AND column_name = 'valor_pago' AND data_type = 'numeric' AND numeric_precision = 12 AND numeric_scale = 2) THEN
    RAISE EXCEPTION 'contas_certas_a2: coluna parcelas_servico.valor_pago ausente ou diferente' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._servico_parcelas_valores(uuid)', '1da5739d35ddbe519dc95b0cb93dff07'),
      ('public.fn_servico_parcela_valor_pago()', '8c08867a9e1959de0419dd154f66e7b5')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'contas_certas_a2: % nao ficou com o texto deste arquivo', r.s USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.s, 'EXECUTE') OR has_function_privilege('authenticated', r.s, 'EXECUTE') THEN
      RAISE EXCEPTION 'contas_certas_a2: % ficou executavel por anon/authenticated', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.servicos_financeiro()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.servicos_financeiro()', 'EXECUTE') THEN
    RAISE EXCEPTION 'contas_certas_a2: ACL de servicos_financeiro errada (inv. #1: so authenticated)' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgname = 'trg_servico_parcela_valor_pago'
        AND t.tgrelid = 'public.parcelas_servico'::regclass AND t.tgenabled = 'O') IS DISTINCT FROM
     'CREATE TRIGGER trg_servico_parcela_valor_pago BEFORE INSERT OR UPDATE ON public.parcelas_servico FOR EACH ROW EXECUTE FUNCTION fn_servico_parcela_valor_pago()' THEN
    RAISE EXCEPTION 'contas_certas_a2: gatilho trg_servico_parcela_valor_pago ausente, desligado ou diferente' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
