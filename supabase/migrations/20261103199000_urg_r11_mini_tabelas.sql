-- Urgentes R11a - tabelas da mini explosao da Peca Teste (cabecalho, linhas) e ledger novo de baixa de aviamento/insumo. GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-d.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-r11.md (Task 1 / R11a; Rulings 1-3, 12-14) + spec-r9.md (secao R11).
-- O que muda (3 tabelas NOVAS + 1 funcao NOVA de gatilho; nenhuma funcao existente muda; nenhum dado gravado):
--   1) public.modelo_peca_teste_mini - cabecalho da mini por tentativa (1:1; FK tentativa CASCADE, modelo CASCADE, variante do
--      tecido SET NULL, loja NO ACTION). Gatilhos: auditoria (fn_audit) e fila do kanban automatico por comando
--      (fn_kanban_fila_por_modelo, trg_peca_teste_mini_fila_{ins,upd,del}).
--   2) public.modelo_peca_teste_mini_linhas - ajustes (NULL = segue o calculado) + foto da baixa; UNIQUE (tentativa, chave);
--      FK mini CASCADE, variante de aviamento/item de OC SET NULL. Gatilho: auditoria.
--   3) public.estoque_peca_teste_baixas - ledger NOVO (so acrescimo) de aviamento/insumo; CHECKs de sinal x origem e de forma x
--      familia; FK tentativa SET NULL (a linha FICA quando o card some, Ruling 12), aviamento/variante/insumo/cor NO ACTION (item
--      com baixa nao se apaga: 23503). Gatilhos: auditoria e fn_estoque_peca_teste_imutavel (NOVA, DEFINER, REVOKE dos 3):
--      UPDATE so de tentativa_id -> NULL; DELETE so com SET app.confirmo_apagar_baixas_peca_teste = 'sim'.
--   As 3: RLS ligada SEM policy + REVOKE ALL de PUBLIC/anon/authenticated (so as RPCs DEFINER da 199300/199400 leem/escrevem);
--   fora da publicacao supabase_realtime. Toda tabela tem tenant_id (o _wipe_tenant_core apaga por loja, dinamico).
-- Guarda: exige a 20261103192000 (urg R9a) (public.modelo_peca_teste_tentativas) e as dependencias FIXADAS com o md5 de hoje; cada tabela nova ausente OU com a forma
-- esperada (colunas/tipos/nullability); a funcao nova ausente OU com o md5 de DEPOIS OU com o NEUTRO do _down (ciclo ida -> _down
-- -> ida). Pos-condicao: cada tabela com colunas/defaults, constraints e indices do DDL (md5), RLS ligada, 0 policies, ACL
-- {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres} (nem anon nem authenticated), fora da publicacao supabase_realtime; os 7 gatilhos com o
-- pg_get_triggerdef gerado e habilitados; a funcao DEFINER, search_path=public, ACL {postgres=X,service_role=X}.
-- Trava (MEDIDA na copia local, supautils carregado, diferenca de pg_locks numa txn REVERTIDA, DDL digitada): ~52 ms no total.
--   CREATE TABLE com FK = ShareRowExclusive nas 9 referenciadas (tenants, modelos, modelo_peca_teste_tentativas, variantes_tecido,
--     variantes_aviamento, ocs_tecido_itens, aviamentos, etiquetas, cores): ESCRITA nelas espera os ms; LEITURA segue. As 3 tabelas
--     novas e os 8 indices = AccessExclusive (ninguem as usa ainda). NENHUMA trava em auth/storage/realtime (contagem 0).
--   Reaplicar a ida com tudo ja aplicado (~31 ms): SO as 3 tabelas NOVAS (ENABLE RLS/COMMENT/CREATE OR REPLACE TRIGGER); nada
--     nas referenciadas (CREATE TABLE/INDEX IF NOT EXISTS sao pulados).
-- HORARIO CALMO. lock_timeout 1500ms. 55P03 OU 40P01 = NADA mudou: rodar o arquivo de novo (um Salvar no mesmo instante pode
--   falhar 1x). Idempotente (2a vez = NOTICEs, mesmos md5).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_estoque_peca_teste_imutavel() (NOVA)
--     ANTES  ausente
--     DEPOIS 93911c1c230f910f74c93d3f917e9694
--     NEUTRO 2ccebd01b91760521b76d04f299f97d2 (_down)
--   gatilho audit_modelo_peca_teste_mini ON public.modelo_peca_teste_mini (NOVO)  DEPOIS dde0b197ba997c8aae0f7c99ae6ad14a
--   gatilho trg_peca_teste_mini_fila_ins ON public.modelo_peca_teste_mini (NOVO)  DEPOIS 6571dd0b65bfee002d21e55f417f8974
--   gatilho trg_peca_teste_mini_fila_upd ON public.modelo_peca_teste_mini (NOVO)  DEPOIS 8486b70e4f156a184a786bd72da70ec3
--   gatilho trg_peca_teste_mini_fila_del ON public.modelo_peca_teste_mini (NOVO)  DEPOIS 6d41064613f73fa0bcb40a32d45f605a
--   gatilho audit_modelo_peca_teste_mini_linhas ON public.modelo_peca_teste_mini_linhas (NOVO)  DEPOIS df72813c8c6511550ffe04ce1dd1bf99
--   gatilho audit_estoque_peca_teste_baixas ON public.estoque_peca_teste_baixas (NOVO)  DEPOIS 6243dedd847c92ad0bb61953dee9e94e
--   gatilho trg_estoque_peca_teste_imutavel ON public.estoque_peca_teste_baixas (NOVO)  DEPOIS f5d588d362b15927219c6ff5b794ca42
--   tabela public.modelo_peca_teste_mini (NOVA): colunas c9181cb5fac08e4daba2c96c8ae3a066  constraints 3b09a314200fc9f24eb7eb922e5d18ae  indices c9d112730f35d3896dc70f745349287e
--   tabela public.modelo_peca_teste_mini_linhas (NOVA): colunas 10b62d45bdab517a2ac7336325c50b99  constraints eb28b73db052d4bbe3f9203677b2bb74  indices 1d51dce79b5ed9c003bf5d71e8323c35
--   tabela public.estoque_peca_teste_baixas (NOVA): colunas 920415bc46ab195daf5a7e5576aa27b5  constraints 96726b025b0e0a8c9dc1f05b065d09ef  indices 4e3faf9ec955ab1d794f01030cb4cfc6
--   dependencias FIXADAS (nao redefinidas):
--     public.fn_kanban_fila_por_modelo() 83b837afaaab012d00afc37cea9b3572
--     public.fn_audit() 63e5855f24d17914aef609e35ffc499b
-- ====================================================================================
-- Volta (LIFO, banco DEPOIS do site): supabase/rollback/20261103199000_urg_r11_mini_tabelas_down.sql - DEPOIS dos _down da 199400..199100 e ANTES dos da R9 (196000..192000).
-- NAO redefine funcao existente. Com este bloco no banco, o 20261103192000_down_drop (DROP da tabela de tentativas) e o
-- 20260930140000_down (DROP de fn_kanban_fila_por_modelo) FALHAM por dependencia (FKs/gatilhos daqui) - rode antes supabase/rollback/20261103199000_urg_r11_mini_tabelas_down_drop.sql
-- (opcional, horario calmo, site voltado; exige SET app.confirmo_apagar_baixas_peca_teste = 'sim').
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
  -- exige a 20261103192000 (urg R9a)
  IF to_regclass('public.modelo_peca_teste_tentativas') IS NULL THEN
    RAISE EXCEPTION 'urg_r11a: exige a 20261103192000 (urg R9a) aplicada (public.modelo_peca_teste_tentativas ausente)' USING ERRCODE = 'P0001';
  END IF;
  -- dependencias FIXADAS (nao redefinidas aqui): o texto de hoje
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_kanban_fila_por_modelo()', '83b837afaaab012d00afc37cea9b3572'),
      ('public.fn_audit()', '63e5855f24d17914aef609e35ffc499b')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r11a: dependencia % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- tabelas novas: ausentes OU com a forma esperada (colunas/tipos/nullability)
  FOR r IN SELECT * FROM (VALUES
      ('public.modelo_peca_teste_mini', 'modelo_peca_teste_mini', 'tentativa_id:uuid:NO,tenant_id:uuid:NO,modelo_id:uuid:NO,tamanho:text:YES,variante_tecido_id:uuid:YES,mesma_oc:boolean:NO,baixa_em:timestamp with time zone:YES,baixa_por:uuid:YES,created_at:timestamp with time zone:NO,updated_at:timestamp with time zone:NO'),
      ('public.modelo_peca_teste_mini_linhas', 'modelo_peca_teste_mini_linhas', 'id:uuid:NO,tenant_id:uuid:NO,tentativa_id:uuid:NO,chave:text:NO,familia:text:NO,consumo:numeric:YES,loss_percent:numeric:YES,a_enviar:numeric:YES,variante_aviamento_id:uuid:YES,oc_tecido_item_id:uuid:YES,b_rotulo:text:YES,b_variante:text:YES,b_unidade:text:YES,b_consumo:numeric:YES,b_loss_percent:numeric:YES,b_necessaria:numeric:YES,b_a_enviar:numeric:YES,b_baixado:numeric:YES,b_faltou:numeric:YES,b_fontes:jsonb:YES'),
      ('public.estoque_peca_teste_baixas', 'estoque_peca_teste_baixas', 'id:uuid:NO,tenant_id:uuid:NO,tentativa_id:uuid:YES,modelo_id:uuid:YES,familia:text:NO,aviamento_id:uuid:YES,variante_aviamento_id:uuid:YES,etiqueta_id:uuid:YES,tamanho:text:YES,cor_id:uuid:YES,origem:text:NO,quantidade:numeric:NO,rotulo:text:NO,created_at:timestamp with time zone:NO,created_by:uuid:YES')
    ) AS x(rel, nome, cols) LOOP
    IF to_regclass(r.rel) IS NOT NULL THEN
      SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY ordinal_position) INTO v
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.nome;
      IF v IS DISTINCT FROM r.cols THEN
        RAISE EXCEPTION 'urg_r11a: % existe com OUTRA forma (%) - PARE', r.rel, v USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;
  -- funcoes novas: ausentes, DEPOIS ou NEUTRO (_down)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_estoque_peca_teste_imutavel()', '93911c1c230f910f74c93d3f917e9694', '2ccebd01b91760521b76d04f299f97d2')
    ) AS x(f, d, n) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v NOT IN (r.d, r.n) THEN
      RAISE EXCEPTION 'urg_r11a: % (nova) com texto inesperado (md5 %) - gere de novo', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- 1) tabela nova public.modelo_peca_teste_mini (FKs: ShareRowExclusive nas referenciadas) + gatilhos dela
-- [urg r11a] cabecalho da mini explosao: 1:1 com a tentativa da R9 (so existe com dado). baixa_em NOT NULL = baixa ATIVA (trava a
-- mini). Ajustes e foto da baixa ficam nas linhas. Escrita SO pelo Salvar da Peca Teste (199400); o rev e o da tentativa ("tocada").
CREATE TABLE IF NOT EXISTS public.modelo_peca_teste_mini (
  tentativa_id uuid PRIMARY KEY REFERENCES public.modelo_peca_teste_tentativas(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  modelo_id uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  tamanho text,                                                      -- chave da grade ("40|M")
  variante_tecido_id uuid REFERENCES public.variantes_tecido(id) ON DELETE SET NULL,  -- "cor da peca" = variante do Tecido 1
  mesma_oc boolean NOT NULL DEFAULT true,
  baixa_em timestamptz,                                              -- NOT NULL = baixa ATIVA (trava a mini)
  baixa_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mptm_modelo_idx ON public.modelo_peca_teste_mini (modelo_id);
CREATE INDEX IF NOT EXISTS mptm_tenant_idx ON public.modelo_peca_teste_mini (tenant_id);
ALTER TABLE public.modelo_peca_teste_mini ENABLE ROW LEVEL SECURITY;   -- SEM policy: leitura/escrita so pelas RPCs (199300/199400)
REVOKE ALL ON TABLE public.modelo_peca_teste_mini FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.modelo_peca_teste_mini IS 'R11: cabecalho da mini explosao (1 peca) por tentativa de peca teste; escrita so por salvar_peca_teste.';

CREATE OR REPLACE TRIGGER audit_modelo_peca_teste_mini AFTER INSERT OR UPDATE OR DELETE ON public.modelo_peca_teste_mini
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit();
-- Fila do kanban automatico (Ruling 13: o predicado da R12 le a mini). NOMES fora do padrao 'trg_kanban_fila_%' DE PROPOSITO: o
-- teste do inverso da kanban-auto migration 3 conta exatamente 44 gatilhos com esse prefixo.
CREATE OR REPLACE TRIGGER trg_peca_teste_mini_fila_ins AFTER INSERT ON public.modelo_peca_teste_mini
  REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.fn_kanban_fila_por_modelo();
CREATE OR REPLACE TRIGGER trg_peca_teste_mini_fila_upd AFTER UPDATE ON public.modelo_peca_teste_mini
  REFERENCING OLD TABLE AS antigas NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.fn_kanban_fila_por_modelo();
CREATE OR REPLACE TRIGGER trg_peca_teste_mini_fila_del AFTER DELETE ON public.modelo_peca_teste_mini
  REFERENCING OLD TABLE AS antigas FOR EACH STATEMENT EXECUTE FUNCTION public.fn_kanban_fila_por_modelo();

-- 2) tabela nova public.modelo_peca_teste_mini_linhas (FKs: ShareRowExclusive nas referenciadas) + gatilhos dela
-- [urg r11a] linhas da mini: ajustes da pessoa (NULL = segue o BOM/o calculado) + FOTO da baixa (b_*). chave determinista pelo
-- conteudo do BOM (t:/a:/i:), estavel quando o salvar_modelo_bom renumera.
CREATE TABLE IF NOT EXISTS public.modelo_peca_teste_mini_linhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  tentativa_id uuid NOT NULL REFERENCES public.modelo_peca_teste_mini(tentativa_id) ON DELETE CASCADE,
  chave text NOT NULL,
  familia text NOT NULL CHECK (familia IN ('tecido','aviamento','insumo')),
  consumo numeric CHECK (consumo IS NULL OR consumo BETWEEN 0 AND 9999),
  loss_percent numeric CHECK (loss_percent IS NULL OR loss_percent BETWEEN 0 AND 100),
  a_enviar numeric CHECK (a_enviar IS NULL OR a_enviar BETWEEN 0 AND 99999),
  variante_aviamento_id uuid REFERENCES public.variantes_aviamento(id) ON DELETE SET NULL,
  oc_tecido_item_id uuid REFERENCES public.ocs_tecido_itens(id) ON DELETE SET NULL,
  b_rotulo text, b_variante text, b_unidade text CHECK (b_unidade IS NULL OR b_unidade IN ('m','un')),
  b_consumo numeric, b_loss_percent numeric, b_necessaria numeric, b_a_enviar numeric, b_baixado numeric, b_faltou numeric,
  b_fontes jsonb,                                                    -- tecido: [{oc_tecido_item_id, rotulo, metros}]
  CONSTRAINT mptml_chave_ux UNIQUE (tentativa_id, chave)
);
CREATE INDEX IF NOT EXISTS mptml_tenant_idx ON public.modelo_peca_teste_mini_linhas (tenant_id);
ALTER TABLE public.modelo_peca_teste_mini_linhas ENABLE ROW LEVEL SECURITY;   -- SEM policy
REVOKE ALL ON TABLE public.modelo_peca_teste_mini_linhas FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.modelo_peca_teste_mini_linhas IS 'R11: linhas da mini explosao (ajustes + foto da baixa); escrita so por salvar_peca_teste.';

CREATE OR REPLACE TRIGGER audit_modelo_peca_teste_mini_linhas AFTER INSERT OR UPDATE OR DELETE ON public.modelo_peca_teste_mini_linhas
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- 3) tabela nova public.estoque_peca_teste_baixas (FKs: ShareRowExclusive nas referenciadas) + gatilhos dela
-- [urg r11a] LEDGER novo de baixa de aviamento/insumo da peca teste - SO ACRESCIMO (estorno = linha compensatoria negativa, nunca
-- DELETE). Somado pelos proprios _estoque_aviamento_core/_estoque_etiqueta_core (199200). modelo_id e rotulo = FOTO (sem FK: o card
-- some, a linha fica); tentativa_id SET NULL.
CREATE TABLE IF NOT EXISTS public.estoque_peca_teste_baixas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  tentativa_id uuid REFERENCES public.modelo_peca_teste_tentativas(id) ON DELETE SET NULL,
  modelo_id uuid,
  familia text NOT NULL CHECK (familia IN ('aviamento','insumo')),
  aviamento_id uuid REFERENCES public.aviamentos(id), variante_aviamento_id uuid REFERENCES public.variantes_aviamento(id),
  etiqueta_id uuid REFERENCES public.etiquetas(id), tamanho text, cor_id uuid REFERENCES public.cores(id),
  origem text NOT NULL CHECK (origem IN ('peca_teste','peca_teste_estorno')),
  quantidade numeric NOT NULL,
  rotulo text NOT NULL,                                              -- "<REF|nome> . tentativa N . <servico> . saida dd/mm/aaaa"
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT epb_sinal CHECK ((origem = 'peca_teste' AND quantidade > 0) OR (origem = 'peca_teste_estorno' AND quantidade < 0)),
  CONSTRAINT epb_forma CHECK ((familia = 'aviamento' AND aviamento_id IS NOT NULL AND etiqueta_id IS NULL AND tamanho IS NULL AND cor_id IS NULL)
                           OR (familia = 'insumo' AND etiqueta_id IS NOT NULL AND aviamento_id IS NULL AND variante_aviamento_id IS NULL))
);
CREATE INDEX IF NOT EXISTS epb_tenant_familia_idx ON public.estoque_peca_teste_baixas (tenant_id, familia);
CREATE INDEX IF NOT EXISTS epb_tentativa_idx ON public.estoque_peca_teste_baixas (tentativa_id) WHERE tentativa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS epb_aviamento_idx ON public.estoque_peca_teste_baixas (aviamento_id, variante_aviamento_id);
CREATE INDEX IF NOT EXISTS epb_etiqueta_idx ON public.estoque_peca_teste_baixas (etiqueta_id, tamanho, cor_id);
ALTER TABLE public.estoque_peca_teste_baixas ENABLE ROW LEVEL SECURITY;   -- SEM policy
REVOKE ALL ON TABLE public.estoque_peca_teste_baixas FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.estoque_peca_teste_baixas IS 'R11: ledger (so acrescimo) da baixa de aviamento/insumo da peca teste; estorno = linha negativa.';

CREATE OR REPLACE TRIGGER audit_estoque_peca_teste_baixas AFTER INSERT OR UPDATE OR DELETE ON public.estoque_peca_teste_baixas
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- 4) funcao de gatilho NOVA (texto canonico) + gatilho
CREATE OR REPLACE FUNCTION public.fn_estoque_peca_teste_imutavel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r11a] ledger da peca teste = SO ACRESCIMO (estorno = linha compensatoria negativa). UPDATE so passa quando a UNICA mudanca e
  -- tentativa_id -> NULL (a FK ON DELETE SET NULL, quando a tentativa/o card some); DELETE so com
  -- SET app.confirmo_apagar_baixas_peca_teste = 'sim' (o reset/excluir loja roda em replica e nao dispara gatilho).
  IF TG_OP = 'UPDATE' THEN
    IF OLD.tentativa_id IS NOT NULL AND NEW.tentativa_id IS NULL
       AND (to_jsonb(NEW) - 'tentativa_id') = (to_jsonb(OLD) - 'tentativa_id') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'peca_teste_mini_baixa_imutavel: baixa de peca teste nao se altera (estorno = linha nova)' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(current_setting('app.confirmo_apagar_baixas_peca_teste', true), '') = 'sim' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'peca_teste_mini_baixa_imutavel: baixa de peca teste nao se apaga (estorno = linha nova)' USING ERRCODE = 'P0001';
END $function$;
CREATE OR REPLACE TRIGGER trg_estoque_peca_teste_imutavel BEFORE UPDATE OR DELETE ON public.estoque_peca_teste_baixas
  FOR EACH ROW EXECUTE FUNCTION public.fn_estoque_peca_teste_imutavel();

REVOKE EXECUTE ON FUNCTION public.fn_estoque_peca_teste_imutavel() FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  -- tabelas: colunas+defaults, constraints e indices do DDL; RLS ligada, 0 policies, ACL exata, fora do Realtime
  FOR r IN SELECT * FROM (VALUES
      ('public.modelo_peca_teste_mini', 'modelo_peca_teste_mini', 'c9181cb5fac08e4daba2c96c8ae3a066', '3b09a314200fc9f24eb7eb922e5d18ae', 'c9d112730f35d3896dc70f745349287e'),
      ('public.modelo_peca_teste_mini_linhas', 'modelo_peca_teste_mini_linhas', '10b62d45bdab517a2ac7336325c50b99', 'eb28b73db052d4bbe3f9203677b2bb74', '1d51dce79b5ed9c003bf5d71e8323c35'),
      ('public.estoque_peca_teste_baixas', 'estoque_peca_teste_baixas', '920415bc46ab195daf5a7e5576aa27b5', '96726b025b0e0a8c9dc1f05b065d09ef', '4e3faf9ec955ab1d794f01030cb4cfc6')
    ) AS x(rel, nome, cols, cons, idx) LOOP
    SELECT md5(string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' ORDER BY ordinal_position))
      INTO v FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.nome;
    IF v IS DISTINCT FROM r.cols THEN
      RAISE EXCEPTION 'urg_r11a: pos-condicao falhou nas colunas de % (md5 %)', r.rel, v USING ERRCODE = 'P0001';
    END IF;
    SELECT md5(string_agg(k.conname || ' ' || pg_get_constraintdef(k.oid), E'\n' ORDER BY k.conname)) INTO v
      FROM pg_constraint k WHERE k.conrelid = to_regclass(r.rel);
    IF v IS DISTINCT FROM r.cons THEN
      RAISE EXCEPTION 'urg_r11a: pos-condicao falhou nas constraints de % (md5 %)', r.rel, v USING ERRCODE = 'P0001';
    END IF;
    SELECT md5(string_agg(pg_get_indexdef(i.indexrelid), E'\n' ORDER BY i.indexrelid::regclass::text)) INTO v
      FROM pg_index i WHERE i.indrelid = to_regclass(r.rel) AND i.indisvalid;
    IF v IS DISTINCT FROM r.idx THEN
      RAISE EXCEPTION 'urg_r11a: pos-condicao falhou nos indices de % (md5 %)', r.rel, v USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass(r.rel) AND c.relrowsecurity
                     AND coalesce(c.relacl::text, '') = '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}')
       OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass(r.rel))
       OR has_table_privilege('anon', r.rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_table_privilege('authenticated', r.rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'urg_r11a: pos-condicao falhou na RLS/ACL/policies de %', r.rel USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_publication_tables pt WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public'
                 AND pt.tablename = r.nome) THEN
      RAISE EXCEPTION 'urg_r11a: % nao pode estar na publicacao supabase_realtime' , r.rel USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- os 7 gatilhos com o pg_get_triggerdef gerado, habilitados
  FOR r IN SELECT * FROM (VALUES
      ('public.modelo_peca_teste_mini', 'audit_modelo_peca_teste_mini', 'dde0b197ba997c8aae0f7c99ae6ad14a'),
      ('public.modelo_peca_teste_mini', 'trg_peca_teste_mini_fila_ins', '6571dd0b65bfee002d21e55f417f8974'),
      ('public.modelo_peca_teste_mini', 'trg_peca_teste_mini_fila_upd', '8486b70e4f156a184a786bd72da70ec3'),
      ('public.modelo_peca_teste_mini', 'trg_peca_teste_mini_fila_del', '6d41064613f73fa0bcb40a32d45f605a'),
      ('public.modelo_peca_teste_mini_linhas', 'audit_modelo_peca_teste_mini_linhas', 'df72813c8c6511550ffe04ce1dd1bf99'),
      ('public.estoque_peca_teste_baixas', 'audit_estoque_peca_teste_baixas', '6243dedd847c92ad0bb61953dee9e94e'),
      ('public.estoque_peca_teste_baixas', 'trg_estoque_peca_teste_imutavel', 'f5d588d362b15927219c6ff5b794ca42')
    ) AS x(t, n, m) LOOP
    SELECT md5(pg_get_triggerdef(t.oid)) INTO v FROM pg_trigger t
     WHERE t.tgrelid = to_regclass(r.t) AND t.tgname = r.n AND NOT t.tgisinternal AND t.tgenabled <> 'D';
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r11a: pos-condicao falhou no gatilho % de % (md5 %, esperado %)', r.n, r.t, coalesce(v, 'ausente'), r.m
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- funcao nova: DEPOIS, DEFINER, search_path=public, ACL so postgres/service_role
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_estoque_peca_teste_imutavel()', '93911c1c230f910f74c93d3f917e9694', '2ccebd01b91760521b76d04f299f97d2')
    ) AS x(f, d, n) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 'urg_r11a: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.d USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}'
                     AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r11a: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
