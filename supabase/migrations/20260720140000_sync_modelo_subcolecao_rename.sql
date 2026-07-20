-- Item 3: modelos.subcolecao é TEXTO desnormalizado (cópia do nome da subcoleção). Ao renomear
-- a subcoleção, os modelos guardavam o nome antigo → não casavam no Simulador (caíam em "Sem
-- subcoleção"). Trigger mantém modelos.subcolecao em dia quando colecao_subcolecoes.nome muda.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_sync_modelo_subcolecao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.nome IS DISTINCT FROM OLD.nome THEN
    UPDATE public.modelos
       SET subcolecao = NEW.nome
     WHERE colecao_id = NEW.colecao_id
       AND subcolecao = OLD.nome;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_modelo_subcolecao ON public.colecao_subcolecoes;
CREATE TRIGGER trg_sync_modelo_subcolecao
  AFTER UPDATE OF nome ON public.colecao_subcolecoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_modelo_subcolecao();

COMMIT;
