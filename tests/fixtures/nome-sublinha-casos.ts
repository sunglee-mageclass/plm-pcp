// Casos COMPARTILHADOS do anti-drift "Cor no nome das sublinhas" (P-126, migration 20261013100000): o MESMO arquivo alimenta
//   tests/unit/integracao-nome-sublinha.test.ts     → src/lib/integracao/nome-sublinha.ts + corNoNomeEfetiva (TS)
//   tests/integration/integracao-8-nome-cor.test.ts → public._integracao_nome_sublinha / public._integracao_cor_no_nome (SQL)
// Toda entrada é serializável em JSON (vai ao banco como text/jsonb). Mudou a regra? Mude TS, SQL e AQUI.
import type { CorNoNome } from "../../src/lib/sku-montar";

/** Qual cor entra no nome para um `tenant_config.sku_config` CRU (explícita válida; senão derivada das partes). */
export const CASOS_COR_NO_NOME: { cfg: unknown; esperado: CorNoNome }[] = [
  { cfg: null, esperado: "cor_base" },
  { cfg: {}, esperado: "cor_base" },
  { cfg: { partes: ["ref", "cor_base", "tamanho"] }, esperado: "cor_base" },
  { cfg: { partes: ["ref", "cor_apelido", "tamanho"] }, esperado: "cor_apelido" },
  { cfg: { partes: ["ref", "cor_base", "cor_apelido", "tamanho"] }, esperado: "cor_apelido" },
  { cfg: { partes: ["ref", "cor_apelido"], cor_no_nome: "cor_base" }, esperado: "cor_base" },
  { cfg: { partes: ["ref", "cor_base"], cor_no_nome: "cor_apelido" }, esperado: "cor_apelido" },
  { cfg: { partes: [], separadores: {}, cor_no_nome: "cor_apelido" }, esperado: "cor_apelido" },
  { cfg: { partes: [], cor_no_nome: "cor_base" }, esperado: "cor_base" },
  // valor inválido/estranho (o gatilho nunca grava, mas a função não pode quebrar): cai no derivado
  { cfg: { partes: ["cor_apelido"], cor_no_nome: "apelido" }, esperado: "cor_apelido" },
  { cfg: { partes: ["cor_base"], cor_no_nome: 5 }, esperado: "cor_base" },
  { cfg: { partes: ["cor_apelido"], cor_no_nome: null }, esperado: "cor_apelido" },
  { cfg: { partes: "cor_apelido" }, esperado: "cor_base" },
  { cfg: { partes: [["cor_apelido"]] }, esperado: "cor_base" },
  { cfg: ["cor_apelido"], esperado: "cor_base" },
  { cfg: "cor_apelido", esperado: "cor_base" },
];

/** Nome da sublinha: [nome, cor base, apelido, tamanho, modo] → nome (null = falta o nome). */
export const CASOS_NOME_SUBLINHA: { nome: string | null; base: string | null; apelido: string | null; tam: string | null;
  modo: string | null; esperado: string | null }[] = [
  { nome: "Vestido Suelen", base: "Preto", apelido: "Noite", tam: "PPP", modo: "cor_base", esperado: "Vestido Suelen Preto PPP" },
  { nome: "Vestido Suelen", base: "Preto", apelido: "Noite", tam: "PPP", modo: "cor_apelido", esperado: "Vestido Suelen Noite PPP" },
  // sem apelido no modo Apelido → a cor base
  { nome: "Saia Marola", base: "Preto", apelido: null, tam: "P", modo: "cor_apelido", esperado: "Saia Marola Preto P" },
  { nome: "Saia Marola", base: "Preto", apelido: "  ", tam: "P", modo: "cor_apelido", esperado: "Saia Marola Preto P" },
  // sem cor → nome + tamanho (como antes da P-126)
  { nome: "Saia Marola", base: null, apelido: null, tam: "P", modo: "cor_base", esperado: "Saia Marola P" },
  { nome: "Saia Marola", base: "", apelido: null, tam: "P", modo: "cor_apelido", esperado: "Saia Marola P" },
  // apelido SEM cor base: modo Apelido usa o apelido; modo Cor base fica sem cor
  { nome: "Saia Marola", base: null, apelido: "Areia", tam: "M", modo: "cor_apelido", esperado: "Saia Marola Areia M" },
  { nome: "Saia Marola", base: null, apelido: "Areia", tam: "M", modo: "cor_base", esperado: "Saia Marola M" },
  // sem tamanho: nada sobrando no fim
  { nome: "Bolsa Areia", base: "Bege", apelido: null, tam: null, modo: "cor_base", esperado: "Bolsa Areia Bege" },
  { nome: "Bolsa Areia", base: "Bege", apelido: null, tam: "", modo: "cor_base", esperado: "Bolsa Areia Bege" },
  // nome em branco → null (mesmo com cor e tamanho)
  { nome: "   ", base: "Preto", apelido: null, tam: "P", modo: "cor_base", esperado: null },
  { nome: null, base: "Preto", apelido: null, tam: "P", modo: "cor_base", esperado: null },
  { nome: "", base: null, apelido: null, tam: null, modo: "cor_base", esperado: null },
  // aparar = btrim: só o espaço comum sai (tab e NBSP ficam), nas 3 pontas de texto
  { nome: "  Blusa Brisa  ", base: " Branco ", apelido: null, tam: "G", modo: "cor_base", esperado: "Blusa Brisa Branco G" },
  { nome: "\tBlusa", base: "Branco ", apelido: null, tam: "G", modo: "cor_base", esperado: "\tBlusa Branco  G" },
  { nome: " ", base: "Branco", apelido: null, tam: "G", modo: "cor_base", esperado: "  Branco G" },
  // modo desconhecido/nulo = Cor base
  { nome: "Top Lua", base: "Azul", apelido: "Cobalto", tam: "U", modo: null, esperado: "Top Lua Azul U" },
  { nome: "Top Lua", base: "Azul", apelido: "Cobalto", tam: "U", modo: "apelido", esperado: "Top Lua Azul U" },
  // acento/unicode passam intactos
  { nome: "Macacão Tramonto", base: "Açaí", apelido: "Pôr do Sol", tam: "38", modo: "cor_apelido", esperado: "Macacão Tramonto Pôr do Sol 38" },
];
