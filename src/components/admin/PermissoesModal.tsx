import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { PAGES_CATALOG, ALL_PAGE_KEYS } from "@/lib/permissions-catalog";
import { savePermissions } from "@/lib/tenant-admin.functions";
import { savePermissionsAsSuperAdmin } from "@/lib/admin.functions";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { useUnsavedGuard, UnsavedChangesGuard } from "@/components/shared/UnsavedChangesGuard";

type PermState = Record<string, { pode_ver: boolean; pode_editar: boolean }>;

export type PermissoesModalProps = {
  user: { id: string; nome: string; tenant_id?: string | null; role?: string };
  mode: "tenant" | "super";
  onClose: () => void;
};

export function PermissoesModal({ user, mode, onClose }: PermissoesModalProps) {
  const qc = useQueryClient();
  // Admins (admin/tenant_admin/super_admin) furam user_can_view → têm acesso total.
  // Não precisam de linhas em user_permissions; o modal só reflete isso visualmente.
  const isAdminRole = ["admin", "tenant_admin", "super_admin"].includes(user.role ?? "");
  const callTenant = useServerFn(savePermissions);
  const callSuper = useServerFn(savePermissionsAsSuperAdmin);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["perms", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_permissions")
        .select("pagina,pode_ver,pode_editar")
        .eq("user_id", user.id);
      if (error) throw error;
      return data as { pagina: string; pode_ver: boolean; pode_editar: boolean }[];
    },
  });

  const initial = useMemo<PermState>(() => {
    const base: PermState = {};
    for (const key of ALL_PAGE_KEYS) base[key] = { pode_ver: isAdminRole, pode_editar: isAdminRole };
    if (!isAdminRole) {
      for (const p of existing ?? []) {
        base[p.pagina] = { pode_ver: !!p.pode_ver, pode_editar: !!p.pode_editar };
      }
    }
    return base;
  }, [existing, isAdminRole]);

  const [state, setState] = useState<PermState>(initial);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { setState(initial); }, [initial]);

  const { dirty: changed, markClean, reset: resetBaseline } = useDirtySnapshot(state);
  useEffect(() => { resetBaseline(initial); }, [initial]); // re-baseline quando dados chegam
  const { requestClose, confirm } = useUnsavedGuard({ dirty: changed, onClose: onClose });

  const toggle = (key: string, field: "pode_ver" | "pode_editar", v: boolean) => {
    setState((s) => {
      const next = { ...s, [key]: { ...s[key], [field]: v } };
      if (field === "pode_editar" && v) next[key].pode_ver = true;
      if (field === "pode_ver" && !v) next[key].pode_editar = false;
      return next;
    });
  };

  const toggleAllInModule = (moduleKey: string, field: "pode_ver" | "pode_editar", v: boolean) => {
    setState((s) => {
      const mod = PAGES_CATALOG.find((m) => m.module === moduleKey);
      if (!mod) return s;
      const next = { ...s };
      for (const p of mod.pages) {
        next[p.key] = { ...next[p.key], [field]: v };
        if (field === "pode_editar" && v) next[p.key].pode_ver = true;
        if (field === "pode_ver" && !v) next[p.key].pode_editar = false;
      }
      return next;
    });
  };

  const onSave = async () => {
    setSubmitting(true);
    try {
      const perms = ALL_PAGE_KEYS
        .map((k) => ({ pagina: k, ...state[k] }))
        .filter((p) => p.pode_ver || p.pode_editar);
      if (mode === "super") {
        if (!user.tenant_id) throw new Error("Usuário sem loja");
        await callSuper({ data: { user_id: user.id, tenant_id: user.tenant_id, perms } });
      } else {
        await callTenant({ data: { user_id: user.id, perms } });
      }
      toast.success("Permissões salvas");
      markClean();
      qc.invalidateQueries({ queryKey: ["perms", user.id] });
      onClose();
    } catch (err) {
      toast.error(mensagemErro(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent
      className="max-w-3xl max-h-[85vh] overflow-y-auto max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:!grid-rows-[auto_minmax(0,1fr)_auto] max-sm:!overflow-hidden"
      onInteractOutside={(e) => { if (changed) { e.preventDefault(); requestClose(); } }}
      onEscapeKeyDown={(e) => { if (changed) { e.preventDefault(); requestClose(); } }}
    >
      <DialogHeader className="max-sm:shrink-0">
        <DialogTitle>Permissões — {user.nome}</DialogTitle>
      </DialogHeader>
      <div className="max-sm:min-h-0 max-sm:min-w-0 max-sm:overflow-y-auto">
      <p className="text-xs text-muted-foreground -mt-2">
        <strong>Leitor:</strong> pode acessar e visualizar a página, sem alterar dados.{" "}
        <strong>Editor:</strong> pode visualizar e também criar, editar ou excluir
        registros (inclui acesso de leitor).
      </p>
      {isAdminRole && (
        <p className="text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 mt-2">
          Este usuário é <strong>administrador</strong> — tem acesso total a todas as páginas.
          As permissões por página não se aplicam.
        </p>
      )}
      <div className="space-y-6 py-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          PAGES_CATALOG.map((m) => {
            const allVer = m.pages.every((p) => state[p.key]?.pode_ver);
            const allEdit = m.pages.every((p) => state[p.key]?.pode_editar);
            return (
              <div key={m.module}>
                <h3 className="text-sm font-semibold mb-2">{m.label}</h3>
                <div className="border rounded-md divide-y">
                  <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 text-xs text-muted-foreground bg-muted/40 items-center">
                    <span>Página</span>
                    <div className="flex justify-center items-center gap-1">
                      <Checkbox
                        disabled={isAdminRole}
                        checked={allVer}
                        onCheckedChange={(v) => toggleAllInModule(m.module, "pode_ver", !!v)}
                        aria-label={`Marcar todos como leitor em ${m.label}`}
                      />
                      <span>Leitor</span>
                    </div>
                    <div className="flex justify-center items-center gap-1">
                      <Checkbox
                        disabled={isAdminRole}
                        checked={allEdit}
                        onCheckedChange={(v) => toggleAllInModule(m.module, "pode_editar", !!v)}
                        aria-label={`Marcar todos como editor em ${m.label}`}
                      />
                      <span>Editor</span>
                    </div>
                  </div>
                  {m.pages.map((p) => (
                    <div key={p.key} className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 items-center">
                      <Label htmlFor={`${p.key}-ver`} className="text-sm font-normal cursor-pointer">{p.label}</Label>
                      <div className="flex justify-center">
                        <Checkbox
                          id={`${p.key}-ver`}
                          disabled={isAdminRole}
                          checked={state[p.key]?.pode_ver ?? false}
                          onCheckedChange={(v) => toggle(p.key, "pode_ver", !!v)}
                        />
                      </div>
                      <div className="flex justify-center">
                        <Checkbox
                          disabled={isAdminRole}
                          checked={state[p.key]?.pode_editar ?? false}
                          onCheckedChange={(v) => toggle(p.key, "pode_editar", !!v)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
      </div>
      <UnsavedChangesGuard dirty={changed} confirm={confirm} message="Há permissões não salvas para este usuário." />
      <DialogFooter className="max-sm:shrink-0 max-sm:flex-row max-sm:items-center max-sm:border-t max-sm:bg-background max-sm:-mx-4 max-sm:-mb-4 max-sm:px-4 max-sm:py-3">
        <Button variant="outline" className="max-sm:hidden" onClick={requestClose}>Cancelar</Button>
        <Button variant="outline" size="icon" aria-label="Voltar" className="shrink-0 sm:hidden" onClick={requestClose}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button className="max-sm:ml-auto" onClick={onSave} disabled={submitting || isAdminRole}>{submitting ? "Salvando…" : "Salvar"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
