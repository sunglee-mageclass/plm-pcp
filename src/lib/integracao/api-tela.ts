// Integração — aba API (mockup 7/7b/7c/7d/7e/5b): leitura tolerante das chaves (NUNCA o hash — D32) e dos acessos (agregados
// por IP/minuto — D19), e os textos. PURO.
import type { StatusTone } from "@/components/shared/StatusBadge";
import { CONFIG_API, type ChaveConfigApi } from "@/lib/integracao/campos";

export type Chave = {
  id: string; nome: string; final: string; criadaPor: string; criadaEm: string | null; revogadaEm: string | null; ultimoUsoEm: string | null;
};
export type Acesso = {
  id: string; chave: string | null; final: string | null; ip: string | null; modo: string; status: string; tentativas: number;
  produtos: number | null; exemplos: number | null; linhas: number | null; quando: string | null;
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const lerChaves = (raw: unknown): Chave[] => arr(raw).map(obj).map((k) => ({
  id: txt(k.id) ?? "", nome: txt(k.nome) ?? "", final: txt(k.final) ?? "", criadaPor: txt(k.criada_por) ?? "—",
  criadaEm: txt(k.criada_em), revogadaEm: txt(k.revogada_em), ultimoUsoEm: txt(k.ultimo_uso_em),
}));
export const lerAcessos = (raw: unknown): Acesso[] => arr(raw).map(obj).map((a) => ({
  id: txt(a.id) ?? "", chave: txt(a.chave), final: txt(a.final), ip: txt(a.ip), modo: txt(a.modo) ?? "normal",
  status: txt(a.status) ?? "", tentativas: num(a.tentativas) ?? 1, produtos: num(a.produtos), exemplos: num(a.exemplos),
  linhas: num(a.linhas), quando: txt(a.quando),
}));
export function fmtData(iso: string | null, tz: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
  const v = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("day")}/${v("month")}/${v("year")}`;
}
// revisão T15 #4 (m5/m9, task review + code review): duas chaves podem ter o MESMO nome (ex.: depois de uma
// rotação — cria uma nova com o nome antigo e revoga a velha); o Log identifica uma chave por "nome + final"
// (D32/mockup), então Acessos precisa do mesmo par — só o nome não distingue. `final` já vem do servidor (nunca o
// hash) e é seguro de mostrar.
export function rotuloChaveAcesso(a: Acesso): string {
  if (a.status === "chave_invalida") return `Chave inválida (IP ${a.ip ?? "desconhecido"})`;
  if (a.status === "ip_bloqueado") return `IP bloqueado (${a.ip ?? "desconhecido"})`;
  // Gerar JSON (entrega manual): sem chave (`chave_id` NULL) — quem gerou está no detalhe/Log, aqui só o rótulo.
  if (a.modo === "manual") return "Gerar JSON (manual)";
  const nome = a.chave ? (a.final ? `${a.chave} ····${a.final}` : a.chave) : "—";
  return a.modo === "teste" ? `${nome} (modo teste)` : nome;
}
export function statusAcesso(a: Acesso): { texto: string; tom: StatusTone } {
  switch (a.status) {
    case "ok": return { texto: "OK", tom: "success" };
    case "teste": return { texto: "Teste", tom: "info" };
    case "chave_invalida": return { texto: `Rejeitada ×${a.tentativas}`, tom: "danger" };
    case "ip_bloqueado": return { texto: `IP bloqueado ×${a.tentativas}`, tom: "danger" };
    case "limite_excedido": return { texto: `Limite excedido ×${a.tentativas}`, tom: "warning" };
    case "loja_inativa": return { texto: "Loja inativa", tom: "danger" };
    // Release A2 (P-224 B+): chave válida chamando com `loja=` de OUTRA loja — nada entregue (agregado por chave×minuto)
    case "loja_nao_autorizada": return { texto: `Loja não autorizada ×${a.tentativas}`, tom: "danger" };
    case "reservado": return { texto: "Em andamento", tom: "neutral" };
    default: return { texto: a.status || "—", tom: "neutral" };
  }
}
export function entregaAcesso(a: Acesso): { produtos: string; linhas: string } {
  if (a.status === "teste") return { produtos: a.exemplos != null ? `${a.exemplos} exemplos` : "—", linhas: a.linhas != null ? String(a.linhas) : "—" };
  if (a.status !== "ok") return { produtos: "—", linhas: "—" };
  return { produtos: String(a.produtos ?? 0), linhas: String(a.linhas ?? 0) };
}
const MOTIVO_RECOMENDADO: Record<ChaveConfigApi, string> = {
  limite_por_minuto: "Acima disso o ERP pode sobrecarregar o site / abaixo, o programa do dev pode ficar lento.",
  max_por_pagina: "Páginas maiores deixam cada resposta mais pesada e lenta / menores pedem mais consultas.",
  validade_foto_dias: "Links que duram mais ficam válidos por mais tempo se vazarem / menos, o ERP precisa baixar as fotos logo.",
  bloqueio_tentativas: "Mais tentativas facilitam adivinhar uma chave / menos podem bloquear o ERP por um erro de digitação.",
};
export const textoForaRecomendado = (k: ChaveConfigApi): string => `Recomendado: ${CONFIG_API[k].recomendado}. ${MOTIVO_RECOMENDADO[k]}`;
export const TEXTO_NOVA_CHAVE_GUARDE = "Guarde esta chave agora. Por segurança, ela não pode ser mostrada de novo.";
export const TEXTO_REVOGAR = "O ERP perde o acesso na hora. Esta ação não pode ser desfeita — para usar de novo, é preciso criar outra chave.";
export const TEXTO_CONFIG_API =
  "Só o super admin edita. Valor fora da faixa permitida: erro na hora, Salvar desabilitado. Valor dentro da faixa mas fora do recomendado: alerta antes de salvar (com opção de voltar ao recomendado). Toda mudança fica no Log.";
export const TEXTO_FECHAR_SEM_COPIAR = "Você copiou a chave? Ela não pode ser mostrada de novo depois de fechar.";
// Release A2 (P-224 B+): toda chamada da API leva `loja=<código da loja>` — o dev precisa da chave E deste código.
export const TEXTO_CODIGO_LOJA =
  "Toda chamada da API precisa do parâmetro loja com este código (o da loja dona da chave). Sem ele: 400. Com o código de outra loja: 403 (loja_nao_autorizada) — nada é entregue e a chamada aparece em Acessos recentes. Entregue ao dev a chave E este código.";
/** Exemplo de chamada mostrado na aba API › Chaves (chave nunca aparece — vai um marcador). */
export function exemploChamadaApi(endereco: string, lojaId: string): string {
  return `curl "${endereco}/api/integracao/v1/produtos?loja=${lojaId}&limite=50" \\\n  -H "Authorization: Bearer <sua chave>"`;
}

// revisão T15 #3/m1 (task review I1 + code review m5): o banner de conflito da config da API ganha o MESMO padrão
// de 3 variantes de `CamposAba.tsx` (`TEXTO_CAMPOS_CONFLITO*`), mas com texto próprio — "os campos"/"a seleção" lá
// vira "as configurações"/"os valores" aqui. Constantes (não mais texto inline no componente), pra entrar na lista
// do painel do dono junto dos textos novos desta rodada.
export const TEXTO_CONFIG_API_CONFLITO =
  "Outra pessoa mudou as configurações da API — as suas mudanças foram mantidas por cima da versão nova.";
export const TEXTO_CONFIG_API_CONFLITO_SO_REV =
  "A configuração foi salva por outra pessoa enquanto você editava; as suas mudanças continuam aqui.";
export const TEXTO_CONFIG_API_CONFLITO_NADA_A_SALVAR = "A sua mudança já está salva na loja — não sobrou nada para salvar.";
/** revisão T15 #3/m1: monta "Validade das fotos: 7 → 14" (o que a OUTRA pessoa mudou, comparando a base ANTIGA
 *  com os valores frescos do servidor) — mesmo espírito de `diffCampos` em campos.ts, mas por VALOR numérico (não
 *  por marcado/desmarcado). Só entra na lista quem de fato mudou. */
export function diffConfigApi(baseAntiga: Record<ChaveConfigApi, number>, fresco: Record<ChaveConfigApi, number>): string {
  const partes: string[] = [];
  for (const k of Object.keys(CONFIG_API) as ChaveConfigApi[]) {
    if (baseAntiga[k] !== fresco[k]) partes.push(`${CONFIG_API[k].rotuloCurto}: ${baseAntiga[k]} → ${fresco[k]}`);
  }
  return partes.join(", ");
}
