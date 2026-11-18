# Co-edição ao vivo (Onda 3) — Lock por campo + overlay — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No Sheet do Planejamento, enquanto uma pessoa edita um campo esse campo fica travado para as outras (que veem as letras caírem ao vivo), reusando o canal Realtime que já existe — sem Yjs, sem banco, sem canal novo.

**Architecture:** Camada de overlay ao vivo (Abordagem A). O `draft` local continua sendo só o que EU edito; o valor ao vivo do outro vive num mapa separado (`valorAoVivoPorPath`) que nunca entra no draft nem no Salvar. Lock por campo via dois eventos de broadcast novos (`campoLock`, `valorAoVivo`) no canal `colab:modelo:${modeloId}` que o `useColabRegistro` já abre; desempate determinístico por `presenceKey`; expiração do lock por heartbeat.

**Tech Stack:** React + TypeScript + Supabase Realtime (broadcast) + Vitest/happy-dom. Reusa `useColabRegistro`, `ColabPresenceOverlay`, `colab-field-path.ts`.

**Spec:** `docs/superpowers/specs/2026-11-18-coedicao-onda3-lock-overlay-design.md`

## Global Constraints

- **Front puro — ZERO migration, ZERO banco.** Nenhuma alteração em `supabase/`.
- **Nenhum canal Realtime novo.** Tudo no canal `colab:modelo:${modeloId}` já aberto pelo `useColabRegistro`. Gate de QA: contar os canais WS = continua ~4.
- **Nenhuma dependência nova.** Sem Yjs, sem lodash. Throttle é função pura própria.
- **Overlay NUNCA entra no payload do Salvar.** `valorAoVivoPorPath` é isolado do `draft`/`draftLiveRef`. O P0409/merge das Ondas 1-2 fica intocado.
- **Expiração do lock é incondicional (~10s).** Nenhum caminho deixa um campo travado pra sempre.
- **Throttle ~100ms** no `valorAoVivo`; **heartbeat ~4s** no lock; **expiração ~10s**.
- **Broadcast `self:false`** (como o `campoFocado` de hoje) — não recebo meu próprio eco.
- **Path semântico reusado:** `pathDoElemento`/`elementoDoPath` (`src/lib/colab/colab-field-path.ts`) — NÃO criar path novo.
- **Degradação graciosa:** sem canal → sem lock, sem espelho; a tela volta ao comportamento das Ondas 1-2.
- **Gates da campanha:** após mexer em imports, `npx tsc --noEmit 2>&1 | grep TS2304`; `npm run build`; testes com `--no-file-parallelism`.
- **TZ dos testes:** usar fake timers do Vitest (`vi.useFakeTimers()`) para throttle/heartbeat/expiração — nunca `sleep` real.

## Review Focus

- **Empate de foco (dois focam o mesmo campo no mesmo instante):** o desempate por `presenceKey` menor deve decidir um único dono; a aba perdedora cede. Testado no Task 1 (`resolverLock`).
- **Aba que some sem soltar o lock (crash/net):** o campo trava deve expirar em ~10s e liberar para os outros. Testado no Task 1 (`estadoDoCampo` com `ts` vencido) e no Task 3 (hook + fake timers).
- **Valor ao vivo do outro vazar para o meu Salvar:** o payload do Salvar nunca pode conter `valorAoVivoPorPath`. Testado no Task 4 (teste-guarda).
- **Canal cai (incidente MICRO):** sem canal, todos os campos ficam editáveis (sem lock) e nada quebra. Testado no Task 3 (hook sem canal retorna mapas vazios).
- **Campo composto (Select/DateField/MoneyInput) travado:** `disabled` via DOM não basta; o escudo de clique por path deve impedir a edição. Testado no Task 2 (`aplicarCoedicao` aplica escudo em path *outro*).

---

### Task 1: Lib pura de co-edição (`coedicao.ts`) — throttle, desempate, estado do campo

**Files:**
- Create: `src/lib/colab/coedicao.ts`
- Test: `tests/unit/colab-coedicao.test.ts`

**Interfaces:**
- Consumes: nada (fundação).
- Produces:
  - `type LockInfo = { key: string; path: string; ts: number }` — um lock anunciado por uma aba.
  - `type EstadoCampo = "livre" | "meu" | "outro"`.
  - `const EXPIRACAO_LOCK_MS = 10_000`, `const HEARTBEAT_MS = 4_000`, `const THROTTLE_MS = 100`.
  - `function resolverLock(locks: LockInfo[], path: string, agora: number): LockInfo | null` — dado o conjunto de locks de um path, devolve o DONO vigente (menor `key` entre os não-expirados; `null` se nenhum vivo).
  - `function estadoDoCampo(path: string, locks: LockInfo[], meuKey: string, agora: number): { estado: EstadoCampo; dono: LockInfo | null }`.
  - `function criarThrottle<T>(fn: (v: T) => void, ms: number): { enviar: (v: T) => void; soltar: () => void }` — borda de ataque + agrupa + entrega o último no `soltar()`. Usa `Date.now()` e `setTimeout`.

- [ ] **Step 1: Write the failing test** (`tests/unit/colab-coedicao.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolverLock, estadoDoCampo, criarThrottle,
  EXPIRACAO_LOCK_MS, THROTTLE_MS, type LockInfo,
} from "@/lib/colab/coedicao";

const lk = (key: string, path: string, ts: number): LockInfo => ({ key, path, ts });

describe("resolverLock", () => {
  it("sem locks → null", () => {
    expect(resolverLock([], "lbl:nome", 1000)).toBeNull();
  });
  it("um lock vivo → ele é o dono", () => {
    expect(resolverLock([lk("a::1", "lbl:nome", 1000)], "lbl:nome", 1500)?.key).toBe("a::1");
  });
  it("empate no mesmo path → menor key vence (desempate determinístico)", () => {
    const dono = resolverLock(
      [lk("b::9", "lbl:nome", 1000), lk("a::2", "lbl:nome", 1000)], "lbl:nome", 1500,
    );
    expect(dono?.key).toBe("a::2");
  });
  it("lock expirado (ts > EXPIRACAO atrás) é ignorado", () => {
    const agora = 1000 + EXPIRACAO_LOCK_MS + 1;
    expect(resolverLock([lk("a::1", "lbl:nome", 1000)], "lbl:nome", agora)).toBeNull();
  });
  it("ignora locks de outros paths", () => {
    expect(resolverLock([lk("a::1", "lbl:cor", 1000)], "lbl:nome", 1500)).toBeNull();
  });
});

describe("estadoDoCampo", () => {
  const meu = "a::1";
  it("sem lock → livre", () => {
    expect(estadoDoCampo("lbl:nome", [], meu, 1500).estado).toBe("livre");
  });
  it("meu lock → meu", () => {
    expect(estadoDoCampo("lbl:nome", [lk(meu, "lbl:nome", 1000)], meu, 1500).estado).toBe("meu");
  });
  it("lock de outro vivo → outro, com dono", () => {
    const r = estadoDoCampo("lbl:nome", [lk("z::9", "lbl:nome", 1000)], meu, 1500);
    expect(r.estado).toBe("outro");
    expect(r.dono?.key).toBe("z::9");
  });
  it("lock de outro expirado → livre (pode assumir)", () => {
    const agora = 1000 + EXPIRACAO_LOCK_MS + 1;
    expect(estadoDoCampo("lbl:nome", [lk("z::9", "lbl:nome", 1000)], meu, agora).estado).toBe("livre");
  });
  it("meu lock vence sobre o de outro no mesmo path se minha key é menor", () => {
    const r = estadoDoCampo("a::1", [lk("a::1", "lbl:nome", 1000), lk("z::9", "lbl:nome", 1000)], "a::1", 1500);
    expect(r.estado).toBe("meu");
  });
});

describe("criarThrottle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("emite na borda de ataque imediatamente", () => {
    const spy = vi.fn();
    const t = criarThrottle<string>(spy, THROTTLE_MS);
    t.enviar("a");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith("a");
  });
  it("rajada de 7 em <100ms → 1 na borda + o último no soltar (não 7)", () => {
    const spy = vi.fn();
    const t = criarThrottle<string>(spy, THROTTLE_MS);
    for (const c of ["a","ab","abc","abcd","abcde","abcdef","abcdefg"]) t.enviar(c);
    t.soltar();
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
    expect(spy).toHaveBeenLastCalledWith("abcdefg"); // o último valor SEMPRE entregue
  });
  it("após a janela, o próximo enviar emite de novo", () => {
    const spy = vi.fn();
    const t = criarThrottle<string>(spy, THROTTLE_MS);
    t.enviar("a");
    vi.advanceTimersByTime(THROTTLE_MS + 1);
    t.enviar("b");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith("b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/colab-coedicao.test.ts`
Expected: FAIL — `Cannot find module '@/lib/colab/coedicao'`.

- [ ] **Step 3: Write minimal implementation** (`src/lib/colab/coedicao.ts`)

```ts
// Lib PURA da co-edição ao vivo (Onda 3). Sem DOM, sem rede — só a lógica de lock/desempate/throttle.
// Spec: docs/superpowers/specs/2026-11-18-coedicao-onda3-lock-overlay-design.md
export const EXPIRACAO_LOCK_MS = 10_000;
export const HEARTBEAT_MS = 4_000;
export const THROTTLE_MS = 100;

export type LockInfo = { key: string; path: string; ts: number };
export type EstadoCampo = "livre" | "meu" | "outro";

/** Dono vigente de um path: menor `key` entre os locks NÃO expirados daquele path. */
export function resolverLock(locks: LockInfo[], path: string, agora: number): LockInfo | null {
  let dono: LockInfo | null = null;
  for (const l of locks) {
    if (l.path !== path) continue;
    if (agora - l.ts > EXPIRACAO_LOCK_MS) continue; // expirado
    if (!dono || l.key < dono.key) dono = l;
  }
  return dono;
}

export function estadoDoCampo(
  path: string, locks: LockInfo[], meuKey: string, agora: number,
): { estado: EstadoCampo; dono: LockInfo | null } {
  const dono = resolverLock(locks, path, agora);
  if (!dono) return { estado: "livre", dono: null };
  if (dono.key === meuKey) return { estado: "meu", dono };
  return { estado: "outro", dono };
}

/** Throttle borda-de-ataque + trailing: emite já no 1º `enviar`, agrupa a rajada, e o `soltar`
 *  garante a entrega do ÚLTIMO valor (o campo nunca fica "atrasado" de uma tecla). */
export function criarThrottle<T>(fn: (v: T) => void, ms: number): { enviar: (v: T) => void; soltar: () => void } {
  let ultimoEnvio = 0;
  let pendente: { v: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const disparar = (v: T) => { ultimoEnvio = Date.now(); pendente = null; fn(v); };
  const agendarTrailing = () => {
    if (timer) return;
    const espera = Math.max(0, ms - (Date.now() - ultimoEnvio));
    timer = setTimeout(() => {
      timer = null;
      if (pendente) disparar(pendente.v);
    }, espera);
  };
  return {
    enviar(v: T) {
      const agora = Date.now();
      if (agora - ultimoEnvio >= ms) { disparar(v); }
      else { pendente = { v }; agendarTrailing(); }
    },
    soltar() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (pendente) disparar(pendente.v);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/colab-coedicao.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"
git add src/lib/colab/coedicao.ts tests/unit/colab-coedicao.test.ts
git commit --only src/lib/colab/coedicao.ts tests/unit/colab-coedicao.test.ts -m "feat(colab): lib pura da co-edição (throttle, desempate de lock, estado do campo)"
```

---

### Task 2: Aplicação no DOM (`aplicarCoedicao`) — disabled, escudo, valor injetado

**Files:**
- Modify: `src/lib/colab/coedicao.ts` (acrescenta `aplicarCoedicao` + constante de atributo)
- Test: `tests/unit/colab-coedicao-dom.test.ts`

**Interfaces:**
- Consumes: `estadoDoCampo`, `LockInfo` (Task 1); `pathDoElemento`/`COLAB_FIELD_SELECTOR` de `@/lib/colab/colab-field-path`.
- Produces:
  - `const ATTR_COEDICAO = "data-coedicao-travado"` — marca aplicada ao campo travado por outro (p/ o CSS do escudo e p/ limpeza idempotente).
  - `function aplicarCoedicao(scope: HTMLElement, locks: LockInfo[], valorAoVivoPorPath: Record<string,string>, meuKey: string, agora: number): void` — percorre os campos do scope; para cada path *outro*: marca `data-coedicao-travado`, põe `disabled` (input/textarea/select) e injeta `valorAoVivoPorPath[path]` no `.value` quando houver; para path *livre*/*meu*: remove a marca e o `disabled` que ELE pôs (idempotente — nunca mexe no `disabled` de um campo que já era desabilitado por outra razão: só reverte os que carregam `ATTR_COEDICAO`).

- [ ] **Step 1: Write the failing test** (`tests/unit/colab-coedicao-dom.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { aplicarCoedicao, ATTR_COEDICAO, type LockInfo } from "@/lib/colab/coedicao";

// happy-dom já é o environment do projeto (ver vitest config). Montamos um scope com 2 campos
// rotulados (o path é derivado do <label>, como no projeto real).
function montarScope(): HTMLElement {
  const scope = document.createElement("div");
  scope.innerHTML = `
    <div class="grid gap-1"><label>Nome</label><input id="nome" /></div>
    <div class="grid gap-1"><label>Cor</label><input id="cor" /></div>`;
  document.body.appendChild(scope);
  return scope;
}
const lk = (key: string, path: string, ts: number): LockInfo => ({ key, path, ts });

describe("aplicarCoedicao", () => {
  it("campo travado por OUTRO fica disabled + marca + valor injetado", () => {
    const scope = montarScope();
    const nome = scope.querySelector<HTMLInputElement>("#nome")!;
    aplicarCoedicao(scope, [lk("z::9", "lbl:nome", 1000)], { "lbl:nome": "Vestido" }, "a::1", 1500);
    expect(nome.disabled).toBe(true);
    expect(nome.getAttribute(ATTR_COEDICAO)).toBe("1");
    expect(nome.value).toBe("Vestido");
  });
  it("campo LIVRE fica intocado", () => {
    const scope = montarScope();
    const cor = scope.querySelector<HTMLInputElement>("#cor")!;
    aplicarCoedicao(scope, [lk("z::9", "lbl:nome", 1000)], {}, "a::1", 1500);
    expect(cor.disabled).toBe(false);
    expect(cor.hasAttribute(ATTR_COEDICAO)).toBe(false);
  });
  it("campo MEU não é travado", () => {
    const scope = montarScope();
    const nome = scope.querySelector<HTMLInputElement>("#nome")!;
    aplicarCoedicao(scope, [lk("a::1", "lbl:nome", 1000)], {}, "a::1", 1500);
    expect(nome.disabled).toBe(false);
  });
  it("ao soltar o lock, reverte SÓ o que ele travou (idempotente)", () => {
    const scope = montarScope();
    const nome = scope.querySelector<HTMLInputElement>("#nome")!;
    aplicarCoedicao(scope, [lk("z::9", "lbl:nome", 1000)], {}, "a::1", 1500);
    expect(nome.disabled).toBe(true);
    aplicarCoedicao(scope, [], {}, "a::1", 1600); // lock sumiu
    expect(nome.disabled).toBe(false);
    expect(nome.hasAttribute(ATTR_COEDICAO)).toBe(false);
  });
  it("não reverte disabled de campo que JÁ estava disabled por outra razão", () => {
    const scope = montarScope();
    const nome = scope.querySelector<HTMLInputElement>("#nome")!;
    nome.disabled = true; // desabilitado por permissão, sem a marca de co-edição
    aplicarCoedicao(scope, [], {}, "a::1", 1500);
    expect(nome.disabled).toBe(true); // intocado
  });
  it("lock expirado de outro não trava (campo livre)", () => {
    const scope = montarScope();
    const nome = scope.querySelector<HTMLInputElement>("#nome")!;
    aplicarCoedicao(scope, [lk("z::9", "lbl:nome", 1000)], {}, "a::1", 1000 + 10_001);
    expect(nome.disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/colab-coedicao-dom.test.ts`
Expected: FAIL — `aplicarCoedicao`/`ATTR_COEDICAO` não exportados.

- [ ] **Step 3: Write minimal implementation** (acrescentar a `src/lib/colab/coedicao.ts`)

```ts
import { pathDoElemento, COLAB_FIELD_SELECTOR } from "@/lib/colab/colab-field-path";

export const ATTR_COEDICAO = "data-coedicao-travado";

/** Instrumenta o DOM do scope: campos travados por OUTRO ficam disabled + marca + valor ao vivo;
 *  os demais são revertidos (só os que ESTE helper travou, via a marca — idempotente). */
export function aplicarCoedicao(
  scope: HTMLElement,
  locks: LockInfo[],
  valorAoVivoPorPath: Record<string, string>,
  meuKey: string,
  agora: number,
): void {
  const campos = scope.querySelectorAll<HTMLElement>(COLAB_FIELD_SELECTOR);
  for (const el of campos) {
    const path = pathDoElemento(el, scope);
    const travado = path ? estadoDoCampo(path, locks, meuKey, agora).estado === "outro" : false;
    const jaMarcado = el.getAttribute(ATTR_COEDICAO) === "1";
    if (travado && path) {
      el.setAttribute(ATTR_COEDICAO, "1");
      if ("disabled" in el) (el as HTMLInputElement).disabled = true;
      const v = valorAoVivoPorPath[path];
      if (v !== undefined && "value" in el) (el as HTMLInputElement).value = v;
    } else if (jaMarcado) {
      // Reverte SÓ o que nós travamos.
      el.removeAttribute(ATTR_COEDICAO);
      if ("disabled" in el) (el as HTMLInputElement).disabled = false;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/colab-coedicao-dom.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"
git add src/lib/colab/coedicao.ts tests/unit/colab-coedicao-dom.test.ts
git commit --only src/lib/colab/coedicao.ts tests/unit/colab-coedicao-dom.test.ts -m "feat(colab): aplicarCoedicao — trava campo por path no DOM (disabled + valor ao vivo, reversão idempotente)"
```

---

### Task 3: Hook `useCoedicaoAoVivo` — eventos no canal existente, heartbeat, expiração

**Files:**
- Create: `src/hooks/useCoedicaoAoVivo.ts`
- Test: `tests/unit/use-coedicao-ao-vivo.test.ts`

**Interfaces:**
- Consumes: `LockInfo`, `estadoDoCampo`, `criarThrottle`, `HEARTBEAT_MS`, `THROTTLE_MS` (Task 1); o canal Realtime já aberto pelo `useColabRegistro`, acessado por `supabase.getChannels().find(c => c.topic === \`realtime:${chave}\`)` (MESMO padrão do re-eco do `useColabRegistro`).
- Produces:
  - `function useCoedicaoAoVivo(o: { chave: string | null; meuKey: string; }): { locks: LockInfo[]; valorAoVivoPorPath: Record<string,string>; anunciarLock: (path: string | null) => void; emitirValor: (path: string, valor: string) => void; }`
  - Sem canal (`chave` null ou canal não encontrado) → `locks: []`, `valorAoVivoPorPath: {}`, e `anunciarLock`/`emitirValor` viram no-op (degradação graciosa, incidente MICRO).
  - `anunciarLock(path)` envia broadcast `campoLock` `{ key: meuKey, path, ts: Date.now() }`; `path:null` solta.
  - Heartbeat: enquanto `meuPathAtual` ≠ null, re-anuncia o `campoLock` a cada `HEARTBEAT_MS`.
  - `emitirValor(path, valor)` usa um `criarThrottle` por emissão (throttle ~100ms) para broadcast `valorAoVivo` `{ key, path, valor }`.
  - Recebe `campoLock`/`valorAoVivo` dos pares; mantém `locks` (substitui o lock anterior da mesma `key`, remove quando `path:null`) e `valorAoVivoPorPath` (por path do dono vigente). Limpa locks expirados por um `setInterval` leve (a cada ~2s) para o estado refletir a expiração mesmo sem novos eventos.

**NOTA de design (ruling):** o hook NÃO abre canal — depende do `useColabRegistro` já ter aberto `colab:modelo:${modeloId}`. Isso garante "nenhum canal novo". Se o canal ainda não existe no 1º render (corrida), os `send` caem no ramo no-op e o heartbeat/efeito re-tenta `getChannels()` a cada batida — assim que o canal sobe, passa a funcionar.

- [ ] **Step 1: Write the failing test** (`tests/unit/use-coedicao-ao-vivo.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCoedicaoAoVivo } from "@/hooks/useCoedicaoAoVivo";

// Stub do canal Supabase: captura handlers de "broadcast" por evento e registra os sends.
const sends: any[] = [];
let handlers: Record<string, (msg: any) => void> = {};
const fakeChannel = {
  topic: "realtime:colab:modelo:M1",
  on(_type: string, filter: { event: string }, cb: (msg: any) => void) { handlers[filter.event] = cb; return this; },
  send(msg: any) { sends.push(msg); return Promise.resolve("ok"); },
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { getChannels: () => [fakeChannel] },
}));

function receber(event: string, payload: any) {
  act(() => handlers[event]?.({ payload }));
}

describe("useCoedicaoAoVivo", () => {
  beforeEach(() => { sends.length = 0; handlers = {}; vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it("sem chave → mapas vazios e no-op (degradação graciosa)", () => {
    const { result } = renderHook(() => useCoedicaoAoVivo({ chave: null, meuKey: "a::1" }));
    expect(result.current.locks).toEqual([]);
    expect(result.current.valorAoVivoPorPath).toEqual({});
    act(() => result.current.anunciarLock("lbl:nome")); // não lança
    expect(sends.length).toBe(0);
  });

  it("anunciarLock envia broadcast campoLock com minha key/path/ts", () => {
    const { result } = renderHook(() => useCoedicaoAoVivo({ chave: "colab:modelo:M1", meuKey: "a::1" }));
    act(() => result.current.anunciarLock("lbl:nome"));
    const msg = sends.find((s) => s.event === "campoLock");
    expect(msg.payload).toMatchObject({ key: "a::1", path: "lbl:nome" });
    expect(typeof msg.payload.ts).toBe("number");
  });

  it("recebe campoLock de um par → entra em locks", () => {
    const { result } = renderHook(() => useCoedicaoAoVivo({ chave: "colab:modelo:M1", meuKey: "a::1" }));
    receber("campoLock", { key: "z::9", path: "lbl:nome", ts: Date.now() });
    expect(result.current.locks.some((l) => l.key === "z::9" && l.path === "lbl:nome")).toBe(true);
  });

  it("campoLock com path:null remove o lock daquele par", () => {
    const { result } = renderHook(() => useCoedicaoAoVivo({ chave: "colab:modelo:M1", meuKey: "a::1" }));
    receber("campoLock", { key: "z::9", path: "lbl:nome", ts: Date.now() });
    receber("campoLock", { key: "z::9", path: null, ts: Date.now() });
    expect(result.current.locks.some((l) => l.key === "z::9")).toBe(false);
  });

  it("valorAoVivo de um par entra em valorAoVivoPorPath", () => {
    const { result } = renderHook(() => useCoedicaoAoVivo({ chave: "colab:modelo:M1", meuKey: "a::1" }));
    receber("valorAoVivo", { key: "z::9", path: "lbl:nome", valor: "Vestido" });
    expect(result.current.valorAoVivoPorPath["lbl:nome"]).toBe("Vestido");
  });

  it("heartbeat re-anuncia meu lock enquanto houver path ativo", () => {
    const { result } = renderHook(() => useCoedicaoAoVivo({ chave: "colab:modelo:M1", meuKey: "a::1" }));
    act(() => result.current.anunciarLock("lbl:nome"));
    sends.length = 0;
    act(() => vi.advanceTimersByTime(4_100));
    expect(sends.some((s) => s.event === "campoLock" && s.payload.path === "lbl:nome")).toBe(true);
  });

  it("lock de outro expira sozinho após ~10s mesmo sem novo evento", () => {
    const { result } = renderHook(() => useCoedicaoAoVivo({ chave: "colab:modelo:M1", meuKey: "a::1" }));
    receber("campoLock", { key: "z::9", path: "lbl:nome", ts: Date.now() });
    expect(result.current.locks.length).toBe(1);
    act(() => vi.advanceTimersByTime(10_500));
    expect(result.current.locks.some((l) => l.key === "z::9")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/use-coedicao-ao-vivo.test.ts`
Expected: FAIL — `@/hooks/useCoedicaoAoVivo` não existe.

- [ ] **Step 3: Write minimal implementation** (`src/hooks/useCoedicaoAoVivo.ts`)

```ts
// Hook da co-edição ao vivo (Onda 3). NÃO abre canal — usa o canal que o useColabRegistro já abriu
// (`realtime:${chave}`), garantindo "nenhum canal novo". Degrada gracioso sem canal.
// Spec: docs/superpowers/specs/2026-11-18-coedicao-onda3-lock-overlay-design.md
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { criarThrottle, EXPIRACAO_LOCK_MS, HEARTBEAT_MS, THROTTLE_MS, type LockInfo } from "@/lib/colab/coedicao";

type MsgLock = { key?: string; path?: string | null; ts?: number };
type MsgValor = { key?: string; path?: string; valor?: string };

export function useCoedicaoAoVivo(o: { chave: string | null; meuKey: string }) {
  const [locks, setLocks] = useState<LockInfo[]>([]);
  const [valorAoVivoPorPath, setValor] = useState<Record<string, string>>({});
  const meuPathRef = useRef<string | null>(null);
  const throttlesRef = useRef<Map<string, ReturnType<typeof criarThrottle<string>>>>(new Map());

  const canal = useCallback(() => {
    if (!o.chave) return null;
    return supabase.getChannels().find((c) => c.topic === `realtime:${o.chave}`) ?? null;
  }, [o.chave]);

  // Assina os eventos do par (no canal já aberto) + limpa expirados periodicamente.
  useEffect(() => {
    const ch = canal();
    if (!ch) return;
    ch.on("broadcast", { event: "campoLock" }, (msg: { payload: MsgLock }) => {
      const p = msg.payload;
      if (!p?.key || p.key === o.meuKey) return;
      setLocks((prev) => {
        const semEle = prev.filter((l) => l.key !== p.key);
        return p.path ? [...semEle, { key: p.key!, path: p.path, ts: p.ts ?? Date.now() }] : semEle;
      });
    });
    ch.on("broadcast", { event: "valorAoVivo" }, (msg: { payload: MsgValor }) => {
      const p = msg.payload;
      if (!p?.key || p.key === o.meuKey || !p.path) return;
      setValor((prev) => ({ ...prev, [p.path!]: p.valor ?? "" }));
    });
    const limpeza = setInterval(() => {
      const agora = Date.now();
      setLocks((prev) => prev.filter((l) => agora - l.ts <= EXPIRACAO_LOCK_MS));
    }, 2_000);
    return () => clearInterval(limpeza);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.chave, o.meuKey]);

  // Heartbeat: re-anuncia meu lock enquanto houver path ativo.
  useEffect(() => {
    const hb = setInterval(() => {
      const path = meuPathRef.current;
      const ch = canal();
      if (path && ch) void ch.send({ type: "broadcast", event: "campoLock", payload: { key: o.meuKey, path, ts: Date.now() } });
    }, HEARTBEAT_MS);
    return () => clearInterval(hb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.chave, o.meuKey]);

  const anunciarLock = useCallback((path: string | null) => {
    meuPathRef.current = path;
    const ch = canal();
    if (ch) void ch.send({ type: "broadcast", event: "campoLock", payload: { key: o.meuKey, path, ts: Date.now() } });
  }, [canal, o.meuKey]);

  const emitirValor = useCallback((path: string, valor: string) => {
    let t = throttlesRef.current.get(path);
    if (!t) {
      t = criarThrottle<string>((v) => {
        const ch = canal();
        if (ch) void ch.send({ type: "broadcast", event: "valorAoVivo", payload: { key: o.meuKey, path, valor: v } });
      }, THROTTLE_MS);
      throttlesRef.current.set(path, t);
    }
    t.enviar(valor);
  }, [canal, o.meuKey]);

  if (!o.chave) return { locks: [] as LockInfo[], valorAoVivoPorPath: {} as Record<string, string>, anunciarLock, emitirValor };
  return { locks, valorAoVivoPorPath, anunciarLock, emitirValor };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/use-coedicao-ao-vivo.test.ts`
Expected: PASS (todos). Se `@testing-library/react` não estiver no projeto, usar o mesmo utilitário de render dos outros testes de hook (verificar com `grep -rl renderHook tests/`); se nenhum existir, testar as partes puras via as funções exportadas e deixar o comportamento do canal para o QA manual do Task 4 (registrar no relatório).

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"
git add src/hooks/useCoedicaoAoVivo.ts tests/unit/use-coedicao-ao-vivo.test.ts
git commit --only src/hooks/useCoedicaoAoVivo.ts tests/unit/use-coedicao-ao-vivo.test.ts -m "feat(colab): useCoedicaoAoVivo — lock+espelho no canal existente, heartbeat 4s, expiração 10s"
```

---

### Task 4: Integração no Sheet do Planejamento + escudo + teste-guarda do Salvar

**Files:**
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (fiar o hook; emitir valor no `onInputCapture`; aplicar no `useEffect`; escudo CSS; `anunciarLock` no foco/blur)
- Modify: `src/index.css` ou o CSS global do projeto (regra do escudo `[data-coedicao-travado]`) — confirmar o arquivo de estilos global com `grep -rl "@tailwind" src/*.css`
- Test: `tests/unit/planejamento-coedicao-salvar.test.ts` (teste-guarda: o payload do Salvar nunca contém o valor ao vivo)

**Interfaces:**
- Consumes: `useCoedicaoAoVivo` (Task 3); `aplicarCoedicao` (Task 2); `presenceKey` do `useColabRegistro` — **expor o `presenceKey`** do `useColabRegistro` no retorno (hoje ele é interno). Ruling: adicionar `presenceKey` ao retorno do `useColabRegistro` (`return { presentes, presenceKey }`) é mudança retrocompatível (nenhum consumidor quebra). Assim o Sheet passa o MESMO `meuKey` aos dois hooks.
- Produces: comportamento ao vivo no Sheet (nada que outras tarefas consumam).

- [ ] **Step 1: Expor `presenceKey` no `useColabRegistro`**

Em `src/hooks/useColabRegistro.ts`, trocar `return { presentes };` por `return { presentes, presenceKey };` e no tipo de retorno. (É o `userId::abaId` já calculado no hook.)

- [ ] **Step 2: Write the failing test** (`tests/unit/planejamento-coedicao-salvar.test.ts`)

O risco capital é o valor ao vivo do outro vazar para o Salvar. Como o `draft`/payload do Salvar é construído a partir do `draft`/`draftLiveRef` (nunca de `valorAoVivoPorPath`), o teste-guarda fixa isso por ASSERÇÃO DE FONTE (grep do arquivo) — barato e à prova de regressão:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync("src/components/planejamento/PlanejamentoDetail.tsx", "utf8");

describe("Onda 3 — o overlay nunca contamina o Salvar", () => {
  it("o payload do Salvar não lê valorAoVivoPorPath", () => {
    // Nenhuma construção de payload/draft pode referenciar o mapa do overlay.
    // (o overlay é aplicado no DOM via aplicarCoedicao, nunca lido para montar o que se grava.)
    const linhasDeSave = SRC.split("\n").filter((l) => /mutationFn|payload|salvar|setDraftTracked\(/.test(l));
    expect(linhasDeSave.some((l) => l.includes("valorAoVivoPorPath"))).toBe(false);
  });
  it("valorAoVivoPorPath só é usado dentro de aplicarCoedicao", () => {
    const usos = [...SRC.matchAll(/valorAoVivoPorPath/g)];
    // Deve aparecer pouquíssimas vezes e sempre perto de aplicarCoedicao.
    expect(SRC.includes("aplicarCoedicao(")).toBe(true);
    for (const m of usos) {
      const trecho = SRC.slice(Math.max(0, m.index! - 120), m.index! + 40);
      expect(/aplicarCoedicao|useCoedicaoAoVivo|const \{/.test(trecho)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/planejamento-coedicao-salvar.test.ts`
Expected: FAIL — `aplicarCoedicao(` ainda não está no arquivo.

- [ ] **Step 4: Fiar o hook e aplicar no `PlanejamentoDetail.tsx`**

4a. Importar no topo: `import { useCoedicaoAoVivo } from "@/hooks/useCoedicaoAoVivo";` e `import { aplicarCoedicao } from "@/lib/colab/coedicao";`.

4b. Pegar o `presenceKey` do `useColabRegistro` (já existe a chamada `const { presentes } = useColabRegistro({...})` ~linha 1161) → `const { presentes, presenceKey } = useColabRegistro({...})`.

4c. Chamar o hook novo com a MESMA `chave` do canal:
```tsx
const { locks, valorAoVivoPorPath, anunciarLock, emitirValor } = useCoedicaoAoVivo({
  chave: modeloId ? `colab:modelo:${modeloId}` : null,
  meuKey: presenceKey,
});
```

4d. No `onFocusCapture` do container (~linha 1793), além de `setCampoFocado`, anunciar o lock; no `onBlurCapture`, soltar:
```tsx
onFocusCapture={(e) => {
  const scope = colabScopeRef.current;
  const path = scope ? pathDoElemento(e.target as HTMLElement, scope) : null;
  setCampoFocado(path);
  anunciarLock(path);
}}
onBlurCapture={() => { setCampoFocado(null); anunciarLock(null); }}
```

4e. Acrescentar `onInputCapture` no MESMO container, emitindo o valor do campo que é MEU (throttle já embutido no hook):
```tsx
onInputCapture={(e) => {
  const scope = colabScopeRef.current;
  const alvo = e.target as HTMLElement;
  const path = scope ? pathDoElemento(alvo, scope) : null;
  if (path && "value" in alvo) emitirValor(path, (alvo as HTMLInputElement).value);
}}
```

4f. Aplicar a instrumentação no DOM a cada mudança de locks/valores:
```tsx
useEffect(() => {
  const scope = colabScopeRef.current;
  if (scope) aplicarCoedicao(scope, locks, valorAoVivoPorPath, presenceKey, Date.now());
}, [locks, valorAoVivoPorPath, presenceKey]);
```

4g. Escudo de clique para campos compostos (Select/DateField/MoneyInput): no CSS global, impedir interação do campo travado sem depender do `disabled` interno de cada componente:
```css
[data-coedicao-travado] { pointer-events: none; opacity: 0.7; }
```
(O `pointer-events:none` barra o `pointerdown` que abre o popover dos compostos — mesma técnica do `salvandoNovo && "pointer-events-none"` já usado no container. O anel/etiqueta do `ColabPresenceOverlay` fica por cima, com `pointer-events-none` próprio, então não é afetado.)

- [ ] **Step 5: Run the guard test + full type-check + build**

Run: `npx vitest run tests/unit/planejamento-coedicao-salvar.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"`
Run: `npm run build`
Expected: build OK.

- [ ] **Step 6: Commit**

```bash
git add src/components/planejamento/PlanejamentoDetail.tsx src/hooks/useColabRegistro.ts tests/unit/planejamento-coedicao-salvar.test.ts
# + o arquivo de CSS global tocado em 4g
git commit --only src/components/planejamento/PlanejamentoDetail.tsx src/hooks/useColabRegistro.ts tests/unit/planejamento-coedicao-salvar.test.ts -m "feat(colab): co-edição ao vivo no Sheet do Planejamento (lock+espelho+escudo); expõe presenceKey"
```

- [ ] **Step 7: QA manual (cópia local :5190), 2 abas do mesmo card — registrar no relatório**

1. A foca o campo Nome e digita → B vê as letras ao vivo + campo travado + "A está editando". ✅
2. B tenta clicar/editar Nome → bloqueado (escudo/disabled). ✅
3. A sai do campo → B assume; A salva → o valor vira oficial em B sem F5. ✅
4. Fecha a aba de A no meio da digitação → o campo libera em B em ~10s. ✅
5. **Gate MICRO:** DevTools → WS → contar canais Realtime abertos no card = continua ~4 (nenhum novo). ✅
6. DevTools offline → a tela volta a funcionar como hoje (campos editáveis, sem travar). ✅
7. Campo composto (uma data via DateField, um preço via MoneyInput) travado por A → B não consegue abrir o popover/editar. ✅

---

## Notas de execução (subagentes)

- **Ordem obrigatória:** Task 1 → 2 → 3 → 4 (cada um consome o anterior). Nunca em paralelo (Task 2 e 4 tocam arquivos que o anterior cria/define).
- **Modelo:** Task 1-3 são mecânicas com teste completo no plano → implementador Sonnet. Task 4 toca o arquivo mais pesado do projeto (PlanejamentoDetail) e integra tudo → Sonnet, revisão Opus. **Haiku está proibido** como implementador (feedback do dono 18/nov).
- **Revisão final (whole-branch):** Opus, focada em (a) o overlay nunca entra no Salvar; (b) nenhum caminho deixa campo travado pra sempre; (c) nenhum canal novo abre.
- **Subagente:** `DATABASE_URL` local não se aplica (front puro, zero banco) — mas o brief deve dizer explicitamente "ZERO migration, não tocar supabase/".
- **Commit paralelo:** sempre `git commit --only <arquivos>` (index compartilhado) — nunca `git add .`.
