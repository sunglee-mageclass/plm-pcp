// Tela do CQ — status vindo do SERVIDOR (R14 / M1 do review R13).
// O `status` da tela NÃO é um campo de rascunho: só muda pelas ações Confirmar/Desmarcar (que já o gravam na mão ao
// terminar) ou pelo servidor — o PCP zerando a grade (P-192 A) ou o Pré desmarcado (prod #5) REBAIXAM o CQ para
// "pendente" em outra tela/aba. Por isso o merge/re-seed adotam sempre o status da linha fresca; não há "status
// tocado localmente e não salvo" a preservar (o merge de campos — mergeDraft — fica só para o form/grade).
export type StatusCq = "pendente" | "confirmado" | (string & {});

/** Status do CQ a partir da linha de `controle_qualidade` (sem linha ou sem status = "pendente"). */
export function statusCqDe(row: { status?: string | null } | null | undefined): string {
  return row?.status ?? "pendente";
}

/** Próximo status da tela depois de uma releitura do servidor: o do servidor; devolve o MESMO valor se já igual
 *  (evita re-render à toa no efeito de merge). */
export function statusCqAposServidor(atual: string, row: { status?: string | null } | null | undefined): string {
  const fresco = statusCqDe(row);
  return fresco === atual ? atual : fresco;
}
