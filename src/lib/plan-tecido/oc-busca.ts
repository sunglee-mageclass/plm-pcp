import { semAcento } from "@/lib/busca";

/** Campos mínimos p/ a busca ÚNICA (nº da OC + fornecedor + tecidos) nas superfícies de
 * "vincular OC/Rolo" do Plan. Tecido (combobox do card + picker do Resumo/Paleta). */
export type OcBuscavel = {
  numero_pedido: string | null;
  fornecedor?: string | null;
  tecidos: string[];
};

/** Texto normalizado (sem acento/caixa) usado tanto como `value` do `CommandItem` (filtro do
 * combobox) quanto na busca client-side do picker por checkbox — fonte única, não duplicar a
 * concatenação nº/fornecedor/tecidos em cada tela. */
export function ocSearchValue(oc: OcBuscavel): string {
  return semAcento(`${oc.numero_pedido ?? ""} ${oc.fornecedor ?? ""} ${oc.tecidos.join(" ")}`.trim());
}
