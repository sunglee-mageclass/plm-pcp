-- Achados MEDIOS, release R10 (Financeiro), fin #6 (P-165 A + P-171 A; P-191 A): o vencimento de parcela de SERVICO
-- acompanha a data calculada; o ajustado A MAO fica.
-- Causa (conferida): servicos_financeiro() (texto da release 7, daec320c) so move o vencimento de parcela nao paga que
-- AINDA esta igual a data-base NOVA; parcelas_servico nao tem marca de "ajustado a mao". Se a entrega (ou o prazo da
-- empresa) muda, a parcela fica parada na data velha - na copia, 4 da Loja Teste (9a77fc69 Oficina, c575f73d e 0b040678
-- Corte, 53865b07 PL).
-- Correcao:
--   (a) parcelas_servico.vencimento_manual boolean NOT NULL DEFAULT false (default constante = so catalogo; pega
--       AccessExclusive em parcelas_servico por um instante -> lock_timeout curto + horario calmo).
--   (b) fn_servico_parcela_vencimento_manual + gatilho NOVO trg_servico_parcela_vencimento_manual BEFORE INSERT OR UPDATE:
--       INSERT do cliente nasce false (anon/authenticated tem INSERT); UPDATE em que a PESSOA muda a data de parcela NAO
--       paga -> true (data apagada -> false); qualquer outro UPDATE mantem o valor antigo (o cliente tem UPDATE na tabela
--       inteira - largura = fin #11, Reforco). O SISTEMA passa com a GUC de transacao app.parcelas_servico_sistema='on',
--       ligada e RESTAURADA em volta do proprio UPDATE (anti-drift em servicos-vencimento-manual.test.ts).
--       Ordem dos BEFORE (alfabetica): trg_servico_parcela_valor_pago -> trg_servico_parcela_vencimento_manual (colunas
--       independentes).
--   (c) servicos_financeiro(): o UPDATE do loop passa a ser "nao paga E nao manual E data <> calculada" (com data
--       calculada nao nula), com a GUC ligada/restaurada. Resto byte a byte.
--   (d) RPC parcela_servico_voltar_vencimento_automatico(_parcela_id) (P-171 A): DEFINER, user_can_edit('financeiro_servicos'),
--       recusa paga, limpa a marca e recalcula pela regra do loop; REVOKE PUBLIC/anon + GRANT authenticated.
--   P-191 A: NENHUMA parcela e marcada como manual (a correcao unica 20261020110100 SAIU) - as 4 da Loja Teste passam a
--   acompanhar a data calculada na proxima leitura de servicos_financeiro.
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
-- PROVISORIO: confirmar com o Passo 0 de producao (os md5 "antes"/"dep" sao da COPIA local 54422, 01/out).
--   public.servicos_financeiro()
--     ANTES  daec320c497c283929b33b55303aba89  (copia 01/out = texto da 20261019210000)  -- PROVISORIO: confirmar com o Passo 0 de producao
--     DEPOIS da903333e753e75c8a6e033226b0a78c  (este arquivo; reaplicar = no-op)
--   public.fn_servico_parcela_valor_pago()   (dep, so conferida)
--            de9914b310477de1331f076a874696f1  (copia 01/out)  -- PROVISORIO: confirmar com o Passo 0 de producao
--   Gatilhos de parcelas_servico (fora o novo) = EXATAMENTE 2, ligados, com estas definicoes (md5 do conjunto na copia
--   = 007e7b837cf385ce5dff12e2b7bb1b42 sobre string_agg(tgname||' '||tgenabled||' '||pg_get_triggerdef, E'\n' order by tgname)):
--     audit_parcelas_servico, trg_servico_parcela_valor_pago   -- PROVISORIO: confirmar com o Passo 0 de producao
--   Funcoes novas: nao existe OU texto deste arquivo (fn do gatilho: tambem o texto NEUTRO da volta, d88bb1ed...).
--     public.fn_servico_parcela_vencimento_manual()                 3cbad67dc2f335929ffadb19d26b2019
--     public.parcela_servico_voltar_vencimento_automatico(uuid)     4d6681d10b3e0cf3a4ea57abd3b2ac4d
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas (sem DROP no up): ALTER TABLE ADD COLUMN (AccessExclusive instantanea em parcelas_servico) + CREATE TRIGGER
-- (ShareRowExclusive em parcelas_servico; nada em auth/storage - medido na C4) + CREATE OR REPLACE FUNCTION. Gatilho POR
-- ULTIMO. O texto de antes de servicos_financeiro fica embutido na volta.
-- Volta (LIFO; ANTES da volta da 20261019210000, que confere servicos_financeiro = daec320c):
--   supabase/rollback/20261020110000_servico_vencimento_manual_down.sql      - devolve servicos_financeiro, NEUTRALIZA a
--     funcao do gatilho (RETURN NEW) e apaga a RPC nova; sem trava de auth. A coluna FICA (precedente RD1).
--   supabase/rollback/20261020110000_servico_vencimento_manual_down_drop.sql - SEPARADO: DROP TRIGGER + DROP da funcao
--     (DROP TRIGGER trava ~23 tabelas auth/storage/realtime ate o COMMIT -> horario calmo, transacao curta).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _r10_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _r10_md5_aceitos VALUES
  ('public.servicos_financeiro()',                                'daec320c497c283929b33b55303aba89', 'antes'),   -- PROVISORIO: confirmar com o Passo 0 de producao
  ('public.servicos_financeiro()',                                'da903333e753e75c8a6e033226b0a78c', 'depois'),
  ('public.fn_servico_parcela_valor_pago()',                      'de9914b310477de1331f076a874696f1', 'dep'),     -- PROVISORIO: confirmar com o Passo 0 de producao
  ('public.fn_servico_parcela_vencimento_manual()',               '3cbad67dc2f335929ffadb19d26b2019', 'nova'),
  ('public.fn_servico_parcela_vencimento_manual()',               'd88bb1ed58effa55eaf473c5af73be6a', 'neutra'),
  ('public.parcela_servico_voltar_vencimento_automatico(uuid)',   '4d6681d10b3e0cf3a4ea57abd3b2ac4d', 'nova');

DO $guarda$
DECLARE
  r record;
  v_md5 text;
  v_n int;
BEGIN
  FOR r IN SELECT DISTINCT assinatura, (bool_or(papel IN ('nova', 'neutra'))) AS nova FROM _r10_md5_aceitos GROUP BY assinatura LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      CONTINUE WHEN r.nova;
      RAISE EXCEPTION 'medios_r10_fin6: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _r10_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'medios_r10_fin6: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- conjunto de gatilhos de parcelas_servico (fora o desta migration): exatamente os 2 de hoje, ligados, mesmas definicoes
  SELECT count(*) INTO v_n FROM pg_trigger t
   WHERE t.tgrelid = 'public.parcelas_servico'::regclass AND NOT t.tgisinternal
     AND t.tgname <> 'trg_servico_parcela_vencimento_manual';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'medios_r10_fin6: parcelas_servico tem % gatilhos (esperado 2) - outra frente mexeu; conferir o Passo 0', v_n
      USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('audit_parcelas_servico',        'CREATE TRIGGER audit_parcelas_servico AFTER INSERT OR DELETE OR UPDATE ON public.parcelas_servico FOR EACH ROW EXECUTE FUNCTION fn_audit()'),
      ('trg_servico_parcela_valor_pago', 'CREATE TRIGGER trg_servico_parcela_valor_pago BEFORE INSERT OR UPDATE ON public.parcelas_servico FOR EACH ROW EXECUTE FUNCTION fn_servico_parcela_valor_pago()')
    ) v(n, d) LOOP
    IF (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgname = r.n AND t.tgenabled = 'O'
          AND t.tgrelid = 'public.parcelas_servico'::regclass) IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 'medios_r10_fin6: gatilho % de parcelas_servico ausente, desligado ou diferente', r.n USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- o gatilho desta migration, se ja existe (reaplicar), tem de ter a definicao deste arquivo
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_servico_parcela_vencimento_manual'
              AND t.tgrelid = 'public.parcelas_servico'::regclass)
     AND (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgname = 'trg_servico_parcela_vencimento_manual'
           AND t.tgrelid = 'public.parcelas_servico'::regclass) IS DISTINCT FROM
         'CREATE TRIGGER trg_servico_parcela_vencimento_manual BEFORE INSERT OR UPDATE ON public.parcelas_servico FOR EACH ROW EXECUTE FUNCTION fn_servico_parcela_vencimento_manual()' THEN
    RAISE EXCEPTION 'medios_r10_fin6: gatilho trg_servico_parcela_vencimento_manual existe com outra definicao' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

-- (a) coluna (default constante: so catalogo)
ALTER TABLE public.parcelas_servico ADD COLUMN IF NOT EXISTS vencimento_manual boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.parcelas_servico.vencimento_manual IS
  'true = vencimento ajustado A MAO (servicos_financeiro nao mexe). Quem grava e o gatilho trg_servico_parcela_vencimento_manual (medios R10 fin #6).';

-- (b) funcao do gatilho
CREATE OR REPLACE FUNCTION public.fn_servico_parcela_vencimento_manual()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [medios R10 fin #6, P-165 A] quem manda em parcelas_servico.vencimento_manual e ESTE gatilho (anon/authenticated tem
-- INSERT e UPDATE na tabela inteira - largura de permissao = fin #11, Reforco de seguranca):
--   INSERT do cliente                                         -> nasce false (o que vier e ignorado);
--   UPDATE em que a PESSOA muda a data de parcela NAO paga    -> true (ajuste a mao); data APAGADA -> false (sem data
--                                                                nao ha ajuste: volta ao calculo automatico);
--   qualquer outro UPDATE (pagar, desfazer, comprovante...)   -> mantem o valor antigo (ignora o que o cliente mandar).
-- Caminho do SISTEMA: GUC de transacao app.parcelas_servico_sistema = 'on' (servicos_financeiro e
-- parcela_servico_voltar_vencimento_automatico ligam SO em volta do proprio UPDATE e restauram) -> grava o que a funcao
-- mandou. Funcao do servidor que fizer UPDATE em parcelas_servico TEM de ligar a GUC (teste anti-drift).
BEGIN
  IF COALESCE(current_setting('app.parcelas_servico_sistema', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.vencimento_manual := false;
    RETURN NEW;
  END IF;
  IF NEW.data_vencimento IS DISTINCT FROM OLD.data_vencimento
     AND OLD.status IS DISTINCT FROM 'pago' AND OLD.data_pagamento IS NULL
     AND NEW.status IS DISTINCT FROM 'pago' AND NEW.data_pagamento IS NULL THEN
    NEW.vencimento_manual := (NEW.data_vencimento IS NOT NULL);
  ELSE
    NEW.vencimento_manual := OLD.vencimento_manual;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_servico_parcela_vencimento_manual() FROM PUBLIC, anon, authenticated;

-- (c) servicos_financeiro (1 linha no DECLARE + o UPDATE do loop; resto byte a byte, marcado [medios R10 fin #6])
CREATE OR REPLACE FUNCTION public.servicos_financeiro()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id(); r record; v_out jsonb;
  v_prazo text; v_dias int[]; v_n int; v_base date; v_venc date; v_off int; i int;
  v_guc text := COALESCE(current_setting('app.parcelas_servico_sistema', true), '');
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

        -- [medios R10 fin #6, P-165 A] a parcela NAO paga e NAO ajustada a mao (vencimento_manual) acompanha a data
        -- calculada (entrega/prazo mudou -> ela anda); a ajustada a mao fica; a paga nunca muda. Sem data calculada
        -- (sem entrega nem envio) nao mexe. A GUC app.parcelas_servico_sistema liga SO em volta do UPDATE (o gatilho
        -- trg_servico_parcela_vencimento_manual nao conta como ajuste a mao) e volta ao valor de antes.
        IF v_venc IS NOT NULL THEN
          PERFORM set_config('app.parcelas_servico_sistema', 'on', true);
          UPDATE parcelas_servico ps
             SET data_vencimento = v_venc
           WHERE ps.producao_terceirizado_id = r.id AND ps.numero_parcela = i
             AND ps.status <> 'pago' AND ps.data_pagamento IS NULL
             AND NOT ps.vencimento_manual
             AND ps.data_vencimento IS DISTINCT FROM v_venc;
          PERFORM set_config('app.parcelas_servico_sistema', v_guc, true);
        END IF;
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

-- (d) RPC "Voltar ao calculo automatico" (P-171 A)
CREATE OR REPLACE FUNCTION public.parcela_servico_voltar_vencimento_automatico(_parcela_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [medios R10 fin #6, P-171 A] "Voltar ao calculo automatico" de UMA parcela de SERVICO NAO paga: limpa
-- vencimento_manual e recalcula a data pela MESMA regra do LOOP de servicos_financeiro:
--   base = COALESCE(data_entregue, data_enviado) do servico; dias = numeros do prazo_pagamento da empresa
--   (regexp '[^0-9]+'); venc = base + dias[nº] quando existe o nº-esimo prazo, senao a base (flat, NAO nº*30).
-- So quem EDITA a aba Servicos do Financeiro (user_can_edit('financeiro_servicos')), na loja da parcela, com o modulo
-- financeiro ligado; senao 42501. Parcela paga -> P0001. Sem base (servico sem entrega nem envio) -> P0001.
-- O UPDATE liga app.parcelas_servico_sistema SO em volta dele (o gatilho de marcacao nao conta como ajuste a mao) e
-- passa pelo audit_parcelas_servico (autor = quem clicou). O valor nao muda.
DECLARE
  p record;
  v_base date;
  v_prazo text;
  v_dias int[];
  v_venc date;
  v_guc text := COALESCE(current_setting('app.parcelas_servico_sistema', true), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.parcelas_servico WHERE id = _parcela_id FOR UPDATE;
  IF NOT FOUND OR p.tenant_id IS DISTINCT FROM public.get_user_tenant_id() THEN
    RAISE EXCEPTION 'parcela_nao_encontrada: parcela inexistente ou de outra loja' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.tenant_module_enabled('financeiro') THEN
    RAISE EXCEPTION 'Modulo financeiro nao habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_can_edit('financeiro_servicos') THEN
    RAISE EXCEPTION 'Sem permissao para editar os Servicos do Financeiro' USING ERRCODE = '42501';
  END IF;
  IF p.status = 'pago' OR p.data_pagamento IS NOT NULL THEN
    RAISE EXCEPTION 'parcela_paga: o vencimento de parcela paga nao muda' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(pt.data_entregue, pt.data_enviado), emp.prazo_pagamento INTO v_base, v_prazo
    FROM public.producao_terceirizados pt
    JOIN public.cad c ON c.id = pt.cad_id AND c.tenant_id = p.tenant_id
    LEFT JOIN public.empresas emp ON emp.id = pt.empresa_id
   WHERE pt.id = p.producao_terceirizado_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'servico_nao_encontrado: o servico desta parcela nao existe nesta loja' USING ERRCODE = 'P0001';
  END IF;
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'servico_sem_data_base: o servico nao tem data de entrega nem de envio para calcular o vencimento'
      USING ERRCODE = 'P0001';
  END IF;
  v_dias := ARRAY(SELECT t::int FROM regexp_split_to_table(COALESCE(v_prazo, ''), '[^0-9]+') AS t WHERE t ~ '^[0-9]+$');
  IF array_length(v_dias, 1) >= p.numero_parcela THEN
    v_venc := v_base + v_dias[p.numero_parcela];
  ELSE
    v_venc := v_base;
  END IF;

  PERFORM set_config('app.parcelas_servico_sistema', 'on', true);
  UPDATE public.parcelas_servico SET data_vencimento = v_venc, vencimento_manual = false WHERE id = _parcela_id;
  PERFORM set_config('app.parcelas_servico_sistema', v_guc, true);

  RETURN jsonb_build_object('id', _parcela_id, 'data_vencimento', v_venc, 'vencimento_manual', false);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.parcela_servico_voltar_vencimento_automatico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parcela_servico_voltar_vencimento_automatico(uuid) TO authenticated;

-- gatilho POR ULTIMO (cria se falta - sem DROP; religa se alguem desligou)
DO $gatilho$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_servico_parcela_vencimento_manual'
                 AND tgrelid = 'public.parcelas_servico'::regclass) THEN
    CREATE TRIGGER trg_servico_parcela_vencimento_manual
      BEFORE INSERT OR UPDATE ON public.parcelas_servico
      FOR EACH ROW EXECUTE FUNCTION public.fn_servico_parcela_vencimento_manual();
  ELSIF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_servico_parcela_vencimento_manual'
                AND tgrelid = 'public.parcelas_servico'::regclass AND tgenabled <> 'O') THEN
    ALTER TABLE public.parcelas_servico ENABLE TRIGGER trg_servico_parcela_vencimento_manual;
  END IF;
END $gatilho$;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.servicos_financeiro()',                              'da903333e753e75c8a6e033226b0a78c'),
      ('public.fn_servico_parcela_vencimento_manual()',             '3cbad67dc2f335929ffadb19d26b2019'),
      ('public.parcela_servico_voltar_vencimento_automatico(uuid)', '4d6681d10b3e0cf3a4ea57abd3b2ac4d')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r10_fin6: pos-condicao falhou - % nao ficou com o texto deste arquivo (md5 %)', r.s,
        md5(pg_get_functiondef(to_regprocedure(r.s))) USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'parcelas_servico'
                 AND column_name = 'vencimento_manual' AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'false') THEN
    RAISE EXCEPTION 'medios_r10_fin6: coluna parcelas_servico.vencimento_manual ausente ou diferente' USING ERRCODE = 'P0001';
  END IF;
  -- ACL (inv. #1/#9)
  IF has_function_privilege('anon', 'public.fn_servico_parcela_vencimento_manual()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_servico_parcela_vencimento_manual()', 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r10_fin6: fn_servico_parcela_vencimento_manual ficou executavel por anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.servicos_financeiro()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.servicos_financeiro()', 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r10_fin6: ACL de servicos_financeiro errada (so authenticated)' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.parcela_servico_voltar_vencimento_automatico(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.parcela_servico_voltar_vencimento_automatico(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r10_fin6: ACL de parcela_servico_voltar_vencimento_automatico errada (so authenticated)' USING ERRCODE = 'P0001';
  END IF;
  -- gatilhos: os 2 de antes + o novo, ligados
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.parcelas_servico'::regclass AND NOT t.tgisinternal) <> 3 THEN
    RAISE EXCEPTION 'medios_r10_fin6: parcelas_servico nao ficou com 3 gatilhos' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgname = 'trg_servico_parcela_vencimento_manual'
        AND t.tgrelid = 'public.parcelas_servico'::regclass AND t.tgenabled = 'O') IS DISTINCT FROM
     'CREATE TRIGGER trg_servico_parcela_vencimento_manual BEFORE INSERT OR UPDATE ON public.parcelas_servico FOR EACH ROW EXECUTE FUNCTION fn_servico_parcela_vencimento_manual()' THEN
    RAISE EXCEPTION 'medios_r10_fin6: gatilho trg_servico_parcela_vencimento_manual ausente, desligado ou diferente' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
