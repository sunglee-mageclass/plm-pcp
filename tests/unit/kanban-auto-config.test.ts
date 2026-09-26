import { describe, it, expect } from "vitest";
import {
  KANBAN_COLS, agruparMovimentos, avisosRestauracaoVisiveis, chaveKanbanMudou, conflitoKanban, descreverMudancasKanban,
  diffKanban, diffMudouDesdeAPrevia, formatarDataHora, jsonCanonico, juntarLista, MENSAGEM_CHAVE_KANBAN_MUDOU,
  MENSAGEM_PREVIA_KANBAN_MUDOU, mensagemConflitoKanban, mesclarKanbanPorColuna, nCards, normalizarKanbanDefaults,
  pickKanban, rebasearKanban, resolverEcoKanban, resumirFixados, separarPayloadKanban,
} from "@/lib/kanban-auto-config";
import type { PreviaCard, PreviaFixado } from "@/lib/kanban-auto-ui";

const KEYS = ["em_modelagem", "em_pilotagem", "prova_roupa_1", "stand_by", "reprovado", "aprovado"];
const card = (id: string, de: string | null, para: string | null, recua = false): PreviaCard => ({
  modelo_id: id, nome: `M${id}`, ref: null, origem: "interno", de, para, fixado: false, recua, primeira_falha: null, faltando: [],
});
const fix = (id: string, coluna: string): PreviaFixado => ({ modelo_id: id, nome: null, ref: null, origem: null, coluna, posicao_derivada: "em_modelagem" });

describe("kanban-auto-config — JSON canônico e diff (RP3)", () => {
  it("ordem das chaves de objeto não importa; ordem de array importa; undefined ≡ null", () => {
    expect(jsonCanonico({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(jsonCanonico({ a: [{ c: 2, d: 1 }], b: 1 }));
    expect(jsonCanonico([1, 2])).not.toBe(jsonCanonico([2, 1]));
    expect(jsonCanonico(undefined)).toBe(jsonCanonico(null));
  });
  it("pickKanban pega SÓ as 5 colunas (null quando faltam)", () => {
    expect(KANBAN_COLS).toEqual(["status_kanban", "kanban_requisitos", "kanban_requisitos_excecoes", "revenda_kanban_colunas", "revenda_kanban_requisitos"]);
    expect(pickKanban({ status_kanban: ["A"], timezone: "x" })).toEqual({
      status_kanban: ["A"], kanban_requisitos: null, kanban_requisitos_excecoes: null, revenda_kanban_colunas: null, revenda_kanban_requisitos: null,
    });
    expect(pickKanban(null).status_kanban).toBeNull();
  });
  it("diffKanban devolve só as colunas que mudaram (valor ATUAL)", () => {
    const base = pickKanban({ status_kanban: ["A", "B"], kanban_requisitos: { a: ["x"], b: ["y"] }, revenda_kanban_colunas: [] });
    const mesmo = pickKanban({ status_kanban: ["A", "B"], kanban_requisitos: { b: ["y"], a: ["x"] }, revenda_kanban_colunas: [] });
    expect(diffKanban(base, mesmo)).toEqual({});
    const mudou = pickKanban({ status_kanban: ["B", "A"], kanban_requisitos: { a: ["x"], b: ["y"] }, revenda_kanban_colunas: ["a"] });
    expect(diffKanban(base, mudou)).toEqual({ status_kanban: ["B", "A"], revenda_kanban_colunas: ["a"] });
  });
  it("conflitoKanban compara o CRU lido na abertura com o banco AGORA", () => {
    const aberto = pickKanban({ kanban_requisitos: { a: ["x"] }, status_kanban: ["A"] });
    expect(conflitoKanban(aberto, { kanban_requisitos: { a: ["x"] }, status_kanban: ["A"], timezone: "outro" })).toEqual([]);
    expect(conflitoKanban(aberto, { kanban_requisitos: { a: ["x", "y"] }, status_kanban: ["A"] })).toEqual(["kanban_requisitos"]);
  });
  it("separarPayloadKanban tira as 5 colunas do upsert genérico", () => {
    const { geral, kanban } = separarPayloadKanban({
      tenant_id: "t", timezone: "America/Sao_Paulo", status_kanban: ["A"], kanban_requisitos: {}, revenda_kanban_colunas: [],
    });
    expect(geral).toEqual({ tenant_id: "t", timezone: "America/Sao_Paulo" });
    expect(kanban).toEqual({ status_kanban: ["A"], kanban_requisitos: {}, revenda_kanban_colunas: [] });
  });
  // Baixo 4 (revisão final Opus): `kanbanBase.servidor` guarda o valor NORMALIZADO (com DEFAULTS), mas
  // `conflitoKanban` compara contra a releitura CRUA do banco — uma loja com `status_kanban` NULL
  // acusaria conflito PARA SEMPRE (DEFAULTS != null) sem normalizar os dois lados do mesmo jeito.
  describe("normalizarKanbanDefaults (Baixo 4 — conflito com NULL no banco)", () => {
    const defaults = pickKanban({
      status_kanban: ["Padrão A", "Padrão B"],
      kanban_requisitos: { padrao: ["x"] },
      kanban_requisitos_excecoes: {},
      revenda_kanban_colunas: [],
      revenda_kanban_requisitos: {},
    });
    it("coluna NULL/ausente vira o DEFAULT (arrays e objetos)", () => {
      const cru = pickKanban({ status_kanban: null, kanban_requisitos: null });
      expect(normalizarKanbanDefaults(cru, defaults)).toEqual(defaults);
    });
    it("coluna PREENCHIDA no banco não é trocada pelo default", () => {
      const cru = pickKanban({ status_kanban: ["C"], kanban_requisitos: { c: ["y"] } });
      const r = normalizarKanbanDefaults(cru, defaults);
      expect(r.status_kanban).toEqual(["C"]);
      expect(r.kanban_requisitos).toEqual({ c: ["y"] });
      // as colunas não tocadas no cru continuam caindo no default:
      expect(r.revenda_kanban_colunas).toEqual([]);
    });
    it("loja com status_kanban NULL no banco: conflito compara igual (sem falso conflito eterno)", () => {
      // kanbanBase.servidor guardado já normalizado (o que a tela mostrou ao abrir).
      const baseServidorNormalizado = defaults;
      // Releitura crua do banco — só `status_kanban` nunca foi preenchida (segue NULL); as outras 4
      // colunas já batem com o default (mesmo valor que a tela carregou).
      const rowAgoraCrua = {
        status_kanban: null,
        kanban_requisitos: { padrao: ["x"] },
        kanban_requisitos_excecoes: {},
        revenda_kanban_colunas: [],
        revenda_kanban_requisitos: {},
      };
      // SEM normalizar os dois lados: falso conflito eterno (o bug relatado) — só na coluna NULL.
      expect(conflitoKanban(baseServidorNormalizado, rowAgoraCrua)).toEqual(["status_kanban"]);
      // Normalizando a releitura crua com o MESMO default: sem conflito (ninguém mudou nada de verdade).
      const rowAgoraNormalizada = normalizarKanbanDefaults(pickKanban(rowAgoraCrua), defaults);
      expect(conflitoKanban(baseServidorNormalizado, rowAgoraNormalizada)).toEqual([]);
    });
  });
  describe("resolverEcoKanban (fix round 2 — protege o kanban local durante o salvamento)", () => {
    it("(i) eco DURANTE o salvamento (protegido=true) preserva o local; kanbanBase intocado", () => {
      const local = pickKanban({ status_kanban: ["A", "B"], kanban_requisitos: { a: ["x"] } });
      const servidorNovo = pickKanban({ status_kanban: ["A"] });
      const baseAtual = { cfg: pickKanban({ status_kanban: ["A"] }), servidor: pickKanban({ status_kanban: ["A"] }) };
      const r = resolverEcoKanban(true, local, servidorNovo, baseAtual);
      expect(r.cfgKanban).toEqual(local);
      expect(r.cfgKanban).not.toEqual(servidorNovo);
      expect(r.kanbanBase).toBe(baseAtual); // MESMA referência: intocado, não uma cópia igual
    });
    it("(ii) protegido + eco de OUTRA ABA (servidor mudou por fora): retry acusa o conflito real", () => {
      // A tela abriu com status_kanban:["A"]. kanbanBase reflete isso (nem local nem servidorNovo
      // do eco mexem nele, pois está protegido). Outra aba muda o servidor para ["A","C"] nesse
      // meio-tempo — o eco chega com esse valor, mas resolverEcoKanban NÃO deixa isso contaminar
      // kanbanBase.servidor.
      const baseAtual = { cfg: pickKanban({ status_kanban: ["A"] }), servidor: pickKanban({ status_kanban: ["A"] }) };
      const local = pickKanban({ status_kanban: ["A", "B"] }); // usuário editou localmente
      const servidorNovoOutraAba = pickKanban({ status_kanban: ["A", "C"] }); // outra aba mudou o banco
      const r = resolverEcoKanban(true, local, servidorNovoOutraAba, baseAtual);
      expect(r.kanbanBase).toBe(baseAtual); // não adotou o valor da outra aba
      // Retry: conflitoKanban compara kanbanBase.servidor (ainda ["A"]) contra o banco REAL agora
      // (["A","C"], o que a outra aba gravou) — acusa o conflito de verdade.
      const conflito = conflitoKanban(r.kanbanBase.servidor, { status_kanban: ["A", "C"] });
      expect(conflito).toEqual(["status_kanban"]);
    });
    it("(iii) protegido + eco do PRÓPRIO upsert (servidor não mudou o kanban): sem conflito falso no retry", () => {
      // upsert(geral) não toca nas 5 colunas de kanban — o servidor real continua ["A"] (mesmo
      // valor de antes da tentativa). O eco desse upsert chega com o kanban intacto.
      const baseAtual = { cfg: pickKanban({ status_kanban: ["A"] }), servidor: pickKanban({ status_kanban: ["A"] }) };
      const local = pickKanban({ status_kanban: ["A", "B"] });
      const servidorNovoDoProprioEco = pickKanban({ status_kanban: ["A"] }); // kanban do banco intocado
      const r = resolverEcoKanban(true, local, servidorNovoDoProprioEco, baseAtual);
      expect(r.kanbanBase).toBe(baseAtual);
      // Retry: kanbanBase.servidor (["A"]) contra o banco real AGORA (["A"], ninguém mudou) — sem conflito.
      const conflito = conflitoKanban(r.kanbanBase.servidor, { status_kanban: ["A"] });
      expect(conflito).toEqual([]);
    });
    it("(iv) sucesso (protegido=false) ⇒ volta ao normal: cfgKanban e kanbanBase adotam o servidor", () => {
      // Reflete o invariante real do chamador (admin/configuracoes.tsx onSuccess, linha ~460):
      // um save bem-sucedido RE-BASEIA `kanbanBase.cfg` para o próprio `cfg` recém-salvo de forma
      // SÍNCRONA, antes do refetch invalidado resolver — então quando este eco roda, `local` já
      // bate com `baseAtual.cfg` (nenhuma coluna fica "tocada" por engano contra o valor salvo).
      const local = pickKanban({ status_kanban: ["A", "B"] }); // já salvo; nada mudou desde o save
      const servidorNovo = pickKanban({ status_kanban: ["A", "B"] }); // eco do próprio save (ou de outra aba, mesmo valor)
      const baseAtual = { cfg: pickKanban({ status_kanban: ["A", "B"] }), servidor: pickKanban({ status_kanban: ["A"] }) };
      const r = resolverEcoKanban(false, local, servidorNovo, baseAtual);
      expect(r.cfgKanban).toEqual(servidorNovo);
      expect(r.kanbanBase).toEqual({ cfg: servidorNovo, servidor: servidorNovo });
    });
  });

  // Achado I2 da revisão (review.md): fora da janela protegida, `resolverEcoKanban` adotava o
  // servidor por INTEIRO (as 5 colunas) mesmo quando havia uma edição LOCAL ainda não salva numa
  // delas — ex.: editar "Status do Kanban" e depois salvar o diálogo "Editar nomenclaturas por
  // módulo" (que também re-hidrata `data.cfg`, sem passar pelo `save` desta tela — `protegido`
  // nunca liga) apagava a edição do kanban em silêncio. Fix: merge POR COLUNA contra
  // `kanbanBase.cfg` (mesmo princípio do `mergeDraft`).
  describe("mesclarKanbanPorColuna / rebasearKanban (fix hidratação rodada 1 — achado I2)", () => {
    it("coluna TOCADA (local ≠ base) sobrevive; coluna intocada adota o servidor novo", () => {
      const base = pickKanban({ status_kanban: ["A"], kanban_requisitos: { a: ["x"] } });
      // Usuário editou localmente `status_kanban` (diverge da base); NÃO tocou `kanban_requisitos`.
      const local = pickKanban({ status_kanban: ["A", "B"], kanban_requisitos: { a: ["x"] } });
      // Servidor mudou por fora (ex.: outro admin, ou o diálogo Nomenclaturas re-hidratando a
      // mesma linha): `kanban_requisitos` ganhou uma entrada nova; `status_kanban` no servidor
      // continua o valor ANTIGO (a edição local ainda não foi salva).
      const servidorNovo = pickKanban({ status_kanban: ["A"], kanban_requisitos: { a: ["x"], b: ["y"] } });
      const fundido = mesclarKanbanPorColuna(local, servidorNovo, base);
      expect(fundido.status_kanban).toEqual(["A", "B"]); // ← I2: minha edição NÃO some
      expect(fundido.kanban_requisitos).toEqual({ a: ["x"], b: ["y"] }); // coluna alheia adotada
    });
    it("rebasearKanban: coluna tocada mantém a base ANTIGA (diff/conflito continuam corretos); intocada re-baseia", () => {
      const base = pickKanban({ status_kanban: ["A"], kanban_requisitos: { a: ["x"] } });
      const local = pickKanban({ status_kanban: ["A", "B"], kanban_requisitos: { a: ["x"] } });
      const servidorNovo = pickKanban({ status_kanban: ["A"], kanban_requisitos: { a: ["x"], b: ["y"] } });
      const r = rebasearKanban(local, servidorNovo, base);
      // status_kanban (tocada): cfg/servidor continuam a base antiga — diffKanban(cfg, cfgAtual)
      // no próximo save ainda mostra a MINHA mudança; conflitoKanban(servidor, bancoAgora) ainda
      // compara contra o valor de antes (não "esconde" um conflito real de outro admin nessa coluna).
      expect(r.cfg.status_kanban).toEqual(["A"]);
      expect(r.servidor.status_kanban).toEqual(["A"]);
      // kanban_requisitos (intocada): re-baseia no servidor novo dos dois lados.
      expect(r.cfg.kanban_requisitos).toEqual({ a: ["x"], b: ["y"] });
      expect(r.servidor.kanban_requisitos).toEqual({ a: ["x"], b: ["y"] });
    });

    // Achado N3 da re-revisão (review-fix1.md; nit de escopo corrigido na rodada 3 — ver
    // review-fix2.md): coluna que DIVERGE da base mas CONVERGIU para o MESMO valor que o
    // servidor porque OUTRO ADMIN fez a MESMA edição (eco SEM save em voo — `protegido=false`)
    // não pode ficar "tocada para sempre". Sem o fix, `conflitoKanban` acusaria um conflito FALSO
    // em TODO save seguinte, até a página recarregar. ⚠️ Isto NÃO cobre o caso "o `update(diff)`
    // gravou e o ack se perdeu" (falha parcial) — esse caso passa pelo ramo PROTEGIDO de
    // `resolverEcoKanban` (kanbanProtegidoRef=true), que devolve `baseAtual` intacto sem chamar
    // `colunaTocada`; o conflito falso desse caminho é pré-existente (F2 do kanban) e fica de
    // fora de escopo aqui.
    it("N3: outro admin fez a MESMA edição (eco não-protegido) — coluna CONVERGIDA NÃO fica tocada, adota e re-baseia normalmente", () => {
      const base = pickKanban({ status_kanban: ["A"] });
      // Minha edição local E o servidor (outro admin fez a MESMA edição, sem save meu em voo)
      // chegaram no MESMO valor ["A","B"] — nenhum dos dois é mais "a base antiga".
      const local = pickKanban({ status_kanban: ["A", "B"] });
      const servidorNovo = pickKanban({ status_kanban: ["A", "B"] });

      const fundido = mesclarKanbanPorColuna(local, servidorNovo, base);
      expect(fundido.status_kanban).toEqual(["A", "B"]); // valor correto (convergiu)

      const r = rebasearKanban(local, servidorNovo, base);
      // Re-baseou nos dois lados — NÃO ficou preso na base antiga ["A"].
      expect(r.cfg.status_kanban).toEqual(["A", "B"]);
      expect(r.servidor.status_kanban).toEqual(["A", "B"]);
      // Sem conflito falso no próximo diff/conflito.
      expect(diffKanban(r.cfg, pickKanban({ status_kanban: ["A", "B"] }))).toEqual({});
      expect(conflitoKanban(r.servidor, { status_kanban: ["A", "B"] })).toEqual([]);
    });
  });
});

describe("kanban-auto-config — textos", () => {
  it("juntarLista e descrição das mudanças", () => {
    expect(juntarLista([])).toBe("");
    expect(juntarLista(["a"])).toBe("a");
    expect(juntarLista(["a", "b", "c"])).toBe("a, b e c");
    expect(descreverMudancasKanban(["kanban_requisitos"])).toBe("os requisitos");
    expect(descreverMudancasKanban(["status_kanban", "kanban_requisitos"])).toBe("as colunas do kanban (nomes ou ordem) e os requisitos");
    expect(descreverMudancasKanban(["kanban_requisitos_excecoes", "revenda_kanban_colunas", "revenda_kanban_requisitos"]))
      .toBe("as exceções da cascata, as colunas da revenda e os requisitos da revenda");
  });
  it("mensagem de conflito", () => {
    expect(mensagemConflitoKanban(["kanban_requisitos"])).toBe(
      "Outra pessoa mudou os requisitos depois que você abriu esta tela. Recarregue a página e refaça a sua alteração antes de salvar.",
    );
  });
  it("nCards", () => {
    expect([nCards(0), nCards(1), nCards(3)]).toEqual(["0 cards", "1 card", "3 cards"]);
  });
  // Minor 1 (fix round 1, garantia D19): `prepararSalvar` guarda a chave que viu; o `mutationFn` relê
  // e compara com esta função pura antes de confirmar o save. `atual` chega como `unknown` porque vem
  // direto do `Record<string, unknown>` de `lerConfigServidor` — nunca assumir que já é boolean.
  it("chaveKanbanMudou compara a chave esperada com o valor RELIDO do servidor", () => {
    expect(chaveKanbanMudou(true, true)).toBe(false);
    expect(chaveKanbanMudou(false, false)).toBe(false);
    expect(chaveKanbanMudou(false, null)).toBe(false); // ausência de coluna (sem F1) ≡ desligada dos dois lados
    expect(chaveKanbanMudou(true, false)).toBe(true);
    expect(chaveKanbanMudou(false, true)).toBe(true);
    expect(chaveKanbanMudou(true, null)).toBe(true); // era true, sumiu/virou null no reread — mudou
    expect(chaveKanbanMudou(true, "true")).toBe(true); // só `=== true` conta como ligado, string não
  });
  it("mensagem fixa da chave mudada", () => {
    expect(MENSAGEM_CHAVE_KANBAN_MUDOU).toBe("A chave Kanban automático mudou em outra aba; recarregue antes de salvar.");
  });
  // Médio 1 (revisão final Opus, garantia D19): a tela segue editável durante o `await` da prévia
  // (`kanban_previa_recalculo`); `diffMudouDesdeAPrevia` compara o diff que embasou a prévia mostrada
  // com o diff recalculado no momento do Salvar — o `mutationFn` aborta quando divergem.
  describe("diffMudouDesdeAPrevia (Médio 1 — D19: prévia ≠ salvo)", () => {
    it("mesmo diff (nada mudou durante o await): false", () => {
      const esperado = pickKanban({ status_kanban: ["A", "B"] });
      const atual = pickKanban({ status_kanban: ["A", "B"] });
      expect(diffMudouDesdeAPrevia(esperado, atual)).toBe(false);
    });
    it("usuário editou mais uma coluna durante o await: true", () => {
      const esperado = diffKanban(pickKanban({ status_kanban: ["A"] }), pickKanban({ status_kanban: ["A", "B"] }));
      const atual = diffKanban(
        pickKanban({ status_kanban: ["A"] }),
        pickKanban({ status_kanban: ["A", "B"], kanban_requisitos: { b: ["x"] } }),
      );
      expect(diffMudouDesdeAPrevia(esperado, atual)).toBe(true);
    });
    it("usuário desfez a edição durante o await (voltou ao que a prévia tinha visto): false", () => {
      const esperado = pickKanban({ status_kanban: ["A", "B"] });
      const atual = pickKanban({ status_kanban: ["A", "B"] }); // mesmo valor, instância nova
      expect(diffMudouDesdeAPrevia(esperado, atual)).toBe(false);
    });
    it("null/undefined tratados como equivalentes (mesma base do jsonCanonico)", () => {
      expect(diffMudouDesdeAPrevia({}, {})).toBe(false);
      expect(diffMudouDesdeAPrevia({ status_kanban: undefined }, { status_kanban: null })).toBe(false);
    });
  });
  it("mensagem fixa da prévia mudada", () => {
    expect(MENSAGEM_PREVIA_KANBAN_MUDOU).toBe("A configuração mudou depois da prévia; clique em Salvar de novo.");
  });
});

describe("kanban-auto-config — prévias", () => {
  it("agruparMovimentos por (de, para) na ordem do board", () => {
    const g = agruparMovimentos(
      [card("1", "em_modelagem", "em_pilotagem"), card("2", "aprovado", "em_pilotagem", true), card("3", "em_modelagem", "em_pilotagem"), card("4", "zzz", "em_modelagem")],
      KEYS,
    );
    expect(g.map((x) => [x.de, x.para, x.recua, x.cards.map((c) => c.modelo_id)])).toEqual([
      ["em_modelagem", "em_pilotagem", false, ["1", "3"]],
      ["aprovado", "em_pilotagem", true, ["2"]],
      ["zzz", "em_modelagem", false, ["4"]],
    ]);
  });
  it("resumirFixados conta por coluna, na ordem do board", () => {
    expect(resumirFixados([fix("1", "stand_by"), fix("2", "reprovado"), fix("3", "stand_by")], KEYS))
      .toEqual([{ coluna: "stand_by", n: 2 }, { coluna: "reprovado", n: 1 }]);
  });
  it("avisos da restauração: some o 'Desligue…' (o diálogo desliga ANTES de restaurar)", () => {
    expect(avisosRestauracaoVisiveis([
      "A REF revelada e o #Erro não voltam.",
      "Desligue o Kanban automático antes de restaurar (senão o próximo salvamento refaz as colunas).",
    ])).toEqual(["A REF revelada e o #Erro não voltam."]);
  });
  it("formatarDataHora no fuso da loja", () => {
    expect(formatarDataHora("2026-09-22T17:30:00Z", "America/Sao_Paulo")).toBe("22/09/2026 14:30");
    expect(formatarDataHora("2026-09-23T03:05:00Z", "America/Sao_Paulo")).toBe("23/09/2026 00:05");
    expect(formatarDataHora(null, "America/Sao_Paulo")).toBe("—");
    expect(formatarDataHora("lixo", "America/Sao_Paulo")).toBe("—");
  });
});
