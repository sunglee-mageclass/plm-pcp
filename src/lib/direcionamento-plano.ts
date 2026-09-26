// Distribuição por produto → Direcionamento (spec R21–R24, R34, R38): tipos da RPC `direcionamento_plano_modelo`, leitura do
// plano por variante e a REGRA do semi-preenchimento (P-12 revista). PURO. O servidor do Direcionamento NÃO muda
// (invariante #10): isto só monta o RASCUNHO; o Confirmar segue exigindo Σ = Grade Real (RAISE P0001 no servidor).
import { pathDirCel } from "@/lib/colab/merge-grade-dir";

export type PlanoLoja = { loja_id: string; nome: string; ativo: boolean; is_default: boolean; ordem: number | null };
export type PlanoVariante = { variante_numero: number | null; variante_tecido_id: string | null; cor_nome: string | null; apelido_nome: string | null };
export type PlanoCelula = { loja_id: string; variante_numero: number; grades: Record<string, number> };
export type PlanoModelo = {
  tamanho_tipo: "letra" | "numero";
  tamanhos: string[];
  lojas: PlanoLoja[];
  variantes: PlanoVariante[];
  celulas: PlanoCelula[];
  sem_correspondencia: { cor_nome: string | null; apelido_nome: string | null; total: number }[];
};
export type MotivoSemPlano = "modulo_desligado" | "comprado" | "sem_plano_tecido" | "sem_distribuicao";
export type PlanoModeloResp = { subcolecao: string | null; direcionados: number; plano: PlanoModelo | null; motivo_sem_plano: MotivoSemPlano | null };

export const TEXTO_MOTIVO_SEM_PLANO: Record<MotivoSemPlano, string> = {
  modulo_desligado: "o módulo Distribuição está desligado",
  comprado: "produto comprado (revenda/importado) fica fora desta entrega",
  sem_plano_tecido: "o modelo não está no Plan. Tecido desta coleção",
  sem_distribuicao: "o modelo não foi distribuído no Plan. Tecido",
};

/** Quantidade do plano numa célula; null = a loja não tem essa cor no plano ("—"). */
export function celulaPlano(plano: PlanoModelo | null, lojaId: string, vnum: number, t: string): number | null {
  const c = plano?.celulas.find((x) => x.loja_id === lojaId && x.variante_numero === vnum);
  if (!c) return null;
  return Number(c.grades?.[t] ?? 0) || 0;
}

/** Σ do plano de UMA variante por tamanho (opcionalmente só nas lojas dadas). */
export function totalPlanoVariante(plano: PlanoModelo | null, vnum: number, lojaIds?: string[]): { porTamanho: Record<string, number>; total: number } {
  const porTamanho: Record<string, number> = {};
  let total = 0;
  for (const c of plano?.celulas ?? []) {
    if (c.variante_numero !== vnum || (lojaIds && !lojaIds.includes(c.loja_id))) continue;
    for (const [t, q] of Object.entries(c.grades ?? {})) {
      const n = Number(q) || 0;
      porTamanho[t] = (porTamanho[t] ?? 0) + n;
      total += n;
    }
  }
  return { porTamanho, total };
}

/** Colunas da tabela do plano (R34): tamanhos da Grade Real ∪ tamanhos com plano > 0, na ordem da grade da loja. */
export function tamanhosDoPlano(ordem: string[], tamanhosReal: string[], plano: PlanoModelo | null): string[] {
  const set = new Set(tamanhosReal);
  for (const c of plano?.celulas ?? []) for (const [t, q] of Object.entries(c.grades ?? {})) if ((Number(q) || 0) > 0) set.add(t);
  const ordenados = ordem.filter((t) => set.has(t));
  const extras = [...set].filter((t) => !ordem.includes(t)).sort();
  return [...ordenados, ...extras];
}

export type Pendente = { variante_numero: number; tamanho: string; real: number; plano: number };
export type Preenchimento = {
  linhas: Record<number, Record<string, Record<string, number>>>;
  pendentes: Pendente[];
  doPlano: string[];
  escritas: string[];
};

/** Valor de uma célula na BASE (o que está salvo no servidor); ausente ≡ 0 (mesma regra do merge 3-vias). */
type BaseCel = Record<number, Record<string, Record<string, number>>>;
const valorBase = (base: BaseCel | undefined, vn: number, lojaId: string, t: string): number =>
  Number(base?.[vn]?.[lojaId]?.[t] ?? 0) || 0;

/** Regra do semi-preenchimento (R22), por variante × tamanho da Grade Real, só nas lojas EDITÁVEIS daquela variante:
 *  Σ plano = real ⇒ cada loja recebe o plano (0 onde a loja não tem a cor); ≠ ⇒ a célula fica VAZIA em todas as lojas
 *  (pendente — "distribua à mão"). Nunca inventa rateio. `doPlano` = as que o plano preencheu (azul-claro até editar).
 *  `escritas` = só as células cujo valor DIFERE da `base` (o que está salvo no servidor; ausente ≡ 0) — pendentes
 *  (ficam vazias/undefined) e células que o plano escreveu IGUAIS à base (ex.: 0 numa loja sem essa cor, quando a
 *  base também já é 0) NÃO entram: marcá-las como "minhas" faria o merge 3-vias acusar conflito falso quando outra
 *  pessoa salva um valor ali — o rascunho não tocou aquela célula de fato (T7 fix2, I1). `base` é opcional (default:
 *  tudo 0/ausente, como na 1ª hidratação sem `existing`). */
export function preencherComPlano(a: {
  variantes: { variante_numero: number; real: Record<string, number> }[];
  tamanhos: string[];
  lojas: { id: string }[];
  podeEditar: (lojaId: string, vnum: number) => boolean;
  plano: PlanoModelo | null;
  base?: BaseCel;
}): Preenchimento {
  const linhas: Preenchimento["linhas"] = {};
  const pendentes: Pendente[] = [];
  const doPlano: string[] = [];
  const escritas: string[] = [];
  for (const v of a.variantes) {
    const vn = v.variante_numero;
    const editaveis = a.lojas.map((l) => l.id).filter((id) => a.podeEditar(id, vn));
    linhas[vn] = {};
    for (const t of a.tamanhos) {
      const real = Number(v.real?.[t] ?? 0) || 0;
      const plano = editaveis.reduce((s, id) => s + (celulaPlano(a.plano, id, vn, t) ?? 0), 0);
      if (real === plano) {
        for (const id of editaveis) {
          const q = celulaPlano(a.plano, id, vn, t) ?? 0;
          (linhas[vn][id] ??= {})[t] = q;
          doPlano.push(pathDirCel(vn, id, t));
          if (q !== valorBase(a.base, vn, id, t)) escritas.push(pathDirCel(vn, id, t));
        }
      } else {
        pendentes.push({ variante_numero: vn, tamanho: t, real, plano });
        // Pendente = célula fica VAZIA (undefined) — nunca escreve valor nenhum, então nunca é "minha" edição.
      }
    }
  }
  return { linhas, pendentes, doPlano, escritas };
}

/** Nota por pendência (mockup). */
export const textoPendencia = (rotulo: string, p: Pendente): string =>
  `${rotulo}: plano ${p.plano} · real ${p.real} → distribua à mão as ${p.real} peças entre as lojas. Nenhuma loja veio preenchida porque não dá para saber de qual tirar.`;
