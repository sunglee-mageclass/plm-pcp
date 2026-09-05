-- #4b — família acompanha o card: ao materializar (criar card no Planejamento) um produto de
-- revenda/importado que TEM família (`produtos_*.mix_id`), o espelho `modelos.mix_id` HERDA a
-- família. Assim o Planejamento de Produto (que agrupa por `modelos.mix_id`) reflete a família
-- e ela não se perde ao materializar. Espelha `criar_card_herda_mix.sql:41` (Plan.Tecido).
--
-- Recria os 2 cores adicionando APENAS `mix_id` ao INSERT do espelho (`..., null, p.mix_id`).
-- Corpo restante PRESERVADO byte-a-byte (diff-validar com pg_get_functiondef antes/depois).
-- ACL/segurança inalterados (SECURITY DEFINER + REVOKE dos wrappers seguem como estão).

-- ── Acabado (revenda) ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._criar_card_produto_acabado_core(_produto_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  p record;
  v_modelo_id uuid;
  v_grade jsonb;
  v_total numeric;
  rec record;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  -- FOR UPDATE: trava a linha até o fim da função — duplo-clique/chamada concorrente
  -- bloqueia na 2ª chamada até a 1ª terminar (INSERT do modelo + UPDATE modelo_id),
  -- daí vê modelo_id já preenchido e cai no RAISE de idempotência normalmente, em vez
  -- de correr e criar 2 espelhos.
  select * into p from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Produto não encontrado';
  end if;
  if p.modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento' using errcode = 'P0001';
  end if;

  -- Espelho: tenant_id explícito (não confiar no set_tenant_id_trg — o INSERT roda dentro
  -- de uma função SECURITY DEFINER, então basta o valor já resolvido em v_tenant acima).
  -- ref copiada DIRETO do produto: revenda não passa pelo fluxo aprovar/ref_auto do modelo.
  -- mix_id HERDA a família definida no produto (rascunho ou materializado) — #4b.
  insert into public.modelos (
    tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
    colecao_id, subcolecao, semana, ref, linha_id, mix_id
  ) values (
    v_tenant, p.nome, 'revenda', p.categoria_id, p.subcategoria1_id, p.subcategoria2_id,
    p.colecao_id, p.subcolecao, p.semana, p.ref, null, p.mix_id
  ) returning id into v_modelo_id;

  update public.produtos_acabados set modelo_id = v_modelo_id, updated_at = now() where id = _produto_id;

  for rec in select ordem, qtd from public.produto_acabado_variantes where produto_acabado_id = _produto_id loop
    v_grade := public._pa_grade_variante(p.grupo_id, p.grade_proporcao, rec.qtd);
    select coalesce(sum((value)::numeric), 0) into v_total from jsonb_each_text(v_grade);
    insert into public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
    values (v_modelo_id, rec.ordem, v_grade, v_total::int);
  end loop;

  perform public._pa_recomputar_precos_modelo(_produto_id);

  return v_modelo_id;
end;
$function$;

-- ── Importado ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._criar_card_produto_importado_core(_produto_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  p record;
  v_modelo_id uuid;
  v_grade jsonb;
  v_total numeric;
  rec record;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select * into p from public.produtos_importados where id = _produto_id and tenant_id = v_tenant for update;
  if not found then raise exception 'Produto não encontrado'; end if;
  if p.modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento' using errcode = 'P0001';
  end if;

  -- mix_id HERDA a família definida no produto (rascunho ou materializado) — #4b.
  insert into public.modelos (
    tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
    colecao_id, subcolecao, semana, ref, linha_id, mix_id
  ) values (
    v_tenant, p.nome, 'importado', p.categoria_id, p.subcategoria1_id, p.subcategoria2_id,
    p.colecao_id, p.subcolecao, p.semana, p.ref, null, p.mix_id
  ) returning id into v_modelo_id;

  update public.produtos_importados set modelo_id = v_modelo_id, updated_at = now() where id = _produto_id;

  for rec in select ordem, qtd from public.produto_importado_variantes where produto_importado_id = _produto_id loop
    v_grade := public._pa_grade_variante(p.grupo_id, p.grade_proporcao, rec.qtd);
    select coalesce(sum((value)::numeric), 0) into v_total from jsonb_each_text(v_grade);
    insert into public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
    values (v_modelo_id, rec.ordem, v_grade, v_total::int);
  end loop;

  perform public._imp_recomputar_precos_modelo(_produto_id);
  return v_modelo_id;
end $function$;

-- ACL: os cores seguem revogados dos três (invariante #9) — reafirma por garantia.
REVOKE EXECUTE ON FUNCTION public._criar_card_produto_acabado_core(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._criar_card_produto_importado_core(uuid) FROM public, anon, authenticated;
