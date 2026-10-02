// Integração — Log (N11): o que cada linha diz, em PT, a partir do `detalhe` jsonb gravado pelo banco. PURO.
import { brl } from "@/lib/format";
import { CHAVES_CONFIG_API, CONFIG_API, rotuloNaLista, type CampoKey } from "@/lib/integracao/campos";

export type LinhaLog = {
  id: string; acao: string; quem: string; quando: string | null; modeloId: string | null; modeloNome: string | null;
  detalhe: Record<string, unknown>;
};
export type PaginaLog = { pagina: number; porPagina: number; total: number; superAdmin: boolean; linhas: LinhaLog[] };
export const ROTULO_ACAO: Record<string, string> = {
  campos: "Campos", editar: "Editar", integrar: "Integrar", voltar: "Voltar", desfazer: "Desfazer", integrado: "Integrado",
  chave_criar: "Chave criar", chave_revogar: "Chave revogar", config_api: "Config. API",
};
export const TEXTO_LOG_NAO_SUPER =
  "Você vê só as ações de PRODUTO (editar, integrar, voltar, desfazer, integrado). Ações de campos, chaves e configurações da API são só do super admin.";

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function lerLog(raw: unknown): PaginaLog {
  const o = obj(raw);
  return {
    pagina: Number(o.pagina ?? 1), porPagina: Number(o.por_pagina ?? 50), total: Number(o.total ?? 0), superAdmin: o.super === true,
    linhas: arr(o.linhas).map(obj).map((x) => ({
      id: txt(x.id) ?? String(x.id ?? ""), acao: txt(x.acao) ?? "", quem: txt(x.quem) ?? "—", quando: txt(x.quando),
      modeloId: txt(x.modelo_id), modeloNome: txt(x.modelo_nome), detalhe: obj(x.detalhe),
    })),
  };
}

const ROTULO_COLUNA: Record<string, string> = {
  nome: "Nome", ref: "REF", preco_anterior: "Preço anterior", preco_venda: "Preço de venda", peso_kg: "Peso", ncm: "NCM",
  titulo_pagina: "Título para a página", descricao_produto: "Descrição", comprimento_cm: "Comprimento", largura_cm: "Largura",
  altura_cm: "Altura", fotos_modelo: "Fotos",
};
function valorColuna(col: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (col === "preco_anterior" || col === "preco_venda") return brl(Number(v));
  if (col === "peso_kg") return `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
  if (col.endsWith("_cm")) return `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} cm`;
  if (col === "fotos_modelo") return Array.isArray(v) ? `${v.length} foto(s)` : "—";
  return String(v);
}

export function textoDetalhe(l: LinhaLog): string {
  const d = l.detalhe;
  switch (l.acao) {
    case "integrar": return `Retrato com ${Number(d.campos ?? 0)} campos + ${Number(d.sublinhas ?? 0)} sublinhas`;
    case "integrado": return "A API confirmou a entrega";
    case "voltar": return "Voltou para não integrável";
    case "desfazer": return `Motivo: "${txt(d.motivo) ?? ""}"`;
    case "editar": {
      if (d.keywords) {
        const k = obj(d.keywords);
        return `Keywords da loja: "${txt(k.antes) ?? ""}" → "${txt(k.depois) ?? ""}" (salvo)`;
      }
      // Release I3 (P-220 A): reprocesso dos 3 campos informativos nos Integráveis (texto próprio).
      if (d.reprocesso === "campos_informativos") return "Retrato atualizado com Coleção, Categoria do Tecido Principal e Linha (valores de hoje)";
      // P-126 (reprocessamento cirúrgico do nome das sublinhas ao trocar a cor no nome / mudar cor no cadastro):
      // `Sistema (cor no nome das sublinhas)` grava {reprocesso:'nome_sublinhas_cor', exemplo:{antes,depois}, sublinhas}.
      // Follow-up do controlador: o banco loga TODO integrável reprocessado, mesmo sem mudança de nome
      // (sublinhas:0, nomes_antes:[], exemplo:null) — texto próprio, sem "→ (0 sublinhas)".
      if (d.reprocesso === "nome_sublinhas_cor") {
        if (Number(d.sublinhas ?? 0) === 0) return "Retrato atualizado com a regra nova do nome (sem mudança de nome)";
        const ex = obj(d.exemplo);
        return `Nome das sublinhas atualizado com a cor: "${txt(ex.antes) ?? ""}" → "${txt(ex.depois) ?? ""}" (${Number(d.sublinhas ?? 0)} sublinhas)`;
      }
      if (d.reprocesso) return "Retrato reprocessado pelo sistema";
      const partes = Object.entries(obj(d.campos)).map(([col, x]) => {
        const ad = obj(x);
        return `${ROTULO_COLUNA[col] ?? col}: ${valorColuna(col, ad.antes)} → ${valorColuna(col, ad.depois)}`;
      });
      return partes.length ? `${partes.join(" · ")} (salvo)` : "Editado (salvo)";
    }
    case "campos": {
      const antes = new Set(arr(d.antes).map(String));
      const depois = new Set(arr(d.depois).map(String));
      const add = [...depois].filter((k) => !antes.has(k)).map((k) => `Adicionado "${rotuloNaLista(k as CampoKey)}" à seleção`);
      const rem = [...antes].filter((k) => !depois.has(k)).map((k) => `Removido "${rotuloNaLista(k as CampoKey)}" da seleção`);
      return [...add, ...rem].join(" · ") || "Seleção salva sem mudança";
    }
    case "config_api": {
      const a = obj(d.antes);
      const b = obj(d.depois);
      const partes = CHAVES_CONFIG_API.filter((k) => a[k] !== b[k]).map((k) => `${CONFIG_API[k].rotuloCurto}: ${String(a[k] ?? "—")} → ${String(b[k] ?? "—")}`);
      return partes.join(" · ") || "Configurações salvas sem mudança";
    }
    case "chave_criar": return `Chave "${txt(d.nome) ?? ""}" criada`;
    case "chave_revogar": return `Chave "${txt(d.nome) ?? ""}" revogada`;
    default: return "—";
  }
}
