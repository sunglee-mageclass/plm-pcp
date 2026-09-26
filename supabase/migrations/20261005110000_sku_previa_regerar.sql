-- SKU em PRÉVIA (P-46/P-47 A do dono, 25/set) — o "Regerar SKUs" e o SKU à mão da seção "4. Códigos" viram PRÉVIA no
-- rascunho e só gravam no Salvar do card. Spec: docs/superpowers/specs/2026-09-25-sku-previa-regerar-design.md (§4.1).
-- Plano: docs/superpowers/plans/2026-09-25-sku-previa-regerar.md (Task 2). ARQUIVO GERADO por
-- .superpowers/sku-previa/mig/gerar_sql.py a partir do texto VIVO (cópia = produção em 25/set) — NÃO editar à mão.
--  0. guarda: F3.5a + reorganização no banco; md5 EXATO das 3 redefinidas (vivo de 25/set OU o desta migration); as 9
--     novas ausentes OU no texto desta migration (reaplicação);
--  1. 9 funções NOVAS: _skus_assinatura (IMMUTABLE), _skus_calc_ref_tipo/_skus_matriz_ref_tipo (o texto vivo de
--     _skus_modelo_calc/_skus_modelo_core com SÓ as âncoras trocadas: REF e "Tamanho em" por PARÂMETRO), _skus_plano (a
--     DECISÃO, pura — o laço da F3.5a em memória), _skus_executar_plano (a ÚNICA escrita), _skus_previa_core,
--     _aplicar_skus_modelo_core e as RPCs skus_previa (STABLE — só leitura) e aplicar_skus_modelo (grava a prévia vista:
--     assinatura antes E depois);
--  2. 3 REDEFINIDAS (mesma assinatura/retorno/volatilidade; CREATE OR REPLACE preserva o proacl): _skus_modelo_calc e
--     _skus_modelo_core viram delegadoras (com os SALVOS do card — mesmo resultado); _gerar_skus_modelo_core = trava →
--     REF/"Tamanho em" lidos UMA vez → plano → executor (mesmo resultado; fecha a corrida B-M8);
--  3. ACL (#9): internas REVOKE dos TRÊS; RPCs REVOKE PUBLIC/anon + GRANT authenticated; $acl$ confere;
--  4. $pos$: md5 das 12 = o esperado, senão desfaz tudo (ex.: client_encoding).
-- SÓ FUNÇÕES: nenhuma DDL de tabela nem de policy (sem ACCESS EXCLUSIVE em tabela; o hook supautils.policy_grants não
-- dispara). Contagens (funções|gatilhos): +9 | +0. Aplicar SÓ pelo .superpowers/sku-previa/mig/ida-producao.sh (pré-voo +
-- backup) — não psql -f solto. Inverso: supabase/rollback/20261005110000_sku_previa_regerar_down.sql (não apaga dado).
-- LIFO: voltar a reorganização (20261005100000) ou a F3.5a depois desta exige voltar ESTA antes.
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
    IF v_md5 <> 'd81a8266cb41fe8709f52f6e9d5ad522' THEN
      RAISE EXCEPTION 'sku_previa: _skus_plano já existe com outro texto (md5 %) — PARE e avise o controlador', v_md5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF to_regprocedure('public._skus_executar_plano(uuid,uuid,jsonb,boolean)') IS NOT NULL THEN
    v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_executar_plano(uuid,uuid,jsonb,boolean)')));
    IF v_md5 <> '033544145bb52651fdd24733bdd7e412' THEN
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

CREATE OR REPLACE FUNCTION public._skus_assinatura(_linhas jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.1): assinatura do estado FINAL dos SKUs de um card —
  -- [[variante_key, tamanho_key, sku, manual], ...] em ordem canônica (COLLATE "C": independe do locale do banco). A MESMA
  -- função assina a prévia (_skus_plano) e confere o que foi gravado (_aplicar_skus_modelo_core).
  SELECT md5(coalesce((SELECT jsonb_agg(x.value ORDER BY (x.value ->> 0) COLLATE "C", (x.value ->> 1) COLLATE "C")
                         FROM jsonb_array_elements(coalesce(_linhas, '[]'::jsonb)) AS x(value)), '[]'::jsonb)::text)
$function$;

CREATE OR REPLACE FUNCTION public._skus_calc_ref_tipo(_modelo_id uuid, _ref text, _tipo text)
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
           _ref AS mref,  -- SKU em prévia: a REF por parâmetro (a do rascunho na prévia; a SALVA, lida sob a trava, na gravação)
           coalesce(mo.origem, 'interno') AS morigem,
           -- F3.6 (dono 25/set): SÓ o "Tamanho em" do card, sem padrão da loja. NULL (sem escolha) nunca vira SKU
           -- gravado: o core devolve 'sem_tamanho' e a geração não roda (_sku_tamanho_lado(_, NULL) cairia na letra).
           _tipo AS mtipo,  -- SKU em prévia: o "Tamanho em" por parâmetro (idem)
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

CREATE OR REPLACE FUNCTION public._skus_matriz_ref_tipo(_modelo_id uuid, _ref text, _tipo text)
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
  SELECT mo.tenant_id, public._sku_norm_ref(_ref), tc.sku_config, _tipo  -- SKU em prévia: REF e "Tamanho em" por parâmetro
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
    SELECT * FROM public._skus_calc_ref_tipo(_modelo_id, _ref, _tipo)
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

CREATE OR REPLACE FUNCTION public._skus_plano(_modelo_id uuid, _ref text, _tipo text, _manuais jsonb, _modo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.2) — o PLANO da gravação dos SKUs de UM card. PURO (STABLE: o
-- PL/pgSQL recusa INSERT/UPDATE/DELETE aqui). Fonte ÚNICA da decisão: a prévia (skus_previa) roda este plano com a REF e o
-- "Tamanho em" do RASCUNHO; a gravação (aplicar_skus_modelo e gerar_skus_modelo) roda o MESMO plano com os valores
-- SALVOS, lidos sob a trava do card, e executa as ops (_skus_executar_plano). Reproduz o laço da F3.5a/F3.6:
--  1. SKUs à mão (_manuais) primeiro, na ordem das chaves, com as regras/mensagens de _salvar_sku_manual_core;
--  2. 'regerar': as automáticas fora da grade saem ANTES (manual nunca);
--  3. 'criar'/'regerar' (só com Formato, REF e "Tamanho em"): cada linha da grade na ordem (variante, tamanho) — manual
--     nunca muda; sem SKU (falta/vazio) fica; 'criar' só cria o que falta; 'regerar' recalcula as automáticas; SKU de
--     OUTRA linha deste card (estado EM EVOLUÇÃO) ou de outro card que não é réplica (REF viva igual + mesma cor/tamanho —
--     D5) = conflito, com as mensagens da F3.5a.
-- chave = variante_key || '|' || tamanho_key.
DECLARE
  v_tenant uuid;
  v_refn text;
  v_cfg jsonb;
  v_meu_nome text;
  v_meu_ref text;
  v_gera boolean;
  v_estado jsonb := '{}'::jsonb;
  v_calc jsonb := '{}'::jsonb;
  v_ops jsonb := '[]'::jsonb;
  v_linhas jsonb := '{}'::jsonb;
  v_erros jsonb := '[]'::jsonb;
  v_conflitos jsonb := '[]'::jsonb;
  v_final jsonb;
  r record;
  v_e jsonb;
  v_k text;
  v_vkey text;
  v_tkey text;
  v_atual jsonb;
  v_sku text;
  v_dono text;
  v_msg text;
  v_code text;
  v_com_modelo uuid;
  v_com_nome text;
  v_com_ref text;
  n_criados integer := 0;
  n_atualizados integer := 0;
  n_removidos integer := 0;
  n_manuais integer := 0;
BEGIN
  IF _modo IS NULL OR _modo NOT IN ('manuais', 'criar', 'regerar') THEN
    RAISE EXCEPTION 'Modo da prévia dos SKUs inválido.' USING ERRCODE = 'P0001';
  END IF;
  IF _manuais IS NULL OR jsonb_typeof(_manuais) <> 'array' THEN
    RAISE EXCEPTION 'SKUs à mão inválidos.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_manuais) AS x(value)
              WHERE jsonb_typeof(x.value) <> 'object'
                 OR jsonb_typeof(x.value -> 'variante_key') IS DISTINCT FROM 'string'
                 OR lower(x.value ->> 'variante_key') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 OR jsonb_typeof(x.value -> 'tamanho_key') IS DISTINCT FROM 'string'
                 OR jsonb_typeof(x.value -> 'sku') IS DISTINCT FROM 'string'
                 OR coalesce(jsonb_typeof(x.value -> 'rev'), 'null') NOT IN ('number', 'null'))
     OR (SELECT count(*) FROM jsonb_array_elements(_manuais)) <>
        (SELECT count(DISTINCT lower(x.value ->> 'variante_key') || '|' || (x.value ->> 'tamanho_key'))
           FROM jsonb_array_elements(_manuais) AS x(value)) THEN
    RAISE EXCEPTION 'SKUs à mão inválidos.' USING ERRCODE = 'P0001';
  END IF;
  SELECT mo.tenant_id, public._sku_norm_ref(_ref), tc.sku_config, mo.nome, mo.ref
    INTO v_tenant, v_refn, v_cfg, v_meu_nome, v_meu_ref
    FROM public.modelos mo
    LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
   WHERE mo.id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  v_gera := _modo <> 'manuais' AND v_cfg IS NOT NULL AND coalesce(v_refn, '') <> '' AND _tipo IS NOT NULL;

  -- estado inicial = o GRAVADO; e o cálculo da grade com a REF/"Tamanho em" DADOS
  FOR r IN SELECT s.id, s.variante_key, s.tamanho_key, s.sku, s.manual, s.rev
             FROM public.modelo_skus s
            WHERE s.modelo_id = _modelo_id LOOP
    v_estado := v_estado || jsonb_build_object(r.variante_key::text || '|' || r.tamanho_key, jsonb_build_object(
                  'id', r.id, 'vkey', r.variante_key::text, 'tkey', r.tamanho_key, 'sku', r.sku, 'manual', r.manual, 'rev', r.rev));
  END LOOP;
  FOR r IN SELECT c.variante_key, c.tamanho_key, c.sku
             FROM public._skus_calc_ref_tipo(_modelo_id, _ref, _tipo) AS c LOOP
    v_calc := v_calc || jsonb_build_object(r.variante_key::text || '|' || r.tamanho_key, to_jsonb(r.sku));
  END LOOP;

  -- 1. SKUs à mão (do rascunho), na ordem das chaves
  FOR v_e IN SELECT x.value FROM jsonb_array_elements(_manuais) AS x(value)
              ORDER BY lower(x.value ->> 'variante_key') COLLATE "C", (x.value ->> 'tamanho_key') COLLATE "C" LOOP
    v_vkey := lower(v_e ->> 'variante_key');
    v_tkey := v_e ->> 'tamanho_key';
    v_k := v_vkey || '|' || v_tkey;
    v_atual := v_estado -> v_k;
    v_msg := NULL;
    v_code := 'P0001';
    v_sku := NULL;
    BEGIN
      v_sku := public._sku_norm_manual(v_e ->> 'sku');
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      v_msg := SQLERRM;
    END;
    IF v_msg IS NULL AND v_atual IS NULL AND NOT (v_calc ? v_k) THEN
      v_msg := 'Esta variante/tamanho não está na grade do produto.';
    END IF;
    -- N2 do G-plano: "já é este SKU, à mão" ANTES do rev — um "a gravar" que sobrou de um Salvar em voo (rev velho) e já
    -- está gravado igual não é conflito: nada muda, nenhuma escrita (sem lost update possível).
    IF v_msg IS NULL AND v_atual IS NOT NULL AND (v_atual ->> 'manual')::boolean AND v_atual ->> 'sku' = v_sku THEN
      CONTINUE;  -- já é este SKU, à mão: nada muda
    END IF;
    IF v_msg IS NULL AND v_atual IS NOT NULL AND jsonb_typeof(v_e -> 'rev') = 'number'
       AND (v_atual ->> 'rev')::integer IS DISTINCT FROM (v_e ->> 'rev')::integer THEN
      v_msg := 'conflito_versao: o SKU foi alterado por outra pessoa';
      v_code := 'P0409';
    END IF;
    IF v_msg IS NULL THEN
      v_dono := NULL;
      SELECT x.key INTO v_dono
        FROM jsonb_each(v_estado) AS x(key, value)
       WHERE x.value ->> 'sku' = v_sku AND x.key <> v_k
       ORDER BY x.key COLLATE "C"
       LIMIT 1;
      IF v_dono IS NOT NULL THEN
        v_msg := format('O SKU %s já está em outra linha deste produto.', v_sku);
      END IF;
    END IF;
    IF v_msg IS NULL THEN
      v_com_modelo := NULL;
      SELECT o.modelo_id, mo.nome, mo.ref INTO v_com_modelo, v_com_nome, v_com_ref
        FROM public.modelo_skus o
        JOIN public.modelos mo ON mo.id = o.modelo_id
       WHERE o.tenant_id = v_tenant AND o.sku = v_sku AND o.modelo_id <> _modelo_id
         AND NOT (coalesce(v_refn, '') <> '' AND public._sku_norm_ref(mo.ref) = v_refn
                  AND o.variante_key::text = v_vkey AND o.tamanho_key = v_tkey)
       ORDER BY o.modelo_id
       LIMIT 1;
      IF v_com_modelo IS NOT NULL THEN
        v_msg := format('O SKU %s já existe em %s (REF %s). Escolha outro.', v_sku, coalesce(v_com_nome, 'outro produto'),
                        coalesce(nullif(btrim(v_com_ref), ''), '—'));
      END IF;
    END IF;
    IF v_msg IS NOT NULL THEN
      v_erros := v_erros || jsonb_build_array(jsonb_build_object('variante_key', v_vkey, 'tamanho_key', v_tkey,
                   'code', v_code, 'mensagem', v_msg, 'sku_atual', v_atual -> 'sku', 'rev_atual', v_atual -> 'rev'));
      v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'erro', 'code', v_code, 'mensagem', v_msg,
                   'sku_de', v_atual -> 'sku', 'sku_para', to_jsonb(v_e ->> 'sku')));
      CONTINUE;
    END IF;
    v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'manual', 'id', v_atual -> 'id', 'vkey', v_vkey,
               'tkey', v_tkey, 'sku', v_sku, 'rev_base', v_e -> 'rev'));
    v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'manual_novo', 'sku_de', v_atual -> 'sku',
                 'sku_para', v_sku));
    v_estado := v_estado || jsonb_build_object(v_k, jsonb_build_object('id', v_atual -> 'id', 'vkey', v_vkey, 'tkey', v_tkey,
                 'sku', v_sku, 'manual', true, 'rev', v_atual -> 'rev'));
    n_manuais := n_manuais + 1;
  END LOOP;

  -- 2. 'regerar': as automáticas que saíram da grade saem ANTES de gerar (manual nunca)
  IF v_gera AND _modo = 'regerar' THEN
    FOR v_k, v_atual IN SELECT x.key, x.value FROM jsonb_each(v_estado) AS x(key, value) ORDER BY x.key COLLATE "C" LOOP
      CONTINUE WHEN (v_atual ->> 'manual')::boolean OR v_calc ? v_k;
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'remover', 'id', v_atual -> 'id', 'vkey', v_atual -> 'vkey',
                 'tkey', v_atual -> 'tkey', 'sku', v_atual -> 'sku'));
      v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'sai', 'sku_de', v_atual -> 'sku'));
      v_estado := v_estado - v_k;
      n_removidos := n_removidos + 1;
    END LOOP;
  END IF;

  -- 3. 'criar'/'regerar': cada linha da grade, na ordem do laço da F3.5a
  IF v_gera THEN
    FOR r IN SELECT c.variante_key, c.tamanho_key, c.sku
               FROM public._skus_calc_ref_tipo(_modelo_id, _ref, _tipo) AS c
              ORDER BY c.variante_ordem, c.tamanho_ordem, c.tamanho_key, c.variante_key LOOP
      v_k := r.variante_key::text || '|' || r.tamanho_key;
      v_atual := v_estado -> v_k;
      CONTINUE WHEN v_atual IS NOT NULL AND (v_atual ->> 'manual')::boolean;                 -- editado à mão: nunca (Q2)
      CONTINUE WHEN r.sku IS NULL;                                                             -- falta sigla (Q4) / vazio
      CONTINUE WHEN v_atual IS NOT NULL AND (_modo <> 'regerar' OR v_atual ->> 'sku' = r.sku); -- fixo (Q2) ou já igual
      v_msg := NULL;
      v_dono := NULL;
      SELECT x.key INTO v_dono
        FROM jsonb_each(v_estado) AS x(key, value)
       WHERE x.value ->> 'sku' = r.sku AND x.key <> v_k
       ORDER BY x.key COLLATE "C"
       LIMIT 1;
      IF v_dono IS NOT NULL THEN
        v_com_modelo := _modelo_id;
        v_com_nome := v_meu_nome;
        v_com_ref := v_meu_ref;
        v_msg := CASE
          WHEN (v_calc ->> v_dono) IS NOT NULL AND (v_calc ->> v_dono) IS DISTINCT FROM (v_estado -> v_dono ->> 'sku') THEN
            format('SKU %s não gravado: esta linha colide com outra deste produto que também muda de SKU neste Regerar. Ajuste um SKU à mão e rode o Regerar de novo.', r.sku)
          ELSE
            format('SKU %s repetido neste produto: duas linhas dão o mesmo SKU. Mude uma sigla ou edite um deles à mão.', r.sku)
        END;
      ELSE
        v_com_modelo := NULL;
        SELECT o.modelo_id, mo.nome, mo.ref INTO v_com_modelo, v_com_nome, v_com_ref
          FROM public.modelo_skus o
          JOIN public.modelos mo ON mo.id = o.modelo_id
         WHERE o.tenant_id = v_tenant AND o.sku = r.sku AND o.modelo_id <> _modelo_id
           AND NOT (public._sku_norm_ref(mo.ref) = v_refn AND o.variante_key = r.variante_key AND o.tamanho_key = r.tamanho_key)
         ORDER BY o.modelo_id
         LIMIT 1;
        IF v_com_modelo IS NOT NULL THEN
          v_msg := format('SKU %s já existe em %s (REF %s). Edite este SKU à mão ou mude a sigla.', r.sku,
                          coalesce(v_com_nome, 'outro produto'), coalesce(nullif(btrim(v_com_ref), ''), '—'));
        END IF;
      END IF;
      IF v_msg IS NOT NULL THEN
        v_conflitos := v_conflitos || jsonb_build_array(jsonb_build_object(
          'variante_key', r.variante_key, 'tamanho_key', r.tamanho_key, 'sku', r.sku,
          'com_modelo_id', v_com_modelo, 'com_nome', v_com_nome, 'com_ref', v_com_ref, 'mensagem', v_msg));
        v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'conflito', 'vkey', r.variante_key::text,
                   'tkey', r.tamanho_key, 'sku', r.sku, 'mensagem', v_msg));
        v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'conflito', 'sku_de', v_atual -> 'sku',
                     'sku_para', r.sku, 'mensagem', v_msg));
        CONTINUE;
      END IF;
      IF v_atual IS NULL THEN
        v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'inserir', 'vkey', r.variante_key::text,
                   'tkey', r.tamanho_key, 'sku', r.sku));
        v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'novo', 'sku_para', r.sku));
        n_criados := n_criados + 1;
      ELSE
        v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'atualizar', 'id', v_atual -> 'id',
                   'vkey', r.variante_key::text, 'tkey', r.tamanho_key, 'sku', r.sku));
        v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'muda', 'sku_de', v_atual -> 'sku',
                     'sku_para', r.sku));
        n_atualizados := n_atualizados + 1;
      END IF;
      v_estado := v_estado || jsonb_build_object(v_k, jsonb_build_object('id', v_atual -> 'id', 'vkey', r.variante_key::text,
                   'tkey', r.tamanho_key, 'sku', r.sku, 'manual', false, 'rev', v_atual -> 'rev'));
    END LOOP;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_array(x.value ->> 'vkey', x.value ->> 'tkey', x.value ->> 'sku',
                                              (x.value ->> 'manual')::boolean)), '[]'::jsonb)
    INTO v_final
    FROM jsonb_each(v_estado) AS x(key, value);
  RETURN jsonb_build_object(
    'status', CASE WHEN v_cfg IS NULL THEN 'sem_formato' WHEN coalesce(v_refn, '') = '' THEN 'aguardando_ref'
                   WHEN _tipo IS NULL THEN 'sem_tamanho' ELSE 'ok' END,
    'modo', _modo, 'ops', v_ops, 'linhas', v_linhas, 'erros', v_erros, 'conflitos', v_conflitos,
    'final', v_final, 'assinatura', public._skus_assinatura(v_final),
    'criados', n_criados, 'atualizados', n_atualizados, 'removidos', n_removidos, 'manuais', n_manuais);
END
$function$;

CREATE OR REPLACE FUNCTION public._skus_executar_plano(_modelo_id uuid, _tenant uuid, _plano jsonb, _estrito boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.1) — EXECUTA, na ordem, as ops de um plano de _skus_plano: a
-- ÚNICA escrita em modelo_skus da geração e da prévia gravada. Quem chama segura a trava 'sku_modelo:<id>' e montou o plano
-- DEPOIS dela. SKU que outra transação gravou no meio (unique_violation do gatilho/UNIQUE): _estrito (aplicar a prévia)
-- ⇒ P0409 e nada fica; senão (gerar_skus_modelo) ⇒ vira conflito, como no laço da F3.5a.
DECLARE
  v_op jsonb;
  n_criados integer := 0;
  n_atualizados integer := 0;
  n_removidos integer := 0;
  n_manuais integer := 0;
  v_conflitos jsonb := '[]'::jsonb;
BEGIN
  FOR v_op IN SELECT x.value FROM jsonb_array_elements(coalesce(_plano -> 'ops', '[]'::jsonb)) WITH ORDINALITY AS x(value, n)
               ORDER BY x.n LOOP
    CONTINUE WHEN v_op ->> 'op' NOT IN ('remover', 'manual', 'inserir', 'atualizar');
    BEGIN
      IF v_op ->> 'op' = 'remover' THEN
        DELETE FROM public.modelo_skus s
         WHERE s.id = (v_op ->> 'id')::uuid AND s.modelo_id = _modelo_id AND NOT s.manual;
        IF FOUND THEN
          n_removidos := n_removidos + 1;
        ELSIF _estrito THEN
          RAISE EXCEPTION 'previa_desatualizada: um SKU que sairia já não está gravado' USING ERRCODE = 'P0409';
        END IF;
      ELSIF v_op ->> 'op' = 'manual' THEN
        IF v_op ->> 'id' IS NULL THEN
          INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual, gerado_em)
          VALUES (_tenant, _modelo_id, (v_op ->> 'vkey')::uuid, v_op ->> 'tkey', v_op ->> 'sku', true, now());
        ELSE
          UPDATE public.modelo_skus s
             SET sku = v_op ->> 'sku', manual = true, gerado_em = now(), rev = s.rev + 1
           WHERE s.id = (v_op ->> 'id')::uuid AND s.modelo_id = _modelo_id
             AND (v_op ->> 'rev_base' IS NULL OR s.rev = (v_op ->> 'rev_base')::integer);
          IF NOT FOUND THEN
            RAISE EXCEPTION 'conflito_versao: o SKU foi alterado por outra pessoa' USING ERRCODE = 'P0409';
          END IF;
        END IF;
        n_manuais := n_manuais + 1;
      ELSIF v_op ->> 'op' = 'inserir' THEN
        INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual, gerado_em)
        VALUES (_tenant, _modelo_id, (v_op ->> 'vkey')::uuid, v_op ->> 'tkey', v_op ->> 'sku', false, now());
        n_criados := n_criados + 1;
      ELSE
        UPDATE public.modelo_skus s
           SET sku = v_op ->> 'sku', gerado_em = now(), rev = s.rev + 1
         WHERE s.id = (v_op ->> 'id')::uuid AND s.modelo_id = _modelo_id AND NOT s.manual;
        IF FOUND THEN
          n_atualizados := n_atualizados + 1;
        ELSIF _estrito THEN
          RAISE EXCEPTION 'previa_desatualizada: um SKU que mudaria já não está como na prévia' USING ERRCODE = 'P0409';
        END IF;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      IF _estrito THEN
        RAISE EXCEPTION 'previa_desatualizada: o SKU % foi gravado em outra linha depois da prévia', v_op ->> 'sku'
          USING ERRCODE = 'P0409';
      END IF;
      v_conflitos := v_conflitos || jsonb_build_array(jsonb_build_object(
        'variante_key', v_op -> 'vkey', 'tamanho_key', v_op -> 'tkey', 'sku', v_op -> 'sku',
        'com_modelo_id', NULL::text, 'com_nome', NULL::text, 'com_ref', NULL::text,
        'mensagem', format('SKU %s não gravado: outra pessoa gravou esta linha agora. Gere de novo.', v_op ->> 'sku')));
    END;
  END LOOP;
  RETURN jsonb_build_object('criados', n_criados, 'atualizados', n_atualizados, 'removidos', n_removidos,
                            'manuais', n_manuais, 'conflitos', v_conflitos);
END
$function$;

CREATE OR REPLACE FUNCTION public._skus_previa_core(_modelo_id uuid, _ref text, _tipo text, _manuais jsonb, _modo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.3) — o que o Salvar vai gravar, SEM gravar: a matriz de SKUs do
-- card calculada com a REF e o "Tamanho em" DADOS + por linha "previa" (o plano de _skus_plano, o MESMO da gravação:
-- {acao, sku_de, sku_para, mensagem, code}; null = a linha não muda) + a assinatura do estado final.
DECLARE
  v_plano jsonb;
  v_mat jsonb;
  v_linhas jsonb;
BEGIN
  v_plano := public._skus_plano(_modelo_id, _ref, _tipo, _manuais, _modo);
  v_mat := public._skus_matriz_ref_tipo(_modelo_id, _ref, _tipo);
  SELECT coalesce(jsonb_agg(l.value || jsonb_build_object('previa',
           v_plano -> 'linhas' -> ((l.value ->> 'variante_key') || '|' || (l.value ->> 'tamanho_key'))) ORDER BY l.n), '[]'::jsonb)
    INTO v_linhas
    FROM jsonb_array_elements(v_mat -> 'linhas') WITH ORDINALITY AS l(value, n);
  RETURN (v_mat - 'linhas') || jsonb_build_object(
    'linhas', v_linhas, 'modo', v_plano -> 'modo', 'assinatura', v_plano -> 'assinatura', 'erros', v_plano -> 'erros',
    'conflitos', v_plano -> 'conflitos', 'criados', v_plano -> 'criados', 'atualizados', v_plano -> 'atualizados',
    'removidos', v_plano -> 'removidos', 'manuais', v_plano -> 'manuais');
END
$function$;

CREATE OR REPLACE FUNCTION public._aplicar_skus_modelo_core(_modelo_id uuid, _manuais jsonb, _modo text, _assinatura text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.4) — GRAVA a prévia que o usuário viu, no Salvar do card (DEPOIS
-- do UPDATE do modelo: a REF e o "Tamanho em" já são os do rascunho). Sob a trava 'sku_modelo:<id>' (a mesma de gerar/
-- editar — ordem sku_modelo → linha → sku_unico, sem deadlock), refaz o plano com os valores SALVOS e:
--  • erro num SKU à mão ⇒ RAISE com a MESMA mensagem da prévia (P0001; rev velho = P0409) — nada grava;
--  • assinatura do estado final ≠ a da prévia ⇒ P0409 'previa_desatualizada' — nada grava;
--  • senão executa as ops (estrito) e CONFERE que o gravado = a prévia (mesma assinatura) — senão P0409, tudo desfeito.
DECLARE
  v_tenant uuid;
  v_ref text;
  v_tipo text;
  v_plano jsonb;
  v_exec jsonb;
  v_erro jsonb;
  v_depois text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.modelos mo WHERE mo.id = _modelo_id) THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sku_modelo:' || _modelo_id::text, 0));
  SELECT mo.tenant_id, mo.ref, mo.tamanho_tipo INTO v_tenant, v_ref, v_tipo
    FROM public.modelos mo
   WHERE mo.id = _modelo_id;
  v_plano := public._skus_plano(_modelo_id, v_ref, v_tipo, _manuais, _modo);
  v_erro := v_plano -> 'erros' -> 0;
  IF v_erro IS NOT NULL THEN
    IF v_erro ->> 'code' = 'P0409' THEN
      RAISE EXCEPTION '%', v_erro ->> 'mensagem' USING ERRCODE = 'P0409';
    END IF;
    RAISE EXCEPTION '%', v_erro ->> 'mensagem' USING ERRCODE = 'P0001';
  END IF;
  IF _assinatura IS NULL OR _assinatura IS DISTINCT FROM v_plano ->> 'assinatura' THEN
    RAISE EXCEPTION 'previa_desatualizada: os SKUs mudaram desde a prévia' USING ERRCODE = 'P0409';
  END IF;
  v_exec := public._skus_executar_plano(_modelo_id, v_tenant, v_plano, true);
  SELECT public._skus_assinatura(coalesce(jsonb_agg(jsonb_build_array(s.variante_key::text, s.tamanho_key, s.sku, s.manual)), '[]'::jsonb))
    INTO v_depois
    FROM public.modelo_skus s
   WHERE s.modelo_id = _modelo_id;
  IF v_depois IS DISTINCT FROM v_plano ->> 'assinatura' THEN
    RAISE EXCEPTION 'previa_desatualizada: o gravado não bateu com a prévia — nada foi gravado' USING ERRCODE = 'P0409';
  END IF;
  RETURN public._skus_matriz_ref_tipo(_modelo_id, v_ref, v_tipo)
      || jsonb_build_object('criados', (v_exec ->> 'criados')::integer, 'atualizados', (v_exec ->> 'atualizados')::integer,
                            'removidos', (v_exec ->> 'removidos')::integer, 'manuais', (v_exec ->> 'manuais')::integer,
                            'conflitos', v_plano -> 'conflitos');
END
$function$;

CREATE OR REPLACE FUNCTION public.skus_previa(_modelo_id uuid, _ref text, _tamanho_tipo text, _manuais jsonb, _modo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA — RPC SÓ LEITURA da seção "4. Códigos": o que o Salvar vai gravar nos SKUs deste card com a REF e o
-- "Tamanho em" do RASCUNHO, os SKUs digitados à mão (_manuais: [{variante_key, tamanho_key, sku, rev}]) e o modo
-- ('regerar' = o botão "Regerar SKUs"; 'manuais' = só os digitados; 'criar' = a 1ª geração). STABLE: não grava nada (o
-- PostgREST a roda em transação READ ONLY). Guarda de sempre (_sku_guarda): login, módulo criacao, loja, EDITAR (R8).
DECLARE
  v_tenant uuid;
BEGIN
  SELECT mo.tenant_id INTO v_tenant FROM public.modelos mo WHERE mo.id = _modelo_id;
  PERFORM public._sku_guarda(v_tenant, true);
  IF _tamanho_tipo IS NOT NULL AND _tamanho_tipo NOT IN ('letra', 'numero') THEN
    RAISE EXCEPTION '"Tamanho em" inválido: use letra ou número.' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(coalesce(_ref, '')) > 200 THEN
    RAISE EXCEPTION 'REF longa demais para a prévia dos SKUs.' USING ERRCODE = 'P0001';
  END IF;
  IF _manuais IS NOT NULL AND jsonb_typeof(_manuais) = 'array' AND jsonb_array_length(_manuais) > 1000 THEN
    RAISE EXCEPTION 'SKUs à mão demais numa prévia (máximo 1000).' USING ERRCODE = 'P0001';
  END IF;
  RETURN public._skus_previa_core(_modelo_id, _ref, _tamanho_tipo, coalesce(_manuais, '[]'::jsonb), _modo);
END
$function$;

CREATE OR REPLACE FUNCTION public.aplicar_skus_modelo(_modelo_id uuid, _manuais jsonb, _modo text, _assinatura text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA — RPC do Salvar do card: grava a prévia vista (Regerar e/ou SKUs à mão) se, com os valores SALVOS, ela
-- continua a mesma (_assinatura de skus_previa); senão P0409 e nada grava. Guarda de sempre (_sku_guarda, EDITAR).
DECLARE
  v_tenant uuid;
BEGIN
  SELECT mo.tenant_id INTO v_tenant FROM public.modelos mo WHERE mo.id = _modelo_id;
  PERFORM public._sku_guarda(v_tenant, true);
  IF _manuais IS NOT NULL AND jsonb_typeof(_manuais) = 'array' AND jsonb_array_length(_manuais) > 1000 THEN
    RAISE EXCEPTION 'SKUs à mão demais num Salvar (máximo 1000).' USING ERRCODE = 'P0001';
  END IF;
  RETURN public._aplicar_skus_modelo_core(_modelo_id, coalesce(_manuais, '[]'::jsonb), _modo, _assinatura);
END
$function$;

CREATE OR REPLACE FUNCTION public._skus_modelo_calc(_modelo_id uuid)
 RETURNS TABLE(variante_key uuid, variante_ordem integer, cor_nome text, apelido_nome text, tamanho_key text, tamanho_ordem integer, sku text, faltas jsonb, avisos jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.1): o corpo mudou para _skus_calc_ref_tipo (REF e "Tamanho em"
-- por parâmetro). Aqui, com os SALVOS do card — o MESMO resultado de antes (provado na suíte).
BEGIN
  RETURN QUERY
  SELECT c.variante_key, c.variante_ordem, c.cor_nome, c.apelido_nome, c.tamanho_key, c.tamanho_ordem, c.sku, c.faltas, c.avisos
    FROM public.modelos mo
   CROSS JOIN LATERAL public._skus_calc_ref_tipo(mo.id, mo.ref, mo.tamanho_tipo) AS c
   WHERE mo.id = _modelo_id;
END
$function$;

CREATE OR REPLACE FUNCTION public._skus_modelo_core(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.1): o corpo mudou para _skus_matriz_ref_tipo (REF e "Tamanho em"
-- por parâmetro). Aqui, com os SALVOS do card — o MESMO resultado de antes (provado na suíte); modelo inexistente segue
-- 'Modelo não encontrado.'.
BEGIN
  RETURN public._skus_matriz_ref_tipo(_modelo_id,
           (SELECT mo.ref FROM public.modelos mo WHERE mo.id = _modelo_id),
           (SELECT mo.tamanho_tipo FROM public.modelos mo WHERE mo.id = _modelo_id));
END
$function$;

CREATE OR REPLACE FUNCTION public._gerar_skus_modelo_core(_modelo_id uuid, _regerar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.1): a DECISÃO saiu para _skus_plano (puro — o MESMO plano que a
-- prévia mostra) e a escrita para _skus_executar_plano. Mesmo contrato e mesmo resultado da F3.5a/F3.6 (provado cenário a
-- cenário na suíte). REF e "Tamanho em" lidos UMA vez, DEPOIS da trava, e passados ao plano: o cálculo não relê o card no
-- meio (fecha a corrida B-M8 do G-migration de 25/set).
DECLARE
  v_tenant uuid;
  v_ref text;
  v_tipo text;
  v_plano jsonb;
  v_exec jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.modelos mo WHERE mo.id = _modelo_id) THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  -- Uma geração/edição por modelo de cada vez (a MESMA trava de _salvar_sku_manual_core e _aplicar_skus_modelo_core;
  -- ordem única sku_modelo → linha → sku_unico — sem deadlock).
  PERFORM pg_advisory_xact_lock(hashtextextended('sku_modelo:' || _modelo_id::text, 0));
  SELECT mo.tenant_id, mo.ref, mo.tamanho_tipo INTO v_tenant, v_ref, v_tipo
    FROM public.modelos mo
   WHERE mo.id = _modelo_id;
  v_plano := public._skus_plano(_modelo_id, v_ref, v_tipo, '[]'::jsonb, CASE WHEN _regerar THEN 'regerar' ELSE 'criar' END);
  v_exec := public._skus_executar_plano(_modelo_id, v_tenant, v_plano, false);
  RETURN public._skus_matriz_ref_tipo(_modelo_id, v_ref, v_tipo)
      || jsonb_build_object('criados', (v_exec ->> 'criados')::integer, 'atualizados', (v_exec ->> 'atualizados')::integer,
                            'removidos', (v_exec ->> 'removidos')::integer,
                            'conflitos', (v_plano -> 'conflitos') || (v_exec -> 'conflitos'));
END
$function$;

REVOKE EXECUTE ON FUNCTION
  public._skus_modelo_calc(uuid),
  public._skus_modelo_core(uuid),
  public._gerar_skus_modelo_core(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION
  public._skus_assinatura(jsonb),
  public._skus_calc_ref_tipo(uuid, text, text),
  public._skus_matriz_ref_tipo(uuid, text, text),
  public._skus_plano(uuid, text, text, jsonb, text),
  public._skus_executar_plano(uuid, uuid, jsonb, boolean),
  public._skus_previa_core(uuid, text, text, jsonb, text),
  public._aplicar_skus_modelo_core(uuid, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION
  public.skus_previa(uuid, text, text, jsonb, text),
  public.aplicar_skus_modelo(uuid, jsonb, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.skus_previa(uuid, text, text, jsonb, text),
  public.aplicar_skus_modelo(uuid, jsonb, text, text)
  TO authenticated;

DO $acl$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['public._skus_modelo_calc(uuid)', 'public._skus_modelo_core(uuid)', 'public._gerar_skus_modelo_core(uuid,boolean)', 'public._skus_assinatura(jsonb)', 'public._skus_calc_ref_tipo(uuid,text,text)', 'public._skus_matriz_ref_tipo(uuid,text,text)', 'public._skus_plano(uuid,text,text,jsonb,text)', 'public._skus_executar_plano(uuid,uuid,jsonb,boolean)', 'public._skus_previa_core(uuid,text,text,jsonb,text)', 'public._aplicar_skus_modelo_core(uuid,jsonb,text,text)']) AS f(x) CROSS JOIN (VALUES ('public'), ('anon'), ('authenticated')) AS r(y)
              WHERE has_function_privilege(r.y, to_regprocedure(f.x), 'EXECUTE'))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['public.skus_previa(uuid,text,text,jsonb,text)', 'public.aplicar_skus_modelo(uuid,jsonb,text,text)']) AS f(x) CROSS JOIN (VALUES ('public'), ('anon')) AS r(y)
              WHERE has_function_privilege(r.y, to_regprocedure(f.x), 'EXECUTE'))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['public.skus_previa(uuid,text,text,jsonb,text)', 'public.aplicar_skus_modelo(uuid,jsonb,text,text)']) AS f(x)
              WHERE NOT coalesce(has_function_privilege('authenticated', to_regprocedure(f.x), 'EXECUTE'), false)) THEN
    RAISE EXCEPTION 'sku_previa: ACL fora do padrão — interna executável por PUBLIC/anon/authenticated ou RPC fora de authenticated (invariante #9)' USING ERRCODE = 'P0001';
  END IF;
END
$acl$;

DO $pos$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_modelo_calc(uuid)')));
  IF v_md5 IS DISTINCT FROM '34d27675526dbed96ca6d514e9665771' THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_modelo_calc não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_modelo_core(uuid)')));
  IF v_md5 IS DISTINCT FROM '11c269afdbeb9c88757d5464b63abb3c' THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_modelo_core não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._gerar_skus_modelo_core(uuid,boolean)')));
  IF v_md5 IS DISTINCT FROM '25689bd9d29fe6192870b5cfacf254ce' THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _gerar_skus_modelo_core não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_assinatura(jsonb)')));
  IF v_md5 IS DISTINCT FROM '88421a3100449a4b74d0c41c25f7bc57' THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_assinatura não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_calc_ref_tipo(uuid,text,text)')));
  IF v_md5 IS DISTINCT FROM 'ff2e575909f83fc0355fe20a049fd906' THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_calc_ref_tipo não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_matriz_ref_tipo(uuid,text,text)')));
  IF v_md5 IS DISTINCT FROM 'f98ac370c499c823cb23bdb2b271f145' THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_matriz_ref_tipo não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_plano(uuid,text,text,jsonb,text)')));
  IF v_md5 IS DISTINCT FROM 'd81a8266cb41fe8709f52f6e9d5ad522' THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_plano não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_executar_plano(uuid,uuid,jsonb,boolean)')));
  IF v_md5 IS DISTINCT FROM '033544145bb52651fdd24733bdd7e412' THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_executar_plano não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_previa_core(uuid,text,text,jsonb,text)')));
  IF v_md5 IS DISTINCT FROM 'f2e513e6f1b6754c968d98b2ee0ea7c1' THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_previa_core não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._aplicar_skus_modelo_core(uuid,jsonb,text,text)')));
  IF v_md5 IS DISTINCT FROM '670793ce00dc20234ccecc23f9c4aede' THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _aplicar_skus_modelo_core não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.skus_previa(uuid,text,text,jsonb,text)')));
  IF v_md5 IS DISTINCT FROM 'e5d6ba64d40b088c02a6e00f85f27870' THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — skus_previa não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.aplicar_skus_modelo(uuid,jsonb,text,text)')));
  IF v_md5 IS DISTINCT FROM '155420b1e203424069c08185a36f0fcc' THEN
    RAISE EXCEPTION 'sku_previa: pós-condição falhou — aplicar_skus_modelo não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
