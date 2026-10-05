import { useTenantModules, type ModuleKey } from "@/hooks/useTenantModules";
import { motivoModulos } from "@/lib/modulos-texto";

export { motivoModulos };

/**
 * [modularidade F1, parte 3] Botão/tela que atravessa módulo avisa ANTES de clicar. `ok` = a loja tem TODOS os módulos pedidos;
 * `faltam` = os que não tem (na ordem pedida); `motivo` = texto PT pronto para o InfoHover/title do botão desabilitado.
 * Enquanto a config da loja não chegou (`!pronto`), `ok = false` e `motivo = "Carregando…"` (nunca libera por engano nem
 * mostra o aviso errado — o botão fica desabilitado por instantes).
 */
export function useRequerModulo(...chaves: ModuleKey[]): { ok: boolean; faltam: ModuleKey[]; motivo: string } {
  const { isModuleEnabled, pronto, erro } = useTenantModules();
  // [backend F1] 1ª carga da loja falhou: não libera nem mostra "módulo desligado" (a loja pode TER o módulo).
  if (erro) return { ok: false, faltam: [], motivo: "Não foi possível carregar a loja." };
  if (!pronto) return { ok: false, faltam: [], motivo: "Carregando…" };
  const faltam = chaves.filter((k) => !isModuleEnabled(k));
  return { ok: faltam.length === 0, faltam, motivo: motivoModulos(faltam) };
}
