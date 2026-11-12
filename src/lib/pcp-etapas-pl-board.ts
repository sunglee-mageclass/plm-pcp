/**
 * Etapas PL (Onda 3, Task 9) — lógica PURA da rota `/pcp/etapas` (zero React, zero Supabase).
 *
 * Aqui ficam: a montagem do `ProdutoPlBoard` a partir da linha de `modelos` (com os embeds), o filtro da tela, o "pode mover?"
 * e a decisão de COMO gravar um mover (chave ligada = RPC `etapas_pl_mover`; desligada = UPDATE direto em `modelos`).
 * A regra de derivação/arraste mora em `etapas-pl-config.ts`/`etapas-pl-ui.ts` (e no servidor).
 */
import type { ProdutoPlBoard } from "@/components/producao/etapas/EtapaPlCard";
import type { EtapasPlConfig } from "./etapas-pl-config";
import { etapaDoProduto } from "./etapas-pl-ui";
import { atrasoPecaFoto, atrasoServico, piorAtraso, type Atraso } from "./servico-atraso";
import { isServicoPL } from "./servico-confeccao";

type Um<T> = T | T[] | null | undefined;

/** Linha de `producao_terceirizados` como vem do embed (campos ausentes = vazio). */
export type BlocoPlRow = {
  ativo?: boolean | null;
  interno?: boolean | null;
  categorias_terceirizado?: Um<{ nome?: string | null }>;
  empresa?: Um<{ nome_fantasia?: string | null }>;
  data_prevista?: string | null;
  data_entregue?: string | null;
  peca_foto?: boolean | null;
  peca_foto_previsao?: string | null;
  peca_foto_data?: string | null;
};

/** Linha de `modelos` do board PL (`colecao` já é o RÓTULO — `comRotuloColecaoLista`). */
export type ModeloPlRow = {
  id: string;
  ref: string | null;
  nome: string | null;
  colecao?: string | null;
  origem?: string | null;
  lancado?: boolean | null;
  status_etapa_pl: string | null;
  fotos_modelo?: string[] | null;
  desenho_tecnico_url?: string | null;
  croqui_url?: string | null;
  cad?: Um<{ producao_terceirizados?: BlocoPlRow[] | null }>;
};

/** O produto do board + o que a tela filtra (o board ignora os campos extras). */
export type ProdutoPlLinha = ProdutoPlBoard & {
  colecao: string | null;
  origem: string;
  /** Fornecedores (empresa) dos blocos de serviço ATIVOS do produto (dedup, sem vazio). */
  fornecedores: string[];
};

function um<T>(v: Um<T>): T | null {
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

/** Monta o produto do board. Atraso: serviço = QUALQUER bloco ativo; peça de foto = bloco ativo EXTERNO de serviço PL e só com o
 *  módulo `etapas_pl` (a rota já exige o módulo, mas mantém a regra de `atrasosDoProduto`). */
export function montarProdutoPl(m: ModeloPlRow, hojeISO: string, comEtapasPl = true): ProdutoPlLinha {
  const blocos = (um(m.cad)?.producao_terceirizados ?? []).filter((b) => b.ativo !== false);
  const atrasosServico: Atraso[] = [];
  const atrasosFoto: Atraso[] = [];
  const fornecedores = new Set<string>();
  for (const b of blocos) {
    atrasosServico.push(atrasoServico(b, hojeISO));
    const nome = um(b.categorias_terceirizado)?.nome || "Serviço";
    if (comEtapasPl && !b.interno && isServicoPL(nome)) atrasosFoto.push(atrasoPecaFoto(b, hojeISO));
    const emp = um(b.empresa)?.nome_fantasia;
    if (emp) fornecedores.add(emp);
  }
  return {
    id: m.id,
    nome: m.nome,
    ref: m.ref,
    status_etapa_pl: m.status_etapa_pl,
    lancado: m.lancado === true,
    fotoFontes: [m.fotos_modelo?.[0] ?? null, m.desenho_tecnico_url ?? null, m.croqui_url ?? null],
    atrasoServico: piorAtraso(atrasosServico),
    atrasoPecaFoto: piorAtraso(atrasosFoto),
    colecao: m.colecao ?? null,
    origem: m.origem ?? "interno",
    fornecedores: [...fornecedores],
  };
}

export type FiltrosPl = {
  busca: string;
  colecao: string[];
  fornecedor: string[];
  origem: string[];
  /** Ids de `etapaPlFiltroOpts`: keys das colunas + `__lancado`. */
  etapa: string[];
};

/** Filtro da tela. `etapa` usa o MESMO selo que o card mostra (`etapaDoProduto`) — filtro e selo nunca divergem. */
export function filtrarProdutosPl(
  lista: readonly ProdutoPlLinha[], f: FiltrosPl, cfg: EtapasPlConfig, ligado: boolean,
): ProdutoPlLinha[] {
  const q = f.busca.trim().toLowerCase();
  return lista.filter((p) => {
    if (q && !`${p.ref ?? ""} ${p.nome ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.colecao.length && !f.colecao.includes(p.colecao ?? "")) return false;
    if (f.fornecedor.length && !p.fornecedores.some((e) => f.fornecedor.includes(e))) return false;
    if (f.origem.length && !f.origem.includes(p.origem)) return false;
    if (f.etapa.length) {
      const selo = etapaDoProduto(cfg, p.status_etapa_pl, p.lancado === true ? { lancado: true } : {}, ligado);
      if (!f.etapa.includes(selo.key)) return false;
    }
    return true;
  });
}

/** Contagem por etapa para o resumo (colunas do board na ordem + "Finalizado"); usa o mesmo selo do filtro. */
export function contarPorEtapaPl(
  lista: readonly ProdutoPlLinha[], opts: { id: string; label: string }[], cfg: EtapasPlConfig, ligado: boolean,
): { id: string; label: string; count: number }[] {
  const cont = new Map<string, number>();
  for (const p of lista) {
    const k = etapaDoProduto(cfg, p.status_etapa_pl, p.lancado === true ? { lancado: true } : {}, ligado).key;
    cont.set(k, (cont.get(k) ?? 0) + 1);
  }
  return opts.map((o) => ({ ...o, count: cont.get(o.id) ?? 0 }));
}

/** O board só deixa arrastar com: permissão de editar + config LIDA (sem carregando/erro) + (chave desligada OU condições
 *  carregadas — sem elas a dica de arraste enganaria). Qualquer erro de carga trava (P-57). */
export function podeMoverPl(a: {
  podeEditar: boolean; cfgCarregando: boolean; cfgErro: boolean; ligado: boolean; condicoesProntas: boolean; cardsErro: boolean;
}): boolean {
  if (!a.podeEditar || a.cfgCarregando || a.cfgErro || a.cardsErro) return false;
  return !a.ligado || a.condicoesProntas;
}

/** Como gravar o mover: ligada = RPC (o servidor decide; `etapas_pl_mover` recusa com a chave desligada); desligada = a pessoa
 *  decide — UPDATE direto de `modelos.status_etapa_pl` (sem prévia, como o Dev com a chave off). */
export function modoGravarMoverPl(ligado: boolean): "rpc" | "direto" {
  return ligado ? "rpc" : "direto";
}

/** A RPC recusou por a chave estar DESLIGADA no servidor (a tela leu "ligada" velha): a config deve ser relida. */
export function ehRecusaChaveDesligadaPl(e: unknown): boolean {
  const x = e as { code?: string; message?: string } | null;
  return x?.code === "P0001" && String(x?.message ?? "").startsWith("etapas_pl_manual");
}
