// Integração — API `GET /api/integracao/v1/produtos` (spec §7, R7). Handler PURO com dependências injetadas (a rota real
// injeta Supabase service role + Workers — Task 20). Fluxo: teto por IP (binding) → chave (Bearer; ausente = hash de vazio,
// que registra a tentativa) → parâmetros → _integracao_ler (fase 1) → fotos: prefixo da loja (inv. #2) + links assinados
// (validade_foto_dias) → _integracao_confirmar (fase 2) → responde SÓ os confirmados → limpeza de 90 dias FORA do caminho
// (n4/D20). Erros: corpo ASCII mínimo; nunca a chave, nunca texto interno (nem em 500).
// Fix round 1 (revisão Opus I1-I3 + code-reviewer M1-M10): guarda de caminho de foto fail-closed e sem travessia (I1/m1);
// limpeza da fase de 90 dias isolada de qualquer exceção síncrona/assíncrona (I2/M3); parâmetro desconhecido/repetido
// invalida a requisição (I3, em parametros.ts); status de confirmar fora de ok/chave_invalida/loja_inativa vira 500 (m2);
// Retry-After sempre um inteiro são entre 1 e 3600 (m3/M4); IP só de cf-connecting-ip, nunca X-Forwarded-For (m4/M5);
// contagem de fotos descartadas/ausentes sobre o mesmo conjunto de caminhos únicos (m7/M7); lookup de status por
// Object.hasOwn, imune à cadeia do protótipo (m8/M8); modo devolvido pelo banco tem que bater com o pedido, senão 500
// sem chamar confirmar (m9); headers x-content-type-options sempre, www-authenticate só no 401 (m10/M9). Nenhum log foi
// adicionado (ruling M10): um 500 nunca despeja detalhe algum, para a chave jamais vazar por essa via.
// Release A2 (P-222 B/P-223 A/P-224 B+, dono 03/out): `loja=<uuid>` obrigatório (parametros.ts: ausente/malformado = 400 sem
// tocar no banco); a fase 1 chama `_integracao_ler_loja` (loja ≠ loja da chave ⇒ 403 loja_nao_autorizada: nada entregue,
// nada confirmado, registrado no Log de acessos, sem contar no bloqueio de IP nem no limite por minuto); a resposta sai em
// objetos chave-valor com as variantes aninhadas (resposta.ts). A confirmação (fase 2) não mudou.
import { lerParametros } from "./parametros";
import { CAMINHO_FOTO_EXEMPLO, CHAVES_RESERVADAS, caminhosFoto, montarResposta, type RespostaLer } from "./resposta";

export type Confirmacao = { status: string; confirmados: { modelo_id: string; integrado_em: string }[] };
export type DepsRota = {
  hashChave: (chave: string) => Promise<string>;
  ler: (a: {
    hash: string; loja: string; incluir: boolean; cursor: string | null; limite: number | null; modo: "normal" | "teste"; ip: string;
  }) => Promise<RespostaLer>;
  assinarFotos: (caminhos: string[], validadeSegundos: number) => Promise<Map<string, string | null>>;
  confirmar: (chaveId: string, acessoId: string, entrega: { produtos: { modelo_id: string; assinatura: string | null }[]; fotos_descartadas: number; fotos_ausentes: number }) => Promise<Confirmacao>;
  limpar: (tenantId: string | null) => Promise<void>;
  depois: (p: Promise<unknown>) => void;
  tetoIp: (ip: string) => Promise<boolean>;
  agora: () => Date;
  origem: string;
};
export const CABECALHOS_JSON = {
  "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
} as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function respostaErro(status: number, erro: string, retryAfter?: number | null): Response {
  const h: Record<string, string> = { ...CABECALHOS_JSON };
  if (status === 429) h["retry-after"] = String(clampRetry(retryAfter ?? null));
  if (status === 401) h["www-authenticate"] = "Bearer";
  if (status === 405) h.allow = "GET";
  return new Response(JSON.stringify({ erro }), { status, headers: h });
}
function clampRetry(x: number | null): number {
  if (x == null || !Number.isFinite(x)) return 60;
  return Math.min(3600, Math.max(1, Math.ceil(x)));
}
const HTTP: Record<string, number> = {
  parametro_invalido: 400, chave_invalida: 401, loja_inativa: 403, loja_nao_autorizada: 403, ip_bloqueado: 429, limite_excedido: 429,
};
function httpDe(status: string): { codigo: number; erro: string } {
  if (Object.hasOwn(HTTP, status)) return { codigo: HTTP[status], erro: status };
  return { codigo: 500, erro: "erro_interno" };
}
// M3 (ruling): a chave de bucket do TETO POR IP (rate-limit binding do Workers, não o limite por CHAVE do banco —
// esse continua recebendo o IP INTEIRO). Um /64 é a menor faixa que um provedor tipicamente delega a UM cliente;
// sem isso, um cliente com um /64 poderia rotacionar o sufixo e ganhar um bucket 600/60s novo por endereço.
// IPv4 e o literal "desconhecido" voltam inalterados (não têm essa granularidade de prefixo).
export function chaveTetoIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  const hextetos = expandirIPv6(ip);
  return `${hextetos.slice(0, 4).join(":")}::/64`;
}
// Expande a compressão "::" de um IPv6 para 8 hextetos de 4 dígitos hex minúsculos (sem normalizar zeros à
// esquerda além disso — só precisamos dos 4 primeiros para o /64). Entrada fora do formato (não deveria
// acontecer: só chega aqui um endereço já validado pelo runtime) devolve os hextetos que conseguir separar.
function expandirIPv6(ip: string): string[] {
  const semZona = ip.split("%")[0] ?? ip;
  const partes = semZona.split("::");
  const norm = (s: string) => (s === "" ? [] : s.split(":").map((h) => h.toLowerCase()));
  const esquerda = norm(partes[0] ?? "");
  const direita = partes.length > 1 ? norm(partes[1] ?? "") : [];
  if (partes.length === 1) return esquerda;
  const faltam = Math.max(0, 8 - esquerda.length - direita.length);
  return [...esquerda, ...Array(faltam).fill("0"), ...direita];
}
// I1/m1: só assina/entrega foto sob o prefixo CANÔNICO da própria loja — sem barra vazia, "." ou ".." em qualquer
// segmento, sem "\", "%" ou caracteres de controle (C0 e DEL/\u007f -- N6). tenant_id ausente/fora do formato uuid
// falha fechado (nada passa).
function daLoja(caminho: string, tenantId: string | null | undefined): boolean {
  if (typeof tenantId !== "string" || !UUID.test(tenantId)) return false;
  const prefixo = `${tenantId}/`;
  if (!caminho.startsWith(prefixo)) return false;
  if (/[\\%\u0000-\u001f\u007f]/.test(caminho)) return false;
  return caminho.slice(prefixo.length).split("/").every((s) => s !== "" && s !== "." && s !== "..");
}
// I2/M3: agenda a limpeza SEM nunca deixar uma exceção (síncrona ou assíncrona) tocar a resposta já decidida.
function agendarLimpeza(deps: DepsRota, tenantId: string | null): void {
  try {
    deps.depois(Promise.resolve().then(() => deps.limpar(tenantId)).catch(() => undefined));
  } catch {
    // ignorado de propósito: limpeza nunca pode afetar a resposta (nem via depois, nem via limpar).
  }
}
// M3 (fix round 2): `_integracao_ler` tem contrato de retornar `produtos[].linhas[]` e `linhas[].valores[]` como
// ARRAYS de verdade; um valor fora do formato (ex.: `linhas` como STRING) não dá erro ao iterar com `for...of`
// (uma string É iterável — percorre caractere a caractere sem lançar), então sem esta checagem o handler
// produziria um corpo corrompido em vez de falhar fechado. Falha aqui SEMPRE cai no catch-all (500 erro_interno)
// — nunca tenta "consertar" ou seguir com um formato inesperado.
// Release A2: como a resposta agora é objeto chave-valor com variantes aninhadas, o contrato fica mais estrito — cada
// produto tem EXATAMENTE 1 linha "produto" e o resto "variante" (senão o aninhamento perderia/inventaria dados), e as
// chaves (`chaves_colunas`) são textos simples [a-z0-9_] fora dos nomes reservados da identificação (produto_id, loja_id,
// loja_nome, integrado_em, variantes) e do protótipo — fora disso, 500 fail-closed.
function validarFormato(r: RespostaLer): void {
  if (r.chaves_colunas !== undefined) {
    if (!Array.isArray(r.chaves_colunas)) throw new Error("formato invalido: chaves");
    for (const k of r.chaves_colunas) {
      if (typeof k !== "string" || !/^[a-z][a-z0-9_]*$/.test(k) || CHAVES_RESERVADAS.has(k)) throw new Error("formato invalido: chave");
    }
    if (new Set(r.chaves_colunas).size !== r.chaves_colunas.length) throw new Error("formato invalido: chave repetida");
  }
  if (r.produtos !== undefined && !Array.isArray(r.produtos)) throw new Error("formato invalido: produtos");
  for (const pr of r.produtos ?? []) {
    if (!Array.isArray(pr.linhas)) throw new Error("formato invalido: linhas");
    let nProduto = 0;
    for (const l of pr.linhas) {
      if (!Array.isArray(l.valores)) throw new Error("formato invalido: valores");
      if (l.tipo === "produto") nProduto += 1;
      else if (l.tipo !== "variante") throw new Error("formato invalido: tipo");
    }
    if (nProduto !== 1) throw new Error("formato invalido: linha do produto");
  }
}

export async function tratarRequisicao(req: Request, deps: DepsRota): Promise<Response> {
  try {
    // CR-I1 (fix round 1): método diferente de GET vira 405 ANTES de qualquer hash/dep — a rota já bloqueia
    // HEAD/ANY, mas esta é a defesa em profundidade do handler PURO (qualquer chamador futuro, inclusive de
    // teste, também não roda a fase 2/confirmar por engano num método que não seja GET).
    if (req.method !== "GET") return respostaErro(405, "metodo_invalido");
    // m4 (ruling): só cf-connecting-ip (edge do Workers sempre define). Nunca X-Forwarded-For (controlável pelo cliente
    // fora do Workers) — vazio ou ausente cai em "desconhecido", nunca em bucket compartilhado por string vazia.
    const ip = (req.headers.get("cf-connecting-ip") ?? "").trim().slice(0, 64) || "desconhecido";
    if (!(await deps.tetoIp(ip))) return respostaErro(429, "limite_excedido", 60);
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
    const chave = m ? m[1] : "";
    const p = lerParametros(new URL(req.url));
    if (!p) return respostaErro(400, "parametro_invalido");
    const r = await deps.ler({
      hash: await deps.hashChave(chave), loja: p.loja, incluir: p.incluir, cursor: p.cursor, limite: p.limite, modo: p.modo, ip,
    });
    if (r.status !== "ok") {
      agendarLimpeza(deps, r.tenant_id ?? null);
      const { codigo, erro } = httpDe(r.status);
      return respostaErro(codigo, erro, r.retry_after ?? null);
    }
    // m9: o banco tem que devolver o MESMO modo pedido — um drift de contrato nunca deve rodar a fase 2 (confirmar,
    // que integra produtos de verdade) por engano numa chamada modo=teste, nem vice-versa.
    if (r.modo !== p.modo) throw new Error("modo divergente");
    // M3: formato de produtos/linhas/valores fora do contrato falha fechado (500) antes de qualquer iteração.
    validarFormato(r);
    const geradoEm = deps.agora().toISOString();
    if (r.modo === "teste") {
      const corpo = montarResposta(r, { geradoEm, foto: (c) => c.map(() => `${deps.origem}${CAMINHO_FOTO_EXEMPLO}`) });
      agendarLimpeza(deps, r.tenant_id ?? null);
      return new Response(JSON.stringify(corpo), { status: 200, headers: CABECALHOS_JSON });
    }
    // Fase 1½ — fotos: só caminhos CANÔNICOS da PRÓPRIA loja (inv. #2); o resto é descartado e contado (fail closed).
    const idxFoto = (r.chaves_colunas ?? []).indexOf("foto");
    const validosBrutos: string[] = [];
    const invalidosBrutos: string[] = [];
    if (idxFoto >= 0) {
      for (const pr of r.produtos ?? []) {
        for (const l of pr.linhas) {
          if (l.tipo !== "produto") continue;
          for (const c of caminhosFoto(l.valores, idxFoto)) {
            (daLoja(c, r.tenant_id) ? validosBrutos : invalidosBrutos).push(c);
          }
        }
      }
    }
    // m7/N5 (fix round 2): descartadas e ausentes contam sobre o MESMO conjunto -- caminhos ÚNICOS, não ocorrência
    // bruta. Um caminho inválido repetido (ex.: mesma foto de outra loja citada 2x) só descarta 1 vez.
    const unicos = [...new Set(validosBrutos)];
    const descartadas = new Set(invalidosBrutos).size;
    const links = unicos.length > 0 ? await deps.assinarFotos(unicos, (r.validade_foto_dias ?? 7) * 86400) : new Map<string, string | null>();
    const ausentes = unicos.filter((c) => !links.get(c)).length;
    // Fase 2 — confirmar: marca integrado SÓ o que ainda está integrável com a MESMA assinatura.
    const conf = await deps.confirmar(r.chave_id ?? "", r.acesso_id ?? "", {
      produtos: (r.produtos ?? []).map((pr) => ({ modelo_id: pr.modelo_id, assinatura: pr.assinatura })),
      fotos_descartadas: descartadas, fotos_ausentes: ausentes,
    });
    if (conf.status !== "ok") {
      // m2 (ruling): só chave_invalida/loja_inativa são erro de CLIENTE; qualquer outro status de confirmar é uma
      // inconsistência interna de protocolo (a rota monta o payload a partir do que ela mesma recebeu do banco) —
      // nunca deve virar um 400 que manda o dev conferir parâmetros que já foram validados.
      if (conf.status === "chave_invalida" || conf.status === "loja_inativa") {
        const { codigo, erro } = httpDe(conf.status);
        return respostaErro(codigo, erro);
      }
      return respostaErro(500, "erro_interno");
    }
    const ok = new Map(conf.confirmados.map((c) => [c.modelo_id, c.integrado_em]));
    const corpo = montarResposta(r, {
      geradoEm,
      foto: (c) => c.map((x) => (daLoja(x, r.tenant_id) ? (links.get(x) ?? null) : null)),
      incluir: (id) => ok.has(id),
      integradoEm: (id) => ok.get(id) ?? null,
    });
    agendarLimpeza(deps, r.tenant_id ?? null);
    return new Response(JSON.stringify(corpo), { status: 200, headers: CABECALHOS_JSON });
  } catch {
    return respostaErro(500, "erro_interno");
  }
}
