// Fix round pós-QA (F3) — "aba desatualizada só reverte no 2º Salvar" (fix-qa-brief.md item F3). Cenário: um
// produto é marcado Integrável em OUTRA aba enquanto esta aba (velha) está aberta com o "Tamanho em" editado;
// nesta aba o Salvar bate no 42501 `integracao_travado: tamanho_tipo` — MAS até este fix o rascunho continuava
// mostrando o valor recusado (o toggle fica desabilitado com o valor RECUSADO) e o Salvar seguia habilitado; só
// o 2º Salvar revertia (com o toast "…foi travado pela Integração enquanto você editava — essa alteração não
// foi salva."). O fix: já no 1º erro, busca o estado da Integração FRESCO (refetch de verdade — `invalidarEstado-
// SeTravado`/`invalidateQueries` sozinho SÓ marca stale, não traz o dado novo a tempo de reverter AGORA) e reusa
// a MESMA lógica de revert que já roda no pré-save (`resolverTravaAcabado`/`resolverTravaImportado`/
// `marcarTamanhoTocado` — nenhuma lógica NOVA, só chamada de novo com o estado atualizado).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { QueryClient } from "@tanstack/react-query";
import { ehErroIntegracaoTravado, estadoIntegracaoFresco, type EstadoModeloIntegracao } from "@/lib/integracao/trava";

const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

describe("ehErroIntegracaoTravado (F3) — mesma leitura de código/mensagem de invalidarEstadoSeTravado, extraída p/ reuso", () => {
  it("42501 com mensagem integracao_travado:* → true", () => {
    expect(ehErroIntegracaoTravado({ code: "42501", message: "integracao_travado: tamanho_tipo" })).toBe(true);
    expect(ehErroIntegracaoTravado({ code: "42501", message: "integracao_travado: sku" })).toBe(true);
  });
  it("outros erros (P0409, P0001, rede, 42501 de outra causa) → false", () => {
    expect(ehErroIntegracaoTravado({ code: "P0409", message: "conflito_versao: x" })).toBe(false);
    expect(ehErroIntegracaoTravado({ code: "P0001", message: "algo em PT" })).toBe(false);
    expect(ehErroIntegracaoTravado({ code: "42501", message: "outra_coisa: x" })).toBe(false);
    expect(ehErroIntegracaoTravado(new Error("rede caiu"))).toBe(false);
    expect(ehErroIntegracaoTravado(null)).toBe(false);
    expect(ehErroIntegracaoTravado(undefined)).toBe(false);
  });
  it("lê de .error.code/.error.message e .cause.code também (mesmos formatos de invalidarEstadoSeTravado)", () => {
    expect(ehErroIntegracaoTravado({ error: { code: "42501", message: "integracao_travado: nome" } })).toBe(true);
    expect(ehErroIntegracaoTravado({ cause: { code: "42501" }, message: "integracao_travado: nome" })).toBe(true);
  });
});

describe("estadoIntegracaoFresco (F3) — refetch de verdade (não só invalida) e devolve o mapa do cache", () => {
  it("sem entrada nenhuma no cache (query nunca rodou): devolve {} — chamador trata como sem trava conhecida", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r = await estadoIntegracaoFresco(qc);
    expect(r).toEqual({});
  });
  it("com uma entrada [\"integracao-estado\", tenantId] no cache: devolve o mapa dela (sem precisar saber o tenantId)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mapa: Record<string, EstadoModeloIntegracao> = {
      m1: { estado: "integravel", campos: ["nome"], marcadoEm: "2026-09-29T00:00:00Z", integradoEm: null },
    };
    // Semeia a query já com dado (evita depender de rede/queryFn real neste teste) — refetchQueries ainda
    // dispara a queryFn se houver uma registrada; sem query ativa registrada, refetchQueries é no-op e o
    // getQueriesData abaixo lê exatamente o que foi semeado.
    qc.setQueryData(["integracao-estado", "t1"], mapa);
    const r = await estadoIntegracaoFresco(qc);
    expect(r).toEqual(mapa);
  });
});

describe("fonte: os 3 Sheets (PA/PI/Plan.Tecido) revertem já no 1º erro, reusando a lógica existente", () => {
  it("ProdutoAcabadoSheet.tsx — no catch do RPC, com ehErroIntegracaoTravado, busca o estado fresco e roda resolverTravaAcabado de novo (com p0/servidorAtual/touchedAgora já capturados)", () => {
    const s = fonte("src/components/produto-acabado/ProdutoAcabadoSheet.tsx");
    expect(s).toContain("ehErroIntegracaoTravado, estadoIntegracaoFresco");
    const idxIf = s.indexOf("if (ehErroIntegracaoTravado(error)) {");
    expect(idxIf).toBeGreaterThan(-1);
    const bloco = s.slice(idxIf, idxIf + 900);
    expect(bloco).toContain("await estadoIntegracaoFresco(qc)");
    expect(bloco).toContain("resolverTravaAcabado({ enviado: p0, servidor: servidorAtual, travaAtual: travaFresca, touched: touchedAgora })");
    expect(bloco).toContain("setDrafts((ds) =>");
    // acontece DENTRO do `if (error) { ... }`, antes do `throw error;` que devolve ao chamador (mutationFn/onError)
    const idxThrow = s.indexOf("throw error;", idxIf);
    expect(idxThrow).toBeGreaterThan(idxIf);
  });
  it("ProdutoImportadoSheet.tsx — mesmo padrão, com resolverTravaImportado e guarda extra pra produto isLocal (sem servidor ainda)", () => {
    const s = fonte("src/components/produto-importado/ProdutoImportadoSheet.tsx");
    expect(s).toContain("ehErroIntegracaoTravado, estadoIntegracaoFresco");
    const idxIf = s.indexOf("if (ehErroIntegracaoTravado(error)) {");
    expect(idxIf).toBeGreaterThan(-1);
    const bloco = s.slice(idxIf, idxIf + 900);
    expect(bloco).toContain("!isLocal && d0.modelo_id");
    expect(bloco).toContain("await estadoIntegracaoFresco(qc)");
    expect(bloco).toContain("resolverTravaImportado({ enviado: d0, servidor: servidorAtual, travaAtual: travaFresca, touched: touchedAgora })");
  });
  it("PlanTecidoSheet.tsx — no onError, ANTES do retry do P0409, refaz marcarTamanhoTocado com o estado fresco e retenta o Salvar 1x (própria trava retryIntegracaoRef, não a do P0409)", () => {
    const s = fonte("src/components/plan-tecido/PlanTecidoSheet.tsx");
    expect(s).toContain("ehErroIntegracaoTravado, estadoIntegracaoFresco");
    expect(s).toContain("const retryIntegracaoRef = useRef(false);");
    const idxOnError = s.indexOf("onError: async (e: any) => {");
    const idxIf = s.indexOf("if (ehErroIntegracaoTravado(e) && !retryIntegracaoRef.current) {", idxOnError);
    const idxP0409 = s.indexOf('if (e?.code === "P0409"', idxOnError);
    expect(idxOnError).toBeGreaterThan(-1);
    expect(idxIf).toBeGreaterThan(idxOnError);
    expect(idxP0409).toBeGreaterThan(idxIf); // o bloco de 42501 vem ANTES do retry do P0409 (são exclusivos, mas a ordem documenta a intenção)
    const bloco = s.slice(idxIf, idxP0409);
    expect(bloco).toContain("await estadoIntegracaoFresco(qc)");
    expect(bloco).toContain("const marca2 = marcarTamanhoTocado(draft, planBaseRef.current, {");
    expect(bloco).toContain("toast.warning(textoTamanhoRevertido(marca2.revertidos));");
    expect(bloco).toContain("salvarMut.mutate(undefined, { onSettled: () => { retryIntegracaoRef.current = false; } });");
  });
});
