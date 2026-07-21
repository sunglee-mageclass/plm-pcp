export function classeCopiado(campos: Set<string>, chave: string): string {
  return campos.has(chave) ? "bg-yellow-100 dark:bg-yellow-900/30" : "";
}
