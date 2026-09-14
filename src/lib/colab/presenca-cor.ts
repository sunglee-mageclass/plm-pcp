// Cor por usuário na presença colaborativa (estilo Google Sheets): cada pessoa ganha uma cor
// ESTÁVEL derivada do seu userId, para distinguir quem está editando qual campo quando há 3+
// pessoas na mesma tela. Puro e determinístico (testável) — a mesma pessoa tem sempre a mesma cor,
// em qualquer sessão/dispositivo.
//
// Paleta de 10 matizes BEM distintos entre si (não a rampa navy dos gráficos, que é monocromática
// e confundiria pessoas diferentes). Cada cor traz o par para uso: `solid` (o anel/borda e o fundo
// do rótulo) e `text` (o texto do nome sobre o `solid`), ambos com contraste AA. Valores em HEX
// fixos DE PROPÓSITO (não tokens de tema): a cor identifica a PESSOA, tem que ser a mesma no claro
// e no escuro — se seguisse o tema, a "cor da Maria" mudaria entre os dois modos e perderia a
// função de identificar. (Exceção documentada à regra de "só tokens": presença = dado, como as
// cores de gráfico por série.)

import type { PresencaColab } from "@/hooks/useColabRegistro";

export type CorPresenca = { solid: string; text: string; nome: string };

// 10 cores distinguíveis (inclui pares seguros p/ daltonismo comum: evita depender só de
// vermelho×verde — há azul, laranja, roxo, teal, rosa, etc.). Texto branco ou quase-preto por cor
// conforme a luminância do fundo, garantindo contraste AA do nome sobre o chip.
const PALETA: ReadonlyArray<{ solid: string; text: string }> = [
  { solid: "#2563eb", text: "#ffffff" }, // azul
  { solid: "#d97706", text: "#ffffff" }, // âmbar/laranja
  { solid: "#059669", text: "#ffffff" }, // teal/verde
  { solid: "#db2777", text: "#ffffff" }, // rosa
  { solid: "#7c3aed", text: "#ffffff" }, // roxo
  { solid: "#0891b2", text: "#ffffff" }, // ciano
  { solid: "#c2410c", text: "#ffffff" }, // terracota
  { solid: "#4d7c0f", text: "#ffffff" }, // oliva
  { solid: "#be123c", text: "#ffffff" }, // vermelho-rosé
  { solid: "#4338ca", text: "#ffffff" }, // índigo
];

// Hash estável (FNV-1a 32-bit) de uma string → inteiro não-negativo. Determinístico e bem
// distribuído para strings curtas como UUID.
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // unsigned
}

/** Cor estável de um usuário (por id). Mesma pessoa → sempre a mesma cor. */
export function corDoUsuario(userId: string): { solid: string; text: string } {
  const idx = hashStr(userId || "") % PALETA.length;
  return PALETA[idx];
}

/**
 * Quem (se alguém) está focando o campo `path`, com a cor da pessoa. `null` se ninguém.
 * Se 2+ pessoas focarem o MESMO campo (raro), mostra a primeira (a mais "antiga" na lista de
 * presença) — o banner geral já lista todos os presentes.
 */
export function presencaDoCampo(presentes: PresencaColab[], path: string): CorPresenca | null {
  const p = presentes.find((x) => x.campoFocado === path);
  if (!p) return null;
  const cor = corDoUsuario(p.userId);
  return { solid: cor.solid, text: cor.text, nome: p.nome };
}
