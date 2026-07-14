-- Cadastro > Aviamentos: código automático por aviamento = SIGLA (3 letras da categoria)
-- + "-" + sequencial de 4 dígitos POR SIGLA (por tenant). Ex.: Zíper→ZIP-0001, Cinto→CIN-0001.
-- Gerado no servidor (trigger BEFORE INSERT, imutável após criado) + índice único por tenant.

BEGIN;

-- Sigla = 3 primeiras LETRAS da categoria, sem acento, maiúsculas. Ex.: "Zíper"→"ZIP".
CREATE OR REPLACE FUNCTION public._aviamento_sigla(_nome text)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$
  SELECT upper(substring(
    regexp_replace(
      translate(coalesce(_nome, ''),
        'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑ',
        'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnN'),
      '[^A-Za-z]', '', 'g'),
    1, 3));
$function$;

ALTER TABLE public.aviamentos ADD COLUMN IF NOT EXISTS codigo text;

-- Trigger: gera o código no INSERT se veio vazio e há categoria. Não mexe em UPDATE
-- (identificador estável). DEFINER p/ ler categoria/max ignorando RLS (filtra por tenant).
CREATE OR REPLACE FUNCTION public.fn_aviamento_codigo()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sigla text;
  v_num int;
BEGIN
  IF NEW.codigo IS NOT NULL AND NEW.codigo <> '' THEN RETURN NEW; END IF;
  IF NEW.categoria_aviamento_id IS NULL THEN RETURN NEW; END IF;  -- sem categoria = sem código
  SELECT public._aviamento_sigla(c.nome) INTO v_sigla
    FROM public.categorias_aviamento c WHERE c.id = NEW.categoria_aviamento_id;
  IF v_sigla IS NULL OR v_sigla = '' THEN v_sigla := 'AVI'; END IF;
  SELECT COALESCE(max((substring(codigo from '(\d+)$'))::int), 0) + 1 INTO v_num
    FROM public.aviamentos
    WHERE tenant_id = NEW.tenant_id AND codigo ~ ('^' || v_sigla || '-[0-9]+$');
  NEW.codigo := v_sigla || '-' || lpad(v_num::text, 4, '0');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_aviamento_codigo ON public.aviamentos;
CREATE TRIGGER trg_aviamento_codigo BEFORE INSERT ON public.aviamentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_aviamento_codigo();

-- Backfill dos existentes (numera por SIGLA, na ordem de criação).
WITH base AS (
  SELECT a.id, a.tenant_id, a.created_at, NULLIF(public._aviamento_sigla(c.nome), '') AS sigla
  FROM public.aviamentos a
  JOIN public.categorias_aviamento c ON c.id = a.categoria_aviamento_id
  WHERE (a.codigo IS NULL OR a.codigo = '') AND a.categoria_aviamento_id IS NOT NULL
),
ranked AS (
  SELECT id, COALESCE(sigla, 'AVI') AS sigla,
    row_number() OVER (PARTITION BY tenant_id, COALESCE(sigla, 'AVI') ORDER BY created_at, id) AS rn
  FROM base
)
UPDATE public.aviamentos a
SET codigo = r.sigla || '-' || lpad(r.rn::text, 4, '0')
FROM ranked r WHERE a.id = r.id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_aviamentos_tenant_codigo
  ON public.aviamentos(tenant_id, codigo) WHERE codigo IS NOT NULL;

COMMIT;
