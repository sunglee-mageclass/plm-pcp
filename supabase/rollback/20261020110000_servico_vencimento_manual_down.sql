-- INVERSO (passo 1 de 2) de supabase/migrations/20261020110000_servico_vencimento_manual.sql (achados MEDIOS R10, fin #6).
--   1) servicos_financeiro volta ao texto da release 7 (daec320c - embutido abaixo): volta a mover so a parcela que ainda
--      esta na data-base;
--   2) fn_servico_parcela_vencimento_manual e NEUTRALIZADA (RETURN NEW - CREATE OR REPLACE, sem trava de tabela nem de
--      auth/storage); o gatilho fica de pe, inerte, ate o _down_drop;
--   3) a RPC parcela_servico_voltar_vencimento_automatico e apagada (DROP FUNCTION: so a trava de objeto da propria
--      funcao). O front que mostra "Voltar ao calculo automatico" volta ANTES ou JUNTO.
--   A coluna parcelas_servico.vencimento_manual FICA (precedente RD1; sem leitor depois desta volta).
-- Guarda: so roda se servicos_financeiro e a funcao do gatilho estao com o texto da ida; outro -> P0001.
-- Ordem geral: LIFO da APLICACAO - este arquivo roda ANTES de supabase/rollback/20261019210000_servico_parcela_valor_pago_down.sql
-- (que confere servicos_financeiro = daec320c). O DROP TRIGGER fica no _down_drop SEPARADO (horario calmo).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.servicos_financeiro()',                  'da903333e753e75c8a6e033226b0a78c'),
      ('public.fn_servico_parcela_vencimento_manual()', '3cbad67dc2f335929ffadb19d26b2019')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'medios_r10_fin6 (volta): % nao existe - a 20261020110000 nao foi aplicada', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r10_fin6 (volta): % nao esta com o texto da 20261020110000 (md5 %) - nada a desfazer ou outra frente mexeu', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regprocedure('public.parcela_servico_voltar_vencimento_automatico(uuid)') IS NOT NULL
     AND md5(pg_get_functiondef('public.parcela_servico_voltar_vencimento_automatico(uuid)'::regprocedure))
         IS DISTINCT FROM '4d6681d10b3e0cf3a4ea57abd3b2ac4d' THEN
    RAISE EXCEPTION 'medios_r10_fin6 (volta): parcela_servico_voltar_vencimento_automatico com outro texto - outra frente mexeu' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

-- 1) servicos_financeiro: texto EXATO da release 7 (20261019210000, md5 daec320c497c283929b33b55303aba89)
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
REVOKE EXECUTE ON FUNCTION public.servicos_financeiro() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.servicos_financeiro() TO authenticated;

-- 2) funcao do gatilho NEUTRALIZADA
CREATE OR REPLACE FUNCTION public.fn_servico_parcela_vencimento_manual()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [medios R10 fin #6] NEUTRALIZADA pela volta 20261020110000_down: nao mexe em nada (a coluna vencimento_manual fica,
-- sem leitor). O DROP TRIGGER fica no _down_drop (trava auth/storage - horario calmo). Reaplicar a 20261020110000
-- devolve o texto da ida.
BEGIN
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_servico_parcela_vencimento_manual() FROM PUBLIC, anon, authenticated;

-- 3) RPC nova
DROP FUNCTION IF EXISTS public.parcela_servico_voltar_vencimento_automatico(uuid);

DO $pos$
BEGIN
  IF md5(pg_get_functiondef('public.servicos_financeiro()'::regprocedure)) IS DISTINCT FROM 'daec320c497c283929b33b55303aba89' THEN
    RAISE EXCEPTION 'medios_r10_fin6 (volta): servicos_financeiro nao voltou ao texto da release 7' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef('public.fn_servico_parcela_vencimento_manual()'::regprocedure)) IS DISTINCT FROM 'd88bb1ed58effa55eaf473c5af73be6a' THEN
    RAISE EXCEPTION 'medios_r10_fin6 (volta): fn_servico_parcela_vencimento_manual nao ficou neutra' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.servicos_financeiro()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.servicos_financeiro()', 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r10_fin6 (volta): ACL de servicos_financeiro errada' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
