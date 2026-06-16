# Prompt p/ Lovable — Multiplicador por variante (materiais complementares)

> **Já aplicado direto no Supabase próprio** (migration `20260616190000_multiplicador_variante.sql`).
> Cole no Lovable só quando quiser manter o ambiente dele alinhado. Não é obrigatório.

Cole no chat do Lovable:

---

Quero um **multiplicador de cobertura por variante** nos materiais complementares
(Tecido 2/3, Forro, Entretela). Uma variante de material complementar pode atender
mais de uma cor do principal, então: **peças da variante = grade(posição) ×
multiplicador**. Default 1 = comportamento atual (nada muda nos modelos existentes).

Faça no banco (migration nova):

1. Adicionar coluna `multiplicador numeric NOT NULL DEFAULT 1` em
   `public.modelo_tecido_variantes` e em `public.cad_tecido_variantes`.

2. Na função `estoque_tecido_por_artigo`, no CTE `reservado`, multiplicar a
   fórmula pela cobertura: trocar
   `... * COALESCE(mg.grade_total, 0)`
   por
   `... * COALESCE(mg.grade_total, 0) * COALESCE(mtv.multiplicador, 1)`
   (o JOIN com `modelo_tecido_variantes mtv` já existe).

3. Na função `salvar_modelo_bom`, o array `variantes` de cada tecido continua
   posicional, e agora chega um array paralelo `multiplicadores` (mesmos índices).
   No INSERT de `modelo_tecido_variantes`, gravar também
   `multiplicador = COALESCE(NULLIF(t->'multiplicadores'->>(v_idx-1), '')::numeric, 1)`.

Não precisa migrar dados antigos (default 1 já é o comportamento atual).
---
