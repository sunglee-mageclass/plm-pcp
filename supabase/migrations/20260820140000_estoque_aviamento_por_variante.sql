-- ============================================================================
-- Estoque de AVIAMENTO passa a ser POR VARIANTE (cor base + apelido)
-- ----------------------------------------------------------------------------
-- Espelha o estoque de TECIDO (invariante #4): físico = recebido − baixa POR
-- ITEM/variante, fonte ÚNICA (_estoque_aviamento_core), ninguém re-implementa a
-- conta. Até aqui o core agregava só por aviamento_id; agora reagrupa por
-- (aviamento_id × variante_aviamento_id).
--
-- FONTES da variante (colunas já provisionadas na fundação 20260820120000):
--   recebido/prev_receb  ← ocs_aviamento_itens.variante_aviamento_id   (item 4)
--   baixa (CAD)          ← cad_aviamentos.variante_aviamento_id        (item 2)
--   reservado (modelo)   ← modelo_aviamentos.variante_aviamento_id     (item 2)
--   baixa/reserva (OS)   ← ordens_saida_aviamento_itens.variante_aviamento_id (item 5, ainda NULL)
--
-- REGRA DE ATRIBUIÇÃO DO LEGADO (decisão do dono: "à 1ª/única variante no
-- legado"): uma linha com variante_aviamento_id NULL é atribuída à ÚNICA variante
-- do aviamento QUANDO o aviamento tem exatamente 1 variante (CTE av_sole). É o
-- caso de TODO o backfill (cada aviamento com cor virou 1 variante) — o estoque
-- legado inteiro cai na variante backfillada, SEM perda. Quando o aviamento tem
-- 0 ou 2+ variantes, a linha NULL permanece no bucket "Sem variante" (variante_id
-- NULL) — "não sumir". Σ por aviamento ≡ Σ das variantes por construção (COALESCE
-- particiona as linhas; nenhuma quantidade é descartada — buckets = variantes
-- registradas ∪ toda (av,var) de origem). O clamp de físico (GREATEST(0,·)) passa
-- de por-aviamento p/ por-variante, alinhado ao tecido; para os dados atuais (1
-- bucket por aviamento) é idêntico byte-a-byte (provado no teste transacional).
--
-- CONSUMIDORES que rolam o MESMO core (sem re-implementar a conta):
--   estoque_aviamento() ....... wrapper da tela/OS (agora retorna por variante)
--   baixar_os() ............... trava de saldo da OS: SOMA fisico por aviamento
--   _dashboard_estoque_core() . dashboard: SOMA fisico por aviamento (nº idêntico)
--
-- Mudança de assinatura do core/wrapper (novas colunas de variante) exige DROP +
-- recreate → REVOKE/GRANT reaplicados (invariante #9: _core sem EXECUTE p/ os TRÊS
-- PUBLIC/anon/authenticated — já teve IDOR aqui; conferido com has_function_privilege).
-- baixar_os/dashboard usam CREATE OR REPLACE (assinatura intacta → ACL preservada),
-- diff-validados byte-a-byte fora as mudanças pontuais.
--
-- Idempotente (DROP IF EXISTS / CREATE OR REPLACE) e transacional (BEGIN/COMMIT).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) core + wrapper — DROP p/ trocar a assinatura (novas colunas de variante).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.estoque_aviamento();
DROP FUNCTION IF EXISTS public._estoque_aviamento_core(uuid);

CREATE FUNCTION public._estoque_aviamento_core(_tenant uuid)
RETURNS TABLE(
  id uuid, variante_id uuid,
  variante_nome text, variante_codigo text, cor text, apelido text,
  nome text, fornecedor_id uuid, fornecedor text,
  categoria_id uuid, categoria text,
  prev_receb numeric, recebido numeric, baixa numeric, reservado numeric,
  fisico numeric, previsto numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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

-- Wrapper: resolve o tenant do chamador + gate de módulo (invariante #9). O _core fica
-- sem EXECUTE p/ PUBLIC/anon/authenticated — só o wrapper e outras funções DEFINER
-- (dashboard, baixar_os) chamam o _core, sempre com o tenant certo.
CREATE FUNCTION public.estoque_aviamento()
RETURNS TABLE(
  id uuid, variante_id uuid,
  variante_nome text, variante_codigo text, cor text, apelido text,
  nome text, fornecedor_id uuid, fornecedor text,
  categoria_id uuid, categoria text,
  prev_receb numeric, recebido numeric, baixa numeric, reservado numeric,
  fisico numeric, previsto numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public._estoque_aviamento_core(public.get_user_tenant_id());
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._estoque_aviamento_core(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.estoque_aviamento() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.estoque_aviamento() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) baixar_os — trava de saldo (aviamento): SOMA fisico por aviamento, já que a OS
--    de aviamento é chaveada por aviamento_id (sem variante hoje). Rola o MESMO core.
--    Fora esse JOIN, corpo byte-idêntico (diff-validado). Assinatura intacta → ACL ok.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.baixar_os(_tipo text, _os_id uuid, _utilizado jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_htbl text; v_itbl text; v_ok boolean; v_baixado boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  IF _tipo NOT IN ('tecido','aviamento') THEN RAISE EXCEPTION 'Tipo de OS inválido'; END IF;
  v_tenant := public.get_user_tenant_id();
  v_htbl := 'ordens_saida_' || _tipo;
  v_itbl := 'ordens_saida_' || _tipo || '_itens';

  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE id=$1 AND (tenant_id=$2 OR public.is_super_admin()))', v_htbl)
    INTO v_ok USING _os_id, v_tenant;
  IF NOT v_ok THEN RAISE EXCEPTION 'OS não encontrada ou de outra loja'; END IF;

  -- Idempotência: OS já baixada não re-baixa (evita re-rodar a trava de saldo já defasada e
  -- sobrescrever os valores). Reverter é via desmarcar_os.
  EXECUTE format('SELECT COALESCE(baixado,false) FROM public.%I WHERE id=$1', v_htbl) INTO v_baixado USING _os_id;
  IF v_baixado THEN RAISE EXCEPTION 'OS já baixada — desmarque a baixa antes de baixar novamente.'; END IF;

  -- Trava de saldo (só aviamento): não deixa baixar acima do disponível (fisico da fonte
  -- canônica; a OS atual ainda não está baixada → não entra no fisico). O core agora é por
  -- variante — SOMAR fisico por aviamento (a OS de aviamento é por aviamento_id).
  IF _tipo = 'aviamento' THEN
    IF EXISTS (
      SELECT 1 FROM (
        SELECT oi.aviamento_id AS k,
               SUM(GREATEST(0, COALESCE(NULLIF(_utilizado->>oi.id::text,'')::numeric, oi.reserva, 0))) AS usado
        FROM public.ordens_saida_aviamento_itens oi
        WHERE oi.ordem_saida_id = _os_id AND oi.aviamento_id IS NOT NULL
        GROUP BY oi.aviamento_id
      ) g LEFT JOIN (
        SELECT id, SUM(fisico) AS fisico FROM public._estoque_aviamento_core(v_tenant) GROUP BY id
      ) ea ON ea.id = g.k
      WHERE g.usado > COALESCE(ea.fisico, 0) + 1e-9
    ) THEN
      RAISE EXCEPTION 'Baixa acima do estoque disponível de aviamento';
    END IF;
  ELSIF _tipo = 'tecido' THEN
    IF EXISTS (
      SELECT 1 FROM (
        SELECT oi.variante_tecido_id AS k,
               SUM(GREATEST(0, COALESCE(NULLIF(_utilizado->>oi.id::text,'')::numeric, oi.reserva, 0))) AS usado
        FROM public.ordens_saida_tecido_itens oi
        WHERE oi.ordem_saida_id = _os_id AND oi.variante_tecido_id IS NOT NULL
        GROUP BY oi.variante_tecido_id
      ) g LEFT JOIN public._estoque_tecido_core(v_tenant) ea ON ea.variante_tecido_id = g.k
      WHERE g.usado > COALESCE(ea.fisico, 0) + 1e-9
    ) THEN
      RAISE EXCEPTION 'Baixa acima do estoque disponível de tecido';
    END IF;
  END IF;

  EXECUTE format(
    'UPDATE public.%I oi SET baixa = GREATEST(0, COALESCE(NULLIF($2->>oi.id::text, '''')::numeric, oi.reserva, 0))
     WHERE oi.ordem_saida_id = $1', v_itbl)
    USING _os_id, _utilizado;
  EXECUTE format('UPDATE public.%I SET baixado = true WHERE id = $1', v_htbl) USING _os_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) _dashboard_estoque_core — o card de estoque de aviamento mantém a granularidade
--    POR AVIAMENTO (soma as variantes do core). Rola o MESMO core (sem re-implementar
--    a conta); número idêntico ao anterior. Só a CTE `avi` muda (diff-validado).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._dashboard_estoque_core()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_total_var int; v_total_avi int;
  v_estoque_tec jsonb; v_estoque_avi jsonb; v_bar_tec jsonb; v_bar_avi jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  WITH tec AS (
    -- fonte ÚNICA (mesma da tela): _estoque_tecido_core já exclui item destrinchado em rolo,
    -- inclui OS, clampa >=0 e trata substituto/zerado — corrige a divergência do dashboard
    -- (antes contava rolo 2×, tratava separacao_rolo como consumo e ignorava a OS).
    SELECT ea.variante_tecido_id AS id,
           (COALESCE(art.nome,'—') || ' · ' || COALESCE(v.nome_variante, v.codigo_variante, co.nome, '—')) AS nome,
           COALESCE(cat.nome,'Sem categoria') AS categoria,
           ea.fisico AS estoque,
           'Tecido' AS tipo
    FROM public._estoque_tecido_core(v_tenant) ea
    JOIN variantes_tecido v ON v.id = ea.variante_tecido_id
    JOIN artigos art ON art.id = v.artigo_id
    LEFT JOIN cores co ON co.id = v.cor_id
    LEFT JOIN categorias_tecido cat ON cat.id = art.categoria_tecido_id
  ),
  avi AS (
    -- Estoque por variante (2026-08): _estoque_aviamento_core retorna 1 linha por
    -- aviamento×variante. O dashboard mantém a granularidade POR AVIAMENTO (SUM das
    -- variantes), rolando o MESMO core — número idêntico ao anterior (mesma definição
    -- da tela: fisico clampado >=0, inclui OS baixadas, exclui cancelado+encomendado).
    SELECT ea.id, max(ea.nome) AS nome, COALESCE(max(ea.categoria),'Sem categoria') AS categoria,
           SUM(ea.fisico) AS estoque, 'Aviamento' AS tipo
    FROM public._estoque_aviamento_core(v_tenant) ea
    GROUP BY ea.id
  )
  SELECT
    (SELECT count(*) FROM variantes_tecido v JOIN artigos a ON a.id=v.artigo_id AND a.tenant_id=v_tenant),
    (SELECT count(*) FROM aviamentos WHERE tenant_id = v_tenant),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome,'categoria',categoria,'estoque',estoque) ORDER BY estoque DESC)
              FROM (SELECT id,nome,categoria,estoque FROM tec ORDER BY estoque DESC LIMIT 50) t), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome,'categoria',categoria,'estoque',estoque) ORDER BY estoque DESC)
              FROM (SELECT id,nome,categoria,estoque FROM avi ORDER BY estoque DESC LIMIT 50) t), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria',categoria,'total',total))
              FROM (SELECT categoria, SUM(GREATEST(0,estoque)) AS total FROM tec GROUP BY categoria) c), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria',categoria,'total',total))
              FROM (SELECT categoria, SUM(GREATEST(0,estoque)) AS total FROM avi GROUP BY categoria) c), '[]'::jsonb)
  INTO v_total_var, v_total_avi, v_estoque_tec, v_estoque_avi, v_bar_tec, v_bar_avi;

  RETURN jsonb_build_object(
    'totalVariantes', v_total_var,
    'totalAviamentos', v_total_avi,
    'estoqueTecido', v_estoque_tec,
    'estoqueAviamento', v_estoque_avi,
    'barTecido', v_bar_tec,
    'barAviamento', v_bar_avi
  );
END;
$function$;

COMMIT;
