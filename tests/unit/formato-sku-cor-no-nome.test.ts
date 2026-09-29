// FormatoSkuCard — "Cor no nome da sublinha (Integração)" (P-126, dono 29/set). O card usa hooks de ROTA
// (`useUnsavedGuard({blockNav:true})` → `useBlocker` do TanStack Router) — render de verdade sem um RouterProvider
// quebra (mesmo precedente de `tests/unit/integracao-tela-fonte.test.ts`: "1 useUnsavedGuard na página" é testado
// por ASSERÇÃO DE FONTE, não render). Este arquivo testa a LÓGICA pura por trás do card (seed/dirty/gravação —
// reproduzindo aqui as mesmas contas do componente, com as MESMAS funções que ele importa de sku-montar.ts/
// nome-sublinha.ts) e a UI (rótulo/InfoHover/rádio/onSuccess) por asserção de fonte.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { corNoNomeEfetiva, normalizarSkuConfig, canonico, type SkuConfig } from "@/lib/sku-montar";
import { nomeSublinha } from "@/lib/integracao/nome-sublinha";
import { ladoTamanho } from "@/lib/tamanho";

const ler = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), "utf8");
const FONTE = ler("src/components/configuracoes/FormatoSkuCard.tsx");

// Reproduz aqui (mesmas funções do componente) a forma canônica de comparação que o card usa para `dirty`/
// concorrência: `cor_no_nome` sempre EXPLÍCITO como a escolha EFETIVA (nunca o valor cru gravado) — assim uma loja
// sem a chave (padrão derivado) e a mesma escolha no rádio não geram dirty falso.
const paraComparar = (cfg: SkuConfig | null) => ({
  partes: cfg?.partes ?? [], separadores: cfg?.separadores ?? {}, cor_no_nome: corNoNomeEfetiva(cfg),
});
// Reproduz o `rascunhoDe` do card: semeia partes/separadores do cfg e `corNoNome` da escolha EFETIVA.
const rascunhoDe = (cfg: SkuConfig | null) => ({
  partes: cfg ? [...cfg.partes] : [], separadores: cfg ? { ...cfg.separadores } : {}, corNoNome: corNoNomeEfetiva(cfg),
});

describe("FormatoSkuCard — semear o rascunho com corNoNomeEfetiva (sem dirty falso)", () => {
  it("loja com cor_no_nome explícita: rascunho e base comparam iguais (dirty=false)", () => {
    const cfg: SkuConfig = { partes: ["ref", "cor_apelido"], separadores: {}, cor_no_nome: "cor_apelido" };
    const r = rascunhoDe(cfg);
    expect(r.corNoNome).toBe("cor_apelido");
    const cru = { partes: r.partes, separadores: r.separadores, cor_no_nome: r.corNoNome };
    const norm = normalizarSkuConfig(cru);
    expect(norm.ok).toBe(true);
    const dirty = canonico(norm.ok ? paraComparar(norm.valor) : cru) !== canonico(paraComparar(cfg));
    expect(dirty).toBe(false);
  });
  it("loja SEM a chave (padrão derivado das partes): seed já traz a escolha efetiva; comparar com a base ORIGINAL (sem a chave) NÃO acende dirty", () => {
    // A base carregada do servidor é o cfg CRU (sem `cor_no_nome`); a comparação usa `paraComparar` dos DOIS
    // lados — não a igualdade estrutural crua — então a ausência da chave na base não é um "outro valor".
    const cfgSemChave: SkuConfig = { partes: ["ref", "cor_apelido"], separadores: {} };
    const r = rascunhoDe(cfgSemChave);
    expect(r.corNoNome).toBe("cor_apelido"); // derivado: partes usa cor_apelido
    const cru = { partes: r.partes, separadores: r.separadores, cor_no_nome: r.corNoNome };
    const norm = normalizarSkuConfig(cru);
    const dirty = canonico(norm.ok ? paraComparar(norm.valor) : cru) !== canonico(paraComparar(cfgSemChave));
    expect(dirty).toBe(false);
  });
  it("mudar a escolha no rádio ACENDE dirty", () => {
    const cfg: SkuConfig = { partes: ["ref", "cor_base"], separadores: {}, cor_no_nome: "cor_base" };
    const r = rascunhoDe(cfg);
    const rMudado = { ...r, corNoNome: "cor_apelido" as const };
    const cru = { partes: rMudado.partes, separadores: rMudado.separadores, cor_no_nome: rMudado.corNoNome };
    const norm = normalizarSkuConfig(cru);
    const dirty = canonico(norm.ok ? paraComparar(norm.valor) : cru) !== canonico(paraComparar(cfg));
    expect(dirty).toBe(true);
  });
});

describe("FormatoSkuCard — salvar SEMPRE grava a chave explícita cor_no_nome", () => {
  it("loja COM partes marcadas: grava {partes,separadores,cor_no_nome}", () => {
    const cru = { partes: ["ref", "cor_base"], separadores: {}, cor_no_nome: "cor_base" };
    const n = normalizarSkuConfig(cru);
    expect(n).toEqual({ ok: true, valor: { partes: ["ref", "cor_base"], separadores: {}, cor_no_nome: "cor_base" } });
  });
  it("loja SEM formato (nenhuma parte marcada): grava {partes:[],separadores:{},cor_no_nome} — nunca null", () => {
    const cru = { partes: [], separadores: {}, cor_no_nome: "cor_apelido" };
    const n = normalizarSkuConfig(cru);
    expect(n).toEqual({ ok: true, valor: { partes: [], separadores: {}, cor_no_nome: "cor_apelido" } });
    // "sem formato" pro card = !valor || valor.partes.length === 0 (mesmo objeto gravado, ainda "sem formato" p/ SKU).
    expect(n.ok && (!n.valor || n.valor.partes.length === 0)).toBe(true);
  });
});

describe("FormatoSkuCard — prévia do nome da sublinha (Exemplo: nome + cor + tamanho)", () => {
  it("com apelido, modo cor_apelido: usa o apelido", () => {
    const tam = ladoTamanho("34|PPP", "letra");
    expect(tam).toBe("PPP");
    expect(nomeSublinha("Produto Exemplo", "Preto", "Noite", tam, "cor_apelido")).toBe("Produto Exemplo Noite PPP");
  });
  it("com apelido, modo cor_base: usa a cor base (2ª linha 'sem apelido' mostra o MESMO valor aqui, pois já é base)", () => {
    const tam = ladoTamanho("34|PPP", "letra");
    expect(nomeSublinha("Produto Exemplo", "Preto", "Noite", tam, "cor_base")).toBe("Produto Exemplo Preto PPP");
  });
  it("sem apelido: cai na cor base em qualquer modo", () => {
    const tam = ladoTamanho("36", "letra");
    expect(nomeSublinha("Produto Exemplo", "Azul", null, tam, "cor_apelido")).toBe("Produto Exemplo Azul 36");
  });
  it("nome do produto mais recente (quando a loja já tem um) — mesma função, outro nome", () => {
    const tam = ladoTamanho("P", "letra");
    expect(nomeSublinha("Vestido Suelen", "Preto", null, tam, "cor_base")).toBe("Vestido Suelen Preto P");
  });
});

describe("FormatoSkuCard.tsx (fonte) — rótulo, InfoHover, rádio, onSuccess, diálogo", () => {
  it('rótulo "Cor no nome da sublinha (Integração)"', () => {
    expect(FONTE).toContain("Cor no nome da sublinha (Integração)");
  });
  it("InfoHover com o texto do plano (Nome do produto + cor + tamanho; variante sem apelido; vale a partir de agora)", () => {
    expect(FONTE).toContain("<InfoHover");
    expect(FONTE).toContain("Na Integração e na API, cada sublinha se chama Nome do produto + cor + tamanho");
    expect(FONTE).toContain("Variante sem apelido usa a cor base; sem cor, fica só o tamanho.");
    expect(FONTE).toContain("os já integráveis/integrados mantêm o nome do retrato.");
  });
  it("rádio nativo com as 2 opções Cor base | Apelido (padrão do 'Tamanho em' da CodigosSecao)", () => {
    expect(FONTE).toContain('type="radio"');
    expect(FONTE).toContain("COR_NO_NOME.map((v) =>");
    expect(FONTE).toContain('cor_base: "Cor base"');
    expect(FONTE).toContain('cor_apelido: "Apelido"');
  });
  it("onSuccess invalida também a lista da Integração (chaveLista)", () => {
    expect(FONTE).toMatch(/invalidateQueries\(\{ queryKey: chaveLista\(tenantId\) \}\)/);
    expect(FONTE).toContain('from "@/components/integracao/useIntegracao"');
  });
  it("salvar grava sempre a chave explícita cor_no_nome (nunca omitida)", () => {
    expect(FONTE).toMatch(/normalizarSkuConfig\(cru\)/);
    expect(FONTE).toContain("cor_no_nome: rascunho.corNoNome");
  });
  it("diálogo de confirmação menciona a cor no nome da sublinha", () => {
    const iDialog = FONTE.indexOf("AlertDialogTitle>Salvar o Formato do SKU?");
    expect(iDialog).toBeGreaterThan(-1);
    expect(FONTE.slice(iDialog, iDialog + 600)).toContain("cor no nome da");
  });
  it("'sem formato' inclui partes vazias mesmo com a chave (não trata cor_no_nome como formato)", () => {
    expect(FONTE).toContain("norm.valor.partes.length === 0");
  });
});
