# Prompt p/ Lovable — Detalhe de estoque inclui OCs pendentes (com reserva)

> Já aplicado direto no Supabase próprio (migration `20260616233000_detalhe_estoque_oc_pendentes.sql`).

Cole no Lovable: faça a função `public.detalhe_estoque_variante(_variante_id uuid)`
retornar tanto OCs **recebidas** quanto **pendentes** (`oc.status IN ('recebido','encomendado')`,
não canceladas), adicionando os campos `recebida boolean`, `prev_receb_m` (qtd pedida em
metros, só p/ pendentes) e mantendo `recebido_m`/`baixado_m`/`reservado_m`. O `reservado_m`
usa a grade da variante (variante_numero = ordem do vínculo) × multiplicador, igual ao total.
Conteúdo idêntico ao da migration `20260616233000_detalhe_estoque_oc_pendentes.sql` no repo.
