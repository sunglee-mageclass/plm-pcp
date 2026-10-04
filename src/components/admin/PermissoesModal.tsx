import { Fragment, useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { PAGES_CATALOG, ALL_PAGE_KEYS, DASHBOARD_DADOS_ABAS, DASHBOARD_DADOS_INFO, DASHBOARD_LEADTIME_HINT, paginaComModuloDesligado, type ModuleDef, type PageDef } from "@/lib/permissions-catalog";
import { useModulosDaLoja } from "@/hooks/useModulosDaLoja";
import { marcarTodosNoModulo, montarPermsPayload, voltarAoPapelEstado } from "@/lib/permissoes-estado";
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
import { InfoHover } from "@/components/shared/InfoHover";

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

// F5c (P-112 A, 28/set) — Dashboard: as chaves de DADOS (`DASHBOARD_DADOS_ABAS`, em
// permissions-catalog.ts) aparecem AGRUPADAS sob uma sub-legenda, depois das 5 abas normais do
// módulo — display only, mesma ordem/keys do catálogo preservada dentro de cada grupo (o payload
// de Salvar/"marcar todos" continua lendo `m.pages` na ordem original do catálogo, nunca desta
// função). `splitDashboardPages` devolve as duas listas; para qualquer outro módulo, `dados` vem
// vazia e `abas` é `m.pages` inteira (sem efeito visual).
function splitDashboardPages(m: ModuleDef): { abas: PageDef[]; dados: PageDef[] } {
  if (m.module !== "dashboard") return { abas: m.pages, dados: [] };
  // F5c review (L-3): `Object.hasOwn` em vez de `in` — `in` também acha chaves do prototype
  // (ex.: "constructor"); inócuo com o conjunto de chaves de hoje, mas mais estrito.
  const abas = m.pages.filter((p) => !Object.hasOwn(DASHBOARD_DADOS_ABAS, p.key));
  const dados = m.pages.filter((p) => Object.hasOwn(DASHBOARD_DADOS_ABAS, p.key));
  return { abas, dados };
}

// [modularidade F2, F10] selo da linha de página cujo módulo está desligado NA LOJA do usuário/papel editado: linha esmaecida,
// checkboxes desabilitados e o valor gravado segue no estado/payload (o `set_user_permissions` grava o delta — sumir com a
// linha apagaria o acesso ao religar o módulo).
function SeloModuloDesligado() {
  return <span className="ml-1.5 text-xs text-muted-foreground">(módulo desligado)</span>;
}
const LINHA_DESLIGADA = " opacity-50";

export function PermissoesModal({ user, mode, onClose }: PermissoesModalProps) {
  const qc = useQueryClient();
  // Módulos da loja do usuário EDITADO (o super admin edita gente de outra loja): `null` enquanto carrega = nada esmaecido.
  const { modules: modulosAlvo, carregando: carregandoModulos } = useModulosDaLoja(user.tenant_id);
  const desligada = (key: string) => paginaComModuloDesligado(key, modulosAlvo);
  // Linha travada = módulo desligado OU módulos da loja ainda carregando (não deixa editar o que pode virar esmaecido já alterado).
  const travada = (key: string) => carregandoModulos || desligada(key);
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
    if (carregandoModulos) return;
    setState((s) => marcarTodosNoModulo(s, catalogo.find((m) => m.module === moduleKey), field, v, desligada));
  };

  // #4d — "Voltar ao papel": zera as exceções (o estado volta a ser o do papel).
  const voltarAoPapel = () => {
    if (!papelBase || carregandoModulos) return;
    // Página de módulo desligado na loja NÃO volta ao papel: a exceção dela fica (a tela promete "o que estava marcado é mantido").
    setState((s) => voltarAoPapelEstado(s, papelBase, pageKeys, desligada));
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
      let perms = montarPermsPayload(pageKeys, state);
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
      {modulosAlvo && ALL_PAGE_KEYS.some(desligada) && (
        <p className="text-xs rounded-md border bg-muted/40 text-muted-foreground px-3 py-2 mt-2">
          As páginas de módulos <strong>desligados nesta loja</strong> aparecem esmaecidas e não podem ser alteradas aqui.
          O que já estava marcado é mantido e volta a valer se o módulo for ligado.
        </p>
      )}
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
          <Button type="button" variant="outline" size="sm" className="gap-1 shrink-0" disabled={carregandoModulos} onClick={voltarAoPapel}>
            <RotateCcw className="h-3.5 w-3.5" /> Voltar ao papel
          </Button>
        </div>
      )}
      <div className="space-y-6 py-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          catalogo.map((m) => {
            // Master "marcar todos" só olha as páginas de módulo LIGADO; todas desligadas = master desabilitado e vazio.
            const ativas = m.pages.filter((p) => !desligada(p.key));
            const moduloTodoDesligado = m.pages.length > 0 && ativas.length === 0;
            const ativasLeitor = ativas.filter((p) => !p.soEdicao);
            // Sem página de Leitor (ex.: PCP sem Produção só tem a aprovação de M.O., soEdicao): master Leitor vazio e desabilitado.
            const semLeitor = ativasLeitor.length === 0;
            const allVer = !moduloTodoDesligado && !semLeitor && ativasLeitor.every((p) => state[p.key]?.pode_ver);
            const allEdit = !moduloTodoDesligado && ativas.every((p) => state[p.key]?.pode_editar);
            const { abas, dados } = splitDashboardPages(m);
            const renderPagina = (p: (typeof m.pages)[number]) => (
              <Fragment key={p.key}>
                <div className={"grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 items-center" + (desligada(p.key) ? LINHA_DESLIGADA : "")}>
                  <Label htmlFor={`${p.key}-ver`} className="text-sm font-normal cursor-pointer">
                    {p.label}
                    {desligada(p.key) && <SeloModuloDesligado />}
                    {/* F5c review (I-1): hint só na linha-aba Leadtime — a mesma permissão também
                        libera os números de leadtime dentro da aba Desenvolvimento. */}
                    {p.key === "dashboard_leadtime" && (
                      <span className="block text-xs text-muted-foreground">{DASHBOARD_LEADTIME_HINT}</span>
                    )}
                  </Label>
                  <div className="flex justify-center">
                    {p.soEdicao ? (
                      <span className="text-muted-foreground/40 text-xs" title="Permissão só de ação — use a coluna Editor">—</span>
                    ) : (
                    <Checkbox
                      id={`${p.key}-ver`}
                      disabled={(isAdminRole && !ehChaveIntegracao(p.key)) || travada(p.key)}
                      className={temPapel && !isAdminRole && herdadaDoPapel(p.key, "pode_ver") ? "opacity-40" : undefined}
                      checked={state[p.key]?.pode_ver ?? false}
                      onCheckedChange={(v) => toggle(p.key, "pode_ver", !!v)}
                    />
                    )}
                  </div>
                  <div className="flex justify-center">
                    <Checkbox
                      disabled={(isAdminRole && !ehChaveIntegracao(p.key)) || travada(p.key)}
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
                  <div key={s.key} className={"grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-1.5 items-center bg-muted/20" + (desligada(p.key) ? LINHA_DESLIGADA : "")}>
                    <Label htmlFor={`${s.key}-ver`} className="text-xs font-normal cursor-pointer text-muted-foreground pl-6">↳ {s.label}</Label>
                    <div className="flex justify-center">
                      <Checkbox
                        id={`${s.key}-ver`}
                        disabled={(isAdminRole && !ehChaveIntegracao(s.key)) || travada(p.key)}
                        className={temPapel && !isAdminRole && herdadaDoPapel(s.key, "pode_ver") ? "opacity-40" : undefined}
                        checked={state[s.key]?.pode_ver ?? false}
                        onCheckedChange={(v) => toggle(s.key, "pode_ver", !!v)}
                      />
                    </div>
                    <div className="flex justify-center">
                      <Checkbox
                        disabled={(isAdminRole && !ehChaveIntegracao(s.key)) || travada(p.key)}
                        className={temPapel && !isAdminRole && herdadaDoPapel(s.key, "pode_editar") ? "opacity-40" : undefined}
                        checked={state[s.key]?.pode_editar ?? false}
                        onCheckedChange={(v) => toggle(s.key, "pode_editar", !!v)}
                      />
                    </div>
                  </div>
                ))}
              </Fragment>
            );
            return (
              <div key={m.module}>
                <h3 className="text-sm font-semibold mb-2">{m.label}{moduloTodoDesligado && <SeloModuloDesligado />}</h3>
                <div className="border rounded-md divide-y">
                  <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 text-xs text-muted-foreground bg-muted/40 items-center">
                    <span>Página</span>
                    <div className="flex justify-center items-center gap-1">
                      <Checkbox
                        disabled={(isAdminRole && m.module !== "integracao") || moduloTodoDesligado || semLeitor || carregandoModulos}
                        checked={allVer}
                        onCheckedChange={(v) => toggleAllInModule(m.module, "pode_ver", !!v)}
                        aria-label={`Marcar todos como leitor em ${m.label}`}
                      />
                      <span>Leitor</span>
                    </div>
                    <div className="flex justify-center items-center gap-1">
                      <Checkbox
                        disabled={(isAdminRole && m.module !== "integracao") || moduloTodoDesligado || carregandoModulos}
                        checked={allEdit}
                        onCheckedChange={(v) => toggleAllInModule(m.module, "pode_editar", !!v)}
                        aria-label={`Marcar todos como editor em ${m.label}`}
                      />
                      <span>Editor</span>
                    </div>
                  </div>
                  {abas.map(renderPagina)}
                  {dados.length > 0 && (
                    <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-1.5 items-center bg-muted/30">
                      <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                        Dados por aba
                        <InfoHover ariaLabel="O que são as permissões de Dados por aba">{DASHBOARD_DADOS_INFO}</InfoHover>
                      </span>
                    </div>
                  )}
                  {dados.map((p) => {
                    const abasQueAlimenta = DASHBOARD_DADOS_ABAS[p.key] ?? [];
                    return (
                      <Fragment key={p.key}>
                        <div className={"grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 items-center" + (desligada(p.key) ? LINHA_DESLIGADA : "")}>
                          <Label htmlFor={`${p.key}-ver`} className="text-sm font-normal cursor-pointer">
                            <span className="pl-3">↳ {p.label}{desligada(p.key) && <SeloModuloDesligado />}</span>
                            {abasQueAlimenta.length > 0 && (
                              <span className="block pl-3 text-xs text-muted-foreground">
                                alimenta: {abasQueAlimenta.join(", ")}
                              </span>
                            )}
                          </Label>
                          <div className="flex justify-center">
                            <Checkbox
                              id={`${p.key}-ver`}
                              disabled={(isAdminRole && !ehChaveIntegracao(p.key)) || travada(p.key)}
                              className={temPapel && !isAdminRole && herdadaDoPapel(p.key, "pode_ver") ? "opacity-40" : undefined}
                              checked={state[p.key]?.pode_ver ?? false}
                              onCheckedChange={(v) => toggle(p.key, "pode_ver", !!v)}
                            />
                          </div>
                          <div className="flex justify-center">
                            <Checkbox
                              disabled={(isAdminRole && !ehChaveIntegracao(p.key)) || travada(p.key)}
                              className={temPapel && !isAdminRole && herdadaDoPapel(p.key, "pode_editar") ? "opacity-40" : undefined}
                              checked={state[p.key]?.pode_editar ?? false}
                              onCheckedChange={(v) => toggle(p.key, "pode_editar", !!v)}
                            />
                          </div>
                        </div>
                      </Fragment>
                    );
                  })}
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
        {/* Re-review round 2 (L): usuário com papel — Salvar também espera o papel carregar (`papelRows`); salvar antes
            gravaria o delta contra um papel "vazio" e perderia o que o papel concedia (mesma classe do P-57). */}
        {/* M-1 (fix round 2): `isLoading`/`existing === undefined` cobre a mesma classe do P-57
            ("salvar rápido" antes da hidratação) — sem o gate, um clique durante "Carregando…"
            manda o payload do ramo admin SEM a linha de Integração (o `state`/`existing` ainda
            não chegaram), revogando a permissão que o admin já tinha e reescrevendo as outras
            linhas. Vale pros dois modos, não só pro ramo admin. */}
        <Button className="max-sm:ml-auto" onClick={onSave} disabled={submitting || isLoading || existing === undefined || (!!user.papel_id && !isAdminRole && papelRows === undefined) || (isAdminRole && !viewerESuperAdmin)}>{submitting ? "Salvando…" : "Salvar"}</Button>
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
  // Módulos da loja DONA do papel: página de módulo desligado esmaecida (valor mantido no payload).
  const { modules: modulosAlvo, carregando: carregandoModulos } = useModulosDaLoja(papel.tenant_id);
  const desligada = (key: string) => paginaComModuloDesligado(key, modulosAlvo);
  const travada = (key: string) => carregandoModulos || desligada(key);
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
    if (carregandoModulos) return;
    setState((s) => marcarTodosNoModulo(s, catalogoSemIntegracao.find((m) => m.module === moduleKey), field, v, desligada));
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
        {modulosAlvo && ALL_PAGE_KEYS.some(desligada) && (
          <p className="text-xs rounded-md border bg-muted/40 text-muted-foreground px-3 py-2">
            As páginas de módulos <strong>desligados nesta loja</strong> aparecem esmaecidas e não podem ser alteradas aqui.
            O que já estava marcado é mantido e volta a valer se o módulo for ligado.
          </p>
        )}
        <div className="space-y-6">
          {isLoading && papel.id ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            catalogoSemIntegracao.map((m) => {
              const ativas = m.pages.filter((p) => !desligada(p.key));
              const moduloTodoDesligado = m.pages.length > 0 && ativas.length === 0;
              const ativasLeitor = ativas.filter((p) => !p.soEdicao);
            // Sem página de Leitor (ex.: PCP sem Produção só tem a aprovação de M.O., soEdicao): master Leitor vazio e desabilitado.
            const semLeitor = ativasLeitor.length === 0;
            const allVer = !moduloTodoDesligado && !semLeitor && ativasLeitor.every((p) => state[p.key]?.pode_ver);
              const allEdit = !moduloTodoDesligado && ativas.every((p) => state[p.key]?.pode_editar);
              const { abas, dados } = splitDashboardPages(m);
              const renderPagina = (p: (typeof m.pages)[number]) => (
                <Fragment key={p.key}>
                  <div className={"grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 items-center" + (desligada(p.key) ? LINHA_DESLIGADA : "")}>
                    <Label htmlFor={`papel-${p.key}-ver`} className="text-sm font-normal cursor-pointer">
                      {p.label}
                      {desligada(p.key) && <SeloModuloDesligado />}
                      {p.key === "dashboard_leadtime" && (
                        <span className="block text-xs text-muted-foreground">{DASHBOARD_LEADTIME_HINT}</span>
                      )}
                    </Label>
                    <div className="flex justify-center">
                      {p.soEdicao ? (
                        <span className="text-muted-foreground/40 text-xs" title="Permissão só de ação — use a coluna Editor">—</span>
                      ) : (
                        <Checkbox id={`papel-${p.key}-ver`} disabled={travada(p.key)} checked={state[p.key]?.pode_ver ?? false} onCheckedChange={(v) => toggle(p.key, "pode_ver", !!v)} />
                      )}
                    </div>
                    <div className="flex justify-center">
                      <Checkbox disabled={travada(p.key)} checked={state[p.key]?.pode_editar ?? false} onCheckedChange={(v) => toggle(p.key, "pode_editar", !!v)} />
                    </div>
                  </div>
                  {p.sections?.map((s) => (
                    <div key={s.key} className={"grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-1.5 items-center bg-muted/20" + (desligada(p.key) ? LINHA_DESLIGADA : "")}>
                      <Label htmlFor={`papel-${s.key}-ver`} className="text-xs font-normal cursor-pointer text-muted-foreground pl-6">↳ {s.label}</Label>
                      <div className="flex justify-center">
                        <Checkbox id={`papel-${s.key}-ver`} disabled={travada(p.key)} checked={state[s.key]?.pode_ver ?? false} onCheckedChange={(v) => toggle(s.key, "pode_ver", !!v)} />
                      </div>
                      <div className="flex justify-center">
                        <Checkbox disabled={travada(p.key)} checked={state[s.key]?.pode_editar ?? false} onCheckedChange={(v) => toggle(s.key, "pode_editar", !!v)} />
                      </div>
                    </div>
                  ))}
                </Fragment>
              );
              return (
                <div key={m.module}>
                  <h3 className="text-sm font-semibold mb-2">{m.label}{moduloTodoDesligado && <SeloModuloDesligado />}</h3>
                  <div className="border rounded-md divide-y">
                    <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 text-xs text-muted-foreground bg-muted/40 items-center">
                      <span>Página</span>
                      <div className="flex justify-center items-center gap-1">
                        <Checkbox disabled={moduloTodoDesligado || semLeitor || carregandoModulos} checked={allVer} onCheckedChange={(v) => toggleAllInModule(m.module, "pode_ver", !!v)} aria-label={`Marcar todos como leitor em ${m.label}`} />
                        <span>Leitor</span>
                      </div>
                      <div className="flex justify-center items-center gap-1">
                        <Checkbox disabled={moduloTodoDesligado || carregandoModulos} checked={allEdit} onCheckedChange={(v) => toggleAllInModule(m.module, "pode_editar", !!v)} aria-label={`Marcar todos como editor em ${m.label}`} />
                        <span>Editor</span>
                      </div>
                    </div>
                    {abas.map(renderPagina)}
                    {dados.length > 0 && (
                      <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-1.5 items-center bg-muted/30">
                        <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                          Dados por aba
                          <InfoHover ariaLabel="O que são as permissões de Dados por aba">{DASHBOARD_DADOS_INFO}</InfoHover>
                        </span>
                      </div>
                    )}
                    {dados.map((p) => {
                      const abasQueAlimenta = DASHBOARD_DADOS_ABAS[p.key] ?? [];
                      return (
                        <Fragment key={p.key}>
                          <div className={"grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 items-center" + (desligada(p.key) ? LINHA_DESLIGADA : "")}>
                            <Label htmlFor={`papel-${p.key}-ver`} className="text-sm font-normal cursor-pointer">
                              <span className="pl-3">↳ {p.label}{desligada(p.key) && <SeloModuloDesligado />}</span>
                              {abasQueAlimenta.length > 0 && (
                                <span className="block pl-3 text-xs text-muted-foreground">
                                  alimenta: {abasQueAlimenta.join(", ")}
                                </span>
                              )}
                            </Label>
                            <div className="flex justify-center">
                              <Checkbox id={`papel-${p.key}-ver`} disabled={travada(p.key)} checked={state[p.key]?.pode_ver ?? false} onCheckedChange={(v) => toggle(p.key, "pode_ver", !!v)} />
                            </div>
                            <div className="flex justify-center">
                              <Checkbox disabled={travada(p.key)} checked={state[p.key]?.pode_editar ?? false} onCheckedChange={(v) => toggle(p.key, "pode_editar", !!v)} />
                            </div>
                          </div>
                        </Fragment>
                      );
                    })}
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
