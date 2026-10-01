-- Achados MEDIOS, release R15a (estoque; so banco, sem site) - fix round 1: P-213 A (dono 01/out) no estoque de AVIAMENTO.
--   Card "reprovado" = lower(coalesce(status_desenvolvimento,''))='reprovado' OU lower(coalesce(status_planejamento,''))=
--   'reprovado'. _estoque_aviamento_core (fonte unica do aviamento, inv. #4) so olhava o Desenvolvimento na reserva
--   (CTE aprovado_nao_cad); agora o card reprovado no Planejamento tambem nao reserva aviamento - a MESMA regra da reserva
--   de tecido (_estoque_tecido_core, 20261025100000). So muda a reserva (e o previsto); recebido/baixa/fisico iguais.
-- PRE-CONDICAO DENTRO DA MIGRATION (transacao REPEATABLE READ): recalcula TODOS os buckets (aviamento x variante) de TODAS
-- as lojas com o texto de antes e o de depois e ABORTA (P0001) se a_receber/recebido/baixa/fisico mudarem, se reservado
-- mudar diferente da reducao esperada (_r15av_reserva_esperada: consumo x grade dos cards reprovados SO no Planejamento,
-- nao enviados ao corte, pelo mesmo bucketing do core), se previsto nao mudar exatamente -delta_reservado, ou se surgir
-- bucket novo. Bucket que SOME (so existia pela reserva desses cards) so e aceito se a_receber/recebido/baixa = 0 e a
-- reserva dele = a esperada. Na copia 54422: 0 buckets mudam (os 2 cards com aviamento - VESTIDO LEDA e VESTIDO
-- ASSIMETRICO BIANCA, Ave Rara - tem grade 0). Producao: lista na consulta supabase/consultas/r15_p213_reserva_previa.sql.
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public._estoque_aviamento_core(uuid)
--     ANTES  76f4255aeec02dd59069c2e03ee70b0a  -- PROVISORIO (copia 54422; fora do Passo 0): conferir no Passo 0 do kit R15
--     DEPOIS f6eea9360a5fee924824a323de47c53f  (este arquivo; reaplicar = no-op)
--   Leitores SEM mudanca (so guarda; rolam o core):
--     public.estoque_aviamento()              2d778e4af3d65f8bba6ab87242eeb3bd  -- PROVISORIO (copia 54422)
--     public._dashboard_estoque_core()         b750c6a4b9c40b6895dac32cc39bde70  -- PROVISORIO (copia 54422)
--     public.baixar_os(text,uuid,jsonb)        b18fa580d263ddeb09b27e06325eb6cc  -- PROVISORIO (copia 54422)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION. ACL mantida (_estoque_aviamento_core sem EXECUTE para PUBLIC/anon/authenticated,
-- inv. #9 - ja teve IDOR aqui) - conferido no fim. Nada gravado muda.
-- Volta: supabase/rollback/20261025150000_estoque_aviamento_reprovado_planejamento_down.sql. LIFO: roda DEPOIS do inverso
-- da 20261025200000 e ANTES do da 20261025100000.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _r15av_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _r15av_md5_aceitos VALUES
  ('public._estoque_aviamento_core(uuid)',  '76f4255aeec02dd59069c2e03ee70b0a', 'antes'),    -- PROVISORIO (copia 54422): conferir no Passo 0 do kit R15
  ('public._estoque_aviamento_core(uuid)',  'f6eea9360a5fee924824a323de47c53f', 'depois'),
  ('public.estoque_aviamento()',            '2d778e4af3d65f8bba6ab87242eeb3bd', 'leitor'),   -- PROVISORIO (copia 54422)
  ('public._dashboard_estoque_core()',      'b750c6a4b9c40b6895dac32cc39bde70', 'leitor'),   -- PROVISORIO (copia 54422)
  ('public.baixar_os(text,uuid,jsonb)',     'b18fa580d263ddeb09b27e06325eb6cc', 'leitor');   -- PROVISORIO (copia 54422)

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _r15av_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'medios_r15a_av: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _r15av_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'medios_r15a_av: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

-- reaplicar (o core ja esta com o texto deste arquivo) = nada muda: a reducao esperada da reserva vira 0
CREATE TEMP TABLE _r15av_estado ON COMMIT DROP AS
  SELECT md5(pg_get_functiondef(to_regprocedure('public._estoque_aviamento_core(uuid)'))) = 'f6eea9360a5fee924824a323de47c53f' AS ja_aplicada;

CREATE TEMP TABLE _r15av_antes ON COMMIT DROP AS
  SELECT t.id AS tenant_id, t.nome::text AS loja, c.id AS av, c.variante_id AS var,
         c.prev_receb, c.recebido, c.baixa, c.reservado, c.fisico, c.previsto
    FROM public.tenants t CROSS JOIN LATERAL public._estoque_aviamento_core(t.id) c;

-- reducao ESPERADA da reserva por (loja, aviamento, variante): consumo x grade dos cards reprovados SO no Planejamento,
-- nao enviados ao corte, com o MESMO bucketing do core (variante NULL -> variante unica do aviamento)
CREATE TEMP TABLE _r15av_reserva_esperada ON COMMIT DROP AS
  SELECT t.id AS tenant_id, x.av, x.var, SUM(x.m) AS m
    FROM public.tenants t
    CROSS JOIN LATERAL (
      WITH av_sole AS (
        SELECT aviamento_id, (array_agg(id ORDER BY created_at, id))[1] AS var
          FROM public.variantes_aviamento WHERE tenant_id = t.id
         GROUP BY aviamento_id HAVING count(*) = 1
      ), mod_grade AS (
        SELECT modelo_id, SUM(COALESCE(grade_total, 0)) AS gt FROM public.modelo_grades GROUP BY modelo_id
      )
      SELECT ma.aviamento_id AS av, COALESCE(ma.variante_aviamento_id, s.var) AS var,
             COALESCE(ma.consumo, 0) * COALESCE(mg.gt, 0) AS m
        FROM public.modelo_aviamentos ma
        JOIN public.modelos m ON m.id = ma.modelo_id AND m.tenant_id = t.id
         AND lower(COALESCE(m.status_desenvolvimento, '')) <> 'reprovado'
         AND lower(COALESCE(m.status_planejamento, '')) = 'reprovado'
         AND NOT EXISTS (SELECT 1 FROM public.cad c WHERE c.modelo_id = m.id AND c.enviado_corte)
        LEFT JOIN mod_grade mg ON mg.modelo_id = ma.modelo_id
        LEFT JOIN av_sole s ON s.aviamento_id = ma.aviamento_id
       WHERE ma.aviamento_id IS NOT NULL
    ) x
   GROUP BY t.id, x.av, x.var;

CREATE OR REPLACE FUNCTION public._estoque_aviamento_core(_tenant uuid)
 RETURNS TABLE(id uuid, variante_id uuid, variante_nome text, variante_codigo text, cor text, apelido text, nome text, fornecedor_id uuid, fornecedor text, categoria_id uuid, categoria text, prev_receb numeric, recebido numeric, baixa numeric, reservado numeric, fisico numeric, previsto numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  -- Variante ÚNICA por aviamento (só quando count=1) — alvo da atribuição do legado.
  av_sole AS (
    SELECT aviamento_id, (array_agg(id ORDER BY created_at, id))[1] AS var
    FROM variantes_aviamento
    WHERE tenant_id = _tenant
    GROUP BY aviamento_id
    HAVING count(*) = 1
  ),
  rec AS (
    SELECT i.aviamento_id AS av, COALESCE(i.variante_aviamento_id, s.var) AS var,
           SUM(COALESCE(i.quantidade_recebida, i.quantidade_pedida, 0)) AS tot
    FROM ocs_aviamento_itens i
    JOIN ocs_aviamento oc ON oc.id = i.oc_aviamento_id AND oc.tenant_id = _tenant
    LEFT JOIN av_sole s ON s.aviamento_id = i.aviamento_id
    WHERE i.aviamento_id IS NOT NULL AND oc.status = 'recebido' AND COALESCE(i.cancelado, false) = false
    GROUP BY i.aviamento_id, COALESCE(i.variante_aviamento_id, s.var)
  ),
  prev AS (
    SELECT i.aviamento_id AS av, COALESCE(i.variante_aviamento_id, s.var) AS var,
           SUM(COALESCE(i.quantidade_pedida, 0)) AS tot
    FROM ocs_aviamento_itens i
    JOIN ocs_aviamento oc ON oc.id = i.oc_aviamento_id AND oc.tenant_id = _tenant
    LEFT JOIN av_sole s ON s.aviamento_id = i.aviamento_id
    WHERE i.aviamento_id IS NOT NULL AND oc.status = 'encomendado' AND COALESCE(i.cancelado, false) = false
    GROUP BY i.aviamento_id, COALESCE(i.variante_aviamento_id, s.var)
  ),
  baixa_cad AS (
    SELECT ca.aviamento_id AS av, COALESCE(ca.variante_aviamento_id, s.var) AS var,
           SUM(COALESCE(NULLIF(ca.quantidade_separar, 0), ca.quantidade_enviar, 0)) AS tot
    FROM cad_aviamentos ca
    JOIN cad c ON c.id = ca.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
    LEFT JOIN av_sole s ON s.aviamento_id = ca.aviamento_id
    WHERE ca.aviamento_id IS NOT NULL
    GROUP BY ca.aviamento_id, COALESCE(ca.variante_aviamento_id, s.var)
  ),
  os_baixa AS (
    SELECT oi.aviamento_id AS av, COALESCE(oi.variante_aviamento_id, s.var) AS var,
           SUM(COALESCE(oi.baixa, 0)) AS tot
    FROM ordens_saida_aviamento_itens oi
    JOIN ordens_saida_aviamento os ON os.id = oi.ordem_saida_id AND os.tenant_id = _tenant AND os.baixado
    LEFT JOIN av_sole s ON s.aviamento_id = oi.aviamento_id
    WHERE oi.aviamento_id IS NOT NULL
    GROUP BY oi.aviamento_id, COALESCE(oi.variante_aviamento_id, s.var)
  ),
  os_reserva AS (
    SELECT oi.aviamento_id AS av, COALESCE(oi.variante_aviamento_id, s.var) AS var,
           SUM(COALESCE(oi.reserva, 0)) AS tot
    FROM ordens_saida_aviamento_itens oi
    JOIN ordens_saida_aviamento os ON os.id = oi.ordem_saida_id AND os.tenant_id = _tenant AND NOT os.baixado
    LEFT JOIN av_sole s ON s.aviamento_id = oi.aviamento_id
    WHERE oi.aviamento_id IS NOT NULL
    GROUP BY oi.aviamento_id, COALESCE(oi.variante_aviamento_id, s.var)
  ),
  mod_grade AS (
    SELECT modelo_id, SUM(COALESCE(grade_total, 0)) AS gt FROM modelo_grades GROUP BY modelo_id
  ),
  aprovado_nao_cad AS (
    -- [medios R15a P-213 A, dono 01/out] card "reprovado" = status_desenvolvimento OU status_planejamento 'reprovado'
    -- (mesmo predicado da reserva de tecido, _estoque_tecido_core): nao reserva.
    SELECT m.id FROM modelos m
    WHERE m.tenant_id = _tenant
      AND lower(COALESCE(m.status_desenvolvimento, '')) <> 'reprovado'
      AND lower(COALESCE(m.status_planejamento, '')) <> 'reprovado'
      AND NOT EXISTS (SELECT 1 FROM cad c WHERE c.modelo_id = m.id AND c.enviado_corte)
  ),
  reserva_modelo AS (
    SELECT ma.aviamento_id AS av, COALESCE(ma.variante_aviamento_id, s.var) AS var,
           SUM(COALESCE(ma.consumo, 0) * COALESCE(mg.gt, 0)) AS tot
    FROM modelo_aviamentos ma
    JOIN aprovado_nao_cad anc ON anc.id = ma.modelo_id
    LEFT JOIN mod_grade mg ON mg.modelo_id = ma.modelo_id
    LEFT JOIN av_sole s ON s.aviamento_id = ma.aviamento_id
    WHERE ma.aviamento_id IS NOT NULL
    GROUP BY ma.aviamento_id, COALESCE(ma.variante_aviamento_id, s.var)
  ),
  -- Universo de buckets: TODA variante registrada (mesmo sem estoque, como o tecido
  -- lista toda variante) ∪ TODA (av,var) que aparece em qualquer origem (garante que
  -- nenhuma quantidade — nem o bucket NULL "Sem variante" — seja descartada).
  buckets AS (
    SELECT a.id AS av, va.id AS var
      FROM aviamentos a
      JOIN variantes_aviamento va ON va.aviamento_id = a.id AND va.tenant_id = _tenant
     WHERE a.tenant_id = _tenant
    -- Aviamento SEM nenhuma variante registrada aparece com 1 linha "Sem variante"
    -- (NULL) — preserva "todo aviamento aparece" da tela antiga (não sumir), mesmo
    -- container zerado/sem cor. Aviamento COM variante não ganha bucket NULL espúrio
    -- (só o que tiver atividade NULL de fato, via as CTEs abaixo).
    UNION SELECT a.id, NULL::uuid
      FROM aviamentos a
     WHERE a.tenant_id = _tenant
       AND NOT EXISTS (SELECT 1 FROM variantes_aviamento va
                       WHERE va.aviamento_id = a.id AND va.tenant_id = _tenant)
    UNION SELECT av, var FROM rec
    UNION SELECT av, var FROM prev
    UNION SELECT av, var FROM baixa_cad
    UNION SELECT av, var FROM os_baixa
    UNION SELECT av, var FROM os_reserva
    UNION SELECT av, var FROM reserva_modelo
  ),
  agg AS (
    SELECT
      a.id,
      b.var AS variante_id,
      va.nome_variante::text   AS variante_nome,
      va.codigo_variante::text AS variante_codigo,
      co.nome::text            AS cor,
      cap.nome::text           AS apelido,
      a.codigo_nome::text AS nome,
      a.empresa_id AS fornecedor_id,
      COALESCE(e.nome_fantasia, '—')::text AS fornecedor,
      a.categoria_aviamento_id AS categoria_id,
      cav.nome::text AS categoria,
      COALESCE(prev.tot, 0) AS prev_receb,
      COALESCE(rec.tot, 0) AS recebido,
      COALESCE(bc.tot, 0) + COALESCE(ob.tot, 0) AS baixa,
      COALESCE(rm.tot, 0) + COALESCE(orr.tot, 0) AS reservado
    FROM buckets b
    JOIN aviamentos a ON a.id = b.av AND a.tenant_id = _tenant
    LEFT JOIN variantes_aviamento va ON va.id = b.var
    LEFT JOIN cores co ON co.id = va.cor_id
    LEFT JOIN cores_apelido cap ON cap.id = va.cor_apelido_id
    LEFT JOIN empresas e ON e.id = a.empresa_id
    LEFT JOIN categorias_aviamento cav ON cav.id = a.categoria_aviamento_id
    LEFT JOIN rec            ON rec.av = b.av  AND rec.var  IS NOT DISTINCT FROM b.var
    LEFT JOIN prev           ON prev.av = b.av AND prev.var IS NOT DISTINCT FROM b.var
    LEFT JOIN baixa_cad bc   ON bc.av = b.av   AND bc.var   IS NOT DISTINCT FROM b.var
    LEFT JOIN os_baixa ob    ON ob.av = b.av   AND ob.var   IS NOT DISTINCT FROM b.var
    LEFT JOIN os_reserva orr ON orr.av = b.av  AND orr.var  IS NOT DISTINCT FROM b.var
    LEFT JOIN reserva_modelo rm ON rm.av = b.av AND rm.var  IS NOT DISTINCT FROM b.var
  )
  SELECT
    agg.id, agg.variante_id, agg.variante_nome, agg.variante_codigo, agg.cor, agg.apelido,
    agg.nome, agg.fornecedor_id, agg.fornecedor, agg.categoria_id, agg.categoria,
    agg.prev_receb, agg.recebido, agg.baixa, agg.reservado,
    GREATEST(0, agg.recebido - agg.baixa) AS fisico,
    GREATEST(0, agg.recebido - agg.baixa) + agg.prev_receb - agg.reservado AS previsto
  FROM agg
$function$;
REVOKE EXECUTE ON FUNCTION public._estoque_aviamento_core(uuid) FROM PUBLIC, anon, authenticated;

CREATE TEMP TABLE _r15av_depois ON COMMIT DROP AS
  SELECT t.id AS tenant_id, t.nome::text AS loja, c.id AS av, c.variante_id AS var,
         c.prev_receb, c.recebido, c.baixa, c.reservado, c.fisico, c.previsto
    FROM public.tenants t CROSS JOIN LATERAL public._estoque_aviamento_core(t.id) c;

DO $precondicao$
DECLARE
  r record;
  v_n int;
  v_dif int := 0;
BEGIN
  SELECT count(*) INTO v_n FROM _r15av_antes;
  FOR r IN
    SELECT COALESCE(a.loja, d.loja) AS loja, COALESCE(a.av, d.av) AS av, COALESCE(a.var, d.var) AS var,
           (a.av IS NULL) AS so_depois, (d.av IS NULL) AS so_antes,
           a.prev_receb AS prev_a, d.prev_receb AS prev_d, a.recebido AS rec_a, d.recebido AS rec_d,
           a.baixa AS bx_a, d.baixa AS bx_d, a.fisico AS fis_a, d.fisico AS fis_d,
           a.reservado AS res_a, d.reservado AS res_d, a.previsto AS pv_a, d.previsto AS pv_d,
           CASE WHEN (SELECT ja_aplicada FROM _r15av_estado) THEN 0 ELSE COALESCE(x.m, 0) END AS res_esperada
      FROM _r15av_antes a
      FULL JOIN _r15av_depois d ON d.tenant_id = a.tenant_id AND d.av = a.av AND d.var IS NOT DISTINCT FROM a.var
      LEFT JOIN _r15av_reserva_esperada x ON x.tenant_id = COALESCE(a.tenant_id, d.tenant_id) AND x.av = COALESCE(a.av, d.av)
                                         AND x.var IS NOT DISTINCT FROM COALESCE(a.var, d.var)
  LOOP
    IF r.so_depois THEN
      RAISE EXCEPTION 'medios_r15a_av: pre-condicao - bucket novo %:% (nao devia)', r.loja, left(r.av::text, 8) USING ERRCODE = 'P0001';
    END IF;
    IF r.so_antes THEN
      IF COALESCE(r.prev_a, 0) <> 0 OR COALESCE(r.rec_a, 0) <> 0 OR COALESCE(r.bx_a, 0) <> 0
         OR abs(COALESCE(r.res_a, 0) - r.res_esperada) > 0.0001 THEN
        RAISE EXCEPTION 'medios_r15a_av: pre-condicao - bucket %:% sumiu e nao era so a reserva dos cards reprovados no Planejamento',
          r.loja, left(r.av::text, 8) USING ERRCODE = 'P0001';
      END IF;
      v_dif := v_dif + 1;
      RAISE NOTICE 'medios_r15a_av: % : % (variante %) sumiu - reservado % so de cards reprovados no Planejamento',
        r.loja, left(r.av::text, 8), COALESCE(left(r.var::text, 8), 'NULL'), round(r.res_a, 4);
      CONTINUE;
    END IF;
    IF (r.prev_a, r.rec_a, r.bx_a, r.fis_a) IS DISTINCT FROM (r.prev_d, r.rec_d, r.bx_d, r.fis_d) THEN
      RAISE EXCEPTION 'medios_r15a_av: pre-condicao - a receber/recebido/baixa/fisico de %:% mudou (nao devia)', r.loja, left(r.av::text, 8)
        USING ERRCODE = 'P0001';
    END IF;
    IF abs((r.res_a - r.res_d) - r.res_esperada) > 0.0001 THEN
      RAISE EXCEPTION 'medios_r15a_av: pre-condicao - reservado de %:% mudou % (esperado -% pela P-213)', r.loja, left(r.av::text, 8),
        round(r.res_d - r.res_a, 4), round(r.res_esperada, 4) USING ERRCODE = 'P0001';
    END IF;
    IF abs((r.pv_d - r.pv_a) + (r.res_d - r.res_a)) > 0.0001 THEN
      RAISE EXCEPTION 'medios_r15a_av: pre-condicao - previsto de %:% mudou diferente da reserva', r.loja, left(r.av::text, 8)
        USING ERRCODE = 'P0001';
    END IF;
    IF r.res_a IS DISTINCT FROM r.res_d THEN
      v_dif := v_dif + 1;
      RAISE NOTICE 'medios_r15a_av: % : % (variante %) reservado %>% previsto %>%', r.loja, left(r.av::text, 8),
        COALESCE(left(r.var::text, 8), 'NULL'), round(r.res_a, 4), round(r.res_d, 4), round(r.pv_a, 4), round(r.pv_d, 4);
    END IF;
  END LOOP;
  RAISE NOTICE 'medios_r15a_av: pre-condicao OK - % buckets conferidos, % mudaram (lista acima)', v_n, v_dif;
END $precondicao$;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT assinatura, md5, papel FROM _r15av_md5_aceitos WHERE papel IN ('depois','leitor') LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.assinatura))) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'medios_r15a_av: pos-condicao falhou - % nao ficou com o texto esperado (%)', r.assinatura, r.papel
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public._estoque_aviamento_core(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._estoque_aviamento_core(uuid)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public._estoque_aviamento_core(uuid)') AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r15a_av: _estoque_aviamento_core ficou executavel por PUBLIC/anon/authenticated (inv. #9)' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
