// Falso "Alguém salvou agora — N campo(s) atualizado(s)" ao abrir -> fechar (ESC) sem editar -> reabrir a OC de tecido.
// Causa real (corrida pré-existente, revelada na prévia do CQ no Salvar): com staleTime:0 + remonta, o efeito de merge re-dispara com o
// rascunho da CLOSURE ainda vazio (o seed recém-setado não commitou) enquanto `baseRef` já tem as linhas. `mergeLinhas` com draft=[]
// empurra toda linha do servidor como "nova do servidor" (atualizadas = N) mesmo com base == fresh. Guard: nada tocado + rascunho vazio
// + base cheia => a tela só re-semeia e NÃO chama o merge.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeLinhas } from "@/lib/colab/merge";
import { ehCorridaRemontaSemTocar } from "@/lib/colab/conflitos-pendentes";
import { semEfemeros } from "@/components/oc-tecido/CqTecido";

const row = (id: string) => ({ tempId: id, id, preco: 10, cq_ok: false, cq_alerta_status: "sem_alerta", cq_observacao: "" });
const quatro = () => ["a", "b", "c", "d"].map(row);

describe("corrida remonta+refetch (staleTime:0)", () => {
  it("SEM o guard o merge com rascunho vazio (closure stale) acusa as N linhas como 'atualizadas' — por isso o guard existe", () => {
    const r = mergeLinhas({ base: quatro(), draft: [], fresh: quatro(), touchedIds: new Set(), removidasIds: new Set(), comparavel: semEfemeros });
    expect(r.atualizadas.length).toBe(4); // o banner falso
  });

  it("a condição do guard dispara exatamente nessa corrida (rascunho vazio, base cheia, nada tocado)", () => {
    expect(ehCorridaRemontaSemTocar({ linhasDoRascunho: 0, linhasDaBase: 4, camposTocados: 0, linhasTocadas: 0 })).toBe(true);
  });

  it("NÃO dispara quando o merge é necessário: rascunho com linhas, base vazia, ou qualquer coisa tocada (campo ou linha)", () => {
    // rascunho carregado: merge normal (banner legítimo de edição alheia)
    expect(ehCorridaRemontaSemTocar({ linhasDoRascunho: 4, linhasDaBase: 4, camposTocados: 0, linhasTocadas: 0 })).toBe(false);
    // OC sem itens: nada a proteger nem a re-semear por esta via
    expect(ehCorridaRemontaSemTocar({ linhasDoRascunho: 0, linhasDaBase: 0, camposTocados: 0, linhasTocadas: 0 })).toBe(false);
    // apaguei todas as linhas: remover marca os ids como tocados -> o conflito real ("removi X, o outro editou X") continua valendo
    expect(ehCorridaRemontaSemTocar({ linhasDoRascunho: 0, linhasDaBase: 4, camposTocados: 0, linhasTocadas: 4 })).toBe(false);
    // editei um campo do cabeçalho
    expect(ehCorridaRemontaSemTocar({ linhasDoRascunho: 0, linhasDaBase: 4, camposTocados: 1, linhasTocadas: 0 })).toBe(false);
  });

  it("apagar todas as linhas (tocadas) e o servidor mudar uma delas continua virando conflito de linha (o guard não o engole)", () => {
    const base = quatro();
    const fresh = quatro(); fresh[1] = { ...fresh[1], cq_ok: true };
    const tocados = new Set(["a", "b", "c", "d"]);
    const r = mergeLinhas({ base, draft: [], fresh, touchedIds: tocados, removidasIds: tocados, comparavel: semEfemeros });
    expect(r.conflitos.map((c) => c.path)).toEqual(["linha:b"]);
  });

  it("a tela aplica o guard no efeito de merge: depois do seed e ANTES de montar o merge, re-semeando e saindo", () => {
    const SRC = readFileSync(join(process.cwd(), "src/routes/_authenticated/entrada-saida.oc-tecido.tsx"), "utf8");
    const iSeed = SRC.indexOf("// 1ª carga: seed normal");
    const iGuard = SRC.indexOf("ehCorridaRemontaSemTocar({");
    const iMerge = SRC.indexOf("const md = mergeDraft({ base: baseRef.current.draft");
    expect(iSeed).toBeGreaterThan(-1);
    expect(iGuard).toBeGreaterThan(iSeed);
    expect(iMerge).toBeGreaterThan(iGuard);
    const bloco = SRC.slice(iGuard, iMerge);
    expect(bloco).toMatch(/linhasDoRascunho: items\.length/);
    expect(bloco).toMatch(/linhasDaBase: baseRef\.current\.items\.length/);
    expect(bloco).toMatch(/camposTocados: touchedRef\.current\.size/);
    expect(bloco).toMatch(/linhasTocadas: touchedItemIdsRef\.current\.size/);
    expect(bloco).toContain("setItems(freshItems)");
    expect(bloco).toContain("resetBaseline(");
    expect(bloco).toMatch(/return;/);
  });
});
