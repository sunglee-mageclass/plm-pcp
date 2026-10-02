-- Release I3a — Categoria do tecido / Material do aviamento nos produtos comprados (PA = produtos_acabados, PI =
-- produtos_importados). Plano .superpowers/sdd/2026-10-02-integracao-3-campos/plan.md (§1, §2 I3a; RULINGS no fim). GERADA por
-- .superpowers/sdd/2026-10-02-integracao-3-campos/mig/gerar.mjs a partir do texto VIVO (pg_get_functiondef) da cópia — NUNCA
-- editar os corpos à mão (mude o gerador e gere de novo).
-- Decisões do dono (02/out): P-218 A + correção do dono — card PA/PI ganha "Categoria do tecido" (grupo NÃO Acessórios) e
-- "Material do aviamento" (grupo Acessórios); o valor vira a "Categoria do Tecido Principal" da Integração (I3b). P-219 A: NÃO
-- travam (fora da trava de identidade com OC e da trava da Integração).
-- O que muda:
--   • DDL: produtos_acabados/produtos_importados + categoria_tecido_id (FK categorias_tecido, NO ACTION) e material_aviamento_id
--     (FK materiais_aviamento, NO ACTION) + 4 índices parciais (WHERE ... IS NOT NULL). Colunas nullable, sem backfill.
--   • fn_produto_cat_material_tenant + trg_pa_cat_material_tenant / trg_pi_cat_material_tenant (BEFORE INSERT OR UPDATE OF as 2
--     colunas): id de OUTRA loja = P0001 (precedente enforce_produto_acabado_modelo_tenant). CREATE TRIGGER (não DROP) — não
--     prende auth/storage.
--   • _salvar_produto_acabado_core / _salvar_produto_importado_core: gravam as 2 colunas SÓ quando a chave vem em _dados (padrão
--     tamanho_tipo; vazio = limpa); conferem a loja (P0001 PT); fora do bloco de identidade com OC.
--   • _replicar_produtos_acabados_core / _replicar_produtos_importados_core: a réplica COPIA as 2 colunas (ruling do controlador).
--   • _limpar_produto_acabado_core / _limpar_produto_importado_core: "Limpar produto" zera as 2 colunas (ruling do controlador).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._salvar_produto_acabado_core(uuid,jsonb,jsonb)
--     ANTES  77076d81637354d530ee38a03e8f77e7  (cópia 54422 = "depois" de L8 / Tamanho em nos cards)
--     DEPOIS 9299a1d71336c2126435dec903de4952
--   public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)
--     ANTES  3bbdcb7fd2b1040881ba55c44d04eb17  (cópia 54422 = "depois" de L8 / Tamanho em nos cards)
--     DEPOIS f28985c19fe5efa4f08011137e20f51f
--   public._replicar_produtos_acabados_core(uuid,uuid,uuid,uuid[])
--     ANTES  5aa4cf782687fe1dec96d18ef4d2923d  (cópia 54422 = "depois" de L8 / Tamanho em nos cards)
--     DEPOIS 9fcdf99eb192cd938809dd159fc6d446
--   public._replicar_produtos_importados_core(uuid,uuid,uuid,uuid[])
--     ANTES  dc37b0adf427d1b2f6bca71a8d755ae0  (cópia 54422 = "depois" de L8 / Tamanho em nos cards)
--     DEPOIS a2bd975c6a8c8b65e37b057911845639
--   public._limpar_produto_acabado_core(uuid)
--     ANTES  123ddc5a717d896bc38193806769ccae  (cópia 54422 = "depois" de L8 / Tamanho em nos cards)
--     DEPOIS 153ebd8d87b1050479e73d9c93a826f1
--   public._limpar_produto_importado_core(uuid)
--     ANTES  5fe6e90f2a96881614f45f84f9865bdd  (cópia 54422 = "depois" de L8 / Tamanho em nos cards)
--     DEPOIS 466d486e4e7503a0cf437713372f2d22
--   public.fn_produto_cat_material_tenant()  NOVA b868561c6e3f04574589e6ad49b03fb4  (neutra do inverso: 9484dc06ee6aaf871308dc2745a7068a)
--   dep (intocadas): public.fn_integracao_trava_espelho() e239279ec27fe8257d31e262138b547e; public.fn_modelo_espelho_categoria() ea9edd59c5ec5eff207336dbe06a3499; public._grupo_eh_acessorio(uuid) 359584cea22810caa21985c2c1a4b18a; public.enforce_produto_acabado_modelo_tenant() 113648cfb6de984e0066b2030dc8c65b
-- ====================================================================================
-- Travas: ADD COLUMN pega AccessExclusive por um instante nos 2 produtos (+ ShareRowExclusive nos 2 cadastros pela FK);
-- lock_timeout 500 ms — o kit tenta 3×, horário calmo. Sem DROP. Idempotente (guarda aceita antes OU depois; IF NOT EXISTS).
-- Volta: supabase/rollback/20261030100000_produto_categoria_tecido_material_down.sql (devolve os 6 textos, NEUTRALIZA o gatilho; colunas ficam) e, separado/opcional/horário calmo,
-- supabase/rollback/20261030100000_produto_categoria_tecido_material_down_drop.sql. LIFO: o inverso da 20261030110000 (I3b) roda ANTES deste (a guarda recusa).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  IF to_regclass('public.produtos_acabados') IS NULL OR to_regclass('public.produtos_importados') IS NULL
     OR to_regclass('public.categorias_tecido') IS NULL OR to_regclass('public.materiais_aviamento') IS NULL THEN
    RAISE EXCEPTION 'i3a: tabela ausente (produtos_acabados/produtos_importados/categorias_tecido/materiais_aviamento)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)', '77076d81637354d530ee38a03e8f77e7', '9299a1d71336c2126435dec903de4952'),
      ('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)', '3bbdcb7fd2b1040881ba55c44d04eb17', 'f28985c19fe5efa4f08011137e20f51f'),
      ('public._replicar_produtos_acabados_core(uuid,uuid,uuid,uuid[])', '5aa4cf782687fe1dec96d18ef4d2923d', '9fcdf99eb192cd938809dd159fc6d446'),
      ('public._replicar_produtos_importados_core(uuid,uuid,uuid,uuid[])', 'dc37b0adf427d1b2f6bca71a8d755ae0', 'a2bd975c6a8c8b65e37b057911845639'),
      ('public._limpar_produto_acabado_core(uuid)', '123ddc5a717d896bc38193806769ccae', '153ebd8d87b1050479e73d9c93a826f1'),
      ('public._limpar_produto_importado_core(uuid)', '5fe6e90f2a96881614f45f84f9865bdd', '466d486e4e7503a0cf437713372f2d22')
    ) AS x(f, antes, depois) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 'i3a: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_integracao_trava_espelho()', 'e239279ec27fe8257d31e262138b547e'),
      ('public.fn_modelo_espelho_categoria()', 'ea9edd59c5ec5eff207336dbe06a3499'),
      ('public._grupo_eh_acessorio(uuid)', '359584cea22810caa21985c2c1a4b18a'),
      ('public.enforce_produto_acabado_modelo_tenant()', '113648cfb6de984e0066b2030dc8c65b')
    ) AS x(f, md5) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'i3a: dependencia % com texto inesperado (md5 %)', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_produto_cat_material_tenant()')));
  IF v IS NOT NULL AND v NOT IN ('b868561c6e3f04574589e6ad49b03fb4', '9484dc06ee6aaf871308dc2745a7068a') THEN
    RAISE EXCEPTION 'i3a: public.fn_produto_cat_material_tenant() ja existe com outro texto (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

ALTER TABLE public.produtos_acabados
  ADD COLUMN IF NOT EXISTS categoria_tecido_id uuid REFERENCES public.categorias_tecido(id),
  ADD COLUMN IF NOT EXISTS material_aviamento_id uuid REFERENCES public.materiais_aviamento(id);
ALTER TABLE public.produtos_importados
  ADD COLUMN IF NOT EXISTS categoria_tecido_id uuid REFERENCES public.categorias_tecido(id),
  ADD COLUMN IF NOT EXISTS material_aviamento_id uuid REFERENCES public.materiais_aviamento(id);
CREATE INDEX IF NOT EXISTS idx_pa_categoria_tecido ON public.produtos_acabados (categoria_tecido_id) WHERE categoria_tecido_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pa_material_aviamento ON public.produtos_acabados (material_aviamento_id) WHERE material_aviamento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pi_categoria_tecido ON public.produtos_importados (categoria_tecido_id) WHERE categoria_tecido_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pi_material_aviamento ON public.produtos_importados (material_aviamento_id) WHERE material_aviamento_id IS NOT NULL;
COMMENT ON COLUMN public.produtos_acabados.categoria_tecido_id IS
  'Release I3: Categoria do tecido do produto (grupo nao Acessorios) - vira a Categoria do Tecido Principal da Integracao.';
COMMENT ON COLUMN public.produtos_acabados.material_aviamento_id IS
  'Release I3: Material do aviamento do produto (grupo Acessorios) - vira a Categoria do Tecido Principal da Integracao.';
COMMENT ON COLUMN public.produtos_importados.categoria_tecido_id IS
  'Release I3: Categoria do tecido do produto (grupo nao Acessorios) - vira a Categoria do Tecido Principal da Integracao.';
COMMENT ON COLUMN public.produtos_importados.material_aviamento_id IS
  'Release I3: Material do aviamento do produto (grupo Acessorios) - vira a Categoria do Tecido Principal da Integracao.';

CREATE OR REPLACE FUNCTION public.fn_produto_cat_material_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Release I3 (20261030100000): Categoria do tecido / Material do aviamento do produto comprado (produtos_acabados e
  -- produtos_importados) so da MESMA loja do produto (precedente enforce_produto_acabado_modelo_tenant). NULL passa.
  IF NEW.categoria_tecido_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.categorias_tecido ct
                      WHERE ct.id = NEW.categoria_tecido_id AND ct.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Categoria do tecido de outra loja não pode ser usada aqui.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.material_aviamento_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.materiais_aviamento ma
                      WHERE ma.id = NEW.material_aviamento_id AND ma.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Material do aviamento de outra loja não pode ser usado aqui.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_produto_cat_material_tenant() FROM PUBLIC, anon, authenticated;

DO $gatilhos$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.produtos_acabados'::regclass AND tgname = 'trg_pa_cat_material_tenant') THEN
    CREATE TRIGGER trg_pa_cat_material_tenant BEFORE INSERT OR UPDATE OF categoria_tecido_id, material_aviamento_id
      ON public.produtos_acabados FOR EACH ROW EXECUTE FUNCTION public.fn_produto_cat_material_tenant();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.produtos_importados'::regclass AND tgname = 'trg_pi_cat_material_tenant') THEN
    CREATE TRIGGER trg_pi_cat_material_tenant BEFORE INSERT OR UPDATE OF categoria_tecido_id, material_aviamento_id
      ON public.produtos_importados FOR EACH ROW EXECUTE FUNCTION public.fn_produto_cat_material_tenant();
  END IF;
END
$gatilhos$;

CREATE OR REPLACE FUNCTION public._salvar_produto_acabado_core(_id uuid, _dados jsonb, _variantes jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_id uuid;
  v_modelo_id uuid;
  v_grupo_id uuid;
  v_categoria_id uuid;
  v_sub1_id uuid;
  v_sub2_id uuid;
  v_nome text;
  v_qtd_total int;
  v_valor_unitario numeric;
  v_desconto_pct numeric;
  v_markup_atacado numeric;
  v_markup_varejo numeric;
  v_insumos numeric := 0;
  v_redistribuir boolean;
  v_soma_var int := 0;
  v_pesos jsonb := '{}'::jsonb;
  v_split jsonb := '{}'::jsonb;
  v_variantes_final jsonb := '[]'::jsonb;
  v_nome_final text;
  v_categoria_final uuid;
  v_sub1_final uuid;
  v_sub2_final uuid;
  v_nome_atual text;
  v_grupo_atual uuid;
  v_categoria_atual uuid;
  v_sub1_atual uuid;
  v_sub2_atual uuid;
  v_tem_oc boolean;
  v_tt text;  -- [tamanho-em v1]
  v_ordens_antes int[] := '{}'::int[];  -- [leves L8, sku #22]
  v_cat_tecido uuid;     -- [i3 v1]
  v_mat_aviamento uuid;  -- [i3 v1]
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  v_nome := nullif(_dados->>'nome', '');
  v_grupo_id := nullif(_dados->>'grupo_id', '')::uuid;
  v_categoria_id := nullif(_dados->>'categoria_id', '')::uuid;
  v_sub1_id := nullif(_dados->>'subcategoria1_id', '')::uuid;
  v_sub2_id := nullif(_dados->>'subcategoria2_id', '')::uuid;

  if _id is null then
    if v_grupo_id is null or v_categoria_id is null then
      raise exception 'Informe grupo e categoria do produto.' using errcode = 'P0001';
    end if;
    if v_nome is null then
      raise exception 'Informe o nome do produto.' using errcode = 'P0001';
    end if;
    v_modelo_id := null;
  else
    select modelo_id, nome, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id
      into v_modelo_id, v_nome_atual, v_grupo_atual, v_categoria_atual, v_sub1_atual, v_sub2_atual
      from public.produtos_acabados
      where id = _id and tenant_id = v_tenant
      for update;  -- [pa-sync v1] trava a linha: o "antes" comparado abaixo e o UPDATE veem o MESMO estado
    if not found then
      raise exception 'Produto não encontrado';
    end if;

    v_tem_oc := exists (select 1 from public.ocs_p_acabado where produto_acabado_id = _id);
    if v_tem_oc and (
      coalesce(v_nome, v_nome_atual) is distinct from v_nome_atual
      or v_grupo_id is distinct from v_grupo_atual
      or v_categoria_id is distinct from v_categoria_atual
      or v_sub1_id is distinct from v_sub1_atual
      or v_sub2_id is distinct from v_sub2_atual
    ) then
      raise exception 'Produto com pedido vinculado — desvincule a OC para alterar a identidade.'
        using errcode = 'P0001';
    end if;
  end if;

  v_qtd_total := coalesce(nullif(_dados->>'qtd_total', '')::int, 0);
  v_valor_unitario := coalesce(nullif(_dados->>'valor_unitario', '')::numeric, 0);
  v_desconto_pct := coalesce(nullif(_dados->>'desconto_pct', '')::numeric, 0);
  v_redistribuir := coalesce(_dados->>'redistribuir', 'false') = 'true';

  v_markup_atacado := nullif(_dados->>'markup_atacado', '')::numeric;
  v_markup_varejo := nullif(_dados->>'markup_varejo', '')::numeric;
  if (v_markup_atacado is not null and v_markup_atacado <= 0)
     or (v_markup_varejo is not null and v_markup_varejo <= 0) then
    raise exception 'O markup precisa ser maior que zero.' using errcode = 'P0001';
  end if;

  -- [tamanho-em v1] "Tamanho em" (P-85 A): só quando a chave vem no _dados (a tela manda só se mudou). Com card, o
  -- gatilho do produto (fn_produto_tamanho_tipo_handover) leva o valor ao modelo espelho e limpa o do produto.
  if _dados ? 'tamanho_tipo' then
    v_tt := nullif(_dados->>'tamanho_tipo', '');
    if v_tt is null or v_tt not in ('letra', 'numero') then
      raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';
    end if;
  end if;

  -- [i3 v1] Release I3: Categoria do tecido (grupo nao Acessorios) / Material do aviamento (Acessorios) do produto - so
  -- quando a chave vem no _dados (padrao tamanho_tipo; a tela manda sempre as 2); vazio = limpa. Fora da trava de
  -- identidade com OC e da trava da Integracao (campo informativo, P-219 A). Id de outra loja = recusa (o gatilho
  -- trg_pa_cat_material_tenant confere de novo).
  if _dados ? 'categoria_tecido_id' then
    v_cat_tecido := nullif(_dados->>'categoria_tecido_id', '')::uuid;
    if v_cat_tecido is not null and not exists (select 1 from public.categorias_tecido ct
                                                 where ct.id = v_cat_tecido and ct.tenant_id = v_tenant) then
      raise exception 'Categoria do tecido não encontrada nesta loja.' using errcode = 'P0001';
    end if;
  end if;
  if _dados ? 'material_aviamento_id' then
    v_mat_aviamento := nullif(_dados->>'material_aviamento_id', '')::uuid;
    if v_mat_aviamento is not null and not exists (select 1 from public.materiais_aviamento ma
                                                    where ma.id = v_mat_aviamento and ma.tenant_id = v_tenant) then
      raise exception 'Material do aviamento não encontrado nesta loja.' using errcode = 'P0001';
    end if;
  end if;

  select coalesce(jsonb_object_agg(v->>'ordem', coalesce(nullif(v->>'peso', '')::numeric, 0)), '{}'::jsonb)
    into v_pesos
    from jsonb_array_elements(coalesce(_variantes, '[]'::jsonb)) v;

  if v_redistribuir then
    v_split := public._split_maior_resto(v_qtd_total, v_pesos);
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'ordem', (v->>'ordem')::int,
      'cor_id', nullif(v->>'cor_id', ''),
      'cor_apelido_id', nullif(v->>'cor_apelido_id', ''),
      'peso', coalesce(nullif(v->>'peso', '')::numeric, 0),
      'qtd', case when v_redistribuir
                  then coalesce((v_split->>(v->>'ordem'))::int, 0)
                  else coalesce(nullif(v->>'qtd', '')::int, 0)
             end
    )), '[]'::jsonb),
    coalesce(sum(case when v_redistribuir
                       then coalesce((v_split->>(v->>'ordem'))::int, 0)
                       else coalesce(nullif(v->>'qtd', '')::int, 0)
                  end), 0)
  into v_variantes_final, v_soma_var
  from jsonb_array_elements(coalesce(_variantes, '[]'::jsonb)) v;

  if not v_redistribuir and v_soma_var <> v_qtd_total then
    raise exception 'A soma das variantes (%) difere da quantidade total (%)', v_soma_var, v_qtd_total
      using errcode = 'P0001';
  end if;

  if v_modelo_id is not null then
    -- [leves L8, preco M1] custo_previsto da linha JA e preco x consumo x (1 + perda) (por peca) -> soma direta (antes
    -- multiplicava o consumo de novo); = _pa_recomputar_precos_modelo e _custo_unitario_modelos_core (CTE pa).
    select coalesce(sum(coalesce(me.custo_previsto, 0)), 0) into v_insumos
      from public.modelo_etiquetas me where me.modelo_id = v_modelo_id;
  end if;

  if _id is null then
    insert into public.produtos_acabados (
      tenant_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor, composicao,
      grade_proporcao, qtd_total, valor_unitario, desconto_pct, insumos_total,
      markup_atacado, markup_varejo, foto_url, tamanho_tipo, categoria_tecido_id, material_aviamento_id  -- [i3 v1]
    ) values (
      v_tenant, v_nome, nullif(_dados->>'ref', ''), v_grupo_id, v_categoria_id,
      v_sub1_id, v_sub2_id,
      nullif(_dados->>'colecao_id', '')::uuid, _dados->>'subcolecao', _dados->>'semana',
      nullif(_dados->>'empresa_id', '')::uuid, nullif(_dados->>'representante_id', '')::uuid,
      _dados->>'ref_fornecedor', _dados->>'composicao',
      coalesce(_dados->'grade_proporcao', '{}'::jsonb), v_qtd_total, v_valor_unitario, v_desconto_pct, v_insumos,
      v_markup_atacado, v_markup_varejo, nullif(_dados->>'foto_url', ''), v_tt,  -- [tamanho-em v1]
      v_cat_tecido, v_mat_aviamento  -- [i3 v1]
    ) returning id into v_id;
  else
    update public.produtos_acabados set
      nome = coalesce(v_nome, nome),
      ref = coalesce(nullif(_dados->>'ref', ''), ref),
      grupo_id = v_grupo_id,
      categoria_id = v_categoria_id,
      subcategoria1_id = v_sub1_id,
      subcategoria2_id = v_sub2_id,
      colecao_id = nullif(_dados->>'colecao_id', '')::uuid,
      subcolecao = _dados->>'subcolecao',
      semana = _dados->>'semana',
      empresa_id = nullif(_dados->>'empresa_id', '')::uuid,
      representante_id = nullif(_dados->>'representante_id', '')::uuid,
      ref_fornecedor = _dados->>'ref_fornecedor',
      composicao = _dados->>'composicao',
      grade_proporcao = coalesce(_dados->'grade_proporcao', '{}'::jsonb),
      qtd_total = v_qtd_total,
      valor_unitario = v_valor_unitario,
      desconto_pct = v_desconto_pct,
      insumos_total = v_insumos,
      markup_atacado = v_markup_atacado,
      markup_varejo = v_markup_varejo,
      -- Última edição manda (set/2026): markup não-null LIMPA o preço fixo do canal, espelhando a RPC
      -- dedicada `_salvar_precos_fixo_produto_acabado_core`. Sem isto o save em LOTE deixava fixo E
      -- markup no mesmo canal (banco inconsistente + arredondamento ressuscitava no próximo ciclo).
      preco_atacado_fixo = case when v_markup_atacado is not null then null else preco_atacado_fixo end,
      preco_varejo_fixo = case when v_markup_varejo is not null then null else preco_varejo_fixo end,
      foto_url = nullif(_dados->>'foto_url', ''),
      tamanho_tipo = case when _dados ? 'tamanho_tipo' then v_tt else tamanho_tipo end,  -- [tamanho-em v1]
      categoria_tecido_id = case when _dados ? 'categoria_tecido_id' then v_cat_tecido else categoria_tecido_id end,  -- [i3 v1]
      material_aviamento_id = case when _dados ? 'material_aviamento_id' then v_mat_aviamento else material_aviamento_id end,  -- [i3 v1]
      updated_at = now()
    where id = _id and tenant_id = v_tenant
    returning nome, categoria_id, subcategoria1_id, subcategoria2_id
      into v_nome_final, v_categoria_final, v_sub1_final, v_sub2_final;
    v_id := _id;

    -- [pa-sync v1] P-136 A: o card só recebe do produto o que MUDOU neste save (valor novo IS DISTINCT FROM o gravado
    -- antes, lido acima), coluna a coluna; o resto fica como está no card (ex.: Categoria trocada no Planejamento).
    -- Nada mudou (ou o card já tem o valor, ex.: nome já levado por trg_espelho_modelo_nome_ref) = nenhum UPDATE:
    -- o rev do card não sobe e a trava da Integração (trg_zz_integracao_trava) não é acionada.
    if v_modelo_id is not null then
      update public.modelos set
        nome = case when v_nome_final is distinct from v_nome_atual then v_nome_final else nome end,
        categoria_principal_id = case when v_categoria_final is distinct from v_categoria_atual
                                      then v_categoria_final else categoria_principal_id end,
        subcategoria1_id = case when v_sub1_final is distinct from v_sub1_atual then v_sub1_final else subcategoria1_id end,
        subcategoria2_id = case when v_sub2_final is distinct from v_sub2_atual then v_sub2_final else subcategoria2_id end
      where id = v_modelo_id
        and ((v_nome_final is distinct from v_nome_atual and nome is distinct from v_nome_final)
          or (v_categoria_final is distinct from v_categoria_atual and categoria_principal_id is distinct from v_categoria_final)
          or (v_sub1_final is distinct from v_sub1_atual and subcategoria1_id is distinct from v_sub1_final)
          or (v_sub2_final is distinct from v_sub2_atual and subcategoria2_id is distinct from v_sub2_final));
    end if;
  end if;

  -- [leves L8, sku #22] ordens das variantes ANTES deste save (a grade cor x tamanho do card espelho mora em
  -- modelo_grades com variante_numero = ordem).
  select coalesce(array_agg(pav.ordem), '{}'::int[]) into v_ordens_antes
    from public.produto_acabado_variantes pav where pav.produto_acabado_id = v_id;

  delete from public.produto_acabado_variantes where produto_acabado_id = v_id;
  insert into public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
  select v_tenant, v_id,
         (elem->>'ordem')::int,
         nullif(elem->>'cor_id', '')::uuid,
         nullif(elem->>'cor_apelido_id', '')::uuid,
         coalesce((elem->>'peso')::numeric, 0),
         coalesce((elem->>'qtd')::int, 0)
  from jsonb_array_elements(v_variantes_final) elem;

  -- [leves L8, sku #22] a variante que SAIU neste save leva junto a grade dela no card espelho: sem isto, uma variante
  -- nova que reusasse a mesma ordem herdava a grade da apagada. So as ordens que existiam antes e nao vieram agora (a
  -- grade de quem fica nao muda). Produto travado pela Integracao ja recusa mudar variantes (trg_zz_integracao_trava_var).
  if v_modelo_id is not null and cardinality(v_ordens_antes) > 0 then
    delete from public.modelo_grades g
     where g.modelo_id = v_modelo_id
       and g.variante_numero = any (v_ordens_antes)
       and not exists (select 1 from jsonb_array_elements(v_variantes_final) e
                        where (e->>'ordem')::int = g.variante_numero);
  end if;

  perform public._pa_recomputar_precos_modelo(v_id);

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public._salvar_produto_importado_core(_id uuid, _dados jsonb, _variantes jsonb, _etapas jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_grupo_id uuid;
  v_categoria_id uuid;
  v_soma_merc numeric;
  v_soma_frete numeric;
  rec jsonb;
  v_ord int;
  v_tt text;  -- [tamanho-em v1]
  v_modelo_id uuid;                     -- [leves L8, sku #22]
  v_ordens_antes int[] := '{}'::int[];  -- [leves L8, sku #22]
  v_vu_m1 numeric := 0;                 -- [leves L8, P-207 A]
  v_cat_tecido uuid;                    -- [i3 v1]
  v_mat_aviamento uuid;                 -- [i3 v1]
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  v_nome := nullif(_dados->>'nome','');
  v_grupo_id := nullif(_dados->>'grupo_id','')::uuid;
  v_categoria_id := nullif(_dados->>'categoria_id','')::uuid;

  -- Validação Σ% por base = 100 (só quando há etapas da base).
  select coalesce(sum((e->>'percentual')::numeric),0) into v_soma_merc
    from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base' = 'mercadoria';
  select coalesce(sum((e->>'percentual')::numeric),0) into v_soma_frete
    from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base' = 'frete';
  if exists(select 1 from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base'='mercadoria') and round(v_soma_merc,2) <> 100 then
    raise exception 'A soma das etapas de mercadoria (%) precisa fechar 100%%.', round(v_soma_merc,2) using errcode = 'P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base'='frete') and round(v_soma_frete,2) <> 100 then
    raise exception 'A soma das etapas de frete (%) precisa fechar 100%%.', round(v_soma_frete,2) using errcode = 'P0001';
  end if;

  -- [tamanho-em v1] "Tamanho em" (P-85 A): só quando a chave vem no _dados (a tela manda só se mudou). Com card, o
  -- gatilho do produto (fn_produto_tamanho_tipo_handover) leva o valor ao modelo espelho e limpa o do produto.
  if _dados ? 'tamanho_tipo' then
    v_tt := nullif(_dados->>'tamanho_tipo', '');
    if v_tt is null or v_tt not in ('letra', 'numero') then
      raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';
    end if;
  end if;

  -- [i3 v1] Release I3: Categoria do tecido (grupo nao Acessorios) / Material do aviamento (Acessorios) do produto - so
  -- quando a chave vem no _dados (padrao tamanho_tipo; a tela manda sempre as 2); vazio = limpa. Fora da trava de
  -- identidade com OC e da trava da Integracao (campo informativo, P-219 A). Id de outra loja = recusa (o gatilho
  -- trg_pi_cat_material_tenant confere de novo).
  if _dados ? 'categoria_tecido_id' then
    v_cat_tecido := nullif(_dados->>'categoria_tecido_id', '')::uuid;
    if v_cat_tecido is not null and not exists (select 1 from public.categorias_tecido ct
                                                 where ct.id = v_cat_tecido and ct.tenant_id = v_tenant) then
      raise exception 'Categoria do tecido não encontrada nesta loja.' using errcode = 'P0001';
    end if;
  end if;
  if _dados ? 'material_aviamento_id' then
    v_mat_aviamento := nullif(_dados->>'material_aviamento_id', '')::uuid;
    if v_mat_aviamento is not null and not exists (select 1 from public.materiais_aviamento ma
                                                    where ma.id = v_mat_aviamento and ma.tenant_id = v_tenant) then
      raise exception 'Material do aviamento não encontrado nesta loja.' using errcode = 'P0001';
    end if;
  end if;

  if _id is null then
    if v_grupo_id is null or v_categoria_id is null then
      raise exception 'Informe grupo e categoria do produto.' using errcode = 'P0001';
    end if;
    if v_nome is null then
      raise exception 'Informe o nome do produto.' using errcode = 'P0001';
    end if;
    insert into public.produtos_importados (
      tenant_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor,
      composicao, grade_proporcao, qtd_total, foto_url, data_pedido, data_prevista, data_entrega,
      moeda_compra, moeda_intermediaria, valor_unitario_m1, cotacao_ref, peso_kg, transporte_m2,
      desconto_pct, cotacao_final, markup_atacado, markup_varejo, tamanho_tipo, categoria_tecido_id, material_aviamento_id  -- [i3 v1]
    ) values (
      -- ref: se o usuário digitou uma REF manual, ela é gravada e o trigger fn_produto_importado_ref
      -- NÃO a sobrescreve (ele só gera quando new.ref é vazio). Senão null → trigger gera a automática.
      v_tenant, v_nome, nullif(_dados->>'ref',''), v_grupo_id, v_categoria_id,
      nullif(_dados->>'subcategoria1_id','')::uuid, nullif(_dados->>'subcategoria2_id','')::uuid,
      nullif(_dados->>'colecao_id','')::uuid, nullif(_dados->>'subcolecao',''), nullif(_dados->>'semana',''),
      nullif(_dados->>'empresa_id','')::uuid, nullif(_dados->>'representante_id','')::uuid, nullif(_dados->>'ref_fornecedor',''),
      nullif(_dados->>'composicao',''), coalesce(_dados->'grade_proporcao','{}'::jsonb), coalesce((_dados->>'qtd_total')::int,0),
      nullif(_dados->>'foto_url',''), nullif(_dados->>'data_pedido','')::date, nullif(_dados->>'data_prevista','')::date, nullif(_dados->>'data_entrega','')::date,
      coalesce(nullif(_dados->>'moeda_compra',''),'RMB'), nullif(_dados->>'moeda_intermediaria',''),
      coalesce((_dados->>'valor_unitario_m1')::numeric,0), coalesce((_dados->>'cotacao_ref')::numeric,0),
      coalesce((_dados->>'peso_kg')::numeric,0), coalesce((_dados->>'transporte_m2')::numeric,0),
      coalesce((_dados->>'desconto_pct')::numeric,0), coalesce((_dados->>'cotacao_final')::numeric,0),
      nullif(_dados->>'markup_atacado','')::numeric, nullif(_dados->>'markup_varejo','')::numeric,
      v_tt,  -- [tamanho-em v1]
      v_cat_tecido, v_mat_aviamento  -- [i3 v1]
    ) returning id into v_id;
  else
    update public.produtos_importados set
      nome = coalesce(v_nome, nome),
      -- ref: grava a manual digitada; se vier vazia, mantém a atual (não zera a REF existente).
      ref = coalesce(nullif(_dados->>'ref',''), ref),
      grupo_id = coalesce(v_grupo_id, grupo_id),
      categoria_id = coalesce(v_categoria_id, categoria_id),
      subcategoria1_id = nullif(_dados->>'subcategoria1_id','')::uuid,
      subcategoria2_id = nullif(_dados->>'subcategoria2_id','')::uuid,
      subcolecao = nullif(_dados->>'subcolecao',''),
      semana = nullif(_dados->>'semana',''),
      empresa_id = nullif(_dados->>'empresa_id','')::uuid,
      representante_id = nullif(_dados->>'representante_id','')::uuid,
      ref_fornecedor = nullif(_dados->>'ref_fornecedor',''),
      composicao = nullif(_dados->>'composicao',''),
      grade_proporcao = coalesce(_dados->'grade_proporcao', grade_proporcao),
      qtd_total = coalesce((_dados->>'qtd_total')::int, qtd_total),
      foto_url = nullif(_dados->>'foto_url',''),
      data_pedido = nullif(_dados->>'data_pedido','')::date,
      data_prevista = nullif(_dados->>'data_prevista','')::date,
      data_entrega = nullif(_dados->>'data_entrega','')::date,
      moeda_compra = coalesce(nullif(_dados->>'moeda_compra',''), moeda_compra),
      moeda_intermediaria = nullif(_dados->>'moeda_intermediaria',''),
      valor_unitario_m1 = coalesce((_dados->>'valor_unitario_m1')::numeric, valor_unitario_m1),
      cotacao_ref = coalesce((_dados->>'cotacao_ref')::numeric, cotacao_ref),
      peso_kg = coalesce((_dados->>'peso_kg')::numeric, peso_kg),
      transporte_m2 = coalesce((_dados->>'transporte_m2')::numeric, transporte_m2),
      desconto_pct = coalesce((_dados->>'desconto_pct')::numeric, desconto_pct),
      cotacao_final = coalesce((_dados->>'cotacao_final')::numeric, cotacao_final),
      markup_atacado = nullif(_dados->>'markup_atacado','')::numeric,
      markup_varejo = nullif(_dados->>'markup_varejo','')::numeric,
      tamanho_tipo = case when _dados ? 'tamanho_tipo' then v_tt else tamanho_tipo end,  -- [tamanho-em v1]
      categoria_tecido_id = case when _dados ? 'categoria_tecido_id' then v_cat_tecido else categoria_tecido_id end,  -- [i3 v1]
      material_aviamento_id = case when _dados ? 'material_aviamento_id' then v_mat_aviamento else material_aviamento_id end,  -- [i3 v1]
      updated_at = now()
    where id = _id and tenant_id = v_tenant
    returning id into v_id;
    if v_id is null then raise exception 'Produto não encontrado'; end if;
  end if;

  -- [leves L8, P-207 A + Q2] etapa de MERCADORIA (base vazia = mercadoria) com % > 0 e cotacao <= 0 nao converte (o landed
  -- a ignora e a parcela da OC sai 0 e e pulada): recusa - mas SO quando a compra tem valor (valor_unitario_m1 > 0, o valor
  -- JA gravado nesta transacao). Produto recem-criado/sem valor salva os outros campos sem a cotacao de referencia. Mesma
  -- regra na tela (erroCotacaoEtapas, src/lib/importado-etapas.ts) e na OC (_salvar_oc_importado_core). Frete com cotacao
  -- 0 segue valendo (= identidade, "deixe 1 se o frete ja esta em R$").
  select pi.modelo_id, coalesce(pi.valor_unitario_m1, 0) into v_modelo_id, v_vu_m1
    from public.produtos_importados pi where pi.id = v_id and pi.tenant_id = v_tenant;
  if v_vu_m1 > 0 and exists(select 1 from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e
             where coalesce(nullif(e->>'base',''),'mercadoria') = 'mercadoria'
               and coalesce(nullif(e->>'percentual','')::numeric, 0) > 0
               and coalesce(nullif(e->>'cotacao','')::numeric, 0) <= 0) then
    raise exception 'Informe a cotacao da etapa de mercadoria (percentual maior que zero e cotacao zerada).' using errcode = 'P0001';
  end if;

  -- [integracao v1] D14/R1: o preço do Importado grava no SALVAR da tela, NESTA transação (a do _rev_base do wrapper).
  -- Preço FIXO no _dados = preço exato do canal e ZERA o markup dele; sem fixo, markup não-nulo LIMPA o fixo ("última
  -- edição manda", como a revenda — fix 2efa2ba); sem nenhum dos dois, o fixo fica (outros gravadores não mandam as chaves).
  -- ruling do controlador, G-migration fix 3 #J2 (P-91 A): a chave preco_atacado_fixo/preco_varejo_fixo PRESENTE com
  -- vazio/NULL (com o markup do canal TAMBÉM vazio/ausente) agora LIMPA o fixo — espelha exatamente o comportamento
  -- do Produto Acabado (o front chama salvar_precos_fixo_produto_acabado com _tocar_varejo=true incondicionalmente a
  -- cada blur que muda o valor exibido, inclusive apagar para vazio: novo=null !== atual dispara _tocar_varejo=true,
  -- _preco_varejo_fixo=null, que grava preco_varejo_fixo=NULL sem olhar o markup — ver ProdutoCard.tsx/
  -- useRevendaPlanejamento.ts). Antes, a chave presente-e-vazia caía no MESMO ramo de "chave ausente" (mantinha o
  -- valor atual, "else x.preco_varejo_fixo") quando o markup também estava vazio — "apagar o Valor" no Importado
  -- não apagava o fixo (D14 do parecer, nuance aceita como bug pelo dono na P-91). Regra final (3 casos, na MESMA
  -- ORDEM de prioridade do código original — fixo primeiro): (1) chave do fixo PRESENTE com número → grava o fixo
  -- exato e zera o markup do canal (prioridade sobre um markup que porventura venha junto no mesmo payload — R1,
  -- "o SALVAR grava o fixo exato e zera o markup"); (2) senão, chave do fixo PRESENTE mas vazia/NULL → NOVO (J2):
  -- limpa o fixo (NULL); o markup do canal só é setado se a chave dele TAMBÉM vier presente com número, senão fica
  -- como estava; (3) chave do fixo AUSENTE e markup do canal PRESENTE e não-vazio → limpa o fixo (NULL) e grava o
  -- markup — "última edição manda" original, preservado byte a byte (era o ÚNICO jeito de limpar o fixo antes do
  -- J2); (4) nenhuma das duas chaves presentes/preenchidas → nada muda (outros gravadores não mandam as chaves).
  if coalesce(nullif(_dados->>'preco_atacado_fixo','')::numeric, 1) <= 0
     or coalesce(nullif(_dados->>'preco_varejo_fixo','')::numeric, 1) <= 0 then
    raise exception 'O preço precisa ser maior que zero.' using errcode = 'P0001';
  end if;
  update public.produtos_importados p
     set preco_atacado_fixo = n.af, markup_atacado = n.am, preco_varejo_fixo = n.vf, markup_varejo = n.vm
    from (select
            case when _dados ? 'preco_atacado_fixo' then nullif(_dados->>'preco_atacado_fixo','')::numeric
                 when nullif(_dados->>'markup_atacado','') is not null then null
                 else x.preco_atacado_fixo end as af,
            case when _dados ? 'preco_atacado_fixo' and nullif(_dados->>'preco_atacado_fixo','') is not null then null
                 when _dados ? 'preco_atacado_fixo' then coalesce(nullif(_dados->>'markup_atacado','')::numeric, x.markup_atacado)
                 when nullif(_dados->>'markup_atacado','') is not null then nullif(_dados->>'markup_atacado','')::numeric
                 else x.markup_atacado end as am,
            case when _dados ? 'preco_varejo_fixo' then nullif(_dados->>'preco_varejo_fixo','')::numeric
                 when nullif(_dados->>'markup_varejo','') is not null then null
                 else x.preco_varejo_fixo end as vf,
            case when _dados ? 'preco_varejo_fixo' and nullif(_dados->>'preco_varejo_fixo','') is not null then null
                 when _dados ? 'preco_varejo_fixo' then coalesce(nullif(_dados->>'markup_varejo','')::numeric, x.markup_varejo)
                 when nullif(_dados->>'markup_varejo','') is not null then nullif(_dados->>'markup_varejo','')::numeric
                 else x.markup_varejo end as vm
            from public.produtos_importados x where x.id = v_id) n
   where p.id = v_id
     and (p.preco_atacado_fixo, p.markup_atacado, p.preco_varejo_fixo, p.markup_varejo) is distinct from (n.af, n.am, n.vf, n.vm);

  -- [leves L8, sku #22] ordens das variantes ANTES deste save (a grade cor x tamanho do card espelho mora em
  -- modelo_grades com variante_numero = ordem).
  select coalesce(array_agg(piv.ordem), '{}'::int[]) into v_ordens_antes
    from public.produto_importado_variantes piv where piv.produto_importado_id = v_id;

  -- Variantes: estado completo (apaga e reinsere pela ordem recebida).
  delete from public.produto_importado_variantes where produto_importado_id = v_id;
  for rec in select * from jsonb_array_elements(coalesce(_variantes,'[]'::jsonb)) loop
    insert into public.produto_importado_variantes (tenant_id, produto_importado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
    values (v_tenant, v_id, coalesce((rec->>'ordem')::int, 0),
      nullif(rec->>'cor_id','')::uuid, nullif(rec->>'cor_apelido_id','')::uuid,
      coalesce((rec->>'peso')::numeric,0), coalesce((rec->>'qtd')::int,0));
  end loop;

  -- [leves L8, sku #22] a variante que SAIU neste save leva junto a grade dela no card espelho (mesma regra da revenda,
  -- _salvar_produto_acabado_core): so as ordens que existiam antes e nao vieram agora; card da MESMA loja. Produto travado
  -- pela Integracao ja recusa mudar variantes (trg_zz_integracao_trava_var).
  if v_modelo_id is not null and cardinality(v_ordens_antes) > 0
     and exists (select 1 from public.modelos m where m.id = v_modelo_id and m.tenant_id = v_tenant) then
    delete from public.modelo_grades g
     where g.modelo_id = v_modelo_id
       and g.variante_numero = any (v_ordens_antes)
       and not exists (select 1 from jsonb_array_elements(coalesce(_variantes,'[]'::jsonb)) e
                        where coalesce((e->>'ordem')::int, 0) = g.variante_numero);
  end if;

  -- Etapas: estado completo.
  delete from public.produto_importado_etapas where produto_importado_id = v_id;
  for rec in select * from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) loop
    insert into public.produto_importado_etapas (tenant_id, produto_importado_id, ordem, rotulo, base, percentual, data_vencimento, cotacao)
    values (v_tenant, v_id, coalesce((rec->>'ordem')::int,0), nullif(rec->>'rotulo',''),
      coalesce(nullif(rec->>'base',''),'mercadoria'), coalesce((rec->>'percentual')::numeric,0),
      nullif(rec->>'data_vencimento','')::date, coalesce((rec->>'cotacao')::numeric,0));
  end loop;

  perform public._imp_recomputar_precos_modelo(v_id);
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public._replicar_produtos_acabados_core(_tenant uuid, _destino_colecao_id uuid, _destino_subcolecao_id uuid, _produto_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_col_nome text;
  v_sub_nome text;
  o record;           -- produto de origem
  om record;          -- modelo espelho do original
  v_root uuid;
  v_versao int;
  v_novo_produto uuid;
  v_novo_modelo uuid;
  v_grade jsonb;
  v_total numeric;
  rec record;
  v_out jsonb := '[]'::jsonb;
begin
  if _tenant is null or _tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant' using errcode = '42501';
  end if;

  -- Coleção destino da loja + nome (produtos_acabados guarda subcolecao TEXTO).
  select nome into v_col_nome from public.colecoes where id = _destino_colecao_id and tenant_id = _tenant;
  if v_col_nome is null then raise exception 'Coleção de destino não encontrada' using errcode = 'P0001'; end if;
  if _destino_subcolecao_id is not null then
    select nome into v_sub_nome from public.colecao_subcolecoes
      where id = _destino_subcolecao_id and colecao_id = _destino_colecao_id and tenant_id = _tenant;
    if v_sub_nome is null then raise exception 'Subcoleção de destino inválida' using errcode = 'P0001'; end if;
  end if;

  for o in select * from public.produtos_acabados
           where id = any(_produto_ids) and tenant_id = _tenant for update loop
    -- Só replica quem tem card materializado (precisamos da raiz da família p/ versionar).
    if o.modelo_id is null then continue; end if;
    select * into om from public.modelos where id = o.modelo_id and tenant_id = _tenant;
    if not found then continue; end if;

    -- Versão: raiz da família + max(versao)+1 (laço de versão, como Plan.Tecido/Importado).
    v_root := coalesce(om.modelo_base_id, om.id);
    select coalesce(max(versao),0)+1 into v_versao from public.modelos
      where tenant_id = _tenant and (id = v_root or modelo_base_id = v_root);

    -- (1) Copia produtos_acabados p/ o destino. REF MANTIDA do original (o mesmo produto — a
    --     diferenciação é só o versionamento do espelho `modelos`). Passar `o.ref` faz o trigger
    --     fn_produto_acabado_ref NÃO gerar outra (ele só gera quando ref vem vazia). modelo_id NULL
    --     (setado abaixo). mix_id NÃO copiado: a família (colecao_mixes) é escopada por
    --     (colecao_id, subcolecao); a réplica vai p/ OUTRO destino, então herdar o mix da ORIGEM
    --     apontaria p/ família de outra subcoleção (órfão). Réplica nasce sem família (mix_id null).
    insert into public.produtos_acabados (
      tenant_id, modelo_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor, composicao,
      grade_proporcao, qtd_total, valor_unitario, desconto_pct, insumos_total, markup_atacado, markup_varejo,
      categoria_tecido_id, material_aviamento_id  -- [i3 v1] a replica leva a Categoria do tecido / Material do aviamento
    ) values (
      _tenant, null, o.nome, o.ref, o.grupo_id, o.categoria_id, o.subcategoria1_id, o.subcategoria2_id,
      _destino_colecao_id, v_sub_nome, o.semana, o.empresa_id, o.representante_id, o.ref_fornecedor, o.composicao,
      o.grade_proporcao, o.qtd_total, o.valor_unitario, o.desconto_pct, o.insumos_total, o.markup_atacado, o.markup_varejo,
      o.categoria_tecido_id, o.material_aviamento_id  -- [i3 v1]
    ) returning id into v_novo_produto;

    -- (2) Variantes.
    insert into public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
      select _tenant, v_novo_produto, ordem, cor_id, cor_apelido_id, peso, qtd
      from public.produto_acabado_variantes where produto_acabado_id = o.id;

    -- (3) Espelho modelos VERSIONADO (origem='revenda'). REF = a do produto (= a do original,
    --     mantida acima); revenda passa por FORA do fluxo ref_auto→aprovar. versao/modelo_base_id
    --     distinguem. mix_id null (família não migra p/ outra subcoleção — ver comentário no INSERT do produto).
    insert into public.modelos (
      tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, ref, linha_id, modelo_base_id, versao, tamanho_tipo
    )
    select _tenant, o.nome, 'revenda', o.categoria_id, o.subcategoria1_id, o.subcategoria2_id,
           _destino_colecao_id, v_sub_nome, o.semana, pa.ref, null, v_root, v_versao,
           coalesce(om.tamanho_tipo, 'letra')  -- [tamanho-em v1] a réplica leva o "Tamanho em" do card de origem
    from public.produtos_acabados pa where pa.id = v_novo_produto
    returning id into v_novo_modelo;

    update public.produtos_acabados set modelo_id = v_novo_modelo, updated_at = now() where id = v_novo_produto;

    -- modelo_grades por variante (mesma lógica de _criar_card_produto_acabado_core).
    for rec in select ordem, qtd from public.produto_acabado_variantes where produto_acabado_id = v_novo_produto loop
      v_grade := public._pa_grade_variante(o.grupo_id, o.grade_proporcao, rec.qtd);
      select coalesce(sum((value)::numeric), 0) into v_total from jsonb_each_text(v_grade);
      insert into public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
      values (v_novo_modelo, rec.ordem, v_grade, v_total::int);
    end loop;

    perform public._pa_recomputar_precos_modelo(v_novo_produto);

    v_out := v_out || jsonb_build_object('origem_produto_id', o.id, 'novo_produto_id', v_novo_produto, 'novo_modelo_id', v_novo_modelo);
  end loop;

  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION public._replicar_produtos_importados_core(_tenant uuid, _destino_colecao_id uuid, _destino_subcolecao_id uuid, _produto_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_col_nome text;
  v_sub_nome text;
  o record;           -- produto de origem
  om record;          -- modelo espelho do original
  v_root uuid;
  v_versao int;
  v_novo_produto uuid;
  v_novo_modelo uuid;
  v_grade jsonb;
  v_total numeric;
  rec record;
  v_out jsonb := '[]'::jsonb;
begin
  if _tenant is null or _tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant' using errcode = '42501';
  end if;

  -- Coleção destino da loja + nome (produtos_importados guarda subcolecao TEXTO, como a revenda).
  select nome into v_col_nome from public.colecoes where id = _destino_colecao_id and tenant_id = _tenant;
  if v_col_nome is null then raise exception 'Coleção de destino não encontrada' using errcode = 'P0001'; end if;
  if _destino_subcolecao_id is not null then
    select nome into v_sub_nome from public.colecao_subcolecoes
      where id = _destino_subcolecao_id and colecao_id = _destino_colecao_id and tenant_id = _tenant;
    if v_sub_nome is null then raise exception 'Subcoleção de destino inválida' using errcode = 'P0001'; end if;
  end if;

  for o in select * from public.produtos_importados
           where id = any(_produto_ids) and tenant_id = _tenant for update loop
    -- Só replica quem tem card materializado (precisamos da raiz da família p/ versionar).
    if o.modelo_id is null then continue; end if;
    select * into om from public.modelos where id = o.modelo_id and tenant_id = _tenant;
    if not found then continue; end if;

    -- Versão: raiz da família + max(versao)+1 (laço de versão, como Plan.Tecido).
    v_root := coalesce(om.modelo_base_id, om.id);
    select coalesce(max(versao),0)+1 into v_versao from public.modelos
      where tenant_id = _tenant and (id = v_root or modelo_base_id = v_root);

    -- (1) Copia produtos_importados p/ o destino. REF MANTIDA do original (é O MESMO produto — a
    --     diferenciação é só o versionamento do espelho `modelos`). Passar `o.ref` faz o trigger
    --     fn_produto_importado_ref NÃO gerar outra (ele só gera quando ref vem vazia).
    --     modelo_id NULL (setado abaixo). v1 e v2 compartilham a REF; `versao` distingue.
    insert into public.produtos_importados (
      tenant_id, modelo_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor, composicao,
      grade_proporcao, qtd_total, foto_url, data_pedido, data_prevista, data_entrega,
      moeda_compra, moeda_intermediaria, valor_unitario_m1, cotacao_ref, peso_kg, transporte_m2,
      desconto_pct, cotacao_final, markup_atacado, markup_varejo,
      categoria_tecido_id, material_aviamento_id  -- [i3 v1] a replica leva a Categoria do tecido / Material do aviamento
    ) values (
      _tenant, null, o.nome, o.ref, o.grupo_id, o.categoria_id, o.subcategoria1_id, o.subcategoria2_id,
      _destino_colecao_id, v_sub_nome, o.semana, o.empresa_id, o.representante_id, o.ref_fornecedor, o.composicao,
      o.grade_proporcao, o.qtd_total, o.foto_url, o.data_pedido, o.data_prevista, o.data_entrega,
      o.moeda_compra, o.moeda_intermediaria, o.valor_unitario_m1, o.cotacao_ref, o.peso_kg, o.transporte_m2,
      o.desconto_pct, o.cotacao_final, o.markup_atacado, o.markup_varejo,
      o.categoria_tecido_id, o.material_aviamento_id  -- [i3 v1]
    ) returning id into v_novo_produto;

    -- (2) Variantes + etapas.
    insert into public.produto_importado_variantes (tenant_id, produto_importado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
      select _tenant, v_novo_produto, ordem, cor_id, cor_apelido_id, peso, qtd
      from public.produto_importado_variantes where produto_importado_id = o.id;
    insert into public.produto_importado_etapas (tenant_id, produto_importado_id, ordem, rotulo, base, percentual, data_vencimento, cotacao)
      select _tenant, v_novo_produto, ordem, rotulo, base, percentual, data_vencimento, cotacao
      from public.produto_importado_etapas where produto_importado_id = o.id;

    -- (3) Espelho modelos VERSIONADO (origem='importado'). REF copiada direto (fluxo de revenda/
    --     importado passa por fora do ref_auto — a REF do produto já foi gerada acima).
    insert into public.modelos (
      tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, ref, linha_id, modelo_base_id, versao, tamanho_tipo
    )
    select _tenant, o.nome, 'importado', o.categoria_id, o.subcategoria1_id, o.subcategoria2_id,
           _destino_colecao_id, v_sub_nome, o.semana, pi.ref, null, v_root, v_versao,
           coalesce(om.tamanho_tipo, 'letra')  -- [tamanho-em v1] a réplica leva o "Tamanho em" do card de origem
    from public.produtos_importados pi where pi.id = v_novo_produto
    returning id into v_novo_modelo;

    update public.produtos_importados set modelo_id = v_novo_modelo, updated_at = now() where id = v_novo_produto;

    -- modelo_grades por variante (mesma lógica de _criar_card_produto_importado_core).
    for rec in select ordem, qtd from public.produto_importado_variantes where produto_importado_id = v_novo_produto loop
      v_grade := public._pa_grade_variante(o.grupo_id, o.grade_proporcao, rec.qtd);
      select coalesce(sum((value)::numeric), 0) into v_total from jsonb_each_text(v_grade);
      insert into public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
      values (v_novo_modelo, rec.ordem, v_grade, v_total::int);
    end loop;

    perform public._imp_recomputar_precos_modelo(v_novo_produto);

    v_out := v_out || jsonb_build_object('origem_produto_id', o.id, 'novo_produto_id', v_novo_produto, 'novo_modelo_id', v_novo_modelo);
  end loop;

  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION public._limpar_produto_acabado_core(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_modelo_id uuid;
  v_oc_id uuid; v_oc_numero text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select modelo_id into v_modelo_id from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant;
  if not found then raise exception 'Produto não encontrado.' using errcode = 'P0002'; end if;
  -- Só rascunho (sem card no Planejamento).
  if v_modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento — não pode ser limpo.' using errcode = 'P0001';
  end if;
  -- Guarda de OC: zerar qtd/variantes/valor com pedido ativo dessincronizaria a OC.
  select id, numero into v_oc_id, v_oc_numero
    from public.ocs_p_acabado where produto_acabado_id = _produto_id and tenant_id = v_tenant limit 1;
  if v_oc_id is not null then
    raise exception 'Desvincule a OC % antes de limpar.', coalesce(v_oc_numero, 'sem número') using errcode = 'P0001';
  end if;

  -- Zera os campos editáveis; PRESERVA id/colecao_id/subcolecao/ref/mix_id/modelo_id(null).
  update public.produtos_acabados set
    nome = '',
    grupo_id = null, categoria_id = null, subcategoria1_id = null, subcategoria2_id = null,
    semana = null, empresa_id = null, representante_id = null,
    ref_fornecedor = null, composicao = null,
    grade_proporcao = '{}'::jsonb, qtd_total = 0, valor_unitario = 0, desconto_pct = 0,
    insumos_total = 0, markup_atacado = null, markup_varejo = null,
    tamanho_tipo = null,  -- [tamanho-em v1]
    categoria_tecido_id = null, material_aviamento_id = null,  -- [i3 v1] (ruling do controlador)
    updated_at = now()
  where id = _produto_id and tenant_id = v_tenant;

  delete from public.produto_acabado_variantes where produto_acabado_id = _produto_id;
end $function$;

CREATE OR REPLACE FUNCTION public._limpar_produto_importado_core(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_modelo_id uuid;
  v_oc_id uuid; v_oc_numero text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select modelo_id into v_modelo_id from public.produtos_importados where id = _produto_id and tenant_id = v_tenant;
  if not found then raise exception 'Produto não encontrado.' using errcode = 'P0002'; end if;
  if v_modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento — não pode ser limpo.' using errcode = 'P0001';
  end if;
  select id, numero into v_oc_id, v_oc_numero
    from public.ocs_importado where produto_importado_id = _produto_id and tenant_id = v_tenant limit 1;
  if v_oc_id is not null then
    raise exception 'Desvincule a OC % antes de limpar.', coalesce(v_oc_numero, 'sem número') using errcode = 'P0001';
  end if;

  -- Zera escalares + câmbio; PRESERVA id/colecao_id/subcolecao/ref/mix_id/modelo_id(null).
  -- moeda_compra/intermediaria voltam ao DEFAULT do emptyDraft (RMB/USD) — mantém o banco COERENTE
  -- com o reset do front (que parte de emptyDraft) e respeita o NOT NULL de moeda_compra.
  update public.produtos_importados set
    nome = '',
    grupo_id = null, categoria_id = null, subcategoria1_id = null, subcategoria2_id = null,
    semana = null, empresa_id = null, representante_id = null,
    ref_fornecedor = null, composicao = null, foto_url = null,
    data_pedido = null, data_prevista = null, data_entrega = null,
    grade_proporcao = '{}'::jsonb, qtd_total = 0,
    moeda_compra = 'RMB', moeda_intermediaria = 'USD',
    valor_unitario_m1 = 0, cotacao_ref = 0, peso_kg = 0, transporte_m2 = 0,
    desconto_pct = 0, cotacao_final = 0, markup_atacado = null, markup_varejo = null,
    tamanho_tipo = null,  -- [tamanho-em v1]
    categoria_tecido_id = null, material_aviamento_id = null,  -- [i3 v1] (ruling do controlador)
    updated_at = now()
  where id = _produto_id and tenant_id = v_tenant;

  delete from public.produto_importado_variantes where produto_importado_id = _produto_id;
  delete from public.produto_importado_etapas where produto_importado_id = _produto_id;
end $function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)', '9299a1d71336c2126435dec903de4952'),
      ('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)', 'f28985c19fe5efa4f08011137e20f51f'),
      ('public._replicar_produtos_acabados_core(uuid,uuid,uuid,uuid[])', '9fcdf99eb192cd938809dd159fc6d446'),
      ('public._replicar_produtos_importados_core(uuid,uuid,uuid,uuid[])', 'a2bd975c6a8c8b65e37b057911845639'),
      ('public._limpar_produto_acabado_core(uuid)', '153ebd8d87b1050479e73d9c93a826f1'),
      ('public._limpar_produto_importado_core(uuid)', '466d486e4e7503a0cf437713372f2d22'),
      ('public.fn_produto_cat_material_tenant()', 'b868561c6e3f04574589e6ad49b03fb4')
    ) AS x(f, md5) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'i3a: pos-condicao falhou em % (md5 %)', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)'),
      ('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'),
      ('public._replicar_produtos_acabados_core(uuid,uuid,uuid,uuid[])'),
      ('public._replicar_produtos_importados_core(uuid,uuid,uuid,uuid[])'),
      ('public._limpar_produto_acabado_core(uuid)'),
      ('public._limpar_produto_importado_core(uuid)'),
      ('public.fn_produto_cat_material_tenant()')
    ) AS x(f) LOOP
    IF has_function_privilege('anon', r.f, 'EXECUTE') OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM aclexplode(coalesce((SELECT p.proacl FROM pg_proc p WHERE p.oid = to_regprocedure(r.f)),
                    acldefault('f', (SELECT p.proowner FROM pg_proc p WHERE p.oid = to_regprocedure(r.f))))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'i3a: % executavel por PUBLIC/anon/authenticated (inv. 9)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('trg_pa_cat_material_tenant', 'public.produtos_acabados', 'CREATE TRIGGER trg_pa_cat_material_tenant BEFORE INSERT OR UPDATE OF categoria_tecido_id, material_aviamento_id ON public.produtos_acabados FOR EACH ROW EXECUTE FUNCTION fn_produto_cat_material_tenant()'),
      ('trg_pi_cat_material_tenant', 'public.produtos_importados', 'CREATE TRIGGER trg_pi_cat_material_tenant BEFORE INSERT OR UPDATE OF categoria_tecido_id, material_aviamento_id ON public.produtos_importados FOR EACH ROW EXECUTE FUNCTION fn_produto_cat_material_tenant()')
    ) AS x(g, t, d) LOOP
    IF (SELECT pg_get_triggerdef(tg.oid) FROM pg_trigger tg WHERE tg.tgrelid = r.t::regclass AND tg.tgname = r.g AND tg.tgenabled = 'O')
       IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 'i3a: pos-condicao falhou no gatilho %', r.g USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.produtos_acabados', 'categoria_tecido_id', 'public.categorias_tecido'),
      ('public.produtos_acabados', 'material_aviamento_id', 'public.materiais_aviamento'),
      ('public.produtos_importados', 'categoria_tecido_id', 'public.categorias_tecido'),
      ('public.produtos_importados', 'material_aviamento_id', 'public.materiais_aviamento')
    ) AS x(t, col, ref) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
                    WHERE k.contype = 'f' AND k.conrelid = r.t::regclass AND k.confrelid = r.ref::regclass AND a.attname = r.col
                      AND cardinality(k.conkey) = 1 AND k.confdeltype = 'a' AND k.confupdtype = 'a') THEN
      RAISE EXCEPTION 'i3a: pos-condicao falhou na FK %.%', r.t, r.col USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_class i WHERE i.relkind = 'i' AND i.relnamespace = 'public'::regnamespace
        AND i.relname IN ('idx_pa_categoria_tecido', 'idx_pa_material_aviamento', 'idx_pi_categoria_tecido', 'idx_pi_material_aviamento')) <> 4 THEN
    RAISE EXCEPTION 'i3a: pos-condicao falhou nos indices' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
