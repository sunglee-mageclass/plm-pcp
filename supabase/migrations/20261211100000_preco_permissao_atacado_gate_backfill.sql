-- Permissao propria do preco de venda (varejo) e do preco de atacado, independente de custos.
-- (1) fn_modelo_preco_venda_gate ganha o ramo preco_atacado (simetrico ao varejo; GUC primeiro - nao morde o recompute derivado).
--     EXTENSAO CIRURGICA do gatilho existente (S1 / 20261031120000): o corpo e o vivo, byte a byte, com UM bloco inserido antes do
--     ramo "S5 preco anterior"; nenhuma outra regra mudou. O arquivo da S1 NAO e alterado.
-- (2) Backfill das 2 chaves de preco (user_permissions + papel_permissoes) - ninguem perde acesso. UMA chave por preco: Leitor
--     (pode_ver) = VER, Editor (pode_editar) = EDITAR (o editor de permissoes ja tem as 2 colunas; Editor inclui ver):
--       criacao_planejamento:preco_venda    (varejo)  - JA EXISTE como EDITAR; ganha pode_ver=true quem hoje ve preco (qualquer das 5
--                                           chaves de _pode_ver_custos). ON CONFLICT DO UPDATE: quem ja tinha a linha de editar GANHA o
--                                           ver SEM perder o pode_editar; quem nao tinha, a linha nasce (ver=true, editar=false).
--       criacao_planejamento:preco_atacado  (atacado) - NOVA: EDITAR (+ver) a quem hoje edita preco_venda OU criacao_produto_acabado;
--                                           VER a quem hoje ve preco (mesmo criterio do varejo).
-- VER (varejo/atacado) NAO e trancado no banco (D1 A): so a exibicao na tela respeita pode_ver das chaves de preco.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_modelo_preco_venda_gate()
--     ANTES  e89be53c25f421724994e78b756a027d   (= DEPOIS da S1, 20261031120000)
--     DEPOIS 6fc5d4955a3f3d378072e82bfcf9051d
--     (2da90981... = versao INTERMEDIA desta frente, antes do ajuste "admin nao fura o preco": so existiu na copia local/previa; a guarda a aceita p/ reaplicar)
-- ====================================================================================
-- Trava: so catalogo (CREATE OR REPLACE FUNCTION) + INSERTs em user_permissions/papel_permissoes (RowExclusive). Sem DDL de tabela,
-- sem DROP, sem CREATE TRIGGER/POLICY (nada em auth/storage). Idempotente (guarda aceita antes OU depois; EDITAR atacado ON CONFLICT DO NOTHING; VER ON CONFLICT DO UPDATE SET pode_ver=true).
-- Volta: supabase/rollback/20261211100000_preco_permissao_atacado_gate_backfill_down.sql (devolve o corpo da S1 e DROPA o helper _pode_editar_preco; o backfill FICA).
-- REGRA DO PRECO (decisao do dono 23/nov): tenant_admin/admin NAO furam o preco de venda/atacado (editar no banco = _pode_editar_preco; ver na tela =
--   ehPaginaSemBypassAdmin); so super_admin fura. Precisa da permissao concedida pelo super admin. user_can_edit/user_can_view genericos NAO mudam.
-- ATENCAO (efeito): o backfill so cobre quem JA tem linha de permissao; admin de loja sem linha perde ver/editar preco ate o super admin conceder.
-- Reaplicar a S1 (20261031120000) depois desta: a guarda da S1 so aceita antes 4eeb8baa... ou e89be53c... - rode o _down desta antes.
-- Aplicar fora de transacao de teste: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

-- Pre-condicao: a funcao e o "depois" da S1 (ou ja o desta frente, idempotencia); _perm_efetiva existe (fonte do helper novo)
DO $guarda$
DECLARE v text;
BEGIN
  IF to_regprocedure('public._perm_efetiva(uuid)') IS NULL THEN
    RAISE EXCEPTION 'preco_atacado_gate: _perm_efetiva(uuid) ausente - aplique 20260908230000 (papeis customizados) antes' USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure));
  IF v NOT IN ('e89be53c25f421724994e78b756a027d', '2da90981f4d754de3e0a2c5e2c85a994', '6fc5d4955a3f3d378072e82bfcf9051d') THEN
    RAISE EXCEPTION 'preco_atacado_gate: fn_modelo_preco_venda_gate com texto inesperado (md5 %) - outra frente mexeu; gere de novo', coalesce(v,'ausente')
      USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

-- (0) Helper NOVO _pode_editar_preco(chave): EDITAR preco SEM o furo de admin. super_admin passa; admin/tenant_admin NAO furam (so a
-- permissao explicita concedida pelo super admin, via _perm_efetiva = excecao do usuario senao papel). Mesmo padrao de _exportar_pode /
-- _integracao_pode. Interno: recebe a chave por parametro; EXECUTE revogado (so gatilho/RPCs DEFINER o chamam).
CREATE OR REPLACE FUNCTION public._pode_editar_preco(_chave text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public._perm_efetiva(auth.uid()) e
         WHERE e.pagina = _chave AND e.pode_editar = true
      );
$function$;
REVOKE EXECUTE ON FUNCTION public._pode_editar_preco(text) FROM PUBLIC, anon, authenticated;

-- (1) Gatilho: ramo NOVO de preco_atacado, simetrico ao varejo; varejo/atacado/preco_anterior por _pode_editar_preco (admin NAO fura)
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
     AND NOT public._pode_editar_preco('criacao_planejamento:preco_venda') THEN
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
  -- [preco permissao] EDITAR atacado: a GUC do recompute derivado vem PRIMEIRO (nao morde _pa_/_imp_recomputar_precos_modelo, que
  -- mudam preco_atacado com o JWT de quem recebe a OC / salva markups); v_sistema (migration/psql/service_role) passa; so o PATCH
  -- direto do cliente exige a chave criacao_planejamento:preco_atacado. ASCII (a tela traduz por codigo).
  IF NEW.preco_atacado IS DISTINCT FROM OLD.preco_atacado
     AND coalesce(current_setting('app.preco_comprado_sistema', true), '') <> 'on'
     AND NOT v_sistema
     AND NOT public._pode_editar_preco('criacao_planejamento:preco_atacado') THEN
    RAISE EXCEPTION 'Sem permissao para editar o preco de atacado'
      USING ERRCODE = '42501';
  END IF;
  -- [seg s1 S5] Preco anterior (vai ao ERP) = a MESMA secao do preco de venda (criacao_planejamento:preco_venda), qualquer
  -- origem (a tela ja omite o campo sem a secao). Escrita feita DENTRO de outro gatilho (pg_trigger_depth > 1 - ex.: o
  -- congelamento ao excluir uma versao, fn_modelo_versao_congelar_aplicar) e do sistema; nao e do cliente.
  IF NEW.preco_anterior IS DISTINCT FROM OLD.preco_anterior
     AND pg_trigger_depth() <= 1
     AND NOT v_sistema
     AND NOT public._pode_editar_preco('criacao_planejamento:preco_venda') THEN
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

-- (2) BACKFILL. ORDEM IMPORTA: primeiro EDITAR atacado (linha nova, DO NOTHING: nao desfaz o que a pessoa ajustou depois), depois
-- VER (DO UPDATE SET pode_ver=true: ganha o ver sem tocar em pode_editar; a linha de atacado criada acima NAO perde o editar).
-- EDITAR atacado -> a quem HOJE edita atacado (criacao_planejamento:preco_venda OU criacao_produto_acabado, pode_editar=true).
INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT DISTINCT up.user_id, up.tenant_id, 'criacao_planejamento:preco_atacado', true, true
FROM public.user_permissions up
WHERE up.pagina IN ('criacao_planejamento:preco_venda','criacao_produto_acabado')
  AND up.pode_editar = true
ON CONFLICT (user_id, pagina) DO NOTHING;

INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT DISTINCT pp.papel_id, pp.tenant_id, 'criacao_planejamento:preco_atacado', true, true
FROM public.papel_permissoes pp
WHERE pp.pagina IN ('criacao_planejamento:preco_venda','criacao_produto_acabado')
  AND pp.pode_editar = true
ON CONFLICT (papel_id, pagina) DO NOTHING;

-- VER varejo + VER atacado -> a quem HOJE ve preco (QUALQUER das 5 chaves de _pode_ver_custos com pode_ver=true).
-- criacao_planejamento:preco_venda JA EXISTE como linha de editar: DO UPDATE concede o ver preservando pode_editar (NUNCA DO NOTHING aqui).
INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT DISTINCT up.user_id, up.tenant_id, nova.k, true, false
FROM public.user_permissions up
CROSS JOIN (VALUES ('criacao_planejamento:preco_venda'), ('criacao_planejamento:preco_atacado')) AS nova(k)
WHERE up.pagina IN ('criacao_planejamento:custos','criacao_desenvolvimento:custos',
                    'producao_terceirizados:precos','dashboard_custos','dashboard_comercial')
  AND up.pode_ver = true
ON CONFLICT (user_id, pagina) DO UPDATE SET pode_ver = true;

INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT DISTINCT pp.papel_id, pp.tenant_id, nova.k, true, false
FROM public.papel_permissoes pp
CROSS JOIN (VALUES ('criacao_planejamento:preco_venda'), ('criacao_planejamento:preco_atacado')) AS nova(k)
WHERE pp.pagina IN ('criacao_planejamento:custos','criacao_desenvolvimento:custos',
                    'producao_terceirizados:precos','dashboard_custos','dashboard_comercial')
  AND pp.pode_ver = true
ON CONFLICT (papel_id, pagina) DO UPDATE SET pode_ver = true;

-- Pos-condicao: a funcao ficou no texto desta frente
DO $pos$
DECLARE v text;
BEGIN
  v := md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure));
  IF v IS DISTINCT FROM '6fc5d4955a3f3d378072e82bfcf9051d' THEN
    RAISE EXCEPTION 'preco_atacado_gate: pos-condicao falhou (md5 %, esperado 6fc5d4955a3f3d378072e82bfcf9051d)', coalesce(v,'ausente') USING ERRCODE = 'P0001';
  END IF;
END $pos$;
COMMIT;
