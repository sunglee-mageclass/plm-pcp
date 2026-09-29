// Base de testes de REGRESSÃO do produto (fix-hidratação, P-57 A — usado pelos 7 arquivos em
// tests/unit/_fix_hidratacao/). Supabase FALSO, em memória, sem rede. Cada leitura devolve um
// objeto NOVO (como o JSON.parse do PostgREST) — a estrutura compartilhada do TanStack Query
// decide se a referência muda. Leituras podem ser SEGURADAS (gate) para simular a janela de rede
// entre "formulário já na tela" e "dado chegou", ou FALHAR (`falhar`) para simular erro de rede.

type Filtro = { col: string; val: unknown };
export type Chamada = { tabela: string; op: string; filtros: Filtro[]; payload?: unknown; modo?: string };

type Gate = { promessa: Promise<void>; soltar: () => void };
function novoGate(): Gate {
  let soltar!: () => void;
  const promessa = new Promise<void>((r) => { soltar = r; });
  return { promessa, soltar };
}

export function criarFakeSupabase() {
  const linhas: Record<string, Record<string, any>[]> = {};
  const chamadas: Chamada[] = [];
  const gates: Record<string, Gate | null> = {};
  // Fix hidratação rodada 1 (achado I1): próxima(s) leitura(s) da tabela devolvem erro em vez de
  // dado — simula falha de rede (queryFn que hoje engole o erro passa a dar throw).
  const falhas: Record<string, number> = {};
  const canais: { nome: string; ouvintes: { tabela: string; cb: (p: unknown) => void }[] }[] = [];
  // Revisão T3/T4 (M4): P0409 sem DETAIL (o cliente tem de tratar TODAS as colunas enviadas como conflito).
  const opcoes = { p0409SemDetalhe: false };

  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

  function resolverLeitura(c: Chamada): { data: any; error: any } {
    if (falhas[c.tabela] > 0) {
      falhas[c.tabela] -= 1;
      return { data: null, error: { message: "erro simulado (fix hidratação)", code: "FAKE_ERR" } };
    }
    const rows = (linhas[c.tabela] ?? []).filter((r) => c.filtros.every((f) => r[f.col] === f.val));
    if (c.modo === "single" || c.modo === "maybeSingle") return { data: rows[0] ? clone(rows[0]) : null, error: null };
    return { data: clone(rows), error: null };
  }

  function executar(c: Chamada): Promise<{ data: any; error: any }> {
    chamadas.push(c);
    if (c.op === "select") {
      const g = gates[c.tabela];
      const run = () => resolverLeitura(c);
      return g ? g.promessa.then(run) : Promise.resolve().then(run);
    }
    if (c.op === "upsert" || c.op === "update") {
      const p = c.payload as Record<string, any>;
      const alvo = (linhas[c.tabela] ?? []).find((r) =>
        c.op === "upsert" ? r.tenant_id === p.tenant_id || r.id === p.id : c.filtros.every((f) => r[f.col] === f.val));
      if (alvo) Object.assign(alvo, clone(p));
      else (linhas[c.tabela] ??= []).push(clone(p));
      return Promise.resolve({ data: alvo ? [clone(alvo)] : [], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }

  // Config da Loja colaborativa (T3): espelho em memória da RPC `salvar_config_loja` (T1) — o
  // compare-and-set POR COLUNA sobre a linha falsa de `tenant_config`. Mesmas regras/textos do banco
  // (ver .superpowers/sdd/2026-09-29-config-colab/t1-report.md): toda chave de `_mudancas` em `_base`
  // (senão P0001); conflito = linha ≠ base E linha ≠ mudança NORMALIZADA (convergido não conta); linha recém-criada
  // pula o compare-and-set; chave do kanban conferida quando alguma das 5 colunas de kanban vai; nada
  // gravado em qualquer recusa; devolve `{gravadas, valores}` só das colunas gravadas.
  const KANBAN_CFG = ["status_kanban", "kanban_requisitos", "kanban_requisitos_excecoes", "revenda_kanban_colunas", "revenda_kanban_requisitos"];
  const canon = (v: unknown): string => {
    if (v === undefined || v === null) return "null";
    if (typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
  };
  function salvarConfigLoja(a: Record<string, any>): { data: any; error: any } {
    const mud = (a?._mudancas ?? {}) as Record<string, unknown>;
    const base = (a?._base ?? {}) as Record<string, unknown>;
    const chaves = Object.keys(mud).sort();
    if (chaves.length === 0) return { data: { gravadas: [], valores: {} }, error: null };
    for (const k of chaves) {
      if (!(k in base)) return { data: null, error: { code: "P0001", message: `Falta o valor carregado do campo "${k}". Recarregue a página e tente de novo.` } };
    }
    const tabela = (linhas.tenant_config ??= []);
    let row = tabela.find((r) => r.tenant_id === a._tenant_id);
    const criada = !row;
    const kanban = chaves.some((k) => KANBAN_CFG.includes(k));
    if (kanban) {
      if (a._chave_kanban_esperada === undefined || a._chave_kanban_esperada === null) {
        return { data: null, error: { code: "P0001", message: "Recarregue a página antes de salvar o Kanban (estado da chave do Kanban automático não informado)." } };
      }
      if (a._chave_kanban_esperada !== ((row?.kanban_automatico ?? false) === true)) {
        return { data: null, error: { code: "P0409", message: "chave_kanban_mudou: a chave do kanban mudou" } };
      }
    }
    // Normalização ÚNICA do banco (T1 review M3, ecc95f46): keywords com btrim; só espaços → null. Vale para o
    // "convergido" do compare-and-set E para o valor gravado.
    const norm: Record<string, unknown> = { ...mud };
    if ("keywords" in norm) {
      const kw = typeof norm.keywords === "string" ? norm.keywords.trim() : "";
      norm.keywords = kw === "" ? null : kw;
    }
    if (!criada) {
      const conf = chaves.filter((k) => canon(row![k]) !== canon(base[k]) && canon(row![k]) !== canon(norm[k]));
      if (conf.length) {
        return { data: null, error: { code: "P0409", message: "conflito_versao: config_loja", details: opcoes.p0409SemDetalhe ? "" : conf.join(",") } };
      }
    }
    if (!row) { row = { tenant_id: a._tenant_id }; tabela.push(row); }
    const valores: Record<string, unknown> = {};
    for (const k of chaves) {
      const v = clone(norm[k] ?? null);
      row[k] = v;
      valores[k] = clone(v);
    }
    return { data: { gravadas: chaves, valores }, error: null };
  }

  function builder(tabela: string) {
    const c: Chamada = { tabela, op: "select", filtros: [] };
    const b: any = {
      select: () => b,
      eq: (col: string, val: unknown) => { c.filtros.push({ col, val }); return b; },
      maybeSingle: () => { c.modo = "maybeSingle"; return b; },
      single: () => { c.modo = "single"; return b; },
      upsert: (payload: unknown) => { c.op = "upsert"; c.payload = payload; return b; },
      update: (payload: unknown) => { c.op = "update"; c.payload = payload; return b; },
      insert: (payload: unknown) => { c.op = "insert"; c.payload = payload; return b; },
      delete: () => { c.op = "delete"; return b; },
      then: (ok: any, err: any) => executar(c).then(ok, err),
    };
    // filtros/ordenações que as telas usam mas que não importam para o repro
    for (const m of ["neq", "not", "in", "is", "order", "limit", "range", "gte", "lte", "gt", "lt", "ilike", "or", "match", "filter", "contains"])
      b[m] = () => b;
    return b;
  }

  const supabase: any = {
    from: (t: string) => builder(t),
    rpc: (nome: string, args?: unknown) => {
      chamadas.push({ tabela: `rpc:${nome}`, op: "rpc", filtros: [], payload: args });
      if (nome === "salvar_config_loja") {
        // Revisão T3/T4: a RPC pode ser SEGURADA (`segurar("rpc:salvar_config_loja")`) — simula a resposta
        // lenta (eco do Realtime/troca de loja no meio do voo). A decisão (compare-and-set) roda ao SOLTAR.
        const g = gates["rpc:salvar_config_loja"];
        const run = () => salvarConfigLoja(args as Record<string, any>);
        return g ? g.promessa.then(run) : Promise.resolve().then(run);
      }
      return Promise.resolve({ data: null, error: null });
    },
    channel: (nome: string) => {
      const canal = { nome, ouvintes: [] as { tabela: string; cb: (p: unknown) => void }[] };
      canais.push(canal);
      const ch: any = {
        topic: `realtime:${nome}`,
        on: (_tipo: string, filtro: { table: string }, cb: (p: unknown) => void) => { canal.ouvintes.push({ tabela: filtro.table, cb }); return ch; },
        subscribe: () => ch,
        track: () => Promise.resolve(),
        untrack: () => Promise.resolve(),
        send: () => Promise.resolve(),
        presenceState: () => ({}),
        unsubscribe: () => Promise.resolve(),
      };
      return ch;
    },
    removeChannel: () => Promise.resolve(),
    getChannels: () => [],
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }), createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) },
  };

  return {
    supabase,
    linhas,
    reset() {
      for (const k of Object.keys(linhas)) delete linhas[k];
      chamadas.length = 0;
      for (const k of Object.keys(gates)) delete gates[k];
      for (const k of Object.keys(falhas)) delete falhas[k];
      canais.length = 0;
      opcoes.p0409SemDetalhe = false;
    },
    chamadas,
    /** Segura TODAS as próximas leituras da tabela até `soltar()`. */
    segurar(tabela: string) { const g = novoGate(); gates[tabela] = g; return () => { gates[tabela] = null; g.soltar(); }; },
    /** Revisão T3/T4 (M4): o próximo P0409 `conflito_versao: config_loja` sai com DETAIL vazio. */
    p0409SemDetalhe(v = true) { opcoes.p0409SemDetalhe = v; },
    /** Faz as próximas `n` leituras (select) da tabela devolverem `{data:null,error}` em vez do dado. */
    falhar(tabela: string, n = 1) { falhas[tabela] = n; },
    /** Emite um evento `postgres_changes` (o que o Realtime faz quando OUTRA escrita chega na tabela). */
    emitirRealtime(tabela: string) {
      for (const canal of canais) for (const o of canal.ouvintes) if (o.tabela === tabela) o.cb({ table: tabela });
    },
  };
}

/** Instância ÚNICA compartilhada entre o `vi.mock` do client e o teste (mesmo módulo no cache do vitest). */
export const FAKE = criarFakeSupabase();
