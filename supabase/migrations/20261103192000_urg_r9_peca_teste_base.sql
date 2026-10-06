-- Urgentes R9a - base da Peca Teste (exige_peca_teste, tentativas por linha de M.O., trava de fornecedor, fila e regressao do kanban). GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-c.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-c.md (Task 1 / R9a; Rulings 1-6, 10, 15, 29, 31) + spec-r9.md.
-- O que muda:
--   1) coluna NOVA public.categorias_terceirizado.exige_peca_teste boolean NOT NULL DEFAULT false (so catalogo). O Cadastro
--      grava direto (policy/GRANT de tabela existentes).
--   2) tabela NOVA public.modelo_peca_teste_tentativas (1 linha = 1 tentativa; trilha = linha de M.O. x tipo com o switch),
--      RLS ligada SEM policy + REVOKE ALL de PUBLIC/anon/authenticated (leitura/escrita so pelas RPCs da 193000); fora da
--      publicacao supabase_realtime (Ruling 10). FKs: modelo CASCADE, linha de M.O. SET NULL (Ruling 3), tipo RESTRICT
--      (Ruling 31), fornecedor e loja NO ACTION (Ruling 29). Gatilhos: rev (fn_colab_touch_rev), auditoria (fn_audit), loja do
--      fornecedor (enforce_empresa_tenant), fila do kanban automatico por comando (fn_kanban_fila_por_modelo) e regressao do
--      kanban manual (2a).
--   2a) funcao NOVA fn_peca_teste_regredir (DEFINER, REVOKE dos 3) + gatilho AFTER UPDATE OF aprovacao OR DELETE: tentativa
--      que deixa de estar 'aprovado' chama _kanban_regredir_modelo (sai sozinho com kanban automatico/revenda/lancado).
--   3) funcao NOVA fn_peca_teste_trava_fornecedor (DEFINER, REVOKE dos 3) + gatilho BEFORE UPDATE OF empresa_id em
--      modelo_servico_mo: tentativa ATUAL da trilha aprovada e tipo ainda exigindo -> P0001 'peca_teste_fornecedor_travado: ...'.
--   4) gatilho EXISTENTE trg_kanban_fila_upd de categorias_terceirizado redefinido: + exige_peca_teste no WHEN.
-- Nenhuma funcao existente muda; dependencias FIXADAS (md5 conferido na guarda): ver ACCEPTED-MD5. Nenhum dado gravado.
-- Guarda: exige a 20261103180000 (modelo_servico_mo.empresa_id) e as dependencias FIXADAS com o md5 de hoje; trg_kanban_fila_upd
-- em {ANTES, DEPOIS}; tabela nova ausente OU com a forma esperada; coluna nova ausente OU boolean NOT NULL default false;
-- funcoes novas ausentes OU com o md5 de DEPOIS OU com o NEUTRO do _down (ciclo ida -> _down -> ida).
-- Pos-condicao: coluna; tabela com colunas/defaults, constraints e indices do DDL (md5), RLS ligada, 0 policies, ACL
-- {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres} (nem anon nem authenticated), fora da publicacao supabase_realtime; os 9 gatilhos com o
-- pg_get_triggerdef gerado; as 2 funcoes DEFINER, search_path=public, ACL {postgres=X,service_role=X}; trg_kanban_fila_upd = DEPOIS.
-- Trava (MEDIDA na copia local, supautils carregado, diferenca de pg_locks numa txn REVERTIDA, DDL digitada): ~33 ms no total.
--   categorias_terceirizado: AccessExclusive (ADD COLUMN com DEFAULT constante = so catalogo; LEITURA do Cadastro de servicos e da
--     fila do kanban espera os ms) + ShareRowExclusive (CREATE OR REPLACE TRIGGER trg_kanban_fila_upd e a FK nova);
--   modelo_peca_teste_tentativas (nova) e os 5 indices dela: AccessExclusive (ninguem a usa ainda);
--   modelos, modelo_servico_mo, empresas, tenants: ShareRowExclusive (FKs novas + CREATE TRIGGER da trava) - ESCRITA nessas 4
--     tabelas espera os ms; LEITURA segue. NENHUMA trava em auth/storage/realtime (contagem 0: nenhuma policy criada).
--   Reaplicar a ida com tudo ja aplicado: AccessExclusive em categorias_terceirizado (o ADD COLUMN IF NOT EXISTS trava antes de
--     ver que existe) e ShareRowExclusive em modelo_servico_mo; nada em modelos/empresas/tenants nem em auth/storage/realtime.
-- HORARIO CALMO. lock_timeout 1500ms: 55P03 = nada mudou, rodar o arquivo de novo. Idempotente (2a vez = NOTICEs, mesmos md5).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_peca_teste_regredir() (NOVA)
--     ANTES  ausente
--     DEPOIS 9f8ff2ef6d9a31827798470dc73d392b
--     NEUTRO 9060f2c49f9ebfb7c5e76d393302fd7c (_down)
--   public.fn_peca_teste_trava_fornecedor() (NOVA)
--     ANTES  ausente
--     DEPOIS eda05ebed95f51f554afe210a5f28c89
--     NEUTRO 4b41dd70f4751bd076f6468f2c001c23 (_down)
--   gatilho trg_kanban_fila_upd ON public.categorias_terceirizado (md5 do pg_get_triggerdef)
--     ANTES  35a23318e5e44ce6af558686b275115e
--     DEPOIS da0bdd092856df54079eeb3b3dbab171
--   gatilho trg_colab_rev ON public.modelo_peca_teste_tentativas (NOVO)  DEPOIS fb2990d55e0ab7d2d7d5016c2db6267c
--   gatilho audit_modelo_peca_teste_tentativas ON public.modelo_peca_teste_tentativas (NOVO)  DEPOIS e9bd9ead4f5b4da3afd42be8a7949b16
--   gatilho trg_empresa_tenant ON public.modelo_peca_teste_tentativas (NOVO)  DEPOIS ea84155f0d24d817a41bfb65127cb888
--   gatilho trg_peca_teste_fila_ins ON public.modelo_peca_teste_tentativas (NOVO)  DEPOIS 8e14d2be9570c201b6a75cd301a50414
--   gatilho trg_peca_teste_fila_upd ON public.modelo_peca_teste_tentativas (NOVO)  DEPOIS dc8fe559e89f950f5b000840fcf7448f
--   gatilho trg_peca_teste_fila_del ON public.modelo_peca_teste_tentativas (NOVO)  DEPOIS feb9c988298b2d2b4febb46f03e7f311
--   gatilho trg_peca_teste_regredir ON public.modelo_peca_teste_tentativas (NOVO)  DEPOIS e11d48b36b01b420616c78df17b05c04
--   gatilho trg_peca_teste_trava_fornecedor ON public.modelo_servico_mo (NOVO)  DEPOIS 1a6977ae9829a7725c3c53ed2467dbfa
--   tabela public.modelo_peca_teste_tentativas (NOVA): colunas 2f8ac5920d24485af979ee9a988837c7  constraints dab2afbd30384894aa1d25706796f803  indices af347cb0afcf183520b9fb68aa727685
--   dependencias FIXADAS (nao redefinidas):
--     public.enforce_servico_mo_aprovacao() 1643b69db26e2034905866356b80232e
--     public._salvar_modelo_servico_mo_core(uuid,jsonb) 1a4c045651694a64c3a99de522b7be53
--     public.fn_kanban_fila_por_modelo() 83b837afaaab012d00afc37cea9b3572
--     public.fn_kanban_fila_categoria() d3c2830087a8e42e72c1fc5eb9d59944
--     public._kanban_regredir_modelo(uuid) 77298f6a39fbd9de8954db7b961d83c9
--     public.fn_colab_touch_rev() 292f1a1077df1e08fdca7f21eb0d856c
--     public.fn_audit() 63e5855f24d17914aef609e35ffc499b
--     public.enforce_empresa_tenant() 85c056ec2f65fb0bc3bdab8d6cd7d713
-- ====================================================================================
-- Volta (LIFO, banco DEPOIS do site): supabase/rollback/20261103192000_urg_r9_peca_teste_base_down.sql - DEPOIS dos _down da 196000..193000 e ANTES do 20261103191000_down
-- (urg R8b) e de tudo abaixo. NAO redefine funcao existente; a unica guarda antiga afetada e a de DEPENDENCIA: com a r9a
-- no banco, o inverso da kanban-auto migration 3 (20260930140000_down, DROP FUNCTION fn_kanban_fila_por_modelo/_categoria) e
-- o 20261103180000_down_drop (DROP COLUMN modelo_servico_mo.empresa_id, citada pelo gatilho de trava) FALHAM por dependencia
-- - rode antes supabase/rollback/20261103192000_urg_r9_peca_teste_base_down_drop.sql (opcional, horario calmo, site voltado; exige SET app.confirmo_apagar_peca_teste = 'sim').
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
  -- exige a 20261103180000 (urg R4a)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'modelo_servico_mo'
                   AND column_name = 'empresa_id' AND data_type = 'uuid') THEN
    RAISE EXCEPTION 'urg_r9a: exige a 20261103180000 (urg R4a) aplicada (modelo_servico_mo.empresa_id ausente)' USING ERRCODE = 'P0001';
  END IF;
  -- dependencias FIXADAS (nao redefinidas aqui): o texto de hoje
  FOR r IN SELECT * FROM (VALUES
      ('public.enforce_servico_mo_aprovacao()', '1643b69db26e2034905866356b80232e'),
      ('public._salvar_modelo_servico_mo_core(uuid,jsonb)', '1a4c045651694a64c3a99de522b7be53'),
      ('public.fn_kanban_fila_por_modelo()', '83b837afaaab012d00afc37cea9b3572'),
      ('public.fn_kanban_fila_categoria()', 'd3c2830087a8e42e72c1fc5eb9d59944'),
      ('public._kanban_regredir_modelo(uuid)', '77298f6a39fbd9de8954db7b961d83c9'),
      ('public.fn_colab_touch_rev()', '292f1a1077df1e08fdca7f21eb0d856c'),
      ('public.fn_audit()', '63e5855f24d17914aef609e35ffc499b'),
      ('public.enforce_empresa_tenant()', '85c056ec2f65fb0bc3bdab8d6cd7d713')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r9a: dependencia % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- gatilho redefinido: ANTES ou DEPOIS
  v := (SELECT md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t
       WHERE t.tgrelid = to_regclass('public.categorias_terceirizado') AND t.tgname = 'trg_kanban_fila_upd' AND NOT t.tgisinternal);
  IF v IS NULL OR v NOT IN ('35a23318e5e44ce6af558686b275115e', 'da0bdd092856df54079eeb3b3dbab171') THEN
    RAISE EXCEPTION 'urg_r9a: gatilho trg_kanban_fila_upd com texto inesperado (md5 %) - outra frente mexeu; gere de novo', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
  -- tabela nova: ausente OU com a forma esperada (colunas/tipos/nullability)
  IF to_regclass('public.modelo_peca_teste_tentativas') IS NOT NULL THEN
    SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY ordinal_position) INTO v
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'modelo_peca_teste_tentativas';
    IF v IS DISTINCT FROM 'id:uuid:NO,tenant_id:uuid:NO,modelo_id:uuid:NO,mo_linha_id:uuid:YES,categoria_terceirizado_id:uuid:NO,numero:integer:NO,empresa_id:uuid:YES,data_saida:date:YES,data_entrada:date:YES,aprovacao:text:YES,decidido_em:timestamp with time zone:YES,decidido_por:uuid:YES,origem:text:NO,legado_bloco_id:uuid:YES,rev:integer:NO,created_at:timestamp with time zone:NO,updated_at:timestamp with time zone:NO,created_by:uuid:YES' THEN
      RAISE EXCEPTION 'urg_r9a: public.modelo_peca_teste_tentativas existe com OUTRA forma (%) - PARE', v USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- coluna nova: ausente OU boolean NOT NULL default false
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'categorias_terceirizado'
                AND column_name = 'exige_peca_teste')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'categorias_terceirizado'
                AND column_name = 'exige_peca_teste' AND data_type = 'boolean' AND is_nullable = 'NO'
                AND column_default = 'false') THEN
    RAISE EXCEPTION 'urg_r9a: categorias_terceirizado.exige_peca_teste existe com outro tipo/default - PARE' USING ERRCODE = 'P0001';
  END IF;
  -- funcoes novas: ausentes, DEPOIS ou NEUTRO (_down)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_peca_teste_regredir()', '9f8ff2ef6d9a31827798470dc73d392b', '9060f2c49f9ebfb7c5e76d393302fd7c'),
      ('public.fn_peca_teste_trava_fornecedor()', 'eda05ebed95f51f554afe210a5f28c89', '4b41dd70f4751bd076f6468f2c001c23')
    ) AS x(f, d, n) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v NOT IN (r.d, r.n) THEN
      RAISE EXCEPTION 'urg_r9a: % (nova) com texto inesperado (md5 %) - gere de novo', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- 1) coluna
-- [urg r9a] coluna nova com DEFAULT constante (PG11+: so catalogo, sem reescrita). O Cadastro grava direto pela policy
-- existente de categorias_terceirizado (a coluna herda o GRANT de tabela do authenticated).
ALTER TABLE public.categorias_terceirizado ADD COLUMN IF NOT EXISTS exige_peca_teste boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.categorias_terceirizado.exige_peca_teste IS
  'R9: o tipo de servico exige peca teste - cada linha de M.O. com este tipo ganha uma trilha na secao Peca Teste do card.';

-- 2) tabela
-- [urg r9a] 1 linha = 1 tentativa. Trilha = (linha de M.O., tipo de servico da linha) com exige_peca_teste; tentativa atual = a
-- de maior numero da trilha se ela NAO for 'reprovado'; senao a atual e VIRTUAL (numero = max+1, sem linha ate ganhar dado).
CREATE TABLE IF NOT EXISTS public.modelo_peca_teste_tentativas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  modelo_id uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  mo_linha_id uuid REFERENCES public.modelo_servico_mo(id) ON DELETE SET NULL,          -- Ruling 3
  categoria_terceirizado_id uuid NOT NULL REFERENCES public.categorias_terceirizado(id) ON DELETE RESTRICT,  -- Ruling 31
  numero integer NOT NULL CHECK (numero >= 1),
  empresa_id uuid REFERENCES public.empresas(id),          -- fornecedor CONGELADO na decisao (historico); a atual usa o da linha
  data_saida date,
  data_entrada date,
  aprovacao text CHECK (aprovacao IN ('aprovado', 'reprovado')),
  decidido_em timestamptz,
  decidido_por uuid,
  origem text NOT NULL DEFAULT 'card' CHECK (origem IN ('card', 'legado')),
  legado_bloco_id uuid,                                    -- producao_terceirizados.id de origem (196000; idempotencia)
  rev integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT mpt_decisao_com_datas CHECK (aprovacao IS NULL OR (data_saida IS NOT NULL AND data_entrada IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS mpt_trilha_numero_ux ON public.modelo_peca_teste_tentativas
  (mo_linha_id, categoria_terceirizado_id, numero) WHERE mo_linha_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mpt_legado_ux ON public.modelo_peca_teste_tentativas (legado_bloco_id) WHERE legado_bloco_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mpt_modelo_idx ON public.modelo_peca_teste_tentativas (modelo_id);
CREATE INDEX IF NOT EXISTS mpt_tenant_idx ON public.modelo_peca_teste_tentativas (tenant_id);
ALTER TABLE public.modelo_peca_teste_tentativas ENABLE ROW LEVEL SECURITY;   -- SEM policy: leitura/escrita so pelas RPCs (193000)
REVOKE ALL ON TABLE public.modelo_peca_teste_tentativas FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.modelo_peca_teste_tentativas IS 'R9: tentativas de peca teste por linha de M.O.; escrita so por salvar_peca_teste.';

CREATE OR REPLACE TRIGGER trg_colab_rev BEFORE UPDATE ON public.modelo_peca_teste_tentativas
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_touch_rev();
CREATE OR REPLACE TRIGGER audit_modelo_peca_teste_tentativas AFTER INSERT OR UPDATE OR DELETE ON public.modelo_peca_teste_tentativas
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit();
CREATE OR REPLACE TRIGGER trg_empresa_tenant BEFORE INSERT OR UPDATE ON public.modelo_peca_teste_tentativas
  FOR EACH ROW EXECUTE FUNCTION public.enforce_empresa_tenant();
-- Fila do kanban automatico (fonte nova = enfileira). NOMES fora do padrao 'trg_kanban_fila_%' DE PROPOSITO: o teste do inverso
-- da kanban-auto migration 3 conta exatamente 44 gatilhos com esse prefixo.
CREATE OR REPLACE TRIGGER trg_peca_teste_fila_ins AFTER INSERT ON public.modelo_peca_teste_tentativas
  REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.fn_kanban_fila_por_modelo();
CREATE OR REPLACE TRIGGER trg_peca_teste_fila_upd AFTER UPDATE ON public.modelo_peca_teste_tentativas
  REFERENCING OLD TABLE AS antigas NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.fn_kanban_fila_por_modelo();
CREATE OR REPLACE TRIGGER trg_peca_teste_fila_del AFTER DELETE ON public.modelo_peca_teste_tentativas
  REFERENCING OLD TABLE AS antigas FOR EACH STATEMENT EXECUTE FUNCTION public.fn_kanban_fila_por_modelo();

-- 3) funcoes de gatilho NOVAS (texto canonico) + gatilhos
CREATE OR REPLACE FUNCTION public.fn_peca_teste_regredir()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9a] kanban MANUAL: peca teste que deixa de estar aprovada (desfeita/reprovada/apagada) pode tirar o card de onde esta
  -- (mesma regressao da M.O.: _kanban_regredir_modelo sai sozinho com kanban automatico ligado, origem != interno ou lancado).
  IF OLD.aprovacao = 'aprovado' AND (TG_OP = 'DELETE' OR NEW.aprovacao IS DISTINCT FROM OLD.aprovacao) THEN
    PERFORM public._kanban_regredir_modelo(OLD.modelo_id);
  END IF;
  RETURN NULL;
END $function$;
CREATE OR REPLACE TRIGGER trg_peca_teste_regredir AFTER UPDATE OF aprovacao OR DELETE ON public.modelo_peca_teste_tentativas
  FOR EACH ROW EXECUTE FUNCTION public.fn_peca_teste_regredir();

CREATE OR REPLACE FUNCTION public.fn_peca_teste_trava_fornecedor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9a] P-312/spec: peca aprovada trava o fornecedor da tentativa = o da linha de M.O. (vale p/ o Salvar da M.O. e da Peca Teste).
  -- So morde com o tipo ainda exigindo peca teste (switch desligado = trilha escondida, nada travado).
  IF EXISTS (SELECT 1 FROM public.categorias_terceirizado c WHERE c.id = OLD.categoria_terceirizado_id AND c.exige_peca_teste)
     AND (SELECT t.aprovacao FROM public.modelo_peca_teste_tentativas t
           WHERE t.mo_linha_id = OLD.id AND t.categoria_terceirizado_id = OLD.categoria_terceirizado_id
           ORDER BY t.numero DESC LIMIT 1) = 'aprovado' THEN
    RAISE EXCEPTION 'peca_teste_fornecedor_travado: peca teste aprovada trava o fornecedor' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE TRIGGER trg_peca_teste_trava_fornecedor BEFORE UPDATE OF empresa_id ON public.modelo_servico_mo
  FOR EACH ROW WHEN (OLD.empresa_id IS DISTINCT FROM NEW.empresa_id) EXECUTE FUNCTION public.fn_peca_teste_trava_fornecedor();

REVOKE EXECUTE ON FUNCTION public.fn_peca_teste_regredir(), public.fn_peca_teste_trava_fornecedor() FROM PUBLIC, anon, authenticated;

-- Gatilho existente redefinido (ANTES 35a23318): + exige_peca_teste no WHEN (mudar o switch enfileira a loja inteira, como etapa/nome/ativo).
CREATE OR REPLACE TRIGGER trg_kanban_fila_upd AFTER UPDATE ON public.categorias_terceirizado FOR EACH ROW WHEN (((old.etapa IS DISTINCT FROM new.etapa) OR ((old.nome)::text IS DISTINCT FROM (new.nome)::text) OR (old.ativo IS DISTINCT FROM new.ativo) OR (old.exige_peca_teste IS DISTINCT FROM new.exige_peca_teste))) EXECUTE FUNCTION public.fn_kanban_fila_categoria();

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  -- coluna
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'categorias_terceirizado'
                AND column_name = 'exige_peca_teste' AND data_type = 'boolean' AND is_nullable = 'NO'
                AND column_default = 'false') THEN
    RAISE EXCEPTION 'urg_r9a: pos-condicao falhou na coluna categorias_terceirizado.exige_peca_teste' USING ERRCODE = 'P0001';
  END IF;
  -- tabela: colunas+defaults, constraints e indices do DDL; RLS ligada, 0 policies, ACL exata, fora do Realtime
  SELECT md5(string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' ORDER BY ordinal_position))
    INTO v FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'modelo_peca_teste_tentativas';
  IF v IS DISTINCT FROM '2f8ac5920d24485af979ee9a988837c7' THEN
    RAISE EXCEPTION 'urg_r9a: pos-condicao falhou nas colunas de public.modelo_peca_teste_tentativas (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  SELECT md5(string_agg(k.conname || ' ' || pg_get_constraintdef(k.oid), E'\n' ORDER BY k.conname)) INTO v
    FROM pg_constraint k WHERE k.conrelid = to_regclass('public.modelo_peca_teste_tentativas');
  IF v IS DISTINCT FROM 'dab2afbd30384894aa1d25706796f803' THEN
    RAISE EXCEPTION 'urg_r9a: pos-condicao falhou nas constraints de public.modelo_peca_teste_tentativas (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  SELECT md5(string_agg(pg_get_indexdef(i.indexrelid), E'\n' ORDER BY i.indexrelid::regclass::text)) INTO v
    FROM pg_index i WHERE i.indrelid = to_regclass('public.modelo_peca_teste_tentativas') AND i.indisvalid;
  IF v IS DISTINCT FROM 'af347cb0afcf183520b9fb68aa727685' THEN
    RAISE EXCEPTION 'urg_r9a: pos-condicao falhou nos indices de public.modelo_peca_teste_tentativas (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.modelo_peca_teste_tentativas') AND c.relrowsecurity
                   AND coalesce(c.relacl::text, '') = '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}')
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass('public.modelo_peca_teste_tentativas'))
     OR has_table_privilege('anon', 'public.modelo_peca_teste_tentativas', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'public.modelo_peca_teste_tentativas', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'urg_r9a: pos-condicao falhou na RLS/ACL/policies de public.modelo_peca_teste_tentativas' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables pt WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public'
               AND pt.tablename = 'modelo_peca_teste_tentativas') THEN
    RAISE EXCEPTION 'urg_r9a: public.modelo_peca_teste_tentativas nao pode estar na publicacao supabase_realtime (Ruling 10)' USING ERRCODE = 'P0001';
  END IF;
  -- os 9 gatilhos (inclusive o redefinido) com o pg_get_triggerdef gerado, habilitados
  FOR r IN SELECT * FROM (VALUES
      ('public.modelo_peca_teste_tentativas', 'trg_colab_rev', 'fb2990d55e0ab7d2d7d5016c2db6267c'),
      ('public.modelo_peca_teste_tentativas', 'audit_modelo_peca_teste_tentativas', 'e9bd9ead4f5b4da3afd42be8a7949b16'),
      ('public.modelo_peca_teste_tentativas', 'trg_empresa_tenant', 'ea84155f0d24d817a41bfb65127cb888'),
      ('public.modelo_peca_teste_tentativas', 'trg_peca_teste_fila_ins', '8e14d2be9570c201b6a75cd301a50414'),
      ('public.modelo_peca_teste_tentativas', 'trg_peca_teste_fila_upd', 'dc8fe559e89f950f5b000840fcf7448f'),
      ('public.modelo_peca_teste_tentativas', 'trg_peca_teste_fila_del', 'feb9c988298b2d2b4febb46f03e7f311'),
      ('public.modelo_peca_teste_tentativas', 'trg_peca_teste_regredir', 'e11d48b36b01b420616c78df17b05c04'),
      ('public.modelo_servico_mo', 'trg_peca_teste_trava_fornecedor', '1a6977ae9829a7725c3c53ed2467dbfa'),
      ('public.categorias_terceirizado', 'trg_kanban_fila_upd', 'da0bdd092856df54079eeb3b3dbab171')
    ) AS x(t, n, m) LOOP
    SELECT md5(pg_get_triggerdef(t.oid)) INTO v FROM pg_trigger t
     WHERE t.tgrelid = to_regclass(r.t) AND t.tgname = r.n AND NOT t.tgisinternal AND t.tgenabled <> 'D';
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r9a: pos-condicao falhou no gatilho % de % (md5 %, esperado %)', r.n, r.t, coalesce(v, 'ausente'), r.m
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- funcoes novas: DEPOIS, DEFINER, search_path=public, ACL so postgres/service_role
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_peca_teste_regredir()', '9f8ff2ef6d9a31827798470dc73d392b', '9060f2c49f9ebfb7c5e76d393302fd7c'),
      ('public.fn_peca_teste_trava_fornecedor()', 'eda05ebed95f51f554afe210a5f28c89', '4b41dd70f4751bd076f6468f2c001c23')
    ) AS x(f, d, n) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 'urg_r9a: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.d USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}'
                     AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r9a: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
