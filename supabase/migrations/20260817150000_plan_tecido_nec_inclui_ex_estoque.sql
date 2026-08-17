-- Plan. Tecido — APOSENTA o flag "Usar estoque existente" (decisão do dono 17/ago/2026)
--
-- CONTEXTO: os dados provaram que TODO card marcado "usar estoque existente" também tinha vínculo de
-- OC; todo metro em casa pertence a um item de OC/rolo (não existe estoque sem fonte). O único
-- comportamento EXCLUSIVO do flag era "sair da necessidade sem verificar a fonte" — risco de
-- SUB-COMPRA silenciosa (o card some do "a comprar" mesmo sem OC/rolo que o cubra).
--
-- RÉGUA ÚNICA pós-aposentadoria: vinculou OC/rolo = consome o físico daquela fonte; NÃO vinculou =
-- compra. A cobertura por vínculo (opção B, migração 20260817140000) já faz esse abatimento; então
-- basta o card ENTRAR na necessidade — o vínculo abate, o não-vínculo vira compra.
--
-- MUDANÇA (não-destrutiva, só leitura): `_plan_tecido_nec_variante_core` deixa de filtrar
-- `usar_estoque=false`. Um card antes-flagado passa a contar na necessidade; se tiver OC/rolo
-- vinculado, a cobertura abate (a-comprar líquido honesto); sem vínculo, entra no "a comprar".
--
-- A coluna `plan_tecido_slots.usar_estoque` fica INERTE: NÃO é dropada (o save segue gravando o valor
-- existente via `_salvar_plan_tecido_core`; o read segue devolvendo em `_plan_tecido_arvore_core`), a
-- UI só deixa de expor o checkbox. Nenhum consumidor VIVO filtra mais por ela (grep das defs: só esta
-- função filtrava). Isto SUPERA o ponto 5 do cabeçalho de 20260817140000 ("Cards usar_estoque:
-- INALTERADO — já saem da necessidade"): a partir daqui NÃO saem mais.

BEGIN;

CREATE OR REPLACE FUNCTION public._plan_tecido_nec_variante_core(_tenant uuid, _colecao_id uuid)
 RETURNS TABLE(artigo_id uuid, variante_tecido_id uuid, nec_m numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(vt.artigo_id, mt.artigo_id) as artigo_id, vv.variante_tecido_id,
         sum(coalesce(mt.consumo,0) * coalesce(vv.grade_total,0) * coalesce(vv.multiplicador,1))::numeric as nec_m
  from plan_tecido p
  join plan_tecido_subcolecoes s on s.plan_id = p.id
  join plan_tecido_linhas l on l.sub_id = s.id
  join plan_tecido_slots sl on sl.linha_ref_id = l.id  -- flag usar_estoque APOSENTADO (17/ago): TODO card entra na necessidade; cobertura por vínculo abate
  join plan_tecido_materiais mt on mt.slot_id = sl.id
  join plan_tecido_variantes vv on vv.material_id = mt.id
  left join variantes_tecido vt on vt.id = vv.variante_tecido_id  -- artigo REAL da variante (raiz do fix de 20260802140000)
  where p.colecao_id = _colecao_id and p.tenant_id = _tenant
    and vv.variante_tecido_id is not null
    and coalesce(vt.artigo_id, mt.artigo_id) is not null
  group by coalesce(vt.artigo_id, mt.artigo_id), vv.variante_tecido_id;
$function$;

-- ACL (invariante #9): revogar EXECUTE dos TRÊS (PUBLIC + anon + authenticated). CREATE OR REPLACE
-- preserva o ACL existente (já revogado), mas re-afirmamos por garantia — o acesso do cliente é só
-- pelos wrappers de módulo (previa/cobertura), nunca direto no _core.
REVOKE EXECUTE ON FUNCTION public._plan_tecido_nec_variante_core(uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
