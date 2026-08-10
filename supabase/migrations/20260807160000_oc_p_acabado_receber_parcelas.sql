-- Produto Acabado (Revenda) — Task 3/8: recebimento da OC (materializa o espelho de
-- produção: cad + cad_grades + controle_qualidade), parcelas a pagar por prazo de
-- pagamento, e leitura da aba Estoque.
-- Idempotente (CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS / DROP+CREATE TRIGGER).

-- ======================================================================
-- Parcelas: coluna de vínculo + trigger de geração por prazo_pagamento
-- ======================================================================
-- `parcelas.tipo_oc` é character varying(20) NOT NULL SEM CHECK constraint (conferido
-- via \d parcelas) — 'p_acabado' (9 chars) não precisa de ALTER nenhum, só a coluna FK.
alter table public.parcelas
  add column if not exists oc_p_acabado_id uuid references public.ocs_p_acabado(id) on delete cascade;

-- Mesma proteção contra duplicata das duas irmãs (tecido/aviamento).
create unique index if not exists parcelas_oc_p_acabado_numero_key
  on public.parcelas (oc_p_acabado_id, numero_parcela) where oc_p_acabado_id is not null;

-- Ao contrário de tecido/aviamento (que geram parcelas só ao RECEBER, guardado por
-- "já existe → não duplica"), aqui a OC já nasce com valor_total_desconto/prazo/data
-- conhecidos ("Fazer pedido"). Por isso o gatilho é direto nessas 3 colunas e a
-- idempotência é REGERAR (apaga não-pagas + reinsere) em vez de "insere uma vez só" —
-- espelha a lógica de recalcular_parcelas (20260618130000:141-280), preservando pagas.
create or replace function public.gerar_parcelas_oc_p_acabado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_dias integer[];
  v_n integer;
  v_valor_total numeric(14,2);
  v_valor_parcela numeric(12,2);
  v_valor_ultima numeric(12,2);
  v_vencimento date;
  v_valor_a_inserir numeric(12,2);
  i integer;
begin
  delete from public.parcelas
   where oc_p_acabado_id = NEW.id
     and tipo_oc = 'p_acabado'
     and status is distinct from 'pago'
     and data_pagamento is null;

  -- "30/60/90" -> {30,60,90} (paridade com o parser regexp_split_to_table de
  -- 20260618130000, mas usando string_to_array('/') como o brief pede — o formato
  -- real da coluna é sempre dígitos separados por barra).
  v_dias := array(
    select t::int
    from unnest(string_to_array(coalesce(NEW.prazo_pagamento, '30'), '/')) as t
    where t ~ '^[0-9]+$'
  );
  if v_dias is null or array_length(v_dias, 1) is null or array_length(v_dias, 1) < 1 then
    v_dias := array[30];
  end if;
  v_n := least(array_length(v_dias, 1), 24);

  v_valor_total := coalesce(NEW.valor_total_desconto, 0);
  v_valor_parcela := round(v_valor_total / v_n, 2);
  v_valor_ultima := v_valor_total - (v_valor_parcela * (v_n - 1));

  for i in 1..v_n loop
    -- Uma parcela PAGA (preservada pelo DELETE acima) continua ocupando esse
    -- numero_parcela — pular pra não colidir com o índice único (paridade com o
    -- CONTINUE de recalcular_parcelas, 20260618130000:233-241).
    if exists (
      select 1 from public.parcelas
      where oc_p_acabado_id = NEW.id and numero_parcela = i
    ) then
      continue;
    end if;

    v_vencimento := coalesce(NEW.data_pedido, current_date) + v_dias[i];
    v_valor_a_inserir := case when i = v_n then v_valor_ultima else v_valor_parcela end;

    insert into public.parcelas (
      tenant_id, tipo_oc, oc_p_acabado_id, empresa_id,
      numero_parcela, valor, data_vencimento, status
    ) values (
      NEW.tenant_id, 'p_acabado', NEW.id, NEW.empresa_id,
      i, v_valor_a_inserir, v_vencimento, 'a_pagar'
    );
  end loop;

  return NEW;
end;
$function$;

drop trigger if exists trg_gerar_parcelas_ocpa on public.ocs_p_acabado;
create trigger trg_gerar_parcelas_ocpa
after insert or update of valor_total_desconto, prazo_pagamento, data_pedido on public.ocs_p_acabado
for each row execute function public.gerar_parcelas_oc_p_acabado();

-- ======================================================================
-- receber_oc_p_acabado — ATÔMICO: recebimento + cad/cad_grades/CQ
-- ======================================================================
-- _dados = {data_entrega, nota_fiscal, responsavel_recebimento_id, devolucao, revisao}
-- _grade = grade_detalhe COMPLETA {"<ordem>":{"<tam>":{"pedida","recebida","defeito"}}}
--          — mesmo contrato "estado completo por save" do salvar_oc_p_acabado (Task 2):
--          o chamador manda o objeto inteiro (pedida já conhecida + recebida/defeito
--          novos); a RPC não faz merge campo-a-campo. Se _grade vier NULL, cai no
--          grade_detalhe já salvo (não apaga o que já existia).
create or replace function public._receber_oc_p_acabado_core(_oc_id uuid, _dados jsonb, _grade jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_oc record;
  v_produto record;
  v_cad_id uuid;
  v_grade_final jsonb;
  rec record;
  tam_rec record;
  v_var_grade jsonb;
  v_planejadas jsonb;
  v_reais jsonb;
  v_tot_plan int;
  v_tot_real int;
  v_grand_total int := 0;
  v_pedida numeric;
  v_recebida numeric;
  v_defeito numeric;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select * into v_oc from public.ocs_p_acabado where id = _oc_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'OC não encontrada';
  end if;

  if v_oc.produto_acabado_id is null then
    raise exception 'Crie o card no Planejamento antes de receber — o recebimento alimenta CQ e Direcionamento.'
      using errcode = 'P0001';
  end if;

  select * into v_produto from public.produtos_acabados
    where id = v_oc.produto_acabado_id and tenant_id = v_tenant;
  if not found or v_produto.modelo_id is null then
    raise exception 'Crie o card no Planejamento antes de receber — o recebimento alimenta CQ e Direcionamento.'
      using errcode = 'P0001';
  end if;

  v_grade_final := coalesce(_grade, v_oc.grade_detalhe, '{}'::jsonb);

  update public.ocs_p_acabado set
    data_entrega = nullif(_dados->>'data_entrega', '')::date,
    nota_fiscal = _dados->>'nota_fiscal',
    responsavel_recebimento_id = nullif(_dados->>'responsavel_recebimento_id', '')::uuid,
    devolucao = _dados->>'devolucao',
    revisao = _dados->>'revisao',
    grade_detalhe = v_grade_final,
    status = 'recebido',
    updated_at = now()
  where id = _oc_id;

  -- upsert cad (1 por modelo — trigger enforce_unique_fk('modelo_id') garante a
  -- invariante; aqui só evitamos o INSERT redundante quando já existe).
  select id into v_cad_id from public.cad where modelo_id = v_produto.modelo_id and tenant_id = v_tenant;
  if v_cad_id is null then
    insert into public.cad (tenant_id, modelo_id) values (v_tenant, v_produto.modelo_id)
      returning id into v_cad_id;
  end if;

  -- upsert cad_grades por variante: variante_numero = ordem; grades_planejadas = pedida
  -- por tamanho; grades_reais = max(0, recebida−defeito) por tamanho.
  for rec in
    select ordem from public.produto_acabado_variantes
    where produto_acabado_id = v_produto.id
    order by ordem
  loop
    v_var_grade := coalesce(v_grade_final -> rec.ordem::text, '{}'::jsonb);
    v_planejadas := '{}'::jsonb;
    v_reais := '{}'::jsonb;
    v_tot_plan := 0;
    v_tot_real := 0;

    for tam_rec in select key, value from jsonb_each(v_var_grade) loop
      v_pedida := coalesce(nullif(tam_rec.value->>'pedida', '')::numeric, 0);
      v_recebida := coalesce(nullif(tam_rec.value->>'recebida', '')::numeric, 0);
      v_defeito := coalesce(nullif(tam_rec.value->>'defeito', '')::numeric, 0);

      v_planejadas := v_planejadas || jsonb_build_object(tam_rec.key, v_pedida::int);
      v_reais := v_reais || jsonb_build_object(tam_rec.key, greatest(0, v_recebida - v_defeito)::int);
      v_tot_plan := v_tot_plan + v_pedida::int;
      v_tot_real := v_tot_real + greatest(0, v_recebida - v_defeito)::int;
    end loop;

    insert into public.cad_grades (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
    values (v_cad_id, rec.ordem, v_planejadas, v_reais, v_tot_plan, v_tot_real)
    on conflict (cad_id, variante_numero) do update set
      grades_planejadas = excluded.grades_planejadas,
      grades_reais = excluded.grades_reais,
      grade_total_planejada = excluded.grade_total_planejada,
      grade_total_real = excluded.grade_total_real;

    v_grand_total := v_grand_total + v_tot_real;
  end loop;

  -- upsert controle_qualidade: mantém 'pendente' (default da coluna) se não existe;
  -- se já existe (inclusive 'confirmado'), NÃO toca — o cad_grades acima já regravou
  -- grades_reais e o trigger trg_rebaixa_direcionamento_grade (AFTER UPDATE OF
  -- grades_reais ON cad_grades) cuida da rebaixa do Direcionamento sozinho.
  if not exists (select 1 from public.controle_qualidade where cad_id = v_cad_id) then
    insert into public.controle_qualidade (cad_id, tenant_id, status) values (v_cad_id, v_tenant, 'pendente');
  end if;

  return jsonb_build_object('cad_id', v_cad_id, 'total_real', v_grand_total);
end;
$$;

create or replace function public.receber_oc_p_acabado(_oc_id uuid, _dados jsonb, _grade jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  return public._receber_oc_p_acabado_core(_oc_id, _dados, _grade);
end;
$$;

-- ======================================================================
-- estoque_p_acabado — leitura da aba Estoque
-- ======================================================================
-- Por produto (só os que já têm espelho+cad): variante_numero -> {real, direcionado,
-- em_maos}. real = cad_grades.grade_total_real; direcionado = Σ direcionamento_lojas.
-- grades (todas as lojas) por variante; em_maos = real − direcionado.
create or replace function public._estoque_p_acabado_core(_tenant uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with reais as (
    select p.id as produto_id, cg.variante_numero, coalesce(cg.grade_total_real, 0) as real
    from public.produtos_acabados p
    join public.cad c on c.modelo_id = p.modelo_id
    join public.cad_grades cg on cg.cad_id = c.id
    where p.tenant_id = _tenant
  ),
  direcionado as (
    select p.id as produto_id, dl.variante_numero, coalesce(sum((kv.value)::numeric), 0) as direcionado
    from public.produtos_acabados p
    join public.cad c on c.modelo_id = p.modelo_id
    join public.direcionamento_lojas dl on dl.cad_id = c.id
    cross join lateral jsonb_each_text(coalesce(dl.grades, '{}'::jsonb)) as kv(key, value)
    where p.tenant_id = _tenant
    group by p.id, dl.variante_numero
  ),
  chaves as (
    select produto_id, variante_numero from reais
    union
    select produto_id, variante_numero from direcionado
  ),
  base as (
    select k.produto_id, k.variante_numero,
      coalesce(r.real, 0) as real,
      coalesce(d.direcionado, 0) as direcionado,
      coalesce(r.real, 0) - coalesce(d.direcionado, 0) as em_maos
    from chaves k
    left join reais r on r.produto_id = k.produto_id and r.variante_numero = k.variante_numero
    left join direcionado d on d.produto_id = k.produto_id and d.variante_numero = k.variante_numero
  ),
  por_produto as (
    select produto_id,
      jsonb_object_agg(
        variante_numero::text,
        jsonb_build_object('real', real, 'direcionado', direcionado, 'em_maos', em_maos)
      ) as variantes
    from base
    group by produto_id
  )
  select coalesce(jsonb_object_agg(produto_id::text, variantes), '{}'::jsonb) from por_produto;
$$;

create or replace function public.estoque_p_acabado()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  return public._estoque_p_acabado_core(public.get_user_tenant_id());
end;
$$;

-- ======================================================================
-- REVOKEs (invariante #9: dos TRÊS no _core; PUBLIC+anon no wrapper) ------
-- ======================================================================
revoke execute on function public._receber_oc_p_acabado_core(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public._estoque_p_acabado_core(uuid) from public, anon, authenticated;

revoke execute on function public.receber_oc_p_acabado(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.receber_oc_p_acabado(uuid, jsonb, jsonb) to authenticated;
revoke execute on function public.estoque_p_acabado() from public, anon;
grant execute on function public.estoque_p_acabado() to authenticated;
