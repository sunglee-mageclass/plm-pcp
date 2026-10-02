-- INVERSO de supabase/migrations/20261025150000_estoque_aviamento_reprovado_planejamento.sql (achados MEDIOS R15a, fix
-- round 1, P-213 A no aviamento). Devolve o texto de ANTES de _estoque_aviamento_core (reserva so exclui o reprovado do
-- Desenvolvimento). Guarda: so roda se a funcao esta com o texto da ida e os leitores intocados; outro -> P0001 (rodar 2x =
-- a 2a recusa). Nada gravado muda. LIFO: roda DEPOIS do inverso da 20261025200000 e ANTES do da 20261025100000.
-- Travas: so CREATE OR REPLACE FUNCTION. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

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
      ('public._estoque_aviamento_core(uuid)',  'f6eea9360a5fee924824a323de47c53f'),
      ('public.estoque_aviamento()',            '2d778e4af3d65f8bba6ab87242eeb3bd'),
      ('public._dashboard_estoque_core()',      'b750c6a4b9c40b6895dac32cc39bde70'),
      ('public.baixar_os(text,uuid,jsonb)',     'b18fa580d263ddeb09b27e06325eb6cc')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'medios_r15a_av (volta): % nao existe', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r15a_av (volta): % nao esta com o texto esperado da 20261025150000 (md5 %) - nada a desfazer ou outra frente mexeu', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

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
    SELECT m.id FROM modelos m
    WHERE m.tenant_id = _tenant
      AND lower(COALESCE(m.status_desenvolvimento, '')) <> 'reprovado'
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

DO $pos$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public._estoque_aviamento_core(uuid)'))) IS DISTINCT FROM '76f4255aeec02dd59069c2e03ee70b0a' THEN
    RAISE EXCEPTION 'medios_r15a_av (volta): pos-condicao falhou - _estoque_aviamento_core nao voltou ao texto de antes' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public._estoque_aviamento_core(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._estoque_aviamento_core(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r15a_av (volta): _estoque_aviamento_core executavel por anon/authenticated (inv. #9)' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
