/**
 * R12 (P-385) — modo da aprovação automática de "Aprovação de custo" por versão (Config da Loja).
 * Coluna `tenant_config.aprovar_custo_auto_por_versao` (texto, CHECK no banco): 'nenhum' (padrão, desligado) | 'interno' (só produto que a
 * loja fabrica) | 'todos' (inclui revenda/importado, cujo custo é digitado à mão). A regra roda no SERVIDOR; aqui só a lista e a leitura segura.
 */
export type ModoAprovarCustoAuto = "nenhum" | "interno" | "todos";

export const MODOS_APROVAR_CUSTO_AUTO: ReadonlyArray<{ value: ModoAprovarCustoAuto; label: string }> = [
  { value: "nenhum", label: "Nenhum" },
  { value: "interno", label: "Só produtos internos" },
  { value: "todos", label: "Todos (inclui revenda e importado)" },
];

/** Valor cru do servidor (ou do Select) → modo válido; qualquer outra coisa (null, undefined, texto desconhecido) cai em 'nenhum'. */
export function modoAprovarCustoAutoDoServidor(v: unknown): ModoAprovarCustoAuto {
  return v === "interno" || v === "todos" ? v : "nenhum";
}
