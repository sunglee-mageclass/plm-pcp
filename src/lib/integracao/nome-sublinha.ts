// Nome da sublinha (variante × tamanho) da Integração/API — P-126 (dono 29/set, migration 20261013100000).
// Espelho TS PURO de `public._integracao_nome_sublinha(text,text,text,text,text)`: o nome é montado e GRAVADO no servidor
// (retrato do resumo / integracao_linhas); este arquivo só serve às prévias da tela (Config da Loja › Formato do SKU).
// Anti-drift: tests/fixtures/nome-sublinha-casos.ts roda nos DOIS lados (tests/unit/integracao-nome-sublinha.test.ts e
// tests/integration/integracao-8-nome-cor.test.ts). Mudou a regra aqui? Mude o SQL (nova migration) e as fixtures.
//
// Regra: Nome do produto + cor + tamanho, separados por 1 espaço ("Vestido Suelen Preto PPP").
//  - nome em branco (só espaços) ⇒ null (falta o nome — a sublinha não inventa um "nome" só com o tamanho);
//  - cor = o Apelido no modo "cor_apelido" (variante sem apelido: a Cor base), senão a Cor base; sem cor ⇒ nome + tamanho;
//  - aparar = `btrim` do SQL: tira SÓ o espaço comum (tab, quebra de linha e o espaço unicode/NBSP ficam);
//  - tamanho vazio some (sem espaço sobrando).
import type { CorNoNome } from "@/lib/sku-montar";

const aparaEspaco = (s: string | null | undefined): string => (s ?? "").replace(/^ +| +$/g, "");
const ouNulo = (s: string): string | null => (s === "" ? null : s);

export function nomeSublinha(
  nome: string | null | undefined,
  corBase: string | null | undefined,
  apelido: string | null | undefined,
  tamanho: string | null | undefined,
  modo: CorNoNome | string | null | undefined,
): string | null {
  const n = aparaEspaco(nome);
  if (n === "") return null;
  const base = ouNulo(aparaEspaco(corBase));
  const cor = modo === "cor_apelido" ? (ouNulo(aparaEspaco(apelido)) ?? base) : base;
  return [n, cor, tamanho ? tamanho : null].filter((x): x is string => x !== null).join(" ");
}
