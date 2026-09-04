// SSOT da semântica de `modelos.origem` — a "família de aquisição" de um card.
//
// Três valores (CHECK no banco: `modelos.origem in ('interno','revenda','importado')`):
//   - 'interno'    → peça FABRICADA pela loja (fluxo completo: tecido, CAD, MO, corte…)
//   - 'revenda'    → peça COMPRADA pronta de terceiro nacional pra revender (Produto Acabado)
//   - 'importado'  → peça COMPRADA pronta do exterior (Produto Importado; espelha revenda + câmbio)
//
// Revenda e importado são as duas origens COMPRADAS: não fabricam, então não têm tecido,
// mão de obra, nem corte — mas atravessam o MESMO fluxo pós-recebimento que a manufaturada
// (Desenvolvimento → Explosão → PCP → CQ → Direcionamento). Elas COMPARTILHAM a mesma config
// de fluxo ("comprado") em `revenda-config.ts` — ver [[project_produtos_importados]].
//
// Use `ehOrigemComprada(origem)` em TODO ponto cuja semântica é "comprado vs fabricado"
// (esconder tecido/MO/custo, filtro de entrada de CQ/Direcionamento, gate de liberação,
// kanban de comprado, cor/badge do card). NÃO troque por `=== 'revenda'` espalhado — quando
// uma 4ª origem comprada surgir, este helper é o único ponto a mudar.
//
// Para pontos ESPECÍFICOS de uma origem (ler `produtos_acabados` vs `produtos_importados`,
// rótulo "Revenda" vs "Importado"), continue distinguindo por valor — não é "comprado".

export type Origem = "interno" | "revenda" | "importado";

/** Normaliza para uma das 3 origens; ausente/desconhecido → 'interno' (fabricado, o default). */
export function normalizarOrigem(origem: string | null | undefined): Origem {
  return origem === "revenda" || origem === "importado" ? origem : "interno";
}

/** true se a peça é COMPRADA pronta (revenda ou importado) — não fabricada.
 *  Use onde a semântica é "comprado vs fabricado". */
export function ehOrigemComprada(origem: string | null | undefined): boolean {
  return origem === "revenda" || origem === "importado";
}

/** Rótulo humano da origem (campo read-only "Origem" no card). */
export function rotuloOrigem(origem: string | null | undefined): string {
  switch (normalizarOrigem(origem)) {
    case "revenda":
      return "Revenda";
    case "importado":
      return "Importado";
    default:
      return "Produção própria";
  }
}

/** Rótulo CURTO da origem p/ lanes de agrupamento (Interno × Revenda × Importado). */
export function rotuloOrigemLane(origem: string | null | undefined): string {
  switch (normalizarOrigem(origem)) {
    case "revenda":
      return "Revenda";
    case "importado":
      return "Importado";
    default:
      return "Interno";
  }
}
