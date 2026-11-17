-- F7 Armario · FOTO POR VARIANTE (cor) — BANCO: tabela modelo_variante_fotos + 2 RPCs + reemite armario_variantes_disponiveis.
-- Decisao do dono (travada): UMA foto por variante (modelo x cor), para as 3 origens (interno/revenda/importado). A foto e SO
-- para a vitrine do Armario (qualidade baixa aceita; o front comprime no upload). Inserida no Planejamento, na secao ANEXOS
-- (sub-lista "Foto por cor" que repete as cores do produto). No Armario: a celula produto x cor usa a foto da variante; SEM
-- foto da variante -> FALLBACK na capa do modelo (comportamento de hoje).
--
-- MOLDE de tabela/RLS/tenant/trigger: 20261202100000_armario_tabelas.sql (mesma convencao: FK NO ACTION onde preciso, uuid SEM
-- FK p/ snapshot de cor/variante, trigger set_tenant_id, 4 policies por tenant via get_user_tenant_id, REVOKE+GRANT explicito).
--
-- O QUE MUDA:
--   1) TABELA NOVA modelo_variante_fotos: 1 foto por tupla (modelo x variante_tecido x produto_variante x cor x apelido).
--      UNIQUE NULLS NOT DISTINCT na MESMA tupla de identidade de armario_itens (espelho de chaveVariante).
--   2) RPCs (DEFINER, wrapper+_core com REVOKE dos 3 papeis):
--      - modelo_variante_foto_salvar(...): upsert pela tupla; foto nova substitui; path null/'' REMOVE a linha. Escrita: gate
--        _seg_exige_pagina('criacao_planejamento','criacao_desenvolvimento'). Snapshot da cor derivado/validado da loja do modelo.
--      - modelo_variante_fotos_listar(_modelo_id): LEITURA (so login+loja); lista TODAS as variantes do modelo (3 origens) com a
--        foto atual (ou null). A UI de Anexos usa isto como fonte unica da sub-lista.
--   3) armario_variantes_disponiveis(uuid): REEMITIDA (guarda md5 do corpo vivo a37fdd555c684487f6c2df22ce41f838) para que o
--      `foto_path` de CADA variante seja coalesce(foto_da_variante, capa_do_modelo). LEFT JOIN por IS NOT DISTINCT FROM na tupla.
--
-- Mensagens de RAISE so ASCII (P0001 vira 400; a tela traduz pelo prefixo). Idempotente. Trava: catalogo + CREATE TABLE (tabela
-- nova, 0 linhas). Aplicar FORA de transacao: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i em BEGIN...ROLLBACK.
-- Volta: supabase/rollback/20261206100000_modelo_variante_fotos_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v_oid oid := to_regprocedure('public.armario_variantes_disponiveis(uuid)');
  v_md5 text;
BEGIN
  IF to_regclass('public.modelos') IS NULL THEN
    RAISE EXCEPTION 'mvf_dep: tabela modelos ausente' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._seg_exige_pagina(text[])') IS NULL
     OR to_regprocedure('public.get_user_tenant_id()') IS NULL
     OR to_regprocedure('public.tenant_module_enabled(text)') IS NULL
     OR to_regprocedure('public.set_tenant_id()') IS NULL
     OR to_regprocedure('public._grupo_eh_acessorio(uuid)') IS NULL THEN
    RAISE EXCEPTION 'mvf_dep: helper ausente (_seg_exige_pagina/get_user_tenant_id/tenant_module_enabled/set_tenant_id/_grupo_eh_acessorio)' USING ERRCODE = 'P0001';
  END IF;
  -- armario_variantes_disponiveis: GUARDA MD5 (so reemite do corpo vivo esperado; ja desta migration = idempotente).
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'mvf_dep: armario_variantes_disponiveis(uuid) ausente (aplicar a 20261204100000 antes)' USING ERRCODE = 'P0001';
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = v_oid;
  IF v_md5 NOT IN (
       'a37fdd555c684487f6c2df22ce41f838',  -- corpo vivo do 31o deploy (ano/mes) = baseline antes desta migration
       '27d69302b434b5ea4fbbdbc95cc4a4a3'   -- ja desta migration (foto por variante) = idempotente
     ) THEN
    RAISE EXCEPTION 'mvf_dep: corpo vivo de armario_variantes_disponiveis(uuid) difere do esperado (md5 %)', v_md5 USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- ======================================================================================================================================
-- 1) TABELA modelo_variante_fotos — 1 foto por tupla de identidade (espelho de armario_itens / chaveVariante)
-- ======================================================================================================================================
CREATE TABLE IF NOT EXISTS public.modelo_variante_fotos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid,
  modelo_id           uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  variante_tecido_id  uuid,   -- SEM FK (snapshot puro; interno)
  produto_variante_id uuid,   -- SEM FK (revenda/importado; 2 tabelas possiveis)
  cor_id              uuid,   -- SEM FK (snapshot)
  cor_apelido_id      uuid,   -- SEM FK (snapshot)
  foto_path           text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mvf_tenant_modelo ON public.modelo_variante_fotos (tenant_id, modelo_id);
-- UNIQUE na MESMA tupla de armario_itens (NULLS NOT DISTINCT; PG15+, o banco e PG17): 1 foto por (modelo, variante, cor).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mvf_variante
  ON public.modelo_variante_fotos (modelo_id, variante_tecido_id, produto_variante_id, cor_id, cor_apelido_id) NULLS NOT DISTINCT;

-- tenant_id automatico + ACL + RLS por tenant (molde armario_tabelas / mix_padroes).
CREATE OR REPLACE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.modelo_variante_fotos FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();
REVOKE ALL ON public.modelo_variante_fotos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.modelo_variante_fotos TO authenticated;
GRANT ALL ON public.modelo_variante_fotos TO service_role;
ALTER TABLE public.modelo_variante_fotos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON public.modelo_variante_fotos;
CREATE POLICY tenant_select ON public.modelo_variante_fotos FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS tenant_insert ON public.modelo_variante_fotos;
CREATE POLICY tenant_insert ON public.modelo_variante_fotos FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id() OR tenant_id IS NULL);
DROP POLICY IF EXISTS tenant_update ON public.modelo_variante_fotos;
CREATE POLICY tenant_update ON public.modelo_variante_fotos FOR UPDATE TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS tenant_delete ON public.modelo_variante_fotos;
CREATE POLICY tenant_delete ON public.modelo_variante_fotos FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());

-- ======================================================================================================================================
-- 2a) modelo_variante_foto_salvar — upsert pela tupla; foto nova substitui; path null/'' REMOVE a linha
-- ======================================================================================================================================
CREATE OR REPLACE FUNCTION public._modelo_variante_foto_salvar_core(
  _modelo_id uuid, _variante_tecido_id uuid, _produto_variante_id uuid, _cor_id uuid, _cor_apelido_id uuid, _foto_path text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_origem text;
  v_path   text := nullif(btrim(coalesce(_foto_path, '')), '');
  v_cor    uuid;
  v_ap     uuid;
  v_achou  boolean := false;
  v_id     uuid;
BEGIN
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'mvf_sem_loja: usuario sem loja ativa' USING ERRCODE = '42501';
  END IF;
  IF _modelo_id IS NULL THEN
    RAISE EXCEPTION 'mvf_modelo_obrigatorio: informe o modelo' USING ERRCODE = 'P0001';
  END IF;
  IF _variante_tecido_id IS NULL AND _produto_variante_id IS NULL THEN
    RAISE EXCEPTION 'mvf_sem_variante: informe a variante (produto sem cor nao tem foto por cor)' USING ERRCODE = 'P0001';
  END IF;
  IF _variante_tecido_id IS NOT NULL AND _produto_variante_id IS NOT NULL THEN
    RAISE EXCEPTION 'mvf_variante_ambigua: informe apenas um ponteiro de variante' USING ERRCODE = 'P0001';
  END IF;

  -- modelo da loja (ANTI-CROSS-TENANT) + origem decide o ponteiro valido
  SELECT m.origem::text INTO v_origem FROM public.modelos m WHERE m.id = _modelo_id AND m.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mvf_modelo_invalido: modelo inexistente ou de outra loja' USING ERRCODE = 'P0001';
  END IF;

  -- deriva/valida a cor do PONTEIRO (a origem do modelo decide qual ponteiro vale) — snapshot da loja do modelo
  IF v_origem = 'revenda' THEN
    IF _variante_tecido_id IS NOT NULL OR _produto_variante_id IS NULL THEN
      RAISE EXCEPTION 'mvf_variante_invalida: produto de revenda usa produto_variante_id' USING ERRCODE = 'P0001';
    END IF;
    SELECT true, pav.cor_id, pav.cor_apelido_id INTO v_achou, v_cor, v_ap
      FROM public.produto_acabado_variantes pav
      JOIN public.produtos_acabados pa ON pa.id = pav.produto_acabado_id AND pa.tenant_id = v_tenant
     WHERE pav.id = _produto_variante_id AND pav.tenant_id = v_tenant AND pa.modelo_id = _modelo_id;
  ELSIF v_origem = 'importado' THEN
    IF _variante_tecido_id IS NOT NULL OR _produto_variante_id IS NULL THEN
      RAISE EXCEPTION 'mvf_variante_invalida: produto importado usa produto_variante_id' USING ERRCODE = 'P0001';
    END IF;
    SELECT true, piv.cor_id, piv.cor_apelido_id INTO v_achou, v_cor, v_ap
      FROM public.produto_importado_variantes piv
      JOIN public.produtos_importados pi ON pi.id = piv.produto_importado_id AND pi.tenant_id = v_tenant
     WHERE piv.id = _produto_variante_id AND piv.tenant_id = v_tenant AND pi.modelo_id = _modelo_id;
  ELSE
    IF _produto_variante_id IS NOT NULL OR _variante_tecido_id IS NULL THEN
      RAISE EXCEPTION 'mvf_variante_invalida: produto interno usa variante_tecido_id' USING ERRCODE = 'P0001';
    END IF;
    -- interno: a variante tem que ser do Tecido 1 do BOM do modelo (mesma regra da C1 do armario)
    SELECT true, vt.cor_id, vt.cor_apelido_id INTO v_achou, v_cor, v_ap
      FROM public.variantes_tecido vt
     WHERE vt.id = _variante_tecido_id AND vt.tenant_id = v_tenant
       AND EXISTS (SELECT 1
                     FROM public.modelo_tecido_variantes mtv
                     JOIN public.modelo_tecidos mt ON mt.id = mtv.modelo_tecido_id
                    WHERE mtv.variante_tecido_id = vt.id AND mt.modelo_id = _modelo_id AND mt.tipo = 'tecido' AND mt.numero = 1);
  END IF;

  IF NOT coalesce(v_achou, false) THEN
    RAISE EXCEPTION 'mvf_variante_invalida: variante inexistente ou que nao pertence a este produto' USING ERRCODE = 'P0001';
  END IF;

  -- REMOCAO: path vazio apaga a linha da tupla (idempotente)
  IF v_path IS NULL THEN
    DELETE FROM public.modelo_variante_fotos f
     WHERE f.tenant_id = v_tenant AND f.modelo_id = _modelo_id
       AND f.variante_tecido_id  IS NOT DISTINCT FROM _variante_tecido_id
       AND f.produto_variante_id IS NOT DISTINCT FROM _produto_variante_id
       AND f.cor_id              IS NOT DISTINCT FROM v_cor
       AND f.cor_apelido_id      IS NOT DISTINCT FROM v_ap;
    RETURN NULL;
  END IF;

  -- UPSERT pela tupla (foto nova substitui) — grava o snapshot de cor DERIVADO (ignora o que o cliente mandaria)
  INSERT INTO public.modelo_variante_fotos (tenant_id, modelo_id, variante_tecido_id, produto_variante_id, cor_id, cor_apelido_id, foto_path)
  VALUES (v_tenant, _modelo_id, _variante_tecido_id, _produto_variante_id, v_cor, v_ap, v_path)
  ON CONFLICT (modelo_id, variante_tecido_id, produto_variante_id, cor_id, cor_apelido_id)
    DO UPDATE SET foto_path = EXCLUDED.foto_path, created_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.modelo_variante_foto_salvar(
  _modelo_id uuid, _variante_tecido_id uuid, _produto_variante_id uuid, _cor_id uuid, _cor_apelido_id uuid, _foto_path text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'mvf_nao_autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'modulo_desligado: criacao' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('criacao_planejamento', 'criacao_desenvolvimento');
  RETURN public._modelo_variante_foto_salvar_core(_modelo_id, _variante_tecido_id, _produto_variante_id, _cor_id, _cor_apelido_id, _foto_path);
END;
$function$;

-- ======================================================================================================================================
-- 2b) modelo_variante_fotos_listar — LEITURA: TODAS as variantes do modelo (3 origens) + foto atual (ou null) por variante
-- ======================================================================================================================================
CREATE OR REPLACE FUNCTION public.modelo_variante_fotos_listar(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_origem text;
  v_res    jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'mvf_nao_autenticado' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'mvf_sem_loja: usuario sem loja ativa' USING ERRCODE = '42501';
  END IF;

  SELECT m.origem::text INTO v_origem FROM public.modelos m WHERE m.id = _modelo_id AND m.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RETURN '[]'::jsonb;  -- modelo inexistente ou de outra loja: lista vazia (nada a mostrar)
  END IF;

  WITH v_int AS (
    SELECT DISTINCT ON (vt.id)
           vt.id AS variante_tecido_id, NULL::uuid AS produto_variante_id, vt.cor_id, vt.cor_apelido_id, mtv.ordem
      FROM (SELECT mt.id FROM public.modelo_tecidos mt
             WHERE mt.modelo_id = _modelo_id AND mt.tipo = 'tecido' AND mt.numero = 1
             ORDER BY mt.created_at, mt.id LIMIT 1) t1
      JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = t1.id
      JOIN public.variantes_tecido vt ON vt.id = mtv.variante_tecido_id AND vt.tenant_id = v_tenant
     WHERE v_origem NOT IN ('revenda', 'importado') AND vt.cor_id IS NOT NULL
     ORDER BY vt.id, mtv.ordem
  ),
  v_rev AS (
    SELECT NULL::uuid AS variante_tecido_id, pav.id AS produto_variante_id, pav.cor_id, pav.cor_apelido_id, pav.ordem
      FROM public.produtos_acabados pa
      JOIN public.produto_acabado_variantes pav ON pav.produto_acabado_id = pa.id AND pav.tenant_id = v_tenant
     WHERE v_origem = 'revenda' AND pa.modelo_id = _modelo_id AND pa.tenant_id = v_tenant AND pav.cor_id IS NOT NULL
  ),
  v_imp AS (
    SELECT NULL::uuid AS variante_tecido_id, piv.id AS produto_variante_id, piv.cor_id, piv.cor_apelido_id, piv.ordem
      FROM public.produtos_importados pi
      JOIN public.produto_importado_variantes piv ON piv.produto_importado_id = pi.id AND piv.tenant_id = v_tenant
     WHERE v_origem = 'importado' AND pi.modelo_id = _modelo_id AND pi.tenant_id = v_tenant AND piv.cor_id IS NOT NULL
  ),
  v_all AS (
    SELECT * FROM v_int UNION ALL SELECT * FROM v_rev UNION ALL SELECT * FROM v_imp
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'variante_tecido_id',  v.variante_tecido_id,
           'produto_variante_id', v.produto_variante_id,
           'cor_id',              v.cor_id,
           'cor_apelido_id',      v.cor_apelido_id,
           'cor_nome',            (SELECT c.nome::text  FROM public.cores c          WHERE c.id  = v.cor_id),
           'cor_apelido_nome',    (SELECT ca.nome::text FROM public.cores_apelido ca WHERE ca.id = v.cor_apelido_id),
           'ordem',               v.ordem,
           'foto_path',           f.foto_path
         ) ORDER BY v.ordem, v.variante_tecido_id, v.produto_variante_id), '[]'::jsonb)
    INTO v_res
    FROM v_all v
    LEFT JOIN public.modelo_variante_fotos f
      ON  f.tenant_id = v_tenant AND f.modelo_id = _modelo_id
      AND f.variante_tecido_id  IS NOT DISTINCT FROM v.variante_tecido_id
      AND f.produto_variante_id IS NOT DISTINCT FROM v.produto_variante_id
      AND f.cor_id              IS NOT DISTINCT FROM v.cor_id
      AND f.cor_apelido_id      IS NOT DISTINCT FROM v.cor_apelido_id;

  RETURN v_res;
END;
$function$;

-- ======================================================================================================================================
-- 3) armario_variantes_disponiveis(uuid) — REEMITE com foto_path POR VARIANTE: coalesce(foto_da_variante, capa_do_modelo)
--    Identico ao corpo vivo a37fdd55, acrescido do LEFT JOIN em modelo_variante_fotos (IS NOT DISTINCT FROM na tupla) e do
--    campo 'foto_path' em cada variante. A capa do modelo (mo.foto) permanece como fallback no nivel da variante e do modelo.
-- ======================================================================================================================================
CREATE OR REPLACE FUNCTION public.armario_variantes_disponiveis(_armario_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_res    jsonb;
BEGIN
  -- [F7 armario ANO/MES] LEITURA: so confere login + loja; sem gate de pagina/modulo (leitura segue RLS/loja). TODAS as colecoes da loja.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'armario_nao_autenticado' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();

  WITH mods AS (
    SELECT m.id, m.nome::text AS nome, m.origem,
           coalesce(nullif(btrim(m.ref), ''), m.ref_auto) AS ref,
           coalesce(nullif(m.fotos_modelo[1], ''), nullif(m.desenho_tecnico_url, ''), nullif(m.croqui_url, '')) AS foto,
           m.categoria_principal_id, m.subcategoria1_id, m.linha_id, m.status_planejamento::text AS status_planejamento,
           m.mes_id, m.ano_id,
           -- faceta Colecao (rotulo): nome da colecao do OTB, senao o texto livre; vazio = null. Faceta Subcolecao: o texto do modelo.
           coalesce((SELECT c.nome::text FROM public.colecoes c WHERE c.id = m.colecao_id AND c.tenant_id = m.tenant_id),
                    nullif(btrim(coalesce(m.colecao, '')), '')) AS colecao_nome,
           nullif(btrim(coalesce(m.subcolecao, '')), '') AS subcolecao
      FROM public.modelos m
     WHERE m.tenant_id = v_tenant
  ),
  v_int AS (
    -- INTERNO = variantes do Tecido 1 do BOM (tipo 'tecido', numero 1); 1 por variante_tecido (menor ordem)
    SELECT DISTINCT ON (mo.id, vt.id)
           mo.id AS modelo_id, vt.id AS variante_tecido_id, NULL::uuid AS produto_variante_id,
           vt.cor_id, vt.cor_apelido_id, mtv.ordem
      FROM mods mo
      JOIN LATERAL (SELECT mt.id FROM public.modelo_tecidos mt
                     WHERE mt.modelo_id = mo.id AND mt.tipo = 'tecido' AND mt.numero = 1
                     ORDER BY mt.created_at, mt.id LIMIT 1) t1 ON true
      JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = t1.id
      JOIN public.variantes_tecido vt ON vt.id = mtv.variante_tecido_id
     WHERE mo.origem NOT IN ('revenda', 'importado') AND vt.cor_id IS NOT NULL
     ORDER BY mo.id, vt.id, mtv.ordem
  ),
  v_rev AS (
    SELECT mo.id AS modelo_id, NULL::uuid AS variante_tecido_id, pav.id AS produto_variante_id,
           pav.cor_id, pav.cor_apelido_id, pav.ordem
      FROM mods mo
      JOIN public.produtos_acabados pa ON pa.modelo_id = mo.id AND pa.tenant_id = v_tenant
      JOIN public.produto_acabado_variantes pav ON pav.produto_acabado_id = pa.id AND pav.tenant_id = v_tenant
     WHERE mo.origem = 'revenda' AND pav.cor_id IS NOT NULL
  ),
  v_imp AS (
    SELECT mo.id AS modelo_id, NULL::uuid AS variante_tecido_id, piv.id AS produto_variante_id,
           piv.cor_id, piv.cor_apelido_id, piv.ordem
      FROM mods mo
      JOIN public.produtos_importados pi ON pi.modelo_id = mo.id AND pi.tenant_id = v_tenant
      JOIN public.produto_importado_variantes piv ON piv.produto_importado_id = pi.id AND piv.tenant_id = v_tenant
     WHERE mo.origem = 'importado' AND piv.cor_id IS NOT NULL
  ),
  v_all AS (
    SELECT * FROM v_int UNION ALL SELECT * FROM v_rev UNION ALL SELECT * FROM v_imp
  ),
  v_json AS (
    SELECT v.modelo_id,
           jsonb_agg(jsonb_build_object(
             'variante_tecido_id',  v.variante_tecido_id,
             'produto_variante_id', v.produto_variante_id,
             'cor_id',              v.cor_id,
             'cor_apelido_id',      v.cor_apelido_id,
             'cor_nome',            (SELECT c.nome::text FROM public.cores c WHERE c.id = v.cor_id),
             'cor_apelido_nome',    (SELECT ca.nome::text FROM public.cores_apelido ca WHERE ca.id = v.cor_apelido_id),
             'ordem',               v.ordem,
             -- FOTO POR VARIANTE: foto da variante (modelo_variante_fotos) com FALLBACK na capa do modelo (mo.foto)
             'foto_path',           coalesce(fv.foto_path, mo.foto),
             'ja_em_outro',         x.com <> '[]'::jsonb,
             'armarios_com',        x.com
           ) ORDER BY v.ordem, v.variante_tecido_id, v.produto_variante_id) AS variantes
      FROM v_all v
      JOIN mods mo ON mo.id = v.modelo_id
      -- foto por variante (tupla de identidade; IS NOT DISTINCT FROM trata NULL como valor)
      LEFT JOIN public.modelo_variante_fotos fv
        ON  fv.tenant_id = v_tenant AND fv.modelo_id = v.modelo_id
        AND fv.variante_tecido_id  IS NOT DISTINCT FROM v.variante_tecido_id
        AND fv.produto_variante_id IS NOT DISTINCT FROM v.produto_variante_id
        AND fv.cor_id              IS NOT DISTINCT FROM v.cor_id
        AND fv.cor_apelido_id      IS NOT DISTINCT FROM v.cor_apelido_id
      CROSS JOIN LATERAL (
        -- tupla de identidade igual (espelho de chaveVariante), CROSS-colecao, mesma loja, armario <> o atual
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'nome', q.nome) ORDER BY q.ordem, q.nome, q.id), '[]'::jsonb) AS com
          FROM (SELECT DISTINCT a.id, a.nome::text AS nome, a.ordem
                  FROM public.armario_itens ai
                  JOIN public.armarios a ON a.id = ai.armario_id AND a.tenant_id = v_tenant
                 WHERE ai.tenant_id = v_tenant
                   AND ai.modelo_id = v.modelo_id
                   AND ai.variante_tecido_id  IS NOT DISTINCT FROM v.variante_tecido_id
                   AND ai.produto_variante_id IS NOT DISTINCT FROM v.produto_variante_id
                   AND ai.cor_id              IS NOT DISTINCT FROM v.cor_id
                   AND ai.cor_apelido_id      IS NOT DISTINCT FROM v.cor_apelido_id
                   AND (_armario_id IS NULL OR a.id <> _armario_id)) q
      ) x
     GROUP BY v.modelo_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'modelo_id',          mo.id,
           'nome',               mo.nome,
           'ref',                mo.ref,
           'foto_path',          mo.foto,
           'origem',             mo.origem,
           'em_desenvolvimento', j.variantes IS NULL,
           'variantes',          coalesce(j.variantes, '[]'::jsonb),
           -- facetas p/ os filtros do dialog: colecao/subcolecao/periodo + categoria/sub1/grupo(+Acessorios)/linha/status
           'colecao_nome',           mo.colecao_nome,
           'subcolecao',             mo.subcolecao,
           'categoria_principal_id', mo.categoria_principal_id,
           'categoria_nome',         cp.nome::text,
           'subcategoria1_id',       mo.subcategoria1_id,
           'subcategoria1_nome',     s1.nome::text,
           'grupo_id',               cp.grupo_id,
           'grupo_nome',             g.nome::text,
           'eh_acessorio',           coalesce(public._grupo_eh_acessorio(g.id), false),
           'linha_id',               mo.linha_id,
           'linha_nome',             li.nome::text,
           'status_planejamento',    mo.status_planejamento,
           'mes_id',                 mo.mes_id,
           'mes_nome',               me.mes::text,
           'mes_ordem',              me.ordem,
           'ano_id',                 mo.ano_id,
           'ano',                    an.ano
         ) ORDER BY mo.nome, mo.id), '[]'::jsonb)
    INTO v_res
    FROM mods mo
    LEFT JOIN v_json j ON j.modelo_id = mo.id
    -- todo join de apoio filtrado pela loja (a RPC e DEFINER: ignora RLS); grupo derivado via categoria (modelos nao tem grupo_id)
    LEFT JOIN public.categorias_produto     cp ON cp.id = mo.categoria_principal_id AND cp.tenant_id = v_tenant
    LEFT JOIN public.subcategorias1_produto s1 ON s1.id = mo.subcategoria1_id       AND s1.tenant_id = v_tenant
    LEFT JOIN public.grupos_produto         g  ON g.id  = cp.grupo_id               AND g.tenant_id  = v_tenant
    LEFT JOIN public.linhas                 li ON li.id = mo.linha_id               AND li.tenant_id = v_tenant
    LEFT JOIN public.meses                  me ON me.id = mo.mes_id                 AND me.tenant_id = v_tenant
    LEFT JOIN public.anos                   an ON an.id = mo.ano_id                 AND an.tenant_id = v_tenant;

  RETURN v_res;
END;
$function$;

-- ======================================================================================================================================
-- ACL: _core fechado (so o wrapper alcanca); wrappers so authenticated/service_role
-- ======================================================================================================================================
REVOKE EXECUTE ON FUNCTION public._modelo_variante_foto_salvar_core(uuid, uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.modelo_variante_foto_salvar(uuid, uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.modelo_variante_fotos_listar(uuid)                               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.armario_variantes_disponiveis(uuid)                              FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.modelo_variante_foto_salvar(uuid, uuid, uuid, uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.modelo_variante_fotos_listar(uuid)                               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.armario_variantes_disponiveis(uuid)                              TO authenticated, service_role;

DO $pos$
DECLARE
  v_core oid := to_regprocedure('public._modelo_variante_foto_salvar_core(uuid,uuid,uuid,uuid,uuid,text)');
  v_w    oid[] := ARRAY[
    to_regprocedure('public.modelo_variante_foto_salvar(uuid,uuid,uuid,uuid,uuid,text)'),
    to_regprocedure('public.modelo_variante_fotos_listar(uuid)'),
    to_regprocedure('public.armario_variantes_disponiveis(uuid)')];
  v_o oid;
BEGIN
  IF v_core IS NULL OR to_regclass('public.modelo_variante_fotos') IS NULL THEN
    RAISE EXCEPTION 'mvf_pos: funcao/tabela ausente' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', v_core, 'EXECUTE') OR has_function_privilege('authenticated', v_core, 'EXECUTE') THEN
    RAISE EXCEPTION 'mvf_pos: _core exposto' USING ERRCODE = 'P0001';
  END IF;
  FOREACH v_o IN ARRAY v_w LOOP
    IF v_o IS NULL THEN
      RAISE EXCEPTION 'mvf_pos: wrapper ausente' USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', v_o, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_o, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_o, 'EXECUTE') THEN
      RAISE EXCEPTION 'mvf_pos: grants errados no wrapper %', v_o::regprocedure USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = ANY (v_w || ARRAY[v_core]) AND a.grantee = 0) THEN
    RAISE EXCEPTION 'mvf_pos: PUBLIC com EXECUTE' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
