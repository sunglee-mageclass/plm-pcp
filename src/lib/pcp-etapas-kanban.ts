import { etapaDoBloco, ETAPA_FINALIZADO, type BlocoEtapa, type EtapaCfg, type EtapaKey } from "@/lib/pcp-etapas";
import { isServicoPL } from "@/lib/servico-confeccao";

// Linha de `producao_terceirizados` como vem do embed do Supabase (ver useEtapasCards).
type BlocoRow = {
  id: string;
  ativo?: boolean | null;
  interno?: boolean | null;
  categoria_terceirizado_id: string;
  categorias_terceirizado?: { nome?: string | null } | null;
  empresa?: { nome_fantasia?: string | null } | null;
  pt_data_saida: string | null;
  pt_data_entrada: string | null;
  pt_aprovacao: "aprovado" | "reprovado" | null;
  data_enviado: string | null;
  data_entregue: string | null;
  quantidade_recebida: number | null;
  grade_detalhe?: BlocoEtapa["grade_detalhe"];
};

type CadRow = {
  id: string;
  enviado_corte?: boolean | null;
  producao_terceirizados?: BlocoRow[] | null;
};

export type ModeloRow = {
  id: string;
  ref: string | null;
  nome: string | null;
  fotos_modelo?: string[] | null;
  desenho_tecnico_url?: string | null;
  croqui_url?: string | null;
  /** `modelos.lancado` — modelo lançado (fonte única de "Lançado"). Quando true, o card
   *  vai SÓ pra coluna terminal sintética "Finalizado" (sai do fluxo derivado). */
  lancado?: boolean | null;
  cad?: CadRow[] | null;
};

export type EtapaCard = {
  blocoId: string;
  cadId: string;
  modeloId: string;
  ref: string | null;
  nome: string | null;
  fotoFontes: (string | null)[];
  empresa: string | null;
  etapa: EtapaKey | null;
  bloco: BlocoEtapa & { categoria_terceirizado_id: string };
};

/** Achata modelos → blocos PL (só serviço PL, não-interno, ativo) → 1 card por bloco, com a
 * etapa calculada por `etapaDoBloco`. Reprovadas são EXCLUÍDAS do kanban (não viram card). */
export function montarCards(rows: ModeloRow[], etapas: EtapaCfg[]): EtapaCard[] {
  const cards: EtapaCard[] = [];
  for (const modelo of rows) {
    const cad = modelo.cad?.[0];
    if (!cad || cad.enviado_corte !== true) continue;
    for (const t of cad.producao_terceirizados ?? []) {
      if (t.ativo === false) continue;
      if (t.interno) continue;
      if (!isServicoPL(t.categorias_terceirizado?.nome ?? "")) continue;

      const bloco: BlocoEtapa = {
        pt_data_saida: t.pt_data_saida,
        pt_data_entrada: t.pt_data_entrada,
        pt_aprovacao: t.pt_aprovacao,
        data_enviado: t.data_enviado,
        data_entregue: t.data_entregue,
        qtd_recebida: t.quantidade_recebida,
        grade_detalhe: t.grade_detalhe ?? null,
      };
      const { key, reprovada } = etapaDoBloco(bloco, etapas);
      if (reprovada) continue;

      // Override derivado (Task 3): modelo lançado (`modelos.lancado===true`) sai do fluxo
      // normal e vai SÓ pra coluna terminal sintética "Finalizado". Feito AQUI (não em
      // `etapaDoBloco`, que é a derivação PURA por bloco) porque só `montarCards` conhece o
      // modelo. Se `lancado` voltar a false, o card volta à etapa derivada por bloco.
      const etapaFinal: EtapaKey | null = modelo.lancado === true ? ETAPA_FINALIZADO : key;

      cards.push({
        blocoId: t.id,
        cadId: cad.id,
        modeloId: modelo.id,
        ref: modelo.ref,
        nome: modelo.nome,
        fotoFontes: [modelo.fotos_modelo?.[0] ?? null, modelo.desenho_tecnico_url ?? null, modelo.croqui_url ?? null],
        empresa: t.empresa?.nome_fantasia ?? null,
        etapa: etapaFinal,
        bloco: { ...bloco, categoria_terceirizado_id: t.categoria_terceirizado_id },
      });
    }
  }
  return cards;
}
