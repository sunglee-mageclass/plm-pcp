-- Realtime leve (Fase 2 — FECHAMENTO): OSs + Cadastros. Publica no Realtime as tabelas-raiz das
-- listas que faltavam, para que a lista de outro usuário atualize sozinha ao criar/editar/excluir —
-- sem F5. (Explosão usa `modelos`, já publicada; Direcionamento/OTB já cobertos nas fases anteriores.)
--
-- Todas com RLS tenant-scoped (tenant_select) — verificado antes desta migração. O postgres_changes
-- respeita o SELECT → sem vazamento cross-tenant. REPLICA IDENTITY FULL p/ o DELETE propagar a linha
-- inteira (excluir um cadastro deve sumir da lista de quem olha). Idempotente (guards) p/ reaplicar.
--
-- Escopo por tabela:
--  • OSs: ordens_saida_tecido, ordens_saida_aviamento
--  • Cadastro Tecidos: artigos, variantes_tecido
--  • Cadastro Aviamentos: aviamentos, variantes_aviamento
--  • Cadastro Serviço/Fornecedores: empresas, representantes
--  • Cadastro Colaboradores: colaboradores
--  • Cadastro Destinos: destinos_saida
--  • Cadastro Etiquetas: etiquetas, variantes_etiqueta
--  • Atributos ainda não publicados: anos, categorias_fornecedor, categorias_tecido,
--    categorias_aviamento, subcategorias_aviamento, materiais_aviamento, intervalos_largura, tipos_insumo

BEGIN;

DO $mig$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY[
    'ordens_saida_tecido', 'ordens_saida_aviamento',
    'artigos', 'variantes_tecido',
    'aviamentos', 'variantes_aviamento',
    'empresas', 'representantes',
    'colaboradores', 'destinos_saida',
    'etiquetas', 'variantes_etiqueta',
    'anos', 'categorias_fornecedor', 'categorias_tecido', 'categorias_aviamento',
    'subcategorias_aviamento', 'materiais_aviamento', 'intervalos_largura', 'tipos_insumo'
  ]) AS tbl LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', r.tbl);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = r.tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', r.tbl);
    END IF;
  END LOOP;
END $mig$;

COMMIT;

SELECT pg_notify('pgrst', 'reload schema');
