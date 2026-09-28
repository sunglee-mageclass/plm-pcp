// Integração — API: o contrato com o banco (RespostaLer — _integracao_ler/integracao_exemplo, Task 6) e a montagem PURA da
// resposta pública (spec §7): {versao, modo, loja, colunas, gerado_em, pagina{limite, maximo}, linhas[{tipo, produto_id,
// loja_id, loja_nome, integrado_em, valores}], proximo_cursor}. `pagina` (D39, P-89 A): quantos produtos por página esta
// resposta usou e o máximo da loja HOJE — a loja pode mudar o máximo sem aviso; o programa do dev segue o cursor. Usada pela rota (Tasks 19/20) e pelo "Ver resposta de exemplo" do Manual. A
// coluna Foto (D5) chega do banco como LISTA de caminhos na linha do produto ([] nas sublinhas); quem chama decide o valor
// (links assinados, link público de exemplo ou null).
// Fix round 1 T16 (revisão m2) + fix round 2 (m2-R): quando o retrato do produto NÃO tinha a coluna Foto marcada
// na época em que ficou Integrável (P-93 A — colunas de uma página são a união; produto fora da união manda
// `null` nessa posição, D6), o valor cru já chega `null` — `montarResposta` PRESERVA esse `null` em vez de
// rechamar `o.foto([])`/`[]`, para não fingir "lista vazia de fotos" onde a coluna nem existia no retrato daquele
// produto. m2-R: `_integracao_valores` aplica esse `null` a TODAS as linhas do produto (m6:95), não só à do
// produto — a SUBLINHA (variante) também preserva `null`, consistente com o resto das colunas novas dela e com
// TEXTO_UNIAO_COLUNAS ("numa coluna nova, eles vêm com o valor vazio (null)"). `[]` só quando o retrato TINHA a
// coluna Foto mas o produto não tinha foto nenhuma (D5) — nesse caso o valor cru já vem `[]`, não `null`.
export type StatusLer = "ok" | "parametro_invalido" | "chave_invalida" | "loja_inativa" | "ip_bloqueado" | "limite_excedido";
export type ProdutoLer = {
  modelo_id: string; estado: string; assinatura: string | null; integrado_em: string | null;
  linhas: { tipo: "produto" | "variante"; loja_nome?: string | null; valores: unknown[] }[];
};
export type PaginaApi = { limite: number; maximo: number };
export type RespostaLer = {
  status: StatusLer; retry_after?: number | null; tenant_id?: string | null; modo?: "normal" | "teste"; acesso_id?: string;
  chave_id?: string; loja?: { id: string; nome: string }; colunas?: string[]; chaves_colunas?: string[]; produtos?: ProdutoLer[];
  proximo_cursor?: string | null; validade_foto_dias?: number; pagina?: PaginaApi;
};
export type LinhaApi = {
  tipo: "produto" | "variante"; produto_id: string; loja_id: string; loja_nome: string; integrado_em: string | null; valores: unknown[];
};
export type RespostaApi = {
  versao: 1; modo: "normal" | "teste"; loja: { id: string; nome: string }; colunas: string[]; gerado_em: string;
  pagina: PaginaApi | null; linhas: LinhaApi[]; proximo_cursor: string | null;
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

export function caminhosFoto(valores: unknown[], idx: number): string[] {
  const v = valores[idx];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
export function montarResposta(r: RespostaLer, o: OpcoesMontar): RespostaApi {
  const idxFoto = (r.chaves_colunas ?? []).indexOf("foto");
  const loja = r.loja ?? { id: r.tenant_id ?? "", nome: "" };
  const linhas: LinhaApi[] = [];
  for (const p of r.produtos ?? []) {
    if (o.incluir && !o.incluir(p.modelo_id)) continue;
    const integradoEm = o.integradoEm ? o.integradoEm(p.modelo_id) : (p.integrado_em ?? null);
    for (const l of p.linhas) {
      const valores = [...l.valores];
      if (idxFoto >= 0) {
        const bruto = l.valores[idxFoto];
        valores[idxFoto] = bruto === null ? null : l.tipo === "produto" ? o.foto(caminhosFoto(l.valores, idxFoto)) : [];
      }
      linhas.push({
        tipo: l.tipo, produto_id: p.modelo_id, loja_id: loja.id, loja_nome: l.loja_nome ?? loja.nome, integrado_em: integradoEm, valores,
      });
    }
  }
  return {
    versao: 1, modo: r.modo ?? "normal", loja, colunas: r.colunas ?? [], gerado_em: o.geradoEm,
    pagina: r.pagina ? { limite: r.pagina.limite, maximo: r.pagina.maximo } : null, linhas,
    proximo_cursor: r.proximo_cursor ?? null,
  };
}
