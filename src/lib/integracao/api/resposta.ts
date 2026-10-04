// Integração — API: o contrato com o banco (RespostaLer — _integracao_ler/_integracao_ler_loja/integracao_exemplo) e a
// montagem PURA da resposta pública (spec §7).
// Release A2 (P-222 B / P-223 A, dono 03/out): a resposta é em OBJETOS chave-valor, com as variantes ANINHADAS no produto —
// {versao: 1, modo, loja{id,nome}, gerado_em, pagina{limite,maximo}, produtos[{produto_id, loja_id, loja_nome, integrado_em,
// <chave>: valor…, variantes[{produto_id, loja_id, loja_nome, integrado_em, <chave>: valor…}]}], proximo_cursor}. Saem
// `colunas` e `linhas`. As chaves são as chaves FIXAS do sistema (as de `chaves_colunas` que o banco já devolve — nome,
// ref_sku, preco_anterior, preco_venda, peso, ncm, preco_custo, cor_base, cor_apelido, tamanho, titulo, descricao, keywords,
// metatag, comprimento, largura, altura, foto, colecao, categoria_tecido, linha), na ordem do layout. As chaves presentes =
// união das chaves da página (mesma regra de antes: campo fora do retrato daquele produto = null, P-93 A/D6). A página
// conta por PRODUTO (a família nunca se divide — `_integracao_ler`), então cada produto leva TODAS as suas variantes;
// produto sem variantes ⇒ `variantes: []`. `pagina` (D39, P-89 A): quantos produtos por página esta resposta usou e o
// máximo da loja HOJE. Usada pela rota e pelo "Ver resposta de exemplo"/Manual (o exemplo nunca diverge do formato real).
// Foto (D5): chega do banco como LISTA de caminhos na linha do produto ([] nas sublinhas); quem chama decide o valor
// (links assinados, link público de exemplo ou null).
// m2/m2-R (mantido): quando o retrato do produto NÃO tinha a coluna Foto marcada na época em que ficou Integrável, o valor
// cru já chega `null` em TODAS as linhas do produto — `montarResposta` PRESERVA esse `null` no produto E nas variantes em
// vez de fingir "lista vazia" (`[]` só quando o retrato TINHA a coluna Foto e o produto não tinha foto nenhuma).
export type StatusLer =
  | "ok" | "parametro_invalido" | "chave_invalida" | "loja_inativa" | "loja_nao_autorizada" | "ip_bloqueado" | "limite_excedido";
export type ProdutoLer = {
  modelo_id: string; estado: string; assinatura: string | null; integrado_em: string | null;
  linhas: { tipo: "produto" | "variante"; loja_nome?: string | null; valores: unknown[] }[];
};
/** Gerar JSON: quem ficou de fora de uma geração e por quê (nao_integravel/reprovado/sem_custo vêm do banco; mudou = o
 *  produto voltou/foi desfeito entre a leitura e a confirmação). */
export type ForaGerarJson = {
  modelo_id: string; nome: string | null; ref: string | null; motivo: "nao_integravel" | "reprovado" | "sem_custo" | "mudou";
};
export type PaginaApi = { limite: number; maximo: number };
export type RespostaLer = {
  status: StatusLer; retry_after?: number | null; tenant_id?: string | null; modo?: "normal" | "teste" | "manual"; acesso_id?: string;
  chave_id?: string; loja?: { id: string; nome: string }; colunas?: string[]; chaves_colunas?: string[]; produtos?: ProdutoLer[];
  proximo_cursor?: string | null; validade_foto_dias?: number; pagina?: PaginaApi;
  /** Gerar JSON (modo manual): selecionados que NÃO entraram (a API nunca devolve). NUNCA vai para o arquivo/JSON público. */
  fora?: ForaGerarJson[];
};
/** Um item da resposta (produto ou variante): 4 campos de identificação + os campos chave-valor da página. */
export type ItemApi = {
  produto_id: string; loja_id: string; loja_nome: string; integrado_em: string | null; [campo: string]: unknown;
};
export type ProdutoApi = ItemApi & { variantes: ItemApi[] };
export type RespostaApi = {
  versao: 1; modo: "normal" | "teste" | "manual"; loja: { id: string; nome: string }; gerado_em: string;
  pagina: PaginaApi | null; produtos: ProdutoApi[]; proximo_cursor: string | null;
};
export type OpcoesMontar = {
  geradoEm: string;
  /** a LISTA de caminhos da coluna Foto de UMA linha de produto → o valor que vai na resposta */
  foto: (caminhos: string[]) => unknown;
  /** só estes produtos entram (normal: os confirmados pelo _integracao_confirmar); ausente = todos (teste/exemplo) */
  incluir?: (modeloId: string) => boolean;
  integradoEm?: (modeloId: string) => string | null;
};
export const CAMINHO_FOTO_EXEMPLO = "/integracao/exemplo-produto.svg";
/** Nomes que um campo da página NUNCA pode ter (são da identificação/aninhamento ou mexem no protótipo). A rota recusa
 *  (500) um `chaves_colunas` com um deles; `montarResposta` ainda assim nunca deixa um campo sobrescrever a identificação. */
export const CHAVES_RESERVADAS: ReadonlySet<string> = new Set([
  "produto_id", "loja_id", "loja_nome", "integrado_em", "variantes", "__proto__", "constructor", "prototype",
]);

export function caminhosFoto(valores: unknown[], idx: number): string[] {
  const v = valores[idx];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
export function montarResposta(r: RespostaLer, o: OpcoesMontar): RespostaApi {
  const chaves = r.chaves_colunas ?? [];
  const loja = r.loja ?? { id: r.tenant_id ?? "", nome: "" };
  const item = (
    p: ProdutoLer, integradoEm: string | null, l: ProdutoLer["linhas"][number] | undefined, ehProduto: boolean,
  ): ItemApi => {
    const ident: [string, unknown][] = [
      ["produto_id", p.modelo_id], ["loja_id", loja.id], ["loja_nome", l?.loja_nome ?? loja.nome], ["integrado_em", integradoEm],
    ];
    const campos: [string, unknown][] = [];
    chaves.forEach((k, i) => {
      if (CHAVES_RESERVADAS.has(k)) return;
      const bruto = l ? l.valores[i] : null;
      if (k === "foto") {
        // null = a coluna Foto não estava no retrato deste produto (preservado); senão: lista de links no produto, [] na variante
        campos.push([k, bruto === null || bruto === undefined ? null : ehProduto ? o.foto(caminhosFoto(l?.valores ?? [], i)) : []]);
      } else {
        campos.push([k, bruto === undefined ? null : bruto]);
      }
    });
    // Object.fromEntries cria propriedades PRÓPRIAS (nunca toca o protótipo) e mantém a ordem: identificação, depois campos
    return Object.fromEntries([...ident, ...campos]) as ItemApi;
  };
  const produtos: ProdutoApi[] = [];
  for (const p of r.produtos ?? []) {
    if (o.incluir && !o.incluir(p.modelo_id)) continue;
    const integradoEm = o.integradoEm ? o.integradoEm(p.modelo_id) : (p.integrado_em ?? null);
    const linhaProduto = p.linhas.find((l) => l.tipo === "produto");
    const variantes = p.linhas.filter((l) => l.tipo === "variante").map((l) => item(p, integradoEm, l, false));
    produtos.push({ ...item(p, integradoEm, linhaProduto, true), variantes });
  }
  return {
    versao: 1, modo: r.modo ?? "normal", loja, gerado_em: o.geradoEm,
    pagina: r.pagina ? { limite: r.pagina.limite, maximo: r.pagina.maximo } : null, produtos,
    proximo_cursor: r.proximo_cursor ?? null,
  };
}
