import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PANEL = readFileSync(ROOT + "src/components/desenvolvimento/ModeloDetailPanel.tsx", "utf8");
const PROVA = readFileSync(ROOT + "src/components/desenvolvimento/modelo-detail/ModeloAjustesProvaSection.tsx", "utf8");
const ANEXOS = readFileSync(ROOT + "src/components/desenvolvimento/modelo-detail/ModeloAnexosSection.tsx", "utf8");

// F5a review (M1, `.superpowers/sdd/2026-09-28-f5-dev-leitura/f5-review.md`): os handlers de
// Salvar/Enviar à Explosão/MO/Importar/uploads/Prova NÃO são exercitáveis via DOM em
// `f5-dev-somente-leitura.test.ts` porque, em modo só leitura, os BOTÕES que disparam esses
// handlers nem são renderizados (Salvar/Enviar/Importar/upload/Prova) — e o de MO tem um
// segundo gate (`podeAprovar={podeAprovarMaoObra && !somenteLeitura}`) que também nunca
// renderiza o botão, então nem seedar `modelo_servico_mo` ajudaria. A UI já prova (nos testes
// de DOM) que os controles não aparecem; este arquivo prova que a 2ª camada de defesa — a
// guarda `if (somenteLeitura) return/throw` DENTRO de cada handler — segue lá. Apagar QUALQUER
// uma dessas linhas (a defesa em profundidade que protegeria um botão reaparecido por engano
// numa mudança futura) faz um teste falhar aqui, sem depender de simular o clique.
describe("F5a — guarda de só leitura em CADA handler de escrita (M1 da revisão 28/set)", () => {
  it("persistModelo (Salvar/Enviar à Explosão): lança MSG_SOMENTE_LEITURA logo no início", () => {
    const inicio = PANEL.indexOf("const persistModelo = ");
    expect(inicio, "persistModelo não encontrado — arquivo mudou de forma?").toBeGreaterThanOrEqual(0);
    const corpo = PANEL.slice(inicio, inicio + 900);
    expect(corpo).toMatch(/if \(somenteLeitura\) throw new Error\(MSG_SOMENTE_LEITURA\);/);
  });

  it("handleSave: retorna sem chamar save.mutate", () => {
    const inicio = PANEL.indexOf("const handleSave = ()");
    expect(inicio).toBeGreaterThanOrEqual(0);
    const fim = PANEL.indexOf("};", inicio);
    const corpo = PANEL.slice(inicio, fim);
    expect(corpo).toMatch(/if \(somenteLeitura\) return;/);
  });

  it("onCopiar (Importar dados): retorna antes de aplicar o patch / gravar Observações do bloco", () => {
    const inicio = PANEL.indexOf("const onCopiar = ");
    expect(inicio).toBeGreaterThanOrEqual(0);
    const corpo = PANEL.slice(inicio, inicio + 300);
    expect(corpo).toMatch(/if \(somenteLeitura\) return;/);
  });

  it("enviarCad (Enviar à Explosão): mutationFn lança MSG_SOMENTE_LEITURA antes do persistModelo/RPC", () => {
    const inicio = PANEL.indexOf("const enviarCad = useMutation({");
    expect(inicio).toBeGreaterThanOrEqual(0);
    const corpo = PANEL.slice(inicio, inicio + 400);
    expect(corpo).toMatch(/if \(somenteLeitura\) throw new Error\(MSG_SOMENTE_LEITURA\);/);
  });

  it("aprovarServicoMO (Aprovar/Reprovar MO): mutationFn lança MSG_SOMENTE_LEITURA antes da RPC aprovar_servico_mo", () => {
    const inicio = PANEL.indexOf('const aprovarServicoMO = useMutation({');
    expect(inicio).toBeGreaterThanOrEqual(0);
    const rpcIdx = PANEL.indexOf('"aprovar_servico_mo"', inicio);
    expect(rpcIdx).toBeGreaterThan(inicio);
    const corpo = PANEL.slice(inicio, rpcIdx);
    expect(corpo).toMatch(/if \(somenteLeitura\) throw new Error\(MSG_SOMENTE_LEITURA\);/);
  });

  it("uploadFicha/uploadDesenho/uploadCroqui: cada um retorna antes do storage.upload", () => {
    for (const nome of ["uploadFicha", "uploadDesenho", "uploadCroqui"]) {
      const inicio = PANEL.indexOf(`const ${nome} = `);
      expect(inicio, `${nome} não encontrado`).toBeGreaterThanOrEqual(0);
      const fim = PANEL.indexOf("};", inicio);
      const corpo = PANEL.slice(inicio, fim);
      expect(corpo, `${nome} sem guarda`).toMatch(/if \(somenteLeitura\) return;/);
      expect(corpo, `${nome} ainda chama storage.upload — guarda não protege o caminho certo`).toContain("storage");
    }
  });

  it("PhotoList.handleAdd (fotos do modelo/referência): retorna antes do storage.upload", () => {
    const inicio = ANEXOS.indexOf("const handleAdd = async (file: File) => {");
    expect(inicio).toBeGreaterThanOrEqual(0);
    const fim = ANEXOS.indexOf("};", inicio);
    const corpo = ANEXOS.slice(inicio, fim);
    expect(corpo).toMatch(/if \(somenteLeitura\) return;/);
    expect(corpo).toContain("storage.from(BUCKET).upload");
  });

  it("Ajustes na Prova: comentar/resolver/excluir lançam MSG_SOMENTE_LEITURA antes da respectiva RPC", () => {
    for (const [nome, rpc] of [
      ["comentarMut", "prova_comentar"],
      ["resolverMut", "prova_resolver"],
      ["excluirMut", "prova_excluir"],
    ] as const) {
      const inicio = PROVA.indexOf(`const ${nome} = useMutation({`);
      expect(inicio, `${nome} não encontrado`).toBeGreaterThanOrEqual(0);
      const rpcIdx = PROVA.indexOf(`"${rpc}"`, inicio);
      expect(rpcIdx, `RPC ${rpc} não encontrada após ${nome}`).toBeGreaterThan(inicio);
      const corpo = PROVA.slice(inicio, rpcIdx);
      expect(corpo, `${nome} sem guarda antes de ${rpc}`).toMatch(/if \(somenteLeitura\) throw new Error\(MSG_SOMENTE_LEITURA\);/);
    }
  });
});
