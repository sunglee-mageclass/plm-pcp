-- Produto Acabado (Revenda) — Task 2 FIX ROUND 1 (review adversarial):
--
-- [Critical] _split_maior_resto não preservava Σ=total quando NENHUMA chave tinha
-- peso positivo (todas <=0, ex. todas 0): o denominador (Σ dos pesos positivos) ficava
-- 0, qtd_base=0/frac=0 pra todas, e o "resto" só distribuía +1 por chave (no máximo
-- nº de chaves), perdendo o restante sem erro. Ex.: _split_maior_resto(10,
-- '{"38":0,"40":0,"42":0}') devolvia {"38":1,"40":1,"42":1} (Σ=3≠10).
-- Fix (decisão do controller): quando Σ dos pesos positivos = 0, trata TODAS as
-- chaves como peso 1 (split igualitário por maior resto — preserva Σ=total).
-- Quando Σ>0, comportamento IGUAL a antes (chave com peso<=0 entre pesos positivos
-- continua com 0).
--
-- [Minor] criar_card_produto_acabado sem trava contra chamada concorrente: o check de
-- idempotência (p.modelo_id is not null) lia a linha sem lock — duplo-clique podia
-- criar 2 espelhos. Fix: SELECT ... FOR UPDATE na linha do produto antes do check.
--
-- CREATE OR REPLACE (mesma assinatura) — NÃO editar a migration já aplicada/commitada
-- (20260807150000). ACL (REVOKE/GRANT) sobrevive a CREATE OR REPLACE, mas re-aplicamos
-- os REVOKEs explicitamente por clareza/defesa em profundidade, como pedido.

create or replace function public._split_maior_resto(_total int, _pesos jsonb)
returns jsonb
language sql
immutable
as $$
  with pesos as (
    select key, (value)::numeric as peso
    from jsonb_each_text(coalesce(_pesos, '{}'::jsonb))
  ),
  soma as (
    select coalesce(sum(peso) filter (where peso > 0), 0) as total_peso from pesos
  ),
  -- Degenerado (nenhuma chave com peso positivo): todas as chaves valem 1 (split
  -- igualitário) pra preservar Σ=total. Caso normal (Σ>0): mantém os pesos originais
  -- (chave com peso<=0 fica com 0, como antes).
  pesos_efetivos as (
    select p.key,
      case when s.total_peso > 0 then p.peso else 1 end as peso
    from pesos p cross join soma s
  ),
  soma2 as (
    select coalesce(sum(peso) filter (where peso > 0), 0) as total_peso from pesos_efetivos
  ),
  base as (
    select pe.key, pe.peso,
      case when s2.total_peso > 0 and pe.peso > 0
        then floor(coalesce(_total, 0) * pe.peso / s2.total_peso)
        else 0 end as qtd_base,
      case when s2.total_peso > 0 and pe.peso > 0
        then (coalesce(_total, 0) * pe.peso / s2.total_peso) - floor(coalesce(_total, 0) * pe.peso / s2.total_peso)
        else 0 end as frac
    from pesos_efetivos pe cross join soma2 s2
  ),
  falta as (
    select (coalesce(_total, 0) - coalesce(sum(qtd_base), 0))::int as resto from base
  ),
  ranked as (
    select b.*, row_number() over (order by b.frac desc, b.key asc) as rn
    from base b
  )
  select coalesce(jsonb_object_agg(r.key, (r.qtd_base + case when r.rn <= f.resto then 1 else 0 end)::int), '{}'::jsonb)
  from ranked r cross join falta f;
$$;

create or replace function public._criar_card_produto_acabado_core(_produto_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
  insert into public.modelos (
    tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
    colecao_id, subcolecao, semana, ref, linha_id
  ) values (
    v_tenant, p.nome, 'revenda', p.categoria_id, p.subcategoria1_id, p.subcategoria2_id,
    p.colecao_id, p.subcolecao, p.semana, p.ref, null
  ) returning id into v_modelo_id;

  update public.produtos_acabados set modelo_id = v_modelo_id, updated_at = now() where id = _produto_id;

  for rec in select ordem, qtd from public.produto_acabado_variantes where produto_acabado_id = _produto_id loop
    v_grade := public._pa_grade_variante(p.grupo_id, p.grade_proporcao, rec.qtd);
    select coalesce(sum((value)::numeric), 0) into v_total from jsonb_each_text(v_grade);
    insert into public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
    values (v_modelo_id, rec.ordem, v_grade, v_total::int);
  end loop;

  return v_modelo_id;
end;
$$;

revoke execute on function public._split_maior_resto(int, jsonb) from public, anon, authenticated;
revoke execute on function public._criar_card_produto_acabado_core(uuid) from public, anon, authenticated;
