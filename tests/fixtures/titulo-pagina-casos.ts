// Casos do "Título para a página" automático (F3.6 — spec 2026-09-25, ruling 1). Rodam nos DOIS lados (anti-drift):
// tests/unit/titulo-pagina.test.ts (TS — src/lib/titulo-pagina.ts) e tests/integration/sheet-reorg-campos.test.ts (SQL —
// public._titulo_pagina_calculado). Mudou a regra? Mude os dois lados e estes casos.
export type CasoTitulo = { nome: string | null; loja: string | null; esperado: string };
export const CASOS_TITULO: readonly CasoTitulo[] = [
  { nome: "VESTIDO LONGO POEMA", loja: "Ave Rara", esperado: "Vestido Longo Poema | Ave Rara" }, // exemplo do mockup
  { nome: "vestido de festa", loja: "Ave Rara", esperado: "Vestido de Festa | Ave Rara" },
  { nome: "DA VINCI", loja: "Ave Rara", esperado: "Da Vinci | Ave Rara" }, // conectivo NO INÍCIO capitaliza
  { nome: "blusa DO DIA DAS MÃES", loja: "Ave Rara", esperado: "Blusa do Dia das Mães | Ave Rara" },
  { nome: "MACACÃO EM LINHO COM BOTÕES PARA O VERÃO", loja: "Ave Rara", esperado: "Macacão em Linho com Botões para O Verão | Ave Rara" },
  { nome: "CORAÇÃO E ALMA", loja: "X", esperado: "Coração e Alma | X" },
  { nome: "e", loja: "Loja", esperado: "E | Loja" },
  { nome: "", loja: "Ave Rara", esperado: "" }, // nome vazio ⇒ vazio (NUNCA " | Loja" solto — dono 25/set)
  { nome: null, loja: "Ave Rara", esperado: "" },
  { nome: "   \t ", loja: "Ave Rara", esperado: "" },
  { nome: "  CALÇA   JEANS  ", loja: "Loja Teste", esperado: "Calça Jeans | Loja Teste" },
  { nome: "VESTIDO\tLONGO\nPOEMA", loja: "L", esperado: "Vestido Longo Poema | L" },
  { nome: "SAIA MIDI", loja: "", esperado: "Saia Midi" }, // loja vazia ⇒ só o nome
  { nome: "SAIA MIDI", loja: null, esperado: "Saia Midi" },
  { nome: "SAIA", loja: " \t ", esperado: "Saia" },
  { nome: "SAIA MIDI", loja: "  Ave  Rara  ", esperado: "Saia Midi | Ave  Rara" }, // loja: só as pontas
  { nome: "ÁGUA-MARINHA", loja: "L", esperado: "Água-marinha | L" },
  { nome: "ÉPICA ÑANDU ÄRGER", loja: "L", esperado: "Épica Ñandu Ärger | L" },
  { nome: "ØRSTED blusa", loja: "L", esperado: "Ørsted Blusa | L" }, // letra fora da lista fica como está (nos 2 lados)
  { nome: "123 ANOS", loja: "L", esperado: "123 Anos | L" },
  { nome: "mod. 2027 (verão)", loja: "L", esperado: "Mod. 2027 (verão) | L" },
];
