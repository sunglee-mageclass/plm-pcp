-- A2/A3 — PL fixo (categorias_terceirizado) + categorias_fornecedor: ativo/fixa + seed das 5 fixas.
-- Dedupe por TOKEN normalizado (espelha src/lib/fornecedor-categoria.ts). Loja com equivalente
-- ("AVIAMENTOS"/"TECIDOS"/"Artigo"…) NÃO ganha duplicata; o existente fica (só fixa=true).
-- Proteção rename/delete das fixas fica no FRONT (AttributeTab) — precedente 20260623310000.
--
-- ⚠️ NOTA (28/08/2026): o CREATE OR REPLACE de _seed_tenant_defaults abaixo foi RE-BASEADO no
-- corpo VIVO capturado via pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure)
-- na hora de escrever esta migration (mesmo texto do bloco `tenant_config` + `categorias_terceirizado`
-- Corte/Oficina + `meses` + `anos` + `lojas_direcionamento` — TODOS preservados, nada removido).
-- O pacote D (Insumos, ainda não escrito) também vai mexer nessa função — quem escrever aquela
-- migration deve RE-CAPTURAR o corpo desta versão (não a de antes) do mesmo jeito.
BEGIN;

ALTER TABLE public.categorias_fornecedor
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
ALTER TABLE public.categorias_fornecedor
  ADD COLUMN IF NOT EXISTS fixa boolean NOT NULL DEFAULT false;

-- A2: PL fixo — backfill p/ tenants EXISTENTES. Dedupe espelha isServicoPL
-- (src/lib/servico-confeccao.ts): token 'pl'/'pls' OU 'private label'.
INSERT INTO public.categorias_terceirizado (tenant_id, nome, ordem, etapa)
SELECT t.id, 'PL',
       COALESCE((SELECT MAX(ct2.ordem) + 1 FROM public.categorias_terceirizado ct2
                  WHERE ct2.tenant_id = t.id), 2),
       'ate_costura'
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.categorias_terceirizado ct
  WHERE ct.tenant_id = t.id
    AND ( lower(ct.nome) ~ '(^|[^a-z0-9])pls?([^a-z0-9]|$)'
          OR lower(ct.nome) LIKE '%private label%' )
)
ON CONFLICT (tenant_id, nome) DO NOTHING;

-- A3: marca equivalentes EXISTENTES como fixa (NÃO renomeia)
UPDATE public.categorias_fornecedor cf
SET fixa = true
WHERE cf.fixa = false
  AND EXISTS (
    SELECT 1 FROM unnest(ARRAY['aviament','insumo','acabad','importad','tecido','artigo']) tok
    WHERE translate(lower(cf.nome),
            'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') LIKE '%' || tok || '%'
  );

-- A3: seed das 5 fixas p/ tenants EXISTENTES, dedupe por token
INSERT INTO public.categorias_fornecedor (tenant_id, nome, fixa)
SELECT t.id, f.nome, true
FROM public.tenants t
CROSS JOIN (VALUES
  ('Aviamento',         ARRAY['aviament']),
  ('Insumo',            ARRAY['insumo']),
  ('Produto Acabado',   ARRAY['acabad']),
  ('Tecido',            ARRAY['tecido','artigo']),
  ('Produto Importado', ARRAY['importad'])
) AS f(nome, toks)
WHERE NOT EXISTS (
  SELECT 1 FROM public.categorias_fornecedor cf
  WHERE cf.tenant_id = t.id
    AND EXISTS (
      SELECT 1 FROM unnest(f.toks) tok
      WHERE translate(lower(cf.nome),
              'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') LIKE '%' || tok || '%'
    )
)
ON CONFLICT (tenant_id, nome) DO NOTHING;

-- Loja nova / reset: _seed_tenant_defaults v3 — corpo RE-BASEADO no vivo (ver nota acima),
-- + PL no VALUES do categorias_terceirizado + INSERT das 5 fixas de categorias_fornecedor.
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
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._seed_tenant_defaults(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
SELECT pg_notify('pgrst', 'reload schema');
