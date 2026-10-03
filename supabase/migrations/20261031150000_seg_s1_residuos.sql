-- Reforço de segurança — Release S1 ("Fechar portas sem travar nada"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§1, §2 S1, RESPOSTAS DO DONO).
-- OPT-1: tenant_module_enabled passa a tratar 'etapas_pl' como opt-in (chave ausente = desligado), como o front
-- (useTenantModules.DEFAULTS.etapas_pl=false). 0 leitores SQL hoje.
-- PI-r: _sync_foto_modelo_do_produto le/grava so o card da MESMA loja do produto (defesa em profundidade).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.tenant_module_enabled(text)
--     ANTES  843163ccc128c53753ed08d3e4041cb3
--     DEPOIS ddd46592f2ff7cdb352778c605ecd8a4
--   public._sync_foto_modelo_do_produto()
--     ANTES  c0892e7c9fed1d47b9256fc8fb61deaf
--     DEPOIS 59e8a2f84660aad1dc89fabaa3f30735
-- ====================================================================================
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION / REVOKE-GRANT EXECUTE / ALTER DEFAULT PRIVILEGES): nenhuma tabela de
-- negócio, nada de auth/storage. Sem DROP, sem CREATE TRIGGER/POLICY. Idempotente (guarda aceita antes OU depois).
-- Volta: supabase/rollback/20261031150000_seg_s1_residuos_down.sql (LIFO: os inversos da S1 rodam do mais novo ao mais antigo, ANTES dos inversos de releases
-- anteriores que guardam por md5 as mesmas funções — ver o relatório s1-report.md, seção "Cadeia md5").
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.tenant_module_enabled(text)', '843163ccc128c53753ed08d3e4041cb3', 'ddd46592f2ff7cdb352778c605ecd8a4'),
      ('public._sync_foto_modelo_do_produto()', 'c0892e7c9fed1d47b9256fc8fb61deaf', '59e8a2f84660aad1dc89fabaa3f30735')
    ) AS x(f, antes, depois) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 's1_res: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.tenant_module_enabled(_module text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- 'distribuicao' entrou em 20261006100000 (Distribuição por produto): servidor = front (chave ausente = desligado).
  -- ATENÇÃO: toda chave opt-in-default-OFF NOVA precisa entrar nesta lista — espelha
  -- `useTenantModules.DEFAULTS`/`admin/lojas.tsx MODULE_DEFAULTS` no front. Módulos "clássicos"
  -- (criacao, entrada_saida, producao, financeiro, cadastro, dashboard) ficam de fora de
  -- propósito: chave ausente = ON pra eles (loja sem tenant_config não perde os módulos-núcleo).
  SELECT public.is_super_admin() OR COALESCE(
    (SELECT (c.modules ->> _module) = 'true'
       FROM public.tenant_config c
      WHERE c.tenant_id = (SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid())),
    _module NOT IN ('otb', 'produto_acabado', 'produto_importado', 'distribuicao', 'etapas_pl')  -- [seg s1 OPT-1] etapas_pl
  );
$function$;

CREATE OR REPLACE FUNCTION public._sync_foto_modelo_do_produto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_atual text[];
  v_novo  text[];
begin
  -- Sem espelho ou sem foto: nada a fazer (foto NULL não apaga a do modelo).
  if NEW.modelo_id is null or coalesce(NEW.foto_url, '') = '' then
    return NEW;
  end if;
  -- [seg s1 PI-r] so o card da MESMA loja do produto (defesa em profundidade; trg_pi_modelo_tenant ja barra o vinculo)
  select fotos_modelo into v_atual from public.modelos where id = NEW.modelo_id and tenant_id = NEW.tenant_id;
  v_novo := public._foto_modelo_com_capa(v_atual, NEW.foto_url);
  -- Só escreve se mudou (evita UPDATE/bump à toa).
  if v_novo is distinct from coalesce(v_atual, '{}') then
    update public.modelos set fotos_modelo = v_novo where id = NEW.modelo_id and tenant_id = NEW.tenant_id;
  end if;
  return NEW;
end;
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.tenant_module_enabled(text)', 'ddd46592f2ff7cdb352778c605ecd8a4'),
      ('public._sync_foto_modelo_do_produto()', '59e8a2f84660aad1dc89fabaa3f30735')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 's1_res: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;
COMMIT;
