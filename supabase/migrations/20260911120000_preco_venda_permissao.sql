-- Permissão à parte para EDITAR o preço de venda do modelo (`modelos.preco_venda`).
-- Nova section `criacao_planejamento:preco_venda`. VER o preço continua sob
-- `criacao_planejamento:custos` (a RPC custo_unitario_modelos mascara custos por _pode_ver_custos,
-- invariante #12) — esta permissão governa SÓ a EDIÇÃO do campo, no card da lista E no Sheet.
--
-- BACKFILL (à prova de lock-out): todo usuário/papel que HOJE pode EDITAR custos do Planejamento
-- (`criacao_planejamento:custos`.pode_editar=true — que é o que hoje libera editar o preço no Sheet)
-- ganha a nova section com ver+editar=true, para NINGUÉM perder a edição no deploy. Admins não
-- dependem disso (user_can_edit já os libera por dentro).
--
-- ENFORCEMENT: trigger BEFORE UPDATE em `modelos` — mudar `preco_venda` sem
-- user_can_edit('criacao_planejamento:preco_venda') RAISE 42501. Convive com o trigger de markup
-- (trg_modelo_markup_congela) já existente na tabela (nomes distintos, ambos BEFORE rodam).
-- ⚠️ Revenda: o preço de revenda é DERIVADO no servidor (o front deleta preco_venda do payload p/
-- origem='revenda') — o gate só morde quando o cliente realmente muda o valor.

BEGIN;

-- ── 1) BACKFILL da section a partir da permissão-mãe de EDITAR custos (ANTES de ligar o gate) ──
-- user_permissions
INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT up.user_id, up.tenant_id, 'criacao_planejamento:preco_venda', true, true
FROM public.user_permissions up
WHERE up.pagina = 'criacao_planejamento:custos' AND up.pode_editar = true
ON CONFLICT (user_id, pagina) DO NOTHING;

-- papel_permissoes (mesma lógica; UNIQUE (papel_id, pagina))
INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT pp.papel_id, pp.tenant_id, 'criacao_planejamento:preco_venda', true, true
FROM public.papel_permissoes pp
WHERE pp.pagina = 'criacao_planejamento:custos' AND pp.pode_editar = true
ON CONFLICT (papel_id, pagina) DO NOTHING;

-- ── 2) GATE de escrita: trigger BEFORE UPDATE em modelos ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_modelo_preco_venda_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Só morde quando o valor REALMENTE muda (trocar outro campo do modelo não dispara).
  IF NEW.preco_venda IS DISTINCT FROM OLD.preco_venda
     AND NOT public.user_can_edit('criacao_planejamento:preco_venda') THEN
    RAISE EXCEPTION 'Sem permissão para editar o preço de venda'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_modelo_preco_venda_gate ON public.modelos;
CREATE TRIGGER trg_modelo_preco_venda_gate
  BEFORE UPDATE ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_modelo_preco_venda_gate();

-- REVOKE dos TRÊS (invariante #9 — revogar só anon/authenticated é inócuo, PUBLIC herda).
REVOKE EXECUTE ON FUNCTION public.fn_modelo_preco_venda_gate() FROM PUBLIC, anon, authenticated;

COMMIT;

SELECT pg_notify('pgrst', 'reload schema');
