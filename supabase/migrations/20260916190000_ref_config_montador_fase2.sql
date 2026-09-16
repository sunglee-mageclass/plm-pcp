-- REF unificada — FASE 2: config por loja (montagem + siglas + dígitos/início) + montador.
--
-- Adiciona tenant_config.ref_config (jsonb) e as funções que LEEM essa config para montar a REF.
-- Os 3 triggers passam a: (1) montar a sigla via _ref_sigla_de(...) quando há config (senão caem no
-- fallback DERIVADO de hoje, byte-a-byte por família); (2) usar a largura (nº de dígitos) e o piso
-- (início) da config no lpad e no contador global (Fase 1).
--
-- ref_config (todos os campos OPCIONAIS; ausência = comportamento de hoje):
--   {
--     "partes":     ["familia","grupo","categoria","sub1","sub2","numero"],  -- só as marcadas, na ordem
--     "separador":  "",                    -- "" | "-" | "."  (default "")
--     "num_digitos": 8,                    -- largura do lpad (default 8)
--     "num_inicio":  10000000,             -- piso do contador (default 10000000)
--     "sigla_familia":   {"interno":"I","acabado":"A","importado":"M"},  -- vazio = default por família
--     "sigla_taxonomia": {"<uuid>":"OP", ...}                            -- só os sobrescritos
--   }
-- ⚠️ "partes" AUSENTE (config nula) => usa a montagem DERIVADA histórica de cada família (fallback).
--    "partes" PRESENTE => monta exatamente as partes marcadas, na ordem, com o separador.
--
-- Regra de sigla (decisão do dono): UMA fórmula automática p/ todas as famílias quando a sigla do
-- item não está configurada — 2 letras grupo + 1 categoria + 2 sub1 (Acessórios: 2 grupo + 3
-- categoria). A sigla CONFIGURADA (por uuid do grupo/cat/sub) sobrescreve a derivada.

BEGIN;

-- ── Coluna de config ──────────────────────────────────────────────────────────
ALTER TABLE public.tenant_config ADD COLUMN IF NOT EXISTS ref_config jsonb;

-- ── Helpers de leitura da config (largura/piso/separador/família) ─────────────
CREATE OR REPLACE FUNCTION public._ref_cfg(_tenant uuid)
 RETURNS jsonb LANGUAGE sql STABLE
AS $function$
  SELECT ref_config FROM public.tenant_config WHERE tenant_id = _tenant;
$function$;

CREATE OR REPLACE FUNCTION public._ref_num_digitos(_tenant uuid)
 RETURNS int LANGUAGE sql STABLE
AS $function$
  SELECT GREATEST(1, COALESCE(NULLIF(public._ref_cfg(_tenant)->>'num_digitos','')::int, 8));
$function$;

CREATE OR REPLACE FUNCTION public._ref_num_inicio(_tenant uuid)
 RETURNS bigint LANGUAGE sql STABLE
AS $function$
  SELECT COALESCE(NULLIF(public._ref_cfg(_tenant)->>'num_inicio','')::bigint, 10000000);
$function$;

-- Sigla DERIVADA de um item de taxonomia (regra única). _tipo ∈ 'grupo'|'categoria'|'sub1'|'sub2'.
-- Só existe p/ compor o fallback e o modo "derivar quando não configurado". Reusa _norm3.
CREATE OR REPLACE FUNCTION public._ref_sigla_derivada(_tenant uuid, _grupo_id uuid, _cat_id uuid, _sub1_id uuid, _sub2_id uuid)
 RETURNS text LANGUAGE plpgsql STABLE
AS $function$
DECLARE v_sig text;
BEGIN
  IF public._grupo_eh_acessorio(_grupo_id) THEN
    -- Acessórios: 2 letras grupo + 3 categoria (regra especial preservada).
    v_sig := substr(public._norm3((SELECT nome FROM grupos_produto WHERE id=_grupo_id)),1,2)
          || public._norm3((SELECT nome FROM categorias_produto WHERE id=_cat_id));
  ELSE
    v_sig := substr(public._norm3((SELECT nome FROM grupos_produto WHERE id=_grupo_id)),1,2)
          || substr(public._norm3((SELECT nome FROM categorias_produto WHERE id=_cat_id)),1,1)
          || substr(public._norm3((SELECT nome FROM subcategorias1_produto WHERE id=_sub1_id)),1,2);
  END IF;
  RETURN coalesce(v_sig,'');
END $function$;

-- Sigla CONFIGURADA de um item específico (por uuid), ou '' se não configurada. Normaliza livre
-- (tira espaço/acento via _norm-ish, corta em 6 — mesma política do front).
CREATE OR REPLACE FUNCTION public._ref_sigla_cfg_item(_tenant uuid, _id uuid)
 RETURNS text LANGUAGE sql STABLE
AS $function$
  SELECT substr(upper(regexp_replace(
    translate(coalesce(public._ref_cfg(_tenant)->'sigla_taxonomia'->>(_id::text),''),
      'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑ',
      'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnN'),
    '[^A-Za-z0-9]','','g')),1,6);
$function$;

-- Marcador de FAMÍLIA (config → default). _familia ∈ 'interno'|'acabado'|'importado'.
CREATE OR REPLACE FUNCTION public._ref_sigla_familia(_tenant uuid, _familia text)
 RETURNS text LANGUAGE sql STABLE
AS $function$
  SELECT substr(upper(regexp_replace(translate(
    COALESCE(
      NULLIF(public._ref_cfg(_tenant)->'sigla_familia'->>_familia, ''),
      CASE _familia WHEN 'interno' THEN 'I' WHEN 'acabado' THEN 'A' WHEN 'importado' THEN 'M' ELSE '' END
    ),
    'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑ',
    'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnN'),
    '[^A-Za-z0-9]','','g')),1,6);
$function$;

-- ── MONTADOR da sigla completa (família + taxonomia), SEM o número ────────────
-- Retorna a PARTE ALFABÉTICA da REF (o número é anexado pelo trigger, que controla lpad/revelação).
-- Se ref_config->'partes' é NULL (loja não configurou a montagem) => retorna NULL => o trigger usa
-- o fallback DERIVADO histórico daquela família.
CREATE OR REPLACE FUNCTION public._ref_montar_sigla(_tenant uuid, _familia text, _grupo_id uuid, _cat_id uuid, _sub1_id uuid, _sub2_id uuid)
 RETURNS text LANGUAGE plpgsql STABLE
AS $function$
DECLARE
  v_partes jsonb; v_sep text; v_out text[] := '{}'; v_p text; v_val text;
BEGIN
  v_partes := public._ref_cfg(_tenant)->'partes';
  IF v_partes IS NULL OR jsonb_typeof(v_partes) <> 'array' THEN
    RETURN NULL;  -- sem config de montagem: sinaliza fallback histórico ao trigger
  END IF;
  v_sep := COALESCE(public._ref_cfg(_tenant)->>'separador', '');
  FOR v_p IN SELECT jsonb_array_elements_text(v_partes) LOOP
    v_val := NULL;
    IF v_p = 'familia' THEN
      v_val := public._ref_sigla_familia(_tenant, _familia);
    ELSIF v_p = 'grupo' THEN
      v_val := NULLIF(public._ref_sigla_cfg_item(_tenant, _grupo_id), '');
      IF v_val IS NULL THEN v_val := substr(public._norm3((SELECT nome FROM grupos_produto WHERE id=_grupo_id)),1,2); END IF;
    ELSIF v_p = 'categoria' THEN
      v_val := NULLIF(public._ref_sigla_cfg_item(_tenant, _cat_id), '');
      IF v_val IS NULL THEN v_val := substr(public._norm3((SELECT nome FROM categorias_produto WHERE id=_cat_id)),1,1); END IF;
    ELSIF v_p = 'sub1' THEN
      v_val := NULLIF(public._ref_sigla_cfg_item(_tenant, _sub1_id), '');
      IF v_val IS NULL THEN v_val := substr(public._norm3((SELECT nome FROM subcategorias1_produto WHERE id=_sub1_id)),1,2); END IF;
    ELSIF v_p = 'sub2' THEN
      v_val := NULLIF(public._ref_sigla_cfg_item(_tenant, _sub2_id), '');
      IF v_val IS NULL THEN v_val := substr(public._norm3((SELECT nome FROM subcategorias2_produto WHERE id=_sub2_id)),1,2); END IF;
    ELSIF v_p = 'numero' THEN
      CONTINUE;  -- o número é anexado pelo trigger (controla lpad/largura/revelação)
    ELSE
      CONTINUE;  -- parte desconhecida: ignora
    END IF;
    IF v_val IS NOT NULL AND v_val <> '' THEN v_out := array_append(v_out, v_val); END IF;
  END LOOP;
  RETURN array_to_string(v_out, v_sep);
END $function$;

-- REVOKE (invariante #9) — só as triggers DEFINER chamam.
REVOKE EXECUTE ON FUNCTION public._ref_cfg(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._ref_num_digitos(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._ref_num_inicio(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._ref_sigla_derivada(uuid, uuid, uuid, uuid, uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._ref_sigla_cfg_item(uuid, uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._ref_sigla_familia(uuid, text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._ref_montar_sigla(uuid, text, uuid, uuid, uuid, uuid) FROM public, anon, authenticated;

COMMIT;
