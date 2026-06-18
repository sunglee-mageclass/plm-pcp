-- ============================================================================
-- REVERTE a UNIQUE(cad.modelo_id) adicionada em 20260618190000.
--
-- Efeito colateral grave: um UNIQUE na coluna FK faz o PostgREST tratar a
-- relação modelos -> cad como 1-para-1, devolvendo `cad` como OBJETO em vez de
-- ARRAY. Isso quebrou TODOS os embeds que liam `cad(...)` como lista:
--   - entrada-saida/estoque: "(m.cad ?? []).some is not a function"
--   - producao.cad.index / cq / terceirizados / acabamento / direcionamento /
--     oficina / lancamentos: status do CAD lido errado ("não avança").
--
-- A idempotência do "Enviar para CAD" continua garantida pela própria RPC
-- enviar_modelo_para_cad (IF EXISTS ... RAISE), que NÃO altera a cardinalidade
-- detectada pelo PostgREST. Sem o UNIQUE, a relação volta a ser 1-para-muitos e
-- `cad` volta a ser array nos embeds.
-- ============================================================================
ALTER TABLE public.cad DROP CONSTRAINT IF EXISTS cad_modelo_id_key;

-- Recarrega o schema cache do PostgREST para a cardinalidade voltar na hora.
NOTIFY pgrst, 'reload schema';
