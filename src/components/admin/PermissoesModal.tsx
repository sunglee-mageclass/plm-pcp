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
import { DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { useUnsavedGuard, UnsavedChangesGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { Breadcrumb } from "@/components/shared/Breadcrumb";

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
    <Sheet open onOpenChange={(o) => { if (!o) requestClose(); }}>
    <SheetContent
      side="right"
      className="flex w-full flex-col p-0 sm:w-[70vw] sm:max-w-[70vw] [&>button]:hidden"
      onInteractOutside={(e) => { if (changed) { e.preventDefault(); requestClose(); } }}
      onEscapeKeyDown={(e) => { if (changed) { e.preventDefault(); requestClose(); } }}
    >
      <div className="shrink-0 border-b p-3 space-y-1">
        <Breadcrumb items={[{ label: "Admin" }, { label: "Gerenciar Usuários" }, { label: "Permissões" }]} />
        <div className="flex items-center gap-2">
          <DialogTitle className="text-xl font-bold">Permissões — {user.nome}</DialogTitle>
          <UnsavedIndicator show={changed} className="ml-auto shrink-0" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
      <p className="text-xs text-muted-foreground">
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
      <UnsavedChangesGuard confirm={confirm} message="Há permissões não salvas para este usuário." />
      <div className="shrink-0 border-t bg-background p-3 flex items-center gap-2 sm:justify-end">
        <Button variant="outline" className="max-sm:hidden" onClick={requestClose}>Cancelar</Button>
        <Button variant="outline" size="icon" aria-label="Voltar" className="shrink-0 sm:hidden" onClick={requestClose}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button className="max-sm:ml-auto" onClick={onSave} disabled={submitting || isAdminRole}>{submitting ? "Salvando…" : "Salvar"}</Button>
      </div>
    </SheetContent>
    </Sheet>
  );
}
