-- REF unificada — FASE 2 (parte 2): os 3 triggers passam a usar a config (montador + dígitos + piso).
--
-- Muda APENAS: (a) como a sigla é montada — via _ref_montar_sigla (config) com fallback à derivação
-- histórica de cada família; (b) a LARGURA do lpad — de fixa (8/7) para _ref_num_digitos(tenant);
-- (c) o PISO do contador — de fixo (10000000) para _ref_num_inicio(tenant).
-- TODA a lógica de FLUXO fica intacta: modelo interno mantém ref_auto/revelação/número-fixo/manual-
-- nunca-sobrescreve (invariante #11); acabado/importado mantêm "ref preenchida não regenera" (#13);
-- Acessórios idem. Diff-validar contra o baseline: só estas 3 trocas.
--
-- ⚠️ O fallback (config nula) reproduz a sigla ANTIGA por família:
--   - modelo interno: _modelo_ref_sigla(grupo,cat,sub) — 2+1+2, regra própria (SEM tratamento de
--     acessório: histórico do modelo interno nunca teve). MANTIDO idêntico p/ não mudar REF de quem
--     não configurar.
--   - acabado/importado: a fórmula _norm3 2+1+2 (ou 2+3 acessório) que já tinham.
-- Quando HÁ config de montagem (partes != null), TODAS as famílias usam _ref_montar_sigla (regra
-- única + acessório), como decidido.

BEGIN;

-- ── Wrappers de next_num: passam o PISO configurado por loja ───────────────────
CREATE OR REPLACE FUNCTION public._modelo_ref_next_num(_tenant uuid)
 RETURNS bigint LANGUAGE sql
AS $function$ SELECT public._ref_next_global(_tenant, public._ref_num_inicio(_tenant)); $function$;

CREATE OR REPLACE FUNCTION public._produto_acabado_ref_next(_tenant uuid)
 RETURNS bigint LANGUAGE sql
AS $function$ SELECT public._ref_next_global(_tenant, public._ref_num_inicio(_tenant)); $function$;

CREATE OR REPLACE FUNCTION public._produto_importado_ref_next(_tenant uuid)
 RETURNS bigint LANGUAGE sql
AS $function$ SELECT public._ref_next_global(_tenant, public._ref_num_inicio(_tenant)); $function$;

REVOKE EXECUTE ON FUNCTION public._modelo_ref_next_num(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._produto_acabado_ref_next(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._produto_importado_ref_next(uuid) FROM public, anon, authenticated;

-- ── Trigger MODELO INTERNO (invariante #11 — fluxo intacto, só sigla+largura configuráveis) ──
CREATE OR REPLACE FUNCTION public.fn_modelo_ref_auto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sigla text; v_grupo text; v_cat text; v_sub text; v_num bigint;
  v_revelar boolean;
  v_relevante boolean;
  v_grupo_id uuid;
  v_dig int;
BEGIN
  IF NOT coalesce(NEW.ordem_criacao_enviada, false) THEN RETURN NEW; END IF;  -- só após chegar em Dev

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

  -- Sigla configurável: _ref_montar_sigla retorna NULL quando a loja NÃO configurou a montagem —
  -- nesse caso cai no fallback DERIVADO histórico do modelo interno (_modelo_ref_sigla).
  v_sigla := public._ref_montar_sigla(NEW.tenant_id, 'interno', v_grupo_id, NEW.categoria_principal_id, NEW.subcategoria1_id, NULL);
  IF v_sigla IS NULL THEN
    v_sigla := public._modelo_ref_sigla(v_grupo, v_cat, v_sub);
  END IF;

  v_dig := public._ref_num_digitos(NEW.tenant_id);

  IF NOT v_revelar THEN
    -- Antes da etapa: mantém ref_auto. Número fixo (chegada); sigla re-sincroniza.
    IF v_sigla <> '' THEN
      IF coalesce(NEW.ref_auto,'') ~ '^[A-Za-z0-9-]*[0-9]+$' THEN
        v_num := substring(NEW.ref_auto from '([0-9]+)$')::bigint;
      ELSE
        v_num := public._modelo_ref_next_num(NEW.tenant_id);
      END IF;
      NEW.ref_auto := v_sigla || lpad(v_num::text, v_dig, '0');
    END IF;
  ELSE
    -- Atingiu a etapa: se ainda não há ref_auto, gera agora.
    IF coalesce(NEW.ref_auto,'') = '' AND v_sigla <> '' THEN
      v_num := public._modelo_ref_next_num(NEW.tenant_id);
      NEW.ref_auto := v_sigla || lpad(v_num::text, v_dig, '0');
    END IF;
    -- Revela: copia ref_auto → ref (exibida) se ref estiver vazio (manual nunca sobrescreve).
    IF coalesce(NEW.ref,'') = '' AND coalesce(NEW.ref_auto,'') <> '' THEN
      NEW.ref := NEW.ref_auto;
    END IF;
  END IF;

  RETURN NEW;
END $function$;

-- ── Trigger PRODUTO ACABADO (#13 — "ref preenchida não regenera" intacto) ─────
CREATE OR REPLACE FUNCTION public.fn_produto_acabado_ref()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sig text; v_dig int;
begin
  if new.ref is not null and new.ref <> '' then return new; end if;
  v_sig := public._ref_montar_sigla(new.tenant_id, 'acabado', new.grupo_id, new.categoria_id, new.subcategoria1_id, new.subcategoria2_id);
  if v_sig is null then
    -- fallback histórico (sem config de montagem)
    if public._grupo_eh_acessorio(new.grupo_id) then
      v_sig := substr(public._norm3((select nome from grupos_produto where id=new.grupo_id)),1,2)
            || public._norm3((select nome from categorias_produto where id=new.categoria_id));
    else
      v_sig := substr(public._norm3((select nome from grupos_produto where id=new.grupo_id)),1,2)
            || substr(public._norm3((select nome from categorias_produto where id=new.categoria_id)),1,1)
            || substr(public._norm3((select nome from subcategorias1_produto where id=new.subcategoria1_id)),1,2);
    end if;
  end if;
  v_dig := public._ref_num_digitos(new.tenant_id);
  new.ref := v_sig || lpad(public._produto_acabado_ref_next(new.tenant_id)::text, v_dig, '0');
  return new;
end $function$;

-- ── Trigger PRODUTO IMPORTADO (idem acabado) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_produto_importado_ref()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sig text; v_dig int;
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
  v_dig := public._ref_num_digitos(new.tenant_id);
  new.ref := v_sig || lpad(public._produto_importado_ref_next(new.tenant_id)::text, v_dig, '0');
  return new;
end $function$;

COMMIT;
