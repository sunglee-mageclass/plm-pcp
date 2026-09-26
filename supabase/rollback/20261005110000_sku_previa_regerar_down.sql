-- INVERSO da 20261005110000_sku_previa_regerar.sql (SKU em prévia). ARQUIVO GERADO (gerar_sql.py) — NÃO editar à mão.
-- Só com OK do dono e DEPOIS de tirar do ar o front que chama skus_previa/aplicar_skus_modelo. NÃO apaga dado: os SKUs
-- gravados ficam. Ordem: encoding → BEGIN/travas → guarda → as 3 do SKU voltam ao texto vivo de 25/set byte a byte (com o
-- REVOKE reafirmado) → DROP das 9 funções novas → $acl$ → $pos$ (3 = o vivo; 9 ausentes) → NOTIFY → COMMIT. Idempotente.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regclass('public.modelo_skus') IS NULL OR to_regprocedure('public._titulo_pagina_calculado(text,text)') IS NULL THEN
    RAISE EXCEPTION 'sku_previa: falta a F3.5a (modelo_skus) ou a reorganização do Sheet (20261005100000) neste banco' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._skus_modelo_calc(uuid)') IS NULL THEN
    RAISE EXCEPTION 'sku_previa: _skus_modelo_calc não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_modelo_calc(uuid)')));
  IF v_md5 NOT IN ('56c3c48067e07b4cfbcdcf0dccdb5ae6', '34d27675526dbed96ca6d514e9665771') THEN
    RAISE EXCEPTION 'sku_previa: _skus_modelo_calc não está nem no texto vivo de 25/set nem no desta migration (md5 %) — outra frente mudou; regenerar a migration (plano, Task 2) antes de aplicar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._skus_modelo_core(uuid)') IS NULL THEN
    RAISE EXCEPTION 'sku_previa: _skus_modelo_core não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_modelo_core(uuid)')));
  IF v_md5 NOT IN ('f77fddb7bbfab7025b5f5f5007ede931', '11c269afdbeb9c88757d5464b63abb3c') THEN
    RAISE EXCEPTION 'sku_previa: _skus_modelo_core não está nem no texto vivo de 25/set nem no desta migration (md5 %) — outra frente mudou; regenerar a migration (plano, Task 2) antes de aplicar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._gerar_skus_modelo_core(uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'sku_previa: _gerar_skus_modelo_core não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._gerar_skus_modelo_core(uuid,boolean)')));
  IF v_md5 NOT IN ('5f523d3dabda04bcda684ddf2cac0459', '25689bd9d29fe6192870b5cfacf254ce') THEN
    RAISE EXCEPTION 'sku_previa: _gerar_skus_modelo_core não está nem no texto vivo de 25/set nem no desta migration (md5 %) — outra frente mudou; regenerar a migration (plano, Task 2) antes de aplicar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._skus_assinatura(jsonb)') IS NOT NULL THEN
    v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_assinatura(jsonb)')));
    IF v_md5 <> '88421a3100449a4b74d0c41c25f7bc57' THEN
      RAISE EXCEPTION 'sku_previa: _skus_assinatura já existe com outro texto (md5 %) — PARE e avise o controlador', v_md5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF to_regprocedure('public._skus_calc_ref_tipo(uuid,text,text)') IS NOT NULL THEN
    v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_calc_ref_tipo(uuid,text,text)')));
    IF v_md5 <> 'ff2e575909f83fc0355fe20a049fd906' THEN
      RAISE EXCEPTION 'sku_previa: _skus_calc_ref_tipo já existe com outro texto (md5 %) — PARE e avise o controlador', v_md5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF to_regprocedure('public._skus_matriz_ref_tipo(uuid,text,text)') IS NOT NULL THEN
    v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_matriz_ref_tipo(uuid,text,text)')));
    IF v_md5 <> 'f98ac370c499c823cb23bdb2b271f145' THEN
      RAISE EXCEPTION 'sku_previa: _skus_matriz_ref_tipo já existe com outro texto (md5 %) — PARE e avise o controlador', v_md5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF to_regprocedure('public._skus_plano(uuid,text,text,jsonb,text)') IS NOT NULL THEN
    v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_plano(uuid,text,text,jsonb,text)')));
    IF v_md5 <> 'cb24674981bb1097e1dbd7698fdee6e3' THEN
      RAISE EXCEPTION 'sku_previa: _skus_plano já existe com outro texto (md5 %) — PARE e avise o controlador', v_md5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF to_regprocedure('public._skus_executar_plano(uuid,uuid,jsonb,boolean)') IS NOT NULL THEN
    v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_executar_plano(uuid,uuid,jsonb,boolean)')));
    IF v_md5 <> '8dd67dd676fac312cfc3c73459342427' THEN
      RAISE EXCEPTION 'sku_previa: _skus_executar_plano já existe com outro texto (md5 %) — PARE e avise o controlador', v_md5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF to_regprocedure('public._skus_previa_core(uuid,text,text,jsonb,text)') IS NOT NULL THEN
    v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_previa_core(uuid,text,text,jsonb,text)')));
    IF v_md5 <> 'f2e513e6f1b6754c968d98b2ee0ea7c1' THEN
      RAISE EXCEPTION 'sku_previa: _skus_previa_core já existe com outro texto (md5 %) — PARE e avise o controlador', v_md5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF to_regprocedure('public._aplicar_skus_modelo_core(uuid,jsonb,text,text)') IS NOT NULL THEN
    v_md5 := md5(pg_get_functiondef(to_regprocedure('public._aplicar_skus_modelo_core(uuid,jsonb,text,text)')));
    IF v_md5 <> '670793ce00dc20234ccecc23f9c4aede' THEN
      RAISE EXCEPTION 'sku_previa: _aplicar_skus_modelo_core já existe com outro texto (md5 %) — PARE e avise o controlador', v_md5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF to_regprocedure('public.skus_previa(uuid,text,text,jsonb,text)') IS NOT NULL THEN
    v_md5 := md5(pg_get_functiondef(to_regprocedure('public.skus_previa(uuid,text,text,jsonb,text)')));
    IF v_md5 <> 'e5d6ba64d40b088c02a6e00f85f27870' THEN
      RAISE EXCEPTION 'sku_previa: skus_previa já existe com outro texto (md5 %) — PARE e avise o controlador', v_md5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF to_regprocedure('public.aplicar_skus_modelo(uuid,jsonb,text,text)') IS NOT NULL THEN
    v_md5 := md5(pg_get_functiondef(to_regprocedure('public.aplicar_skus_modelo(uuid,jsonb,text,text)')));
    IF v_md5 <> '155420b1e203424069c08185a36f0fcc' THEN
      RAISE EXCEPTION 'sku_previa: aplicar_skus_modelo já existe com outro texto (md5 %) — PARE e avise o controlador', v_md5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._skus_modelo_calc(_modelo_id uuid)
 RETURNS TABLE(variante_key uuid, variante_ordem integer, cor_nome text, apelido_nome text, tamanho_key text, tamanho_ordem integer, sku text, faltas jsonb, avisos jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH m AS (
    SELECT mo.id AS mid,
           mo.ref AS mref,
           coalesce(mo.origem, 'interno') AS morigem,
           -- F3.6 (dono 25/set): SÓ o "Tamanho em" do card, sem padrão da loja. NULL (sem escolha) nunca vira SKU
           -- gravado: o core devolve 'sem_tamanho' e a geração não roda (_sku_tamanho_lado(_, NULL) cairia na letra).
           mo.tamanho_tipo AS mtipo,
           tc.sku_config AS mcfg,
           tc.tamanhos_sku AS mtsku,
           CASE WHEN jsonb_typeof(tc.tamanhos_grade) = 'array' THEN tc.tamanhos_grade ELSE '[]'::jsonb END AS mgrade
      FROM public.modelos mo
      LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
     WHERE mo.id = _modelo_id
  ),
  va AS (
    SELECT public._sku_variante_key(vt.cor_id, vt.cor_apelido_id) AS vkey, mtv.ordem AS vordem,
           vt.cor_id AS vcor, vt.cor_apelido_id AS vapelido
      FROM m
      JOIN public.modelo_tecidos mt ON mt.modelo_id = m.mid AND mt.tipo = 'tecido' AND mt.numero = 1
      JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = mt.id
      JOIN public.variantes_tecido vt ON vt.id = mtv.variante_tecido_id
     WHERE m.morigem = 'interno'
    UNION ALL
    SELECT public._sku_variante_key(pv.cor_id, pv.cor_apelido_id), pv.ordem, pv.cor_id, pv.cor_apelido_id
      FROM m
      JOIN public.produtos_acabados pa ON pa.modelo_id = m.mid
      JOIN public.produto_acabado_variantes pv ON pv.produto_acabado_id = pa.id
     WHERE m.morigem = 'revenda'
    UNION ALL
    SELECT public._sku_variante_key(iv.cor_id, iv.cor_apelido_id), iv.ordem, iv.cor_id, iv.cor_apelido_id
      FROM m
      JOIN public.produtos_importados pi ON pi.modelo_id = m.mid
      JOIN public.produto_importado_variantes iv ON iv.produto_importado_id = pi.id
     WHERE m.morigem = 'importado'
  ),
  vs AS (
    SELECT DISTINCT ON (va.vkey) va.vkey, va.vordem, va.vcor, va.vapelido
      FROM va
     ORDER BY va.vkey, va.vordem
  ),
  tam AS (
    SELECT va.vkey AS tvkey, e.key AS tkey
      FROM va
      JOIN public.modelo_grades g ON g.modelo_id = _modelo_id AND g.variante_numero = va.vordem
      CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(g.grades) = 'object' THEN g.grades ELSE '{}'::jsonb END) AS e
     GROUP BY va.vkey, e.key
    HAVING sum(CASE
                 WHEN jsonb_typeof(e.value) = 'number' THEN (e.value #>> '{}')::numeric
                 WHEN jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$'
                   THEN btrim(e.value #>> '{}')::numeric
                 ELSE 0
               END) > 0
  )
  SELECT vs.vkey,
         vs.vordem,
         c.nome::text,
         a.nome::text,
         tam.tkey,
         coalesce((SELECT o.n::integer
                     FROM jsonb_array_elements_text(m.mgrade) WITH ORDINALITY AS o(t, n)
                    WHERE o.t = tam.tkey
                    ORDER BY o.n
                    LIMIT 1), 9999),
         r.res ->> 'sku',
         r.res -> 'faltas',
         r.res -> 'avisos'
    FROM m
    JOIN vs ON true
    JOIN tam ON tam.tvkey = vs.vkey
    LEFT JOIN public.cores c ON c.id = vs.vcor
    LEFT JOIN public.cores_apelido a ON a.id = vs.vapelido
    CROSS JOIN LATERAL (
      SELECT public._sku_resolver(
               m.mcfg,
               m.mref,
               CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id', c.id, 'nome', c.nome, 'sigla', c.sigla_sku) END,
               CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id', a.id, 'nome', a.nome, 'sigla', a.sigla_sku) END,
               tam.tkey,
               m.mtipo,
               m.mtsku) AS res
    ) AS r;
END
$function$;

CREATE OR REPLACE FUNCTION public._skus_modelo_core(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_refn text;
  v_cfg jsonb;
  v_tipo_card text;
  v_tipo text;
  v_status text;
  v_linhas jsonb;
  v_faltas jsonb;
  v_avisos jsonb;
BEGIN
  SELECT mo.tenant_id, public._sku_norm_ref(mo.ref), tc.sku_config, mo.tamanho_tipo
    INTO v_tenant, v_refn, v_cfg, v_tipo_card
    FROM public.modelos mo
    LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
   WHERE mo.id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  v_tipo := v_tipo_card;  -- F3.6 (dono 25/set): sem padrão da loja — NULL = o card ainda não escolheu
  v_status := CASE WHEN v_cfg IS NULL THEN 'sem_formato' WHEN v_refn = '' THEN 'aguardando_ref'
                   WHEN v_tipo IS NULL THEN 'sem_tamanho' ELSE 'ok' END;

  IF v_status <> 'ok' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'variante_key', s.variante_key, 'tamanho_key', s.tamanho_key, 'sku', s.sku,
             'manual', s.manual, 'rev', s.rev, 'estado', CASE WHEN s.manual THEN 'manual' ELSE 'salvo' END)
             ORDER BY s.variante_key, s.tamanho_key), '[]'::jsonb)
      INTO v_linhas
      FROM public.modelo_skus s
     WHERE s.modelo_id = _modelo_id;
    RETURN jsonb_build_object('status', v_status, 'tamanho_tipo', v_tipo, 'tamanho_tipo_card', v_tipo_card,
                              'linhas', v_linhas, 'faltas', '[]'::jsonb, 'avisos', '[]'::jsonb);
  END IF;

  WITH c AS (
    SELECT * FROM public._skus_modelo_calc(_modelo_id)
  ), s AS (
    SELECT sk.id, sk.variante_key, sk.tamanho_key, sk.sku, sk.manual, sk.rev
      FROM public.modelo_skus sk
     WHERE sk.modelo_id = _modelo_id
  ), j AS (
    SELECT c.variante_key AS c_vkey, s.variante_key AS s_vkey, c.variante_ordem AS vordem, c.cor_nome, c.apelido_nome,
           coalesce(c.tamanho_key, s.tamanho_key) AS tkey, c.tamanho_ordem AS tordem, c.sku AS previsto,
           coalesce(c.faltas, '[]'::jsonb) AS faltas, coalesce(c.avisos, '[]'::jsonb) AS avisos, s.id AS sid, s.sku AS salvo, s.manual, s.rev
      FROM c
      FULL JOIN s ON s.variante_key = c.variante_key AND s.tamanho_key = c.tamanho_key
  ), k AS (
    SELECT j.*,
           -- o SKU GRAVADO divide com outra linha que não é réplica (REF viva) — ex.: a REF de um card mudou (R2-a)
           (SELECT jsonb_build_object('modelo_id', o.modelo_id, 'nome', mo.nome, 'ref', mo.ref)
              FROM public.modelo_skus o
              JOIN public.modelos mo ON mo.id = o.modelo_id
             WHERE o.tenant_id = v_tenant AND o.sku = j.salvo AND o.id <> j.sid
               AND NOT (o.modelo_id <> _modelo_id AND public._sku_norm_ref(mo.ref) = v_refn
                        AND o.variante_key = coalesce(j.c_vkey, j.s_vkey) AND o.tamanho_key = j.tkey)
             ORDER BY (o.modelo_id = _modelo_id) DESC, o.modelo_id
             LIMIT 1) AS conflito_salvo,
           -- o SKU PREVISTO (o que a geração gravaria) já é de outra linha que não é réplica
           (SELECT jsonb_build_object('modelo_id', o.modelo_id, 'nome', mo.nome, 'ref', mo.ref)
              FROM public.modelo_skus o
              JOIN public.modelos mo ON mo.id = o.modelo_id
             WHERE o.tenant_id = v_tenant AND o.sku = j.previsto AND o.id IS DISTINCT FROM j.sid
               AND NOT (o.modelo_id <> _modelo_id AND public._sku_norm_ref(mo.ref) = v_refn
                        AND o.variante_key = j.c_vkey AND o.tamanho_key = j.tkey)
             ORDER BY (o.modelo_id = _modelo_id) DESC, o.modelo_id
             LIMIT 1) AS conflito_prev
      FROM j
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'variante_key', coalesce(k.c_vkey, k.s_vkey), 'variante_ordem', k.vordem,
           'cor_nome', k.cor_nome, 'apelido_nome', k.apelido_nome,
           'tamanho_key', k.tkey, 'tamanho_ordem', k.tordem,
           'id', k.sid, 'sku', k.salvo, 'manual', coalesce(k.manual, false), 'rev', k.rev,
           'sku_previsto', k.previsto, 'faltas', k.faltas, 'avisos', k.avisos,
           'conflito_com', coalesce(k.conflito_salvo, k.conflito_prev),
           'estado', CASE
             WHEN k.c_vkey IS NULL THEN 'orfa'
             WHEN k.conflito_salvo IS NOT NULL THEN 'conflito'
             WHEN k.manual IS TRUE THEN 'manual'
             WHEN jsonb_array_length(k.faltas) > 0 THEN 'falta'
             WHEN k.previsto IS NULL THEN 'vazio'
             WHEN k.salvo = k.previsto THEN 'ok'
             WHEN k.conflito_prev IS NOT NULL THEN 'conflito'
             WHEN k.salvo IS NULL THEN 'pendente'
             ELSE 'divergente'
           END)
           ORDER BY k.vordem NULLS LAST, k.tordem NULLS LAST, k.tkey), '[]'::jsonb)
    INTO v_linhas
    FROM k;

  SELECT coalesce(jsonb_agg(DISTINCT f.value ORDER BY f.value), '[]'::jsonb)
    INTO v_faltas
    FROM jsonb_array_elements(v_linhas) AS l(value)
    CROSS JOIN LATERAL jsonb_array_elements(l.value -> 'faltas') AS f(value)
   WHERE l.value ->> 'estado' = 'falta';

  SELECT coalesce(jsonb_agg(DISTINCT a.value ORDER BY a.value), '[]'::jsonb)
    INTO v_avisos
    FROM jsonb_array_elements(v_linhas) AS l(value)
    CROSS JOIN LATERAL jsonb_array_elements(l.value -> 'avisos') AS a(value);

  RETURN jsonb_build_object('status', v_status, 'tamanho_tipo', v_tipo, 'tamanho_tipo_card', v_tipo_card,
                            'linhas', v_linhas, 'faltas', v_faltas, 'avisos', v_avisos);
END
$function$;

CREATE OR REPLACE FUNCTION public._gerar_skus_modelo_core(_modelo_id uuid, _regerar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_tenant uuid;
  v_refn text;
  v_cfg jsonb;
  v_tipo_card text;
  l record;
  v_id uuid;
  v_sku text;
  v_manual boolean;
  v_criados integer := 0;
  v_atualizados integer := 0;
  v_removidos integer := 0;
  v_conflitos jsonb := '[]'::jsonb;
  v_com_modelo uuid;
  v_com_nome text;
  v_com_ref text;
  v_com_vkey uuid;
  v_com_tkey text;
  v_com_sku_atual text;
  v_com_sku_novo text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.modelos mo WHERE mo.id = _modelo_id) THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  -- Uma geração/edição por modelo de cada vez (duas abas/pessoas no mesmo card esperam em fila). 1ª trava da ordem
  -- única (sku_modelo → linha → sku_unico): a edição à mão pega a MESMA antes de travar a linha — sem deadlock.
  -- Trava com o MÍNIMO (só _modelo_id, igual _salvar_sku_manual_core); REF e Formato só são lidos DEPOIS da trava,
  -- já sob a garantia de que ninguém mais gera/edita este modelo ao mesmo tempo.
  PERFORM pg_advisory_xact_lock(hashtextextended('sku_modelo:' || _modelo_id::text, 0));

  SELECT mo.tenant_id, public._sku_norm_ref(mo.ref), tc.sku_config, mo.tamanho_tipo
    INTO v_tenant, v_refn, v_cfg, v_tipo_card
    FROM public.modelos mo
    LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
   WHERE mo.id = _modelo_id;

  -- F3.6 (dono 25/set): sem "Tamanho em" no card não gera (a matriz diz 'sem_tamanho'); lido DEPOIS da trava.
  IF v_cfg IS NOT NULL AND v_refn <> '' AND v_tipo_card IS NOT NULL THEN
    IF _regerar THEN
      -- Automáticas que saíram da grade (variante/cor removida, tamanho zerado) saem ANTES de gerar. Manual: nunca.
      DELETE FROM public.modelo_skus s
       WHERE s.modelo_id = _modelo_id
         AND NOT s.manual
         AND (s.variante_key, s.tamanho_key) NOT IN (
               SELECT c.variante_key, c.tamanho_key FROM public._skus_modelo_calc(_modelo_id) AS c);
      GET DIAGNOSTICS v_removidos = ROW_COUNT;
    END IF;

    FOR l IN SELECT c.variante_key, c.tamanho_key, c.sku
               FROM public._skus_modelo_calc(_modelo_id) AS c
              ORDER BY c.variante_ordem, c.tamanho_ordem, c.tamanho_key LOOP
      v_id := NULL;
      v_sku := NULL;
      v_manual := NULL;
      SELECT s.id, s.sku, s.manual INTO v_id, v_sku, v_manual
        FROM public.modelo_skus s
       WHERE s.modelo_id = _modelo_id AND s.variante_key = l.variante_key AND s.tamanho_key = l.tamanho_key;
      CONTINUE WHEN v_manual IS TRUE;                                          -- editado à mão: nunca (Q2)
      CONTINUE WHEN l.sku IS NULL;                                             -- falta sigla (Q4) / vazio
      CONTINUE WHEN v_id IS NOT NULL AND (NOT _regerar OR v_sku = l.sku);      -- fixo (Q2) ou já igual
      BEGIN
        IF v_id IS NULL THEN
          INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual, gerado_em)
          VALUES (v_tenant, _modelo_id, l.variante_key, l.tamanho_key, l.sku, false, now());
          v_criados := v_criados + 1;
        ELSE
          UPDATE public.modelo_skus SET sku = l.sku, gerado_em = now(), rev = rev + 1 WHERE id = v_id;
          v_atualizados := v_atualizados + 1;
        END IF;
      EXCEPTION WHEN unique_violation THEN
        v_com_modelo := NULL;
        v_com_nome := NULL;
        v_com_ref := NULL;
        v_com_vkey := NULL;
        v_com_tkey := NULL;
        v_com_sku_atual := NULL;
        v_com_sku_novo := NULL;
        SELECT o.modelo_id, mo.nome, mo.ref, o.variante_key, o.tamanho_key, o.sku
          INTO v_com_modelo, v_com_nome, v_com_ref, v_com_vkey, v_com_tkey, v_com_sku_atual
          FROM public.modelo_skus o
          JOIN public.modelos mo ON mo.id = o.modelo_id
         WHERE o.tenant_id = v_tenant AND o.sku = l.sku
           AND NOT (o.modelo_id <> _modelo_id AND public._sku_norm_ref(mo.ref) = v_refn
                    AND o.variante_key = l.variante_key AND o.tamanho_key = l.tamanho_key)
         ORDER BY (o.modelo_id = _modelo_id) DESC, o.modelo_id
         LIMIT 1;
        -- Caso especial (troca de siglas A↔B no mesmo produto): a linha conflitante é OUTRA linha deste
        -- MESMO card que também vai mudar de SKU neste Regerar (ela ainda não passou pelo loop, ou o SKU
        -- novo dela é diferente do que está gravado hoje). Não são "duas linhas com o mesmo SKU" — é a
        -- ORDEM do Regerar que ainda não trocou a outra; a regra de unicidade continua barrando a troca
        -- (fica para a F3.5b), mas o texto não deve afirmar uma colisão de configuração que não existe.
        IF v_com_modelo = _modelo_id THEN
          SELECT c.sku INTO v_com_sku_novo
            FROM public._skus_modelo_calc(_modelo_id) AS c
           WHERE c.variante_key = v_com_vkey AND c.tamanho_key = v_com_tkey;
        END IF;
        v_conflitos := v_conflitos || jsonb_build_array(jsonb_build_object(
          'variante_key', l.variante_key, 'tamanho_key', l.tamanho_key, 'sku', l.sku,
          'com_modelo_id', v_com_modelo, 'com_nome', v_com_nome, 'com_ref', v_com_ref,
          'mensagem', CASE
            WHEN v_com_modelo IS NULL THEN
              format('SKU %s não gravado: outra pessoa gravou esta linha agora. Gere de novo.', l.sku)
            WHEN v_com_modelo = _modelo_id AND v_com_sku_novo IS NOT NULL AND v_com_sku_novo IS DISTINCT FROM v_com_sku_atual THEN
              format('SKU %s não gravado: esta linha colide com outra deste produto que também muda de SKU neste Regerar. Ajuste um SKU à mão e rode o Regerar de novo.', l.sku)
            WHEN v_com_modelo = _modelo_id THEN
              format('SKU %s repetido neste produto: duas linhas dão o mesmo SKU. Mude uma sigla ou edite um deles à mão.', l.sku)
            ELSE
              format('SKU %s já existe em %s (REF %s). Edite este SKU à mão ou mude a sigla.', l.sku,
                     coalesce(v_com_nome, 'outro produto'), coalesce(nullif(btrim(v_com_ref), ''), '—'))
          END));
      END;
    END LOOP;
  END IF;

  RETURN public._skus_modelo_core(_modelo_id)
      || jsonb_build_object('criados', v_criados, 'atualizados', v_atualizados, 'removidos', v_removidos,
                            'conflitos', v_conflitos);
END
$function$;

REVOKE EXECUTE ON FUNCTION
  public._skus_modelo_calc(uuid),
  public._skus_modelo_core(uuid),
  public._gerar_skus_modelo_core(uuid, boolean)
  FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.skus_previa(uuid, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.aplicar_skus_modelo(uuid, jsonb, text, text);
DROP FUNCTION IF EXISTS public._skus_assinatura(jsonb);
DROP FUNCTION IF EXISTS public._skus_calc_ref_tipo(uuid, text, text);
DROP FUNCTION IF EXISTS public._skus_matriz_ref_tipo(uuid, text, text);
DROP FUNCTION IF EXISTS public._skus_plano(uuid, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public._skus_executar_plano(uuid, uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public._skus_previa_core(uuid, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public._aplicar_skus_modelo_core(uuid, jsonb, text, text);

DO $acl$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['public._skus_modelo_calc(uuid)', 'public._skus_modelo_core(uuid)', 'public._gerar_skus_modelo_core(uuid,boolean)']) AS f(x) CROSS JOIN (VALUES ('public'), ('anon'), ('authenticated')) AS r(y)
              WHERE has_function_privilege(r.y, to_regprocedure(f.x), 'EXECUTE')) THEN
    RAISE EXCEPTION 'sku_previa: ACL fora do padrão — interna executável por PUBLIC/anon/authenticated ou RPC fora de authenticated (invariante #9)' USING ERRCODE = 'P0001';
  END IF;
END
$acl$;

DO $pos$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_modelo_calc(uuid)')));
  IF v_md5 IS DISTINCT FROM '56c3c48067e07b4cfbcdcf0dccdb5ae6' THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_modelo_calc não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_modelo_core(uuid)')));
  IF v_md5 IS DISTINCT FROM 'f77fddb7bbfab7025b5f5f5007ede931' THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_modelo_core não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._gerar_skus_modelo_core(uuid,boolean)')));
  IF v_md5 IS DISTINCT FROM '5f523d3dabda04bcda684ddf2cac0459' THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _gerar_skus_modelo_core não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._skus_assinatura(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_assinatura ainda existe — desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._skus_calc_ref_tipo(uuid,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_calc_ref_tipo ainda existe — desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._skus_matriz_ref_tipo(uuid,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_matriz_ref_tipo ainda existe — desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._skus_plano(uuid,text,text,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_plano ainda existe — desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._skus_executar_plano(uuid,uuid,jsonb,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_executar_plano ainda existe — desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._skus_previa_core(uuid,text,text,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_previa_core ainda existe — desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._aplicar_skus_modelo_core(uuid,jsonb,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _aplicar_skus_modelo_core ainda existe — desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.skus_previa(uuid,text,text,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — skus_previa ainda existe — desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.aplicar_skus_modelo(uuid,jsonb,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — aplicar_skus_modelo ainda existe — desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
