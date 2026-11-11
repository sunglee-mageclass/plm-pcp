// Integração + API — abas por papel (v4, dono 26/set 20h4x): Produtos e Log = admin da loja + permissão "Integração";
// Campos da API, API e Manual da API = SÓ super admin (as abas nem aparecem; o servidor recusa as RPCs delas).
// Exportar dados = mesmo público de Produtos/Log; o acesso real é da RPC exportar_produtos (`_integracao_exige(false)`).
export type Aba = "produtos" | "campos" | "api" | "manual" | "log" | "exportar";
export const ROTULO_ABA: Record<Aba, string> = {
  produtos: "Produtos", campos: "Campos da API", api: "API", manual: "Manual da API", log: "Log", exportar: "Exportar dados",
};
export function abasVisiveis(superAdmin: boolean): Aba[] {
  return superAdmin ? ["produtos", "campos", "api", "manual", "log", "exportar"] : ["produtos", "log", "exportar"];
}
