-- Urgentes R11d - regras da mini: BOM 1 peca, alocacao como o corte, baixa/estorno, leitura do estoque + predicado R12. GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-d.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-r11.md (Task 3 / R11d; Rulings 4,5,6,7,8,9,13) + espelho TS src/lib/peca-teste-mini.ts.
-- O que muda (so catalogo: 10 CREATE FUNCTION + GRANT/REVOKE; nenhum dado; nenhuma conta nova de estoque - a baixa/estorno so
-- rodam pela 199400/_salvar_peca_teste_core):
--   1) _peca_teste_variante_aviamento_padrao / _peca_teste_insumo_tam_bucket: helpers do BOM 1 peca (cor de V / regra ce_sem).
--   2) _peca_teste_mini_linhas: BOM para 1 peca (tecido por bloco x variante com pecas>0 pela regua do casamento; aviamento sem
--      loss; insumo vinculado a OUTRO tamanho sai; bucket (etiqueta,tam,cor)). Espelho TS linhasUmaPeca.
--   3) _peca_teste_tecido_baixar: regua do corte (vinculos por prioridade+teto, FIFO, desmarcado = so o item). Grava etb
--      origem 'peca_teste', cad_id/rolo_id NULL. Espelho TS alocarTecido.
--   4) _peca_teste_mini_baixar/_estornar: orquestram a baixa/estorno (confere = P0409; falta como o corte; estorno = linha
--      negativa nos 2 ledgers; foto b_*). Supoem a tentativa/mini/linhas JA travadas pelo chamador; pegam corte_tenant.
--   5) _peca_teste_mini_tem_historico / _peca_teste_mini_feita (predicado R12, espelho TS miniExplosaoFeita).
--   6) peca_teste_mini_estoque (wrapper: Criacao + VER peca_teste + loja com Entrada e Saida; outra loja = NULL) ->
--      _peca_teste_mini_estoque_core (foto do estoque: vinculos/FIFO do tecido, fisico de aviamento/insumo dos cores).
-- Trava (MEDIDA na copia local, supautils carregado, diferenca de pg_locks numa txn REVERTIDA, DDL digitada): SO catalogo +
--   AccessShareLock (LEITURA, nao bloqueia escrita) nas tabelas que a VALIDACAO plpgsql dos corpos toca (modelos/BOM/OCs/cores).
--   NENHUM ShareRowExclusive/AccessExclusive de dado; 0 em auth/storage/realtime. Qualquer hora. lock_timeout 1500ms.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._peca_teste_variante_aviamento_padrao(uuid,uuid,uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 5dae1386c608628edcd6f8362ba996e7
--   public._peca_teste_insumo_tam_bucket(uuid,text) (NOVA)
--     ANTES  ausente
--     DEPOIS cabea631702567f1e3a5199e8a272746
--   public._peca_teste_mini_linhas(uuid,text,uuid,jsonb) (NOVA)
--     ANTES  ausente
--     DEPOIS 3d73d0db8fc0902c5bd07edfbfa2fe70
--   public._peca_teste_tecido_baixar(uuid,uuid,uuid,text,integer,integer,uuid,numeric,boolean,uuid,text) (NOVA)
--     ANTES  ausente
--     DEPOIS e03a4d616e7ae297386a5e0e6bb83ff7
--   public._peca_teste_mini_baixar(uuid,jsonb) (NOVA)
--     ANTES  ausente
--     DEPOIS 444861eae9b28bc09ec3bfd80bc01033
--   public._peca_teste_mini_estornar(uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS c8f160a73b3a30a6105c7a45aff9c89d
--   public._peca_teste_mini_tem_historico(uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 10c05fae5041077c6dc23436d66f7d44
--   public._peca_teste_mini_feita(uuid,uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS f81421e9b3aa27f34ab426f6b0783f96
--   public._peca_teste_mini_estoque_core(uuid,uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 2a3527c28b3486d5f86587d9af169f72
--   public.peca_teste_mini_estoque(uuid) (NOVA, wrapper)
--     ANTES  ausente
--     DEPOIS 8a1d492a40993a582b7978080a1fff2d
--     NEUTRO a94ba498dee379436f45577f790a5b8d (_down)
--   dependencias FIXADAS (nao redefinidas):
--     public._estoque_aviamento_core(uuid) 439093c8501001c17e71f283b1dcef92
--     public._estoque_etiqueta_core(uuid) de6eeb18e1e15cf8137a6560e451fa0f
--     public._insumo_tamanho_de(uuid) 46fd6f65599f7de2d3ab12777fefa7d1
-- ====================================================================================
-- Volta (LIFO, banco DEPOIS do site): supabase/rollback/20261103199300_urg_r11_regras_mini_down.sql - DEPOIS do 199400_down e ANTES do 199200_down/199100_down. NEUTRALIZA o
-- wrapper (NULL, sem portoes) e tira o EXECUTE do authenticated; os 9 cores ficam (inertes). DROP das 10 funcoes: supabase/rollback/20261103199300_urg_r11_regras_mini_down_drop.sql
-- (opcional, DEPOIS, LIFO). O _down_drop RECUSA enquanto a 199400 (ou outra funcao de public) citar alguma delas; roda ANTES
-- dos _down_drop da 170000/177000/Modularidade (os cores citam _insumo_tamanho_de/_exige_modulos).
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
  -- dependencias FIXADAS (nao redefinidas aqui): o texto de hoje
  FOR r IN SELECT * FROM (VALUES
      ('public._estoque_aviamento_core(uuid)', '439093c8501001c17e71f283b1dcef92'),
      ('public._estoque_etiqueta_core(uuid)', 'de6eeb18e1e15cf8137a6560e451fa0f'),
      ('public._insumo_tamanho_de(uuid)', '46fd6f65599f7de2d3ab12777fefa7d1')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r11d: dependencia % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regclass('public.estoque_peca_teste_baixas') IS NULL
     OR to_regclass('public.modelo_peca_teste_mini') IS NULL THEN
    RAISE EXCEPTION 'urg_r11d: exige a 20261103199000 (urg R11a) aplicada' USING ERRCODE = 'P0001';
  END IF;
  -- funcoes NOVAS deste bloco: ausentes, ja com o texto de DEPOIS ou no NEUTRO do _down (ciclo ida -> _down -> ida)
  FOR r IN SELECT * FROM (VALUES
      ('public._peca_teste_variante_aviamento_padrao(uuid,uuid,uuid)', '5dae1386c608628edcd6f8362ba996e7', '5dae1386c608628edcd6f8362ba996e7', false),
      ('public._peca_teste_insumo_tam_bucket(uuid,text)', 'cabea631702567f1e3a5199e8a272746', 'cabea631702567f1e3a5199e8a272746', false),
      ('public._peca_teste_mini_linhas(uuid,text,uuid,jsonb)', '3d73d0db8fc0902c5bd07edfbfa2fe70', '3d73d0db8fc0902c5bd07edfbfa2fe70', false),
      ('public._peca_teste_tecido_baixar(uuid,uuid,uuid,text,integer,integer,uuid,numeric,boolean,uuid,text)', 'e03a4d616e7ae297386a5e0e6bb83ff7', 'e03a4d616e7ae297386a5e0e6bb83ff7', false),
      ('public._peca_teste_mini_baixar(uuid,jsonb)', '444861eae9b28bc09ec3bfd80bc01033', '444861eae9b28bc09ec3bfd80bc01033', false),
      ('public._peca_teste_mini_estornar(uuid)', 'c8f160a73b3a30a6105c7a45aff9c89d', 'c8f160a73b3a30a6105c7a45aff9c89d', false),
      ('public._peca_teste_mini_tem_historico(uuid)', '10c05fae5041077c6dc23436d66f7d44', '10c05fae5041077c6dc23436d66f7d44', false),
      ('public._peca_teste_mini_feita(uuid,uuid)', 'f81421e9b3aa27f34ab426f6b0783f96', 'f81421e9b3aa27f34ab426f6b0783f96', false),
      ('public._peca_teste_mini_estoque_core(uuid,uuid)', '2a3527c28b3486d5f86587d9af169f72', '2a3527c28b3486d5f86587d9af169f72', false),
      ('public.peca_teste_mini_estoque(uuid)', '8a1d492a40993a582b7978080a1fff2d', 'a94ba498dee379436f45577f790a5b8d', true)
    ) AS x(f, d, n, w) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v NOT IN (r.d, r.n) THEN
      RAISE EXCEPTION 'urg_r11d: % (nova) com texto inesperado (md5 %) - gere de novo', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- 1) funcoes NOVAS (texto canonico; wrapper = authenticated executa, PUBLIC/anon nao; core = REVOKE dos 3)
CREATE OR REPLACE FUNCTION public._peca_teste_variante_aviamento_padrao(_aviamento_id uuid, _cor_v uuid, _bvar uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [urg r11d] variante padrao do aviamento (espelho TS variantePadraoAviamento): a da cor de V (se UNICA) -> a do BOM (_bvar) ->
  -- a UNICA do aviamento -> NULL. _cor_v NULL (card sem Tecido 1) pula o passo 1.
  SELECT CASE
    WHEN _cor_v IS NOT NULL AND (SELECT count(*) FROM public.variantes_aviamento va WHERE va.aviamento_id = _aviamento_id AND va.cor_id = _cor_v) = 1
      THEN (SELECT va.id FROM public.variantes_aviamento va WHERE va.aviamento_id = _aviamento_id AND va.cor_id = _cor_v LIMIT 1)
    WHEN _bvar IS NOT NULL THEN _bvar
    WHEN (SELECT count(*) FROM public.variantes_aviamento va WHERE va.aviamento_id = _aviamento_id) = 1
      THEN (SELECT va.id FROM public.variantes_aviamento va WHERE va.aviamento_id = _aviamento_id LIMIT 1)
    ELSE NULL END
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_variante_aviamento_padrao(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._peca_teste_insumo_tam_bucket(_etiqueta_id uuid, _tamanho text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [urg r11d] tamanho_bucket do insumo (espelho TS tamanhoBucketInsumo): T se o insumo TEM tamanho proprio (formato <> 'nenhum'
  -- E alguma variante com tamanho apos btrim), senao NULL. _tamanho NULL = NULL. Le o cadastro sem filtrar loja (o chamador ja resolveu).
  SELECT CASE
           WHEN _tamanho IS NULL THEN NULL
           WHEN coalesce(e.formato_tamanho, 'ambos') <> 'nenhum'
                AND EXISTS (SELECT 1 FROM public.variantes_etiqueta v
                             WHERE v.etiqueta_id = e.id AND nullif(btrim(v.tamanho), '') IS NOT NULL)
             THEN _tamanho
           ELSE NULL
         END
    FROM public.etiquetas e WHERE e.id = _etiqueta_id
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_insumo_tam_bucket(uuid,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._peca_teste_mini_linhas(_modelo_id uuid, _tamanho text, _variante_tecido_id uuid, _ajustes jsonb)
 RETURNS TABLE(chave text, familia text, rotulo text, variante_rotulo text, unidade text, tipo text, numero integer, ordem integer, variante_tecido_id uuid, pecas numeric, aviamento_id uuid, variante_aviamento_id uuid, etiqueta_id uuid, cor_id uuid, tamanho_bucket text, consumo numeric, loss_percent numeric, necessaria numeric, a_enviar numeric, oc_tecido_item_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ordem_n int;
  v_cor_v uuid;
BEGIN
  -- [urg r11d] BOM para 1 PECA (espelho TS linhasUmaPeca). _ajustes = {chave: {consumo,loss_percent,a_enviar,variante_aviamento_id,oc_tecido_item_id}}
  -- (NULL/chave ausente = segue o BOM). Entradas: tamanho T (_tamanho) e variante V (_variante_tecido_id) do Tecido 1.
  _ajustes := coalesce(_ajustes, '{}'::jsonb);

  -- ordem N de V no Tecido 1 e cor de V (NULL = card sem Tecido 1 / sem V no BOM).
  SELECT ctv.ordem, vt.cor_id INTO v_ordem_n, v_cor_v
    FROM public.modelo_tecidos mt
    JOIN public.modelo_tecido_variantes ctv ON ctv.modelo_tecido_id = mt.id
    LEFT JOIN public.variantes_tecido vt ON vt.id = ctv.variante_tecido_id
   WHERE mt.modelo_id = _modelo_id AND mt.tipo = 'tecido' AND mt.numero = 1
     AND ctv.variante_tecido_id = _variante_tecido_id
   LIMIT 1;

  RETURN QUERY
  -- -- Tecido --
  WITH tec AS (
    SELECT mt.tipo, mt.numero, mt.consumo AS bconsumo, mt.loss_percent AS bloss,
           ctv.ordem, ctv.variante_tecido_id AS vtid, coalesce(ctv.multiplicador, 1) AS mult,
           ctv.complementa_variante_ids AS casa, vt.nome_variante AS vnome,
           (mt.tipo = 'tecido' AND mt.numero = 1) AS is_t1
      FROM public.modelo_tecidos mt
      JOIN public.modelo_tecido_variantes ctv ON ctv.modelo_tecido_id = mt.id
      LEFT JOIN public.variantes_tecido vt ON vt.id = ctv.variante_tecido_id
     WHERE mt.modelo_id = _modelo_id AND ctv.variante_tecido_id IS NOT NULL
  ),
  tec_p AS (
    SELECT t.*,
           ( CASE
               WHEN t.is_t1 THEN CASE WHEN t.ordem = v_ordem_n THEN 1 ELSE 0 END
               WHEN coalesce(array_length(t.casa, 1), 0) = 0 THEN CASE WHEN t.ordem = v_ordem_n THEN 1 ELSE 0 END
               ELSE CASE WHEN _variante_tecido_id = ANY(t.casa) THEN 1 ELSE 0 END
             END )::numeric * t.mult AS pecas
      FROM tec t
  )
  SELECT ('t:' || p.tipo || ':' || p.numero || ':' || p.ordem || ':' || p.vtid::text)::text AS chave,
         'tecido'::text,
         (CASE p.tipo WHEN 'tecido' THEN 'Tecido ' WHEN 'forro' THEN 'Forro ' WHEN 'entretela' THEN 'Entretela ' ELSE p.tipo || ' ' END || p.numero)::text,
         p.vnome::text, 'm'::text, p.tipo::text, p.numero, p.ordem, p.vtid, p.pecas,
         NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text,
         ca.consumo, ca.loss, round(p.pecas * ca.consumo * (1 + ca.loss / 100), 2) AS necessaria,
         coalesce((aj -> 'a_enviar')::text::numeric, round(p.pecas * ca.consumo * (1 + ca.loss / 100), 2)) AS a_enviar,
         nullif(aj ->> 'oc_tecido_item_id', '')::uuid
    FROM tec_p p
    CROSS JOIN LATERAL (SELECT _ajustes -> ('t:' || p.tipo || ':' || p.numero || ':' || p.ordem || ':' || p.vtid::text) AS aj) a
    CROSS JOIN LATERAL (SELECT
        coalesce((a.aj -> 'consumo')::text::numeric, coalesce(p.bconsumo, 0)) AS consumo,
        coalesce((a.aj -> 'loss_percent')::text::numeric, coalesce(p.bloss, 0)) AS loss) ca
   WHERE p.pecas > 0;

  -- -- Aviamento -- (k por aviamento na ordem numero)
  RETURN QUERY
  WITH avi AS (
    SELECT ma.aviamento_id, ma.numero, ma.consumo, ma.variante_aviamento_id AS bvar, av.nome_av,
           row_number() OVER (PARTITION BY ma.aviamento_id ORDER BY ma.numero NULLS FIRST, ma.id) AS k
      FROM public.modelo_aviamentos ma
      LEFT JOIN (SELECT a2.id, a2.codigo_nome AS nome_av FROM public.aviamentos a2) av ON av.id = ma.aviamento_id
     WHERE ma.modelo_id = _modelo_id
  ),
  avi_var AS (
    SELECT a.*,
           ('a:' || a.aviamento_id::text || ':' || a.k) AS chave
      FROM avi a
  )
  SELECT av.chave::text, 'aviamento'::text, coalesce(av.nome_av, 'Aviamento')::text,
         (SELECT va.nome_variante::text FROM public.variantes_aviamento va WHERE va.id = vsel.var) AS variante_rotulo,
         'un'::text, NULL::text, av.numero, NULL::int, NULL::uuid, 1::numeric,
         av.aviamento_id,
         vsel.var,
         NULL::uuid, NULL::uuid, NULL::text,
         ca.consumo, 0::numeric, round(ca.consumo * 1, 4),
         coalesce((aj -> 'a_enviar')::text::numeric, round(ca.consumo * 1, 4)),
         NULL::uuid
    FROM avi_var av
    CROSS JOIN LATERAL (SELECT _ajustes -> av.chave AS aj) a
    CROSS JOIN LATERAL (SELECT coalesce((a.aj -> 'consumo')::text::numeric, coalesce(av.consumo, 0)) AS consumo) ca
    CROSS JOIN LATERAL (SELECT
        CASE
          WHEN a.aj ? 'variante_aviamento_id' THEN nullif(a.aj ->> 'variante_aviamento_id', '')::uuid
          ELSE public._peca_teste_variante_aviamento_padrao(av.aviamento_id, v_cor_v, av.bvar)
        END AS var) vsel;

  -- -- Insumo --
  RETURN QUERY
  WITH ins AS (
    SELECT me.etiqueta_id, me.cor_id, me.numero, me.consumo, e.formato_tamanho,
           row_number() OVER (PARTITION BY me.etiqueta_id, coalesce(me.cor_id::text, '-') ORDER BY me.numero NULLS FIRST, me.id) AS k,
           public._insumo_tamanho_de(me.etiqueta_id) AS tam_vinc, en.nome AS nome_ins
      FROM public.modelo_etiquetas me
      LEFT JOIN public.etiquetas e ON e.id = me.etiqueta_id
      LEFT JOIN public.etiquetas en ON en.id = me.etiqueta_id
     WHERE me.modelo_id = _modelo_id
  ),
  ins_c AS (
    SELECT i.*, ('i:' || i.etiqueta_id::text || ':' || coalesce(i.cor_id::text, '-') || ':' || i.k) AS chave
      FROM ins i
     WHERE i.tam_vinc IS NULL OR i.tam_vinc = _tamanho
  )
  SELECT ic.chave::text, 'insumo'::text, coalesce(ic.nome_ins, 'Insumo')::text, NULL::text, 'un'::text,
         NULL::text, ic.numero, NULL::int, NULL::uuid, 1::numeric, NULL::uuid, NULL::uuid,
         ic.etiqueta_id, ic.cor_id, public._peca_teste_insumo_tam_bucket(ic.etiqueta_id, _tamanho),
         ca.consumo, 0::numeric, round(ca.consumo * 1, 4),
         coalesce((aj -> 'a_enviar')::text::numeric, round(ca.consumo * 1, 4)), NULL::uuid
    FROM ins_c ic
    CROSS JOIN LATERAL (SELECT _ajustes -> ic.chave AS aj) a
    CROSS JOIN LATERAL (SELECT coalesce((a.aj -> 'consumo')::text::numeric, coalesce(ic.consumo, 0)) AS consumo) ca;
END
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_mini_linhas(uuid,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._peca_teste_tecido_baixar(_tenant uuid, _tentativa uuid, _modelo uuid, _tipo text, _numero integer, _ordem integer, _variante uuid, _metros numeric, _mesma_oc boolean, _item uuid, _rotulo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_modo text;
  v_restante numeric := coalesce(_metros, 0);
  v_fontes jsonb := '[]'::jsonb;
  v_baixado numeric := 0;
  v_usados uuid[] := ARRAY[]::uuid[];
  v_saldo numeric;
  v_limite numeric;
  v_consumir numeric;
  r record;
BEGIN
  -- [urg r11d] baixa de 1 variante de tecido como o corte (_baixar_estoque_tecido_corte_core): por_oc = vinculos por (prioridade,
  -- item) com teto quantidade_m, depois FIFO fora dos usados; automatico = FIFO; desmarcado (_mesma_oc=false) = so o item escolhido.
  -- Grava em estoque_tecido_baixas origem 'peca_teste', cad_id/rolo_id NULL, peca_teste_tentativa_id, motivo=_rotulo, created_by=auth.uid().
  -- Supoe a chave corte_tenant ja pega pelo chamador. Devolve {baixado, fontes:[{oc_tecido_item_id, metros}]}.
  IF v_restante <= 0 THEN RETURN jsonb_build_object('baixado', 0, 'fontes', '[]'::jsonb); END IF;

  SELECT coalesce(modo_baixa_estoque, 'por_oc') INTO v_modo FROM public.tenant_config WHERE tenant_id = _tenant;
  v_modo := coalesce(v_modo, 'por_oc');

  IF NOT coalesce(_mesma_oc, true) THEN
    -- desmarcado: SO o item escolhido, sem fallback.
    IF _item IS NULL THEN RETURN jsonb_build_object('baixado', 0, 'fontes', '[]'::jsonb); END IF;
    SELECT saldo_m INTO v_saldo FROM public.saldo_oc_item_m(_item);
    v_consumir := LEAST(v_restante, coalesce(v_saldo, 0));
    IF v_consumir > 0 THEN
      INSERT INTO public.estoque_tecido_baixas (tenant_id, cad_id, rolo_id, variante_tecido_id, oc_tecido_item_id, quantidade,
             origem, peca_teste_tentativa_id, motivo, created_by)
      VALUES (_tenant, NULL, NULL, _variante, _item, v_consumir, 'peca_teste', _tentativa, _rotulo, auth.uid());
      v_fontes := v_fontes || jsonb_build_object('oc_tecido_item_id', _item, 'metros', v_consumir);
      v_baixado := v_baixado + v_consumir;
    END IF;
    RETURN jsonb_build_object('baixado', v_baixado, 'fontes', v_fontes);
  END IF;

  -- fase 1: vinculos (so por_oc) por (prioridade, item).
  IF v_modo = 'por_oc' THEN
    FOR r IN
      SELECT oc_tecido_item_id, coalesce(quantidade_m, 0) AS quantidade_m, coalesce(prioridade, 1) AS prioridade
        FROM public.modelo_tecido_oc_links
       WHERE modelo_id = _modelo AND tipo = _tipo AND numero = _numero AND ordem = _ordem AND variante_tecido_id = _variante
       ORDER BY prioridade, oc_tecido_item_id
    LOOP
      EXIT WHEN v_restante <= 0;
      v_usados := array_append(v_usados, r.oc_tecido_item_id);
      SELECT saldo_m INTO v_saldo FROM public.saldo_oc_item_m(r.oc_tecido_item_id);
      v_saldo := coalesce(v_saldo, 0);
      IF v_saldo <= 0 THEN CONTINUE; END IF;
      v_limite := CASE WHEN r.quantidade_m > 0 THEN r.quantidade_m ELSE v_restante END;
      v_consumir := LEAST(v_restante, v_saldo, v_limite);
      IF v_consumir <= 0 THEN CONTINUE; END IF;
      INSERT INTO public.estoque_tecido_baixas (tenant_id, cad_id, rolo_id, variante_tecido_id, oc_tecido_item_id, quantidade,
             origem, peca_teste_tentativa_id, motivo, created_by)
      VALUES (_tenant, NULL, NULL, _variante, r.oc_tecido_item_id, v_consumir, 'peca_teste', _tentativa, _rotulo, auth.uid());
      v_fontes := v_fontes || jsonb_build_object('oc_tecido_item_id', r.oc_tecido_item_id, 'metros', v_consumir);
      v_baixado := v_baixado + v_consumir;
      v_restante := v_restante - v_consumir;
    END LOOP;
  END IF;

  -- fase 2: FIFO (mais velho) fora dos usados.
  IF v_restante > 0 THEN
    FOR r IN
      SELECT it.id AS item_id, s.saldo_m
        FROM public.ocs_tecido_itens it
        JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
        CROSS JOIN LATERAL public.saldo_oc_item_m(it.id) s
       WHERE oc.tenant_id = _tenant AND oc.status = 'recebido' AND it.variante_tecido_id = _variante
         AND s.saldo_m > 0 AND NOT (it.id = ANY(v_usados))
       ORDER BY oc.data_entrega NULLS LAST, oc.created_at
    LOOP
      EXIT WHEN v_restante <= 0;
      v_consumir := LEAST(v_restante, r.saldo_m);
      INSERT INTO public.estoque_tecido_baixas (tenant_id, cad_id, rolo_id, variante_tecido_id, oc_tecido_item_id, quantidade,
             origem, peca_teste_tentativa_id, motivo, created_by)
      VALUES (_tenant, NULL, NULL, _variante, r.item_id, v_consumir, 'peca_teste', _tentativa, _rotulo, auth.uid());
      v_fontes := v_fontes || jsonb_build_object('oc_tecido_item_id', r.item_id, 'metros', v_consumir);
      v_baixado := v_baixado + v_consumir;
      v_restante := v_restante - v_consumir;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('baixado', v_baixado, 'fontes', v_fontes);
END
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_tecido_baixar(uuid,uuid,uuid,text,integer,integer,uuid,numeric,boolean,uuid,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._peca_teste_mini_baixar(_tentativa uuid, _confere jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_modelo uuid; v_tam text; v_var uuid; v_mesma boolean;
  v_ajustes jsonb;
  v_ref text;
  r record;
  v_baixado numeric; v_faltou numeric; v_fontes jsonb;
  v_fisico numeric;
  v_faltas jsonb := '[]'::jsonb;
  v_n int := 0;
BEGIN
  -- [urg r11d] baixa da mini de 1 peca. Supoe a tentativa, a mini e as linhas JA travadas pelo chamador (_salvar_peca_teste_core).
  -- Calcula as linhas pelo BOM ATUAL + ajustes salvos; se veio _confere (a_enviar que a tela viu, por chave, 4 casas) e diverge ->
  -- P0409 peca_teste_mini_desatualizada (nada grava). Tecido pela regua do corte; aviamento/insumo pelo fisico do core; falta como o corte.
  SELECT m.tenant_id, m.modelo_id, m.tamanho, m.variante_tecido_id, m.mesma_oc
    INTO v_tenant, v_modelo, v_tam, v_var, v_mesma
    FROM public.modelo_peca_teste_mini m WHERE m.tentativa_id = _tentativa;
  IF v_tenant IS NULL THEN RETURN jsonb_build_object('linhas', 0, 'faltas', '[]'::jsonb); END IF;

  v_ref := (SELECT coalesce(nullif(btrim(md.ref), ''), md.nome) FROM public.modelos md WHERE md.id = v_modelo)
           || ' . tentativa ' || (SELECT t.numero FROM public.modelo_peca_teste_tentativas t WHERE t.id = _tentativa)
           || ' . saida ' || to_char(coalesce((SELECT t.data_saida FROM public.modelo_peca_teste_tentativas t WHERE t.id = _tentativa), current_date), 'DD/MM/YYYY');

  -- ajustes salvos (NULL = segue o BOM): monta {chave: {...}} so com as chaves que tem algum ajuste.
  SELECT coalesce(jsonb_object_agg(l.chave, jsonb_strip_nulls(jsonb_build_object(
           'consumo', l.consumo, 'loss_percent', l.loss_percent, 'a_enviar', l.a_enviar,
           'variante_aviamento_id', l.variante_aviamento_id, 'oc_tecido_item_id', l.oc_tecido_item_id))), '{}'::jsonb)
    INTO v_ajustes
    FROM public.modelo_peca_teste_mini_linhas l WHERE l.tentativa_id = _tentativa;

  -- confere (Ruling 6): conjunto de chaves e a_enviar (4 casas) = o que a tela viu.
  IF _confere IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public._peca_teste_mini_linhas(v_modelo, v_tam, v_var, v_ajustes) x
      FULL JOIN LATERAL (SELECT key AS chave, value::text::numeric AS ae FROM jsonb_each(_confere)) c ON c.chave = x.chave
      WHERE x.chave IS NULL OR c.chave IS NULL OR round(x.a_enviar, 4) IS DISTINCT FROM round(c.ae, 4)
    ) THEN
      RAISE EXCEPTION 'peca_teste_mini_desatualizada: a mini mudou; recarregue' USING ERRCODE = 'P0409';
    END IF;
  END IF;

  -- advisory do corte (serializa com o corte da loja) SO quando ha o que baixar.
  PERFORM pg_advisory_xact_lock(hashtext('corte_tenant:' || v_tenant::text));

  -- apaga linhas antigas e regrava a FOTO de TODAS as linhas calculadas.
  DELETE FROM public.modelo_peca_teste_mini_linhas WHERE tentativa_id = _tentativa;

  FOR r IN SELECT * FROM public._peca_teste_mini_linhas(v_modelo, v_tam, v_var, v_ajustes) LOOP
    v_baixado := 0; v_fontes := NULL;
    IF r.familia = 'tecido' THEN
      SELECT (res ->> 'baixado')::numeric, res -> 'fontes'
        INTO v_baixado, v_fontes
        FROM public._peca_teste_tecido_baixar(v_tenant, _tentativa, v_modelo, r.tipo, r.numero, r.ordem, r.variante_tecido_id,
              r.a_enviar, v_mesma, r.oc_tecido_item_id, v_ref || ' . ' || r.rotulo) res;
    ELSIF r.familia = 'aviamento' THEN
      SELECT coalesce(sum(c.fisico), 0) INTO v_fisico
        FROM public._estoque_aviamento_core(v_tenant) c
       WHERE c.id = r.aviamento_id AND c.variante_id IS NOT DISTINCT FROM r.variante_aviamento_id;
      v_baixado := LEAST(r.a_enviar, greatest(v_fisico, 0));
      IF v_baixado > 0 THEN
        INSERT INTO public.estoque_peca_teste_baixas (tenant_id, tentativa_id, modelo_id, familia, aviamento_id,
               variante_aviamento_id, origem, quantidade, rotulo, created_by)
        VALUES (v_tenant, _tentativa, v_modelo, 'aviamento', r.aviamento_id, r.variante_aviamento_id, 'peca_teste',
                v_baixado, v_ref || ' . ' || r.rotulo, auth.uid());
      END IF;
    ELSE -- insumo
      SELECT coalesce(sum(c.fisico), 0) INTO v_fisico
        FROM public._estoque_etiqueta_core(v_tenant) c
       WHERE c.etiqueta_id = r.etiqueta_id AND c.tamanho IS NOT DISTINCT FROM r.tamanho_bucket
         AND c.cor_nome IS NOT DISTINCT FROM (SELECT nome FROM public.cores WHERE id = r.cor_id);
      v_baixado := LEAST(r.a_enviar, greatest(v_fisico, 0));
      IF v_baixado > 0 THEN
        INSERT INTO public.estoque_peca_teste_baixas (tenant_id, tentativa_id, modelo_id, familia, etiqueta_id, tamanho, cor_id,
               origem, quantidade, rotulo, created_by)
        VALUES (v_tenant, _tentativa, v_modelo, 'insumo', r.etiqueta_id, r.tamanho_bucket, r.cor_id, 'peca_teste',
                v_baixado, v_ref || ' . ' || r.rotulo, auth.uid());
      END IF;
    END IF;

    v_faltou := greatest(r.a_enviar - coalesce(v_baixado, 0), 0);

    INSERT INTO public.modelo_peca_teste_mini_linhas (tenant_id, tentativa_id, chave, familia, consumo, loss_percent, a_enviar,
           variante_aviamento_id, oc_tecido_item_id, b_rotulo, b_variante, b_unidade, b_consumo, b_loss_percent, b_necessaria,
           b_a_enviar, b_baixado, b_faltou, b_fontes)
    SELECT v_tenant, _tentativa, r.chave, r.familia,
           (v_ajustes -> r.chave -> 'consumo')::text::numeric, (v_ajustes -> r.chave -> 'loss_percent')::text::numeric,
           (v_ajustes -> r.chave -> 'a_enviar')::text::numeric, r.variante_aviamento_id, r.oc_tecido_item_id,
           r.rotulo, r.variante_rotulo, r.unidade, r.consumo, r.loss_percent, r.necessaria, r.a_enviar,
           coalesce(v_baixado, 0), v_faltou, v_fontes;
    v_n := v_n + 1;
    IF v_faltou > 0 THEN
      v_faltas := v_faltas || jsonb_build_object('chave', r.chave, 'familia', r.familia, 'rotulo', r.rotulo,
                    'a_enviar', r.a_enviar, 'baixado', coalesce(v_baixado, 0), 'faltou', v_faltou);
    END IF;
  END LOOP;

  UPDATE public.modelo_peca_teste_mini SET baixa_em = now(), baixa_por = auth.uid(), updated_at = now()
   WHERE tentativa_id = _tentativa;

  RETURN jsonb_build_object('linhas', v_n, 'faltas', v_faltas);
END
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_mini_baixar(uuid,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._peca_teste_mini_estornar(_tentativa uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_modelo uuid;
  r record; v_liq numeric; v_ref text;
  v_n int := 0;
BEGIN
  -- [urg r11d] estorno = linha compensatoria NEGATIVA nos 2 ledgers (nunca DELETE; Ruling 2). Por item/variante do tecido e por
  -- bucket do ledger novo: liquido (SUM peca_teste + peca_teste_estorno da tentativa) > 0 -> 1 linha de estorno com -liquido.
  -- Idempotente (liquido 0 nao gera nada). Limpa a foto (b_*) e zera baixa_em/baixa_por. Toca a tentativa.
  SELECT m.tenant_id, m.modelo_id INTO v_tenant, v_modelo FROM public.modelo_peca_teste_mini m WHERE m.tentativa_id = _tentativa;
  IF v_tenant IS NULL THEN RETURN jsonb_build_object('estornadas', 0); END IF;

  v_ref := (SELECT coalesce(nullif(btrim(md.ref), ''), md.nome) FROM public.modelos md WHERE md.id = v_modelo)
           || ' . estorno peca teste';
  PERFORM pg_advisory_xact_lock(hashtext('corte_tenant:' || v_tenant::text));

  -- tecido: por (variante, item de OC). liquido = SUM de todas as linhas peca_teste/estorno da tentativa.
  FOR r IN
    SELECT variante_tecido_id, oc_tecido_item_id, sum(quantidade) AS liq
      FROM public.estoque_tecido_baixas
     WHERE peca_teste_tentativa_id = _tentativa AND origem IN ('peca_teste', 'peca_teste_estorno')
     GROUP BY variante_tecido_id, oc_tecido_item_id
     HAVING sum(quantidade) > 0
  LOOP
    INSERT INTO public.estoque_tecido_baixas (tenant_id, cad_id, rolo_id, variante_tecido_id, oc_tecido_item_id, quantidade,
           origem, peca_teste_tentativa_id, motivo, created_by)
    VALUES (v_tenant, NULL, NULL, r.variante_tecido_id, r.oc_tecido_item_id, -r.liq, 'peca_teste_estorno', _tentativa, v_ref, auth.uid());
    v_n := v_n + 1;
  END LOOP;

  -- ledger novo: por bucket (familia/aviamento/variante/etiqueta/tamanho/cor).
  FOR r IN
    SELECT familia, aviamento_id, variante_aviamento_id, etiqueta_id, tamanho, cor_id, sum(quantidade) AS liq
      FROM public.estoque_peca_teste_baixas
     WHERE tentativa_id = _tentativa
     GROUP BY familia, aviamento_id, variante_aviamento_id, etiqueta_id, tamanho, cor_id
     HAVING sum(quantidade) > 0
  LOOP
    INSERT INTO public.estoque_peca_teste_baixas (tenant_id, tentativa_id, modelo_id, familia, aviamento_id, variante_aviamento_id,
           etiqueta_id, tamanho, cor_id, origem, quantidade, rotulo, created_by)
    VALUES (v_tenant, _tentativa, v_modelo, r.familia, r.aviamento_id, r.variante_aviamento_id, r.etiqueta_id, r.tamanho, r.cor_id,
            'peca_teste_estorno', -r.liq, v_ref, auth.uid());
    v_n := v_n + 1;
  END LOOP;

  -- limpa a foto e apaga as linhas sem ajuste; zera a baixa. Toca a tentativa.
  UPDATE public.modelo_peca_teste_mini_linhas
     SET b_rotulo = NULL, b_variante = NULL, b_unidade = NULL, b_consumo = NULL, b_loss_percent = NULL, b_necessaria = NULL,
         b_a_enviar = NULL, b_baixado = NULL, b_faltou = NULL, b_fontes = NULL
   WHERE tentativa_id = _tentativa;
  DELETE FROM public.modelo_peca_teste_mini_linhas
   WHERE tentativa_id = _tentativa AND consumo IS NULL AND loss_percent IS NULL AND a_enviar IS NULL
     AND variante_aviamento_id IS NULL AND oc_tecido_item_id IS NULL;
  UPDATE public.modelo_peca_teste_mini SET baixa_em = NULL, baixa_por = NULL, updated_at = now() WHERE tentativa_id = _tentativa;

  RETURN jsonb_build_object('estornadas', v_n);
END
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_mini_estornar(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._peca_teste_mini_tem_historico(_tentativa uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [urg r11d] a tentativa tem historico de baixa de peca teste em ALGUM dos 2 ledgers (etb peca_teste/estorno ou o ledger novo).
  SELECT EXISTS (SELECT 1 FROM public.estoque_tecido_baixas b WHERE b.peca_teste_tentativa_id = _tentativa)
      OR EXISTS (SELECT 1 FROM public.estoque_peca_teste_baixas b WHERE b.tentativa_id = _tentativa)
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_mini_tem_historico(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._peca_teste_mini_feita(_mo_linha_id uuid, _categoria_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [urg r11d] a tentativa ATUAL da trilha (maior numero; chave mo_linha_id x categoria_terceirizado_id, como _peca_teste_aprovada)
  -- tem baixa ATIVA (mini.baixa_em nao nulo). Trilha virtual/reprovada sem mini/baixa = false. Espelho TS miniExplosaoFeita.
  SELECT coalesce((SELECT m.baixa_em IS NOT NULL
                     FROM public.modelo_peca_teste_tentativas t
                     LEFT JOIN public.modelo_peca_teste_mini m ON m.tentativa_id = t.id
                    WHERE t.mo_linha_id = _mo_linha_id AND t.categoria_terceirizado_id = _categoria_id
                    ORDER BY t.numero DESC LIMIT 1), false)
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_mini_feita(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._peca_teste_mini_estoque_core(_tenant uuid, _modelo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_modo text;
  v_tecidos jsonb; v_aviamentos jsonb; v_insumos jsonb;
BEGIN
  -- [urg r11d] foto do estoque para a tela decidir a alocacao (Ruling 5/8/9). modo = modo_baixa_estoque. Tecidos: toda variante do
  -- BOM salvo, com vinculos (por prioridade) e FIFO (ordem do corte), saldo por saldo_oc_item_m. Aviamento/insumo: lidos DOS CORES
  -- (fisico); insumo casado por (etiqueta, tamanho, cores.nome) como o extrato.
  SELECT coalesce(modo_baixa_estoque, 'por_oc') INTO v_modo FROM public.tenant_config WHERE tenant_id = _tenant;
  v_modo := coalesce(v_modo, 'por_oc');

  -- tecidos: variantes distintas do BOM de tecido (tipo/numero/ordem/variante).
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'tipo', t.tipo, 'numero', t.numero, 'ordem', t.ordem, 'variante_tecido_id', t.vtid,
           'vinculos', coalesce(vl.js, '[]'::jsonb), 'fifo', coalesce(ff.js, '[]'::jsonb)) ORDER BY t.tipo, t.numero, t.ordem), '[]'::jsonb)
    INTO v_tecidos
    FROM (SELECT DISTINCT mt.tipo, mt.numero, ctv.ordem, ctv.variante_tecido_id AS vtid
            FROM public.modelo_tecidos mt
            JOIN public.modelo_tecido_variantes ctv ON ctv.modelo_tecido_id = mt.id
           WHERE mt.modelo_id = _modelo AND ctv.variante_tecido_id IS NOT NULL) t
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('oc_tecido_item_id', l.oc_tecido_item_id,
               'rotulo', coalesce(nullif(oc.rolo_codigo, ''), 'OC ' || coalesce(oc.numero_pedido, '')),
               'is_rolo', oc.is_rolo, 'prioridade', l.prioridade, 'quantidade_m', l.quantidade_m,
               'saldo', coalesce(s.saldo_m, 0)) ORDER BY l.prioridade, l.oc_tecido_item_id) AS js
        FROM public.modelo_tecido_oc_links l
        JOIN public.ocs_tecido_itens it ON it.id = l.oc_tecido_item_id
        JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
        CROSS JOIN LATERAL public.saldo_oc_item_m(l.oc_tecido_item_id) s
       WHERE l.modelo_id = _modelo AND l.tipo = t.tipo AND l.numero = t.numero AND l.ordem = t.ordem AND l.variante_tecido_id = t.vtid
    ) vl ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('oc_tecido_item_id', it.id,
               'rotulo', coalesce(nullif(oc.rolo_codigo, ''), 'OC ' || coalesce(oc.numero_pedido, '')),
               'is_rolo', oc.is_rolo, 'saldo', s.saldo_m) ORDER BY oc.data_entrega NULLS LAST, oc.created_at) AS js
        FROM public.ocs_tecido_itens it
        JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
        CROSS JOIN LATERAL public.saldo_oc_item_m(it.id) s
       WHERE oc.tenant_id = _tenant AND oc.status = 'recebido' AND it.variante_tecido_id = t.vtid AND s.saldo_m > 0
    ) ff ON true;

  -- aviamentos do BOM, com as variantes do aviamento e o fisico do core.
  SELECT coalesce(jsonb_agg(x.js ORDER BY x.aviamento_id), '[]'::jsonb) INTO v_aviamentos
    FROM (
      SELECT ma.aviamento_id,
             jsonb_build_object('aviamento_id', ma.aviamento_id, 'variantes', coalesce((
               SELECT jsonb_agg(jsonb_build_object('variante_aviamento_id', c.variante_id, 'rotulo', c.variante_nome,
                        'cor_id', (SELECT va.cor_id FROM public.variantes_aviamento va WHERE va.id = c.variante_id),
                        'fisico', c.fisico) ORDER BY c.variante_nome)
                 FROM public._estoque_aviamento_core(_tenant) c WHERE c.id = ma.aviamento_id), '[]'::jsonb)) AS js
        FROM (SELECT DISTINCT aviamento_id FROM public.modelo_aviamentos WHERE modelo_id = _modelo) ma
    ) x;

  -- insumos do BOM, com o fisico do core por (etiqueta, tamanho_bucket, cor_id).
  SELECT coalesce(jsonb_agg(jsonb_build_object('etiqueta_id', i.etiqueta_id, 'tamanho', i.tam, 'cor_id', i.cor_id,
           'fisico', coalesce((SELECT sum(c.fisico) FROM public._estoque_etiqueta_core(_tenant) c
                                WHERE c.etiqueta_id = i.etiqueta_id AND c.tamanho IS NOT DISTINCT FROM i.tam
                                  AND c.cor_nome IS NOT DISTINCT FROM (SELECT nome FROM public.cores WHERE id = i.cor_id)), 0))
           ORDER BY i.etiqueta_id, i.cor_id), '[]'::jsonb) INTO v_insumos
    FROM (SELECT DISTINCT me.etiqueta_id, me.cor_id,
                 public._peca_teste_insumo_tam_bucket(me.etiqueta_id, NULL) AS tam  -- tamanho escolhido so na baixa; aqui bucket NULL (geral)
            FROM public.modelo_etiquetas me WHERE me.modelo_id = _modelo) i;

  RETURN jsonb_build_object('modo', v_modo, 'tecidos', v_tecidos, 'aviamentos', v_aviamentos, 'insumos', v_insumos);
END
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_mini_estoque_core(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.peca_teste_mini_estoque(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_modelo_tenant uuid;
BEGIN
  -- [urg r11d] leitura do estoque da mini (Ruling 11): modulo Criacao; sem VER peca_teste OU loja sem Entrada e Saida -> NULL;
  -- card de outra loja -> NULL. O _core faz a conta (REVOKE dos 3).
  PERFORM public._exige_modulos('criacao');
  IF NOT public.user_can_view('criacao_planejamento:peca_teste') THEN RETURN NULL; END IF;
  v_tenant := public.get_user_tenant_id();
  IF NOT public._tenant_modulo_ligado(v_tenant, 'entrada_saida') THEN RETURN NULL; END IF;
  SELECT tenant_id INTO v_modelo_tenant FROM public.modelos WHERE id = _modelo_id;
  IF v_modelo_tenant IS NULL OR v_modelo_tenant <> v_tenant THEN RETURN NULL; END IF;
  RETURN public._peca_teste_mini_estoque_core(v_tenant, _modelo_id);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.peca_teste_mini_estoque(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peca_teste_mini_estoque(uuid) TO authenticated;

-- 2) funcoes EXISTENTES redefinidas (troca exata sobre o texto de ANTES)
DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._peca_teste_variante_aviamento_padrao(uuid,uuid,uuid)', '5dae1386c608628edcd6f8362ba996e7', '5dae1386c608628edcd6f8362ba996e7', false),
      ('public._peca_teste_insumo_tam_bucket(uuid,text)', 'cabea631702567f1e3a5199e8a272746', 'cabea631702567f1e3a5199e8a272746', false),
      ('public._peca_teste_mini_linhas(uuid,text,uuid,jsonb)', '3d73d0db8fc0902c5bd07edfbfa2fe70', '3d73d0db8fc0902c5bd07edfbfa2fe70', false),
      ('public._peca_teste_tecido_baixar(uuid,uuid,uuid,text,integer,integer,uuid,numeric,boolean,uuid,text)', 'e03a4d616e7ae297386a5e0e6bb83ff7', 'e03a4d616e7ae297386a5e0e6bb83ff7', false),
      ('public._peca_teste_mini_baixar(uuid,jsonb)', '444861eae9b28bc09ec3bfd80bc01033', '444861eae9b28bc09ec3bfd80bc01033', false),
      ('public._peca_teste_mini_estornar(uuid)', 'c8f160a73b3a30a6105c7a45aff9c89d', 'c8f160a73b3a30a6105c7a45aff9c89d', false),
      ('public._peca_teste_mini_tem_historico(uuid)', '10c05fae5041077c6dc23436d66f7d44', '10c05fae5041077c6dc23436d66f7d44', false),
      ('public._peca_teste_mini_feita(uuid,uuid)', 'f81421e9b3aa27f34ab426f6b0783f96', 'f81421e9b3aa27f34ab426f6b0783f96', false),
      ('public._peca_teste_mini_estoque_core(uuid,uuid)', '2a3527c28b3486d5f86587d9af169f72', '2a3527c28b3486d5f86587d9af169f72', false),
      ('public.peca_teste_mini_estoque(uuid)', '8a1d492a40993a582b7978080a1fff2d', 'a94ba498dee379436f45577f790a5b8d', true)
    ) AS x(f, d, n, w) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 'urg_r11d: pos-condicao falhou em % (nova; md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.d USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND p.prosecdef
                     AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public'
                     AND coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(p.proacl) x), '') = CASE WHEN r.w AND true THEN 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres' ELSE 'postgres=X/postgres,service_role=X/postgres' END)
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM (r.w AND true)
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r11d: pos-condicao falhou na ACL/secdef/search_path de % (nova)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
