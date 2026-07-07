-- F5b-B (IRREVERSÍVEL): dropa o espelho terceirizados por completo.
-- Só após F5b-A (espelho off, RPCs/frontend migrados p/ empresa_id) + verificação de que
-- nada mais referencia os alvos (funções com fronteira de palavra + embeds do frontend).
-- Integridade confirmada: 0 linhas com terceirizado_id sem empresa_id.
-- DROP sem CASCADE de propósito: se algo ainda depender, falha aqui (não mascara).

-- 1) producao_terceirizados: some a coluna terceirizado_id (empresa_id é a fonte única).
alter table public.producao_terceirizados drop constraint if exists producao_terceirizados_terceirizado_id_fkey;
alter table public.producao_terceirizados drop column if exists terceirizado_id;

-- 2) producao_oficina (tabela morta, 0 linhas): some só o FK p/ terceirizados. A coluna
--    terceirizado_id fica FK-less (a rota legada de oficina ainda a grava). Remover a
--    feature oficina inteira é cleanup próprio.
alter table public.producao_oficina drop constraint if exists producao_oficina_terceirizado_id_fkey;

-- 3) terceirizado_categorias (espelho de categorias) + a função do seu trigger.
drop table if exists public.terceirizado_categorias;
drop function if exists public.set_terc_cat_tenant();

-- 4) terceirizados (tabela-espelho). Sem mais FKs a referenciando após (1)-(3).
drop table if exists public.terceirizados;

-- 5) empresas.origem_terceirizado_id (id-espelho legado; drop leva o índice único parcial).
alter table public.empresas drop column if exists origem_terceirizado_id;

select pg_notify('pgrst','reload schema');
