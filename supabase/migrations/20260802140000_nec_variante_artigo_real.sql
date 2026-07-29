-- RAIZ do "artigo trocado nas OCs": a necessidade por variante agrupava pelo artigo do MATERIAL
-- (bloco no plano, mt.artigo_id), não pelo artigo REAL da variante (variantes_tecido.artigo_id).
-- Quando uma variante de um tecido está pendurada no bloco de OUTRO (cross-artigo do BOM), a
-- necessidade — e por consequência a PRÉVIA e o "Fazer pedido" — atribuíam a variante ao tecido
-- errado, criando itens de OC com artigo_id ≠ artigo da variante.
--
-- Fix (não-destrutivo, só leitura): agrupar pelo artigo REAL da variante. Assim NOVOS pedidos saem
-- com o artigo certo (+ fornecedor/unidade certos), e o "a comprar" do Resumo agrega no tecido certo.
-- (Itens de OC LEGADOS não são reescritos aqui: mudar it.artigo_id reinterpretaria a unidade da
-- quantidade já gravada — kg×metro — e deslocaria valores; a exibição da Situação da OC já foi
-- corrigida para agrupar pela variante real.)

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
  join plan_tecido_slots sl on sl.linha_ref_id = l.id and coalesce(sl.usar_estoque,false) = false
  join plan_tecido_materiais mt on mt.slot_id = sl.id
  join plan_tecido_variantes vv on vv.material_id = mt.id
  left join variantes_tecido vt on vt.id = vv.variante_tecido_id  -- artigo REAL da variante (raiz do fix)
  where p.colecao_id = _colecao_id and p.tenant_id = _tenant
    and vv.variante_tecido_id is not null
    and coalesce(vt.artigo_id, mt.artigo_id) is not null
  group by coalesce(vt.artigo_id, mt.artigo_id), vv.variante_tecido_id;
$function$;

COMMIT;
