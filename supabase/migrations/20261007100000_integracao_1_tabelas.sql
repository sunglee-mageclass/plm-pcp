-- Integração + API por loja (spec docs/superpowers/specs/2026-09-26-tela-integracao-api-design.md) — 1/6: TABELAS.
-- 7 tabelas novas, TODAS com RLS LIGADA e NENHUMA policy + REVOKE ALL de PUBLIC/anon/authenticated (padrão
-- kanban_snapshot): leitura/escrita SÓ por RPC SECURITY DEFINER (migrations 2–6), que confere a permissão `integracao`
-- e mascara o custo (inv. #12). service_role fica com os grants padrão (a rota da API usa só as funções _integracao_*).
--   integracao_config   1 linha/loja; semeada p/ as lojas atuais aqui e p/ loja nova/reset por _seed_tenant_defaults (N9/n6)
--   integracao_segredo  segredo do HMAC da assinatura (nota 6) — global, 1 linha
--   integracao_produtos estado + retrato; 1:1 com modelos por TRIGGER enforce_unique_fk + índice plano (nunca UNIQUE)
--   integracao_linhas   a TABELA ESPELHO lida pela API (1 linha do produto + N sublinhas)
--   integracao_chaves   só o SHA-256 da chave + os 4 últimos caracteres
--   integracao_acessos  reserva do acesso (V4) + agregados por (tipo+IP/chave, minuto) (R11/D19)
--   integracao_log      log da tela, SEM FK p/ modelos (a prova não some — delta nota 8)
-- Redefine _seed_tenant_defaults (+1 INSERT, texto marcado [integracao v1]; diff mínimo conferido pela suíte).
-- Contagens: +1 função (_integracao_layout) | +1 gatilho (trg_integracao_produtos_unico).
-- Inverso: supabase/rollback/20261007100000_integracao_1_tabelas_down.sql (SÓ depois dos inversos 6..2).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_def text := pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure);
BEGIN
  IF md5(v_def) <> '01bd241680e24fdb665ca8ae81a6a1a3' AND position('[integracao v1]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'integracao_1: _seed_tenant_defaults com texto inesperado (md5 %) - refazer o diff', md5(v_def)
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.enforce_unique_fk()') IS NULL THEN
    RAISE EXCEPTION 'integracao_1: enforce_unique_fk ausente' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._integracao_layout()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- Ordem FIXA do layout do pedido (P-60 B). 1-17 = layout (padrão marcado); 18 = Foto (opcional, P-83 A).
  SELECT ARRAY['nome', 'ref_sku', 'preco_anterior', 'preco_venda', 'peso', 'ncm', 'preco_custo', 'cor_base',
               'cor_apelido', 'tamanho', 'titulo', 'descricao', 'keywords', 'metatag', 'comprimento', 'largura',
               'altura', 'foto']::text[]
$function$;
REVOKE EXECUTE ON FUNCTION public._integracao_layout() FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.integracao_config (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
  campos text[] NOT NULL DEFAULT (public._integracao_layout())[1:17],
  limite_por_minuto integer NOT NULL DEFAULT 60
    CONSTRAINT integracao_config_limite_chk CHECK (limite_por_minuto BETWEEN 1 AND 600),
  -- P-89 A (plano gratuito do Cloudflare): padrão 50; a FAIXA segue 1–500 (aumentar depois = aba API, sem migration)
  max_por_pagina integer NOT NULL DEFAULT 50
    CONSTRAINT integracao_config_pagina_chk CHECK (max_por_pagina BETWEEN 1 AND 500),
  validade_foto_dias integer NOT NULL DEFAULT 7
    CONSTRAINT integracao_config_foto_chk CHECK (validade_foto_dias BETWEEN 1 AND 30),
  bloqueio_tentativas integer NOT NULL DEFAULT 10
    CONSTRAINT integracao_config_bloqueio_chk CHECK (bloqueio_tentativas BETWEEN 3 AND 100),
  rev integer NOT NULL DEFAULT 1,
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integracao_config_campos_chk CHECK (campos <@ public._integracao_layout())
);

CREATE TABLE IF NOT EXISTS public.integracao_segredo (
  id smallint PRIMARY KEY DEFAULT 1 CONSTRAINT integracao_segredo_um CHECK (id = 1),
  segredo bytea NOT NULL DEFAULT extensions.gen_random_bytes(32),
  criado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.integracao_segredo (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.integracao_produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  modelo_id uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  estado text NOT NULL DEFAULT 'nao_integravel'
    CONSTRAINT integracao_produtos_estado_chk CHECK (estado IN ('nao_integravel', 'integravel', 'integrado')),
  campos text[] NOT NULL DEFAULT '{}'::text[],
  retrato jsonb,
  assinatura text,
  variantes_chaves uuid[],
  marcado_por uuid,
  marcado_em timestamptz,
  integrado_em timestamptz,
  integrado_chave_id uuid,
  desfeito_por uuid,
  desfeito_em timestamptz,
  desfeito_motivo text,
  rev integer NOT NULL DEFAULT 1,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_integracao_produtos_modelo ON public.integracao_produtos (modelo_id);
CREATE INDEX IF NOT EXISTS idx_integracao_produtos_tenant ON public.integracao_produtos (tenant_id, estado, id);
CREATE OR REPLACE TRIGGER trg_integracao_produtos_unico BEFORE INSERT OR UPDATE OF modelo_id ON public.integracao_produtos
  FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_fk('modelo_id');

CREATE TABLE IF NOT EXISTS public.integracao_linhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  loja_nome text NOT NULL,
  modelo_id uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  tipo text NOT NULL CONSTRAINT integracao_linhas_tipo_chk CHECK (tipo IN ('produto', 'variante')),
  ordem integer NOT NULL,
  nome text, ref_sku text, preco_anterior text, preco_venda text, peso text, ncm text, preco_custo text,
  cor_base text, cor_apelido text, tamanho text, titulo text, descricao text, keywords text, metatag text,
  comprimento text, largura text, altura text,
  fotos text[] NOT NULL DEFAULT '{}'::text[],
  integrado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integracao_linhas_modelo_ordem_key UNIQUE (modelo_id, ordem)
);
CREATE INDEX IF NOT EXISTS idx_integracao_linhas_tenant ON public.integracao_linhas (tenant_id, modelo_id);

CREATE TABLE IF NOT EXISTS public.integracao_chaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  nome text NOT NULL CONSTRAINT integracao_chaves_nome_chk CHECK (length(btrim(nome)) BETWEEN 1 AND 60),
  hash text NOT NULL CONSTRAINT integracao_chaves_hash_chk CHECK (hash ~ '^[0-9a-f]{64}$'),
  final text NOT NULL,
  criada_por uuid,
  criada_em timestamptz NOT NULL DEFAULT now(),
  revogada_por uuid,
  revogada_em timestamptz,
  ultimo_uso_em timestamptz,
  CONSTRAINT integracao_chaves_hash_key UNIQUE (hash)
);
CREATE INDEX IF NOT EXISTS idx_integracao_chaves_tenant ON public.integracao_chaves (tenant_id, criada_em DESC);

CREATE TABLE IF NOT EXISTS public.integracao_acessos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id),
  chave_id uuid REFERENCES public.integracao_chaves(id) ON DELETE SET NULL,
  ip text,
  modo text NOT NULL DEFAULT 'normal' CONSTRAINT integracao_acessos_modo_chk CHECK (modo IN ('normal', 'teste')),
  status text NOT NULL CONSTRAINT integracao_acessos_status_chk
    CHECK (status IN ('reservado', 'ok', 'teste', 'chave_invalida', 'loja_inativa', 'ip_bloqueado', 'limite_excedido')),
  agregado text,
  minuto timestamptz,
  tentativas integer NOT NULL DEFAULT 1,
  produtos_entregues integer NOT NULL DEFAULT 0,
  linhas integer NOT NULL DEFAULT 0,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);
CREATE INDEX IF NOT EXISTS idx_integracao_acessos_chave ON public.integracao_acessos (chave_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_integracao_acessos_ip ON public.integracao_acessos (ip, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_integracao_acessos_tenant ON public.integracao_acessos (tenant_id, criado_em DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_integracao_acessos_agregado ON public.integracao_acessos (agregado, minuto)
  WHERE agregado IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.integracao_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  acao text NOT NULL CONSTRAINT integracao_log_acao_chk CHECK (acao IN ('campos', 'editar', 'integrar', 'voltar',
    'desfazer', 'integrado', 'chave_criar', 'chave_revogar', 'config_api')),
  usuario_id uuid,
  quem text NOT NULL,
  modelo_id uuid,
  modelo_nome text,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_integracao_log_tenant ON public.integracao_log (tenant_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_integracao_log_modelo ON public.integracao_log (modelo_id);

ALTER TABLE public.integracao_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_segredo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_linhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_chaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_acessos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.integracao_config FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integracao_segredo FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integracao_produtos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integracao_linhas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integracao_chaves FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integracao_acessos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integracao_log FROM PUBLIC, anon, authenticated;

-- Semente das lojas atuais (N9): campos do layout marcados, Foto desmarcada (P-83 A).
INSERT INTO public.integracao_config (tenant_id) SELECT t.id FROM public.tenants t ON CONFLICT (tenant_id) DO NOTHING;

-- Loja nova e reset_loja (n6): _seed_tenant_defaults ganha 1 INSERT (resto BYTE A BYTE igual — diff na suíte).
CREATE OR REPLACE FUNCTION public._seed_tenant_defaults(_tid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.tenant_config (tenant_id) VALUES (_tid)
  ON CONFLICT (tenant_id) DO NOTHING;

  INSERT INTO public.categorias_terceirizado (tenant_id, nome, ordem) VALUES
    (_tid, 'Corte', 0), (_tid, 'Oficina', 1), (_tid, 'PL', 2)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- 12 meses FIXOS (ordem 1..12) — a UI não deixa criar (atributo `fixed`), então precisam
  -- existir sempre; senão o dropdown de Mês (Planejamento/CAD/CQ/OTB/Lançamentos) fica vazio.
  INSERT INTO public.meses (tenant_id, mes, ordem) VALUES
    (_tid, 'Janeiro', 1), (_tid, 'Fevereiro', 2), (_tid, 'Março', 3),
    (_tid, 'Abril', 4), (_tid, 'Maio', 5), (_tid, 'Junho', 6),
    (_tid, 'Julho', 7), (_tid, 'Agosto', 8), (_tid, 'Setembro', 9),
    (_tid, 'Outubro', 10), (_tid, 'Novembro', 11), (_tid, 'Dezembro', 12)
  ON CONFLICT (tenant_id, mes) DO NOTHING;

  -- Ano corrente + próximo, p/ a loja já posicionar modelos no calendário ao abrir/resetar.
  INSERT INTO public.anos (tenant_id, ano) VALUES
    (_tid, EXTRACT(YEAR FROM CURRENT_DATE)::int::text),
    (_tid, (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)::text)
  ON CONFLICT (tenant_id, ano) DO NOTHING;

  -- Lojas do Direcionamento: E-commerce (padrão) + Loja Física — renomeáveis depois.
  INSERT INTO public.lojas_direcionamento (tenant_id, nome, ativo, is_default, ordem) VALUES
    (_tid, 'E-commerce', true, true, 1),
    (_tid, 'Loja Física', true, false, 2)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- Categorias de fornecedor fixas (Aviamento/Insumo/Produto Acabado/Tecido/Produto Importado).
  INSERT INTO public.categorias_fornecedor (tenant_id, nome, fixa) VALUES
    (_tid, 'Aviamento', true),
    (_tid, 'Insumo', true),
    (_tid, 'Produto Acabado', true),
    (_tid, 'Tecido', true),
    (_tid, 'Produto Importado', true)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- 7º BLOCO (D2): tipos de insumo iniciais — Cartão/Croqui/Etiqueta (protegido: não excluíveis).
  INSERT INTO public.tipos_insumo (tenant_id, nome, protegido) VALUES
    (_tid, 'Cartão', true),
    (_tid, 'Croqui', true),
    (_tid, 'Etiqueta', true)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- [integracao v1] Integração + API (set/2026): a config nasce com o padrão (campos do layout #1-#17 marcados, Foto
  -- desmarcada — P-83 A). reset_loja e a criação de loja passam por aqui (N9/n6).
  INSERT INTO public.integracao_config (tenant_id) VALUES (_tid)
  ON CONFLICT (tenant_id) DO NOTHING;
END;
$function$;

DO $pos$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integracao_config', 'integracao_segredo', 'integracao_produtos', 'integracao_linhas',
                            'integracao_chaves', 'integracao_acessos', 'integracao_log'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'integracao_1: tabela % ausente', t USING ERRCODE = 'P0001';
    END IF;
    IF NOT (SELECT k.relrowsecurity FROM pg_class k WHERE k.oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'integracao_1: RLS desligada em %', t USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'integracao_1: % tem policy', t USING ERRCODE = 'P0001';
    END IF;
    -- ruling do controlador, revisão T1 #1 (Minor #3): confere TODOS os privilegios de linha/DML, não só SELECT
    -- (INSERT/UPDATE/DELETE/TRUNCATE concedidos a anon/authenticated passariam pelo check antigo sem serem pegos).
    IF has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'integracao_1: % legivel/gravavel por anon/authenticated', t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF position('[integracao v1]' IN pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'integracao_1: _seed_tenant_defaults sem o trecho novo' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants t2 WHERE NOT EXISTS (SELECT 1 FROM public.integracao_config c WHERE c.tenant_id = t2.id)) THEN
    RAISE EXCEPTION 'integracao_1: loja sem integracao_config' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('authenticated', 'public._integracao_layout()', 'EXECUTE') THEN
    RAISE EXCEPTION 'integracao_1: _integracao_layout executavel por authenticated' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
