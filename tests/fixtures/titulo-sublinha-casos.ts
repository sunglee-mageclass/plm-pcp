// Casos COMPARTILHADOS do anti-drift "Título da sublinha" (R8, P-301 B / P-302 A, migration 20261103190000): o MESMO arquivo
// alimenta
//   tests/unit/integracao-titulo-sublinha.test.ts      → src/lib/integracao/titulo-sublinha.ts (TS)
//   tests/integration/urgb-r8-titulo-sublinha.test.ts  → public._integracao_titulo_sublinha (SQL)
// Toda entrada é serializável em JSON (vai ao banco como text). Mudou a regra? Mude TS, SQL (migration nova) e AQUI.
//
// Regra: título EFETIVO do produto + a COR inserida antes do ÚLTIMO " | " ("Vestido Suelen | Ave Rara" →
// "Vestido Suelen Preto | Ave Rara"); sem " | " = cor no fim; sem cor = igual ao do produto; título null = null; título em
// branco (só espaços) = ele mesmo. Cor = a do nome da sublinha (apelido no modo 'cor_apelido'; apelido vazio → cor base).
// Aparar = btrim do SQL (só o espaço comum sai; tab/NBSP ficam). O título NUNCA é aparado (vai como veio).

export const CASOS_TITULO_SUBLINHA: {
  titulo: string | null;
  base: string | null;
  apelido: string | null;
  modo: string | null;
  esperado: string | null;
}[] = [
  // o caso do dono
  {
    titulo: "Vestido Suelen | Ave Rara",
    base: "Preto",
    apelido: "Noite",
    modo: "cor_base",
    esperado: "Vestido Suelen Preto | Ave Rara",
  },
  {
    titulo: "Vestido Suelen | Ave Rara",
    base: "Preto",
    apelido: "Noite",
    modo: "cor_apelido",
    esperado: "Vestido Suelen Noite | Ave Rara",
  },
  // apelido vazio / só espaços / null no modo Apelido → a cor base
  {
    titulo: "Vestido Suelen | Ave Rara",
    base: "Preto",
    apelido: "",
    modo: "cor_apelido",
    esperado: "Vestido Suelen Preto | Ave Rara",
  },
  {
    titulo: "Vestido Suelen | Ave Rara",
    base: "Preto",
    apelido: "  ",
    modo: "cor_apelido",
    esperado: "Vestido Suelen Preto | Ave Rara",
  },
  {
    titulo: "Vestido Suelen | Ave Rara",
    base: "Preto",
    apelido: null,
    modo: "cor_apelido",
    esperado: "Vestido Suelen Preto | Ave Rara",
  },
  // apelido SEM cor base: modo Apelido usa o apelido; modo Cor base fica sem cor (= igual ao do produto)
  {
    titulo: "Saia Marola | Loja",
    base: null,
    apelido: "Areia",
    modo: "cor_apelido",
    esperado: "Saia Marola Areia | Loja",
  },
  {
    titulo: "Saia Marola | Loja",
    base: null,
    apelido: "Areia",
    modo: "cor_base",
    esperado: "Saia Marola | Loja",
  },
  // sem cor = igual ao do produto
  {
    titulo: "Vestido Suelen | Ave Rara",
    base: null,
    apelido: null,
    modo: "cor_base",
    esperado: "Vestido Suelen | Ave Rara",
  },
  {
    titulo: "Vestido Suelen | Ave Rara",
    base: "",
    apelido: "",
    modo: "cor_apelido",
    esperado: "Vestido Suelen | Ave Rara",
  },
  {
    titulo: "Vestido Suelen | Ave Rara",
    base: "   ",
    apelido: null,
    modo: "cor_base",
    esperado: "Vestido Suelen | Ave Rara",
  },
  // sem " | " → a cor no fim
  {
    titulo: "Produto Exemplo 1 - exemplo",
    base: "Cor Exemplo",
    apelido: "Apelido Exemplo",
    modo: "cor_base",
    esperado: "Produto Exemplo 1 - exemplo Cor Exemplo",
  },
  {
    titulo: "Blusa Brisa",
    base: "Branco",
    apelido: null,
    modo: "cor_base",
    esperado: "Blusa Brisa Branco",
  },
  // 2× " | " → antes do ÚLTIMO
  {
    titulo: "A | B | C",
    base: "Preto",
    apelido: null,
    modo: "cor_base",
    esperado: "A | B Preto | C",
  },
  // " | " sobrepostos: o último começa no 2º "|"
  { titulo: "a | | b", base: "Preto", apelido: null, modo: "cor_base", esperado: "a | Preto | b" },
  // " | " no começo / título que é só " | "
  { titulo: " | Loja", base: "Preto", apelido: null, modo: "cor_base", esperado: " Preto | Loja" },
  { titulo: " | ", base: "Preto", apelido: null, modo: "cor_base", esperado: " Preto | " },
  // "|" sem os 2 espaços NÃO é separador → cor no fim
  { titulo: "Nome |", base: "Café", apelido: null, modo: "cor_base", esperado: "Nome | Café" },
  {
    titulo: "Nome|Loja",
    base: "Café",
    apelido: null,
    modo: "cor_base",
    esperado: "Nome|Loja Café",
  },
  {
    titulo: "Nome |Loja",
    base: "Café",
    apelido: null,
    modo: "cor_base",
    esperado: "Nome |Loja Café",
  },
  // título null → null; em branco → ele mesmo (sem cor)
  { titulo: null, base: "Preto", apelido: "Noite", modo: "cor_apelido", esperado: null },
  { titulo: "", base: "Preto", apelido: null, modo: "cor_base", esperado: "" },
  { titulo: "   ", base: "Preto", apelido: null, modo: "cor_base", esperado: "   " },
  // o título NÃO é aparado (espaços das pontas ficam); a cor é (btrim)
  {
    titulo: "  Blusa | Loja  ",
    base: " Branco ",
    apelido: null,
    modo: "cor_base",
    esperado: "  Blusa Branco | Loja  ",
  },
  // aparar = btrim: tab/NBSP na cor ficam
  {
    titulo: "Top | Loja",
    base: "\tAzul",
    apelido: null,
    modo: "cor_base",
    esperado: "Top \tAzul | Loja",
  },
  {
    titulo: "Top | Loja",
    base: "Azul ",
    apelido: null,
    modo: "cor_base",
    esperado: "Top Azul  | Loja",
  },
  // título com tab só (não é espaço comum → não está "em branco") ganha a cor
  { titulo: "\t", base: "Azul", apelido: null, modo: "cor_base", esperado: "\t Azul" },
  // modo desconhecido/nulo = Cor base
  {
    titulo: "Top Lua | Loja",
    base: "Azul",
    apelido: "Cobalto",
    modo: null,
    esperado: "Top Lua Azul | Loja",
  },
  {
    titulo: "Top Lua | Loja",
    base: "Azul",
    apelido: "Cobalto",
    modo: "apelido",
    esperado: "Top Lua Azul | Loja",
  },
  // acento / emoji / unicode passam intactos (posição por CARACTERE no SQL, por unidade UTF-16 no TS — mesmo corte)
  {
    titulo: "Blusa Ção 👗 | Loja",
    base: "Café",
    apelido: null,
    modo: "cor_base",
    esperado: "Blusa Ção 👗 Café | Loja",
  },
  {
    titulo: "Macacão 👗 | Tramonto 🌅 | Ave Rara",
    base: "Açaí",
    apelido: "Pôr do Sol 🌇",
    modo: "cor_apelido",
    esperado: "Macacão 👗 | Tramonto 🌅 Pôr do Sol 🌇 | Ave Rara",
  },
  {
    titulo: "Saia Única",
    base: "Ébano",
    apelido: null,
    modo: "cor_base",
    esperado: "Saia Única Ébano",
  },
];
