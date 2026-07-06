-- Fase 1 (cor/cor-apelido na variante de tecido): a variante passa a guardar também a
-- Cor apelido, além da cor base (cor_id). ADITIVO e NULLABLE — variantes antigas seguem
-- válidas; o apelido só é obrigatório nas NOVAS (validação no front). Cada apelido já
-- pertence a uma cor base (cores_apelido.cor_base_id), então cor base + apelido são
-- consistentes por construção.
alter table public.variantes_tecido
  add column if not exists cor_apelido_id uuid references public.cores_apelido(id);

create index if not exists idx_variantes_tecido_cor_apelido
  on public.variantes_tecido(cor_apelido_id);

-- Backfill (decisão do dono): quando a cor base da variante tem EXATAMENTE 1 apelido,
-- atribui automaticamente. Cores base com 0 ou vários apelidos ficam NULL (ajuste manual).
update public.variantes_tecido v
set cor_apelido_id = ca.id
from public.cores_apelido ca
where ca.cor_base_id = v.cor_id
  and v.cor_apelido_id is null
  and (
    select count(*) from public.cores_apelido ca2 where ca2.cor_base_id = v.cor_id
  ) = 1;

select pg_notify('pgrst', 'reload schema');
