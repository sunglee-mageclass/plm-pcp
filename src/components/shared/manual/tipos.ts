// Motor de conteúdo-como-dados do Manual (compartilhado) — tipos GENÉRICOS reusáveis pelo Manual da API (Integração) e pelo
// Manual de uso global. Extraído de src/components/integracao/manual-conteudo.ts (A1). O tipo `exemplo` NÃO entra aqui (é só da
// Integração — ver manual-conteudo.ts, que estende este `Bloco` com a sua própria união). Blocos customizados (ex.: o `exemplo`)
// são plugados no renderizador via `renderBlocos` (ver ManualRenderer.tsx).
export type Bloco =
  | { tipo: "p"; texto: string }
  | { tipo: "passos"; itens: string[] }
  | { tipo: "lista"; itens: string[] }
  | { tipo: "codigo"; titulo: string; codigo: string }
  | { tipo: "tabela"; cabecalho: string[]; linhas: string[][] }
  | { tipo: "faq"; itens: { p: string; r: string }[] }
  | { tipo: "imagem"; src: string; alt: string; legenda?: string };

export type SecaoManual = { id: string; titulo: string; blocos: Bloco[] };
