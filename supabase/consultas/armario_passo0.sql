-- Passo 0 (SO LEITURA) do deploy do F7 Armario. Nada grava. Rode e cole a saida no painel.
\echo === (A) as tabelas/RPCs do Armario AINDA NAO devem existir em producao (todas NULL/0). Se alguma existir, PARE (deploy repetido).
select to_regclass('public.armarios')                      as t_armarios,       -- NULL esperado
       to_regclass('public.armario_itens')                 as t_armario_itens,  -- NULL esperado
       to_regprocedure('public.armario_salvar(uuid,uuid,text,text,text,integer,text,jsonb)') as f_salvar,      -- NULL
       to_regprocedure('public.armario_variantes_disponiveis(uuid,text,uuid)')               as f_variantes,  -- NULL
       to_regprocedure('public.armario_criar(uuid,text,text,text)')                          as f_criar;      -- NULL

\echo === (B) linha de base das 2 funcoes que a D6 vai reemitir (producao NAO tem schema_migrations): devem EXISTIR e NAO conter armario ainda.
select to_regprocedure('public.tenant_module_enabled(text)')        as tme,   -- deve existir
       to_regprocedure('public._tenant_modulo_ligado(uuid,text)')   as tml;   -- deve existir
\echo --- a lista opt-in de HOJE (sem armario): o corpo deve ter os 5 (otb/produto_acabado/produto_importado/distribuicao/etapas_pl) e NAO 'armario'
select position('''armario''' in pg_get_functiondef('public.tenant_module_enabled(text)'::regprocedure))      as tme_tem_armario_deve_ser_0,
       position('''armario''' in pg_get_functiondef('public._tenant_modulo_ligado(uuid,text)'::regprocedure)) as tml_tem_armario_deve_ser_0;

\echo === (C) nenhuma loja tem a chave armario ligada hoje (deve ser 0).
select count(*) as lojas_com_armario_ligado
  from public.tenant_config c
 where (c.modules ->> 'armario') = 'true';
