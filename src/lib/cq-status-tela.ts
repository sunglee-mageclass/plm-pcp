// Tela do CQ — status vindo do SERVIDOR (R14 / M1 do review R13; M-A/M-C do review R14).
// O `status` da tela NÃO é um campo de rascunho: só muda pelas ações Confirmar/Desmarcar (que já o gravam na mão ao
// terminar) ou pelo servidor — o PCP zerando a grade (P-192 A) ou o Pré desmarcado (prod #5) REBAIXAM o CQ para
// "pendente" em outra tela/aba; outra pessoa pode também CONFIRMAR. A tela sempre adota o status fresco, mas NUNCA em
// silêncio e NUNCA às custas de um rascunho não salvo (ver `decidirStatusServidor`).
export type StatusCq = "pendente" | "confirmado" | (string & {});

/** Status do CQ a partir da linha de `controle_qualidade` (sem linha ou sem status = "pendente"). */
export function statusCqDe(row: { status?: string | null } | null | undefined): string {
  return row?.status ?? "pendente";
}

/** Decisão (pura) quando uma releitura do servidor traz um status diferente do que a tela mostra. */
export type DecisaoStatusServidor = {
  /** Status que a tela passa a mostrar. */
  status: string;
  /** true = mantém a edição ABERTA (`editing`) e o rascunho/selo/guarda — havia edição não salva. */
  manterEdicao: boolean;
  /** true = nada a preservar: re-baselina o "não salvo" (`resetBaseline`) para não sobrar falso "alterações não salvas". */
  rebaselinar: boolean;
  /** Mensagem PT-BR para toast; null = o status não mudou. */
  aviso: string | null;
};

const ROTULO: Record<string, string> = { pendente: "pendente", confirmado: "confirmado" };
const rotulo = (s: string) => ROTULO[s] ?? s;

export function decidirStatusServidor(p: { atual: string; fresco: string; temEdicao: boolean; nome?: string }): DecisaoStatusServidor {
  const { atual, fresco, temEdicao } = p;
  const nome = p.nome ?? "CQ"; // "CQ Pós" na visão Pós (N4)
  if (fresco === atual) return { status: atual, manterEdicao: false, rebaselinar: false, aviso: null };
  if (temEdicao) {
    return {
      status: fresco,
      manterEdicao: true,
      rebaselinar: false,
      aviso: `O ${nome} foi alterado por outra tela (agora: ${rotulo(fresco)}). Suas alterações continuam aqui — revise antes de salvar.`,
    };
  }
  const aviso = fresco === "pendente"
    ? `O ${nome} voltou para pendente (a grade real mudou no PCP ou o Pré foi desmarcado).`
    : `O ${nome} foi alterado por outra tela (agora: ${rotulo(fresco)}).`;
  return { status: fresco, manterEdicao: false, rebaselinar: true, aviso };
}

/** Baseline do "não salvo" depois de um merge remoto SEM edição local (R14 N1): espelha EXATAMENTE as condições dos
 *  setters do merge — só troca form/grade quando o merge de fato os atualizou. Sem isso, com `temFonte = false`
 *  (`mg.valor` vazio) o baseline ganhava a grade zerada enquanto o state seguia com a de `cq_variantes` => falso "não salvo". */
export function baselineAposMerge<F, G>(p: {
  formMexeu: boolean; gradeMexeu: boolean; formMesclado: F; formAtual: F; gradesAtuais: G; aplicarGrade: () => G;
}): { form: F; grades: G } {
  return {
    form: p.formMexeu ? p.formMesclado : p.formAtual,
    grades: p.gradeMexeu ? p.aplicarGrade() : p.gradesAtuais,
  };
}

/** R14 N6: a decisão de status do servidor é PULADA enquanto há ação local em voo. Se a ação falha com algo que não seja
 *  conflito de versão (P0409 — esse reconcilia por conta própria), o status remoto que chegou nesse meio-tempo ficou
 *  sem ser aplicado: precisa reler o CQ para o efeito reaplicá-lo. */
export function deveReaplicarStatusAposErro(e: unknown): boolean {
  return (e as { code?: string } | null | undefined)?.code !== "P0409";
}

/** R13: toast do Salvar do PCP. `antes`/`depois` = `controle_qualidade.status` lido ao redor da RPC (void). Só confirmado ->
 *  pendente é o rebaixamento (grade real zerada); leitura que falhou (null) cai no toast neutro. */
export function mensagemToastPosSavePcp(antes: string | null, depois: string | null): { rebaixou: boolean; texto: string } {
  if (antes === "confirmado" && depois === "pendente") return { rebaixou: true, texto: "O CQ voltou a pendente: a grade real zerou" };
  return { rebaixou: false, texto: "Salvo com sucesso" };
}

/** N6: no `onError` de uma ação local do CQ, relê a query do CQ quando o erro não é P0409 (reaplica o status remoto ignorado em voo). */
export function reaplicarStatusCqAposErro(e: unknown, qc: { invalidateQueries: (o: { queryKey: unknown[] }) => unknown }, queryKey: unknown[]): void {
  if (deveReaplicarStatusAposErro(e)) qc.invalidateQueries({ queryKey });
}

/** Flag de 1 leitura: devolve o valor e zera (nunca vira bypass permanente — B6). */
export function consumirFlag(ref: { current: boolean }): boolean {
  const v = ref.current;
  ref.current = false;
  return v;
}
