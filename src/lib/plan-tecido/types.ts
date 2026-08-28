// variante_tecido_id null = cor PLANEJADA (base+apelido) sem variante real ainda (tecido s/ fornecedor)
export type PtVariante = { id?: string; variante_tecido_id: string | null; cor_id?: string | null; cor_apelido_id?: string | null; label?: string; cor_nome?: string | null; ordem: number; multiplicador: number; grades: Record<string, number>; grade_total: number };
// consumo_cad: MARCADOR de exibição (item 3c) — consumo confirmado no CAD (cad_tecidos.consumo_cad)
// quando venceu; NÃO é gravado no plano (igual aos outros campos só-exibição artigo_nome/unidade…).
export type PtMaterial = { id?: string; artigo_id: string | null; artigo_nome?: string | null; unidade_medida?: string | null; rendimento?: number | null; preco_por_metro?: number | null; tipo: "tecido" | "forro"; numero: number; consumo: number; consumo_cad?: number | null; loss_percent: number; ordem: number; variantes: PtVariante[] };
// usar_estoque: flag "Usar estoque existente" APOSENTADO (dono 17/ago/2026) — coluna INERTE, mantida
// só p/ o round-trip do save preservar o valor legado; a UI não expõe mais nem filtra por ela.
// markup_editado: markup PRÓPRIO do modelo (congelado, `modelos.markup_editado`) — sobrepõe o
// markup da LINHA (que no Plan. Tecido vem da COLOCAÇÃO do card, não do modelo; ver engine.ts) na
// formação de preço do slot. Seedado do modelo a cada carga (display-only; NÃO persistido como
// coluna própria — viaja dentro do jsonb da árvore, mas o servidor não lê esta chave).
export type PtSlot = { id?: string; modelo_id: string | null; slot_index?: number; ref?: string | null; nome?: string | null; thumb_path?: string | null; proporcoes?: Record<string, number> | null; custo_simulado?: unknown; custo_terceirizados_previsto?: number | null; custos_adicionais?: { descricao: string; valor: number }[]; preco_venda?: number | null; categoria_id?: string | null; categoria_tecido_id?: string | null; linha_id?: string | null; markup_editado?: number | null; usar_estoque?: boolean; materiais: PtMaterial[] };
export type PtLinha = { id?: string; linha_id: string | null; categoria_id: string | null; ordem: number; slots: PtSlot[] };
export type PtSub = { id?: string; subcolecao_id: string | null; ordem: number; categorias_tecido?: string[]; linhas: PtLinha[] };
export type PtArvore = { plan_id?: string; colecao_id: string; subcolecoes: PtSub[] };
