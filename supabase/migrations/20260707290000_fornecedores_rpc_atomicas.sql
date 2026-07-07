-- Fornecedores/Colaboradores: saves multi-tabela viram RPCs transacionais (tudo-ou-nada).
-- Achados da prova real (auditoria de time): saves em N chamadas soltas podiam deixar
-- estado parcial se caíssem no meio (empresa sem categoria; colaboradores órfãos de tipo).
-- Modelado em set_artigo_categorias (SECURITY DEFINER + search_path + guarda de tenant).

-- ============================================================================
-- 1) set_empresa_categorias: upsert da empresa + sincroniza as DUAS junctions,
--    numa transação só. Retorna o id da empresa. tenant_id vem por trigger no
--    insert; no update a guarda garante mesmo-tenant. Valida categorias do tenant.
-- ============================================================================
create or replace function public.set_empresa_categorias(_empresa jsonb, _cats uuid[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_id     uuid := nullif(_empresa->>'id','')::uuid;
  v_tipo   text := _empresa->>'tipo';
  v_nome   text := trim(coalesce(_empresa->>'nome_fantasia',''));
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  if v_tipo not in ('material','servico') then raise exception 'Tipo de empresa inválido.'; end if;
  if v_nome = '' then raise exception 'Informe o nome fantasia.'; end if;
  if array_length(_cats,1) is null then raise exception 'Selecione ao menos uma categoria.'; end if;

  -- Categorias têm que ser do tenant (ou globais). Barra id de outra loja.
  if v_tipo = 'servico' then
    if exists (select 1 from unnest(_cats) c
               where not exists (select 1 from categorias_terceirizado t
                                 where t.id = c and (t.tenant_id = v_tenant or t.tenant_id is null))) then
      raise exception 'Categoria de serviço inválida para esta loja.';
    end if;
  else
    if exists (select 1 from unnest(_cats) c
               where not exists (select 1 from categorias_fornecedor f
                                 where f.id = c and (f.tenant_id = v_tenant or f.tenant_id is null))) then
      raise exception 'Categoria do fornecedor inválida para esta loja.';
    end if;
  end if;

  if v_id is null then
    insert into empresas (
      tipo, nome_fantasia, cnpj, razao_social, situacao_cadastral,
      telefone, email, logradouro, cep, municipio, uf, contato, observacoes
    ) values (
      v_tipo, v_nome,
      nullif(_empresa->>'cnpj',''), nullif(_empresa->>'razao_social',''),
      nullif(_empresa->>'situacao_cadastral',''), nullif(_empresa->>'telefone',''),
      nullif(_empresa->>'email',''), nullif(_empresa->>'logradouro',''),
      nullif(_empresa->>'cep',''), nullif(_empresa->>'municipio',''),
      nullif(_empresa->>'uf',''), nullif(_empresa->>'contato',''),
      nullif(_empresa->>'observacoes','')
    ) returning id into v_id;  -- set_tenant_id_trg preenche tenant_id
  else
    update empresas set
      tipo = v_tipo,
      nome_fantasia = v_nome,
      cnpj = nullif(_empresa->>'cnpj',''),
      razao_social = nullif(_empresa->>'razao_social',''),
      situacao_cadastral = nullif(_empresa->>'situacao_cadastral',''),
      telefone = nullif(_empresa->>'telefone',''),
      email = nullif(_empresa->>'email',''),
      logradouro = nullif(_empresa->>'logradouro',''),
      cep = nullif(_empresa->>'cep',''),
      municipio = nullif(_empresa->>'municipio',''),
      uf = nullif(_empresa->>'uf',''),
      contato = nullif(_empresa->>'contato',''),
      observacoes = nullif(_empresa->>'observacoes','')
    where id = v_id and tenant_id = v_tenant;
    if not found then raise exception 'Empresa não encontrada'; end if;
  end if;

  -- Sincroniza junctions (limpa também a do OUTRO tipo, caso o tipo tenha mudado).
  delete from empresa_categorias_fornecedor where empresa_id = v_id and tenant_id = v_tenant;
  delete from empresa_categorias_servico     where empresa_id = v_id and tenant_id = v_tenant;
  if v_tipo = 'servico' then
    insert into empresa_categorias_servico (empresa_id, categoria_terceirizado_id)
    select v_id, unnest(_cats);
  else
    insert into empresa_categorias_fornecedor (empresa_id, categoria_fornecedor_id)
    select v_id, unnest(_cats);
  end if;

  return v_id;
end $function$;

-- ============================================================================
-- 2) renomear_tipo_colaborador: renomeia o tipo + propaga aos colaboradores
--    (a coluna colaboradores.tipo é texto solto, sem FK) numa transação só.
--    Colisão de nome (unique tenant,nome) => 23505 e rollback atômico.
-- ============================================================================
create or replace function public.renomear_tipo_colaborador(_id uuid, _novo_nome text, _categoria_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_old    text;
  v_new    text := trim(_novo_nome);
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  if v_new = '' then raise exception 'Informe o nome do tipo.'; end if;

  select nome into v_old from tipos_colaborador where id = _id and tenant_id = v_tenant;
  if v_old is null then raise exception 'Tipo não encontrado'; end if;

  update tipos_colaborador
    set nome = v_new, categoria_terceirizado_id = _categoria_id
    where id = _id and tenant_id = v_tenant;

  if v_new <> v_old then
    update colaboradores set tipo = v_new
      where tipo = v_old and tenant_id = v_tenant;
  end if;
end $function$;

select pg_notify('pgrst','reload schema');
