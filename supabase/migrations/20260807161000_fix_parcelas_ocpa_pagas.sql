-- Produto Acabado (Revenda) — Task 3 FIX ROUND 1 (review adversarial, achado HIGH).
--
-- `gerar_parcelas_oc_p_acabado` (20260807160000) dividia `valor_total_desconto`
-- INTEIRO por N ao regerar as não-pagas, em vez de descontar o que já estava pago.
-- Repro: OC 198×99, 20%→10%, parcela 1 PAGA de 5.227,20 → a versão anterior gravava
-- 5.227,20/5.880,60/5.880,60 = Σ 16.988,40 ≠ 17.641,80 (diverge −653,40).
--
-- O motor REAL do sistema (`_recalcular_parcelas_core`, introduzido em
-- 20260619450000 — SUBSTITUI o `recalcular_parcelas` de 20260618130000 que eu tinha
-- lido por engano no Task 3 original) NÃO tem essa divergência: ele calcula
-- `v_restante_valor := v_valor_total - v_pago_total` e divide isso só entre os
-- slots NÃO-pagos, com o ÚLTIMO SLOT REALMENTE INSERIDO (`v_idx = v_n_inserir`,
-- não o índice `i` do loop — `i` pula números já ocupados por parcela paga)
-- absorvendo o resto de arredondamento. Confirmado com `pg_get_functiondef` antes
-- de escrever este fix (o report original do Task 3 errou ao afirmar que o motor
-- real tinha a mesma característica — corrigido no apêndice do task-3-report.md).
--
-- Fix: `gerar_parcelas_oc_p_acabado` passa a espelhar esse algoritmo byte-a-byte
-- (adaptado ao contexto de trigger — NEW em vez de SELECT da OC). Mesma assinatura
-- (CREATE OR REPLACE) — a migration 20260807160000 já aplicada NÃO foi editada.
create or replace function public.gerar_parcelas_oc_p_acabado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_dias integer[];
  v_n_parcelas integer;
  v_valor_total numeric(14,2);
  v_pago_total numeric(14,2) := 0;
  v_restante_valor numeric(14,2);
  v_n_inserir integer := 0;
  v_valor_parcela numeric(12,2);
  v_valor_a_inserir numeric(12,2);
  v_vencimento date;
  v_base_data date;
  v_idx integer := 0;
  i integer;
begin
  v_dias := array(
    select t::int
    from unnest(string_to_array(coalesce(NEW.prazo_pagamento, '30'), '/')) as t
    where t ~ '^[0-9]+$'
  );
  if v_dias is null or array_length(v_dias, 1) is null or array_length(v_dias, 1) < 1 then
    v_dias := array[30];
  end if;
  v_n_parcelas := least(array_length(v_dias, 1), 24);

  -- Soma o que já está pago ANTES de apagar (o DELETE abaixo só atinge não-pagas
  -- de qualquer forma — ordem não muda o resultado, só espelha a leitura do core).
  select coalesce(sum(valor), 0) into v_pago_total
    from public.parcelas
   where oc_p_acabado_id = NEW.id
     and tipo_oc = 'p_acabado'
     and (status = 'pago' or data_pagamento is not null);

  delete from public.parcelas
   where oc_p_acabado_id = NEW.id
     and tipo_oc = 'p_acabado'
     and status is distinct from 'pago'
     and data_pagamento is null;

  -- Quantos slots (1..v_n_parcelas) ainda precisam de INSERT (os demais continuam
  -- ocupados pelas parcelas pagas preservadas pelo DELETE acima).
  select count(*) into v_n_inserir
    from generate_series(1, v_n_parcelas) g(i)
   where not exists (
     select 1 from public.parcelas
      where oc_p_acabado_id = NEW.id and numero_parcela = g.i
   );

  v_valor_total := coalesce(NEW.valor_total_desconto, 0);
  v_restante_valor := v_valor_total - v_pago_total;

  -- Nada a inserir: total zerado, já tudo pago (ou pago > total — não deveria
  -- acontecer, mas não inventa parcela negativa), ou todos os slots já ocupados.
  if v_valor_total <= 0 or v_restante_valor <= 0 or v_n_inserir = 0 then
    return NEW;
  end if;

  v_valor_parcela := round(v_restante_valor / v_n_inserir, 2);
  v_base_data := coalesce(NEW.data_pedido, current_date);

  for i in 1..v_n_parcelas loop
    if exists (
      select 1 from public.parcelas
       where oc_p_acabado_id = NEW.id and numero_parcela = i
    ) then
      continue;
    end if;
    v_idx := v_idx + 1;

    if array_length(v_dias, 1) >= i then
      v_vencimento := v_base_data + v_dias[i];
    else
      v_vencimento := v_base_data + (i * 30);
    end if;

    -- O ÚLTIMO SLOT REALMENTE INSERIDO (v_idx = v_n_inserir) absorve o resto de
    -- arredondamento de v_restante_valor — não necessariamente numero_parcela = N,
    -- se um número do meio já estiver ocupado por uma parcela paga.
    v_valor_a_inserir := case when v_idx = v_n_inserir
      then v_restante_valor - v_valor_parcela * (v_n_inserir - 1)
      else v_valor_parcela end;

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

-- Trigger já aponta pro mesmo nome de função — CREATE OR REPLACE acima já é
-- suficiente, sem precisar recriar o trigger. Reafirmado aqui por clareza/idempotência.
drop trigger if exists trg_gerar_parcelas_ocpa on public.ocs_p_acabado;
create trigger trg_gerar_parcelas_ocpa
after insert or update of valor_total_desconto, prazo_pagamento, data_pedido on public.ocs_p_acabado
for each row execute function public.gerar_parcelas_oc_p_acabado();
