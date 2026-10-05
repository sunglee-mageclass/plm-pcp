-- Inverso de supabase/migrations/20261103171000_urg_r1_insumo_tamanho_consumidores.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a1.mjs (nunca editar a mao).
-- Devolve os 4 textos de ANTES (byte a byte o vivo antes da ida; ACL/DEFINER/search_path preservados pelo CREATE OR REPLACE).
-- Sem DROP (nada foi criado). Os helpers e a coluna da 20261103170000 ficam. Custo previsto ja recalculado pelo rateio FICA ate a
-- proxima edicao do card; o "a enviar" de revenda materializado pela regra nova FICA (dado gravado).
-- Volta LIFO: depois do _down da 20261103172000 (e dos blocos acima) e ANTES do 20261103170500_down.
-- Trava: SO catalogo (corpo NAO validado - check_function_bodies off: e o texto que ja estava vivo; nenhuma trava de tabela).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';
SET LOCAL check_function_bodies = off;

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._custo_calcular(uuid,uuid[])', 'f9d87d6a1f9f307a7d83cf837730566c', 'd10bf1397ea1fb9f37ef9b98d2aa1414'),
      ('public.fn_custo_fila_preco()', 'cd405a624d82e23f0ce8120472f04471', '4a51428a975227cd4cdae34ae2ce1248'),
      ('public._estoque_etiqueta_core(uuid)', '28aa308d297cc18b653c6290a5b3b958', 'e7681ebd0e2a32144ca41795735182fc'),
      ('public._receber_oc_p_acabado_core(uuid,jsonb,jsonb)', '3f2e2b31f6f28aaa35c9b13c1fb197be', '6cf6fe59c64d01450ce9c8c9a5cac951')
    ) AS x(f, a, d) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.d) THEN
      RAISE EXCEPTION 'urg_r1_171000_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._custo_calcular(_tenant uuid, _ids uuid[])
 RETURNS TABLE(tabela text, id uuid, modelo_id uuid, tipo text, custo numeric, tecido numeric, forro numeric, entretela numeric, aviamento numeric, etiqueta numeric, mao_obra numeric, adicionais numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- [custo-servidor C1] custo previsto de cada modelo INTERNO da loja (_ids NULL = todos): uma linha por linha do BOM
  -- (tabela, id, modelo, tipo, custo) + uma linha 'modelos' por card (id = modelo) com os totais e custo = peca, somada na
  -- ordem de pecaCom: tecido + forro + entretela + aviamento + etiqueta + M.O. + adicionais. Sem arredondar a peca (o
  -- aplicador grava round(peca, 2) em numeric(10,2)). M3: todo preco vem so de cadastro/OC DA LOJA (_tenant).
  WITH mo_ AS (
    SELECT m.id AS mid, m.custos_adicionais AS ca
      FROM public.modelos m
     WHERE m.tenant_id = _tenant AND m.origem = 'interno' AND (_ids IS NULL OR m.id = ANY (_ids))
  ),
  li AS (
    SELECT 'modelo_tecidos'::text AS tb, mt.id AS lid, mt.modelo_id AS lmid, mt.tipo::text AS tp,
           public._custo_linha(public._custo_preco_tecido(mt.id, _tenant), mt.consumo, mt.loss_percent) AS c
      FROM public.modelo_tecidos mt JOIN mo_ ON mo_.mid = mt.modelo_id
    UNION ALL
    SELECT 'modelo_aviamentos'::text, ma.id, ma.modelo_id, 'aviamento'::text,
           public._custo_linha(coalesce((SELECT av.preco FROM public.aviamentos av WHERE av.id = ma.aviamento_id AND av.tenant_id = _tenant), 0),
                               ma.consumo, ma.loss_percent)
      FROM public.modelo_aviamentos ma JOIN mo_ ON mo_.mid = ma.modelo_id
    UNION ALL
    SELECT 'modelo_etiquetas'::text, me.id, me.modelo_id, 'etiqueta'::text,
           public._custo_linha(public._custo_preco_etiqueta(me.etiqueta_id, me.cor_id, _tenant), me.consumo, me.loss_percent)
      FROM public.modelo_etiquetas me JOIN mo_ ON mo_.mid = me.modelo_id
  ),
  tot AS (
    SELECT mo_.mid,
           coalesce(sum(li.c) FILTER (WHERE li.tp = 'tecido'), 0) AS t_tecido,
           coalesce(sum(li.c) FILTER (WHERE li.tp = 'forro'), 0) AS t_forro,
           coalesce(sum(li.c) FILTER (WHERE li.tp = 'entretela'), 0) AS t_entretela,
           coalesce(sum(li.c) FILTER (WHERE li.tp = 'aviamento'), 0) AS t_aviamento,
           coalesce(sum(li.c) FILTER (WHERE li.tp = 'etiqueta'), 0) AS t_etiqueta,
           coalesce((SELECT sum(s.valor) FROM public.modelo_servico_mo s WHERE s.modelo_id = mo_.mid), 0) AS t_mo,
           public._custo_adicionais_soma(mo_.ca) AS t_adic
      FROM mo_ LEFT JOIN li ON li.lmid = mo_.mid
     GROUP BY mo_.mid, mo_.ca
  )
  SELECT li.tb, li.lid, li.lmid, li.tp, li.c,
         NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric
    FROM li
  UNION ALL
  SELECT 'modelos'::text, t.mid, t.mid, NULL::text,
         t.t_tecido + t.t_forro + t.t_entretela + t.t_aviamento + t.t_etiqueta + t.t_mo + t.t_adic,
         t.t_tecido, t.t_forro, t.t_entretela, t.t_aviamento, t.t_etiqueta, t.t_mo, t.t_adic
    FROM tot t;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_preco()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1] PRECO de cadastro (artigos, aviamentos, etiquetas, variantes_etiqueta, ocs_tecido_itens): enfileira os
-- internos DA MESMA LOJA do item que o usam, PULANDO o card ja enviado ao corte (R-CD1/P-169 A: o previsto congela no
-- envio). So quando muda coluna de preco (OLD x NEW por id).
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.custo_sistema', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'artigos' THEN
    WITH mud AS (
      SELECT n.id, n.tenant_id FROM novas n JOIN antigas o ON o.id = n.id
       WHERE (o.preco, o.preco_por_metro, o.rendimento, o.unidade_medida)
             IS DISTINCT FROM (n.preco, n.preco_por_metro, n.rendimento, n.unidade_medida)
    ), u AS (
      SELECT mt.modelo_id, mud.tenant_id FROM mud JOIN public.modelo_tecidos mt ON mt.artigo_id = mud.id
      UNION
      SELECT mt.modelo_id, mud.tenant_id FROM mud
        JOIN public.variantes_tecido vt ON vt.artigo_id = mud.id
        JOIN public.modelo_tecido_variantes mtv ON mtv.variante_tecido_id = vt.id
        JOIN public.modelo_tecidos mt ON mt.id = mtv.modelo_tecido_id
      UNION
      SELECT l.modelo_id, mud.tenant_id FROM mud
        JOIN public.variantes_tecido vt ON vt.artigo_id = mud.id
        JOIN public.modelo_tecido_oc_links l ON l.variante_tecido_id = vt.id
    )
    SELECT array_agg(DISTINCT m.id) INTO v_ids
      FROM u JOIN public.modelos m ON m.id = u.modelo_id AND m.tenant_id = u.tenant_id;
  ELSIF TG_TABLE_NAME = 'aviamentos' THEN
    SELECT array_agg(DISTINCT m.id) INTO v_ids
      FROM novas n JOIN antigas o ON o.id = n.id
      JOIN public.modelo_aviamentos ma ON ma.aviamento_id = n.id
      JOIN public.modelos m ON m.id = ma.modelo_id AND m.tenant_id = n.tenant_id
     WHERE o.preco IS DISTINCT FROM n.preco;
  ELSIF TG_TABLE_NAME = 'etiquetas' THEN
    SELECT array_agg(DISTINCT m.id) INTO v_ids
      FROM novas n JOIN antigas o ON o.id = n.id
      JOIN public.modelo_etiquetas me ON me.etiqueta_id = n.id
      JOIN public.modelos m ON m.id = me.modelo_id AND m.tenant_id = n.tenant_id
     WHERE o.preco IS DISTINCT FROM n.preco;
  ELSIF TG_TABLE_NAME = 'variantes_etiqueta' THEN
    IF TG_OP = 'INSERT' THEN
      SELECT array_agg(DISTINCT m.id) INTO v_ids
        FROM novas n
        JOIN public.modelo_etiquetas me ON me.etiqueta_id = n.etiqueta_id
        JOIN public.modelos m ON m.id = me.modelo_id AND m.tenant_id = n.tenant_id;
    ELSIF TG_OP = 'DELETE' THEN
      SELECT array_agg(DISTINCT m.id) INTO v_ids
        FROM antigas o
        JOIN public.modelo_etiquetas me ON me.etiqueta_id = o.etiqueta_id
        JOIN public.modelos m ON m.id = me.modelo_id AND m.tenant_id = o.tenant_id;
    ELSE
      SELECT array_agg(DISTINCT m.id) INTO v_ids
        FROM novas n JOIN antigas o ON o.id = n.id
        CROSS JOIN LATERAL (VALUES (o.etiqueta_id, o.tenant_id), (n.etiqueta_id, n.tenant_id)) AS x(etq, tid)
        JOIN public.modelo_etiquetas me ON me.etiqueta_id = x.etq
        JOIN public.modelos m ON m.id = me.modelo_id AND m.tenant_id = x.tid
       WHERE (o.preco, o.cor_id, o.etiqueta_id) IS DISTINCT FROM (n.preco, n.cor_id, n.etiqueta_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'ocs_tecido_itens' THEN
    SELECT array_agg(DISTINCT m.id) INTO v_ids
      FROM novas n JOIN antigas o ON o.id = n.id
      JOIN public.modelo_tecido_oc_links l ON l.oc_tecido_item_id = n.id
      JOIN public.modelos m ON m.id = l.modelo_id AND m.tenant_id = l.tenant_id
     WHERE (o.preco, o.cancelado) IS DISTINCT FROM (n.preco, n.cancelado);
  END IF;
  PERFORM public._custo_enfileirar(v_ids, true);
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public._estoque_etiqueta_core(_tenant uuid)
 RETURNS TABLE(etiqueta_id uuid, etiqueta_nome text, variante_id uuid, tamanho text, cor_nome text, recebido numeric, prev_receb numeric, baixa numeric, fisico numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with
  rec as (  -- recebido: chave (etiqueta, tamanho, cor) da variante da OC recebida
    select i.etiqueta_id as etq, ve.tamanho as tam, ve.cor_id as cor,
           sum(coalesce(i.quantidade_recebida, i.quantidade_pedida, 0)) as tot
    from ocs_etiqueta_itens i
    join ocs_etiqueta o on o.id = i.oc_etiqueta_id and o.tenant_id = _tenant and o.status = 'recebido'
    left join variantes_etiqueta ve on ve.id = i.variante_etiqueta_id
    where coalesce(i.cancelado, false) = false
    group by 1, 2, 3
  ),
  prev as (  -- previsto: OC encomendada
    select i.etiqueta_id as etq, ve.tamanho as tam, ve.cor_id as cor,
           sum(coalesce(i.quantidade_pedida, 0)) as tot
    from ocs_etiqueta_itens i
    join ocs_etiqueta o on o.id = i.oc_etiqueta_id and o.tenant_id = _tenant and o.status = 'encomendado'
    left join variantes_etiqueta ve on ve.id = i.variante_etiqueta_id
    where coalesce(i.cancelado, false) = false
    group by 1, 2, 3
  ),
  baixa_var as (  -- consumo por tamanho: chave (etiqueta, tamanho=key, cor do CAD)
    select ce.etiqueta_id as etq, kv.key as tam, ce.cor_id as cor, sum((kv.value)::numeric) as tot
    from cad_etiquetas ce
    join cad c on c.id = ce.cad_id and c.tenant_id = _tenant and c.enviado_corte
    join lateral jsonb_each_text(coalesce(ce.enviar_por_tamanho, '{}'::jsonb)) kv on true
    group by 1, 2, 3
  ),
  ce_sem as (  -- [medios R16 est #7, P-188 A] linhas do "a enviar" SEM enviar_por_tamanho. Insumo COM tamanho (formato
               -- <> 'nenhum' e alguma variante com tamanho - a mesma regra da Ficha de Corte) ganha os pesos = grade do
               -- CAD por tamanho (soma das variantes de cad_grades.grades_planejadas, so tamanhos com peca > 0).
    select ce.etiqueta_id as etq, ce.cor_id as cor, coalesce(ce.quantidade_enviar, 0) as qe,
           case when coalesce(e.formato_tamanho, 'ambos') <> 'nenhum'
                 and exists (select 1 from variantes_etiqueta ve where ve.etiqueta_id = ce.etiqueta_id and ve.tamanho is not null)
                then (select jsonb_object_agg(w.k, w.s)
                        from (select kv.key as k, sum((kv.value)::numeric) as s
                                from cad_grades g
                                cross join lateral jsonb_each_text(coalesce(g.grades_planejadas, '{}'::jsonb)) kv
                               where g.cad_id = ce.cad_id and kv.value ~ '^[0-9]+(\.[0-9]+)?$'
                               group by kv.key
                              having sum((kv.value)::numeric) > 0) w)
           end as pesos
    from cad_etiquetas ce
    join cad c on c.id = ce.cad_id and c.tenant_id = _tenant and c.enviado_corte
    left join etiquetas e on e.id = ce.etiqueta_id
    where coalesce(ce.enviar_por_tamanho, '{}'::jsonb) = '{}'::jsonb
  ),
  baixa_grade as (  -- [est #7] parte INTEIRA do "a enviar" repartida pela grade (maior resto: Sigma preservada)
    select s.etq, kv.key as tam, s.cor, sum((kv.value)::numeric) as tot
    from ce_sem s
    cross join lateral jsonb_each_text(public._split_maior_resto(floor(s.qe)::int, s.pesos)) kv
    where s.pesos is not null and s.qe >= 1
    group by 1, 2, 3
  ),
  baixa_sem as (  -- consumo sem tamanho: chave (etiqueta, NULL, cor do CAD). Insumo sem tamanho (ou sem grade): tudo
                  -- aqui, como antes; repartido pela grade: so a fracao (< 1) que sobrou da parte inteira.
    select s.etq, null::text as tam, s.cor,
           sum(case when s.pesos is not null and s.qe >= 1 then s.qe - floor(s.qe) else s.qe end) as tot
    from ce_sem s
    where not (s.pesos is not null and s.qe >= 1) or s.qe - floor(s.qe) > 0
    group by 1, 3
  ),
  baixa_revenda as (  -- consumo de insumo em REVENDA: sem corte/CAD-tecido — o gatilho é a
                       -- OC P. Acabado recebida, refletida em cad_grades.grade_total_real do
                       -- cad-espelho (receber_oc_p_acabado, Task 3). Sem tamanho (BOM de
                       -- revenda = modelo_etiquetas, sem coluna tamanho).
    select me.etiqueta_id as etq, null::text as tam, me.cor_id as cor,
           sum(me.consumo * coalesce(cg.total_real, 0)) as tot
    from modelo_etiquetas me
    join modelos m on m.id = me.modelo_id and m.tenant_id = _tenant and m.origem in ('revenda', 'importado')
                                            -- [medios R16, carona] importado: o recebimento (_receber_oc_importado_core) grava
                                            -- o cad-espelho + cad_grades e NAO cria cad_etiquetas -> baixa pelas pecas recebidas
    join cad c on c.modelo_id = m.id and c.tenant_id = _tenant
     and not coalesce(c.enviado_corte, false)  -- [contas-certas 6] so ANTES do Enviar para PCP; depois vale o
                                               -- "a enviar" da Explosao (baixa_sem/baixa_var) -> sem baixa em dobro
    join (select cad_id, sum(grade_total_real) as total_real from cad_grades group by cad_id) cg
      on cg.cad_id = c.id
    group by 1, 3
  ),
  baixa as (
    select etq, tam, cor, sum(tot) as tot
    from (select * from baixa_var union all select * from baixa_grade union all select * from baixa_sem
          union all select * from baixa_revenda) x
    group by 1, 2, 3
  ),
  keys as (
    select etq, tam, cor from rec
    union select etq, tam, cor from prev
    union select etq, tam, cor from baixa
  )
  select k.etq, e.nome::text,
         ve.id,                                   -- variante_id (referência; NULL se a baixa não casa variante)
         k.tam, cor.nome::text,
         coalesce(rec.tot, 0), coalesce(prev.tot, 0), coalesce(baixa.tot, 0),
         greatest(0, coalesce(rec.tot, 0) - coalesce(baixa.tot, 0))   -- físico nunca negativo (igual tecido/aviamento)
  from keys k
  join etiquetas e on e.id = k.etq and e.tenant_id = _tenant
  left join variantes_etiqueta ve on ve.etiqueta_id = k.etq
       and ve.tamanho is not distinct from k.tam and ve.cor_id is not distinct from k.cor
  left join cores cor on cor.id = k.cor
  left join rec  on rec.etq  = k.etq and rec.tam  is not distinct from k.tam and rec.cor  is not distinct from k.cor
  left join prev on prev.etq = k.etq and prev.tam is not distinct from k.tam and prev.cor is not distinct from k.cor
  left join baixa on baixa.etq = k.etq and baixa.tam is not distinct from k.tam and baixa.cor is not distinct from k.cor
  order by e.nome, k.tam nulls first;
$function$;

CREATE OR REPLACE FUNCTION public._receber_oc_p_acabado_core(_oc_id uuid, _dados jsonb, _grade jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- NOVO (set/2026): materializa cad_etiquetas do BOM (modelo_etiquetas) — a etiqueta/insumo a
  -- separar na Explosão (troca de etiqueta da revenda). quantidade_planejada = quantidade_enviar =
  -- consumo × peças reais recebidas. Idempotente: apaga e regrava as do cad (sem UNIQUE p/ upsert).
  -- O caminho manufaturado NÃO usa esta função — só revenda passa por aqui.
  delete from public.cad_etiquetas where cad_id = v_cad_id;
  insert into public.cad_etiquetas (cad_id, etiqueta_id, cor_id, consumo, quantidade_planejada, quantidade_enviar)
  select v_cad_id, me.etiqueta_id, me.cor_id, me.consumo,
         round(coalesce(me.consumo,0) * v_grand_total, 2),
         round(coalesce(me.consumo,0) * v_grand_total, 2)
  from public.modelo_etiquetas me
  where me.modelo_id = v_produto.modelo_id;

  -- upsert controle_qualidade: mantém 'pendente' (default da coluna) se não existe;
  -- se já existe (inclusive 'confirmado'), NÃO toca — o cad_grades acima já regravou
  -- grades_reais e o trigger trg_rebaixa_direcionamento_grade (AFTER UPDATE OF
  -- grades_reais ON cad_grades) cuida da rebaixa do Direcionamento sozinho.
  if not exists (select 1 from public.controle_qualidade where cad_id = v_cad_id) then
    insert into public.controle_qualidade (cad_id, tenant_id, status) values (v_cad_id, v_tenant, 'pendente');
  end if;

  -- Novo: custo real chegou — recomputa e persiste os preços derivados do espelho
  -- (defensivo/paridade; ver comentário no cabeçalho da migração).
  perform public._pa_recomputar_precos_modelo(v_produto.id);

  return jsonb_build_object('cad_id', v_cad_id, 'total_real', v_grand_total);
end;
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._custo_calcular(uuid,uuid[])', 'f9d87d6a1f9f307a7d83cf837730566c', '{postgres=X/postgres,service_role=X/postgres}', false, 's'),
      ('public.fn_custo_fila_preco()', 'cd405a624d82e23f0ce8120472f04471', '{postgres=X/postgres,service_role=X/postgres}', true, 'v'),
      ('public._estoque_etiqueta_core(uuid)', '28aa308d297cc18b653c6290a5b3b958', '{postgres=X/postgres,service_role=X/postgres}', true, 's'),
      ('public._receber_oc_p_acabado_core(uuid,jsonb,jsonb)', '3f2e2b31f6f28aaa35c9b13c1fb197be', '{postgres=X/postgres,service_role=X/postgres}', true, 'v')
    ) AS x(f, m, acl, sd, vol) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r1_171000_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef = r.sd AND p.provolatile::text = r.vol
                     AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r1_171000_down: pos-condicao falhou na ACL/secdef/search_path/volatilidade de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
