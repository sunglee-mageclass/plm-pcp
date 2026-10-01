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

export function decidirStatusServidor(p: { atual: string; fresco: string; temEdicao: boolean }): DecisaoStatusServidor {
  const { atual, fresco, temEdicao } = p;
  if (fresco === atual) return { status: atual, manterEdicao: false, rebaselinar: false, aviso: null };
  if (temEdicao) {
    return {
      status: fresco,
      manterEdicao: true,
      rebaselinar: false,
      aviso: `O CQ foi alterado por outra tela (agora: ${rotulo(fresco)}). Suas alterações continuam aqui — revise antes de salvar.`,
    };
  }
  const aviso = fresco === "pendente"
    ? "O CQ voltou para pendente (a grade real mudou no PCP ou o Pré foi desmarcado)."
    : `O CQ foi alterado por outra tela (agora: ${rotulo(fresco)}).`;
  return { status: fresco, manterEdicao: false, rebaselinar: true, aviso };
}
