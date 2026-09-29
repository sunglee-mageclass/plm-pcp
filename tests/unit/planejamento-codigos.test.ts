import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  agruparPorVariante, avisoSku, deveGerarPrimeiraVez, lerMatriz, resumoGeracao, rotuloTamanho, rotuloVariante,
  seloCodigos, siglasDoGrupo, situacaoSku, type LinhaSku, type MatrizSkus,
} from "@/components/planejamento/planejamento-detail/codigos/sku-card";
import { situacaoPrevia, type ErroPrevia, type LinhaPrevia } from "@/components/planejamento/planejamento-detail/codigos/sku-previa";

// F3.6 — seção "4. Códigos" (F3.5b do SKU, spec 2026-09-24 §4.3): regras PURAS sobre a matriz que as RPCs da F3.5a
// (`skus_modelo`/`gerar_skus_modelo`, migration 20261003100000) devolvem. O SKU é gerado e gravado SÓ no servidor.
const linha = (p: Partial<LinhaSku> = {}): LinhaSku => ({
  variante_key: "k1", variante_ordem: 1, cor_nome: "Amarelo", apelido_nome: null, tamanho_key: "34|PPP", tamanho_ordem: 1,
  id: null, sku: null, manual: false, rev: null, sku_previsto: "REF1-AM34", faltas: [], avisos: [], conflito_com: null,
  estado: "pendente", ...p,
});
const matriz = (p: Partial<MatrizSkus> = {}): MatrizSkus => ({
  status: "ok", tamanho_tipo: "numero", tamanho_tipo_card: null, linhas: [], faltas: [], avisos: [], ...p,
});

describe("lerMatriz — jsonb das RPCs da F3.5a", () => {
  it("status ok: lê a linha inteira", () => {
    const m = lerMatriz({
      status: "ok", tamanho_tipo: "numero", tamanho_tipo_card: "letra", faltas: [], avisos: [],
      linhas: [{
        variante_key: "k1", variante_ordem: 2, cor_nome: "Verde", apelido_nome: "Musgo", tamanho_key: "36|PP", tamanho_ordem: 2,
        id: "s1", sku: "REF1VD36", manual: true, rev: 3, sku_previsto: "REF1VD36",
        faltas: [{ atributo: "tamanho", id: null, nome: "36" }], avisos: [{ atributo: "cor_apelido", id: "a1", nome: "Musgo" }],
        conflito_com: { modelo_id: "m9", nome: "Blusa", ref: "REF9" }, estado: "manual",
      }],
    });
    expect(m.status).toBe("ok");
    expect(m.tamanho_tipo).toBe("numero");
    expect(m.tamanho_tipo_card).toBe("letra");
    expect(m.linhas[0]).toEqual({
      variante_key: "k1", variante_ordem: 2, cor_nome: "Verde", apelido_nome: "Musgo", tamanho_key: "36|PP", tamanho_ordem: 2,
      id: "s1", sku: "REF1VD36", manual: true, rev: 3, sku_previsto: "REF1VD36",
      faltas: [{ atributo: "tamanho", id: null, nome: "36" }], avisos: [{ atributo: "cor_apelido", id: "a1", nome: "Musgo" }],
      conflito_com: { modelo_id: "m9", nome: "Blusa", ref: "REF9" }, estado: "manual",
    });
  });
  it("status ≠ ok: linha só com id/chaves/sku/manual/rev/estado — o resto vira null/[]", () => {
    const m = lerMatriz({
      status: "aguardando_ref", tamanho_tipo: "letra", tamanho_tipo_card: null, faltas: [], avisos: [],
      linhas: [{ id: "s1", variante_key: "k1", tamanho_key: "P", sku: "X", manual: false, rev: 1, estado: "salvo" }],
    });
    expect(m.status).toBe("aguardando_ref");
    expect(m.linhas[0]).toMatchObject({
      id: "s1", sku: "X", estado: "salvo", variante_ordem: null, cor_nome: null, faltas: [], avisos: [], conflito_com: null, sku_previsto: null,
    });
  });
  it("Minor (2) da revisão — status ausente/desconhecido é FAIL-CLOSED: vira 'desconhecido', NUNCA 'ok' (que destravaria Regerar/input à toa)", () => {
    expect(lerMatriz(null)).toEqual({ status: "desconhecido", tamanho_tipo: null, tamanho_tipo_card: null, linhas: [], faltas: [], avisos: [] });
    expect(lerMatriz({ status: "algo_que_o_front_ainda_nao_conhece" }).status).toBe("desconhecido");
    expect(lerMatriz({ linhas: [{ estado: "xyz" }] }).linhas[0].estado).toBe("vazio");
    expect(lerMatriz({ tamanho_tipo: "cm" }).tamanho_tipo).toBeNull();
  });
  it("F3.6 (dono 25/set): status 'sem_tamanho' — card sem 'Tamanho em'; só os gravados, tipo null", () => {
    const m = lerMatriz({
      status: "sem_tamanho", tamanho_tipo: null, tamanho_tipo_card: null, faltas: [], avisos: [],
      linhas: [{ id: "s1", variante_key: "k1", tamanho_key: "34|PPP", sku: "X", manual: false, rev: 1, estado: "salvo" }],
    });
    expect(m.status).toBe("sem_tamanho");
    expect(m.tamanho_tipo).toBeNull();
    expect(m.linhas[0]).toMatchObject({ id: "s1", estado: "salvo", sku_previsto: null });
  });
});

describe("agruparPorVariante / rótulos", () => {
  it("uma linha de grupo por variante, na ordem da RPC; órfãs num grupo próprio no fim", () => {
    const g = agruparPorVariante([
      linha({ tamanho_key: "34|PPP" }), linha({ tamanho_key: "36|PP" }),
      linha({ variante_key: "k2", variante_ordem: 2, cor_nome: "Verde", apelido_nome: "Musgo", tamanho_key: "34|PPP" }),
      linha({ variante_key: "k9", variante_ordem: null, cor_nome: null, estado: "orfa", id: "s9", sku: "OLD" }),
    ]);
    expect(g.map((x) => x.linhas.length)).toEqual([2, 1, 1]);
    expect(rotuloVariante(g[0])).toBe("Variante 1 · Amarelo · sem apelido");
    expect(rotuloVariante(g[1])).toBe("Variante 2 · Verde · apelido Musgo");
    expect(rotuloVariante(g[2])).toBe("Fora da grade atual");
  });
  it("R11 — siglas do mockup por consulta própria, casadas pelo NOME (cor por loja; apelido pela cor base); sem sigla = só o nome", () => {
    const g = agruparPorVariante([
      linha({ variante_key: "k1", variante_ordem: 1, cor_nome: "Marrom", apelido_nome: "Canela" }),
      linha({ variante_key: "k2", variante_ordem: 2, cor_nome: "Preto", apelido_nome: null }),
      linha({ variante_key: "k3", variante_ordem: 3, cor_nome: "Verde", apelido_nome: "Musgo" }),
      linha({ variante_key: "k9", estado: "orfa", cor_nome: null }),
    ]);
    const cores = [{ id: "c1", nome: "Marrom", sigla: "MAR" }, { id: "c2", nome: "Preto", sigla: "PRE" }, { id: "c3", nome: "Verde", sigla: null }];
    const apelidos = [
      { cor_base_id: "c1", nome: "Canela", sigla: "CAN" },
      { cor_base_id: "c2", nome: "Musgo", sigla: "MUS" }, // apelido de OUTRA cor base: não casa com o Verde
    ];
    expect(rotuloVariante(g[0], siglasDoGrupo(g[0], cores, apelidos))).toBe("Variante 1 · Marrom (MAR) · apelido Canela (CAN)");
    expect(rotuloVariante(g[1], siglasDoGrupo(g[1], cores, apelidos))).toBe("Variante 2 · Preto (PRE) · sem apelido");
    expect(rotuloVariante(g[2], siglasDoGrupo(g[2], cores, apelidos))).toBe("Variante 3 · Verde · apelido Musgo");
    expect(siglasDoGrupo(g[3], cores, apelidos)).toEqual({ cor: null, apelido: null });
    expect(rotuloVariante(g[3], siglasDoGrupo(g[3], cores, apelidos))).toBe("Fora da grade atual");
  });
  it("tamanho pelo lado do 'Tamanho em' (par 34|PPP); tamanho solto fica como está; SEM escolha = a chave inteira", () => {
    expect(rotuloTamanho("34|PPP", "numero")).toBe("34");
    expect(rotuloTamanho("34|PPP", "letra")).toBe("PPP");
    expect(rotuloTamanho("UN", "numero")).toBe("UN");
    expect(rotuloTamanho("34|PPP", null)).toBe("34|PPP");
  });
});

describe("situacaoSku / avisoSku", () => {
  it("cada estado da RPC vira um texto/tom", () => {
    expect(situacaoSku(linha({ estado: "ok" }))).toEqual({ tom: "neutral", texto: "automático", cadastrar: false });
    expect(situacaoSku(linha({ estado: "manual" })).texto).toBe("editado à mão");
    expect(situacaoSku(linha({ estado: "salvo" })).texto).toBe("gravado");
    expect(situacaoSku(linha({ estado: "pendente" })).texto).toBe("a gerar");
    expect(situacaoSku(linha({ estado: "divergente", sku_previsto: "REF1AM34" })).texto).toBe("Regerar muda para REF1AM34");
    expect(situacaoSku(linha({ estado: "falta", faltas: [{ atributo: "cor_base", id: "c1", nome: "Amarelo" }] })))
      .toEqual({ tom: "warning", texto: "Falta sigla: Cor base Amarelo", cadastrar: true });
    expect(situacaoSku(linha({ estado: "conflito", conflito_com: { modelo_id: "m2", nome: "Saia", ref: " " } })))
      .toEqual({ tom: "danger", texto: "já existe em Saia (REF —)", cadastrar: false });
    expect(situacaoSku(linha({ estado: "orfa", manual: false })).texto).toBe("fora da grade — sai no Regerar");
    expect(situacaoSku(linha({ estado: "orfa", manual: true })).texto).toBe("fora da grade — editado à mão, fica");
    expect(situacaoSku(linha({ estado: "vazio" })).texto).toBe("—");
  });
  it("aviso D4 (apelido sem sigla) não bloqueia — só texto", () => {
    expect(avisoSku(linha({ avisos: [{ atributo: "cor_apelido", id: "a1", nome: "Musgo" }] }))).toBe("Falta sigla na cor apelido: Musgo");
    expect(avisoSku(linha())).toBeNull();
  });
});

describe("deveGerarPrimeiraVez (1ª geração pós-Salvar — spec SKU §4.2, Ruling R12)", () => {
  it("só com REF (status ok), 'Tamanho em' do card já decidido, linhas a gerar e NENHUM SKU gravado", () => {
    expect(deveGerarPrimeiraVez(matriz({ tamanho_tipo_card: "letra", linhas: [linha(), linha({ tamanho_key: "36|PP" })] }))).toBe(true);
    expect(deveGerarPrimeiraVez(matriz({ tamanho_tipo_card: "letra", linhas: [linha(), linha({ id: "s1", sku: "X", estado: "ok" })] }))).toBe(false);
    expect(deveGerarPrimeiraVez(matriz({ tamanho_tipo_card: "letra", status: "aguardando_ref" }))).toBe(false);
    expect(deveGerarPrimeiraVez(matriz({ tamanho_tipo_card: "letra", linhas: [linha({ estado: "falta", sku_previsto: null })] }))).toBe(false);
    expect(deveGerarPrimeiraVez(matriz({ tamanho_tipo_card: "letra" }))).toBe(false);
  });
  it("Minor (1) da revisão — guarda tamanho_tipo_card !== null: mesmo com status 'ok' e linha pendente, sem o servidor ter decidido o 'Tamanho em' do card não gera (rede p/ deploy fora de ordem/volta)", () => {
    expect(deveGerarPrimeiraVez(matriz({ tamanho_tipo_card: null, linhas: [linha(), linha({ tamanho_key: "36|PP" })] }))).toBe(false);
  });
});

describe("resumoGeracao", () => {
  it("sem conflito: contagens; com conflito: a 1ª mensagem do servidor", () => {
    expect(resumoGeracao({ criados: 2, atualizados: 1, removidos: 0, conflitos: [] }))
      .toEqual({ erro: false, texto: "SKUs gerados: 2 novo(s), 1 atualizado(s), 0 removido(s)." });
    expect(resumoGeracao({ conflitos: [{ mensagem: "SKU X já existe em Saia (REF R1). Edite este SKU à mão ou mude a sigla." }] }))
      .toEqual({ erro: true, texto: "1 SKU não gravado: SKU X já existe em Saia (REF R1). Edite este SKU à mão ou mude a sigla." });
  });
});

describe("seloCodigos (selo da seção — spec §5.3; M1 da revisão — 2º parâmetro OBRIGATÓRIO)", () => {
  it("vazia (nenhuma linha) ⇒ sem selo, nem 'aguardando REF' nem 'aguardando migração' (regra de seção vazia do dono, 25/set)", () => {
    expect(seloCodigos(matriz({ status: "aguardando_ref" }), false)).toBeUndefined();
    expect(seloCodigos(matriz({ status: "sem_tamanho", tamanho_tipo: null }), false)).toBeUndefined();
    expect(seloCodigos(undefined, false)).toBeUndefined();
  });
  it("R23 + P-25 — SKUs gravados e card LEGADO sem 'Tamanho em' ⇒ cinza 'aguardando migração do Tamanho em' (não é mais uma escolha pendente do usuário)", () => {
    expect(seloCodigos(matriz({ status: "sem_tamanho", tamanho_tipo: null, linhas: [linha({ estado: "salvo", id: "s", sku: "X" })] }), false))
      .toEqual({ tone: "muted", texto: "aguardando migração do Tamanho em" });
  });
  it("Minor (2) — status 'desconhecido' com SKUs gravados ⇒ cinza, sem virar 'ok'", () => {
    expect(seloCodigos(matriz({ status: "desconhecido", linhas: [linha({ estado: "salvo", id: "s", sku: "X" })] }), false))
      .toEqual({ tone: "muted", texto: "não foi possível ler o status" });
  });
  it("falta sigla ⇒ âmbar 'N SKU(s) sem sigla' (vence o resto)", () => {
    const m = matriz({
      linhas: [linha({ estado: "falta" }), linha({ estado: "falta", tamanho_key: "36|PP" }), linha({ estado: "conflito" })],
      faltas: [{ atributo: "tamanho", id: null, nome: "36" }],
    });
    expect(seloCodigos(m, false)).toEqual({ tone: "warn", texto: "2 SKUs sem sigla", title: "Falta sigla: Tamanho 36" });
  });
  it("conflito ⇒ âmbar; aguardando REF / sem formato / a gerar ⇒ cinza; só aviso ⇒ info; tudo gravado ⇒ ok", () => {
    expect(seloCodigos(matriz({ linhas: [linha({ estado: "conflito" })] }), false)).toEqual({ tone: "warn", texto: "1 em conflito" });
    expect(seloCodigos(matriz({ status: "aguardando_ref", linhas: [linha({ estado: "salvo", id: "s", sku: "X" })] }), false))
      .toEqual({ tone: "muted", texto: "aguardando REF" });
    expect(seloCodigos(matriz({ status: "sem_formato", linhas: [linha({ estado: "salvo", id: "s", sku: "X" })] }), false))
      .toEqual({ tone: "muted", texto: "sem formato de SKU" });
    expect(seloCodigos(matriz({ linhas: [linha()] }), false)).toEqual({ tone: "muted", texto: "1 a gerar" });
    expect(seloCodigos(matriz({
      linhas: [linha({ estado: "ok", id: "s", sku: "X" })], avisos: [{ atributo: "cor_apelido", id: "a", nome: "Musgo" }],
    }), false)).toEqual({ tone: "info", texto: "aviso: apelido sem sigla", title: "Falta sigla na cor apelido: Musgo" });
    expect(seloCodigos(matriz({
      linhas: [linha({ estado: "ok", id: "s", sku: "X" }), linha({ estado: "manual", id: "t", sku: "Y", tamanho_key: "36|PP" })],
    }), false)).toEqual({ tone: "ok", texto: "2 SKUs" });
  });
  it("SKU em prévia — algo 'a gravar' vence tudo (o card ainda não gravou nada)", () => {
    expect(seloCodigos(matriz({ linhas: [linha({ estado: "conflito" })] }), true)).toEqual({ tone: "warn", texto: "prévia a gravar" });
    expect(seloCodigos(undefined, true)).toEqual({ tone: "warn", texto: "prévia a gravar" });
  });
});

// Fix 1 (T5, revisão Opus C2) — `situacaoPrevia` exige `erros` (sem default: a produção SEMPRE tem `previa.erros` à
// mão); o erro da MESMA chave vira a `previa` da linha (mesma forma de `PreviaLinha`) e cai no MESMO `case "erro"` do
// switch — P0409 preserva `conflitoVersao:true` (o botão "manter o meu · usar o novo" continua aparecendo) e P0001
// mostra a mensagem PURA do servidor (não o prefixo do toast "O card foi salvo…", que é só para o TOAST de depois do
// Salvar). O caminho antigo (achar o erro e devolver direto, sem passar pelo switch) matava esse fluxo — corrigido.
describe("situacaoPrevia — precedência do erro vira a `previa` da linha (Fix 1 · C2)", () => {
  const linhaPrevia = (p: Partial<LinhaPrevia> = {}): LinhaPrevia => ({ ...linha(), previa: null, ...p });
  it("erro P0409 da MESMA chave: cai no case 'erro', preserva conflitoVersao:true e o texto de 'manter o meu · usar o novo'", () => {
    const l = linhaPrevia({
      variante_key: "k1", tamanho_key: "34|PPP", sku: "REF1AM34",
      previa: { acao: "sai", sku_de: "REF1AM34", sku_para: null, mensagem: null, code: null },
    });
    const erros: ErroPrevia[] = [{ variante_key: "k1", tamanho_key: "34|PPP", code: "P0409", mensagem: "conflito_versao: a linha do SKU foi gravada por outra pessoa" }];
    const sit = situacaoPrevia(l, erros);
    expect(sit.tom).toBe("danger");
    expect(sit.conflitoVersao).toBe(true); // C2 — SEM isto, "manter o meu · usar o novo" nunca aparece na tela
    expect(sit.texto).toContain("Outra pessoa mudou este SKU para REF1AM34");
    expect(sit.texto).not.toContain("sai no Salvar");
  });
  it("erro P0001 (não-P0409) da MESMA chave: a mensagem é a PURA do servidor, sem o prefixo do toast", () => {
    const l = linhaPrevia({
      variante_key: "k1", tamanho_key: "34|PPP",
      previa: { acao: "novo", sku_de: null, sku_para: "REF1AM34", mensagem: null, code: null },
    });
    const erros: ErroPrevia[] = [{ variante_key: "k1", tamanho_key: "34|PPP", code: "P0001", mensagem: "SKU inválido: use só letras, números e - . _ /." }];
    const sit = situacaoPrevia(l, erros);
    expect(sit.tom).toBe("danger");
    expect(sit.conflitoVersao).toBe(false);
    expect(sit.texto).toBe("SKU inválido: use só letras, números e - . _ /."); // mensagem PURA — sem "O card foi salvo…"
  });
  it("erro de OUTRA chave não interfere — a linha mostra a ação normal", () => {
    const l = linhaPrevia({
      variante_key: "k1", tamanho_key: "34|PPP",
      previa: { acao: "novo", sku_de: null, sku_para: "REF1AM34", mensagem: null, code: null },
    });
    const erros: ErroPrevia[] = [{ variante_key: "k9", tamanho_key: "99|G", code: "P0001", mensagem: "SKU inválido." }];
    expect(situacaoPrevia(l, erros).texto).toBe("novo · a gravar");
  });
  it("sem nenhum erro (produção sempre passa `[]`, nunca omite): comportamento igual ao de antes", () => {
    const l = linhaPrevia({ previa: { acao: "novo", sku_de: null, sku_para: "X", mensagem: null, code: null } });
    expect(situacaoPrevia(l, []).texto).toBe("novo · a gravar");
  });
});

const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

describe("Códigos no Sheet (fonte) — a REF saiu da seção 3 e mora na 4", () => {
  it("DevEquipeSection não tem mais a REF", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection.tsx");
    expect(s).not.toContain('data-colab-path="ref"');
    expect(s).not.toMatch(/refVisivel/);
  });
  it("Fix round pós-QA (F1) — REF tem largura útil garantida (minmax) e o rótulo do 'Tamanho em' não leva mais o texto longo inline (foi pro InfoHover), então não empurra a REF a 1024/1280", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx");
    // o rótulo "Tamanho em" continua um <Label> simples — o texto longo agora está DENTRO do InfoHover, não como
    // <span> irmão dentro do próprio <Label> (o que voltava a inflar a coluna `auto`).
    expect(s).not.toMatch(/<Label id="codigos-tamanho-em">\s*Tamanho em\{" "\}\s*<span/);
  });
  it("Fix round 1 (M-1) — grid em DUAS etapas: sm/md só REF+toggle (2 colunas, sem estouro 640-767px); lg+ volta às 3 colunas (idêntico ao fix anterior em 1024/1280)", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx");
    expect(s).toContain("sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-end lg:grid-cols-[minmax(12rem,1fr)_auto_auto]");
    expect(s).not.toContain("sm:grid-cols-[minmax(12rem,1fr)_auto_auto]"); // versão do fix anterior (3 colunas já a partir de sm) — SUBSTITUÍDA
    expect(s).not.toContain("sm:grid-cols-[1fr_auto_auto]"); // versão original pré-F1
    // Math (review M-1): Sheet sm:w-[70vw] (ui/sheet.tsx) com px-6 no corpo (PlanejamentoDetail.tsx) => conteúdo
    // útil = 0,7·vw − 48px. A 640px isso é 400px; REF(min 192) + toggle(~143) + 1 gap(12) = 347px ≤ 400px (cabe,
    // com o botão OMITIDO das 2 colunas de sm/md — vai para a linha 2). A 1024px o conteúdo é ~669px (medido no
    // QA), onde as 3 colunas (REF+toggle+botão+2 gaps = 487px mínimo) cabem com folga — REF recebe o resto (1fr).
    // Botão precisa de w-fit + justify-self-start pra NÃO esticar na coluna larga (minmax(12rem,1fr)) quando cai
    // pra linha 2 sozinho, de sm a md. Fix round 2 (Low, re-revisão) — restrito a `sm:` (não vale abaixo de
    // 640px): o celular continua com o botão full-width, como sempre foi antes do F1/M-1.
    expect(s).toContain('<Button type="button" variant="outline" size="sm" className="sm:w-fit sm:justify-self-start max-sm:min-h-11"');
    expect(s).not.toContain('className="w-fit justify-self-start max-sm:min-h-11"'); // versão sem o gate sm: — SUBSTITUÍDA
  });
  it("Fix round 2 (Low, re-revisão) — o comentário do grid NÃO afirma mais que a largura foi medida num navegador (era falso; agora diz que foi CALCULADA)", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx");
    expect(s).not.toMatch(/Re-medido com scrollWidth===clientWidth/);
    expect(s).toMatch(/foi CALCULADA/);
  });
  it("CodigosSecao (SKU em prévia — P-46): REF, 'Tamanho em' (P-25), Regerar SEM AlertDialog e SEM trava de rascunho sujo, aviso de prévia, SKU com data-colab-path", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx");
    expect(s).toContain('data-colab-path="ref"');
    expect(s).toContain('data-colab-path="tamanho_tipo"');
    expect(s).toContain('type="radio"');
    // Fix round 1 (L-1, review) — o texto perdeu os "·" leftover (eram do <span> inline de antes; sobravam
    // como pontuação quebrada dentro do InfoHover isolado). Agora são 2 frases normais.
    expect(s).toContain("Nasce em Letra; troque para Número se o produto usa numeração.");
    expect(s).not.toContain("Padrão da loja");
    expect(s).not.toMatch(/tamanho_padrao|TAMANHO_PADRAO/);
    expect(s).not.toContain("AvisoCamposDev"); // R29
    expect(s).toContain("rotuloVariante(g, siglasDoGrupo(g, siglas.cores, siglas.apelidos))"); // R11
    expect(s).toContain("colabPath={`sku:${l.variante_key}:${l.tamanho_key}`}");
    expect(s).toContain("ariaLabel={`SKU — ${rotuloVar} · ${rotuloTam}`}");
    expect(s).toContain("Regerar SKUs");
    // P-46 — prévia: nada de gravação imediata, nada de AlertDialog, nada de "salve antes"
    expect(s).not.toMatch(/<AlertDialog\b/);
    expect(s).not.toContain("draftSujoParaRegerar");
    expect(s).not.toContain("Salve o card antes de regerar");
    expect(s).not.toContain("salvarManual");
    expect(s).toContain("podeRegerar({ podeEditar: podeEditarSkus, matriz: skus.matriz, refPrevia, jaPedido: aGravar.aGravar.regerar })");
    expect(s).toContain("onClick={aGravar.pedirRegerar}");
    expect(s).toContain("{TEXTO_PREVIA}");
    expect(s).toContain("Desfazer prévia");
    expect(s).toContain("{TEXTO_BOM_SUJO}");
    expect(s).toContain("manter o meu");
    expect(s).toContain("usar o novo");
    expect(s).toContain('aria-label="Desfazer o SKU digitado"');
    expect(s).toContain("bg-[var(--tone-warning-bg)]");
    expect(s).toContain('m.status === "ok" && m.tamanho_tipo_card !== null && podeEditarSkus');
    expect(s).toContain("SKUs por variante e tamanho");
    expect(s).toContain(
      "As variantes vêm do Tecido 1 (seção Tecidos) e os tamanhos, da Grade. Formato: REF - cor base + apelido + tamanho (Config da Loja › Formato do SKU). 'Regerar SKUs' mostra a prévia e só o Salvar grava; os editados à mão nunca mudam.",
    );
  });
  it("CodigosSecao (Fix 1 · C2): situacaoPrevia é chamada com skus.previa.erros (a chamada de produção nunca omite)", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx");
    expect(s).toMatch(/situacaoPrevia\(l as LinhaPrevia,\s*erros\)/);
  });
  it("CodigosSecao preserva o dev-oculto (P-53 A): 'Tamanho em' e o botão Regerar exigem podeEditarSkus (= podeEditarPlanejamento)", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx");
    expect(s).toContain("disabled={!podeEditarSkus}");
  });
  it("useSkusModelo (SKU em prévia): prévia pela RPC só leitura, gravação só no Salvar pela RPC com assinatura; sem RPC imediata", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/codigos/useSkusModelo.ts");
    expect(s).toContain('supabase.rpc("skus_previa" as any');
    expect(s).toContain('supabase.rpc("aplicar_skus_modelo" as any');
    expect(s).toContain("_assinatura: d.assinatura");
    expect(s).not.toContain("salvar_sku_manual");
    expect(s).not.toContain("_regerar: true"); // o Regerar não grava mais na hora
    expect(s).toContain('_regerar: false'); // a 1ª geração automática pós-Salvar continua (P-50 A)
    expect(s).toContain("placeholderData: keepPreviousData");
    expect(s).toContain("o.aGravar.limparSe(s)");
  });
  it("useSkusModelo (Fix 1 · C1): `virgem` vem da matriz GRAVADA e o modo do aplicar é o da ENTRADA da prévia (nunca recalculado no momento do Salvar)", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/codigos/useSkusModelo.ts");
    expect(s).toMatch(/virgem = !!q\.data.*q\.data\.linhas\.every\(\(l\) => !l\.id\)/);
    expect(s).toContain("chaveEntradaPrevia({ ref: o.refPrevia, tamanhoTipo: o.tamanhoTipo, aGravar, virgem })");
    expect(s).toContain("_modo: e.modo"); // o aplicar manda o MESMO modo da entrada da prévia — não `modoPrevia(s)` recalculado
  });
  it("useSkusModelo (Fix 1 · I1): isFetching SAIU da condição que recusa o aplicarAGravar (não protegia nada; a garantia é a assinatura+entrada)", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/codigos/useSkusModelo.ts");
    expect(s).not.toMatch(/const buscandoRef = useRef/);
    expect(s).not.toMatch(/if \(!d \|\| d\.entrada !== chaveRef\.current \|\| buscandoRef/);
    expect(s).toContain('if (!d || d.entrada !== chaveRef.current) {');
  });
  it("useSkusModelo (Fix 1 · M3/M4): prévia 'desconhecida' tem toast PRÓPRIO (não o de 'ainda calculando'); a matriz do retorno do aplicar semeia o cache (sem os SKUs antigos piscando)", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/codigos/useSkusModelo.ts");
    expect(s).toContain("MSG_PREVIA_DESCONHECIDA");
    expect(s).toMatch(/if \(d\.desconhecida \|\| !d\.assinatura\)/);
    expect(s).toContain("qc.setQueryData(chaveSkus(modeloId), lerMatriz(data))");
  });
  it("PlanejamentoDetail: seção 3 = 'Desenvolvimento'; 'Códigos' logo depois; o Salvar grava o modelo, DEPOIS os SKUs em prévia (aplicarAGravar), DEPOIS a 1ª geração (gerarSeFaltar)", () => {
    const s = fonte("src/components/planejamento/PlanejamentoDetail.tsx");
    const iDev = s.indexOf('<Secao id="desenvolvimento" titulo="Desenvolvimento"');
    const iCod = s.indexOf('<Secao id="codigos" titulo="Códigos"');
    const iProva = s.indexOf('<Secao id="prova"');
    expect(iDev).toBeGreaterThan(0);
    expect(iCod).toBeGreaterThan(iDev);
    expect(iProva).toBeGreaterThan(iCod);
    expect(s).not.toContain("Desenvolvimento — equipe e cronograma");
    // Fix 1 (T5, revisão Opus C1) — a ordem VOLTOU a ser aplicarAGravar → (se ≠ "falhou") gerarSeFaltar (spec §4.2.5 e
    // §6), como o brief original mandava; o card virgem some do jogo porque a PRÉVIA/APLICAR já usam modo 'criar'
    // (gerarSeFaltar continua existindo pra quando NADA foi digitado à mão — Regerar sozinho ou nada — P-50 A).
    expect(s).toMatch(/const aoSalvar = async \(\) => \{[\s\S]*?const r = await skus\.aplicarAGravar\(\);[\s\S]*?if \(r !== "falhou"\) await skus\.gerarSeFaltar\(\);/);
    expect(s).toContain("|| !nadaAGravar(skusAGravar.aGravar)"); // "não salvo" inclui a prévia
    expect(s).toContain('qc.invalidateQueries({ queryKey: ["plan-skus", modeloId] });');
    expect(s).toContain('qc.invalidateQueries({ queryKey: ["plan-skus-previa", modeloId] });');
    expect(s).toContain("seloCodigos(skus.matriz, skus.temPrevia)");
    expect(s).toContain("refParaPrevia({ refVaiNoSalvar: refEditavel, refRascunho: draft.ref, refSalva: (modeloData as any)?.ref ?? \"\" })");
    expect(s).not.toContain("refSalva={");
    expect(s).not.toContain("tamanhoTipoSalvo=");
    expect(/<DevEquipeSection[^>]*refVisivel=/.test(s)).toBe(false);
    expect(s).not.toContain("motivoTravaRef"); // R29
  });
  it("PlanejamentoDetail preserva o dev-oculto (P-53 A): SKU/Tamanho em editáveis só com podeEditarPlanejamento", () => {
    const s = fonte("src/components/planejamento/PlanejamentoDetail.tsx");
    expect(s).toContain('podeEditarSkus={podeEditarPlanejamento && !travaIntegracao.has("sku")}'); // P-53 A + trava da Integração (F4)
  });
  it("usePlanejamentoSave: o onSaved é AGUARDADO (o Salvar fica 'salvando' até os SKUs terminarem)", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    expect(s).toContain("onSaved: () => void | Promise<void>;");
    expect(s).toContain("onSuccess: async (result) => {");
    expect(s).toContain("await onSaved();");
  });
});
