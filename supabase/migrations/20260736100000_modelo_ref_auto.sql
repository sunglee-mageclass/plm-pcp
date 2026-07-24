-- REF automática do modelo ao CHEGAR em Desenvolvimento (ordem_criacao_enviada=true).
-- Prefixo (sigla) = Grupo + Categoria + Subcategoria1:
--   Grupo: 1 palavra → 2 primeiras letras; 2+ palavras → inicial das 2 primeiras palavras
--          (ex.: "Top" → "TO", "One Piece" → "OP").
--   Categoria: 1ª letra.
--   Subcategoria1: 1 palavra → 2 primeiras letras; 2+ palavras → inicial de CADA palavra
--          (ex.: "Manga Curta" → "MC").
--   Ex.: Top/Blusa/Manga Curta → "TOBMC".
-- Número = 8 dígitos, contador ÚNICO por loja a partir de 10000000.
--
-- A REF é "guardada mas só exibida quando aprovado": o valor automático é mantido numa
-- coluna sombra `ref_auto` enquanto o modelo NÃO está 'aprovado' (número fixado na chegada,
-- sigla re-sincroniza com grupo/cat/subcat — a subcategoria só é definida durante o
-- Desenvolvimento). Ao ficar 'aprovado', copia `ref_auto` → `ref` (a coluna exibida na UI),
-- se `ref` estiver vazio. `ref` continua editável (manual sobrescreve). Assim NENHUM ponto de
-- exibição precisa mudar: `ref` fica vazio até a aprovação.

BEGIN;

ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS ref_auto text;

-- Normaliza p/ sigla: sem acento, só letras/espaços, maiúsculas.
CREATE OR REPLACE FUNCTION public._ref_norm(_s text)
 RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(regexp_replace(
    translate(coalesce(_s,''),
      'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑ',
      'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnN'),
    '[^A-Za-z ]', '', 'g'));
$$;

-- Sigla da REF.
CREATE OR REPLACE FUNCTION public._modelo_ref_sigla(_grupo text, _cat text, _sub text)
 RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v text := '';
  g text := trim(public._ref_norm(_grupo));
  c text := trim(public._ref_norm(_cat));
  s text := trim(public._ref_norm(_sub));
  parts text[];
  w text;
BEGIN
  -- Grupo: 2 iniciais (1 palavra → 2 letras; 2+ palavras → inicial das 2 primeiras).
  IF g <> '' THEN
    parts := regexp_split_to_array(g, '\s+');
    IF coalesce(array_length(parts,1),0) <= 1 THEN
      v := v || substring(g from 1 for 2);
    ELSE
      v := v || substring(parts[1] from 1 for 1) || substring(parts[2] from 1 for 1);
    END IF;
  END IF;
  -- Categoria: 1ª letra.
  IF c <> '' THEN v := v || substring(replace(c,' ','') from 1 for 1); END IF;
  -- Subcategoria: 1 palavra → 2 letras; 2+ palavras → inicial de cada palavra.
  IF s <> '' THEN
    parts := regexp_split_to_array(s, '\s+');
    IF coalesce(array_length(parts,1),0) <= 1 THEN
      v := v || substring(replace(s,' ','') from 1 for 2);
    ELSE
      FOREACH w IN ARRAY parts LOOP
        IF w <> '' THEN v := v || substring(w from 1 for 1); END IF;
      END LOOP;
    END IF;
  END IF;
  RETURN v;
END $$;

-- Próximo número do contador ÚNICO por loja (>= 10000000), olhando ref_auto E ref.
CREATE OR REPLACE FUNCTION public._modelo_ref_next_num(_tenant uuid)
 RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('modelo_ref:' || _tenant::text));
  SELECT COALESCE(max(n), 9999999) + 1 INTO v FROM (
    SELECT substring(ref_auto from '([0-9]{8})$')::bigint AS n
      FROM public.modelos WHERE tenant_id = _tenant AND ref_auto ~ '^[A-Za-z]+[0-9]{8}$'
    UNION ALL
    SELECT substring(ref from '([0-9]{8})$')::bigint
      FROM public.modelos WHERE tenant_id = _tenant AND ref ~ '^[A-Za-z]+[0-9]{8}$'
  ) x;
  IF v < 10000000 THEN v := 10000000; END IF;
  RETURN v;
END $$;

-- Trigger: mantém ref_auto (pré-aprovação) e revela em ref (na aprovação).
CREATE OR REPLACE FUNCTION public.fn_modelo_ref_auto()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sigla text; v_grupo text; v_cat text; v_sub text; v_num bigint;
  v_aprovado boolean := lower(coalesce(NEW.status_desenvolvimento,'')) = 'aprovado';
  v_relevante boolean;
BEGIN
  IF NOT coalesce(NEW.ordem_criacao_enviada, false) THEN RETURN NEW; END IF;  -- só após chegar em Dev

  v_relevante := (TG_OP = 'INSERT')
    OR (NEW.ordem_criacao_enviada IS DISTINCT FROM OLD.ordem_criacao_enviada)
    OR (NEW.categoria_principal_id IS DISTINCT FROM OLD.categoria_principal_id)
    OR (NEW.subcategoria1_id IS DISTINCT FROM OLD.subcategoria1_id)
    OR (NEW.status_desenvolvimento IS DISTINCT FROM OLD.status_desenvolvimento)
    OR (coalesce(NEW.ref_auto,'') = '');
  IF NOT v_relevante THEN RETURN NEW; END IF;

  SELECT c.nome, gp.nome INTO v_cat, v_grupo
    FROM public.categorias_produto c
    LEFT JOIN public.grupos_produto gp ON gp.id = c.grupo_id
    WHERE c.id = NEW.categoria_principal_id;
  SELECT s.nome INTO v_sub FROM public.subcategorias1_produto s WHERE s.id = NEW.subcategoria1_id;
  v_sigla := public._modelo_ref_sigla(v_grupo, v_cat, v_sub);

  IF NOT v_aprovado THEN
    -- Pré-aprovação: mantém ref_auto. Número fixo (chegada); sigla re-sincroniza.
    IF v_sigla <> '' THEN
      IF coalesce(NEW.ref_auto,'') ~ '^[A-Za-z]+[0-9]{8}$' THEN
        v_num := substring(NEW.ref_auto from '([0-9]{8})$')::bigint;
      ELSE
        v_num := public._modelo_ref_next_num(NEW.tenant_id);
      END IF;
      NEW.ref_auto := v_sigla || lpad(v_num::text, 8, '0');
    END IF;
  ELSE
    -- Aprovado: se ainda não há ref_auto, gera agora (grupo/cat/subcat já definidos).
    IF coalesce(NEW.ref_auto,'') = '' AND v_sigla <> '' THEN
      v_num := public._modelo_ref_next_num(NEW.tenant_id);
      NEW.ref_auto := v_sigla || lpad(v_num::text, 8, '0');
    END IF;
    -- Revela: copia ref_auto → ref (exibida) se ref estiver vazio.
    IF coalesce(NEW.ref,'') = '' AND coalesce(NEW.ref_auto,'') <> '' THEN
      NEW.ref := NEW.ref_auto;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_modelo_ref_auto ON public.modelos;
CREATE TRIGGER trg_modelo_ref_auto BEFORE INSERT OR UPDATE ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_modelo_ref_auto();

-- Backfill ref_auto p/ modelos já em Desenvolvimento (número sequencial por loja).
WITH base AS (
  SELECT m.id, m.tenant_id, m.created_at, lower(coalesce(m.status_desenvolvimento,'')) AS st,
    coalesce(m.ref,'') AS ref_atual,
    public._modelo_ref_sigla(gp.nome, c.nome, s.nome) AS sigla
  FROM public.modelos m
  LEFT JOIN public.categorias_produto c ON c.id = m.categoria_principal_id
  LEFT JOIN public.grupos_produto gp ON gp.id = c.grupo_id
  LEFT JOIN public.subcategorias1_produto s ON s.id = m.subcategoria1_id
  WHERE coalesce(m.ordem_criacao_enviada,false) = true AND coalesce(m.ref_auto,'') = ''
),
maxes AS (
  SELECT tenant_id, COALESCE(max(n), 9999999) AS maxnum FROM (
    SELECT tenant_id, substring(ref_auto from '([0-9]{8})$')::bigint AS n FROM public.modelos WHERE ref_auto ~ '^[A-Za-z]+[0-9]{8}$'
    UNION ALL
    SELECT tenant_id, substring(ref from '([0-9]{8})$')::bigint FROM public.modelos WHERE ref ~ '^[A-Za-z]+[0-9]{8}$'
  ) y GROUP BY tenant_id
),
ranked AS (
  SELECT b.id, b.sigla, b.st, b.ref_atual,
    GREATEST(COALESCE(mx.maxnum, 9999999) + row_number() OVER (PARTITION BY b.tenant_id ORDER BY b.created_at, b.id), 10000000) AS num
  FROM base b LEFT JOIN maxes mx ON mx.tenant_id = b.tenant_id
  WHERE b.sigla <> ''
)
UPDATE public.modelos m
SET ref_auto = r.sigla || lpad(r.num::text, 8, '0'),
    -- aprovados sem ref já revelam
    ref = CASE WHEN r.st = 'aprovado' AND r.ref_atual = '' THEN r.sigla || lpad(r.num::text, 8, '0') ELSE m.ref END
FROM ranked r WHERE m.id = r.id;

COMMIT;

select pg_notify('pgrst','reload schema');
