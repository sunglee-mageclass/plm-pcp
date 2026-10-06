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
  data_enviado: string | null;
  data_entregue: string | null;
  quantidade_recebida: number | null;
  grade_detalhe?: BlocoEtapa["grade_detalhe"];
  // [urg R5] prazos p/ os alertas de atraso (serviço e peça de foto). Ausentes (select antigo) = sem prazo.
  data_prevista?: string | null;
  peca_foto?: boolean | null;
  peca_foto_previsao?: string | null;
  peca_foto_data?: string | null;
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
  origem?: string | null;
  cad?: CadRow[] | null;
};

/** [urg R5] Prazos crus do bloco; o cálculo do atraso (`atrasoServico`/`atrasoPecaFoto`) fica na tela, com o "hoje" do fuso da loja. */
export type PrazosCard = {
  data_prevista: string | null;
  data_entregue: string | null;
  peca_foto: boolean;
  peca_foto_previsao: string | null;
  peca_foto_data: string | null;
};

/** Campos comuns aos 2 tipos de card do quadro. `blocoId` é a CHAVE única do card (bloco: id do serviço; PT: `pt:<modeloId>`). */
type EtapaCardBase = {
  blocoId: string;
  modeloId: string;
  ref: string | null;
  nome: string | null;
  fotoFontes: (string | null)[];
  empresa: string | null;
  origem: string | null;
  etapa: EtapaKey | null;
};

/** Card de um BLOCO de serviço PL (só existe depois da Explosão). */
export type EtapaCardBloco = EtapaCardBase & {
  tipo: "bloco";
  cadId: string;
  bloco: BlocoEtapa & { categoria_terceirizado_id: string };
  prazos: PrazosCard;
  pecaTeste?: undefined;
};

/** [R9] Card da coluna "Peça Teste": 1 POR PRODUTO, vindo do card do produto (RPC `peca_teste_quadro`) — existe mesmo antes da
 *  Explosão. `bloco`/`prazos`/`cadId` não existem: tudo se edita no Sheet do Planejamento. */
export type EtapaCardPecaTeste = EtapaCardBase & {
  tipo: "peca_teste";
  pecaTeste: {
    status: "em_teste" | "aprovada";
    /** em teste: a MENOR data de saída entre as trilhas PL em teste; aprovada: null. */
    dataSaida: string | null;
    /** "Serviço · Fornecedor" das trilhas PL que mandam no status (em teste: as em teste; aprovada: todas as PL). */
    servicos: string[];
  };
  cadId?: undefined;
  bloco?: undefined;
  prazos?: undefined;
};

export type EtapaCard = EtapaCardBloco | EtapaCardPecaTeste;

/** Achata modelos → blocos PL (só serviço PL, não-interno, ativo) → 1 card por bloco, com a
 * etapa calculada por `etapaDoBloco`. [R9] `suprimir` = produtos com card de Peça Teste "em teste": os blocos deles NÃO aparecem
 * (o produto não duplica no quadro). A Peça Teste não é mais lida do bloco (`pt_*` ignoradas). */
export function montarCards(rows: ModeloRow[], etapas: EtapaCfg[], suprimir?: ReadonlySet<string>): EtapaCardBloco[] {
  const cards: EtapaCardBloco[] = [];
  for (const modelo of rows) {
    if (suprimir?.has(modelo.id)) continue;
    const cad = modelo.cad?.[0];
    if (!cad || cad.enviado_corte !== true) continue;
    for (const t of cad.producao_terceirizados ?? []) {
      if (t.ativo === false) continue;
      if (t.interno) continue;
      if (!isServicoPL(t.categorias_terceirizado?.nome ?? "")) continue;

      const bloco: BlocoEtapa = {
        data_enviado: t.data_enviado,
        data_entregue: t.data_entregue,
        qtd_recebida: t.quantidade_recebida,
        grade_detalhe: t.grade_detalhe ?? null,
      };
      const { key } = etapaDoBloco(bloco, etapas);

      // Override derivado (Task 3): modelo lançado (`modelos.lancado===true`) sai do fluxo
      // normal e vai SÓ pra coluna terminal sintética "Finalizado". Feito AQUI (não em
      // `etapaDoBloco`, que é a derivação PURA por bloco) porque só `montarCards` conhece o
      // modelo. Se `lancado` voltar a false, o card volta à etapa derivada por bloco.
      const etapaFinal: EtapaKey | null = modelo.lancado === true ? ETAPA_FINALIZADO : key;

      cards.push({
        tipo: "bloco",
        blocoId: t.id,
        cadId: cad.id,
        modeloId: modelo.id,
        ref: modelo.ref,
        nome: modelo.nome,
        fotoFontes: [modelo.fotos_modelo?.[0] ?? null, modelo.desenho_tecnico_url ?? null, modelo.croqui_url ?? null],
        empresa: t.empresa?.nome_fantasia ?? null,
        origem: modelo.origem ?? null,
        etapa: etapaFinal,
        bloco: { ...bloco, categoria_terceirizado_id: t.categoria_terceirizado_id },
        prazos: {
          data_prevista: t.data_prevista ?? null,
          data_entregue: t.data_entregue ?? null,
          peca_foto: t.peca_foto === true,
          peca_foto_previsao: t.peca_foto_previsao ?? null,
          peca_foto_data: t.peca_foto_data ?? null,
        },
      });
    }
  }
  return cards;
}

/** Item do RPC `peca_teste_quadro()` (1 por produto não lançado e não reprovado com trilha em teste/aprovada). `trilhas` traz TODAS as
 *  trilhas do produto que exigem peça teste (as demais com status "pendente"). O filtro "é PL" é DAQUI (`isServicoPL`). */
export type PecaTesteQuadroItem = {
  modelo_id: string;
  ref: string | null;
  nome: string | null;
  origem?: string | null;
  colecao?: string | null;
  fotos_fontes?: (string | null)[] | null;
  /** Existe CAD do produto enviado ao corte (Explosão feita). */
  explodido?: boolean | null;
  /** Defesa: o servidor já exclui os lançados. */
  lancado?: boolean | null;
  trilhas?: {
    categoria_nome?: string | null;
    empresa_nome?: string | null;
    status: "em_teste" | "aprovada" | "pendente";
    data_saida?: string | null;
  }[] | null;
};

/**
 * [R9] Cards da coluna "Peça Teste" (Ruling 20). 1 card por produto, só se a etapa `peca_teste` está ATIVA na config e olhando só as
 * trilhas de serviço PL (`isServicoPL`):
 *  - alguma trilha PL em teste → "em teste" (mostra a MENOR data de saída), antes OU depois da Explosão;
 *  - senão TODAS as PL aprovadas e produto ainda NÃO explodido → "Aprovada — aguardando Explosão" (depois da Explosão o produto sai da
 *    coluna e os blocos seguem as regras de sempre, começando em Separação);
 *  - fora disso (reprovada, trilha pendente, sem PL, lançado) não há card — a reprovada volta quando a nova tentativa ganha saída.
 */
export function montarCardsPecaTeste(rows: readonly PecaTesteQuadroItem[], etapas: EtapaCfg[]): EtapaCardPecaTeste[] {
  if (!etapas.some((e) => e.key === "peca_teste" && e.ativa)) return [];
  const cards: EtapaCardPecaTeste[] = [];
  for (const it of rows) {
    if (it.lancado === true) continue;
    const pl = (it.trilhas ?? []).filter((t) => isServicoPL(t.categoria_nome ?? ""));
    if (pl.length === 0) continue;

    const emTeste = pl.filter((t) => t.status === "em_teste");
    let status: "em_teste" | "aprovada";
    let mandam: typeof pl;
    if (emTeste.length > 0) {
      status = "em_teste";
      mandam = emTeste;
    } else if (pl.every((t) => t.status === "aprovada") && it.explodido !== true) {
      status = "aprovada";
      mandam = pl;
    } else continue;

    const saidas = status === "em_teste" ? mandam.map((t) => t.data_saida).filter((d): d is string => !!d).sort() : [];
    const servicos = Array.from(
      new Set(mandam.map((t) => [t.categoria_nome, t.empresa_nome].filter((x) => !!x && String(x).trim() !== "").join(" · "))),
    ).filter(Boolean);
    const ff = it.fotos_fontes ?? [];
    cards.push({
      tipo: "peca_teste",
      blocoId: `pt:${it.modelo_id}`,
      modeloId: it.modelo_id,
      ref: it.ref ?? null,
      nome: it.nome ?? null,
      fotoFontes: [ff[0] ?? null, ff[1] ?? null, ff[2] ?? null],
      empresa: mandam.find((t) => !!t.empresa_nome)?.empresa_nome ?? null,
      origem: it.origem ?? null,
      etapa: "peca_teste",
      pecaTeste: { status, dataSaida: saidas[0] ?? null, servicos },
    });
  }
  return cards;
}
