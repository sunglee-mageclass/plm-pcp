// Helpers PUROS do detalhe do Planejamento (sem JSX e sem hooks). Extraídos na F3.0 (set/2026) de
// `PlanejamentoDetail.tsx` SEM mudança de comportamento: texto MOVIDO como estava (só ganhou
// `export`). A F3.1 acrescenta em ROTULO_CONFLITO_PLAN os rótulos dos campos novos.
import { useQueryClient } from "@tanstack/react-query";
import { type CustoSimInput } from "@/lib/preco";

// Colab round 4 (padrão do piloto/Desenvolvimento) — rótulos PT dos paths do Draft p/ o
// banner de resolução genérica de conflito. O merge compara TODAS as chaves do Draft; path
// sem rótulo cai no fallback (o próprio path) — nunca fica sem saída no banner.
const ROTULO_CONFLITO_PLAN: Record<string, string> = {
  nome: "Nome do Modelo", estilista_id: "Estilista", linha_id: "Linha",
  colecao: "Coleção", colecao_id: "Coleção", subcolecao: "Subcoleção", semana: "Semana de Lançamento",
  mes_id: "Mês de Planejamento", ano_id: "Ano",
  categoria_principal_id: "Categoria", subcategoria1_id: "Subcategoria 1", subcategoria2_id: "Subcategoria 2",
  origem: "Origem", preco_venda: "Preço para venda", preco_atacado: "Preço atacado", markup_editado: "Markup aplicado", data_lancamento: "Data de Lançamento",
  tecidos_planejados: "Tecido Planejado", status_planejamento: "Status",
  croqui_url: "Foto do Croqui", desenho_tecnico_url: "Desenho Técnico",
  fotos_modelo: "Fotos do modelo", fotos_referencia: "Fotos de referência",
  observacoes_gerais: "Observações Gerais", observacoes_mao_obra: "Obs. Mão de obra",
  versao: "Versão", modelo_base_id: "Modelo base", custo_simulado: "Simulação de custo",
};
export function rotuloConflitoPlan(path: string): string {
  return ROTULO_CONFLITO_PLAN[path] ?? path;
}

// Normaliza a simulação de custo p/ salvar: só valores > 0; se tudo vazio → null.
// preco_tecido_m NÃO é gravado (é derivado do Tecido Planejado mais caro); consumo_tecido
// aqui é só o OVERRIDE manual (quando nulo, a tela usa o consumo real do BOM).
export function limparCustoSim(s: CustoSimInput | null | undefined): CustoSimInput | null {
  const n = (v: any) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null; };
  const out: CustoSimInput = {
    consumo_tecido: n(s?.consumo_tecido),
    aviamento: n(s?.aviamento),
    mao_obra: n(s?.mao_obra),
  };
  return Object.values(out).some((v) => v != null) ? out : null;
}

// MO por serviço: invalidations padrão após aprovar/reprovar POR SERVIÇO (`aprovar_servico_mo`,
// spec 2026-08-11 Task 2). Compartilhada entre o editor do detalhe (aprovação de dentro do card
// aberto, aqui) e a seção expandida da lista (`ModeloCard` via `PlanejamentoPage`) sem duplicar
// a lista de queryKeys entre as duas mutations.
export function invalidarAposAprovarMO(qc: ReturnType<typeof useQueryClient>, modeloId: string) {
  // Re-sincroniza a rev do colab (o rollup no banco bumpa `modelos.rev`) — sem isto o próximo
  // Salvar do card compara `.eq('rev', revRef)` desatualizado e dá P0409 falso.
  qc.invalidateQueries({ queryKey: ["modelo", modeloId] });
  qc.invalidateQueries({ queryKey: ["mo-resumo", modeloId] });
  qc.invalidateQueries({ queryKey: ["plan-custo-unit", modeloId] });
  qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
  qc.invalidateQueries({ queryKey: ["mo-resumo-list"] });
  // Cross-invalidation (bidirecionalidade c/ o Desenvolvimento, spec 2026-08-11): sem isto o
  // Dev não ficava sabendo de aprovações feitas aqui sem refetch manual.
  qc.invalidateQueries({ queryKey: ["modelo-mo-resumo"] });
  // Reprovar MO pode REGREDIR o card no kanban (Fase 2) — refresca o board de Desenvolvimento.
  qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
}
