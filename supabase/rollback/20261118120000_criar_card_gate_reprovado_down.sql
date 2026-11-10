-- INVERSO da Task 3 (20261118120000_criar_card_gate_reprovado.sql): devolve os 2 `_criar_card_produto_*_core` ao texto EXATO de antes
-- (sem o gate produto_reprovado_sem_card).
--   public._criar_card_produto_acabado_core(uuid)
--     ANTES  dcbfa5bd2d3cee921d46a9335b3f468c  (= Task 3; reaplicar o down quando ja esta no texto de antes = no-op)
--     DEPOIS 0241f96d9261bbaab4de9ebd34941831
--   public._criar_card_produto_importado_core(uuid)
--     ANTES  33b39eab715ac168af5e678e0a051e60  (= Task 3)
--     DEPOIS cf5ec1d5aa8841580190d0bd3608ab4a
--   Qualquer outro texto -> P0001 e nada muda.
-- ORDEM (LIFO): SITE da paridade primeiro; depois ESTE down; depois os downs da Task 2 e da Task 1 (eles RECUSAM enquanto o gate estiver vivo).
-- Dados: nenhum (so funcoes). Produtos reprovados que ficaram sem card passam a poder virar card de novo.
-- Travas: so catalogo. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL statement_timeout = '15s';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public._criar_card_produto_acabado_core(uuid)') IS NULL OR to_regprocedure('public._criar_card_produto_importado_core(uuid)') IS NULL THEN
    RAISE EXCEPTION 'criar_card_gate_reprovado_down: _criar_card_produto_*_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._criar_card_produto_acabado_core(uuid)')));
  IF v_md5 NOT IN ('dcbfa5bd2d3cee921d46a9335b3f468c', '0241f96d9261bbaab4de9ebd34941831') THEN
    RAISE EXCEPTION 'criar_card_gate_reprovado_down: _criar_card_produto_acabado_core mudou desde a Task 3 (md5 %) - outra frente mexeu; conferir antes de reverter', v_md5
      USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._criar_card_produto_importado_core(uuid)')));
  IF v_md5 NOT IN ('33b39eab715ac168af5e678e0a051e60', 'cf5ec1d5aa8841580190d0bd3608ab4a') THEN
    RAISE EXCEPTION 'criar_card_gate_reprovado_down: _criar_card_produto_importado_core mudou desde a Task 3 (md5 %) - outra frente mexeu; conferir antes de reverter', v_md5
      USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

CREATE OR REPLACE FUNCTION public._criar_card_produto_acabado_core(_produto_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  p record;
  v_modelo_id uuid;
  v_grade jsonb;
  v_total numeric;
  rec record;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  -- FOR UPDATE: trava a linha até o fim da função — duplo-clique/chamada concorrente
  -- bloqueia na 2ª chamada até a 1ª terminar (INSERT do modelo + UPDATE modelo_id),
  -- daí vê modelo_id já preenchido e cai no RAISE de idempotência normalmente, em vez
  -- de correr e criar 2 espelhos.
  select * into p from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Produto não encontrado';
  end if;
  if p.modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento' using errcode = 'P0001';
  end if;

  -- Espelho: tenant_id explícito (não confiar no set_tenant_id_trg — o INSERT roda dentro
  -- de uma função SECURITY DEFINER, então basta o valor já resolvido em v_tenant acima).
  -- ref copiada DIRETO do produto: revenda não passa pelo fluxo aprovar/ref_auto do modelo.
  -- mix_id HERDA a família definida no produto (rascunho ou materializado) — #4b.
  insert into public.modelos (
    tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
    colecao_id, subcolecao, semana, ref, linha_id, mix_id
  ) values (
    v_tenant, p.nome, 'revenda', p.categoria_id, p.subcategoria1_id, p.subcategoria2_id,
    p.colecao_id, p.subcolecao, p.semana, p.ref, null, p.mix_id
  ) returning id into v_modelo_id;

  update public.produtos_acabados set modelo_id = v_modelo_id, updated_at = now() where id = _produto_id;

  for rec in select ordem, qtd from public.produto_acabado_variantes where produto_acabado_id = _produto_id loop
    v_grade := public._pa_grade_variante(p.grupo_id, p.grade_proporcao, rec.qtd);
    select coalesce(sum((value)::numeric), 0) into v_total from jsonb_each_text(v_grade);
    insert into public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
    values (v_modelo_id, rec.ordem, v_grade, v_total::int);
  end loop;

  perform public._pa_recomputar_precos_modelo(_produto_id);

  return v_modelo_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._criar_card_produto_importado_core(_produto_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  p record;
  v_modelo_id uuid;
  v_grade jsonb;
  v_total numeric;
  rec record;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select * into p from public.produtos_importados where id = _produto_id and tenant_id = v_tenant for update;
  if not found then raise exception 'Produto não encontrado'; end if;
  if p.modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento' using errcode = 'P0001';
  end if;

  -- mix_id HERDA a família definida no produto (rascunho ou materializado) — #4b.
  insert into public.modelos (
    tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
    colecao_id, subcolecao, semana, ref, linha_id, mix_id
  ) values (
    v_tenant, p.nome, 'importado', p.categoria_id, p.subcategoria1_id, p.subcategoria2_id,
    p.colecao_id, p.subcolecao, p.semana, p.ref, null, p.mix_id
  ) returning id into v_modelo_id;

  update public.produtos_importados set modelo_id = v_modelo_id, updated_at = now() where id = _produto_id;

  for rec in select ordem, qtd from public.produto_importado_variantes where produto_importado_id = _produto_id loop
    v_grade := public._pa_grade_variante(p.grupo_id, p.grade_proporcao, rec.qtd);
    select coalesce(sum((value)::numeric), 0) into v_total from jsonb_each_text(v_grade);
    insert into public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
    values (v_modelo_id, rec.ordem, v_grade, v_total::int);
  end loop;

  perform public._imp_recomputar_precos_modelo(_produto_id);
  return v_modelo_id;
end $function$
;

REVOKE EXECUTE ON FUNCTION public._criar_card_produto_acabado_core(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._criar_card_produto_importado_core(uuid) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._criar_card_produto_acabado_core(uuid)')));
  IF v_md5 <> '0241f96d9261bbaab4de9ebd34941831' THEN
    RAISE EXCEPTION 'criar_card_gate_reprovado_down: pos-condicao - acabado md5 vivo % <> esperado 0241f96d9261bbaab4de9ebd34941831', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._criar_card_produto_importado_core(uuid)')));
  IF v_md5 <> 'cf5ec1d5aa8841580190d0bd3608ab4a' THEN
    RAISE EXCEPTION 'criar_card_gate_reprovado_down: pos-condicao - importado md5 vivo % <> esperado cf5ec1d5aa8841580190d0bd3608ab4a', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('public', to_regprocedure('public._criar_card_produto_acabado_core(uuid)'), 'EXECUTE') OR has_function_privilege('anon', to_regprocedure('public._criar_card_produto_acabado_core(uuid)'), 'EXECUTE')
     OR has_function_privilege('authenticated', to_regprocedure('public._criar_card_produto_acabado_core(uuid)'), 'EXECUTE')
     OR has_function_privilege('public', to_regprocedure('public._criar_card_produto_importado_core(uuid)'), 'EXECUTE') OR has_function_privilege('anon', to_regprocedure('public._criar_card_produto_importado_core(uuid)'), 'EXECUTE')
     OR has_function_privilege('authenticated', to_regprocedure('public._criar_card_produto_importado_core(uuid)'), 'EXECUTE') THEN
    RAISE EXCEPTION 'criar_card_gate_reprovado_down: pos-condicao - _core com EXECUTE para PUBLIC/anon/authenticated (inv. #9)' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;
