// Auto-instrumentação do ring de presença por campo (set/2026): em vez de exigir que CADA campo
// seja marcado à mão com `data-colab-path` + envolvido num `<FieldPresence>`, derivamos um IDENTI-
// FICADOR ESTÁVEL do próprio elemento focado. Esse identificador (o "path") viaja no broadcast do
// `useColabRegistro` como `campoFocado`; o `<ColabPresenceOverlay>` usa o MESMO path para reencontrar
// o elemento no DOM e desenhar o anel por cima. Assim qualquer input/textarea/select dentro de um
// sheet colaborativo ganha o ring sem marcação manual.
//
// Requisito central: o path tem que ser (a) DERIVÁVEL do elemento no foco e (b) capaz de REENCONTRAR
// o MESMO elemento na OUTRA aba — que pode ter accordions abertos/fechados diferentes, Tecido 2
// aberto/fechado, etc. Por isso o path NÃO pode ser posicional (índice do campo): a lista de campos
// difere entre as abas e um índice apontaria pro campo errado (falso-positivo). Ele é SEMÂNTICO:
// derivado do RÓTULO (label) do campo, que é o mesmo texto nos dois lados (mesma tela, mesmo idioma).
//
// Ordem de prioridade (primeiro que casar vence):
//   1. `data-colab-path="X"`  → path = X               (marcação manual explícita; retrocompatível)
//   2. `name` / `id`          → path = "name:X"/"id:X"  (identidade estável de HTML, quando existe)
//   3. rótulo (label)         → path = "lbl:<texto>[#k]" (o comum no projeto; k desambigua repetidos
//                                                          sob o MESMO rótulo, ex.: linhas de grade)
// Sem rótulo, sem name/id e sem data-colab-path → não participa (retorna null): sem identidade
// estável não dá pra reencontrar com segurança, e um anel no campo errado é pior que nenhum anel.

/** Seletor dos elementos "focáveis de campo" que participam da presença (mesma classe do teclado
 *  mobile no SheetContent). Exclui botões/checkbox/radio (não são "campos de texto" com ring útil). */
export const COLAB_FIELD_SELECTOR =
  'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable="true"]';

/** Um elemento é um campo participante? (usado pelo onFocusCapture p/ ignorar foco em botões etc.) */
export function ehCampoColab(el: Element | null | undefined): el is HTMLElement {
  return !!el && el.matches?.(COLAB_FIELD_SELECTOR);
}

/** Escapa um valor para uso seguro dentro de um seletor de atributo CSS. */
function cssAttrEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Normaliza texto de rótulo: colapsa espaços, tira `*`/`:` decorativos, minúsculas. Determinístico
 *  e igual nos dois lados. */
function normLabel(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[*:]/g, "").trim().toLowerCase();
}

/** Texto do rótulo associado a um campo, ou "" se não achar. Estratégias, em ordem:
 *  1. `aria-label` no próprio campo;
 *  2. `<label for=id>` quando o campo tem id;
 *  3. o `<label>` mais próximo subindo a árvore (o padrão do projeto: `<div class="grid gap-1">
 *     <Label/> <Input/></div>` — label e campo são irmãos sob um wrapper). */
function labelDoCampo(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();

  const id = el.getAttribute("id");
  if (id) {
    const forLbl = el.ownerDocument?.querySelector<HTMLElement>(`label[for="${cssAttrEscape(id)}"]`);
    if (forLbl?.textContent?.trim()) return forLbl.textContent.trim();
  }

  // Sobe até um ancestral que contenha um <label> e retorna o texto do 1º label dele. Limita a
  // profundidade p/ não pegar um label distante de outra seção.
  let cur: HTMLElement | null = el.parentElement;
  for (let depth = 0; cur && depth < 4; depth++, cur = cur.parentElement) {
    const lbl = cur.querySelector("label");
    if (lbl?.textContent?.trim()) return lbl.textContent.trim();
  }
  return "";
}

/** Ordinal do campo entre os campos que compartilham o MESMO rótulo dentro do scope (0-based).
 *  Só relevante quando 2+ campos têm o mesmo rótulo (ex.: grade com "Qtd" repetido). A ordem é a do
 *  DOM (estável entre abas com o mesmo markup). */
function ordinalPorRotulo(el: HTMLElement, scope: HTMLElement, rotuloNorm: string): number {
  const campos = Array.from(scope.querySelectorAll<HTMLElement>(COLAB_FIELD_SELECTOR));
  let k = 0;
  for (const c of campos) {
    if (c === el) return k;
    if (normLabel(labelDoCampo(c)) === rotuloNorm) k++;
  }
  return 0;
}

/**
 * Deriva o path SEMÂNTICO e estável de um elemento focado, dentro de um scope (o container do sheet).
 * Retorna null se o elemento não for um campo participante ou não tiver identidade estável.
 */
export function pathDoElemento(el: HTMLElement, scope: HTMLElement): string | null {
  if (!ehCampoColab(el)) return null;

  const explicit = el.getAttribute("data-colab-path");
  if (explicit) return explicit;

  const name = el.getAttribute("name");
  if (name) return `name:${name}`;

  const id = el.getAttribute("id");
  if (id) return `id:${id}`;

  const rotulo = normLabel(labelDoCampo(el));
  if (!rotulo) return null; // sem rótulo estável → não participa (melhor sem anel que anel errado)

  const k = ordinalPorRotulo(el, scope, rotulo);
  return k > 0 ? `lbl:${rotulo}#${k}` : `lbl:${rotulo}`;
}

/**
 * Reencontra, dentro do scope, o elemento correspondente a um path (o inverso de `pathDoElemento`).
 * Retorna null se não achar (campo saiu do DOM/accordion fechado na outra aba, etc.) — o overlay
 * simplesmente não desenha o anel nesse caso (nunca desenha no campo errado).
 */
export function elementoDoPath(path: string, scope: HTMLElement): HTMLElement | null {
  if (path.startsWith("name:")) {
    return scope.querySelector<HTMLElement>(`[name="${cssAttrEscape(path.slice(5))}"]`);
  }
  if (path.startsWith("id:")) {
    return scope.querySelector<HTMLElement>(`[id="${cssAttrEscape(path.slice(3))}"]`);
  }
  if (path.startsWith("lbl:")) {
    const rest = path.slice(4);
    const hash = rest.lastIndexOf("#");
    const rotulo = hash >= 0 ? rest.slice(0, hash) : rest;
    const alvoK = hash >= 0 ? Number(rest.slice(hash + 1)) : 0;
    if (!Number.isInteger(alvoK) || alvoK < 0) return null;
    const campos = Array.from(scope.querySelectorAll<HTMLElement>(COLAB_FIELD_SELECTOR));
    let k = 0;
    for (const c of campos) {
      if (normLabel(labelDoCampo(c)) === rotulo) {
        if (k === alvoK) return c;
        k++;
      }
    }
    return null;
  }
  // path explícito (data-colab-path).
  return scope.querySelector<HTMLElement>(`[data-colab-path="${cssAttrEscape(path)}"]`);
}
