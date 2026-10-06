-- Urgentes R11c - fonte unica do estoque + Historico da mini: os 2 cores somam o ledger novo e os 3 extratos mostram. GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-d.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-r11.md (Task 2 / R11c; Rulings 2, 3, 16) + inv. 4 (fonte unica) e P-343 (custo nao le o ledger).
-- O que muda (so catalogo: 5 CREATE OR REPLACE FUNCTION; nenhum dado; nenhuma conta nova - FONTE UNICA, inv. 4):
--   1) _estoque_aviamento_core: CTE baixa_pt (ledger estoque_peca_teste_baixas, familia 'aviamento', por aviamento x variante,
--      SUM do liquido = estorno compensa) entra no UNION de buckets e em baixa = bc + ob + bp.
--   2) _estoque_etiqueta_core: CTE baixa_pt (familia 'insumo', por etiqueta/tamanho/cor) entra no union all do baixa.
--   3) _estoque_extrato_aviamento_core / _insumo_core: CTE sai_pt (1 linha por registro do ledger; q = -quantidade; mod_ref =
--      REF/nome do card vivo via tentativa->modelo senao NULL; det = rotulo; quem = users.nome do created_by) entra em mov.
--   4) _estoque_extrato_tecido_core: o led mapeia peca_teste/peca_teste_estorno e mod_ref = card do cad OU card da tentativa.
-- Soma do extrato = recebido - baixa por bucket nos 3 POR CONSTRUCAO -> a varredura urg_r3_extrato_varredura.sql fica 0 (inclusive
-- com baixas de peca teste semeadas). Nenhuma funcao _custo% le o ledger (P-343). O pino da 177000 (urg-a3-extrato.test.ts) passa a
-- ler ESTE bloco (a ULTIMA migration com as linhas (espelhado; exigido); Ruling 3, mudanca deliberada):
--   public._estoque_tecido_core(uuid)  (espelhado; exigido) 9140c253a8b62fa143de052d84a1c329
--   public._estoque_aviamento_core(uuid)  (espelhado; exigido) 439093c8501001c17e71f283b1dcef92
--   public._estoque_etiqueta_core(uuid)  (espelhado; exigido) de6eeb18e1e15cf8137a6560e451fa0f
-- Trava (MEDIDA na copia local, supautils carregado, diferenca de pg_locks numa txn REVERTIDA, DDL digitada): SO catalogo +
--   AccessShareLock (LEITURA, nao bloqueia escrita) em ~23 tabelas, da VALIDACAO plpgsql dos 3 extratos ao CREATE OR REPLACE
--   (os 2 cores sql so pegam catalogo). NENHUM ShareRowExclusive/AccessExclusive de dado; 0 em auth/storage/realtime. Qualquer
--   hora. lock_timeout 1500ms. Idempotente (2a vez = mesmos md5).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._estoque_aviamento_core(uuid)
--     ANTES  f6eea9360a5fee924824a323de47c53f
--     DEPOIS 439093c8501001c17e71f283b1dcef92
--   public._estoque_etiqueta_core(uuid)
--     ANTES  e7681ebd0e2a32144ca41795735182fc
--     DEPOIS de6eeb18e1e15cf8137a6560e451fa0f
--   public._estoque_extrato_tecido_core(uuid,uuid)
--     ANTES  bccc3cb6423a88d4942921f2e72c03fb
--     DEPOIS 0c73603f23ad1d74022457d699f7d834
--   public._estoque_extrato_aviamento_core(uuid,uuid)
--     ANTES  c86981af6abf8129f5142e3636083483
--     DEPOIS 00759c836dd9ee40a4dcf1db427c9276
--   public._estoque_extrato_insumo_core(uuid,uuid)
--     ANTES  9f2013ad56ec77e0601d51b32b793708
--     DEPOIS 808b80ed2183c812533d3ee92978bddd
--   dependencias FIXADAS (nao redefinidas):
--     public._estoque_tecido_core(uuid) 9140c253a8b62fa143de052d84a1c329
--     public._insumo_pecas(text,jsonb,numeric) 2e1b701be975366933e9ad704cb25c18
--     public._insumo_tamanho_de(uuid) 46fd6f65599f7de2d3ab12777fefa7d1
-- ====================================================================================
-- Volta (LIFO, banco DEPOIS do site): supabase/rollback/20261103199200_urg_r11_estoque_fonte_unica_down.sql - DEPOIS do 199400_down/199300_down e ANTES do 199100_down (no-op). Devolve os 5
-- textos de ANTES (os cores deixam de somar o ledger novo; os extratos deixam de mostrar a peca teste). RECUSA sem
-- SET app.confirmo_volta_estoque_peca_teste='sim' quando o ledger tiver linhas. Sem _down_drop. Com este bloco no banco, o
-- 20261103177000_down/_down_drop e o 20261103171000_down (171000, etiqueta) RECUSAM pelo md5 dos cores/extratos (LIFO protege).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._estoque_aviamento_core(uuid)', 'f6eea9360a5fee924824a323de47c53f', '439093c8501001c17e71f283b1dcef92'),
      ('public._estoque_etiqueta_core(uuid)', 'e7681ebd0e2a32144ca41795735182fc', 'de6eeb18e1e15cf8137a6560e451fa0f'),
      ('public._estoque_extrato_tecido_core(uuid,uuid)', 'bccc3cb6423a88d4942921f2e72c03fb', '0c73603f23ad1d74022457d699f7d834'),
      ('public._estoque_extrato_aviamento_core(uuid,uuid)', 'c86981af6abf8129f5142e3636083483', '00759c836dd9ee40a4dcf1db427c9276'),
      ('public._estoque_extrato_insumo_core(uuid,uuid)', '9f2013ad56ec77e0601d51b32b793708', '808b80ed2183c812533d3ee92978bddd')
    ) AS x(f, a, d) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.d) THEN
      RAISE EXCEPTION 'urg_r11c: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- dependencias FIXADAS (nao redefinidas aqui): o texto de hoje
  FOR r IN SELECT * FROM (VALUES
      ('public._estoque_tecido_core(uuid)', '9140c253a8b62fa143de052d84a1c329'),
      ('public._insumo_pecas(text,jsonb,numeric)', '2e1b701be975366933e9ad704cb25c18'),
      ('public._insumo_tamanho_de(uuid)', '46fd6f65599f7de2d3ab12777fefa7d1')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r11c: dependencia % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regclass('public.estoque_peca_teste_baixas') IS NULL THEN
    RAISE EXCEPTION 'urg_r11c: exige a 20261103199000 (urg R11a) aplicada' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'estoque_tecido_baixas'
                   AND column_name = 'peca_teste_tentativa_id') THEN
    RAISE EXCEPTION 'urg_r11c: exige a 20261103199100 (urg R11b) aplicada' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- 1) funcao EXISTENTE redefinida (troca exata sobre o texto de ANTES)
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
  -- [urg r11c] baixa da PECA TESTE (ledger estoque_peca_teste_baixas, familia 'aviamento'): estorno = linha compensatoria
  -- negativa (SUM do liquido), bucket = aviamento x COALESCE(variante, variante unica do legado), igual ao os_baixa.
  baixa_pt AS (
    SELECT b.aviamento_id AS av, COALESCE(b.variante_aviamento_id, s.var) AS var,
           SUM(COALESCE(b.quantidade, 0)) AS tot
    FROM estoque_peca_teste_baixas b
    LEFT JOIN av_sole s ON s.aviamento_id = b.aviamento_id
    WHERE b.tenant_id = _tenant AND b.familia = 'aviamento' AND b.aviamento_id IS NOT NULL
    GROUP BY b.aviamento_id, COALESCE(b.variante_aviamento_id, s.var)
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
    UNION SELECT av, var FROM baixa_pt
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
      COALESCE(bc.tot, 0) + COALESCE(ob.tot, 0) + COALESCE(bp.tot, 0) AS baixa,
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
    LEFT JOIN baixa_pt bp    ON bp.av = b.av   AND bp.var   IS NOT DISTINCT FROM b.var
  )
  SELECT
    agg.id, agg.variante_id, agg.variante_nome, agg.variante_codigo, agg.cor, agg.apelido,
    agg.nome, agg.fornecedor_id, agg.fornecedor, agg.categoria_id, agg.categoria,
    agg.prev_receb, agg.recebido, agg.baixa, agg.reservado,
    GREATEST(0, agg.recebido - agg.baixa) AS fisico,
    GREATEST(0, agg.recebido - agg.baixa) + agg.prev_receb - agg.reservado AS previsto
  FROM agg
$function$;

CREATE OR REPLACE FUNCTION public._estoque_etiqueta_core(_tenant uuid)
 RETURNS TABLE(etiqueta_id uuid, etiqueta_nome text, variante_id uuid, tamanho text, cor_nome text, recebido numeric, prev_receb numeric, baixa numeric, fisico numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with
  rec as (  -- recebido: chave (etiqueta, tamanho, cor) da variante da OC recebida
    select i.etiqueta_id as etq, ve.tamanho as tam, ve.cor_id as cor,
           sum(coalesce(i.quantidade_recebida, i.quantidade_pedida, 0)) as tot
    from ocs_etiqueta_itens i
    join ocs_etiqueta o on o.id = i.oc_etiqueta_id and o.tenant_id = _tenant and o.status = 'recebido'
    left join variantes_etiqueta ve on ve.id = i.variante_etiqueta_id
    where coalesce(i.cancelado, false) = false
    group by 1, 2, 3
  ),
  prev as (  -- previsto: OC encomendada
    select i.etiqueta_id as etq, ve.tamanho as tam, ve.cor_id as cor,
           sum(coalesce(i.quantidade_pedida, 0)) as tot
    from ocs_etiqueta_itens i
    join ocs_etiqueta o on o.id = i.oc_etiqueta_id and o.tenant_id = _tenant and o.status = 'encomendado'
    left join variantes_etiqueta ve on ve.id = i.variante_etiqueta_id
    where coalesce(i.cancelado, false) = false
    group by 1, 2, 3
  ),
  baixa_var as (  -- consumo por tamanho: chave (etiqueta, tamanho=key, cor do CAD)
    select ce.etiqueta_id as etq, kv.key as tam, ce.cor_id as cor, sum((kv.value)::numeric) as tot
    from cad_etiquetas ce
    join cad c on c.id = ce.cad_id and c.tenant_id = _tenant and c.enviado_corte
    join lateral jsonb_each_text(coalesce(ce.enviar_por_tamanho, '{}'::jsonb)) kv on true
    group by 1, 2, 3
  ),
  ce_sem as (  -- [medios R16 est #7, P-188 A] linhas do "a enviar" SEM enviar_por_tamanho. Insumo COM tamanho (formato
               -- <> 'nenhum' e alguma variante com tamanho - a mesma regra da Ficha de Corte) ganha os pesos = grade do
               -- CAD por tamanho (soma das variantes de cad_grades.grades_planejadas, so tamanhos com peca > 0).
    select ce.etiqueta_id as etq, ce.cor_id as cor, coalesce(ce.quantidade_enviar, 0) as qe,
           case when coalesce(e.formato_tamanho, 'ambos') <> 'nenhum'
                 and exists (select 1 from variantes_etiqueta ve where ve.etiqueta_id = ce.etiqueta_id and ve.tamanho is not null)
                then (select jsonb_object_agg(w.k, w.s)
                        from (select kv.key as k, sum((kv.value)::numeric) as s
                                from cad_grades g
                                cross join lateral jsonb_each_text(coalesce(g.grades_planejadas, '{}'::jsonb)) kv
                               where g.cad_id = ce.cad_id and kv.value ~ '^[0-9]+(\.[0-9]+)?$'
                               group by kv.key
                              having sum((kv.value)::numeric) > 0) w)
           end as pesos
    from cad_etiquetas ce
    join cad c on c.id = ce.cad_id and c.tenant_id = _tenant and c.enviado_corte
    left join etiquetas e on e.id = ce.etiqueta_id
    where coalesce(ce.enviar_por_tamanho, '{}'::jsonb) = '{}'::jsonb
  ),
  baixa_grade as (  -- [est #7] parte INTEIRA do "a enviar" repartida pela grade (maior resto: Sigma preservada)
    select s.etq, kv.key as tam, s.cor, sum((kv.value)::numeric) as tot
    from ce_sem s
    cross join lateral jsonb_each_text(public._split_maior_resto(floor(s.qe)::int, s.pesos)) kv
    where s.pesos is not null and s.qe >= 1
    group by 1, 2, 3
  ),
  baixa_sem as (  -- consumo sem tamanho: chave (etiqueta, NULL, cor do CAD). Insumo sem tamanho (ou sem grade): tudo
                  -- aqui, como antes; repartido pela grade: so a fracao (< 1) que sobrou da parte inteira.
    select s.etq, null::text as tam, s.cor,
           sum(case when s.pesos is not null and s.qe >= 1 then s.qe - floor(s.qe) else s.qe end) as tot
    from ce_sem s
    where not (s.pesos is not null and s.qe >= 1) or s.qe - floor(s.qe) > 0
    group by 1, 3
  ),
  baixa_revenda as (  -- consumo de insumo em REVENDA: sem corte/CAD-tecido — o gatilho é a
                       -- OC P. Acabado recebida, refletida em cad_grades.grade_total_real do
                       -- cad-espelho (receber_oc_p_acabado, Task 3). Sem tamanho (BOM de
                       -- revenda = modelo_etiquetas, sem coluna tamanho).
    select me.etiqueta_id as etq, null::text as tam, me.cor_id as cor,
           -- [urg R1] insumo vinculado a UM tamanho: so as pecas recebidas daquele tamanho (grade real do cad-espelho)
           sum(me.consumo * public._insumo_pecas(public._insumo_tamanho_de(me.etiqueta_id), public._grade_mapa_cad(c.id, true), coalesce(cg.total_real, 0))) as tot
    from modelo_etiquetas me
    join modelos m on m.id = me.modelo_id and m.tenant_id = _tenant and m.origem in ('revenda', 'importado')
                                            -- [medios R16, carona] importado: o recebimento (_receber_oc_importado_core) grava
                                            -- o cad-espelho + cad_grades e NAO cria cad_etiquetas -> baixa pelas pecas recebidas
    join cad c on c.modelo_id = m.id and c.tenant_id = _tenant
     and not coalesce(c.enviado_corte, false)  -- [contas-certas 6] so ANTES do Enviar para PCP; depois vale o
                                               -- "a enviar" da Explosao (baixa_sem/baixa_var) -> sem baixa em dobro
    join (select cad_id, sum(grade_total_real) as total_real from cad_grades group by cad_id) cg
      on cg.cad_id = c.id
    group by 1, 3
  ),
  baixa_pt as (  -- [urg r11c] baixa da PECA TESTE (ledger estoque_peca_teste_baixas, familia 'insumo'); estorno = linha
                 -- compensatoria negativa (SUM do liquido). Chave (etiqueta, tamanho, cor_id) da propria linha do ledger.
    select b.etiqueta_id as etq, b.tamanho as tam, b.cor_id as cor, sum(coalesce(b.quantidade, 0)) as tot
    from estoque_peca_teste_baixas b
    where b.tenant_id = _tenant and b.familia = 'insumo' and b.etiqueta_id is not null
    group by 1, 2, 3
  ),
  baixa as (
    select etq, tam, cor, sum(tot) as tot
    from (select * from baixa_var union all select * from baixa_grade union all select * from baixa_sem
          union all select * from baixa_revenda union all select * from baixa_pt) x
    group by 1, 2, 3
  ),
  keys as (
    select etq, tam, cor from rec
    union select etq, tam, cor from prev
    union select etq, tam, cor from baixa
  )
  select k.etq, e.nome::text,
         ve.id,                                   -- variante_id (referência; NULL se a baixa não casa variante)
         k.tam, cor.nome::text,
         coalesce(rec.tot, 0), coalesce(prev.tot, 0), coalesce(baixa.tot, 0),
         greatest(0, coalesce(rec.tot, 0) - coalesce(baixa.tot, 0))   -- físico nunca negativo (igual tecido/aviamento)
  from keys k
  join etiquetas e on e.id = k.etq and e.tenant_id = _tenant
  left join variantes_etiqueta ve on ve.etiqueta_id = k.etq
       and ve.tamanho is not distinct from k.tam and ve.cor_id is not distinct from k.cor
  left join cores cor on cor.id = k.cor
  left join rec  on rec.etq  = k.etq and rec.tam  is not distinct from k.tam and rec.cor  is not distinct from k.cor
  left join prev on prev.etq = k.etq and prev.tam is not distinct from k.tam and prev.cor is not distinct from k.cor
  left join baixa on baixa.etq = k.etq and baixa.tam is not distinct from k.tam and baixa.cor is not distinct from k.cor
  order by e.nome, k.tam nulls first;
$function$;

CREATE OR REPLACE FUNCTION public._estoque_extrato_tecido_core(_tenant uuid, _variante_tecido_id uuid)
 RETURNS TABLE(bucket_variante_id uuid, bucket_tamanho text, bucket_cor_id uuid, bucket_cor_nome text, quando timestamp with time zone, quando_fonte text, tipo text, origem text, quantidade numeric, quem text, ref_oc text, ref_modelo text, ref_id uuid, detalhe text, core_recebido numeric, core_baixa numeric, core_fisico numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
-- [urg R3 T14] Extrato ("Historico") de UMA variante de tecido (1 bucket = a variante), so leitura. Mesmas fontes e condicoes do
-- _estoque_tecido_core (item nao cancelado de OC 'recebido'; recebido = quantidade_recebida, senao a pedida (0 se reposicao de troca);
-- kg -> m pelo rendimento do artigo do item; baixas do ledger estoque_tecido_baixas DO ITEM com origem nao nula; OS baixada): cada
-- linha e um movimento ASSINADO (+ entrada, - saida, em METROS) e Sigma por bucket = recebido_m - baixa do core POR CONSTRUCAO
-- (Ruling A17). core_* = a linha do core, repetida. Separacao de rolo = 2 linhas (saida na origem + entrada no rolo; A18).
-- Datas (A15): ledger = hora exata; OC = audit_log (ultima transicao status -> recebido; quem = user_nome) senao data de entrega
-- (so DIA = meia-noite no fuso da loja) com quem = recebimento_responsavel_nome; rolo nasce recebido = a hora em que foi criado; OS =
-- audit (baixado -> true) senao data de corte/solicitacao. Quem = so o NOME (A21). Loja errada/item inexistente = conjunto vazio.
DECLARE
  v_tz text;
BEGIN
  SELECT tc.timezone INTO v_tz FROM public.tenant_config tc WHERE tc.tenant_id = _tenant;
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := NULL;
  END;
  v_tz := coalesce(nullif(v_tz, ''), 'America/Sao_Paulo');

  RETURN QUERY
  WITH
  cr AS (
    SELECT x.variante_tecido_id AS var, x.recebido_m AS rec, x.baixa AS bx, x.fisico AS fis
      FROM public._estoque_tecido_core(_tenant) x
     WHERE x.variante_tecido_id = _variante_tecido_id
  ),
  itens AS (
    SELECT it.id, it.variante_tecido_id AS var, it.quantidade_pedida AS qp, it.quantidade_recebida AS qr, it.substitui_item_id AS subst,
           oc.id AS oc_id, oc.is_rolo, oc.rolo_codigo, oc.numero_pedido, oc.data_entrega, oc.created_at AS oc_criada,
           oc.recebimento_responsavel_nome AS resp, oc.rolo_origem_item_id AS origem_item,
           a.unidade_medida AS un, COALESCE(a.rendimento, 0) AS rend
      FROM public.ocs_tecido_itens it
      JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id AND oc.tenant_id = _tenant AND oc.status = 'recebido'
      LEFT JOIN public.artigos a ON a.id = it.artigo_id
     WHERE it.variante_tecido_id = _variante_tecido_id
       AND COALESCE(it.cancelado, false) = false
       AND EXISTS (SELECT 1 FROM cr)
  ),
  aud_oc AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.created_at, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT i.oc_id FROM itens i)
       AND al.tenant_id = _tenant AND al.tabela = 'ocs_tecido' AND al.acao = 'editar'
       AND al.dados -> 'status' ->> 'para' = 'recebido'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  aud_rolo AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT i.oc_id FROM itens i WHERE i.is_rolo)
       AND al.tenant_id = _tenant AND al.tabela = 'ocs_tecido' AND al.acao = 'criar'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  ent AS (
    SELECT i.var,
           CASE WHEN ao.registro_id IS NOT NULL THEN ao.created_at
                WHEN i.is_rolo THEN i.oc_criada
                WHEN i.data_entrega IS NOT NULL THEN (i.data_entrega::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ao.registro_id IS NOT NULL OR i.is_rolo THEN 'registro'
                WHEN i.data_entrega IS NOT NULL THEN 'data_oc' ELSE 'sem_data' END AS fonte,
           CASE WHEN i.is_rolo THEN 'rolo_entrada' WHEN i.subst IS NOT NULL THEN 'reposicao_troca' ELSE 'oc' END AS org,
           CASE WHEN i.un = 'kg'
                THEN COALESCE(i.qr, CASE WHEN i.subst IS NOT NULL THEN 0 ELSE i.qp END, 0) * i.rend
                ELSE COALESCE(i.qr, CASE WHEN i.subst IS NOT NULL THEN 0 ELSE i.qp END, 0) END AS q,
           COALESCE(ao.user_nome, ar.user_nome, i.resp) AS por,
           (CASE WHEN i.is_rolo THEN COALESCE(i.rolo_codigo, i.numero_pedido) ELSE i.numero_pedido END)::text AS oc_ref,
           NULL::text AS mod_ref,
           i.oc_id AS rid,
           concat_ws(' - ',
             CASE WHEN i.un = 'kg'
                  THEN trim_scale(COALESCE(i.qr, CASE WHEN i.subst IS NOT NULL THEN 0 ELSE i.qp END, 0))::text || ' kg x '
                       || trim_scale(i.rend)::text || ' m/kg' END,
             CASE WHEN i.is_rolo AND oo.id IS NOT NULL THEN 'separado da OC ' || COALESCE(oo.rolo_codigo, oo.numero_pedido, '') END
           ) AS det
      FROM itens i
      LEFT JOIN aud_oc ao ON ao.registro_id = i.oc_id
      LEFT JOIN aud_rolo ar ON ar.registro_id = i.oc_id AND i.is_rolo
      LEFT JOIN public.ocs_tecido_itens oi ON oi.id = i.origem_item
      LEFT JOIN public.ocs_tecido oo ON oo.id = oi.oc_tecido_id AND oo.tenant_id = _tenant
  ),
  led0 AS (
    SELECT i.var, b.id AS bid, b.created_at, b.created_by, b.origem AS b_origem, COALESCE(b.quantidade, 0) AS bq, b.motivo,
           b.cad_id, b.rolo_id, b.peca_teste_tentativa_id AS ptt, i.is_rolo, i.rolo_codigo, i.numero_pedido
      FROM itens i
      JOIN public.estoque_tecido_baixas b ON b.oc_tecido_item_id = i.id AND b.origem IS NOT NULL
  ),
  aud_b AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT l.bid FROM led0 l WHERE l.created_by IS NULL)
       AND al.tenant_id = _tenant AND al.tabela = 'estoque_tecido_baixas' AND al.acao = 'criar'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  led AS (
    SELECT l.var, l.created_at AS qd, 'registro' AS fonte,
           CASE l.b_origem WHEN 'separacao_rolo' THEN 'separacao_rolo' WHEN 'ajuste' THEN 'ajuste'
                           WHEN 'fifo' THEN 'corte' WHEN 'vinculo' THEN 'corte'
                           WHEN 'peca_teste' THEN 'peca_teste' WHEN 'peca_teste_estorno' THEN 'peca_teste_estorno'
                           ELSE l.b_origem END AS org,
           -l.bq AS q,
           COALESCE(u.nome, ab.user_nome) AS por,
           (CASE WHEN l.is_rolo THEN COALESCE(l.rolo_codigo, l.numero_pedido) ELSE l.numero_pedido END)::text AS oc_ref,
           COALESCE(NULLIF(btrim(m.ref), ''), m.nome, NULLIF(btrim(mt.ref), ''), mt.nome)::text AS mod_ref,
           l.bid AS rid,
           CASE WHEN l.b_origem = 'separacao_rolo' THEN 'rolo ' || COALESCE(r.rolo_codigo, r.numero_pedido, '')
                ELSE NULLIF(btrim(l.motivo), '') END AS det
      FROM led0 l
      LEFT JOIN public.users u ON u.id = l.created_by
      LEFT JOIN aud_b ab ON ab.registro_id = l.bid
      LEFT JOIN public.cad cd ON cd.id = l.cad_id AND cd.tenant_id = _tenant
      LEFT JOIN public.modelos m ON m.id = cd.modelo_id AND m.tenant_id = _tenant
      LEFT JOIN public.modelo_peca_teste_tentativas pt ON pt.id = l.ptt
      LEFT JOIN public.modelos mt ON mt.id = pt.modelo_id AND mt.tenant_id = _tenant
      LEFT JOIN public.ocs_tecido r ON r.id = l.rolo_id AND r.tenant_id = _tenant
  ),
  os0 AS (
    SELECT oi.variante_tecido_id AS var, os.id AS os_id, os.numero, os.data_corte, os.data_solicitacao, os.responsavel,
           os.created_by, COALESCE(oi.baixa, 0) AS bq
      FROM public.ordens_saida_tecido_itens oi
      JOIN public.ordens_saida_tecido os ON os.id = oi.ordem_saida_id AND os.tenant_id = _tenant AND os.baixado
     WHERE oi.variante_tecido_id = _variante_tecido_id
       AND EXISTS (SELECT 1 FROM cr)
  ),
  aud_os AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.created_at, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT o.os_id FROM os0 o)
       AND al.tenant_id = _tenant AND al.tabela = 'ordens_saida_tecido' AND al.acao = 'editar'
       AND al.dados -> 'baixado' ->> 'para' = 'true'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  sai_os AS (
    SELECT o.var,
           CASE WHEN ao.registro_id IS NOT NULL THEN ao.created_at
                WHEN COALESCE(o.data_corte, o.data_solicitacao) IS NOT NULL
                  THEN (COALESCE(o.data_corte, o.data_solicitacao)::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ao.registro_id IS NOT NULL THEN 'registro'
                WHEN COALESCE(o.data_corte, o.data_solicitacao) IS NOT NULL THEN 'data_os' ELSE 'sem_data' END AS fonte,
           'os' AS org, -o.bq AS q,
           COALESCE(ao.user_nome, NULLIF(btrim(o.responsavel), ''), u.nome)::text AS por,
           ('OS ' || COALESCE(o.numero::text, ''))::text AS oc_ref, NULL::text AS mod_ref, o.os_id AS rid, NULL::text AS det
      FROM os0 o
      LEFT JOIN aud_os ao ON ao.registro_id = o.os_id
      LEFT JOIN public.users u ON u.id = o.created_by
  ),
  mov AS (
    SELECT * FROM ent UNION ALL SELECT * FROM led UNION ALL SELECT * FROM sai_os
  )
  SELECT cr.var, NULL::text, v.cor_id, co.nome::text,
         mov.qd, mov.fonte, CASE WHEN mov.q > 0 THEN 'entrada' ELSE 'saida' END, mov.org, mov.q,
         mov.por, mov.oc_ref, mov.mod_ref, mov.rid, NULLIF(mov.det, ''),
         cr.rec, cr.bx, cr.fis
    FROM cr
    JOIN mov ON mov.var = cr.var
    LEFT JOIN public.variantes_tecido v ON v.id = cr.var
    LEFT JOIN public.cores co ON co.id = v.cor_id
   WHERE mov.q <> 0
   ORDER BY mov.qd NULLS FIRST, (mov.q < 0), mov.oc_ref, mov.rid;
END
$function$;

CREATE OR REPLACE FUNCTION public._estoque_extrato_aviamento_core(_tenant uuid, _aviamento_id uuid)
 RETURNS TABLE(bucket_variante_id uuid, bucket_tamanho text, bucket_cor_id uuid, bucket_cor_nome text, quando timestamp with time zone, quando_fonte text, tipo text, origem text, quantidade numeric, quem text, ref_oc text, ref_modelo text, ref_id uuid, detalhe text, core_recebido numeric, core_baixa numeric, core_fisico numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
-- [urg R3 T14] Extrato ("Historico") de UM aviamento, por variante (bucket = COALESCE(variante, variante UNICA do aviamento), o
-- av_sole do _estoque_aviamento_core; "Sem variante" = bucket NULL), so leitura. Mesmas fontes e condicoes do core: item nao
-- cancelado de OC 'recebido' (quantidade_recebida, senao a pedida); CAD enviado ao PCP com a MESMA expressao do baixa_cad
-- (COALESCE(NULLIF(quantidade_separar, 0), quantidade_enviar, 0)); OS baixada. Saida por CAD: a contribuicao ATUAL C vira a linha-base
-- 'explosao' (C - Sigma ajustes, data/quem do envio) + uma linha 'explosao_ajuste' por transacao (txid) do estoque_mov_log gravada
-- DEPOIS do ultimo envio daquele CAD (hora/quem exatos; delta liquido <> 0). Sigma por bucket = recebido - baixa do core POR
-- CONSTRUCAO (Ruling A17); core_* repetidos. Envio = audit_log (ultima transicao enviado_corte -> true) senao data_enviado_corte (DIA =
-- meia-noite no fuso da loja) senao sem data; OC = audit (status -> recebido) senao data de entrega; OS = audit (baixado -> true)
-- senao data de corte/solicitacao. Quem = so o NOME (A21). Loja errada/item inexistente = conjunto vazio.
DECLARE
  v_tz text;
BEGIN
  SELECT tc.timezone INTO v_tz FROM public.tenant_config tc WHERE tc.tenant_id = _tenant;
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := NULL;
  END;
  v_tz := coalesce(nullif(v_tz, ''), 'America/Sao_Paulo');

  RETURN QUERY
  WITH
  cr AS (
    SELECT x.variante_id AS var, x.recebido AS rec, x.baixa AS bx, x.fisico AS fis
      FROM public._estoque_aviamento_core(_tenant) x
     WHERE x.id = _aviamento_id
  ),
  av_sole AS (
    SELECT va.aviamento_id, (array_agg(va.id ORDER BY va.created_at, va.id))[1] AS var
      FROM public.variantes_aviamento va
     WHERE va.tenant_id = _tenant AND va.aviamento_id = _aviamento_id
     GROUP BY va.aviamento_id
    HAVING count(*) = 1
  ),
  oc0 AS (
    SELECT COALESCE(i.variante_aviamento_id, s.var) AS var, oc.id AS oc_id, oc.numero_pedido, oc.data_entrega,
           COALESCE(i.quantidade_recebida, i.quantidade_pedida, 0) AS q
      FROM public.ocs_aviamento_itens i
      JOIN public.ocs_aviamento oc ON oc.id = i.oc_aviamento_id AND oc.tenant_id = _tenant AND oc.status = 'recebido'
      LEFT JOIN av_sole s ON s.aviamento_id = i.aviamento_id
     WHERE i.aviamento_id = _aviamento_id AND COALESCE(i.cancelado, false) = false
       AND EXISTS (SELECT 1 FROM cr)
  ),
  aud_oc AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.created_at, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT o.oc_id FROM oc0 o)
       AND al.tenant_id = _tenant AND al.tabela = 'ocs_aviamento' AND al.acao = 'editar'
       AND al.dados -> 'status' ->> 'para' = 'recebido'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  ent AS (
    SELECT o.var,
           CASE WHEN ao.registro_id IS NOT NULL THEN ao.created_at
                WHEN o.data_entrega IS NOT NULL THEN (o.data_entrega::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ao.registro_id IS NOT NULL THEN 'registro' WHEN o.data_entrega IS NOT NULL THEN 'data_oc' ELSE 'sem_data' END AS fonte,
           'oc' AS org, o.q, ao.user_nome::text AS por, o.numero_pedido::text AS oc_ref, NULL::text AS mod_ref, o.oc_id AS rid,
           NULL::text AS det
      FROM oc0 o
      LEFT JOIN aud_oc ao ON ao.registro_id = o.oc_id
  ),
  contrib AS (
    SELECT ca.cad_id AS cad, COALESCE(ca.variante_aviamento_id, s.var) AS var,
           SUM(COALESCE(NULLIF(ca.quantidade_separar, 0), ca.quantidade_enviar, 0)) AS c
      FROM public.cad_aviamentos ca
      JOIN public.cad c ON c.id = ca.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
      LEFT JOIN av_sole s ON s.aviamento_id = ca.aviamento_id
     WHERE ca.aviamento_id = _aviamento_id
       AND EXISTS (SELECT 1 FROM cr)
     GROUP BY 1, 2
  ),
  lg0 AS (
    SELECT l.id, l.cad_id AS cad, COALESCE(l.variante_id, s.var) AS var, l.txid, l.created_at, l.created_by, l.depois - l.antes AS d
      FROM public.estoque_mov_log l
      JOIN public.cad c ON c.id = l.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
      LEFT JOIN av_sole s ON s.aviamento_id = l.item_id
     WHERE l.tenant_id = _tenant AND l.familia = 'aviamento' AND l.item_id = _aviamento_id
       AND EXISTS (SELECT 1 FROM cr)
  ),
  cads AS (
    SELECT DISTINCT x.cad FROM (SELECT cad FROM contrib UNION ALL SELECT cad FROM lg0) x
  ),
  aud_cad AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.created_at, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT k.cad FROM cads k)
       AND al.tenant_id = _tenant AND al.tabela = 'cad' AND al.acao = 'editar'
       AND al.dados -> 'enviado_corte' ->> 'para' = 'true'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  envio AS (
    SELECT k.cad, c.modelo_id,
           CASE WHEN ac.registro_id IS NOT NULL THEN ac.created_at
                WHEN c.data_enviado_corte IS NOT NULL THEN (c.data_enviado_corte::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ac.registro_id IS NOT NULL THEN 'registro' WHEN c.data_enviado_corte IS NOT NULL THEN 'data_envio'
                ELSE 'sem_data' END AS fonte,
           ac.user_nome AS por,
           COALESCE(NULLIF(btrim(m.ref), ''), m.nome)::text AS mod_ref
      FROM cads k
      JOIN public.cad c ON c.id = k.cad
      LEFT JOIN aud_cad ac ON ac.registro_id = k.cad
      LEFT JOIN public.modelos m ON m.id = c.modelo_id AND m.tenant_id = _tenant
  ),
  lg AS (
    SELECT l.cad, l.var, l.txid, SUM(l.d) AS d, max(l.created_at) AS qd,
           (array_agg(l.created_by ORDER BY l.created_at DESC, l.id DESC))[1] AS por_id
      FROM lg0 l
      JOIN envio e ON e.cad = l.cad
     WHERE e.qd IS NULL OR l.created_at > e.qd
     GROUP BY 1, 2, 3
    HAVING SUM(l.d) <> 0
  ),
  base AS (
    SELECT k.cad, k.var, COALESCE(ct.c, 0) - COALESCE((SELECT SUM(g.d) FROM lg g WHERE g.cad = k.cad AND g.var IS NOT DISTINCT FROM k.var), 0) AS b
      FROM (SELECT cad, var FROM contrib UNION SELECT cad, var FROM lg) k
      LEFT JOIN contrib ct ON ct.cad = k.cad AND ct.var IS NOT DISTINCT FROM k.var
  ),
  sai_cad AS (
    SELECT b.var, e.qd, e.fonte, 'explosao' AS org, -b.b AS q, e.por::text AS por, NULL::text AS oc_ref, e.mod_ref, b.cad AS rid,
           NULL::text AS det
      FROM base b JOIN envio e ON e.cad = b.cad
    UNION ALL
    SELECT g.var, g.qd, 'registro', 'explosao_ajuste', -g.d, u.nome::text, NULL::text, e.mod_ref, g.cad, NULL::text
      FROM lg g JOIN envio e ON e.cad = g.cad
      LEFT JOIN public.users u ON u.id = g.por_id
  ),
  os0 AS (
    SELECT COALESCE(oi.variante_aviamento_id, s.var) AS var, os.id AS os_id, os.numero, os.data_corte, os.data_solicitacao,
           os.responsavel, os.created_by, COALESCE(oi.baixa, 0) AS bq
      FROM public.ordens_saida_aviamento_itens oi
      JOIN public.ordens_saida_aviamento os ON os.id = oi.ordem_saida_id AND os.tenant_id = _tenant AND os.baixado
      LEFT JOIN av_sole s ON s.aviamento_id = oi.aviamento_id
     WHERE oi.aviamento_id = _aviamento_id
       AND EXISTS (SELECT 1 FROM cr)
  ),
  aud_os AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.created_at, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT o.os_id FROM os0 o)
       AND al.tenant_id = _tenant AND al.tabela = 'ordens_saida_aviamento' AND al.acao = 'editar'
       AND al.dados -> 'baixado' ->> 'para' = 'true'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  sai_os AS (
    SELECT o.var,
           CASE WHEN ao.registro_id IS NOT NULL THEN ao.created_at
                WHEN COALESCE(o.data_corte, o.data_solicitacao) IS NOT NULL
                  THEN (COALESCE(o.data_corte, o.data_solicitacao)::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ao.registro_id IS NOT NULL THEN 'registro'
                WHEN COALESCE(o.data_corte, o.data_solicitacao) IS NOT NULL THEN 'data_os' ELSE 'sem_data' END AS fonte,
           'os' AS org, -o.bq AS q,
           COALESCE(ao.user_nome, NULLIF(btrim(o.responsavel), ''), u.nome)::text AS por,
           ('OS ' || COALESCE(o.numero::text, ''))::text AS oc_ref, NULL::text AS mod_ref, o.os_id AS rid, NULL::text AS det
      FROM os0 o
      LEFT JOIN aud_os ao ON ao.registro_id = o.os_id
      LEFT JOIN public.users u ON u.id = o.created_by
  ),
  sai_pt AS (  -- [urg r11c] baixa da PECA TESTE (ledger estoque_peca_teste_baixas): 1 linha por registro (nao agrega), bucket =
               -- COALESCE(variante, variante unica do aviamento). baixa = saida negativa; estorno = entrada positiva (q = -quantidade).
               -- mod_ref = REF/nome do card VIVO (tentativa -> modelo) senao NULL; det = rotulo; quem = users.nome do created_by.
    SELECT COALESCE(b.variante_aviamento_id, s.var) AS var, b.created_at AS qd, 'registro' AS fonte, b.origem AS org,
           -b.quantidade AS q, u.nome::text AS por, NULL::text AS oc_ref,
           COALESCE(NULLIF(btrim(m.ref), ''), m.nome)::text AS mod_ref, b.id AS rid, NULLIF(btrim(b.rotulo), '') AS det
      FROM public.estoque_peca_teste_baixas b
      LEFT JOIN av_sole s ON s.aviamento_id = b.aviamento_id
      LEFT JOIN public.users u ON u.id = b.created_by
      LEFT JOIN public.modelo_peca_teste_tentativas pt ON pt.id = b.tentativa_id
      LEFT JOIN public.modelos m ON m.id = pt.modelo_id AND m.tenant_id = _tenant
     WHERE b.tenant_id = _tenant AND b.familia = 'aviamento' AND b.aviamento_id = _aviamento_id
       AND EXISTS (SELECT 1 FROM cr)
  ),
  mov AS (
    SELECT * FROM ent UNION ALL SELECT * FROM sai_cad UNION ALL SELECT * FROM sai_os UNION ALL SELECT * FROM sai_pt
  )
  SELECT cr.var, NULL::text, va.cor_id, co.nome::text,
         mov.qd, mov.fonte, CASE WHEN mov.q > 0 THEN 'entrada' ELSE 'saida' END, mov.org, mov.q,
         mov.por, mov.oc_ref, mov.mod_ref, mov.rid, mov.det,
         cr.rec, cr.bx, cr.fis
    FROM cr
    JOIN mov ON mov.var IS NOT DISTINCT FROM cr.var
    LEFT JOIN public.variantes_aviamento va ON va.id = cr.var
    LEFT JOIN public.cores co ON co.id = va.cor_id
   WHERE mov.q <> 0
   ORDER BY cr.var NULLS FIRST, mov.qd NULLS FIRST, (mov.q < 0), mov.oc_ref, mov.rid;
END
$function$;

CREATE OR REPLACE FUNCTION public._estoque_extrato_insumo_core(_tenant uuid, _etiqueta_id uuid)
 RETURNS TABLE(bucket_variante_id uuid, bucket_tamanho text, bucket_cor_id uuid, bucket_cor_nome text, quando timestamp with time zone, quando_fonte text, tipo text, origem text, quantidade numeric, quem text, ref_oc text, ref_modelo text, ref_id uuid, detalhe text, core_recebido numeric, core_baixa numeric, core_fisico numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
-- [urg R3 T14] Extrato ("Historico") de UM insumo, por bucket (tamanho, cor) = a chave da linha do _estoque_etiqueta_core (o bucket
-- da tela e da lib TS e (tamanho, nome da cor); core_* = a soma das linhas DISTINTAS do core com a mesma chave), so leitura. Mesmas
-- fontes e regras do core: item nao cancelado de OC Insumo 'recebido' (bucket da variante; recebida senao a pedida); por CAD enviado ao
-- PCP, a contribuicao ATUAL pela MESMA regra (enviar_por_tamanho preenchido = por tamanho; senao o "a enviar" inteiro repartido pela
-- grade planejada do CAD com _split_maior_resto, a fracao no bucket sem tamanho, quando o insumo tem tamanho; senao tudo sem tamanho)
-- vira a linha-base 'explosao' (C - Sigma ajustes, data/quem do envio) + uma linha 'explosao_ajuste' por transacao (txid) do
-- estoque_mov_log gravada DEPOIS do ultimo envio (antes/depois mapeados pela mesma regra com os pesos de HOJE - Ruling A19; delta
-- liquido <> 0); revenda/importado ainda nao enviado = consumo x pecas recebidas (_insumo_pecas: vinculado = so o tamanho; R1).
-- Sigma por bucket = recebido - baixa do core POR CONSTRUCAO (A17). Datas: OC Insumo sem audit = so a data de entrega (DIA =
-- meia-noite no fuso da loja); envio = audit (enviado_corte -> true) senao data_enviado_corte; revenda = data de entrega da OC de
-- P. Acabado/Importado recebida. Quem = so o NOME (A21). Loja errada/item inexistente = conjunto vazio.
DECLARE
  v_tz text;
BEGIN
  SELECT tc.timezone INTO v_tz FROM public.tenant_config tc WHERE tc.tenant_id = _tenant;
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := NULL;
  END;
  v_tz := coalesce(nullif(v_tz, ''), 'America/Sao_Paulo');

  RETURN QUERY
  WITH
  cr AS (
    SELECT d.tamanho AS tam, d.cor_nome AS cnome, SUM(d.recebido) AS rec, SUM(d.baixa) AS bx, SUM(d.fisico) AS fis
      FROM (SELECT DISTINCT x.tamanho, x.cor_nome, x.recebido, x.prev_receb, x.baixa, x.fisico
              FROM public._estoque_etiqueta_core(_tenant) x
             WHERE x.etiqueta_id = _etiqueta_id) d
     GROUP BY 1, 2
  ),
  etq AS (
    SELECT e.id, (COALESCE(e.formato_tamanho, 'ambos') <> 'nenhum'
                  AND EXISTS (SELECT 1 FROM public.variantes_etiqueta ve WHERE ve.etiqueta_id = e.id AND ve.tamanho IS NOT NULL)) AS com_tam
      FROM public.etiquetas e
     WHERE e.id = _etiqueta_id AND e.tenant_id = _tenant
       AND EXISTS (SELECT 1 FROM cr)
  ),
  oc0 AS (
    SELECT ve.tamanho AS tam, ve.cor_id AS cor, o.id AS oc_id, o.numero_pedido, o.data_entrega,
           COALESCE(i.quantidade_recebida, i.quantidade_pedida, 0) AS q
      FROM public.ocs_etiqueta_itens i
      JOIN public.ocs_etiqueta o ON o.id = i.oc_etiqueta_id AND o.tenant_id = _tenant AND o.status = 'recebido'
      LEFT JOIN public.variantes_etiqueta ve ON ve.id = i.variante_etiqueta_id
     WHERE i.etiqueta_id = _etiqueta_id AND COALESCE(i.cancelado, false) = false
       AND EXISTS (SELECT 1 FROM etq)
  ),
  ent AS (
    SELECT o.tam, o.cor,
           CASE WHEN o.data_entrega IS NOT NULL THEN (o.data_entrega::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN o.data_entrega IS NOT NULL THEN 'data_oc' ELSE 'sem_data' END AS fonte,
           'oc' AS org, o.q, NULL::text AS por, o.numero_pedido::text AS oc_ref, NULL::text AS mod_ref, o.oc_id AS rid, NULL::text AS det
      FROM oc0 o
  ),
  ce AS (
    SELECT ce.cad_id AS cad, ce.cor_id AS cor, COALESCE(ce.quantidade_enviar, 0) AS v, ce.enviar_por_tamanho AS ept
      FROM public.cad_etiquetas ce
      JOIN public.cad c ON c.id = ce.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
     WHERE ce.etiqueta_id = _etiqueta_id
       AND EXISTS (SELECT 1 FROM etq)
  ),
  lg0 AS (
    SELECT l.id, l.cad_id AS cad, l.cor_id AS cor, l.txid, l.created_at, l.created_by, l.antes, l.depois, l.ept_antes, l.ept_depois
      FROM public.estoque_mov_log l
      JOIN public.cad c ON c.id = l.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
     WHERE l.tenant_id = _tenant AND l.familia = 'insumo' AND l.item_id = _etiqueta_id
       AND EXISTS (SELECT 1 FROM etq)
  ),
  cads AS (
    SELECT DISTINCT x.cad FROM (SELECT cad FROM ce UNION ALL SELECT cad FROM lg0) x
  ),
  pesos AS (  -- pesos de HOJE = grade planejada do CAD por tamanho (so com peca > 0), so se o insumo tem tamanho (regra do ce_sem)
    SELECT k.cad,
           CASE WHEN (SELECT e.com_tam FROM etq e)
                THEN (SELECT jsonb_object_agg(w.k, w.s)
                        FROM (SELECT kv.key AS k, sum((kv.value)::numeric) AS s
                                FROM public.cad_grades g
                                CROSS JOIN LATERAL jsonb_each_text(coalesce(g.grades_planejadas, '{}'::jsonb)) kv
                               WHERE g.cad_id = k.cad AND kv.value ~ '^[0-9]+(\.[0-9]+)?$'
                               GROUP BY kv.key
                              HAVING sum((kv.value)::numeric) > 0) w)
           END AS p
      FROM cads k
  ),
  contrib AS (
    SELECT r.cad, m.tam, r.cor, SUM(m.q) AS c
      FROM ce r
      LEFT JOIN pesos pe ON pe.cad = r.cad
      CROSS JOIN LATERAL (
        SELECT kv.key AS tam, (kv.value)::numeric AS q
          FROM jsonb_each_text(CASE WHEN coalesce(r.ept, '{}'::jsonb) <> '{}'::jsonb THEN r.ept ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT kv.key, (kv.value)::numeric
          FROM jsonb_each_text(CASE WHEN coalesce(r.ept, '{}'::jsonb) = '{}'::jsonb AND pe.p IS NOT NULL AND r.v >= 1
                                    THEN public._split_maior_resto(floor(r.v)::int, pe.p) ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT NULL::text, CASE WHEN pe.p IS NOT NULL AND r.v >= 1 THEN r.v - floor(r.v) ELSE r.v END
         WHERE coalesce(r.ept, '{}'::jsonb) = '{}'::jsonb
      ) m
     GROUP BY 1, 2, 3
  ),
  aud_cad AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.created_at, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT k.cad FROM cads k)
       AND al.tenant_id = _tenant AND al.tabela = 'cad' AND al.acao = 'editar'
       AND al.dados -> 'enviado_corte' ->> 'para' = 'true'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  envio AS (
    SELECT k.cad,
           CASE WHEN ac.registro_id IS NOT NULL THEN ac.created_at
                WHEN c.data_enviado_corte IS NOT NULL THEN (c.data_enviado_corte::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ac.registro_id IS NOT NULL THEN 'registro' WHEN c.data_enviado_corte IS NOT NULL THEN 'data_envio'
                ELSE 'sem_data' END AS fonte,
           ac.user_nome AS por,
           COALESCE(NULLIF(btrim(m.ref), ''), m.nome)::text AS mod_ref
      FROM cads k
      JOIN public.cad c ON c.id = k.cad
      LEFT JOIN aud_cad ac ON ac.registro_id = k.cad
      LEFT JOIN public.modelos m ON m.id = c.modelo_id AND m.tenant_id = _tenant
  ),
  lgm AS (  -- cada lado do log mapeado para (tamanho) pela regra do core com os pesos de HOJE; depois - antes
    SELECT x.id, x.cad, m.tam, x.cor, x.txid, x.created_at, x.created_by, m.q * x.sinal AS d
      FROM (SELECT l.id, l.cad, l.cor, l.txid, l.created_at, l.created_by, l.depois AS v, l.ept_depois AS ept, 1 AS sinal
              FROM lg0 l JOIN envio e ON e.cad = l.cad WHERE e.qd IS NULL OR l.created_at > e.qd
            UNION ALL
            SELECT l.id, l.cad, l.cor, l.txid, l.created_at, l.created_by, l.antes, l.ept_antes, -1
              FROM lg0 l JOIN envio e ON e.cad = l.cad WHERE e.qd IS NULL OR l.created_at > e.qd) x
      LEFT JOIN pesos pe ON pe.cad = x.cad
      CROSS JOIN LATERAL (
        SELECT kv.key AS tam, (kv.value)::numeric AS q
          FROM jsonb_each_text(CASE WHEN coalesce(x.ept, '{}'::jsonb) <> '{}'::jsonb THEN x.ept ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT kv.key, (kv.value)::numeric
          FROM jsonb_each_text(CASE WHEN coalesce(x.ept, '{}'::jsonb) = '{}'::jsonb AND pe.p IS NOT NULL AND x.v >= 1
                                    THEN public._split_maior_resto(floor(x.v)::int, pe.p) ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT NULL::text, CASE WHEN pe.p IS NOT NULL AND x.v >= 1 THEN x.v - floor(x.v) ELSE x.v END
         WHERE coalesce(x.ept, '{}'::jsonb) = '{}'::jsonb
      ) m
  ),
  lg AS (
    SELECT l.cad, l.tam, l.cor, l.txid, SUM(l.d) AS d, max(l.created_at) AS qd,
           (array_agg(l.created_by ORDER BY l.created_at DESC, l.id DESC))[1] AS por_id
      FROM lgm l
     GROUP BY 1, 2, 3, 4
    HAVING SUM(l.d) <> 0
  ),
  base AS (
    SELECT k.cad, k.tam, k.cor,
           COALESCE(ct.c, 0) - COALESCE((SELECT SUM(g.d) FROM lg g
                                          WHERE g.cad = k.cad AND g.tam IS NOT DISTINCT FROM k.tam AND g.cor IS NOT DISTINCT FROM k.cor), 0) AS b
      FROM (SELECT cad, tam, cor FROM contrib UNION SELECT cad, tam, cor FROM lg) k
      LEFT JOIN contrib ct ON ct.cad = k.cad AND ct.tam IS NOT DISTINCT FROM k.tam AND ct.cor IS NOT DISTINCT FROM k.cor
  ),
  sai_cad AS (
    SELECT b.tam, b.cor, e.qd, e.fonte, 'explosao' AS org, -b.b AS q, e.por::text AS por, NULL::text AS oc_ref, e.mod_ref, b.cad AS rid,
           NULL::text AS det
      FROM base b JOIN envio e ON e.cad = b.cad
    UNION ALL
    SELECT g.tam, g.cor, g.qd, 'registro', 'explosao_ajuste', -g.d, u.nome::text, NULL::text, e.mod_ref, g.cad, NULL::text
      FROM lg g JOIN envio e ON e.cad = g.cad
      LEFT JOIN public.users u ON u.id = g.por_id
  ),
  rev0 AS (  -- a MESMA baixa_revenda do core (revenda/importado ainda nao enviado ao PCP, pecas recebidas do cad-espelho)
    SELECT m.id AS modelo, m.origem AS m_origem, COALESCE(NULLIF(btrim(m.ref), ''), m.nome)::text AS mod_ref, c.id AS cad, me.cor_id AS cor,
           sum(me.consumo * public._insumo_pecas(public._insumo_tamanho_de(me.etiqueta_id), public._grade_mapa_cad(c.id, true),
                                                 coalesce(cg.total_real, 0))) AS q
      FROM public.modelo_etiquetas me
      JOIN public.modelos m ON m.id = me.modelo_id AND m.tenant_id = _tenant AND m.origem IN ('revenda', 'importado')
      JOIN public.cad c ON c.modelo_id = m.id AND c.tenant_id = _tenant AND NOT coalesce(c.enviado_corte, false)
      JOIN LATERAL (SELECT g.cad_id, sum(g.grade_total_real) AS total_real FROM public.cad_grades g WHERE g.cad_id = c.id GROUP BY g.cad_id) cg
        ON true
     WHERE me.etiqueta_id = _etiqueta_id
       AND EXISTS (SELECT 1 FROM etq)
     GROUP BY 1, 2, 3, 4, 5
  ),
  rev_oc AS (
    SELECT DISTINCT ON (r.modelo) r.modelo, x.numero, x.data_entrega
      FROM rev0 r
      JOIN LATERAL (
        SELECT o.numero::text AS numero, o.data_entrega, o.created_at
          FROM public.ocs_p_acabado o JOIN public.produtos_acabados pa ON pa.id = o.produto_acabado_id
         WHERE r.m_origem = 'revenda' AND pa.modelo_id = r.modelo AND o.tenant_id = _tenant AND o.status = 'recebido'
        UNION ALL
        SELECT o.numero::text, o.data_entrega, o.created_at
          FROM public.ocs_importado o JOIN public.produtos_importados pi ON pi.id = o.produto_importado_id
         WHERE r.m_origem = 'importado' AND pi.modelo_id = r.modelo AND o.tenant_id = _tenant AND o.status = 'recebido'
      ) x ON true
     ORDER BY r.modelo, x.data_entrega DESC NULLS LAST, x.created_at DESC
  ),
  sai_rev AS (
    SELECT NULL::text AS tam, r.cor,
           CASE WHEN ro.data_entrega IS NOT NULL THEN (ro.data_entrega::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ro.data_entrega IS NOT NULL THEN 'data_oc' ELSE 'sem_data' END AS fonte,
           'revenda' AS org, -r.q AS q, NULL::text AS por, ro.numero AS oc_ref, r.mod_ref, r.cad AS rid, NULL::text AS det
      FROM rev0 r
      LEFT JOIN rev_oc ro ON ro.modelo = r.modelo
  ),
  sai_pt AS (  -- [urg r11c] baixa da PECA TESTE (ledger estoque_peca_teste_baixas, familia 'insumo'): 1 linha por registro, bucket
               -- (tamanho, cor_id) da propria linha. baixa = saida negativa; estorno = entrada positiva (q = -quantidade). mod_ref =
               -- REF/nome do card VIVO (tentativa -> modelo) senao NULL; det = rotulo; quem = users.nome do created_by.
    SELECT b.tamanho AS tam, b.cor_id AS cor, b.created_at AS qd, 'registro' AS fonte, b.origem AS org,
           -b.quantidade AS q, u.nome::text AS por, NULL::text AS oc_ref,
           COALESCE(NULLIF(btrim(m.ref), ''), m.nome)::text AS mod_ref, b.id AS rid, NULLIF(btrim(b.rotulo), '') AS det
      FROM public.estoque_peca_teste_baixas b
      LEFT JOIN public.users u ON u.id = b.created_by
      LEFT JOIN public.modelo_peca_teste_tentativas pt ON pt.id = b.tentativa_id
      LEFT JOIN public.modelos m ON m.id = pt.modelo_id AND m.tenant_id = _tenant
     WHERE b.tenant_id = _tenant AND b.familia = 'insumo' AND b.etiqueta_id = _etiqueta_id
       AND EXISTS (SELECT 1 FROM etq)
  ),
  mov AS (
    SELECT * FROM ent UNION ALL SELECT * FROM sai_cad UNION ALL SELECT * FROM sai_rev UNION ALL SELECT * FROM sai_pt
  )
  SELECT NULL::uuid, cr.tam, mov.cor, cr.cnome::text,
         mov.qd, mov.fonte, CASE WHEN mov.q > 0 THEN 'entrada' ELSE 'saida' END, mov.org, mov.q,
         mov.por, mov.oc_ref, mov.mod_ref, mov.rid, mov.det,
         cr.rec, cr.bx, cr.fis
    FROM mov
    LEFT JOIN public.cores co ON co.id = mov.cor
    JOIN cr ON cr.tam IS NOT DISTINCT FROM mov.tam AND cr.cnome IS NOT DISTINCT FROM co.nome
   WHERE mov.q <> 0
   ORDER BY cr.tam NULLS FIRST, cr.cnome NULLS FIRST, mov.qd NULLS FIRST, (mov.q < 0), mov.oc_ref, mov.rid;
END
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._estoque_aviamento_core(uuid)', '439093c8501001c17e71f283b1dcef92', '{postgres=X/postgres,service_role=X/postgres}', false, true),
      ('public._estoque_etiqueta_core(uuid)', 'de6eeb18e1e15cf8137a6560e451fa0f', '{postgres=X/postgres,service_role=X/postgres}', false, true),
      ('public._estoque_extrato_tecido_core(uuid,uuid)', '0c73603f23ad1d74022457d699f7d834', '{postgres=X/postgres,service_role=X/postgres}', false, true),
      ('public._estoque_extrato_aviamento_core(uuid,uuid)', '00759c836dd9ee40a4dcf1db427c9276', '{postgres=X/postgres,service_role=X/postgres}', false, true),
      ('public._estoque_extrato_insumo_core(uuid,uuid)', '808b80ed2183c812533d3ee92978bddd', '{postgres=X/postgres,service_role=X/postgres}', false, true)
    ) AS x(f, m, acl, w, sd) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r11c: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef = r.sd AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM r.w
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r11c: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
