-- F7 · Armario - Task A2, BANCO: gatilho de TRAVA "publicado" em `armarios` + `armario_itens`.
-- Plano: docs/superpowers/plans/2026-11-16-f7-armario.md (Task A2). Molde: trg_aaa_seg_pagina da S3 (20261101120000_seg_s3a_guarda_oc.sql).
--
-- Armario PUBLICADO e SO-LEITURA (espelha a trava da Integracao de produtos). O servidor impoe, o front so reflete:
--   * armarios: UPDATE/DELETE de um armario cujo status e 'publicado' e RECUSADO, EXCETO o UPDATE que muda SO a coluna `status`
--     de 'publicado' para 'pronto' (a DESPUBLICACAO). Qualquer outra coluna junto (nome, colunas, ordem, tenant_id...) = recusa.
--   * armario_itens: qualquer INSERT/UPDATE/DELETE num item cujo armario-pai esta publicado e RECUSADO (no UPDATE confere o pai
--     antigo E o novo - mover item de/para um armario publicado tambem e recusado).
--   * Recusa = RAISE EXCEPTION 'armario_publicado_travado: ...' USING ERRCODE = 'P0001' (so ASCII: RAISE que vira 5xx perde o acento).
--
-- SECURITY INVOKER de proposito (mesmo mecanismo da S3): SO MORDE quem grava como o PAPEL do cliente (current_user authenticated/anon =
-- PostgREST). Passam: funcoes SECURITY DEFINER (dono postgres - as RPCs de publicar/despublicar/salvar conferem o proprio estado),
-- CASCADE de FK (roda como o dono: apagar um armario NAO publicado leva os itens; o publicado ja e recusado antes), migrations/psql
-- e service_role (Worker). Prefixo `aaa` no nome: BEFORE dispara em ordem alfabetica - roda ANTES do set_tenant_id_trg.
-- A leitura do pai em armario_itens usa FOR SHARE: uma publicacao concorrente espera o item commitar (sem janela de corrida).
--
-- Idempotente (CREATE OR REPLACE FUNCTION/TRIGGER). So objetos NOVOS; so CREATE TRIGGER (ShareRowExclusive por um instante) nas 2 tabelas
-- novas (sem trafego antes do deploy). Aplicar FORA de transacao: psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f <este arquivo>
-- NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza). Volta: supabase/rollback/20261202110000_armario_trava_publicado_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.fn_armario_trava_publicado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [armario A2] trava "publicado" na escrita DIRETA do cliente (authenticated/anon). INVOKER: so morde o papel do PostgREST.
DECLARE
  v_pub boolean;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'armarios' THEN
    -- INSERT: nao ha armario publicado pre-existente a proteger (o estado so avanca pelas RPCs/UPDATE abaixo).
    IF TG_OP = 'UPDATE' AND OLD.status = 'publicado' THEN
      -- unica escrita permitida: a despublicacao (status publicado -> pronto, NENHUMA outra coluna muda)
      IF NEW.status = 'pronto' AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'armario_publicado_travado: armario publicado e so-leitura (despublique antes de editar)' USING ERRCODE = 'P0001';
    ELSIF TG_OP = 'DELETE' AND OLD.status = 'publicado' THEN
      RAISE EXCEPTION 'armario_publicado_travado: armario publicado nao pode ser excluido (despublique antes)' USING ERRCODE = 'P0001';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- armario_itens: o pai (antigo e/ou novo) nao pode estar publicado
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT (a.status = 'publicado') INTO v_pub FROM public.armarios a WHERE a.id = OLD.armario_id FOR SHARE;
    IF COALESCE(v_pub, false) THEN
      RAISE EXCEPTION 'armario_publicado_travado: itens de armario publicado sao so-leitura (despublique antes de editar)' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT (a.status = 'publicado') INTO v_pub FROM public.armarios a WHERE a.id = NEW.armario_id FOR SHARE;
    IF COALESCE(v_pub, false) THEN
      RAISE EXCEPTION 'armario_publicado_travado: itens de armario publicado sao so-leitura (despublique antes de editar)' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$function$;

-- funcao de gatilho: ninguem a chama direto (EXECUTE so e conferido no CREATE TRIGGER; ANON-2 da S1)
REVOKE EXECUTE ON FUNCTION public.fn_armario_trava_publicado() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_aaa_armario_trava
  BEFORE INSERT OR UPDATE OR DELETE ON public.armarios
  FOR EACH ROW EXECUTE FUNCTION public.fn_armario_trava_publicado();

CREATE OR REPLACE TRIGGER trg_aaa_armario_trava
  BEFORE INSERT OR UPDATE OR DELETE ON public.armario_itens
  FOR EACH ROW EXECUTE FUNCTION public.fn_armario_trava_publicado();

COMMIT;
