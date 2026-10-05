// Título da sublinha (variante × tamanho) da Integração/API — R8 (P-301 B / P-302 A, migration 20261103190000).
// Espelho TS PURO de `public._integracao_titulo_sublinha(text,text,text,text)`: o título é montado e GRAVADO no servidor
// (retrato / integracao_linhas). Anti-drift: tests/fixtures/titulo-sublinha-casos.ts roda nos DOIS lados
// (tests/unit/integracao-titulo-sublinha.test.ts e tests/integration/urgb-r8-titulo-sublinha.test.ts). Mudou a regra aqui?
// Mude o SQL (nova migration) e as fixtures.
//
// Regra: o título EFETIVO do produto com a COR inserida antes do ÚLTIMO " | " ("Vestido Suelen | Ave Rara" →
// "Vestido Suelen Preto | Ave Rara"); sem " | " ⇒ cor no fim; sem cor ⇒ igual ao do produto; título null ⇒ null; título em
// branco ⇒ ele mesmo. Sem tamanho. Cor = a mesma escolha do nome da sublinha (apelido no modo "cor_apelido"; vazio ⇒ cor base).
// Aparar = `btrim` do SQL: tira SÓ o espaço comum da cor (tab/NBSP ficam); o título nunca é aparado.
import type { CorNoNome } from "@/lib/sku-montar";

const aparaEspaco = (s: string | null | undefined): string => (s ?? "").replace(/^ +| +$/g, "");
const ouNulo = (s: string): string | null => (s === "" ? null : s);

export function tituloSublinha(
  titulo: string | null | undefined,
  corBase: string | null | undefined,
  apelido: string | null | undefined,
  modo: CorNoNome | string | null | undefined,
): string | null {
  if (titulo == null) return null;
  const base = ouNulo(aparaEspaco(corBase));
  const cor = modo === "cor_apelido" ? (ouNulo(aparaEspaco(apelido)) ?? base) : base;
  if (aparaEspaco(titulo) === "" || cor === null) return titulo;
  const i = titulo.lastIndexOf(" | ");
  return i < 0 ? `${titulo} ${cor}` : `${titulo.slice(0, i)} ${cor}${titulo.slice(i)}`;
}
