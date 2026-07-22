export type PtVariante = { id?: string; variante_tecido_id: string; label?: string; ordem: number; multiplicador: number; grades: Record<string, number>; grade_total: number };
export type PtMaterial = { id?: string; artigo_id: string | null; artigo_nome?: string | null; unidade_medida?: string | null; rendimento?: number | null; tipo: "tecido" | "forro"; numero: number; consumo: number; loss_percent: number; ordem: number; variantes: PtVariante[] };
export type PtSlot = { id?: string; modelo_id: string | null; slot_index?: number; ref?: string | null; nome?: string | null; thumb_path?: string | null; proporcoes?: Record<string, number> | null; custo_simulado?: unknown; custo_terceirizados_previsto?: number | null; custos_adicionais?: { descricao: string; valor: number }[]; preco_venda?: number | null; materiais: PtMaterial[] };
export type PtLinha = { id?: string; linha_id: string | null; categoria_id: string | null; ordem: number; slots: PtSlot[] };
export type PtSub = { id?: string; subcolecao_id: string | null; ordem: number; linhas: PtLinha[] };
export type PtArvore = { plan_id?: string; colecao_id: string; subcolecoes: PtSub[] };
