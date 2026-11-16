// Integração + API — abas por papel (v4, dono 26/set 20h4x): Produtos e Log = admin da loja + permissão "Integração";
// Campos da API, API e Manual da API = SÓ super admin (as abas nem aparecem; o servidor recusa as RPCs delas).
export type Aba = "produtos" | "campos" | "api" | "manual" | "log";
export const ROTULO_ABA: Record<Aba, string> = {
  produtos: "Produtos", campos: "Campos da API", api: "API", manual: "Manual da API", log: "Log",
};
export function abasVisiveis(superAdmin: boolean): Aba[] {
  return superAdmin ? ["produtos", "campos", "api", "manual", "log"] : ["produtos", "log"];
}
