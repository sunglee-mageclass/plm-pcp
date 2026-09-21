// Registro dos descritores de importação ATIVOS. O piloto tem só Tecido; Aviamento/Insumo/
// Produto entram aqui à medida que cada descritor + RPC ficam prontos (fases 2-4 do plano).
// A página de Importar Dados e o template iteram sobre esta lista — nada mais muda.

import type { EntityImportDescriptor } from "./types";
import { tecidoDescriptor } from "./entities/tecido.descriptor";

export const DESCRIPTORS: EntityImportDescriptor[] = [
  tecidoDescriptor,
  // aviamentoDescriptor,  // Fase 2
  // insumoDescriptor,     // Fase 3
  // produtoDescriptor,    // Fase 4
];

export function descriptorPorEntidade(entidade: string): EntityImportDescriptor | undefined {
  return DESCRIPTORS.find((d) => d.entidade === entidade);
}
