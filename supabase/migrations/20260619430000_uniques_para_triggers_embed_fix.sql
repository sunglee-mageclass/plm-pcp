-- REGRESSÃO do 20260619410000 (P0-7): UNIQUE em coluna ÚNICA (cad.modelo_id,
-- controle_qualidade.cad_id, producao_oficina.cad_id, lancamentos.cad_id) fez o
-- PostgREST reinterpretar o embed modelos->cad (e cad->cq/oficina/lancamentos)
-- de array (to-many) para objeto (to-one). Isso quebrou 8 telas que tratam o
-- embed como array (`m.cad?.[0]`, `(m.cad ?? []).some(...)`):
--   - Estoque: "(m.cad ?? []).some is not a function"
--   - Gates de produção: `m.cad?.[0]?.enviado_corte` vira undefined → modelo
--     não avança para Serviços.
--
-- Correção: manter a invariante "1:1" mas trocar o mecanismo de UNIQUE para
-- TRIGGER (não altera a cardinalidade detectada pelo PostgREST). A UNIQUE
-- COMPOSTA cad_grades(cad_id,variante_numero) é mantida (não vira o embed e é a
-- chave natural útil para upsert).

-- 1) Remove as UNIQUEs de coluna única que viraram o embed.
ALTER TABLE public.cad                DROP CONSTRAINT IF EXISTS cad_modelo_id_key;
ALTER TABLE public.controle_qualidade DROP CONSTRAINT IF EXISTS controle_qualidade_cad_key;
ALTER TABLE public.producao_oficina   DROP CONSTRAINT IF EXISTS producao_oficina_cad_key;
ALTER TABLE public.lancamentos        DROP CONSTRAINT IF EXISTS lancamentos_cad_key;

-- 2) Função genérica: garante 1 registro por valor da coluna FK (passada em TG_ARGV[0]).
CREATE OR REPLACE FUNCTION public.enforce_unique_fk()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_col text := TG_ARGV[0];
  v_val uuid;
  v_exists boolean;
BEGIN
  v_val := (to_jsonb(NEW) ->> v_col)::uuid;
  IF v_val IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format(
    'SELECT EXISTS(SELECT 1 FROM public.%I WHERE %I = $1 AND id IS DISTINCT FROM $2)',
    TG_TABLE_NAME, v_col
  ) INTO v_exists USING v_val, NEW.id;
  IF v_exists THEN
    RAISE EXCEPTION 'Já existe registro em % para %=% (invariante 1:1)', TG_TABLE_NAME, v_col, v_val
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- 3) Triggers que substituem as UNIQUEs (BEFORE INSERT/UPDATE só da coluna FK).
DROP TRIGGER IF EXISTS trg_cad_unique_modelo ON public.cad;
CREATE TRIGGER trg_cad_unique_modelo
  BEFORE INSERT OR UPDATE OF modelo_id ON public.cad
  FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_fk('modelo_id');

DROP TRIGGER IF EXISTS trg_cq_unique_cad ON public.controle_qualidade;
CREATE TRIGGER trg_cq_unique_cad
  BEFORE INSERT OR UPDATE OF cad_id ON public.controle_qualidade
  FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_fk('cad_id');

DROP TRIGGER IF EXISTS trg_oficina_unique_cad ON public.producao_oficina;
CREATE TRIGGER trg_oficina_unique_cad
  BEFORE INSERT OR UPDATE OF cad_id ON public.producao_oficina
  FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_fk('cad_id');

DROP TRIGGER IF EXISTS trg_lancamentos_unique_cad ON public.lancamentos;
CREATE TRIGGER trg_lancamentos_unique_cad
  BEFORE INSERT OR UPDATE OF cad_id ON public.lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_fk('cad_id');

-- 4) PostgREST volta a tratar os embeds como array.
NOTIFY pgrst, 'reload schema';
