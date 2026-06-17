// Fuso horário padrão da loja (GMT-3, São Paulo).
// TODO: futuramente virá da configuração da loja (editável por admin da loja /
// super_admin). Por enquanto é uma constante usada pelo relógio do topo e pelos
// cálculos de prazo das OCs.
export const STORE_TIMEZONE = "America/Sao_Paulo";

// Data de "hoje" (yyyy-MM-dd) no fuso da loja — usada para comparar prazos de
// entrega, que são datas sem hora.
export function todayISOInStoreTZ(tz: string = STORE_TIMEZONE): string {
  // "en-CA" formata como yyyy-MM-dd.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}
