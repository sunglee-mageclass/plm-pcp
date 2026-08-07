-- 20260807100000_colab_pcp_cq_rev_infra.sql
-- Colab PCP Serviços + CQ (spec 2026-08-07), Task 1: rev nos agregados + bump por filha.
-- Reusa fn_colab_touch_rev() da infra existente (20260803180000). rev é DO SERVIDOR
-- (BEFORE UPDATE sempre incrementa; valor do cliente é ignorado).
BEGIN;

-- rev por BLOCO (cobre PCP + o grade_detalhe compartilhado do bloco-fonte)
alter table public.producao_terceirizados add column if not exists rev int not null default 0;
-- rev por CAD (só CQ: status, datas, cq_variantes)
alter table public.controle_qualidade    add column if not exists rev int not null default 0;

-- BEFORE UPDATE: incrementa rev em cada UPDATE da raiz (reusa a função existente).
drop trigger if exists trg_colab_rev on public.producao_terceirizados;
create trigger trg_colab_rev before update on public.producao_terceirizados
  for each row execute function public.fn_colab_touch_rev();
drop trigger if exists trg_colab_rev on public.controle_qualidade;
create trigger trg_colab_rev before update on public.controle_qualidade
  for each row execute function public.fn_colab_touch_rev();

-- Bump da filha cq_variantes → controle_qualidade (padrão fn_colab_bump_*; SECURITY DEFINER
-- p/ o UPDATE no-op não esbarrar em RLS de fluxos DEFINER). O UPDATE no-op dispara o
-- BEFORE UPDATE acima (rev+1) E emite o evento Realtime que o front escuta.
create or replace function public.fn_colab_bump_cq() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid := coalesce(new.controle_qualidade_id, old.controle_qualidade_id);
begin update public.controle_qualidade set id = id where id = v_id; return coalesce(new, old); end $$;

drop trigger if exists trg_colab_bump on public.cq_variantes;
create trigger trg_colab_bump after insert or update or delete on public.cq_variantes
  for each row execute function public.fn_colab_bump_cq();

-- Publicação Realtime (sem isto o postgres_changes não dispara).
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and tablename='producao_terceirizados')
    then alter publication supabase_realtime add table public.producao_terceirizados; end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and tablename='controle_qualidade')
    then alter publication supabase_realtime add table public.controle_qualidade; end if;
end $$;

COMMIT;
