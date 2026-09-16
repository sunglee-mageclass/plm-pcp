-- Fase 3 — Onda OTB (parte 2): Padrão do Mix — só RING de presença + trava P0409 (SEM merge).
-- Decisão do dono: o Padrão do Mix é um template, editado raramente por 1 pessoa (risco baixo) → não
-- vale merge campo-a-campo, só a trava otimista + presença.
--
-- mix_padroes NÃO tinha rev NEM estava publicada no Realtime — precisa das duas coisas.
-- salvar_mix_padrao(_id,_nome,_linhas) ganha `_rev_base` como 4º arg. ⚠️ LIÇÃO do overload ambíguo
-- (20260916170000): DROPO a assinatura de 3 args na MESMA migração — o front sempre chama a nova de
-- 4 args, e sem o overload velho não há "not unique". `_rev_base` null/ausente = bypass (criação).
--
-- Corpo COPIADO BYTE-A-BYTE do pg_get_functiondef vigente (diff-validado): só adiciona _rev_base +
-- a trava. Toda a validação (linha repetida, delete+reinsert das linhas) INTACTA.

BEGIN;

-- ── rev + trigger + publicação no Realtime ────────────────────────────────────
ALTER TABLE public.mix_padroes ADD COLUMN IF NOT EXISTS rev integer NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS trg_colab_rev_mix_padrao ON public.mix_padroes;
CREATE TRIGGER trg_colab_rev_mix_padrao
  BEFORE UPDATE ON public.mix_padroes
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_touch_rev();

-- Realtime: publica + REPLICA IDENTITY FULL (mix_padroes não estava publicada).
ALTER TABLE public.mix_padroes REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='mix_padroes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mix_padroes;
  END IF;
END $$;

-- ── salvar_mix_padrao: 4º arg _rev_base + trava; dropa o overload de 3 args ────
DROP FUNCTION IF EXISTS public.salvar_mix_padrao(uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.salvar_mix_padrao(_id uuid, _nome text, _linhas jsonb, _rev_base integer DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_id uuid := _id; v_lin jsonb; v_i int := 0; v_rev int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;
  if coalesce(btrim(_nome), '') = '' then raise exception 'Informe o nome do padrão.'; end if;

  -- Cada linha só pode aparecer UMA vez no padrão.
  if exists (
    select 1 from (
      select v->>'linha_id' lid, count(*) c
      from jsonb_array_elements(coalesce(_linhas,'[]'::jsonb)) v
      where nullif(v->>'linha_id','') is not null group by 1 having count(*) > 1
    ) x
  ) then raise exception 'Linha repetida no padrão — cada linha só pode aparecer uma vez.'; end if;

  if v_id is null then
    insert into public.mix_padroes (nome) values (_nome) returning id into v_id;
  else
    -- trava otimista (Fase 3) — P0409 se outra pessoa salvou no meio. _rev_base null = bypass.
    if _rev_base is not null then
      select rev into v_rev from public.mix_padroes where id = v_id for update;
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa' using errcode='P0409';
      end if;
    end if;
    update public.mix_padroes set nome = _nome where id = v_id;
    if not found then raise exception 'Padrão não encontrado.'; end if;
    delete from public.mix_padrao_linhas where padrao_id = v_id;
  end if;

  for v_lin in select value from jsonb_array_elements(coalesce(_linhas, '[]'::jsonb)) loop
    insert into public.mix_padrao_linhas (padrao_id, linha_id, num_modelos, a_parte, prof_cor, cores, preco_min, preco_max, ordem)
    values (v_id, nullif(v_lin->>'linha_id','')::uuid,
            greatest(0, coalesce((v_lin->>'num_modelos')::int, 0)),
            coalesce((v_lin->>'a_parte')::boolean, false),
            greatest(0, coalesce((v_lin->>'prof_cor')::int, 0)),
            greatest(0, coalesce((v_lin->>'cores')::int, 0)),
            greatest(0, coalesce((v_lin->>'preco_min')::numeric, 0)),
            greatest(0, coalesce((v_lin->>'preco_max')::numeric, 0)),
            v_i);
    v_i := v_i + 1;
  end loop;
  return v_id;
end $function$;

COMMIT;
