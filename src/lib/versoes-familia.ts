// P-152 — aviso de versões existentes no Replicar / Duplicar. Lógica PURA (sem supabase/React):
// agrupa as linhas de `modelos` por FAMÍLIA (`coalesce(modelo_base_id, id)`), decide se precisa
// confirmar e monta os rótulos. A leitura fica em `versoes-familia-query.ts`.
import { STORE_TIMEZONE } from "@/lib/timezone";

export type LinhaVersao = {
  id: string;
  nome: string;
  versao: number | null;
  modelo_base_id: string | null;
  colecao_id: string | null;
  /** Nome da coleção (embed `colecoes(nome)` ou o espelho de texto `modelos.colecao`). */
  colecao: string | null;
  subcolecao: string | null;
  created_at: string | null;
};

export type VersaoItem = LinhaVersao & {
  /** É um dos cards de origem (selecionados) — tag "(este)". */
  ehSelecionado: boolean;
};

export type GrupoFamilia = {
  raiz: string;
  nome: string;
  /** Todas as versões da família (ordenadas por versão, criação e id). */
  versoes: VersaoItem[];
};

export type Destino = { colecaoId: string | null; subcolecao: string | null };

export const raizDaFamilia = (l: Pick<LinhaVersao, "id" | "modelo_base_id">): string => l.modelo_base_id ?? l.id;

const normSub = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

/** Agrupa por família, SEM repetir família. Só entram famílias que têm ao menos um card selecionado
 *  (selecionado que não veio na consulta — sem acesso / apagado — é ignorado). */
export function agruparPorFamilia(linhas: LinhaVersao[], selecionados: string[]): GrupoFamilia[] {
  const sel = new Set(selecionados);
  const porId = new Map<string, LinhaVersao>();
  for (const l of linhas) porId.set(l.id, l);
  const raizesSel = new Set<string>();
  for (const id of sel) {
    const l = porId.get(id);
    if (l) raizesSel.add(raizDaFamilia(l));
  }
  const grupos = new Map<string, VersaoItem[]>();
  for (const l of porId.values()) {
    const r = raizDaFamilia(l);
    if (!raizesSel.has(r)) continue;
    const arr = grupos.get(r) ?? [];
    arr.push({ ...l, ehSelecionado: sel.has(l.id) });
    grupos.set(r, arr);
  }
  const out: GrupoFamilia[] = [];
  for (const [raiz, versoes] of grupos) {
    versoes.sort(
      (a, b) =>
        (a.versao ?? 1) - (b.versao ?? 1) ||
        (a.created_at ?? "").localeCompare(b.created_at ?? "") ||
        a.id.localeCompare(b.id),
    );
    const ref = versoes.find((v) => v.ehSelecionado) ?? versoes[0];
    out.push({ raiz, nome: ref.nome, versoes });
  }
  out.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.raiz.localeCompare(b.raiz));
  return out;
}

/** Aviso + confirmação só quando alguma família tem versão ALÉM dos cards de origem. */
export function precisaConfirmar(grupos: GrupoFamilia[]): boolean {
  return grupos.some((g) => g.versoes.some((v) => !v.ehSelecionado));
}

/** Famílias que NÃO têm outras versões (rodapé "N card(s) sem outras versões"). */
export function gruposComOutras(grupos: GrupoFamilia[]): GrupoFamilia[] {
  return grupos.filter((g) => g.versoes.some((v) => !v.ehSelecionado));
}

/** A versão já está na coleção/subcoleção escolhida como destino (só rótulo). */
export function estaNoDestino(v: Pick<LinhaVersao, "colecao_id" | "subcolecao">, destino: Destino | null): boolean {
  if (!destino || !destino.colecaoId) return false;
  return v.colecao_id === destino.colecaoId && normSub(v.subcolecao) === normSub(destino.subcolecao);
}

export function rotuloLocal(v: Pick<LinhaVersao, "colecao" | "subcolecao">): string {
  return `${v.colecao?.trim() || "Sem coleção"} › ${normSub(v.subcolecao) ?? "Sem subcoleção"}`;
}

/** dd/mm/aaaa no fuso da loja; NULL/inválida = "—". */
export function fmtDataCriacao(iso: string | null | undefined, tz: string = STORE_TIMEZONE): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")}`;
}

/** Chave estável da lista: a confirmação vale só para ESTA lista (muda a lista → desmarca). */
export function chaveGrupos(grupos: GrupoFamilia[]): string {
  return grupos.map((g) => `${g.raiz}:${g.versoes.map((v) => v.id).join(",")}`).join("|");
}

/** Botão Replicar/Duplicar liberado? Falha FECHADA: sem a lista (carregando/erro) nunca libera. */
export function podeProsseguir(s: { carregando: boolean; erro: boolean; precisa: boolean; confirmado: boolean }): boolean {
  if (s.carregando || s.erro) return false;
  return !s.precisa || s.confirmado;
}

/** Parte em lotes de `n`. */
export function emLotes<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
