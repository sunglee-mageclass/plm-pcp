// Fuso horário padrão da loja (GMT-3, São Paulo). Usado como fallback quando a
// loja ainda não definiu um fuso na Configuração da Loja. O valor efetivo vem
// de tenant_config.timezone — ver useStoreTimezone().
export const STORE_TIMEZONE = "America/Sao_Paulo";

// Opções de fuso oferecidas na Configuração da Loja (cobre os fusos do Brasil).
// Guardamos o nome IANA (lida com horário de verão corretamente).
export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/Noronha", label: "Fernando de Noronha (GMT-2)" },
  { value: "America/Sao_Paulo", label: "Brasília / São Paulo (GMT-3)" },
  { value: "America/Manaus", label: "Manaus / Amazonas (GMT-4)" },
  { value: "America/Rio_Branco", label: "Rio Branco / Acre (GMT-5)" },
];

// Data de "hoje" (yyyy-MM-dd) no fuso da loja — usada para comparar prazos de
// entrega, que são datas sem hora.
export function todayISOInStoreTZ(tz: string = STORE_TIMEZONE): string {
  // "en-CA" formata como yyyy-MM-dd.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}
