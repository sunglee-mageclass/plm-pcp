// F4a T7 — o filtro de reprovados do Plan. Tecido (F2 D, `filtroStatus` default "sem_reprovado") SEGUE podando certo
// depois que a vaga COM card passou a mostrar o STATUS COMPLETO do kanban (T6). O T6 não mexeu em `reprovadoStatusSet`
// nem em `statusEfetivoDaVaga`/`slotPassaFiltroStatus`: reprovado = `ehReprovadoStatus` (Dev OU Planejamento), igual nos
// dois caminhos. Aqui: (a) a detecção do filtro e o selo do kanban concordam em TODA coluna; (b) a poda vale para a vaga
// SEM card (status da vaga, F2) e COM card (Dev ou Planejamento); (c) a fiação do Sheet segue (poda ANTES do render).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { slotPassaFiltroStatus, statusEfetivoDaVaga, ehReprovado, achatarSlotsVisiveis } from "@/lib/plan-tecido/calc";
import { ehReprovadoStatus } from "@/lib/reprovado";
import { etapaDoModelo } from "@/lib/kanban-auto-ui";
import { lerKanbanAutoConfig, boardDaLoja } from "@/lib/kanban-auto";
import { modeloKanbanDoEmbed } from "@/lib/kanban-card-selo";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";

const vaga = (o: Partial<PtSlot> = {}): PtSlot => ({ id: "s", slot_index: 0, modelo_id: null, materiais: [], ...o }) as PtSlot;
const CFG = lerKanbanAutoConfig(null);
// board com uma coluna custom de rótulo "Reprovado" (key ≠ "reprovado") p/ provar que a detecção olha a KEY gravada, como o filtro
const CFG_CUSTOM = lerKanbanAutoConfig({ status_kanban: [{ key: "em_modelagem", label: "Em Modelagem" }, { key: "reprovado", label: "Reprovado" }, { key: "aprovado", label: "Aprovado" }] });

describe("T7 — filtro de reprovados × status completo do kanban", () => {
  it("em TODA coluna do board: o selo diz 'reprovado' sse o filtro poda o card (mesmo predicado, sem drift)", () => {
    for (const cfg of [CFG, CFG_CUSTOM]) {
      for (const col of boardDaLoja(cfg)) {
        const dev = col.key;
        const reprovadoDoCard = ehReprovado(dev, null);
        const selo = etapaDoModelo(modeloKanbanDoEmbed({ origem: "interno", status_desenvolvimento: dev, ordem_criacao_enviada: true }), cfg);
        expect(selo.fase).toBe("kanban");
        expect(ehReprovadoStatus(selo.key, null), `coluna ${dev}`).toBe(reprovadoDoCard);
        // poda no modo padrão só do que o selo mostra como Reprovado
        expect(slotPassaFiltroStatus(vaga({ modelo_id: "m1" }), reprovadoDoCard, "sem_reprovado"), `coluna ${dev}`).toBe(!reprovadoDoCard);
        expect(slotPassaFiltroStatus(vaga({ modelo_id: "m1" }), reprovadoDoCard, "todos")).toBe(true);
      }
    }
  });

  it("reprovado pelo PLANEJAMENTO (coluna do kanban qualquer): continua podado — o selo do kanban não o 'salva'", () => {
    for (const dev of ["em_modelagem", "aprovado", null]) {
      const reprovadoDoCard = ehReprovado(dev, "reprovado");
      expect(reprovadoDoCard).toBe(true);
      expect(statusEfetivoDaVaga(vaga({ modelo_id: "m1" }), reprovadoDoCard)).toBe("reprovado");
      expect(slotPassaFiltroStatus(vaga({ modelo_id: "m1" }), reprovadoDoCard, "sem_reprovado")).toBe(false);
    }
  });

  it("card reprovado também com a Ordem de Criação ainda NÃO enviada (selo 'Planejamento') segue podado", () => {
    const selo = etapaDoModelo(modeloKanbanDoEmbed({ origem: "interno", status_desenvolvimento: null, ordem_criacao_enviada: false }), CFG);
    expect(selo.fase).toBe("planejamento");
    const reprovadoDoCard = ehReprovado(null, "reprovado");
    expect(slotPassaFiltroStatus(vaga({ modelo_id: "m1" }), reprovadoDoCard, "sem_reprovado")).toBe(false);
  });

  it("vaga SEM card (F2 intacta): o status da PRÓPRIA vaga decide; `reprovadoDoCard` nem conta", () => {
    expect(slotPassaFiltroStatus(vaga({ status: "reprovado" }), false, "sem_reprovado")).toBe(false);
    expect(slotPassaFiltroStatus(vaga({ status: "reprovado" }), true, "sem_reprovado")).toBe(false);
    expect(slotPassaFiltroStatus(vaga({ status: "pendente" }), true, "sem_reprovado")).toBe(true);
    expect(slotPassaFiltroStatus(vaga({}), false, "sem_reprovado")).toBe(true);
    expect(slotPassaFiltroStatus(vaga({ status: "reprovado" }), false, "todos")).toBe(true);
  });

  it("a poda não perturba os índices (li/sli) da árvore completa — mistura de vaga sem card e com card reprovado", () => {
    const arvore = {
      subcolecoes: [{ linhas: [{ slots: [
        vaga({ id: "a", status: "reprovado" }),             // sem card, reprovada
        vaga({ id: "b", modelo_id: "m-rep" }),              // com card reprovado
        vaga({ id: "c", modelo_id: "m-ok" }),               // com card ok
        vaga({ id: "d" }),                                  // sem card, pendente
      ] }] }],
    } as unknown as PtArvore;
    const reprovados = new Set(["m-rep"]);
    const visiveis = achatarSlotsVisiveis(arvore, (s) => slotPassaFiltroStatus(s, s.modelo_id ? reprovados.has(s.modelo_id) : false, "sem_reprovado"));
    expect(visiveis.map((f) => [f.slot.id, f.sli])).toEqual([["c", 2], ["d", 3]]);
  });
});

describe("T7 — fiação do Sheet (asserção de fonte): a poda segue ANTES do render e usa o `reprovadoStatusSet`", () => {
  const sheet = readFileSync("src/components/plan-tecido/PlanTecidoSheet.tsx", "utf8");
  it("`reprovadoStatusSet` vem de `ehReprovado(dev, plan)` sobre os modelos e alimenta `passaStatus`", () => {
    expect(sheet).toMatch(/const reprovadoStatusSet = useMemo\(\s*\(\) => new Set\(\(\(modelosDb \?\? \[\]\) as ModeloStatus\[\]\)\.filter\(\(m\) => ehReprovado\(m\.status_desenvolvimento, m\.status_planejamento\)\)/);
    expect(sheet).toMatch(/const passaStatus = \(slot: PtSlot\) => slotPassaFiltroStatus\(slot, slot\.modelo_id \? reprovadoStatusSet\.has\(slot\.modelo_id\) : false, filtroStatus\)/);
  });
  it("o card (e o selo do kanban) só é montado para o que PASSA o filtro: `flat` vem de `flatStatus.filter(passaStatus)` e o Modo Plano usa `slotVisivel`", () => {
    expect(sheet).toMatch(/\.filter\(\(f\) => passaStatus\(f\.slot\)\)/);
    expect(sheet).toMatch(/slotVisivel=\{\(sl\) => passaStatus\(sl\) && passaLinha\(sl\)/);
  });
  it("o modo padrão do filtro segue `sem_reprovado`", () => {
    expect(sheet).toMatch(/useState<"todos" \| "sem_reprovado">\("sem_reprovado"\)/);
  });
});
