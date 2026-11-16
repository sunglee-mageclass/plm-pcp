// Status do Armário e trava de edição. Espelha a guarda do servidor (RPC FOR UPDATE + gatilho). Lib pura.

export type ArmarioStatus = "rascunho" | "pronto" | "publicado";

const VALIDAS: Record<ArmarioStatus, readonly ArmarioStatus[]> = {
  rascunho: ["pronto"],
  pronto: ["rascunho", "publicado"],
  publicado: ["pronto"],
};

/** rascunho↔pronto, pronto↔publicado, publicado→pronto. Qualquer outra (inclui mesmo→mesmo) é inválida. */
export function transicaoValida(de: ArmarioStatus, para: ArmarioStatus): boolean {
  return VALIDAS[de]?.includes(para) ?? false;
}

/** Armário publicado tem edição travada (itens/nome). */
export function armarioTravado(status: ArmarioStatus): boolean {
  return status === "publicado";
}
