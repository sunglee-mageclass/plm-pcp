-- Task 7/8 (front — Plan. Produto revenda) — Step 3: Insumos/Explosão.
--
-- Achado: `_estoque_etiqueta_core` (aba Estoque do OC Insumo) calcula "baixa" (consumo)
-- só a partir de `cad_etiquetas` de um `cad` com `enviado_corte = true` (baixa_var/
-- baixa_sem). Modelo `origem='revenda'` NUNCA passa pela Explosão/corte (não tem
-- tecido) — o `cad` que `receber_oc_p_acabado` cria (Task 3, 20260807160000) é bare
-- (`insert into cad (tenant_id, modelo_id) values (...)`, sem `cad_etiquetas`, sem
-- tocar `enviado_corte`, que fica no default `false`). Resultado: o BOM de insumos do
-- modelo (`modelo_etiquetas`, o mesmo usado por `_custo_unitario_modelos_core`/
-- `_salvar_produto_acabado_core`, Tasks 2/4, pra precificar revenda) NUNCA aparecia
-- como consumo na aba Estoque — a coluna "Baixa" ficava em 0 pra sempre, mesmo com OC
-- P. Acabado recebida e peças em mãos, subestimando o físico disponível de etiqueta.
--
-- Fix mínimo, ADITIVO: nova CTE `baixa_revenda` — consumo de insumo revenda na
-- chegada da OC = Σ modelo_etiquetas.consumo × peças recebidas (cad_grades.
-- grade_total_real do cad-espelho de receber_oc_p_acabado), sem tamanho (o BOM de
-- revenda não distingue tamanho — mesma chave (etiqueta,cor) do caso `baixa_sem`,
-- sem depender de `enviado_corte`, que pra revenda nunca é setado). Zero mudança pro
-- caminho de modelos manufaturados (`baixa_var`/`baixa_sem`, origem<>'revenda' — a
-- nova CTE só une resultados de modelos revenda, que nunca têm `cad_etiquetas`, então
-- não há dupla-contagem possível).
--
-- Lido `pg_get_functiondef` da definição VIVA antes de editar — drift confirmado em
-- relação à migration 20260720140000 original (revisada por 20260720180000, chaves
-- (etiqueta,tamanho,cor) diretas, sem "var" por variante_etiqueta_id).

create or replace function public._estoque_etiqueta_core(_tenant uuid)
 returns table(etiqueta_id uuid, etiqueta_nome text, variante_id uuid, tamanho text, cor_nome text,
               recebido numeric, prev_receb numeric, baixa numeric, fisico numeric)
 language sql stable security definer set search_path to 'public'
as $function$
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
  baixa_sem as (  -- consumo sem tamanho: chave (etiqueta, NULL, cor do CAD)
    select ce.etiqueta_id as etq, null::text as tam, ce.cor_id as cor, sum(coalesce(ce.quantidade_enviar, 0)) as tot
    from cad_etiquetas ce
    join cad c on c.id = ce.cad_id and c.tenant_id = _tenant and c.enviado_corte
    where coalesce(ce.enviar_por_tamanho, '{}'::jsonb) = '{}'::jsonb
    group by 1, 3
  ),
  baixa_revenda as (  -- consumo de insumo em REVENDA: sem corte/CAD-tecido — o gatilho é a
                       -- OC P. Acabado recebida, refletida em cad_grades.grade_total_real do
                       -- cad-espelho (receber_oc_p_acabado, Task 3). Sem tamanho (BOM de
                       -- revenda = modelo_etiquetas, sem coluna tamanho).
    select me.etiqueta_id as etq, null::text as tam, me.cor_id as cor,
           sum(me.consumo * coalesce(cg.total_real, 0)) as tot
    from modelo_etiquetas me
    join modelos m on m.id = me.modelo_id and m.tenant_id = _tenant and m.origem = 'revenda'
    join cad c on c.modelo_id = m.id and c.tenant_id = _tenant
    join (select cad_id, sum(grade_total_real) as total_real from cad_grades group by cad_id) cg
      on cg.cad_id = c.id
    group by 1, 3
  ),
  baixa as (
    select etq, tam, cor, sum(tot) as tot
    from (select * from baixa_var union all select * from baixa_sem union all select * from baixa_revenda) x
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

revoke execute on function public._estoque_etiqueta_core(uuid) from public, anon, authenticated;
