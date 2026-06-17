# Prompt p/ Lovable — 1ª reserva desde o Desenvolvimento

> **Já aplicado direto no Supabase próprio** (migration `20260616210000_reserva_desde_desenvolvimento.sql`).
> Cole no Lovable só para alinhar o ambiente dele.

Cole no chat do Lovable:

---

Na função `estoque_tecido_por_artigo`, no CTE `reservado`, ajuste as condições do
`WHERE` para que a **reserva comece já no Desenvolvimento** (assim que o BOM —
consumo + grade + variantes — é preenchido, sem exigir aprovação) e **persista
até o corte ser confirmado** (botão Imprimir e Enviar do CAD), quando vira baixa.

Troque:
```
    WHERE m.tenant_id = v_tenant
      AND m.data_aprovacao IS NOT NULL
      AND COALESCE(m.enviado_cad, false) = false
      AND mt.artigo_id IS NOT NULL
    GROUP BY mt.artigo_id
```
por:
```
    WHERE m.tenant_id = v_tenant
      AND mt.artigo_id IS NOT NULL
      AND LOWER(COALESCE(m.status_desenvolvimento, '')) <> 'reprovado'
      AND NOT EXISTS (
        SELECT 1 FROM public.cad c
        WHERE c.modelo_id = m.id AND COALESCE(c.enviado_corte, false) = true
      )
    GROUP BY mt.artigo_id
```
O resto da função fica igual. (O CTE `baixa` já usa `enviado_corte = true`, então
após Imprimir e Enviar o modelo sai do `reservado` e entra na baixa — a 2ª etapa.)
---
