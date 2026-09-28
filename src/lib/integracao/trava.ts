// Integração — a TRAVA vista pelas outras telas (F4, spec §6/§8). Estado + campos marcados no retrato → colunas travadas do
// produto. Quem garante é o BANCO (gatilhos trg_zz_integracao_trava*); aqui só o espelho da tela (selo + disabled). PURO.
import { CAMPO_BY_KEY, ordenarCampos, type CampoKey } from "@/lib/integracao/campos";

export type EstadoModeloIntegracao = {
  estado: "integravel" | "integrado";
  campos: CampoKey[];
  marcadoEm: string | null;
  integradoEm: string | null;
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function lerEstados(raw: unknown): Record<string, EstadoModeloIntegracao> {
  const out: Record<string, EstadoModeloIntegracao> = {};
  for (const [id, v] of Object.entries(obj(raw))) {
    const o = obj(v);
    if (o.estado !== "integravel" && o.estado !== "integrado") continue;
    out[id] = {
      estado: o.estado,
      campos: ordenarCampos(
        Array.isArray(o.campos) ? o.campos.filter((c): c is string => typeof c === "string") : [],
      ),
      marcadoEm: txt(o.marcado_em),
      integradoEm: txt(o.integrado_em),
    };
  }
  return out;
}
/** Travam SEMPRE (marcados ou não — spec §8, B2/m085): "Tamanho em", SKUs, variantes do espelho e a exclusão. */
export const SEMPRE_TRAVADO = ["tamanho_tipo", "sku", "variantes", "excluir"] as const;
export function colunasTravadas(e: EstadoModeloIntegracao | null | undefined): ReadonlySet<string> {
  if (!e) return new Set();
  const s = new Set<string>(SEMPRE_TRAVADO);
  for (const k of e.campos) {
    const col = CAMPO_BY_KEY.get(k)?.coluna;
    if (col) s.add(col);
  }
  return s;
}
function fmtDia(iso: string | null, tz: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(d);
  return `${p.find((x) => x.type === "day")?.value ?? ""}/${p.find((x) => x.type === "month")?.value ?? ""}`;
}
// Fix round 1 (m4/M-4 das revisões) — data null (ou ilegível) NÃO vira "Integrado em — — travado" (dois traços feios,
// parecendo erro): omite o "em <dia>" inteiro e mostra só "Integrado — travado"/"Integrável — travado".
export function textoSelo(e: EstadoModeloIntegracao, tz: string): string {
  const rotulo = e.estado === "integrado" ? "Integrado" : "Integrável";
  const dia = fmtDia(e.estado === "integrado" ? e.integradoEm : e.marcadoEm, tz);
  return dia ? `${rotulo} em ${dia} — travado` : `${rotulo} — travado`;
}
export function textoExcluirTravado(estado: EstadoModeloIntegracao["estado"]): string {
  return estado === "integrado"
    ? "Excluir travado — produto integrado. Só o super admin desfaz a integração (aba Integração)."
    : "Excluir travado — produto integrável. Volte para não integrável (aba Integração) antes de excluir.";
}
export const TEXTO_TRAVA_SHEET =
  "Campos marcados na Integração ficam travados. BOM, CAD, grade de produção, custos e PCP continuam editáveis normalmente.";
// Fix round 1 (m5/M-2 das revisões) — texto ALINHADO com a decisão do dono (P-73): o BOM (cores/tamanhos do Tecido 1,
// grade) continua LIVRE para o INTERNO — só SKUs e "Tamanho em" travam de verdade (a trava de "cores"/"variantes" no
// banco é do ESPELHO comprado, não do BOM). O texto anterior prometia cor/tamanho travados, o que nunca foi verdade
// para o manufaturado — cor/tamanho novo no BOM fica sem SKU até o super admin desfazer a integração.
export const TEXTO_SKU_TRAVADO =
  'SKUs e "Tamanho em" travados pela Integração — mudar cores ou tamanhos no BOM não cria SKU novo até o super admin desfazer.';
export const TEXTO_PRECO_TRAVADO = "Preço travado pela Integração (integrável ou integrado).";
