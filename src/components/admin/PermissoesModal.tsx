import { Fragment, useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { PAGES_CATALOG, ALL_PAGE_KEYS } from "@/lib/permissions-catalog";
import { savePermissions } from "@/lib/tenant-admin.functions";
import { savePermissionsAsSuperAdmin } from "@/lib/admin.functions";
import { salvarPapel } from "@/lib/papeis.functions";
import { ArrowLeft, RotateCcw } from "lucide-react";
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
  user: { id: string; nome: string; tenant_id?: string | null; role?: string; papel_id?: string | null };
  mode: "tenant" | "super";
  onClose: () => void;
};

const emptyPerm = { pode_ver: false, pode_editar: false };

// P-107 A (set/2026, D7-tela): a Integração só aparece/edita com a permissão dada PELO SUPER
// ADMIN no próprio usuário. A linha "Integração" no editor de USUÁRIO só aparece quando quem
// está editando é o super admin (mode="super"); no editor de PAPEL ela NUNCA aparece (papéis
// nunca carregam `integracao` — o banco também ignora essa escrita em silêncio, mas o front
// não deve nem oferecer/enviar). `catalogoSemIntegracao` filtra o módulo inteiro fora da grade.
const catalogoSemIntegracao = PAGES_CATALOG.filter((m) => m.module !== "integracao");
const paginasSemIntegracao = (keys: readonly string[]) => keys.filter((k) => k !== "integracao" && !k.startsWith("integracao:"));
// Pré-computado UMA vez (não a cada render) — `ALL_PAGE_KEYS_SEM_INTEGRACAO` é usado como
// dependência de useMemo/useEffect; uma nova array a cada render (ex.: chamar
// `paginasSemIntegracao(ALL_PAGE_KEYS)` direto no corpo do componente) muda de referência
// sempre, invalidando o memo de `initial` em todo render e disparando um loop de
// `useEffect(() => setState(initial), [initial])`.
const ALL_PAGE_KEYS_SEM_INTEGRACAO = paginasSemIntegracao(ALL_PAGE_KEYS);
const ehChaveIntegracao = (key: string) => key === "integracao" || key.startsWith("integracao:");

export function PermissoesModal({ user, mode, onClose }: PermissoesModalProps) {
  const qc = useQueryClient();
  // Admins (admin/tenant_admin/super_admin) furam user_can_view → têm acesso total a TODAS as
  // páginas, EXCETO a Integração (P-107 A) — essa é a ÚNICA página onde um admin não é bypass:
  // a permissão real vem de `existing`, como um usuário comum, e só o super admin concede.
  const isAdminRole = ["admin", "tenant_admin", "super_admin"].includes(user.role ?? "");
  const callTenant = useServerFn(savePermissions);
  const callSuper = useServerFn(savePermissionsAsSuperAdmin);
  // P-107 A: quem está EDITANDO é o super admin só quando mode="super" (rota admin/usuarios.tsx);
  // mode="tenant" é sempre o admin da loja (admin/usuarios-loja.tsx). A linha "Integração" e seu
  // módulo só entram na grade/estado/payload para o super admin.
  const viewerESuperAdmin = mode === "super";
  const catalogo = viewerESuperAdmin ? PAGES_CATALOG : catalogoSemIntegracao;
  const pageKeys = viewerESuperAdmin ? ALL_PAGE_KEYS : ALL_PAGE_KEYS_SEM_INTEGRACAO;

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

  // #4d — permissões do PAPEL do usuário (se ele tiver um), p/ o herdado-vs-exceção.
  const { data: papelRows } = useQuery({
    queryKey: ["papel-perms", user.papel_id],
    enabled: !!user.papel_id && !isAdminRole,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("papel_permissoes")
        .select("pagina,pode_ver,pode_editar")
        .eq("papel_id", user.papel_id!); // enabled: !!user.papel_id garante presença
      if (error) throw error;
      return data as { pagina: string; pode_ver: boolean; pode_editar: boolean }[];
    },
  });
  const papelBase = useMemo<PermState | null>(() => {
    if (!user.papel_id || isAdminRole) return null;
    const m: PermState = {};
    for (const r of papelRows ?? []) m[r.pagina] = { pode_ver: !!r.pode_ver, pode_editar: !!r.pode_editar };
    return m;
  }, [papelRows, user.papel_id, isAdminRole]);
  const temPapel = !!papelBase;

  const initial = useMemo<PermState>(() => {
    const base: PermState = {};
    for (const key of pageKeys) {
      // I-1 (fix round 1): admin (admin/tenant_admin) fura TODAS as páginas — MENOS a
      // Integração (P-107 A), cuja permissão real vem de `existing` como qualquer usuário
      // comum. Sem isso a linha nascia marcada/travada, afirmando um acesso que o admin não
      // tem e que o super admin não conseguia conceder pela tela.
      const defaultAdmin = isAdminRole && !ehChaveIntegracao(key);
      // #4d: parte do PAPEL (se houver), senão do default do perfil. As exceções do usuário
      // (user_permissions) sobrepõem — inclusive exceção NEGATIVA (linha com ver=false que o
      // papel concedia). Uma página SEM linha de exceção herda o papel.
      base[key] = temPapel
        ? { ...(papelBase![key] ?? emptyPerm) }
        : { pode_ver: defaultAdmin, pode_editar: defaultAdmin };
    }
    for (const p of existing ?? []) {
      const integracaoDoAlvo = ehChaveIntegracao(p.pagina);
      // Admin comum: só a Integração lê de `existing` (as outras páginas ficam no bypass
      // `isAdminRole` acima — não tem exceção de admin fora da Integração hoje, mas a leitura
      // segue igual à de um usuário comum se algum dia existir). Sem viewerESuperAdmin, a
      // linha de Integração nunca aparece de qualquer forma (pageKeys já a exclui).
      if (isAdminRole && !integracaoDoAlvo) continue;
      if (!viewerESuperAdmin && integracaoDoAlvo) continue;
      base[p.pagina] = { pode_ver: !!p.pode_ver, pode_editar: !!p.pode_editar };
    }
    return base;
  }, [existing, isAdminRole, temPapel, papelBase, pageKeys, viewerESuperAdmin]);

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
      const mod = catalogo.find((m) => m.module === moduleKey);
      if (!mod) return s;
      const next = { ...s };
      for (const p of mod.pages) {
        // Permissão-só (soEdicao): só o master "Editor" a afeta; o master "Leitor" a IGNORA
        // (senão desmarcar Leitor revogaria a aprovação em silêncio — a coluna Leitor dela é "—").
        if (p.soEdicao) {
          if (field === "pode_editar") next[p.key] = { ...next[p.key], pode_editar: v };
          continue;
        }
        next[p.key] = { ...next[p.key], [field]: v };
        if (field === "pode_editar" && v) next[p.key].pode_ver = true;
        if (field === "pode_ver" && !v) next[p.key].pode_editar = false;
      }
      return next;
    });
  };

  // #4d — "Voltar ao papel": zera as exceções (o estado volta a ser o do papel).
  const voltarAoPapel = () => {
    if (!papelBase) return;
    const next: PermState = {};
    for (const key of pageKeys) next[key] = { ...(papelBase[key] ?? emptyPerm) };
    setState(next);
  };

  // #4d — uma célula é "herdada do papel" quando IGUALA o papel (não vira exceção no save).
  const herdadaDoPapel = (key: string, field: "pode_ver" | "pode_editar") => {
    if (!papelBase) return false;
    return (state[key]?.[field] ?? false) === (papelBase[key]?.[field] ?? false);
  };

  const onSave = async () => {
    setSubmitting(true);
    try {
      // P-107 A: `pageKeys` já exclui `integracao*` quando o viewer não é super admin — o
      // payload nunca leva a permissão de Integração nesse caso (o banco a ignoraria mesmo
      // assim, mas o front não deve nem tentar enviar).
      let perms = pageKeys
        .map((k) => ({ pagina: k, ...state[k] }))
        .filter((p) => p.pode_ver || p.pode_editar);
      // Fix round 2 (C-1 + H-1): a tentativa da rodada 1 (merge de `perms` com `existing` por
      // página) estava ERRADA — `perms` já vinha com TODAS as ~66 páginas fora da Integração em
      // `{true,true}` (o default visual `isAdminRole` do `initial`), então o merge nunca as
      // filtrava: conceder a Integração gravava 66 linhas true/true por cima do que já existia
      // (H-1), e desmarcar a Integração não revogava nada porque a linha "sobrevivia" no mapa
      // vinda do próprio `perms` (C-1). Para um alvo admin, o payload correto é a UNIÃO de DOIS
      // conjuntos DISJUNTOS por construção (nunca colidem em `pagina`):
      //   - a decisão da Integração, exclusivamente do `state` desta tela (marcada = concede,
      //     desmarcada = ausente do payload = `set_user_permissions` REVOGA, porque o DELETE
      //     total roda antes do INSERT);
      //   - as linhas de `existing` que NÃO são da Integração, reenviadas verbatim (o valor já
      //     gravado no banco) — nunca o default visual `true/true` do bypass de admin, que é só
      //     exibição (as caixas dessas páginas ficam desabilitadas, nunca passam por `toggle`).
      // Nunca há duplicata de `pagina`: os dois lados são particionados por `ehChaveIntegracao`.
      if (isAdminRole) {
        const decisaoIntegracao = pageKeys
          .filter(ehChaveIntegracao)
          .map((k) => ({ pagina: k, ...(state[k] ?? emptyPerm) }))
          .filter((p) => p.pode_ver || p.pode_editar);
        const preservadas = (existing ?? [])
          .filter((p) => !ehChaveIntegracao(p.pagina))
          .map((p) => ({ pagina: p.pagina, pode_ver: !!p.pode_ver, pode_editar: !!p.pode_editar }));
        perms = [...preservadas, ...decisaoIntegracao];
      }
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
      size="editor"
      className="flex flex-col p-0 [&>button]:hidden"
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
          {viewerESuperAdmin
            ? "Admin da loja tem acesso a todas as páginas, EXCETO a Integração — só o super admin libera, marcando abaixo."
            : "Admin da loja tem acesso a todas as páginas, exceto a Integração (só o super admin concede)."}
        </p>
      )}
      {temPapel && !isAdminRole && (
        <div className="flex items-center gap-2 text-xs rounded-md border border-sky-300 bg-sky-50 text-sky-900 px-3 py-2 mt-2">
          <span className="flex-1">
            Este usuário tem um <strong>papel</strong>. As permissões <span className="opacity-60">esmaecidas</span> vêm
            do papel; marcações destacadas são <strong>exceções</strong> só deste usuário.
          </span>
          <Button type="button" variant="outline" size="sm" className="gap-1 shrink-0" onClick={voltarAoPapel}>
            <RotateCcw className="h-3.5 w-3.5" /> Voltar ao papel
          </Button>
        </div>
      )}
      <div className="space-y-6 py-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          catalogo.map((m) => {
            const allVer = m.pages.filter((p) => !p.soEdicao).every((p) => state[p.key]?.pode_ver);
            const allEdit = m.pages.every((p) => state[p.key]?.pode_editar);
            return (
              <div key={m.module}>
                <h3 className="text-sm font-semibold mb-2">{m.label}</h3>
                <div className="border rounded-md divide-y">
                  <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 text-xs text-muted-foreground bg-muted/40 items-center">
                    <span>Página</span>
                    <div className="flex justify-center items-center gap-1">
                      <Checkbox
                        disabled={isAdminRole && m.module !== "integracao"}
                        checked={allVer}
                        onCheckedChange={(v) => toggleAllInModule(m.module, "pode_ver", !!v)}
                        aria-label={`Marcar todos como leitor em ${m.label}`}
                      />
                      <span>Leitor</span>
                    </div>
                    <div className="flex justify-center items-center gap-1">
                      <Checkbox
                        disabled={isAdminRole && m.module !== "integracao"}
                        checked={allEdit}
                        onCheckedChange={(v) => toggleAllInModule(m.module, "pode_editar", !!v)}
                        aria-label={`Marcar todos como editor em ${m.label}`}
                      />
                      <span>Editor</span>
                    </div>
                  </div>
                  {m.pages.map((p) => (
                    <Fragment key={p.key}>
                      <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 items-center">
                        <Label htmlFor={`${p.key}-ver`} className="text-sm font-normal cursor-pointer">{p.label}</Label>
                        <div className="flex justify-center">
                          {p.soEdicao ? (
                            <span className="text-muted-foreground/40 text-xs" title="Permissão só de ação — use a coluna Editor">—</span>
                          ) : (
                          <Checkbox
                            id={`${p.key}-ver`}
                            disabled={isAdminRole && !ehChaveIntegracao(p.key)}
                            className={temPapel && !isAdminRole && herdadaDoPapel(p.key, "pode_ver") ? "opacity-40" : undefined}
                            checked={state[p.key]?.pode_ver ?? false}
                            onCheckedChange={(v) => toggle(p.key, "pode_ver", !!v)}
                          />
                          )}
                        </div>
                        <div className="flex justify-center">
                          <Checkbox
                            disabled={isAdminRole && !ehChaveIntegracao(p.key)}
                            className={temPapel && !isAdminRole && herdadaDoPapel(p.key, "pode_editar") ? "opacity-40" : undefined}
                            checked={state[p.key]?.pode_editar ?? false}
                            onCheckedChange={(v) => toggle(p.key, "pode_editar", !!v)}
                          />
                        </div>
                      </div>
                      {/* Seções da tela (sub-permissões): indentadas sob a página. Nenhuma seção hoje
                          pertence ao módulo Integração — ehChaveIntegracao(s.key) é defensivo (mesma
                          regra da página-mãe, caso uma seção `integracao:*` apareça no futuro). */}
                      {p.sections?.map((s) => (
                        <div key={s.key} className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-1.5 items-center bg-muted/20">
                          <Label htmlFor={`${s.key}-ver`} className="text-xs font-normal cursor-pointer text-muted-foreground pl-6">↳ {s.label}</Label>
                          <div className="flex justify-center">
                            <Checkbox
                              id={`${s.key}-ver`}
                              disabled={isAdminRole && !ehChaveIntegracao(s.key)}
                              className={temPapel && !isAdminRole && herdadaDoPapel(s.key, "pode_ver") ? "opacity-40" : undefined}
                              checked={state[s.key]?.pode_ver ?? false}
                              onCheckedChange={(v) => toggle(s.key, "pode_ver", !!v)}
                            />
                          </div>
                          <div className="flex justify-center">
                            <Checkbox
                              disabled={isAdminRole && !ehChaveIntegracao(s.key)}
                              className={temPapel && !isAdminRole && herdadaDoPapel(s.key, "pode_editar") ? "opacity-40" : undefined}
                              checked={state[s.key]?.pode_editar ?? false}
                              onCheckedChange={(v) => toggle(s.key, "pode_editar", !!v)}
                            />
                          </div>
                        </div>
                      ))}
                    </Fragment>
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
        <Button variant="outline" className="max-sm:hidden" onClick={requestClose}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
        <Button variant="outline" size="icon" aria-label="Voltar" className="shrink-0 sm:hidden" onClick={requestClose}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {/* M-1 (fix round 2): `isLoading`/`existing === undefined` cobre a mesma classe do P-57
            ("salvar rápido" antes da hidratação) — sem o gate, um clique durante "Carregando…"
            manda o payload do ramo admin SEM a linha de Integração (o `state`/`existing` ainda
            não chegaram), revogando a permissão que o admin já tinha e reescrevendo as outras
            linhas. Vale pros dois modos, não só pro ramo admin. */}
        <Button className="max-sm:ml-auto" onClick={onSave} disabled={submitting || isLoading || existing === undefined || (isAdminRole && !viewerESuperAdmin)}>{submitting ? "Salvando…" : "Salvar"}</Button>
      </div>
    </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// #4d — Editor de PAPEL (reusa a mesma grade do PermissoesModal). Sem usuário/papelBase:
// edita as permissões do papel em si e salva via salvar_papel.
// ─────────────────────────────────────────────────────────────────────────────
export type PapelEditorProps = {
  papel: { id: string | null; nome: string; descricao?: string | null; tenant_id: string };
  onClose: () => void;
  onSaved?: () => void;
};

export function PapelEditor({ papel, onClose, onSaved }: PapelEditorProps) {
  const qc = useQueryClient();
  const callSalvar = useServerFn(salvarPapel);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["papel-perms", papel.id],
    enabled: !!papel.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("papel_permissoes")
        .select("pagina,pode_ver,pode_editar")
        .eq("papel_id", papel.id!); // enabled: !!papel.id garante presença
      if (error) throw error;
      return data as { pagina: string; pode_ver: boolean; pode_editar: boolean }[];
    },
  });

  const initial = useMemo<PermState>(() => {
    const base: PermState = {};
    // P-107 A: papel NUNCA carrega `integracao` — nem no estado local, nem numa linha
    // pré-existente vinda do banco (defesa: o banco já ignora essa escrita em silêncio, mas
    // uma linha legada não deveria nem aparecer marcada aqui).
    for (const key of ALL_PAGE_KEYS_SEM_INTEGRACAO) base[key] = { ...emptyPerm };
    for (const p of existing ?? []) {
      if (p.pagina === "integracao" || p.pagina.startsWith("integracao:")) continue;
      base[p.pagina] = { pode_ver: !!p.pode_ver, pode_editar: !!p.pode_editar };
    }
    return base;
  }, [existing]);

  const [nome, setNome] = useState(papel.nome);
  const [descricao, setDescricao] = useState(papel.descricao ?? "");
  const [state, setState] = useState<PermState>(initial);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { setState(initial); }, [initial]);

  const dirtyBag = useMemo(() => ({ nome, descricao, state }), [nome, descricao, state]);
  const { dirty: changed, markClean, reset: resetBaseline } = useDirtySnapshot(dirtyBag);
  useEffect(() => { resetBaseline({ nome: papel.nome, descricao: papel.descricao ?? "", state: initial }); }, [initial]);
  const { requestClose, confirm } = useUnsavedGuard({ dirty: changed, onClose });

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
      const mod = catalogoSemIntegracao.find((m) => m.module === moduleKey);
      if (!mod) return s;
      const next = { ...s };
      for (const p of mod.pages) {
        if (p.soEdicao) {
          if (field === "pode_editar") next[p.key] = { ...next[p.key], pode_editar: v };
          continue;
        }
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
      // P-107 A: papel nunca envia `integracao*` — o banco ignoraria mesmo assim, mas o
      // front não deve nem tentar.
      const perms = ALL_PAGE_KEYS_SEM_INTEGRACAO
        .map((k) => ({ pagina: k, ...state[k] }))
        .filter((p) => p.pode_ver || p.pode_editar);
      await callSalvar({
        data: {
          id: papel.id,
          tenant_id: papel.tenant_id,
          nome: nome.trim(),
          descricao: descricao.trim() || null,
          perms,
        },
      });
      toast.success("Papel salvo");
      markClean();
      qc.invalidateQueries({ queryKey: ["papeis"] });
      qc.invalidateQueries({ queryKey: ["papel-perms", papel.id] });
      onSaved?.();
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
      size="editor"
      className="flex flex-col p-0 [&>button]:hidden"
      onInteractOutside={(e) => { if (changed) { e.preventDefault(); requestClose(); } }}
      onEscapeKeyDown={(e) => { if (changed) { e.preventDefault(); requestClose(); } }}
    >
      <div className="shrink-0 border-b p-3 space-y-1">
        <Breadcrumb items={[{ label: "Admin" }, { label: "Gerenciar Usuários" }, { label: "Papéis" }, { label: papel.id ? papel.nome : "Novo papel" }]} />
        <div className="flex items-center gap-2">
          <DialogTitle className="text-xl font-bold">{papel.id ? "Editar papel" : "Novo papel"}</DialogTitle>
          <UnsavedIndicator show={changed} className="ml-auto shrink-0" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 max-w-2xl">
          <div className="space-y-1">
            <Label htmlFor="papel-nome" className="text-sm">Nome do papel</Label>
            <input id="papel-nome" className="w-full rounded-md border px-3 py-2 text-sm"
              value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Vendedor, Estoquista" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="papel-desc" className="text-sm">Descrição (opcional)</Label>
            <input id="papel-desc" className="w-full rounded-md border px-3 py-2 text-sm"
              value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Para que serve este papel" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          <strong>Leitor:</strong> acessa e visualiza.{" "}
          <strong>Editor:</strong> visualiza e altera (inclui leitura).
        </p>
        <div className="space-y-6">
          {isLoading && papel.id ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            catalogoSemIntegracao.map((m) => {
              const allVer = m.pages.filter((p) => !p.soEdicao).every((p) => state[p.key]?.pode_ver);
              const allEdit = m.pages.every((p) => state[p.key]?.pode_editar);
              return (
                <div key={m.module}>
                  <h3 className="text-sm font-semibold mb-2">{m.label}</h3>
                  <div className="border rounded-md divide-y">
                    <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 text-xs text-muted-foreground bg-muted/40 items-center">
                      <span>Página</span>
                      <div className="flex justify-center items-center gap-1">
                        <Checkbox checked={allVer} onCheckedChange={(v) => toggleAllInModule(m.module, "pode_ver", !!v)} aria-label={`Marcar todos como leitor em ${m.label}`} />
                        <span>Leitor</span>
                      </div>
                      <div className="flex justify-center items-center gap-1">
                        <Checkbox checked={allEdit} onCheckedChange={(v) => toggleAllInModule(m.module, "pode_editar", !!v)} aria-label={`Marcar todos como editor em ${m.label}`} />
                        <span>Editor</span>
                      </div>
                    </div>
                    {m.pages.map((p) => (
                      <Fragment key={p.key}>
                        <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 items-center">
                          <Label htmlFor={`papel-${p.key}-ver`} className="text-sm font-normal cursor-pointer">{p.label}</Label>
                          <div className="flex justify-center">
                            {p.soEdicao ? (
                              <span className="text-muted-foreground/40 text-xs" title="Permissão só de ação — use a coluna Editor">—</span>
                            ) : (
                              <Checkbox id={`papel-${p.key}-ver`} checked={state[p.key]?.pode_ver ?? false} onCheckedChange={(v) => toggle(p.key, "pode_ver", !!v)} />
                            )}
                          </div>
                          <div className="flex justify-center">
                            <Checkbox checked={state[p.key]?.pode_editar ?? false} onCheckedChange={(v) => toggle(p.key, "pode_editar", !!v)} />
                          </div>
                        </div>
                        {p.sections?.map((s) => (
                          <div key={s.key} className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-1.5 items-center bg-muted/20">
                            <Label htmlFor={`papel-${s.key}-ver`} className="text-xs font-normal cursor-pointer text-muted-foreground pl-6">↳ {s.label}</Label>
                            <div className="flex justify-center">
                              <Checkbox id={`papel-${s.key}-ver`} checked={state[s.key]?.pode_ver ?? false} onCheckedChange={(v) => toggle(s.key, "pode_ver", !!v)} />
                            </div>
                            <div className="flex justify-center">
                              <Checkbox checked={state[s.key]?.pode_editar ?? false} onCheckedChange={(v) => toggle(s.key, "pode_editar", !!v)} />
                            </div>
                          </div>
                        ))}
                      </Fragment>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas neste papel." />
      <div className="shrink-0 border-t bg-background p-3 flex items-center gap-2 sm:justify-end">
        <Button variant="outline" className="max-sm:hidden" onClick={requestClose}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
        <Button variant="outline" size="icon" aria-label="Voltar" className="shrink-0 sm:hidden" onClick={requestClose}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button className="max-sm:ml-auto" onClick={onSave} disabled={submitting || !nome.trim()}>{submitting ? "Salvando…" : "Salvar"}</Button>
      </div>
    </SheetContent>
    </Sheet>
  );
}
