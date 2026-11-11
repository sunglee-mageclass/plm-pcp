// F6 Fluxo 1 (A3) — navegação por teclado nas tabelas do Sheet de Explosão.
// DOM-based (ordem dos inputs `[data-colab-path]` dentro da própria <table>), porque as 3 seções
// (metragem, aviamentos, insumos) têm estruturas diferentes. Enter/Shift+Enter andam na ordem do
// DOM; borda (sem próximo) = retorna false e o chamador NÃO dá preventDefault (deixa o Tab nativo).
export function focarProximoInput(
  atual: HTMLElement,
  tabela: HTMLElement,
  tecla: "Enter" | "Tab",
  comShift: boolean,
): boolean {
  const campos = Array.from(tabela.querySelectorAll<HTMLInputElement>("input[data-colab-path]"));
  const i = campos.indexOf(atual as HTMLInputElement);
  if (i < 0) return false;
  const passo = comShift ? -1 : 1;
  const alvo = campos[i + passo];
  if (!alvo) return false;
  requestAnimationFrame(() => alvo.focus());
  return true;
}
