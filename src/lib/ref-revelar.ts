/**
 * Leves L3 kanban #21 (P-211 A, dono 01/out): salvar a Config da Loja com a etapa NOVA de revelar a REF
 * (`tenant_config.ref_exibir_status`) mostra antes a prévia "N REFs serão reveladas (não voltam)" e revela na hora.
 *  - Prévia: RPC só leitura `ref_previa_revelar(_tenant_id, _ref_exibir_status)` (migration 20261027130000) — nada grava.
 *  - Revelação: dentro do `salvar_config_loja` (mesma transação do Salvar), com o MESMO helper do banco
 *    (`_ref_revelar_candidatos`); a resposta traz `refs_reveladas`.
 * `as any`: types.ts do Supabase ainda não conhece a RPC nova (regen pendente — padrão do repo). Erros sobem crus.
 */
import { supabase } from "@/integrations/supabase/client";

export const RPC_REF_PREVIA_REVELAR = "ref_previa_revelar" as const;

export type RefRevelarCard = {
  modelo_id: string;
  nome: string | null;
  ref_auto: string;
  status: string | null;
};
export type PreviaRefRevelar = {
  /** Etapa candidata (normalizada: vazio ⇒ "aprovado"). */
  etapa: string;
  total: number;
  /** Até `limite_amostra` cards (ordem por nome). */
  amostra: RefRevelarCard[];
  limite_amostra: number;
};

export async function refPreviaRevelar(
  tenantId: string,
  etapa: string | null,
): Promise<PreviaRefRevelar> {
  const { data, error } = await supabase.rpc(
    RPC_REF_PREVIA_REVELAR as any,
    {
      _tenant_id: tenantId,
      _ref_exibir_status: etapa,
    } as any,
  );
  if (error) throw error;
  const d = (data ?? {}) as Partial<PreviaRefRevelar>;
  return {
    etapa: String(d.etapa ?? "aprovado"),
    total: Number(d.total ?? 0),
    amostra: Array.isArray(d.amostra) ? (d.amostra as RefRevelarCard[]) : [],
    limite_amostra: Number(d.limite_amostra ?? 20),
  };
}

/** O Salvar leva a etapa da REF? (`mudancas` = o que `montarMudancas` mandaria à RPC; "" já virou `null`). */
export function etapaRefNoSalvar(
  mudancas: Record<string, unknown>,
): { valor: string | null } | null {
  if (!Object.prototype.hasOwnProperty.call(mudancas, "ref_exibir_status")) return null;
  const v = mudancas.ref_exibir_status;
  return { valor: typeof v === "string" ? v : null };
}

/**
 * Garantia "prévia antes de confirmar" (mesmo papel do `diffMudouDesdeAPrevia` do kanban): a etapa da REF que vai no Salvar
 * tem de ser a MESMA que a prévia conferiu. `conferida` = o que `prepararSalvar` conferiu (undefined = não conferiu nada).
 * true ⇒ abortar (nada gravado) e pedir um novo Salvar.
 */
export function etapaRefMudouDesdeAPrevia(
  conferida: { valor: string | null } | undefined,
  agora: { valor: string | null } | null,
): boolean {
  if (!agora) return false; // a etapa não vai neste Salvar
  return !conferida || conferida.valor !== agora.valor;
}

export const MENSAGEM_PREVIA_REF_MUDOU =
  "A etapa de revelar a REF mudou depois da prévia. Nada foi gravado — clique em Salvar de novo.";

/** "1 REF será revelada" / "N REFs serão reveladas". */
export function tituloRefsReveladas(n: number): string {
  return n === 1 ? "1 REF será revelada" : `${n} REFs serão reveladas`;
}

/** Toast do Salvar quando o servidor revelou REFs. */
export function toastRefsReveladas(n: number): string | null {
  if (!n || n <= 0) return null;
  return n === 1
    ? "Configurações salvas — 1 REF revelada."
    : `Configurações salvas — ${n} REFs reveladas.`;
}
