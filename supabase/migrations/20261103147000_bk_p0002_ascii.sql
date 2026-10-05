-- Backend B3 — mensagens "nao encontrado" (RAISE ... P0002) em ASCII (desenho item 20; P-259 = A). GERADO por .superpowers/sdd/2026-10-05-backend/mig/gerar-bk3.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-05-backend/plan.md (§9 B3, §0 K4, §13; Rulings R1); camada/plan.md ruling R2 (feito no worktree camada).
-- O que muda (troca de texto EXATA sobre o texto vivo; nada mais nas 11 funcoes): so a MENSAGEM do unico RAISE ... P0002 de
--   cada uma passa de PT acentuado para ASCII 'nao_encontrado: <entidade>' (oc | produto | modelo | config_loja | lote_kanban).
--   Por que: o PostgREST devolve P0002 como HTTP 500; com acento o 500 vira text/plain 'Something went wrong' e a tela perde o
--   code. Em ASCII o corpo e JSON com code P0002 e a tela traduz pelo prefixo (src/lib/erro-mensagem.ts, mensagemBackend).
--   Codigo (P0002), condicao, ordem e todo o resto das funcoes ficam iguais; as outras mensagens (P0001/42501, 4xx) nao mudam.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._excluir_oc_importado_core(uuid)  [DEFINER; nao_encontrado: oc]
--     ANTES  7f5fdd3ca5f9e0441d1813cb3e10d530
--     DEPOIS 32a0d890811febf0583095fc034728a1
--   public._excluir_oc_p_acabado_core(uuid)  [DEFINER; nao_encontrado: oc]
--     ANTES  d3be2ff0fccd81dfcbb21c15daddecb9
--     DEPOIS af404dd6ad84e6d72e2c64dd728f4607
--   public._excluir_oc_tecido_core(uuid)  [DEFINER; nao_encontrado: oc]
--     ANTES  55a43c818a329cf0cd3c26954a00ba64
--     DEPOIS 24753dee2de67ae71f28c7dd0c0d96ac
--   public._excluir_produto_acabado_core(uuid)  [DEFINER; nao_encontrado: produto]
--     ANTES  6d247b831f5bbfcee7404278922431de
--     DEPOIS 64d5b3688d2708ba929286c709f2a7d4
--   public._limpar_produto_acabado_core(uuid)  [DEFINER; nao_encontrado: produto]
--     ANTES  153ebd8d87b1050479e73d9c93a826f1
--     DEPOIS 4325fa5241b42a504a19f0072b0177f6
--   public._limpar_produto_importado_core(uuid)  [DEFINER; nao_encontrado: produto]
--     ANTES  466d486e4e7503a0cf437713372f2d22
--     DEPOIS c54c77644a44619354d8c09f3f546a0f
--   public.voltar_modelo_desenvolvimento(uuid)  [INVOKER; nao_encontrado: modelo]
--     ANTES  a4818dafcdb30ae78e9cb2e1f84feb59
--     DEPOIS 1c032fe33f9ca7b6c8433e27700c4f3a
--   public.kanban_mover(uuid,text)  [DEFINER; nao_encontrado: modelo]
--     ANTES  bc7b322df66b3e4f7ea48f5f0fd8660f
--     DEPOIS 3359a79f9aa0594c2906d2fcc0341d88
--   public.kanban_definir_automatico(boolean)  [DEFINER; nao_encontrado: config_loja]
--     ANTES  82c5b721b8b99611d4bf0cd7ad3be832
--     DEPOIS 9435ef32a9f505543160f34240ca4c2e
--   public.kanban_previa_restauracao(uuid)  [DEFINER; nao_encontrado: lote_kanban]
--     ANTES  8753259bb06e4a0dff467c1685bb2d2c
--     DEPOIS 9cae5150dfd33da8c46fab2548c4cc84
--   public.kanban_restaurar(uuid)  [DEFINER; nao_encontrado: lote_kanban]
--     ANTES  51897aad19562bf1d62e4aa8cdacd196
--     DEPOIS 9e4bcc887057838849a2eb72fc173df1
-- ====================================================================================
-- Trava: so catalogo (CREATE OR REPLACE FUNCTION de 11 funcoes): nenhuma tabela, nada de auth/storage/realtime.
-- Sem DROP, sem CREATE/DROP TRIGGER/POLICY, sem NOTIFY (assinaturas iguais). Idempotente (a guarda aceita antes OU depois).
-- Volta: supabase/rollback/20261103147000_bk_p0002_ascii_down.sql (LIFO: depois do inverso da B5 148000 e antes do da F2.1 145000;
-- e ANTES de qualquer inverso antigo que guarde estas funcoes por md5 - ver md5-bk3.txt: 20261030100000_down (limpar_produto_*),
-- Mod T1 20261103100000_down (voltar_modelo_desenvolvimento)).
-- 55P03/40P01 = nada mudou; rodar o arquivo de novo.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._excluir_oc_importado_core(uuid)', '7f5fdd3ca5f9e0441d1813cb3e10d530', '32a0d890811febf0583095fc034728a1'),
      ('public._excluir_oc_p_acabado_core(uuid)', 'd3be2ff0fccd81dfcbb21c15daddecb9', 'af404dd6ad84e6d72e2c64dd728f4607'),
      ('public._excluir_oc_tecido_core(uuid)', '55a43c818a329cf0cd3c26954a00ba64', '24753dee2de67ae71f28c7dd0c0d96ac'),
      ('public._excluir_produto_acabado_core(uuid)', '6d247b831f5bbfcee7404278922431de', '64d5b3688d2708ba929286c709f2a7d4'),
      ('public._limpar_produto_acabado_core(uuid)', '153ebd8d87b1050479e73d9c93a826f1', '4325fa5241b42a504a19f0072b0177f6'),
      ('public._limpar_produto_importado_core(uuid)', '466d486e4e7503a0cf437713372f2d22', 'c54c77644a44619354d8c09f3f546a0f'),
      ('public.voltar_modelo_desenvolvimento(uuid)', 'a4818dafcdb30ae78e9cb2e1f84feb59', '1c032fe33f9ca7b6c8433e27700c4f3a'),
      ('public.kanban_mover(uuid,text)', 'bc7b322df66b3e4f7ea48f5f0fd8660f', '3359a79f9aa0594c2906d2fcc0341d88'),
      ('public.kanban_definir_automatico(boolean)', '82c5b721b8b99611d4bf0cd7ad3be832', '9435ef32a9f505543160f34240ca4c2e'),
      ('public.kanban_previa_restauracao(uuid)', '8753259bb06e4a0dff467c1685bb2d2c', '9cae5150dfd33da8c46fab2548c4cc84'),
      ('public.kanban_restaurar(uuid)', '51897aad19562bf1d62e4aa8cdacd196', '9e4bcc887057838849a2eb72fc173df1')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'bk3_p0002_ascii: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._excluir_oc_importado_core(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select status into v_status from public.ocs_importado where id = _oc_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'nao_encontrado: oc' using errcode = 'P0002';
  end if;

  if v_status = 'recebido' then
    raise exception 'Não é possível excluir: OC já recebida (materializou CAD/CQ). Estorne o recebimento antes.'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.parcelas where oc_importado_id = _oc_id and status = 'pago') then
    raise exception 'Não é possível excluir: a OC tem parcela paga no financeiro.' using errcode = 'P0001';
  end if;

  -- Parcelas NÃO pagas somem via ON DELETE CASCADE (oc_importado_id); a paga já foi
  -- barrada acima. Etapas somem via ON DELETE CASCADE (ocs_importado_etapas.oc_importado_id).
  delete from public.ocs_importado where id = _oc_id and tenant_id = v_tenant;
end $function$;

CREATE OR REPLACE FUNCTION public._excluir_oc_p_acabado_core(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select status into v_status from public.ocs_p_acabado where id = _oc_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'nao_encontrado: oc' using errcode = 'P0002';
  end if;

  if v_status = 'recebido' then
    raise exception 'Não é possível excluir: OC já recebida (materializou CAD/CQ). Estorne o recebimento antes.'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.parcelas where oc_p_acabado_id = _oc_id and status = 'pago') then
    raise exception 'Não é possível excluir: a OC tem parcela paga no financeiro.' using errcode = 'P0001';
  end if;

  -- Parcelas NÃO pagas somem via ON DELETE CASCADE (oc_p_acabado_id, Task 3); a parcela
  -- paga já foi barrada acima, então nenhum DELETE explícito é necessário aqui.
  delete from public.ocs_p_acabado where id = _oc_id and tenant_id = v_tenant;
end;
$function$;

CREATE OR REPLACE FUNCTION public._excluir_oc_tecido_core(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_status text;
  v_is_rolo boolean;
BEGIN
  SELECT status, coalesce(is_rolo, false) INTO v_status, v_is_rolo
  FROM public.ocs_tecido WHERE id = _oc_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrado: oc' USING ERRCODE = 'P0002';
  END IF;

  -- 0) rolo tem fluxo próprio (excluir_rolo, com _rolo_em_uso) — não excluir por aqui
  IF v_is_rolo THEN
    RAISE EXCEPTION 'Isto é um rolo — exclua pela tela de Rolos.' USING ERRCODE = 'P0001';
  END IF;

  -- 1) OC recebida = tem estoque no ledger (físico só conta itens 'recebido' — ver M3 no cabeçalho)
  IF v_status = 'recebido' THEN
    RAISE EXCEPTION 'Não é possível excluir: OC já recebida (tem estoque). Estorne o recebimento antes.' USING ERRCODE = 'P0001';
  END IF;

  -- 2) baixa de estoque registrada (por item OU por rolo derivado desta OC)
  IF EXISTS (SELECT 1 FROM public.estoque_tecido_baixas b JOIN public.ocs_tecido_itens it ON it.id = b.oc_tecido_item_id WHERE it.oc_tecido_id = _oc_id)
     OR EXISTS (SELECT 1 FROM public.estoque_tecido_baixas b WHERE b.rolo_id = _oc_id) THEN
    RAISE EXCEPTION 'Não é possível excluir: a OC tem baixa de estoque registrada.' USING ERRCODE = 'P0001';
  END IF;

  -- 3) vínculo de Desenvolvimento (modelo_tecido_oc_links)
  IF EXISTS (SELECT 1 FROM public.modelo_tecido_oc_links l JOIN public.ocs_tecido_itens it ON it.id = l.oc_tecido_item_id WHERE it.oc_tecido_id = _oc_id) THEN
    RAISE EXCEPTION 'Não é possível excluir: a OC está vinculada a modelo(s) no Desenvolvimento. Desvincule antes.' USING ERRCODE = 'P0001';
  END IF;

  -- 4) rolo(s) derivado(s) desta OC
  IF EXISTS (SELECT 1 FROM public.ocs_tecido r JOIN public.ocs_tecido_itens it ON it.id = r.rolo_origem_item_id WHERE it.oc_tecido_id = _oc_id) THEN
    RAISE EXCEPTION 'Não é possível excluir: a OC tem rolo(s) derivado(s). Exclua os rolos antes.' USING ERRCODE = 'P0001';
  END IF;

  -- 5) parcela paga no financeiro
  IF EXISTS (SELECT 1 FROM public.parcelas p WHERE p.oc_tecido_id = _oc_id AND p.status = 'pago') THEN
    RAISE EXCEPTION 'Não é possível excluir: a OC tem parcela paga no financeiro.' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.parcelas WHERE oc_tecido_id = _oc_id;
  DELETE FROM public.ocs_tecido WHERE id = _oc_id AND tenant_id = v_tenant;
END
$function$;

CREATE OR REPLACE FUNCTION public._excluir_produto_acabado_core(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_oc_id uuid;
  v_oc_numero text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  perform 1 from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'nao_encontrado: produto' using errcode = 'P0002';
  end if;

  select id, numero into v_oc_id, v_oc_numero
    from public.ocs_p_acabado
    where produto_acabado_id = _produto_id and tenant_id = v_tenant
    limit 1;
  if v_oc_id is not null then
    raise exception 'Desvincule a OC % antes de excluir.', coalesce(v_oc_numero, 'sem número')
      using errcode = 'P0001';
  end if;

  delete from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant;
end;
$function$;

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
  if not found then raise exception 'nao_encontrado: produto' using errcode = 'P0002'; end if;
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
  if not found then raise exception 'nao_encontrado: produto' using errcode = 'P0002'; end if;
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

CREATE OR REPLACE FUNCTION public.voltar_modelo_desenvolvimento(_modelo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_explosao_antes text;  -- [seg s1 M2]
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo criação não habilitado' using errcode = '42501';
  end if;
  PERFORM public._exige_modulos('entrada_saida');  -- [modularidade P5] Explosao = Criacao + Entrada e Saida
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_explosao.
  PERFORM public._seg_exige_pagina('producao_explosao');

  -- Verifica que o modelo pertence ao tenant do usuário (ou é super_admin).
  if not exists (
    select 1 from public.modelos
    where id = _modelo_id
      and (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
  ) then
    raise exception 'nao_encontrado: modelo' using errcode = 'P0002';
  end if;

  v_explosao_antes := current_setting('app.explosao_sistema', true);  -- [seg s1 M2] Voltar ao Desenvolvimento (Explosao)
  PERFORM set_config('app.explosao_sistema', 'on', true);
  update public.modelos
    set enviado_cad = false
  where id = _modelo_id;
  PERFORM set_config('app.explosao_sistema', coalesce(v_explosao_antes, ''), true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.kanban_mover(_modelo_id uuid, _para text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid;
  v_sis_ant  text := coalesce(current_setting('app.kanban_sistema', true), '');
  v_lote_ant text := coalesce(current_setting('app.kanban_lote', true), '');
  v_status   text;
  v_d        record;
  v_drop     jsonb;
  v_acao     text;
  v_novo     text;
  v_rev      integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_can_edit('criacao_desenvolvimento') THEN
    RAISE EXCEPTION 'Sem permissão para mover cards do Desenvolvimento.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;

  -- FOR NO KEY UPDATE (fix round final): serializa 2 movers do mesmo card sem barrar o FOR KEY SHARE
  -- dos INSERTs nas tabelas-filhas (FK → modelos) — o UPDATE abaixo não mexe na chave.
  SELECT m.status_desenvolvimento INTO v_status
    FROM public.modelos m
   WHERE m.id = _modelo_id AND m.tenant_id = v_tenant
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrado: modelo' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._kanban_ligado(v_tenant) THEN
    RAISE EXCEPTION 'O Kanban automático está desligado nesta loja.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_d FROM public._kanban_derivar_lote(v_tenant, ARRAY[_modelo_id]) LIMIT 1;
  v_drop := public._kanban_destino_drop_puro(v_d.fluxo, v_d.reqs, v_d.exc, v_d.cond, v_d.status_atual, v_d.elegivel, _para);
  v_acao := v_drop ->> 'acao';
  v_novo := v_drop ->> 'status';

  IF v_acao IN ('fixar', 'soltar', 'nada') THEN
    PERFORM set_config('app.kanban_sistema', 'manual', true);
    PERFORM set_config('app.kanban_lote', '', true);
    UPDATE public.modelos m
       SET status_desenvolvimento = CASE WHEN v_acao IN ('fixar', 'soltar') THEN v_novo ELSE m.status_desenvolvimento END,
           revisao_pendente = coalesce(m.revisao_pendente, '{}'::jsonb) - 'kanban'
     WHERE m.id = _modelo_id
       AND (   (v_acao IN ('fixar', 'soltar') AND m.status_desenvolvimento IS DISTINCT FROM v_novo)
            OR coalesce(m.revisao_pendente, '{}'::jsonb) ? 'kanban');
    PERFORM set_config('app.kanban_sistema', v_sis_ant, true);
    PERFORM set_config('app.kanban_lote', v_lote_ant, true);
  END IF;

  SELECT m.status_desenvolvimento, m.rev INTO v_status, v_rev FROM public.modelos m WHERE m.id = _modelo_id;
  RETURN jsonb_build_object(
    'acao', v_acao,
    'status', v_status,
    'faltando', coalesce(v_drop -> 'faltando', '[]'::jsonb),
    'rev', v_rev);
END;
$function$;

CREATE OR REPLACE FUNCTION public.kanban_definir_automatico(_ligar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    uuid;
  v_chave_ant text := coalesce(current_setting('app.kanban_chave', true), '');
  v_antes     boolean;
  v_depois    boolean;
  v_inicio    timestamptz := clock_timestamp();
  v_lote      uuid;
  v_snap      integer := 0;
  v_mov       integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode ligar ou desligar o Kanban automático.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;
  IF _ligar IS NULL THEN
    RAISE EXCEPTION 'Informe se o Kanban automático deve ser ligado ou desligado.' USING ERRCODE = 'P0001';
  END IF;

  SELECT tc.kanban_automatico INTO v_antes
    FROM public.tenant_config tc
   WHERE tc.tenant_id = v_tenant
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrado: config_loja' USING ERRCODE = 'P0002';
  END IF;

  IF v_antes IS DISTINCT FROM _ligar THEN
    PERFORM set_config('app.kanban_chave', 'rpc', true);
    UPDATE public.tenant_config SET kanban_automatico = _ligar WHERE tenant_id = v_tenant;
    PERFORM set_config('app.kanban_chave', v_chave_ant, true);
  END IF;

  SELECT tc.kanban_automatico INTO v_depois FROM public.tenant_config tc WHERE tc.tenant_id = v_tenant;

  IF _ligar AND v_antes IS DISTINCT FROM _ligar THEN
    SELECT s.lote_id, count(*)::integer INTO v_lote, v_snap
      FROM public.kanban_snapshot s
     WHERE s.tenant_id = v_tenant AND s.motivo = 'ligar' AND s.criado_at >= v_inicio
     GROUP BY s.lote_id
     ORDER BY max(s.criado_at) DESC
     LIMIT 1;
    IF v_lote IS NOT NULL THEN
      SELECT count(DISTINCT h.modelo_id)::integer INTO v_mov
        FROM public.modelo_kanban_historico h
       WHERE h.tenant_id = v_tenant AND h.lote_id = v_lote AND h.origem = 'config';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ligado', v_depois,
    'mudou', v_antes IS DISTINCT FROM v_depois,
    'lote_id', v_lote,
    'snapshot', coalesce(v_snap, 0),
    'cards_movidos', coalesce(v_mov, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.kanban_previa_restauracao(_lote_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid;
  v_lote     uuid;
  v_motivo   text;
  v_criado   timestamptz;
  v_restaur  timestamptz;
  v_ligada   boolean;
  v_lancados integer;
  v_superados integer := 0;
  v_out      jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode restaurar as colunas do Kanban.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;

  v_lote := coalesce(_lote_id, (
    SELECT s.lote_id FROM public.kanban_snapshot s
     WHERE s.tenant_id = v_tenant AND s.motivo = 'ligar' AND s.restaurado_at IS NULL
     ORDER BY s.criado_at DESC, s.lote_id DESC LIMIT 1));
  v_ligada := public._kanban_ligado(v_tenant);
  IF v_lote IS NULL THEN
    RETURN jsonb_build_object('lote_id', NULL, 'chave_ligada', v_ligada, 'total', 0, 'voltam', 0,
      'movidos_depois', 0, 'lotes_superados', 0, 'cards', '[]'::jsonb,
      'avisos', jsonb_build_array('Não há colunas guardadas para restaurar.'));
  END IF;

  SELECT min(s.motivo), min(s.criado_at), max(s.restaurado_at) INTO v_motivo, v_criado, v_restaur
    FROM public.kanban_snapshot s
   WHERE s.lote_id = v_lote AND s.tenant_id = v_tenant;
  IF v_criado IS NULL THEN
    RAISE EXCEPTION 'nao_encontrado: lote_kanban' USING ERRCODE = 'P0002';
  END IF;

  -- Rodada 2 (F): lotes MAIS NOVOS (criado_at, lote_id) não restaurados da loja — restaurar este os
  -- SUPERA (mesma regra de kanban_restaurar). Lote já restaurado: 0 (o restaurar recusa antes).
  IF v_restaur IS NULL THEN
    SELECT count(DISTINCT s.lote_id) INTO v_superados
      FROM public.kanban_snapshot s
     WHERE s.tenant_id = v_tenant
       AND s.restaurado_at IS NULL
       AND s.lote_id <> v_lote
       AND (s.criado_at, s.lote_id) > (v_criado, v_lote);
  END IF;

  SELECT count(*) INTO v_lancados
    FROM public.kanban_snapshot s
    JOIN public.modelos m ON m.id = s.modelo_id AND m.tenant_id = v_tenant
   WHERE s.lote_id = v_lote AND coalesce(m.lancado, false);

  WITH s AS (
    SELECT s.modelo_id, s.status_anterior, m.nome, coalesce(nullif(m.ref, ''), m.ref_auto) AS ref_exib,
           m.status_desenvolvimento AS status_atual,
           EXISTS (SELECT 1 FROM public.modelo_kanban_historico h
                    WHERE h.modelo_id = s.modelo_id AND h.origem = 'manual' AND h.created_at > v_criado) AS manual_depois
      FROM public.kanban_snapshot s
      JOIN public.modelos m ON m.id = s.modelo_id AND m.tenant_id = v_tenant
     WHERE s.lote_id = v_lote
       AND NOT coalesce(m.lancado, false)
  )
  SELECT jsonb_build_object(
    'lote_id', v_lote, 'motivo', v_motivo, 'criado_at', v_criado, 'restaurado_at', v_restaur,
    'chave_ligada', v_ligada, 'lotes_superados', v_superados,
    'total', (SELECT count(*) FROM s),
    'voltam', (SELECT count(*) FROM s WHERE s.status_atual IS DISTINCT FROM s.status_anterior),
    'movidos_depois', (SELECT count(*) FROM s WHERE s.manual_depois AND s.status_atual IS DISTINCT FROM s.status_anterior),
    'cards', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'modelo_id', s.modelo_id, 'nome', s.nome, 'ref', s.ref_exib,
               'de', s.status_atual, 'para', s.status_anterior, 'movido_manual_depois', s.manual_depois)
             ORDER BY s.nome, s.modelo_id)
        FROM s WHERE s.status_atual IS DISTINCT FROM s.status_anterior), '[]'::jsonb),
    'avisos', to_jsonb(array_remove(ARRAY[
      'A REF revelada e o #Erro não voltam.',
      CASE WHEN v_ligada THEN 'Desligue o Kanban automático antes de restaurar (senão o próximo salvamento refaz as colunas).' END,
      CASE WHEN v_restaur IS NOT NULL THEN 'Este lote já foi restaurado.' END,
      CASE WHEN v_superados > 0 THEN v_superados || ' ajuste(s) de configuração feitos depois de ligar serão desfeitos junto.' END,
      CASE WHEN v_lancados > 0 THEN v_lancados || ' card(s) lançado(s) depois não voltam.' END
    ], NULL)))
  INTO v_out;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kanban_restaurar(_lote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid;
  v_sis_ant  text := coalesce(current_setting('app.kanban_sistema', true), '');
  v_lote_ant text := coalesce(current_setting('app.kanban_lote', true), '');
  v_criado   timestamptz;
  v_restaur  timestamptz;
  v_hist     integer := 0;
  v_n        integer := 0;
  v_superados integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode restaurar as colunas do Kanban.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.tenant_config WHERE tenant_id = v_tenant FOR UPDATE;
  PERFORM 1 FROM public.kanban_snapshot WHERE lote_id = _lote_id AND tenant_id = v_tenant FOR UPDATE;

  IF public._kanban_ligado(v_tenant) THEN
    RAISE EXCEPTION 'Desligue o Kanban automático antes de restaurar as colunas.' USING ERRCODE = 'P0001';
  END IF;

  SELECT min(s.criado_at), max(s.restaurado_at) INTO v_criado, v_restaur
    FROM public.kanban_snapshot s
   WHERE s.lote_id = _lote_id AND s.tenant_id = v_tenant;
  IF v_criado IS NULL THEN
    RAISE EXCEPTION 'nao_encontrado: lote_kanban' USING ERRCODE = 'P0002';
  END IF;
  IF v_restaur IS NOT NULL THEN
    RAISE EXCEPTION 'Este lote já foi restaurado.' USING ERRCODE = 'P0001';
  END IF;
  -- Rodada 2 (F): restaurar L SUPERA os lotes MAIS NOVOS não restaurados da loja (ex.: o lote
  -- 'config' de um ajuste de configuração feito com a chave ligada) — ficam marcados como restaurados.
  -- Ordem = (criado_at, lote_id): criado_at é clock_timestamp() (fn_kanban_config) e lote_id só
  -- desempata o caso teórico de criado_at igual. Estável sob a trava de tenant_config acima: lote novo
  -- só nasce num UPDATE de tenant_config (trg_kanban_config), que ela serializa. Fica ANTES da trava dos
  -- modelos p/ manter a ordem tenant_config → snapshot → modelos.
  WITH sup AS (
    UPDATE public.kanban_snapshot s
       SET restaurado_at = now()
     WHERE s.tenant_id = v_tenant
       AND s.restaurado_at IS NULL
       AND s.lote_id <> _lote_id
       AND (s.criado_at, s.lote_id) > (v_criado, _lote_id)
    RETURNING s.lote_id
  )
  SELECT count(DISTINCT sup.lote_id) INTO v_superados FROM sup;

  -- Fix round final: trava os modelos do lote ANTES do DELETE (ordem de travas tenant_config →
  -- snapshot → modelos; ORDER BY p/ ordem fixa) — um "lançar" concorrente entre o DELETE e o UPDATE
  -- deixaria o histórico apagado com o status não restaurado (os 2 filtram NOT lancado).
  PERFORM 1
     FROM public.modelos m
     JOIN public.kanban_snapshot s ON s.modelo_id = m.id
    WHERE s.lote_id = _lote_id AND m.tenant_id = v_tenant
    ORDER BY m.id
      FOR NO KEY UPDATE OF m;

  PERFORM set_config('app.kanban_sistema', 'restauracao', true);
  PERFORM set_config('app.kanban_lote', _lote_id::text, true);

  DELETE FROM public.modelo_kanban_historico h
   USING public.kanban_snapshot s
   JOIN public.modelos m ON m.id = s.modelo_id AND m.tenant_id = v_tenant
   WHERE s.lote_id = _lote_id
     AND h.modelo_id = s.modelo_id
     AND h.tenant_id = v_tenant
     AND h.origem IN ('auto', 'config')
     AND h.created_at >= v_criado
     AND NOT coalesce(m.lancado, false);
  GET DIAGNOSTICS v_hist = ROW_COUNT;

  UPDATE public.modelos m
     SET status_desenvolvimento = s.status_anterior
    FROM public.kanban_snapshot s
   WHERE s.lote_id = _lote_id
     AND m.id = s.modelo_id
     AND m.tenant_id = v_tenant
     AND m.status_desenvolvimento IS DISTINCT FROM s.status_anterior
     AND NOT coalesce(m.lancado, false);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.kanban_snapshot SET restaurado_at = now()
   WHERE lote_id = _lote_id AND tenant_id = v_tenant;

  PERFORM set_config('app.kanban_sistema', v_sis_ant, true);
  PERFORM set_config('app.kanban_lote', v_lote_ant, true);
  RETURN jsonb_build_object('lote_id', _lote_id, 'restaurados', v_n, 'historico_apagado', v_hist,
                            'lotes_superados', v_superados);
END;
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._excluir_oc_importado_core(uuid)', '32a0d890811febf0583095fc034728a1', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public', false),
      ('public._excluir_oc_p_acabado_core(uuid)', 'af404dd6ad84e6d72e2c64dd728f4607', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public', false),
      ('public._excluir_oc_tecido_core(uuid)', '24753dee2de67ae71f28c7dd0c0d96ac', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public', false),
      ('public._excluir_produto_acabado_core(uuid)', '64d5b3688d2708ba929286c709f2a7d4', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public', false),
      ('public._limpar_produto_acabado_core(uuid)', '4325fa5241b42a504a19f0072b0177f6', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public', false),
      ('public._limpar_produto_importado_core(uuid)', 'c54c77644a44619354d8c09f3f546a0f', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public', false),
      ('public.voltar_modelo_desenvolvimento(uuid)', '1c032fe33f9ca7b6c8433e27700c4f3a', '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}', false, 'search_path=public', true),
      ('public.kanban_mover(uuid,text)', '3359a79f9aa0594c2906d2fcc0341d88', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true, 'search_path=public', true),
      ('public.kanban_definir_automatico(boolean)', '9435ef32a9f505543160f34240ca4c2e', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true, 'search_path=public', true),
      ('public.kanban_previa_restauracao(uuid)', '9cae5150dfd33da8c46fab2548c4cc84', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true, 'search_path=public', true),
      ('public.kanban_restaurar(uuid)', '9e4bcc887057838849a2eb72fc173df1', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true, 'search_path=public', true)
    ) AS x(f, m, acl, sd, cfg, auth) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'bk3_p0002_ascii: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef = r.sd AND coalesce(array_to_string(p.proconfig, '|'), '') = r.cfg)
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM r.auth
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'bk3_p0002_ascii: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
