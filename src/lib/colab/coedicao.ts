// Lib PURA da co-edição ao vivo (Onda 3). Sem DOM, sem rede — só a lógica de lock/desempate/throttle.
// Spec: docs/superpowers/specs/2026-11-18-coedicao-onda3-lock-overlay-design.md
import { pathDoElemento, COLAB_FIELD_SELECTOR } from "@/lib/colab/colab-field-path";

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
