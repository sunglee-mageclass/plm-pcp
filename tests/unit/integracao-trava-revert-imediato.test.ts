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
import { QueryClient, QueryObserver } from "@tanstack/react-query";
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
  it("com uma entrada [\"integracao-estado\", tenantId] ATIVA no cache (observada, como o hook useIntegracaoEstados faz): devolve o mapa dela (sem precisar saber o tenantId)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mapa: Record<string, EstadoModeloIntegracao> = {
      m1: { estado: "integravel", campos: ["nome"], marcadoEm: "2026-09-29T00:00:00Z", integradoEm: null },
    };
    // Fix round 1 (L-2, review) — `estadoIntegracaoFresco` agora filtra por `type: "active"`; uma query só
    // conta como "active" quando tem um OBSERVER de verdade (o que `useQuery` monta ao renderizar — aqui
    // simulado com `QueryObserver`, sem precisar montar React). `setQueryData` sozinho (sem observer) cria a
    // query mas ela fica INATIVA — por isso o teste original (antes do L-2) usava só `setQueryData` e
    // funcionava com `invalidateQueries`/`getQueriesData` SEM filtro; agora, com o fix, precisa do observer
    // pra provar o caminho feliz (a loja realmente aberta agora).
    const observer = new QueryObserver(qc, { queryKey: ["integracao-estado", "t1"], queryFn: async () => mapa });
    const unsubscribe = observer.subscribe(() => {});
    qc.setQueryData(["integracao-estado", "t1"], mapa);
    const r = await estadoIntegracaoFresco(qc);
    expect(r).toEqual(mapa);
    unsubscribe();
  });
  it("L-2 — entrada INATIVA (sem observer, ex.: loja anterior de um super admin que trocou de loja) NÃO é lida nem refeita: estadoIntegracaoFresco não a poisona nem a devolve", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mapaAntigo: Record<string, EstadoModeloIntegracao> = {
      m9: { estado: "integrado", campos: [], marcadoEm: null, integradoEm: "2026-09-01T00:00:00Z" },
    };
    // Loja A: query semeada mas SEM observer (equivalente a "inativa" — gcTime ainda não expirou, mas
    // nenhum componente está montado olhando pra ela; cenário do L-2: super admin trocou de loja).
    qc.setQueryData(["integracao-estado", "lojaA"], mapaAntigo);
    const r = await estadoIntegracaoFresco(qc);
    // Sem NENHUMA entrada ativa, o helper devolve {} — nunca lê/refetcha a entrada inativa da loja A (o que
    // ANTES do L-2 podia "envenenar" essa chave com o mapa da loja atual, via a MESMA queryFn rodando sob o
    // tenant errado).
    expect(r).toEqual({});
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
    // Fix round 1 (L-3, review) — reusa a MESMA função pura do revert pré-save (aplicarResolucaoTravaAcabado),
    // não um spread duplicado escrito à mão.
    expect(bloco).toContain("setDrafts((ds) => (ds ? ds.map((x) => (x.id === idAlvo ? aplicarResolucaoTravaAcabado(x, resolucao2) : x)) as ProdutoDraft[] : ds));");
    expect(bloco).not.toMatch(/\.\.\.x, \.\.\.resolucao2\.paraServidor/); // NÃO o spread duplicado de antes
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
    // Fix round 1 (L-3, review) — mesma troca: reusa aplicarResolucaoTrava (a MESMA função pura do pré-save).
    expect(bloco).toContain("setDrafts((ds) => ds.map((x) => (x.id === idAlvo ? aplicarResolucaoTrava(x, resolucao2) : x)) as ProdutoImportadoDraft[]);");
    expect(bloco).not.toMatch(/\.\.\.x, \.\.\.resolucao2\.paraServidor/);
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

// ────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 1 (L-4, review) — PA/PI mostravam 2 toasts pra 1 refusal: o `toastTravaAcabado`/
// `toastTravaImportado` do revert imediato (dentro de salvarUmProduto) + o `toast.error` genérico do onError
// da mutation (o mesmo erro rethrow chega lá). Fix: marca o erro (`revertidoLocal = true`) só quando o revert
// de fato mostrou um aviso; o onError pula o genérico nesse caso. Comportamental: reproduz a MESMA lógica
// condicional dos dois `onError` (`if (e?.revertidoLocal) return; toast.error(...)`) com um spy de toast real.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("Fix round 1 (L-4) — 1 toast só por refusal em PA/PI (não 2)", () => {
  const onErrorComoNoProducao = (e: { revertidoLocal?: boolean }, toastError: (msg: string) => void) => {
    if (e?.revertidoLocal) return;
    toastError("Erro ao salvar.");
  };
  it("erro com revertidoLocal=true (o revert já avisou) — onError NÃO mostra o toast genérico", () => {
    const chamadas: string[] = [];
    onErrorComoNoProducao({ revertidoLocal: true }, (m) => chamadas.push(m));
    expect(chamadas).toEqual([]);
  });
  it("erro SEM revertidoLocal (revert não rodou, ou rodou mas não tinha nada tocado pra avisar) — onError mostra o toast genérico normalmente (comportamento de sempre preservado)", () => {
    const chamadas: string[] = [];
    onErrorComoNoProducao({}, (m) => chamadas.push(m));
    expect(chamadas).toEqual(["Erro ao salvar."]);
  });
  it("fonte: ProdutoAcabadoSheet.tsx marca revertidoLocal SÓ quando resolucao2.avisos.length > 0, e o onError da mutation checa a marca ANTES do toast.error", () => {
    const s = fonte("src/components/produto-acabado/ProdutoAcabadoSheet.tsx");
    const idxIf = s.indexOf("if (resolucao2.avisos.length > 0) {");
    expect(idxIf).toBeGreaterThan(-1);
    const blocoMarca = s.slice(idxIf, idxIf + 200);
    expect(blocoMarca).toContain("toast.warning(`\"${p0.nome}\": ${toastTravaAcabado(resolucao2.avisos)}`);");
    expect(blocoMarca).toContain("(error as any).revertidoLocal = true;");
    const idxOnErrorMut = s.indexOf("onError: (e: any) => {", s.indexOf("const salvarMut = useMutation"));
    const idxFimOnError = s.indexOf("},\n  });", idxOnErrorMut);
    const blocoOnError = s.slice(idxOnErrorMut, idxFimOnError);
    expect(blocoOnError).toMatch(/if \(e\?\.revertidoLocal\) return;\s*\n\s*toast\.error\(mensagemErro\(e, "Erro ao salvar\."\)\);/);
  });
  it("fonte: ProdutoImportadoSheet.tsx — mesmo padrão", () => {
    const s = fonte("src/components/produto-importado/ProdutoImportadoSheet.tsx");
    const idxIf = s.indexOf("if (resolucao2.avisos.length > 0) {");
    expect(idxIf).toBeGreaterThan(-1);
    const blocoMarca = s.slice(idxIf, idxIf + 200);
    expect(blocoMarca).toContain("(error as any).revertidoLocal = true;");
    const idxOnErrorMut = s.indexOf("onError: (e: any) => {", s.indexOf("const salvarMut = useMutation"));
    const idxFimOnError = s.indexOf("},\n  });", idxOnErrorMut);
    const blocoOnError = s.slice(idxOnErrorMut, idxFimOnError);
    expect(blocoOnError).toMatch(/if \(e\?\.revertidoLocal\) return;\s*\n\s*toast\.error\(mensagemErro\(e, "Falha ao salvar"\)\);/);
  });
  it("Plan. Tecido NÃO precisa da marca — já retorna cedo (return) depois do revert+retry, antes de chegar no toast.error genérico (comportamento preservado, só documentado aqui p/ contraste)", () => {
    const s = fonte("src/components/plan-tecido/PlanTecidoSheet.tsx");
    expect(s).not.toContain("revertidoLocal");
    const idxOnError = s.indexOf("onError: async (e: any) => {");
    const idxReturn = s.indexOf("return;", s.indexOf("if (ehErroIntegracaoTravado(e)", idxOnError));
    const idxToastErro = s.indexOf('toast.error(mensagemErro(e, "Não foi possível salvar."));', idxOnError);
    expect(idxReturn).toBeGreaterThan(idxOnError);
    expect(idxReturn).toBeLessThan(idxToastErro); // o return do caminho revertido vem ANTES do toast genérico
  });
});
