import { roundTo } from "@/lib/num";

export type TipoTec = "tecido" | "forro" | "entretela";

export type VarianteRow = {
  id?: string;
  variante_tecido_id: string | null;
  variante_nome?: string | null;
  variante_cor?: string | null;
  variante_apelido?: string | null;
  multiplicador?: number | null;
  ordem: number;
  quantidade_folhas: number;
  metragem_planejada: number;
  metragem_enviada: number;
  // Variante(s) do Tecido 1 com que esta variante (bloco complementar, ex.: forro) foi
  // "casada" — ver casar-variantes-fatia2. Copiado do BOM (modelo_tecido_variantes) ao
  // enviar ao CAD; usado só p/ exibição ("casada com …") na Ficha Técnica/Corte.
  complementa_variante_ids?: string[] | null;
};

export type TecidoRow = {
  id?: string;
  numero: number;
  tipo: TipoTec;
  artigo_id: string | null;
  consumo_cad: number;
  loss_percent_cad: number;
  custo_cad: number;
  tamanho_folha: number;
  preco: number;
  largura?: number | null;
  artigo_nome?: string | null;
  etiqueta_lavagem_urls?: string[];
  variantes: VarianteRow[];
};

export type GradeRow = {
  id?: string;
  variante_numero: number;
  // Grade única, compartilhada com o Desenvolvimento (modelo_grades). O que se
  // edita no CAD é a grade final do modelo.
  grades: Record<string, number>;
  grade_total: number;
};

export type AviamentoRow = {
  id?: string;
  numero: number;
  aviamento_id: string | null;
  aviamento_nome?: string | null;
  // Rótulo da variante (cor - apelido) p/ a Explosão de Aviamentos impressa; null = sem variante.
  variante_label?: string | null;
  consumo: number;
  grade_total: number;
  quantidade_enviar: number;
  quantidade_separar: number;
  preco: number;
  // Custo do aviamento por peça = consumo * preço (sem perda).
  custo_cad: number;
};

export type EtiquetaRow = {
  id?: string;
  etiqueta_id: string;
  etiqueta_nome: string;
  // Cor escolhida (do BOM/CAD). O tamanho NÃO é fixo por linha: explode pela grade
  // (uma qtd por tamanho), usando a variante (tamanho, cor). `tamanho` legado (mantido).
  cor_id: string | null;
  cor_nome?: string | null;
  tamanho: string | null;
  consumo: number;
  quantidade_planejada: number;
  quantidade_enviar: number;
  // Qtd a enviar POR tamanho {tamanho: qtd}; vazio p/ etiqueta sem tamanho (usa o escalar).
  enviarPorTamanho: Record<string, number>;
  // Insumo sem tamanho (formato Nenhum ou sem variante com tamanho) — usado na impressão
  // p/ decidir "Geral" vs explosão pela grade, mesmo sem enviar_por_tamanho gravado.
  semTamanho?: boolean;
};

export function calcCusto(consumo: number, loss: number, preco: number) {
  return roundTo(consumo * (1 + loss / 100) * preco, 2);
}

// Células das tabelas dos printáveis — compactas p/ caber na margem padrão do print.
export const cellH: React.CSSProperties = {
  border: "1px solid #999",
  padding: "2px 5px",
  textAlign: "left",
  fontWeight: 600,
  fontSize: 10,
  wordBreak: "break-word",
};
export const cell: React.CSSProperties = { border: "1px solid #999", padding: "2px 5px", fontSize: 10, wordBreak: "break-word" };
