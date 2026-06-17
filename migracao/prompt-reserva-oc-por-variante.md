# Prompt p/ Lovable — Reservado por OC usa grade da variante

> **Já aplicado direto no Supabase próprio** (migration `20260616230000_reserva_oc_por_variante.sql`).
> Cole no Lovable só para alinhar o ambiente dele.

Cole no chat do Lovable:

---

Na função `detalhe_estoque_variante`, o `reservado_m` por OC estava usando a grade
**total do modelo** (igual para todas as cores). Ajuste para usar a grade **da
variante** (pela `ordem` do vínculo) × o `multiplicador` da variante, ficando igual
ao "Reservado" do total da variante.

Troque, dentro do `SUM(...)` do `reservado_m`:
```
                   * COALESCE((SELECT SUM(grade_total) FROM public.modelo_grades mg WHERE mg.modelo_id = l.modelo_id),0))
```
por:
```
                   * COALESCE((SELECT mg.grade_total FROM public.modelo_grades mg WHERE mg.modelo_id = l.modelo_id AND mg.variante_numero = l.ordem),0)
                   * COALESCE((SELECT mtv.multiplicador FROM public.modelo_tecido_variantes mtv WHERE mtv.modelo_tecido_id = mt.id AND mtv.ordem = l.ordem),1))
```
O resto da função fica igual.
---
