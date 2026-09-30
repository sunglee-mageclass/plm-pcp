// P-137 A (30/set) — a Categoria do CARD comprado vai para o produto espelho (Produto Acabado/Importado) pelo gatilho
// `fn_modelo_espelho_categoria` (migration 20261017100000). A ÚNICA recusa desse gatilho (P-142 B) é o produto COM pedido
// (OC) cuja categoria nova mudaria o grupo entre Acessórios e outro grupo (grade "UN" × grade por tamanho): o banco
// devolve P0001 ASCII `categoria_acessorio_com_pedido: …` e desfaz o UPDATE do card inteiro.
//
// Este módulo ESPELHA essa regra no front para a pré-checagem SÓ-LEITURA (R6 do G-plano) que o Sheet do Planejamento e a
// edição em lote rodam ANTES de qualquer gravação — sem ela, a grade da revenda (`salvar_grade_revenda`, que grava ANTES
// do cabeçalho) já teria comitado quando o banco recusasse (card meio salvo). A recusa do banco continua sendo a rede de
// segurança; a tela traduz o prefixo em `erro-mensagem.ts`.
//
// Regra (idêntica ao gatilho): só quando a CATEGORIA do card muda para um valor não-nulo (NULL nunca é copiado), a
// categoria nova tem grupo, o card é comprado (revenda → produtos_acabados/ocs_p_acabado; importado →
// produtos_importados/ocs_importado), o produto tem OC, o grupo do produto é DIFERENTE do grupo da categoria nova e
// só um dos dois é Acessórios (`ehGrupoAcessorio` ⇄ `_grupo_eh_acessorio`).
import { ehGrupoAcessorio } from "@/lib/produto-acabado";
import { ehOrigemComprada } from "@/lib/origem";

export const PREFIXO_CATEGORIA_ACESSORIO_PEDIDO = "categoria_acessorio_com_pedido:";

export const TEXTO_CATEGORIA_ACESSORIO_PEDIDO =
  "Este produto já tem pedido (OC) e a nova Categoria mudaria o grupo dele entre Acessórios e outro grupo — a grade do pedido deixaria de bater. Nada foi salvo. Escolha uma categoria do mesmo tipo de grupo ou desvincule a OC na tela do produto.";

/** Edição em lote: nomeia os cards barrados (o lote inteiro é recusado — 1 UPDATE só). */
export function textoBloqueioCategoriaLote(nomes: readonly string[]): string {
  const lista = nomes.map((n) => `"${n}"`).join(", ");
  const quem = nomes.length === 1 ? `O card ${lista} tem` : `${nomes.length} cards (${lista}) têm`;
  return `${quem} produto com pedido (OC) e a nova Categoria mudaria o grupo entre Acessórios e outro grupo — a grade do pedido deixaria de bater. Nada foi salvo. Tire esses cards da seleção ou escolha uma categoria do mesmo tipo de grupo.`;
}

/** Erro no MESMO formato da recusa do banco (code P0001 + prefixo) — `mensagemErro` traduz os dois igual. */
export function erroCategoriaAcessorioPedido(): Error & { code: string } {
  return Object.assign(new Error(`${PREFIXO_CATEGORIA_ACESSORIO_PEDIDO} produto com pedido nao pode trocar entre Acessorios e outro grupo pela Categoria do card`), { code: "P0001" });
}

/** Espelho PURO da recusa do gatilho para UM produto. */
export function cruzaAcessorioComPedido(o: {
  categoriaAntes: string | null;
  categoriaNova: string | null;
  grupoNovo: string | null;
  grupoNovoNome: string | null;
  grupoProduto: string | null;
  grupoProdutoNome: string | null;
  temPedido: boolean;
}): boolean {
  if (!o.categoriaNova || o.categoriaNova === o.categoriaAntes) return false; // categoria não mudou / NULL não copia
  if (!o.grupoNovo) return false;                                            // categoria sem grupo: gatilho não copia
  if (!o.temPedido) return false;
  if (o.grupoProduto === o.grupoNovo) return false;                          // grupo não muda
  return ehGrupoAcessorio(o.grupoProdutoNome) !== ehGrupoAcessorio(o.grupoNovoNome);
}

/** Sheet do Planejamento: só vale a ida ao servidor quando ESTE save troca a categoria de um card comprado já salvo.
 *  `categoriaPayload === undefined` = a coluna nem vai no payload. */
export function precisaConferirCategoria(o: {
  isEdit: boolean;
  origem: string | null | undefined;
  categoriaPayload: string | null | undefined;
  categoriaServidor: string | null | undefined;
}): boolean {
  if (!o.isEdit || !ehOrigemComprada(o.origem)) return false;
  if (o.categoriaPayload === undefined || o.categoriaPayload === null || o.categoriaPayload === "") return false;
  return o.categoriaPayload !== (o.categoriaServidor ?? null);
}

// Cliente mínimo (o `supabase` do app, ou um fake nos testes): `.from(t).select(c).in(col, vals)` / `.eq(col, v)`.
type Resp<T> = PromiseLike<{ data: T[] | null; error: unknown }>;
type Filtro<T> = { in: (col: string, vals: readonly string[]) => Resp<T>; eq: (col: string, v: string) => Resp<T> };
export type ClienteLeitura = { from: (tabela: string) => { select: (cols: string) => Filtro<any> } };

async function ler<T>(p: Resp<T>): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw error;
  return (data ?? []) as T[];
}

/**
 * Pré-checagem SÓ-LEITURA (nenhuma escrita): devolve os cards de `modeloIds` que o banco RECUSARIA se a categoria
 * deles virasse `categoriaNova` (com `origemNova` quando o mesmo save também troca a origem). Vazio = pode gravar.
 */
export async function conferirCategoriaAcessorioPedido(
  client: ClienteLeitura,
  o: { modeloIds: readonly string[]; categoriaNova: string | null | undefined; origemNova?: string | null },
): Promise<{ modeloId: string; nome: string }[]> {
  if (!o.categoriaNova || o.modeloIds.length === 0) return [];
  const [cat] = await ler<{ id: string; grupo_id: string | null }>(
    client.from("categorias_produto").select("id, grupo_id").eq("id", o.categoriaNova));
  const grupoNovo = cat?.grupo_id ?? null;
  if (!grupoNovo) return [];

  const cards = await ler<{ id: string; nome: string | null; origem: string | null; categoria_principal_id: string | null }>(
    client.from("modelos").select("id, nome, origem, categoria_principal_id").in("id", o.modeloIds));
  const mudam = cards
    .map((m) => ({ ...m, origemEfetiva: o.origemNova ?? m.origem }))
    .filter((m) => ehOrigemComprada(m.origemEfetiva) && m.categoria_principal_id !== o.categoriaNova);
  if (mudam.length === 0) return [];

  type Prod = { id: string; modelo_id: string; grupo_id: string | null };
  const idsRevenda = mudam.filter((m) => m.origemEfetiva === "revenda").map((m) => m.id);
  const idsImportado = mudam.filter((m) => m.origemEfetiva === "importado").map((m) => m.id);
  const pa = idsRevenda.length
    ? await ler<Prod>(client.from("produtos_acabados").select("id, modelo_id, grupo_id").in("modelo_id", idsRevenda)) : [];
  const pi = idsImportado.length
    ? await ler<Prod>(client.from("produtos_importados").select("id, modelo_id, grupo_id").in("modelo_id", idsImportado)) : [];
  const candidatos = [...pa.map((p) => ({ ...p, tipo: "PA" as const })), ...pi.map((p) => ({ ...p, tipo: "PI" as const }))]
    .filter((p) => p.grupo_id !== grupoNovo);
  if (candidatos.length === 0) return [];

  const idsGrupo = [...new Set([grupoNovo, ...candidatos.map((p) => p.grupo_id).filter((g): g is string => !!g)])];
  const grupos = await ler<{ id: string; nome: string | null }>(client.from("grupos_produto").select("id, nome").in("id", idsGrupo));
  const nomeGrupo = new Map(grupos.map((g) => [g.id, g.nome]));
  const cruzam = candidatos.filter((p) =>
    ehGrupoAcessorio(p.grupo_id ? nomeGrupo.get(p.grupo_id) : null) !== ehGrupoAcessorio(nomeGrupo.get(grupoNovo)));
  if (cruzam.length === 0) return [];

  const ocPa = cruzam.filter((p) => p.tipo === "PA").map((p) => p.id);
  const ocPi = cruzam.filter((p) => p.tipo === "PI").map((p) => p.id);
  const comPedido = new Set<string>([
    ...(ocPa.length ? await ler<{ produto_acabado_id: string }>(
      client.from("ocs_p_acabado").select("produto_acabado_id").in("produto_acabado_id", ocPa)) : []).map((r) => r.produto_acabado_id),
    ...(ocPi.length ? await ler<{ produto_importado_id: string }>(
      client.from("ocs_importado").select("produto_importado_id").in("produto_importado_id", ocPi)) : []).map((r) => r.produto_importado_id),
  ]);

  const nomeCard = new Map(mudam.map((m) => [m.id, m.nome ?? ""]));
  return cruzam
    .filter((p) => cruzaAcessorioComPedido({
      categoriaAntes: mudam.find((m) => m.id === p.modelo_id)?.categoria_principal_id ?? null,
      categoriaNova: o.categoriaNova ?? null,
      grupoNovo,
      grupoNovoNome: nomeGrupo.get(grupoNovo) ?? null,
      grupoProduto: p.grupo_id,
      grupoProdutoNome: p.grupo_id ? nomeGrupo.get(p.grupo_id) ?? null : null,
      temPedido: comPedido.has(p.id),
    }))
    .map((p) => ({ modeloId: p.modelo_id, nome: nomeCard.get(p.modelo_id) ?? "" }));
}
