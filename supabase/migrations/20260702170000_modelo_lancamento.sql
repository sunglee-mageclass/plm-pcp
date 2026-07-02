-- Gate explícito de Lançamentos: no card (Planejamento), após CAD + CQ confirmado,
-- preenche-se a Data de Lançamento e clica "Lançar" (lancado=true). Só então o
-- modelo aparece em Lançamentos.
alter table public.modelos
  add column if not exists data_lancamento date,
  add column if not exists lancado boolean not null default false;

-- Grandfather: modelos que HOJE já apareciam em Lançamentos (enviado ao CAD + CQ
-- confirmado) continuam aparecendo sem precisar re-lançar.
update public.modelos m set lancado = true
where m.enviado_cad = true
  and m.lancado = false
  and exists (
    select 1 from public.cad c
    join public.controle_qualidade cq on cq.cad_id = c.id
    where c.modelo_id = m.id and cq.status = 'confirmado'
  );
