-- REF unificada — FIX da Fase 2: largura do número (lpad NÃO pode truncar) + separador antes do nº.
--
-- BUG achado em teste transacional: `lpad(x, N, '0')` do Postgres TRUNCA quando x tem MAIS de N
-- caracteres (lpad('10000012', 6) = '100000') — não é "só completa à esquerda". Com o contador
-- global de 8 dígitos e uma loja configurando num_digitos=6, a REF era cortada → colisão de novo.
--
-- Correção:
--   1. _ref_num_fmt(tenant, num): formata o número com LARGURA MÍNIMA = num_digitos (nunca trunca —
--      usa GREATEST(num_digitos, length)). num_digitos é piso de zeros à esquerda, não teto.
--   2. Quando a montagem está configurada (partes != null) E "numero" está nas partes, o número
--      entra respeitando o SEPARADOR (antes era anexado colado à sigla). Se a config NÃO lista
--      "numero", o número NÃO entra na REF (a loja decidiu não usar — raro, mas possível).
--   3. Fallback (sem config): número colado à sigla, largura = num_digitos (default 8), como hoje.

BEGIN;

-- ── Formata o número: largura MÍNIMA num_digitos, nunca trunca ─────────────────
CREATE OR REPLACE FUNCTION public._ref_num_fmt(_tenant uuid, _num bigint)
 RETURNS text LANGUAGE sql STABLE
AS $function$
  SELECT lpad(_num::text, GREATEST(public._ref_num_digitos(_tenant), length(_num::text)), '0');
$function$;

REVOKE EXECUTE ON FUNCTION public._ref_num_fmt(uuid, bigint) FROM public, anon, authenticated;

-- ── "numero" está nas partes configuradas? (default true quando não há config) ─
CREATE OR REPLACE FUNCTION public._ref_usa_numero(_tenant uuid)
 RETURNS boolean LANGUAGE sql STABLE
AS $function$
  SELECT CASE
    WHEN public._ref_cfg(_tenant)->'partes' IS NULL THEN true  -- sem config: número sempre entra
    ELSE public._ref_cfg(_tenant)->'partes' ? 'numero'
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public._ref_usa_numero(uuid) FROM public, anon, authenticated;

-- ── Junta sigla + número respeitando o separador ──────────────────────────────
-- _sig = parte alfabética já montada (pode ser ''); _num = número já formatado.
-- Se a config lista "numero" e há sigla, usa o separador entre elas; senão, cola (fallback).
CREATE OR REPLACE FUNCTION public._ref_juntar(_tenant uuid, _sig text, _num text)
 RETURNS text LANGUAGE sql STABLE
AS $function$
  SELECT CASE
    WHEN NOT public._ref_usa_numero(_tenant) THEN coalesce(_sig,'')  -- número não entra
    WHEN coalesce(_sig,'') = '' THEN _num
    WHEN public._ref_cfg(_tenant)->'partes' IS NOT NULL
      THEN _sig || COALESCE(public._ref_cfg(_tenant)->>'separador','') || _num  -- configurado: separador
    ELSE _sig || _num  -- fallback histórico: colado
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public._ref_juntar(uuid, text, text) FROM public, anon, authenticated;

-- ── Re-aplica os 3 triggers usando _ref_num_fmt + _ref_juntar ─────────────────
CREATE OR REPLACE FUNCTION public.fn_modelo_ref_auto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sigla text; v_grupo text; v_cat text; v_sub text; v_num bigint;
  v_revelar boolean; v_relevante boolean; v_grupo_id uuid;
BEGIN
  IF NOT coalesce(NEW.ordem_criacao_enviada, false) THEN RETURN NEW; END IF;

  v_relevante := (TG_OP = 'INSERT')
    OR (NEW.ordem_criacao_enviada IS DISTINCT FROM OLD.ordem_criacao_enviada)
    OR (NEW.categoria_principal_id IS DISTINCT FROM OLD.categoria_principal_id)
    OR (NEW.subcategoria1_id IS DISTINCT FROM OLD.subcategoria1_id)
    OR (NEW.status_desenvolvimento IS DISTINCT FROM OLD.status_desenvolvimento)
    OR (coalesce(NEW.ref_auto,'') = '');
  IF NOT v_relevante THEN RETURN NEW; END IF;

  v_revelar := public._ref_exibir_gate(NEW.tenant_id, NEW.status_desenvolvimento);

  SELECT c.nome, gp.nome, c.grupo_id INTO v_cat, v_grupo, v_grupo_id
    FROM public.categorias_produto c
    LEFT JOIN public.grupos_produto gp ON gp.id = c.grupo_id
    WHERE c.id = NEW.categoria_principal_id;
  SELECT s.nome INTO v_sub FROM public.subcategorias1_produto s WHERE s.id = NEW.subcategoria1_id;

  v_sigla := public._ref_montar_sigla(NEW.tenant_id, 'interno', v_grupo_id, NEW.categoria_principal_id, NEW.subcategoria1_id, NULL);
  IF v_sigla IS NULL THEN
    v_sigla := public._modelo_ref_sigla(v_grupo, v_cat, v_sub);
  END IF;

  IF NOT v_revelar THEN
    IF v_sigla <> '' THEN
      -- Número fixo na chegada: extrai o bloco final de dígitos do ref_auto atual, senão gera.
      IF coalesce(NEW.ref_auto,'') ~ '[0-9]+$' THEN
        v_num := substring(NEW.ref_auto from '([0-9]+)$')::bigint;
      ELSE
        v_num := public._modelo_ref_next_num(NEW.tenant_id);
      END IF;
      NEW.ref_auto := public._ref_juntar(NEW.tenant_id, v_sigla, public._ref_num_fmt(NEW.tenant_id, v_num));
    END IF;
  ELSE
    IF coalesce(NEW.ref_auto,'') = '' AND v_sigla <> '' THEN
      v_num := public._modelo_ref_next_num(NEW.tenant_id);
      NEW.ref_auto := public._ref_juntar(NEW.tenant_id, v_sigla, public._ref_num_fmt(NEW.tenant_id, v_num));
    END IF;
    IF coalesce(NEW.ref,'') = '' AND coalesce(NEW.ref_auto,'') <> '' THEN
      NEW.ref := NEW.ref_auto;
    END IF;
  END IF;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_produto_acabado_ref()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_sig text;
begin
  if new.ref is not null and new.ref <> '' then return new; end if;
  v_sig := public._ref_montar_sigla(new.tenant_id, 'acabado', new.grupo_id, new.categoria_id, new.subcategoria1_id, new.subcategoria2_id);
  if v_sig is null then
    if public._grupo_eh_acessorio(new.grupo_id) then
      v_sig := substr(public._norm3((select nome from grupos_produto where id=new.grupo_id)),1,2)
            || public._norm3((select nome from categorias_produto where id=new.categoria_id));
    else
      v_sig := substr(public._norm3((select nome from grupos_produto where id=new.grupo_id)),1,2)
            || substr(public._norm3((select nome from categorias_produto where id=new.categoria_id)),1,1)
            || substr(public._norm3((select nome from subcategorias1_produto where id=new.subcategoria1_id)),1,2);
    end if;
  end if;
  new.ref := public._ref_juntar(new.tenant_id, v_sig, public._ref_num_fmt(new.tenant_id, public._produto_acabado_ref_next(new.tenant_id)));
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.fn_produto_importado_ref()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_sig text;
begin
  if new.ref is not null and new.ref <> '' then return new; end if;
  v_sig := public._ref_montar_sigla(new.tenant_id, 'importado', new.grupo_id, new.categoria_id, new.subcategoria1_id, new.subcategoria2_id);
  if v_sig is null then
    if public._grupo_eh_acessorio(new.grupo_id) then
      v_sig := substr(public._norm3((select nome from grupos_produto where id=new.grupo_id)),1,2)
            || public._norm3((select nome from categorias_produto where id=new.categoria_id));
    else
      v_sig := substr(public._norm3((select nome from grupos_produto where id=new.grupo_id)),1,2)
            || substr(public._norm3((select nome from categorias_produto where id=new.categoria_id)),1,1)
            || substr(public._norm3((select nome from subcategorias1_produto where id=new.subcategoria1_id)),1,2);
    end if;
  end if;
  new.ref := public._ref_juntar(new.tenant_id, v_sig, public._ref_num_fmt(new.tenant_id, public._produto_importado_ref_next(new.tenant_id)));
  return new;
end $function$;

COMMIT;
