// Seção "4. Códigos" do Sheet do Planejamento (F3.6 — spec 2026-09-25-sheet-planejamento-reorganizacao §5.1/§5.3; é a
// F3.5b da spec do SKU §4.3). Regras PURAS de exibição da matriz de SKUs que as RPCs `skus_modelo`/`gerar_skus_modelo`
// (F3.5a, migration 20261003100000) devolvem — sem I/O. O SKU é gerado e gravado SÓ no servidor (fonte única); aqui só se
// lê, agrupa, rotula, decide o selo e a 1ª geração automática pós-Salvar (o SKU digitado à mão vira "a gravar" —
// ./sku-previa.ts).
// F3.6 — o "Tamanho em" NÃO tem padrão da LOJA (nada na Config). Decisão P-25 do dono (25/set 14:57, corrige a leitura
// anterior "sem escolha"): todo produto NASCE marcado em Letra (front: `emptyDraft().tamanho_tipo`/
// `draftFromModeloRow` em modelo-shared.ts); o `tamanho_tipo` null que a matriz ainda pode trazer (status
// `sem_tamanho`, R23) é só o card LEGADO antes da migration T6 rodar no banco (que move o NULL existente p/ "letra").
// Siglas do rótulo vêm de consulta própria da tela (`useSiglasCores`), casadas pelo nome (R11).
import { ladoTamanho, type TamanhoTipo } from "@/lib/tamanho";
import { textoAviso, textoFalta, type SkuFalta } from "@/lib/sku-montar";
import { seloDeSecao, type SeloSecao } from "@/components/planejamento/planejamento-detail/ficha/selos-bom";

export type EstadoSku = "ok" | "manual" | "falta" | "pendente" | "divergente" | "conflito" | "vazio" | "orfa" | "salvo";
// Minor (2) da revisão Opus do Lote C — `desconhecido` é FAIL-CLOSED: status ausente/não reconhecido do jsonb da RPC
// (payload truncado, versão de servidor mais nova/antiga que o front não conhece ainda) NÃO deve virar "ok" — "ok" é o
// único status que habilita Regerar e o input do SKU (ver `editavel` em CodigosSecao.tsx e `deveGerarPrimeiraVez`
// abaixo). `desconhecido` trava os dois, como `sem_formato`/`aguardando_ref`.
export type StatusMatriz = "ok" | "sem_formato" | "aguardando_ref" | "sem_tamanho" | "desconhecido";
export type ConflitoSku = { modelo_id: string; nome: string | null; ref: string | null };
export type LinhaSku = {
  variante_key: string; variante_ordem: number | null; cor_nome: string | null; apelido_nome: string | null;
  tamanho_key: string; tamanho_ordem: number | null;
  id: string | null; sku: string | null; manual: boolean; rev: number | null;
  sku_previsto: string | null; faltas: SkuFalta[]; avisos: SkuFalta[]; conflito_com: ConflitoSku | null; estado: EstadoSku;
};
export type MatrizSkus = {
  status: StatusMatriz; tamanho_tipo: TamanhoTipo | null; tamanho_tipo_card: TamanhoTipo | null;
  linhas: LinhaSku[]; faltas: SkuFalta[]; avisos: SkuFalta[];
};

const ESTADOS: readonly string[] = ["ok", "manual", "falta", "pendente", "divergente", "conflito", "vazio", "orfa", "salvo"];
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const tipo = (v: unknown): TamanhoTipo | null => (v === "letra" || v === "numero" ? v : null);
function faltasDe(v: unknown): SkuFalta[] {
  if (!Array.isArray(v)) return [];
  return v.map(obj).map((f): SkuFalta => ({
    atributo: f.atributo === "cor_apelido" ? "cor_apelido" : f.atributo === "tamanho" ? "tamanho" : "cor_base",
    id: txt(f.id),
    nome: txt(f.nome),
  }));
}
function conflitoDe(v: unknown): ConflitoSku | null {
  const o = obj(v);
  return typeof o.modelo_id === "string" ? { modelo_id: o.modelo_id, nome: txt(o.nome), ref: txt(o.ref) } : null;
}

/** Lê o jsonb de `skus_modelo`/`gerar_skus_modelo`. Tolerante: com `status ≠ ok` a RPC só manda id/chaves/sku/manual/rev/
 *  estado por linha — o resto vira null/[]. */
export function lerMatriz(raw: unknown): MatrizSkus {
  const o = obj(raw);
  // Minor (2) — fail-closed: só os 4 status que a F3.5a/Task 6 realmente devolvem viram eles mesmos; qualquer outra
  // coisa (ausente, string desconhecida, versão futura) vira "desconhecido" — NUNCA "ok" (que destravaria Regerar/
  // input sem o servidor ter dito que está tudo certo).
  const status: StatusMatriz =
    o.status === "ok" || o.status === "sem_formato" || o.status === "aguardando_ref" || o.status === "sem_tamanho"
      ? o.status : "desconhecido";
  const linhas = (Array.isArray(o.linhas) ? o.linhas : []).map(obj).map((l): LinhaSku => ({
    variante_key: txt(l.variante_key) ?? "",
    variante_ordem: num(l.variante_ordem),
    cor_nome: txt(l.cor_nome),
    apelido_nome: txt(l.apelido_nome),
    tamanho_key: txt(l.tamanho_key) ?? "",
    tamanho_ordem: num(l.tamanho_ordem),
    id: txt(l.id),
    sku: txt(l.sku),
    manual: l.manual === true,
    rev: num(l.rev),
    sku_previsto: txt(l.sku_previsto),
    faltas: faltasDe(l.faltas),
    avisos: faltasDe(l.avisos),
    conflito_com: conflitoDe(l.conflito_com),
    estado: ESTADOS.includes(String(l.estado)) ? (l.estado as EstadoSku) : "vazio",
  }));
  return {
    status,
    tamanho_tipo: tipo(o.tamanho_tipo), // F3.6: sem fallback — null = sem escolha (R10)
    tamanho_tipo_card: tipo(o.tamanho_tipo_card),
    linhas,
    faltas: faltasDe(o.faltas),
    avisos: faltasDe(o.avisos),
  };
}

export type GrupoSku = { chave: string; ordem: number | null; cor: string | null; apelido: string | null; orfa: boolean; linhas: LinhaSku[] };

/** Uma linha de grupo por variante (a COR — R1 do SKU), na ordem que a RPC devolve (variante → tamanho; órfãs no fim). */
export function agruparPorVariante(linhas: readonly LinhaSku[]): GrupoSku[] {
  const out: GrupoSku[] = [];
  const porChave = new Map<string, GrupoSku>();
  for (const l of linhas) {
    const orfa = l.estado === "orfa";
    const chave = orfa ? "__orfa__" : l.variante_key;
    let g = porChave.get(chave);
    if (!g) {
      g = { chave, ordem: orfa ? null : l.variante_ordem, cor: orfa ? null : l.cor_nome, apelido: orfa ? null : l.apelido_nome, orfa, linhas: [] };
      porChave.set(chave, g);
      out.push(g);
    }
    g.linhas.push(l);
  }
  return out;
}

export type CorSigla = { id: string; nome: string; sigla: string | null };
export type ApelidoSigla = { cor_base_id: string | null; nome: string; sigla: string | null };
export type SiglasGrupo = { cor: string | null; apelido: string | null };

/** R11 — as siglas do rótulo por NOME (a matriz não traz os ids; `cores (tenant_id, nome)` e `cores_apelido (tenant_id,
 *  cor_base_id, nome)` são únicos): a cor pelo nome; o apelido pelo nome DENTRO da cor base. Sem casamento = sem sigla. */
export function siglasDoGrupo(g: GrupoSku, cores: readonly CorSigla[], apelidos: readonly ApelidoSigla[]): SiglasGrupo {
  if (g.orfa || !g.cor) return { cor: null, apelido: null };
  const cor = cores.find((c) => c.nome === g.cor) ?? null;
  const ape = cor && g.apelido ? apelidos.find((a) => a.cor_base_id === cor.id && a.nome === g.apelido) ?? null : null;
  return { cor: cor?.sigla || null, apelido: ape?.sigla || null };
}

/** "Variante 1 · Marrom (MAR) · apelido Canela (CAN)" / "… · sem apelido" (mockup); sigla ausente = só o nome (R11). */
export function rotuloVariante(g: GrupoSku, siglas: SiglasGrupo = { cor: null, apelido: null }): string {
  if (g.orfa) return "Fora da grade atual";
  const cor = g.cor ? `${g.cor}${siglas.cor ? ` (${siglas.cor})` : ""}` : "sem cor base";
  const ape = g.apelido ? `apelido ${g.apelido}${siglas.apelido ? ` (${siglas.apelido})` : ""}` : "sem apelido";
  return `Variante ${g.ordem ?? "—"} · ${cor} · ${ape}`;
}

/** O lado do tamanho que vale pelo "Tamanho em" do card (a chave interna segue "34|PPP"); sem escolha = a chave inteira. */
export function rotuloTamanho(tamanhoKey: string, tipo: TamanhoTipo | null): string {
  return tipo ? ladoTamanho(tamanhoKey, tipo) ?? tamanhoKey : tamanhoKey;
}

export type SituacaoSku = { tom: "neutral" | "info" | "warning" | "danger"; texto: string; cadastrar: boolean };

export function situacaoSku(l: LinhaSku): SituacaoSku {
  switch (l.estado) {
    case "manual": return { tom: "info", texto: "editado à mão", cadastrar: false };
    case "ok": return { tom: "neutral", texto: "automático", cadastrar: false };
    case "salvo": return { tom: "neutral", texto: "gravado", cadastrar: false };
    case "pendente": return { tom: "neutral", texto: "a gerar", cadastrar: false };
    case "divergente": return { tom: "info", texto: `Regerar muda para ${l.sku_previsto ?? "—"}`, cadastrar: false };
    case "falta": return { tom: "warning", texto: l.faltas.map(textoFalta).join(" · ") || "Falta sigla", cadastrar: true };
    case "conflito":
      return {
        tom: "danger",
        texto: l.conflito_com
          ? `já existe em ${l.conflito_com.nome ?? "outro produto"} (REF ${l.conflito_com.ref?.trim() || "—"})`
          : "SKU repetido",
        cadastrar: false,
      };
    case "orfa":
      return { tom: "neutral", texto: l.manual ? "fora da grade — editado à mão, fica" : "fora da grade — sai no Regerar", cadastrar: false };
    default: return { tom: "neutral", texto: "—", cadastrar: false };
  }
}

/** D4 do SKU: apelido sem sigla NÃO bloqueia (o SKU sai com a cor base) — só avisa. */
export function avisoSku(l: LinhaSku): string | null {
  return l.avisos.length > 0 ? l.avisos.map(textoAviso).join(" · ") : null;
}

/** 1ª geração automática (spec SKU §4.2; R12): card com REF (`status ok`), NENHUM SKU gravado e há linha a gerar.
 *  Minor (1) da revisão — guarda extra `tamanho_tipo_card !== null`: rede de segurança contra deploy fora de ordem
 *  (front novo antes da migration T6 rodar) ou uma volta de emergência que deixe a coluna NULL de novo no banco —
 *  `status="ok"` sozinho não garante que o servidor já decidiu um "Tamanho em" para ESTE card. */
export function deveGerarPrimeiraVez(m: MatrizSkus): boolean {
  return m.status === "ok" && m.tamanho_tipo_card !== null
    && m.linhas.length > 0 && m.linhas.every((l) => !l.id) && m.linhas.some((l) => l.estado === "pendente");
}

/** Texto do toast depois de `gerar_skus_modelo` (conflito = o servidor não gravou aquela linha — mensagem PT dele). */
export function resumoGeracao(raw: unknown): { erro: boolean; texto: string } {
  const o = obj(raw);
  const n = (k: string) => Number(o[k] ?? 0) || 0;
  const conflitos = Array.isArray(o.conflitos) ? o.conflitos.map(obj) : [];
  if (conflitos.length > 0) {
    const s = conflitos.length > 1 ? "s" : "";
    return { erro: true, texto: `${conflitos.length} SKU${s} não gravado${s}: ${txt(conflitos[0].mensagem) ?? "conflito"}` };
  }
  return { erro: false, texto: `SKUs gerados: ${n("criados")} novo(s), ${n("atualizados")} atualizado(s), ${n("removidos")} removido(s).` };
}

/** Selo da seção Códigos (spec §5.3): "N SKU(s) sem sigla" âmbar vence; seção sem linha nenhuma = sem selo (`seloDeSecao` —
 *  a seção não tem requisito de kanban). SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.2.8): algo "a gravar" vence
 *  tudo — o card ainda não gravou os SKUs. */
export function seloCodigos(m: MatrizSkus | null | undefined, temPrevia: boolean): SeloSecao | undefined {
  if (temPrevia) return { tone: "warn", texto: "prévia a gravar" };
  if (!m) return undefined;
  const conta = (e: EstadoSku) => m.linhas.filter((l) => l.estado === e).length;
  const nFalta = conta("falta");
  const nConflito = conta("conflito");
  const nPendente = conta("pendente");
  const informativo = ((): SeloSecao => {
    if (nFalta > 0) {
      return {
        tone: "warn", texto: `${nFalta} SKU${nFalta > 1 ? "s" : ""} sem sigla`,
        title: m.faltas.length > 0 ? m.faltas.map(textoFalta).join(" · ") : undefined,
      };
    }
    if (nConflito > 0) return { tone: "warn", texto: `${nConflito} em conflito` };
    // R23 — mesma precedência do servidor: sem formato → aguardando REF → sem "Tamanho em".
    if (m.status === "sem_formato") return { tone: "muted", texto: "sem formato de SKU" };
    if (m.status === "aguardando_ref") return { tone: "muted", texto: "aguardando REF" };
    // P-25 (dono 25/set) — "sem_tamanho" só existe em card LEGADO antes da migration T6 rodar (todo produto novo já
    // nasce em Letra); o texto não fala mais em "escolha" (não é mais uma escolha pendente do usuário, é um card
    // antigo aguardando a migration).
    if (m.status === "sem_tamanho") return { tone: "muted", texto: "aguardando migração do Tamanho em" };
    // Minor (2) — "desconhecido" (status ausente/não reconhecido) trava igual aos outros estados de espera.
    if (m.status === "desconhecido") return { tone: "muted", texto: "não foi possível ler o status" };
    if (nPendente > 0) return { tone: "muted", texto: `${nPendente} a gerar` };
    if (m.avisos.length > 0) return { tone: "info", texto: "aviso: apelido sem sigla", title: m.avisos.map(textoAviso).join(" · ") };
    const n = m.linhas.filter((l) => l.estado !== "orfa" && !!l.sku).length;
    return { tone: "ok", texto: `${n} SKU${n > 1 ? "s" : ""}` };
  })();
  return seloDeSecao(m.linhas.length === 0, null, informativo);
}
