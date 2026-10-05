// Payload de `salvar_terceirizados` — FONTE ÚNICA do PCP › Serviços (sheet) e da edição rápida do card de Etapas PL.
//
// `salvar_terceirizados(_cad_id, _blocos, _observacoes_molde, _rev_base)` é ESTADO COMPLETO por CAD: faz UPDATE de TODAS as
// colunas de cada bloco a partir do objeto (sem merge parcial no servidor — coluna ausente vira null/[]/false) e
// `DELETE … WHERE cad_id = _cad_id AND NOT (id = ANY(ids do payload))`. Por isso quem grava tem de mandar TODOS os blocos do CAD,
// cada um completo. As duas telas montam o bloco pelas MESMAS funções daqui (linha do banco → `BlocoServico` → payload), então
// não podem divergir.
import type { NfItem } from "@/components/oc-tecido/NfList";
import { type GradeDetalhe, somaCampo as somaGrade } from "@/lib/grade-cortada";
import { RecusaEsperadaError } from "@/lib/categoria-card-produto";

// FF#2 (ago/2026): "aviamento enviado" passa a distinguir a VARIANTE (cor) do aviamento.
// A chave é {aviamento_id, variante_aviamento_id} (variante null = aviamento sem variante, ou
// o legado migrado). Um aviamento com 2+ variantes no BOM vira 2 botões distintos.
export type AviamentoEnviado = { aviamento_id: string; variante_aviamento_id: string | null };

// Aceita o formato NOVO (objeto) e o LEGADO (string = aviamento_id, variante null) — resiliência
// na transição; o banco também migra o dado (mig 20260820170000). Descarta lixo.
export function normalizeAviEnviados(raw: unknown): AviamentoEnviado[] {
  if (!Array.isArray(raw)) return [];
  const out: AviamentoEnviado[] = [];
  for (const el of raw) {
    if (typeof el === "string") {
      if (el) out.push({ aviamento_id: el, variante_aviamento_id: null });
    } else if (el && typeof el === "object") {
      const o = el as { aviamento_id?: string; variante_aviamento_id?: string | null };
      if (o.aviamento_id)
        out.push({
          aviamento_id: o.aviamento_id,
          variante_aviamento_id: o.variante_aviamento_id ?? null,
        });
    }
  }
  return out;
}

export type BlocoServico = {
  _key: string; // chave estável de render (permite blocos repetidos da mesma categoria)
  id?: string;
  categoria_terceirizado_id: string;
  categoria_nome?: string;
  interno: boolean;
  // Seleção do responsável (ramo PL): empresa de serviço + representante opcional.
  empresa_id: string | null;
  representante_id: string | null;
  colaborador_id: string | null;
  preco_metro_unidade: number;
  aprovado: boolean;
  quantidade_enviada: number;
  quantidade_recebida: number;
  quantidade_defeito: number;
  desconto_total: number;
  multa_total: number;
  numero_parcelas: number;
  data_enviado: string | null;
  data_prevista: string | null;
  data_entregue: string | null;
  status: string | null;
  observacao: string;
  aviamentos_enviados: AviamentoEnviado[];
  tecidos_enviados: string[];
  // Quantidade por tamanho × variante (opt-in). Quando `detalhado`, os 3 totais viram Σ da grade.
  detalhado: boolean;
  grade_detalhe: GradeDetalhe;
  // Etapas PL (Fase 1, módulo opt-in `etapas_pl`): campos da etapa "Peça Teste" — alimentam
  // etapaDoBloco (src/lib/pcp-etapas.ts) no painel EtapasPlPanel.
  pt_data_saida: string | null;
  pt_data_entrada: string | null;
  pt_aprovacao: "aprovado" | "reprovado" | null;
  // Notas Fiscais do serviço PL (Etapas PL S4): 2 listas, cada NF com url+data.
  nf_saida: NfItem[];
  nf_entrada: NfItem[];
  // Peça de foto (Etapas PL S5): checkbox + data de entrega condicional.
  peca_foto: boolean;
  peca_foto_data: string | null;
};

/** Linha de `producao_terceirizados` (select "*") → bloco do sheet. Mesma leitura da hidratação/merge/retry P0409 do PCP. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- linha crua do PostgREST/to_jsonb (mesmo tipo de antes, no sheet)
export function blocoDeLinha(r: any): BlocoServico {
  return {
    _key: r.id ?? crypto.randomUUID(),
    id: r.id,
    categoria_terceirizado_id: r.categoria_terceirizado_id,
    interno: Boolean(r.interno),
    empresa_id: r.empresa_id ?? null,
    representante_id: r.representante_id ?? null,
    colaborador_id: r.colaborador_id ?? null,
    preco_metro_unidade: Number(r.preco_metro_unidade ?? 0),
    aprovado: Boolean(r.aprovado),
    quantidade_enviada: Number(r.quantidade_enviada ?? 0),
    quantidade_recebida: Number(r.quantidade_recebida ?? 0),
    quantidade_defeito: Number(r.quantidade_defeito ?? 0),
    desconto_total: Number(r.desconto_total ?? 0),
    multa_total: Number(r.multa_total ?? 0),
    numero_parcelas: Number(r.numero_parcelas ?? 1),
    data_enviado: r.data_enviado,
    data_prevista: r.data_prevista,
    data_entregue: r.data_entregue,
    status: r.status,
    observacao: r.observacao ?? "",
    aviamentos_enviados: normalizeAviEnviados(r.aviamentos_enviados),
    tecidos_enviados: Array.isArray(r.tecidos_enviados) ? r.tecidos_enviados : [],
    detalhado: Boolean(r.detalhado),
    grade_detalhe: (r.grade_detalhe && typeof r.grade_detalhe === "object"
      ? r.grade_detalhe
      : {}) as GradeDetalhe,
    pt_data_saida: r.pt_data_saida ?? null,
    pt_data_entrada: r.pt_data_entrada ?? null,
    pt_aprovacao: r.pt_aprovacao ?? null,
    nf_saida: Array.isArray(r.nf_saida) ? r.nf_saida : [],
    nf_entrada: Array.isArray(r.nf_entrada) ? r.nf_entrada : [],
    peca_foto: Boolean(r.peca_foto),
    peca_foto_data: r.peca_foto_data ?? null,
  };
}

/** Bloco do sheet → objeto de `_blocos` (a lógica de `interno` fica aqui; o resto é genérico no banco). */
export function blocoParaPayload(b: BlocoServico) {
  return {
    id: b.id ?? null,
    categoria_terceirizado_id: b.categoria_terceirizado_id,
    interno: b.interno,
    // Grava empresa + representante (empresa_id é a fonte única do responsável PL).
    empresa_id: b.interno ? null : b.empresa_id,
    representante_id: b.interno ? null : b.representante_id,
    colaborador_id: b.interno ? b.colaborador_id : null,
    ativo: true,
    preco_metro_unidade: b.interno ? 0 : b.preco_metro_unidade,
    // Detalhado por tamanho/variante → os totais são a SOMA da grade (fonte única p/ financeiro/CQ).
    quantidade_enviada: b.detalhado ? somaGrade(b.grade_detalhe, "enviada") : b.quantidade_enviada,
    quantidade_recebida: b.detalhado
      ? somaGrade(b.grade_detalhe, "recebida")
      : b.quantidade_recebida,
    quantidade_defeito: b.detalhado ? somaGrade(b.grade_detalhe, "defeito") : b.quantidade_defeito,
    detalhado: b.detalhado,
    grade_detalhe: b.detalhado ? b.grade_detalhe : {},
    desconto_total: b.interno ? 0 : Number(b.desconto_total) || 0,
    multa_total: b.interno ? 0 : Number(b.multa_total) || 0,
    numero_parcelas: Math.max(1, Number(b.numero_parcelas) || 1),
    data_enviado: b.data_enviado,
    data_prevista: b.data_prevista,
    data_entregue: b.data_entregue,
    observacao: b.observacao,
    aviamentos_enviados: b.aviamentos_enviados,
    tecidos_enviados: b.tecidos_enviados,
    // Etapas PL (Fase 1): só faz sentido pra bloco PL, mas grava sempre (interno fica null
    // nos 3 — mesmo padrão de empresa_id/representante_id acima).
    pt_data_saida: b.interno ? null : b.pt_data_saida,
    pt_data_entrada: b.interno ? null : b.pt_data_entrada,
    pt_aprovacao: b.interno ? null : b.pt_aprovacao,
    nf_saida: b.interno ? [] : b.nf_saida,
    nf_entrada: b.interno ? [] : b.nf_entrada,
    peca_foto: b.interno ? false : b.peca_foto,
    peca_foto_data: b.interno ? null : b.peca_foto_data,
  };
}
export type BlocoPayload = ReturnType<typeof blocoParaPayload>;

// Campos editáveis pela edição rápida do card de Etapas PL.
export type CampoRapido = "pt_data_saida" | "pt_data_entrada" | "pt_aprovacao" | "data_enviado";

/** O serviço do card não existe mais no servidor (outra pessoa o excluiu): nada é gravado. `mensagemErro` devolve o texto. */
export class ServicoSumiuError extends RecusaEsperadaError {
  constructor() {
    super("Este serviço foi excluído por outra pessoa. O quadro foi atualizado.");
    this.name = "ServicoSumiuError";
  }
}

/**
 * Edição rápida (card de Etapas PL) = EXATAMENTE o que o sheet do PCP › Serviços mandaria para o CAD com só UM campo de UM
 * bloco alterado. `linhas` = TODAS as linhas de `producao_terceirizados` do CAD (select "*", lidas agora). Cada bloco passa por
 * `blocoDeLinha` → `blocoParaPayload` (as mesmas do sheet); o campo vai por cima só no bloco do card. `_rev_base` leva o `rev`
 * lido de CADA bloco: se alguém salvou o CAD entre a leitura e o RPC, o servidor recusa (P0409) e nada é gravado.
 *
 * Única diferença deliberada do sheet: linha com `ativo = false` (o sheet nem carrega, e por isso a apagaria) vai com
 * `ativo: false` — a edição rápida não apaga nem reativa nada que não é dela.
 *
 * Nunca manda a marca "apagar tudo": sem linhas, ou sem o bloco do card entre elas, lança `ServicoSumiuError`.
 */
export function montarPayloadEdicaoRapida(p: {
  linhas: readonly Record<string, unknown>[];
  blocoId: string;
  campo: CampoRapido;
  valor: string | null;
}): { _blocos: BlocoPayload[]; _rev_base: Record<string, number> } {
  if (!p.linhas.some((r) => r.id === p.blocoId)) throw new ServicoSumiuError();
  const _blocos = p.linhas.map((r) => {
    const b = blocoDeLinha(r);
    const editado = r.id === p.blocoId ? { ...b, [p.campo]: p.valor } : b;
    return { ...blocoParaPayload(editado), ativo: r.ativo !== false };
  });
  const _rev_base = Object.fromEntries(
    p.linhas.filter((r) => r.id).map((r) => [r.id as string, Number(r.rev ?? 0)]),
  );
  return { _blocos, _rev_base };
}
