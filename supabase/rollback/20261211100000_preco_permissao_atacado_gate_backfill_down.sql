-- Inverso de 20261211100000_preco_permissao_atacado_gate_backfill: devolve fn_modelo_preco_venda_gate SEM o ramo de atacado
-- (= corpo da S1, 20261031120000, md5 e89be53c25f421724994e78b756a027d, copiado do vivo ANTES da ida - byte a byte).
-- O backfill NAO reverte (conceder acesso nao quebra); as linhas da chave nova preco_atacado e o ver das chaves de preco ficam (inocuos sem o ramo). Dado nao volta sozinho.
-- Tambem devolve set_user_permissions e salvar_papel SEM a trava de delegacao (texto de antes, efd74993.../73310c9e...) e DROPA os helpers
-- _pode_editar_preco/_pode_ver_preco/_exige_delegacao_preco. O backfill de admins NAO reverte (conceder nao quebra).
-- (antes dizia:) DROPA o helper _pode_editar_preco(text) (so o gatilho e as 3 RPCs do comprado o usam): rode ANTES o _down de 20261211110000 (a guarda recusa se
-- alguma RPC ainda o referencia).
-- Guarda: aceita a funcao no texto desta frente (6fc5d4955a3f3d378072e82bfcf9051d), na versao intermediaria (2da90981f4d754de3e0a2c5e2c85a994) ou ja no da S1 (idempotente); qualquer outro = outra frente mexeu.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';

DO $guarda$
DECLARE v text; r record;
BEGIN
  v := md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure));
  IF v NOT IN ('6fc5d4955a3f3d378072e82bfcf9051d', '2da90981f4d754de3e0a2c5e2c85a994', 'e89be53c25f421724994e78b756a027d') THEN
    RAISE EXCEPTION 'preco_atacado_gate_down: fn_modelo_preco_venda_gate com texto inesperado (md5 %) - outra frente mexeu', coalesce(v,'ausente')
      USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.set_user_permissions(uuid,uuid,jsonb)', 'efd749935e402b939ad6304d15035933,bbe576b4b2d91858095ba12ed49a4913'),
      ('public.salvar_papel(uuid,uuid,text,text,jsonb)', '73310c9e097cf92eae827d19bf7b63a0,ede0d4ad42c0f8f772207aae18e4b670')
    ) AS t(fn, ok) LOOP
    IF md5(pg_get_functiondef(r.fn::regprocedure)) <> ALL (string_to_array(r.ok, ',')) THEN
      RAISE EXCEPTION 'preco_atacado_gate_down: % com texto inesperado - outra frente mexeu', r.fn USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND (p.prosrc LIKE '%_pode_editar_preco%' OR p.prosrc LIKE '%_pode_ver_preco%' OR p.prosrc LIKE '%_exige_delegacao_preco%')
                AND p.proname NOT IN ('fn_modelo_preco_venda_gate', '_pode_editar_preco', '_pode_ver_preco', '_exige_delegacao_preco',
                                      'set_user_permissions', 'salvar_papel')) THEN
    RAISE EXCEPTION 'preco_atacado_gate_down: ainda ha RPC usando _pode_editar_preco - rode antes o _down de 20261211110000' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

CREATE OR REPLACE FUNCTION public.fn_modelo_preco_venda_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- [seg s1] sem JWT (migration/psql) e service_role = manutencao do sistema: as regras NOVAS abaixo nao mordem.
  v_sistema boolean := auth.uid() IS NULL AND coalesce(auth.role(), '') NOT IN ('authenticated', 'anon');
BEGIN
  -- Só morde para origem INTERNA (o preço de revenda/importado é derivado no servidor — o recompute
  -- definer muda `preco_venda` mas roda com o JWT de quem RECEBE a OC / salva markups, que não tem
  -- esta section). Origem comprada nunca é editável por cliente no card/Sheet (front já bloqueia).
  IF NEW.preco_venda IS DISTINCT FROM OLD.preco_venda
     AND COALESCE(NEW.origem, 'interno') NOT IN ('revenda', 'importado')
     AND NOT public.user_can_edit('criacao_planejamento:preco_venda') THEN
    RAISE EXCEPTION 'Sem permissão para editar o preço de venda'
      USING ERRCODE = '42501';
  END IF;
  -- [seg s1 B1b] comprado (revenda/importado): o preco de venda e DERIVADO (markup x custo, ou o preco fixo do produto) - so
  -- muda pelo recalculo do servidor (_pa_/_imp_recomputar_precos_modelo ligam app.preco_comprado_sistema). PATCH direto = 42501.
  IF NEW.preco_venda IS DISTINCT FROM OLD.preco_venda
     AND COALESCE(NEW.origem, 'interno') IN ('revenda', 'importado')
     AND coalesce(current_setting('app.preco_comprado_sistema', true), '') <> 'on'
     AND NOT v_sistema THEN
    RAISE EXCEPTION 'preco_comprado_derivado: o preco de venda do comprado vem do markup ou do preco fixo do produto'
      USING ERRCODE = '42501';
  END IF;
  -- [seg s1 S5] Preco anterior (vai ao ERP) = a MESMA secao do preco de venda (criacao_planejamento:preco_venda), qualquer
  -- origem (a tela ja omite o campo sem a secao). Escrita feita DENTRO de outro gatilho (pg_trigger_depth > 1 - ex.: o
  -- congelamento ao excluir uma versao, fn_modelo_versao_congelar_aplicar) e do sistema; nao e do cliente.
  IF NEW.preco_anterior IS DISTINCT FROM OLD.preco_anterior
     AND pg_trigger_depth() <= 1
     AND NOT v_sistema
     AND NOT public.user_can_edit('criacao_planejamento:preco_venda') THEN
    RAISE EXCEPTION 'preco_anterior_sem_permissao: sem permissao para editar o preco anterior' USING ERRCODE = '42501';
  END IF;
  -- [seg s1 M2] Enviado a Explosao (enviado_cad) so muda pelas RPCs do sistema (Enviar a Explosao, Voltar ao
  -- Desenvolvimento, excluir CAD), que ligam app.explosao_sistema='on'. PATCH direto pulava o gate de etapa (ou desfazia a
  -- Explosao). ASCII (tela: erro-mensagem.ts).
  IF NEW.enviado_cad IS DISTINCT FROM OLD.enviado_cad
     AND coalesce(current_setting('app.explosao_sistema', true), '') <> 'on'
     AND NOT v_sistema THEN
    RAISE EXCEPTION 'explosao_protegida: o envio a Explosao so muda pelos botoes Enviar a Explosao / Voltar ao Desenvolvimento'
      USING ERRCODE = '42501';
  END IF;
  -- [seg s1 M2] Ordem de Criacao nao e cancelada (true -> false) com o card ja na Explosao (a tela ja recusa: Fix m1).
  IF OLD.ordem_criacao_enviada IS TRUE AND NEW.ordem_criacao_enviada IS NOT TRUE
     AND (coalesce(OLD.enviado_cad, false) OR coalesce(NEW.enviado_cad, false))
     AND coalesce(current_setting('app.explosao_sistema', true), '') <> 'on'
     AND NOT v_sistema THEN
    RAISE EXCEPTION 'ordem_com_explosao: o card ja foi enviado a Explosao - a Ordem de Criacao nao pode ser cancelada'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $function$;

-- set_user_permissions / salvar_papel: corpo de ANTES (sem a chamada de _exige_delegacao_preco)
CREATE OR REPLACE FUNCTION public.set_user_permissions(_user_id uuid, _tenant_id uuid, _perms jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_papel uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  -- Authz: super_admin escolhe a loja (_tenant_id); tenant_admin só a própria.
  IF public.is_super_admin() THEN
    v_tenant := _tenant_id;
  ELSIF public.is_tenant_admin() THEN
    v_tenant := public.get_user_tenant_id();
  ELSE
    RAISE EXCEPTION 'Sem permissão para gerenciar permissões';
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Loja não informada'; END IF;

  -- Alvo tem que ser da loja resolvida.
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = _user_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Usuário não pertence à loja';
  END IF;

  SELECT papel_id INTO v_papel FROM public.users WHERE id = _user_id;

  -- Substitui atomicamente as exceções do usuário. DELETE e INSERT são statements SEPARADOS
  -- (mesma txn) — NÃO um CTE `WITH _del AS (DELETE…) INSERT…`: nesse formato o snapshot do
  -- comando não garante que o DELETE seja visível ao INSERT, colidindo com o índice único
  -- (user_id,pagina) quando a linha já existia. (Bug pego no teste txn; o set original também
  -- usava 2 statements.)
  DELETE FROM public.user_permissions WHERE user_id = _user_id;

  INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
  WITH incoming AS (
    SELECT p->>'pagina' AS pagina,
           COALESCE((p->>'pode_ver')::boolean, false) AS pode_ver,
           COALESCE((p->>'pode_editar')::boolean, false) AS pode_editar
    FROM jsonb_array_elements(COALESCE(_perms, '[]'::jsonb)) p
    WHERE NULLIF(p->>'pagina','') IS NOT NULL
      AND (COALESCE((p->>'pode_ver')::boolean, false) OR COALESCE((p->>'pode_editar')::boolean, false))
  ),
  -- Papel do usuário (base). Se não há papel, vazio → todo o incoming vira exceção (= comport. antigo).
  base AS (
    SELECT pp.pagina, pp.pode_ver, pp.pode_editar
    FROM public.papel_permissoes pp
    WHERE v_papel IS NOT NULL AND pp.papel_id = v_papel
  ),
  -- União das páginas tocadas nos dois lados. Uma página que o papel concede mas o cliente
  -- NÃO marcou precisa virar exceção NEGATIVA (linha com ver=false/editar=false) — senão o
  -- COALESCE de _perm_efetiva herdaria o papel de volta. Guardamos essas como linha explícita.
  keys AS (
    SELECT pagina FROM incoming UNION SELECT pagina FROM base
  ),
  resolved AS (
    SELECT k.pagina,
           COALESCE(i.pode_ver, false)    AS pode_ver,
           COALESCE(i.pode_editar, false) AS pode_editar,
           COALESCE(b.pode_ver, false)    AS base_ver,
           COALESCE(b.pode_editar, false) AS base_editar
    FROM keys k
    LEFT JOIN incoming i ON i.pagina = k.pagina
    LEFT JOIN base b     ON b.pagina = k.pagina
  ),
  -- Exceção = onde o desejado DIVERGE do papel. (Sem papel, base_* é false → tudo que é
  -- verdadeiro no cliente diverge, reproduzindo o insert-tudo antigo.)
  delta AS (
    SELECT pagina, pode_ver, pode_editar
    FROM resolved
    WHERE pode_ver IS DISTINCT FROM base_ver OR pode_editar IS DISTINCT FROM base_editar
  )
  SELECT _user_id, v_tenant, pagina, pode_ver, pode_editar FROM delta;
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_papel(_id uuid, _tenant_id uuid, _nome text, _descricao text, _perms jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_id uuid; v_nome text;
BEGIN
  v_tenant := public._papel_tenant_autorizado(_tenant_id);
  v_nome := nullif(btrim(_nome), '');
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Informe o nome do papel.' USING ERRCODE = 'P0001'; END IF;

  IF _id IS NULL THEN
    INSERT INTO public.papeis (tenant_id, nome, descricao)
    VALUES (v_tenant, v_nome, nullif(btrim(_descricao), ''))
    RETURNING id INTO v_id;
  ELSE
    -- Alvo tem que ser da loja resolvida (impede editar papel de outra loja).
    IF NOT EXISTS (SELECT 1 FROM public.papeis WHERE id = _id AND tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'Papel não encontrado nesta loja';
    END IF;
    UPDATE public.papeis
       SET nome = v_nome, descricao = nullif(btrim(_descricao), '')
     WHERE id = _id AND tenant_id = v_tenant;
    v_id := _id;
  END IF;

  -- Substitui as permissões do papel atomicamente (delete + insert), como set_user_permissions.
  DELETE FROM public.papel_permissoes WHERE papel_id = v_id;
  INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar)
  SELECT v_id, v_tenant, p->>'pagina',
         COALESCE((p->>'pode_ver')::boolean, false),
         COALESCE((p->>'pode_editar')::boolean, false)
  FROM jsonb_array_elements(COALESCE(_perms, '[]'::jsonb)) p
  WHERE NULLIF(p->>'pagina','') IS NOT NULL
    AND (COALESCE((p->>'pode_ver')::boolean, false) OR COALESCE((p->>'pode_editar')::boolean, false));

  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe um papel com este nome nesta loja.' USING ERRCODE = 'P0001';
END;
$function$;

-- O gatilho (S1) e as 2 funcoes acima ja nao usam os helpers: pode dropar (ordem: o que chama primeiro).
DROP FUNCTION IF EXISTS public._exige_delegacao_preco(jsonb, jsonb);
DROP FUNCTION IF EXISTS public._pode_ver_preco(text);
DROP FUNCTION IF EXISTS public._pode_editar_preco(text);

DO $pos$
DECLARE v text;
BEGIN
  v := md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure));
  IF to_regprocedure('public._pode_editar_preco(text)') IS NOT NULL OR to_regprocedure('public._pode_ver_preco(text)') IS NOT NULL
     OR to_regprocedure('public._exige_delegacao_preco(jsonb,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'preco_atacado_gate_down: pos-condicao falhou (helper de preco ainda existe)' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef('public.set_user_permissions(uuid,uuid,jsonb)'::regprocedure)) <> 'efd749935e402b939ad6304d15035933'
     OR md5(pg_get_functiondef('public.salvar_papel(uuid,uuid,text,text,jsonb)'::regprocedure)) <> '73310c9e097cf92eae827d19bf7b63a0' THEN
    RAISE EXCEPTION 'preco_atacado_gate_down: pos-condicao falhou (set_user_permissions/salvar_papel nao voltaram ao texto de antes)' USING ERRCODE = 'P0001';
  END IF;
  IF v IS DISTINCT FROM 'e89be53c25f421724994e78b756a027d' THEN
    RAISE EXCEPTION 'preco_atacado_gate_down: pos-condicao falhou (md5 %, esperado e89be53c25f421724994e78b756a027d)', coalesce(v,'ausente') USING ERRCODE = 'P0001';
  END IF;
END $pos$;
COMMIT;
