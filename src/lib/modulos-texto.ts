// Textos PT-BR de "precisa do módulo X" [modularidade F1] — funções PURAS, compartilhadas pelo `useRequerModulo`, pelo
// `<ModuloDesligadoAviso>` e pelo `erro-mensagem.ts` (que traduz o `modulo_desligado: a,b` do servidor). Rótulos = MODULE_ROTULO
// (fonte única); chave desconhecida = a própria chave (o texto nunca fica vazio).
import { MODULE_ROTULO } from "@/lib/permissions-catalog";
import type { ModuleKey } from "@/hooks/useTenantModules";

export function rotuloModulo(chave: string): string {
  return (MODULE_ROTULO as Record<string, string>)[chave] ?? chave;
}

/** "A", "A e B", "A, B e C". */
export function listaDeRotulos(chaves: readonly string[]): string {
  const r = chaves.map(rotuloModulo);
  if (r.length <= 1) return r.join("");
  return `${r.slice(0, -1).join(", ")} e ${r[r.length - 1]}`;
}

/** "o módulo A" / "os módulos A e B" (com a concordância do "do/dos"). */
export function modulosComArtigo(chaves: readonly string[], artigo: "o" | "do"): string {
  const plural = chaves.length > 1;
  const a = artigo === "o" ? (plural ? "os" : "o") : plural ? "dos" : "do";
  return `${a} ${plural ? "módulos" : "módulo"} ${listaDeRotulos(chaves)}`;
}

const FALE_COM_ADMIN = "fale com o administrador do sistema.";

/** Motivo pronto para InfoHover/aviso de botão desabilitado: "Precisa do módulo Entrada e Saída — fale com…". */
export function motivoModulos(faltam: readonly (ModuleKey | string)[]): string {
  if (faltam.length === 0) return "";
  return `Precisa ${modulosComArtigo(faltam, "do")} — ${FALE_COM_ADMIN}`;
}

/** Texto do erro do servidor (`modulo_desligado: a,b` e os textos legados "Módulo X não habilitado…"). */
export function textoAcaoPrecisaDeModulos(chaves: readonly string[]): string {
  return `Esta ação precisa ${modulosComArtigo(chaves, "do")} — ${FALE_COM_ADMIN}`;
}

/** `modulo_desligado: a,b` → ["a","b"] (ignora vazios e espaços). */
export function chavesDoModuloDesligado(msg: string): string[] {
  return msg
    .slice("modulo_desligado:".length)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Selo curto da condição do kanban que não se aplica à loja (Config da Loja › Requisitos): "não se aplica (módulo Produção desligado)". */
export function seloCondicaoNaoSeAplica(faltam: readonly (ModuleKey | string)[]): string {
  const plural = faltam.length > 1;
  return `não se aplica (${plural ? "módulos" : "módulo"} ${listaDeRotulos(faltam)} ${plural ? "desligados" : "desligado"})`;
}

/** Dica (hover) do selo acima. O card segue (a condição conta como cumprida). Religar o módulo faz a condição valer de novo,
 *  mas NÃO desfaz o que o avanço já revelou (ex.: a REF) — o texto não promete o contrário (T3 review I1). */
export function motivoCondicaoNaoSeAplica(faltam: readonly (ModuleKey | string)[]): string {
  return `Não se aplica: a loja não tem ${modulosComArtigo(faltam, "o")}. A condição conta como cumprida e o card segue. Religar o módulo faz a condição valer de novo, mas não desfaz o que o avanço já liberou (como a REF).`;
}
