// [camada C2] Textos das confirmações "Tem certeza?" APROVADOS pelo dono (P-263 A / P-262 A / P-265 A / P-267 A).
// Fonte: `.superpowers/sdd/2026-10-05-camada/c2-textos.md` (Seções 1, 3 e 4). Os textos entram AQUI como foram escritos;
// só os marcadores {entre chaves} são preenchidos com dado que a tela JÁ TEM à mão. Sem o dado, vale a versão SEM ele
// (nenhuma consulta nova). Funções PURAS — o diálogo (`ConfirmarAcaoDialog`) só desenha o que elas devolvem.
//
// Regras do dono repetidas aqui (c2-textos.md): título em pergunta, nome entre aspas curvas “…”; botão de confirmar
// VERMELHO quando DESFAZ ou apaga, neutro quando refaz/reabre/ajusta; cancelar = "Cancelar" (ou "Voltar" quando o botão
// de confirmar já contém "Cancelar").

export interface TextoConfirmacao {
  titulo: string;
  descricao: string;
  confirmar: string;
  cancelar: string;
  destrutivo: boolean;
}

const presente = (v: string | number | null | undefined): v is string | number =>
  v !== null && v !== undefined && String(v).trim() !== "" && String(v).trim() !== "—";
const txt = (v: string | number | null | undefined): string => String(v ?? "").trim();
const aspas = (nome: string) => `“${nome}”`;

/** "2026-10-05" (ou ISO com hora) → "05/10/2026". Qualquer outra coisa → null (a frase cai na versão sem a data). */
export function dataBr(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** Quantidade em pt-BR, sem forçar casas ("10", "10,5", "1.234,25"). */
function qtdBr(v: string | number | null | undefined): string {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return txt(v);
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Tipo da OC como a frase pede ("da {tipo da OC} Nº …"): "OC de Tecido", "OC de Produto Acabado"… */
export function tipoOcFrase(tipo: string | null | undefined): string {
  switch (tipo) {
    case "tecido":
      return "OC de Tecido";
    case "aviamento":
      return "OC de Aviamento";
    case "etiqueta":
      return "OC de Insumo";
    case "p_acabado":
      return "OC de Produto Acabado";
    case "p_importado":
      return "OC de Produto Importado";
    default:
      return presente(tipo) ? String(tipo) : "OC";
  }
}

const CANCELAR = "Cancelar";
const VOLTAR = "Voltar";

// ---------------------------------------------------------------------------------------------------------------------
// Seção 1 — ações que DESFAZEM
// ---------------------------------------------------------------------------------------------------------------------

/** 1.1 Cancelar lançamento (Sheet do card e foguete do card — 2 botões, 1 diálogo). */
export function textoCancelarLancamento(a: {
  nome?: string | null;
  ref?: string | null;
  dataLancamento?: string | null;
}): TextoConfirmacao {
  const data = dataBr(a.dataLancamento);
  const modelo = presente(a.ref) ? `O modelo ${txt(a.ref)}` : "O modelo";
  return {
    titulo: presente(a.nome)
      ? `Cancelar o lançamento de ${aspas(txt(a.nome))}?`
      : "Cancelar o lançamento deste modelo?",
    descricao:
      `${modelo} deixa de constar como lançado e sai da contagem de Lançados nos dashboards. ` +
      `A data de lançamento${data ? ` (${data})` : ""} é mantida e dá para lançar de novo depois.`,
    confirmar: "Cancelar lançamento",
    cancelar: VOLTAR,
    destrutivo: true,
  };
}

/** 1.2 Desmarcar CQ Pré (cascata do servidor). */
export function textoDesmarcarCqPre(a: { nome?: string | null }): TextoConfirmacao {
  return {
    titulo: presente(a.nome)
      ? `Desmarcar a confirmação do CQ de ${aspas(txt(a.nome))}?`
      : "Desmarcar a confirmação do CQ deste modelo?",
    descricao:
      "O CQ volta para pendente e pode ser editado. Junto com ele, voltam para pendente o CQ Pós e o Direcionamento " +
      "(se já estavam confirmados), e a Grade Real volta ao valor planejado. Se o modelo já estava lançado, deixa de " +
      "estar lançado e a etapa Lançamento acende #Erro. Serviços e contas a pagar não são apagados.",
    confirmar: "Desmarcar CQ",
    cancelar: CANCELAR,
    destrutivo: true,
  };
}

/** 1.3 Desmarcar CQ Pós. */
export function textoDesmarcarCqPos(a: { nome?: string | null }): TextoConfirmacao {
  return {
    titulo: presente(a.nome)
      ? `Desmarcar a confirmação do CQ Pós de ${aspas(txt(a.nome))}?`
      : "Desmarcar a confirmação do CQ Pós deste modelo?",
    descricao:
      "O CQ Pós volta para pendente e pode ser editado. O modelo deixa de estar liberado para Direcionamento e Lançar. " +
      "Se o Direcionamento já estava separado ele volta para pendente, e se o modelo já estava lançado deixa de estar " +
      "lançado (a etapa Lançamento acende #Erro). O CQ Pré não muda.",
    confirmar: "Desmarcar CQ Pós",
    cancelar: CANCELAR,
    destrutivo: true,
  };
}

/** 1.4 Desmarcar Direcionamento (editando e travado — mesmo diálogo). */
export function textoDesmarcarDirecionamento(a: { nome?: string | null }): TextoConfirmacao {
  return {
    titulo: presente(a.nome)
      ? `Desmarcar o Direcionamento de ${aspas(txt(a.nome))}?`
      : "Desmarcar o Direcionamento deste modelo?",
    descricao:
      "O Direcionamento deixa de estar confirmado (separado) e volta para pendente, podendo ser editado de novo. " +
      "As quantidades por loja já digitadas continuam salvas.",
    confirmar: "Desmarcar",
    cancelar: CANCELAR,
    destrutivo: true,
  };
}

/** 1.5 Desconfirmar coleção (OTB, orçamento). */
export function textoDesconfirmarColecaoOrcamento(a: { nome?: string | null }): TextoConfirmacao {
  return {
    titulo: presente(a.nome)
      ? `Desconfirmar a coleção ${aspas(txt(a.nome))}?`
      : "Desconfirmar esta coleção?",
    descricao:
      "A coleção volta para rascunho e pode ser editada de novo. Os cards já criados no Planejamento continuam como estão.",
    confirmar: "Desconfirmar",
    cancelar: CANCELAR,
    destrutivo: true,
  };
}

/** 1.6 Desconfirmar coleção (OTB, Poder de Venda). */
export function textoDesconfirmarColecaoPV(a: { nome?: string | null }): TextoConfirmacao {
  return {
    titulo: presente(a.nome)
      ? `Desconfirmar a coleção ${aspas(txt(a.nome))}?`
      : "Desconfirmar esta coleção?",
    descricao:
      "A coleção volta para rascunho e pode ser editada de novo. Os cards já criados no Planejamento continuam como estão; " +
      "ao confirmar outra vez, os cards em branco são conferidos com o plano.",
    confirmar: "Desconfirmar",
    cancelar: CANCELAR,
    destrutivo: true,
  };
}

/** 1.7 Desmarcar pago — parcela de OC (detalhe e lista). `total` (nº de parcelas) não vem na linha: sem ele, só "parcela n". */
export function textoDesmarcarPagoOc(a: {
  numeroParcela?: number | string | null;
  totalParcelas?: number | string | null;
  valor?: number | string | null;
  tipoOc?: string | null;
  numeroOc?: string | null;
  dataPagamento?: string | null;
  formatarValor?: (v: number | string | null | undefined) => string;
}): TextoConfirmacao {
  const fmt = a.formatarValor ?? ((v) => String(v ?? ""));
  const parcela = presente(a.numeroParcela)
    ? `${txt(a.numeroParcela)}${presente(a.totalParcelas) ? `/${txt(a.totalParcelas)}` : ""}`
    : null;
  const data = dataBr(a.dataPagamento);
  const oc = `${tipoOcFrase(a.tipoOc)}${presente(a.numeroOc) ? ` Nº ${txt(a.numeroOc)}` : ""}`;
  const sujeito = `A parcela${parcela ? ` ${parcela}` : ""}${presente(a.valor) ? ` de ${fmt(a.valor)}` : ""} da ${oc}`;
  return {
    titulo: "Desmarcar o pagamento desta parcela?",
    descricao:
      `${sujeito} volta para “a pagar” e a data de pagamento${data ? ` (${data})` : ""} é apagada. ` +
      "O comprovante continua anexado.",
    confirmar: "Desmarcar pagamento",
    cancelar: CANCELAR,
    destrutivo: true,
  };
}

/** 1.8 Desmarcar pago — parcela de Serviço (lista e detalhe). */
export function textoDesmarcarPagoServico(a: {
  numeroParcela?: number | string | null;
  servico?: string | null;
  ref?: string | null;
  valor?: number | string | null;
  dataPagamento?: string | null;
  formatarValor?: (v: number | string | null | undefined) => string;
}): TextoConfirmacao {
  const fmt = a.formatarValor ?? ((v) => String(v ?? ""));
  const data = dataBr(a.dataPagamento);
  const sujeito =
    `A parcela${presente(a.numeroParcela) ? ` ${txt(a.numeroParcela)}` : ""}` +
    `${presente(a.servico) ? ` do serviço ${aspas(txt(a.servico))}` : ""}` +
    `${presente(a.ref) ? ` (${txt(a.ref)})` : ""}` +
    `${presente(a.valor) ? ` de ${fmt(a.valor)}` : ""}`;
  return {
    titulo: "Desmarcar o pagamento deste serviço?",
    descricao:
      `${sujeito} volta para “a pagar” e a data de pagamento${data ? ` (${data})` : ""} é apagada. ` +
      "O valor pago registrado deixa de valer e a parcela volta a entrar no cálculo do saldo. O comprovante continua anexado.",
    confirmar: "Desmarcar pagamento",
    cancelar: CANCELAR,
    destrutivo: true,
  };
}

/** Trecho "{código} ({variante})" do rolo; cada parte só entra se existir. */
function rotuloRolo(codigo?: string | null, variante?: string | null): string {
  return `${presente(codigo) ? ` ${txt(codigo)}` : ""}${presente(variante) ? ` (${txt(variante)})` : ""}`;
}
const daOc = (numeroOc?: string | null) => (presente(numeroOc) ? ` da OC ${txt(numeroOc)}` : "");

/** 1.9 Cancelar rolo (recebimento da OC de Tecido). */
export function textoCancelarRolo(a: {
  codigo?: string | null;
  variante?: string | null;
  numeroOc?: string | null;
}): TextoConfirmacao {
  return {
    titulo: "Cancelar este rolo?",
    descricao:
      `O rolo${rotuloRolo(a.codigo, a.variante)}${daOc(a.numeroOc)} sai do estoque e do consumo, e o valor da OC é recalculado. ` +
      "Dá para reverter reabrindo o rolo nesta mesma tela.",
    confirmar: "Cancelar rolo",
    cancelar: VOLTAR,
    destrutivo: true,
  };
}

/** 1.10 Reabrir rolo. */
export function textoReabrirRolo(a: {
  codigo?: string | null;
  variante?: string | null;
  numeroOc?: string | null;
}): TextoConfirmacao {
  return {
    titulo: "Reabrir este rolo?",
    descricao: `O rolo${rotuloRolo(a.codigo, a.variante)}${daOc(a.numeroOc)} volta ao estoque e ao consumo, e o valor da OC é recalculado.`,
    confirmar: "Reabrir rolo",
    cancelar: CANCELAR,
    destrutivo: false,
  };
}

/** 1.11 Ajustar a quantidade de um rolo já criado. */
export function textoAjustarQtdRolo(a: {
  codigo?: string | null;
  qtdAtual?: string | number | null;
  qtdNova?: string | number | null;
  unidade?: string | null;
}): TextoConfirmacao {
  const un = presente(a.unidade) ? ` ${txt(a.unidade)}` : "";
  const muda =
    presente(a.qtdAtual) && presente(a.qtdNova)
      ? `muda de ${qtdBr(a.qtdAtual)} para ${qtdBr(a.qtdNova)}${un}`
      : presente(a.qtdNova)
        ? `muda para ${qtdBr(a.qtdNova)}${un}`
        : "muda";
  return {
    titulo: "Ajustar a quantidade do rolo?",
    descricao:
      `A quantidade do rolo${presente(a.codigo) ? ` ${txt(a.codigo)}` : ""} ${muda}. ` +
      "O estoque do lote de origem e o valor da OC são recalculados.",
    confirmar: "Ajustar quantidade",
    cancelar: CANCELAR,
    destrutivo: false,
  };
}

/** 1.12 Recalcular parcelas (troca o `confirm()` do navegador). */
export function textoRecalcularParcelas(a: {
  tipoOc?: string | null;
  numeroOc?: string | null;
}): TextoConfirmacao {
  const oc = `${tipoOcFrase(a.tipoOc)}${presente(a.numeroOc) ? ` Nº ${txt(a.numeroOc)}` : ""}`;
  return {
    titulo: "Recalcular as parcelas desta OC?",
    descricao:
      `As parcelas pagas são preservadas e as demais são regeradas com os valores atuais da ${oc}. ` +
      "Datas de vencimento ajustadas à mão são mantidas.",
    confirmar: "Recalcular",
    cancelar: CANCELAR,
    destrutivo: false,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Seção 3 — Apagar tudo (P-262 A). N = linhas que EXISTEM no servidor (as que seriam apagadas), não as do rascunho.
// ---------------------------------------------------------------------------------------------------------------------

/** 3 — PCP › Serviços. */
export function textoApagarTodosServicos(a: { n: number; nome?: string | null }): TextoConfirmacao {
  const um = a.n === 1;
  const alvo = presente(a.nome) ? `de ${aspas(txt(a.nome))}` : "deste modelo";
  return {
    titulo: um ? `Apagar o único serviço ${alvo}?` : `Apagar todos os ${a.n} serviços ${alvo}?`,
    descricao:
      "Você removeu todos os serviços deste modelo. " +
      (um
        ? "Ao salvar, o serviço (datas, quantidades, valores e as contas a pagar ligadas a ele) será apagado. "
        : `Ao salvar, os ${a.n} serviços (datas, quantidades, valores e as contas a pagar ligadas a eles) serão apagados. `) +
      "Isso não pode ser desfeito.",
    confirmar: "Apagar todos",
    cancelar: CANCELAR,
    destrutivo: true,
  };
}

export type FamiliaOcApagar = "tecido" | "aviamento" | "insumo";

/**
 * Como a OC chegou a ficar sem itens (só muda a 1ª frase do corpo):
 * - `removeu` (padrão): a pessoa tirou todas as linhas;
 * - `troca_fornecedor`: a lista foi esvaziada ao trocar o fornecedor (OC Insumo), sem clicar em remover;
 * - `sem_linha_valida`: ainda há linhas na tela, mas nenhuma completa o bastante para ir ao servidor (OC Tecido/Aviamento).
 */
export type MotivoOcSemItens = "removeu" | "troca_fornecedor" | "sem_linha_valida";

/** 3 — OC de Tecido / Aviamento / Insumo. */
export function textoApagarTodosItensOc(a: {
  familia: FamiliaOcApagar;
  n: number;
  numeroOc?: string | null;
  motivo?: MotivoOcSemItens;
}): TextoConfirmacao {
  const um = a.n === 1;
  const oc = presente(a.numeroOc) ? `da OC ${txt(a.numeroOc)}` : "desta OC";
  const plural = { tecido: "tecidos", aviamento: "aviamentos", insumo: "insumos" }[a.familia];
  const detalhe = {
    tecido: " (quantidades, preços e conferência de CQ)",
    aviamento: " (quantidades e preços)",
    insumo: "",
  }[a.familia];
  const abertura = {
    removeu: `Você removeu todos os ${plural} desta OC.`,
    troca_fornecedor: "A OC ficou sem itens (ao trocar o fornecedor).",
    sem_linha_valida: "A OC ficou sem itens válidos (as linhas que restam estão incompletas).",
  }[a.motivo ?? "removeu"];
  return {
    titulo: um ? `Apagar o único item ${oc}?` : `Apagar todos os ${a.n} itens ${oc}?`,
    descricao:
      `${abertura} ` +
      (um
        ? `Ao salvar, o item${detalhe} será apagado`
        : `Ao salvar, os ${a.n} itens${detalhe} serão apagados`) +
      " e o valor da OC fica zerado. A OC continua existindo, sem itens. Isso não pode ser desfeito.",
    confirmar: "Apagar todos",
    cancelar: CANCELAR,
    destrutivo: true,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Seção 4 — Etapas PL: "Reprovado" (P-265 A)
// ---------------------------------------------------------------------------------------------------------------------

/** 4.1 Reprovar a peça-teste no card do quadro de Etapas. */
export function textoReprovarPecaTeste(a: {
  nome?: string | null;
  ref?: string | null;
  empresa?: string | null;
}): TextoConfirmacao {
  const card = `O card${presente(a.ref) ? ` ${txt(a.ref)}` : ""}${presente(a.empresa) ? ` · ${txt(a.empresa)}` : ""}`;
  return {
    titulo: presente(a.nome)
      ? `Reprovar a peça-teste de ${aspas(txt(a.nome))}?`
      : "Reprovar a peça-teste deste modelo?",
    descricao:
      `${card} sai do quadro de Etapas. Para reabrir, abra o modelo em PCP › Serviços, vá em ` +
      "“PLs reprovadas na peça teste” e mude a Aprovação.",
    confirmar: "Reprovar",
    cancelar: CANCELAR,
    destrutivo: true,
  };
}
