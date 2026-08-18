import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Opt = { id: string; nome: string };
const NONE = "__keep__"; // "não alterar"

export function BulkEditDialog({
  ids, otbOn, defaultColecaoId, colecoes, grupos, categorias, sub1, sub2, estilistas, linhas, meses, anos, statusOpts, onClose, onSaved,
}: {
  ids: string[]; otbOn: boolean;
  defaultColecaoId?: string | null;
  colecoes: (Opt & { mes_id?: string | null; ano_id?: string | null })[];
  grupos: Opt[]; categorias: (Opt & { grupo_id?: string | null })[];
  sub1: (Opt & { categoria_id?: string | null })[]; sub2: (Opt & { categoria_id?: string | null })[];
  estilistas: Opt[]; linhas: Opt[]; meses: Opt[]; anos: Opt[];
  statusOpts: Opt[];
  onClose: () => void; onSaved: () => void;
}) {
  const [colecaoId, setColecaoId] = useState(NONE);
  const [subcolecao, setSubcolecao] = useState(NONE);
  const [grupo, setGrupo] = useState(NONE); // só cascata, não persiste
  const [categoria, setCategoria] = useState(NONE);
  const [s1, setS1] = useState(NONE);
  const [s2, setS2] = useState(NONE);
  const [estilista, setEstilista] = useState(NONE);
  const [linha, setLinha] = useState(NONE);
  const [origem, setOrigem] = useState(NONE);
  const [semana, setSemana] = useState(NONE);
  const [mes, setMes] = useState(NONE);
  const [ano, setAno] = useState(NONE);
  const [status, setStatus] = useState(NONE);

  const catOpts = grupo === NONE ? categorias : categorias.filter((c) => c.grupo_id === grupo);
  const s1Opts = categoria === NONE ? [] : sub1.filter((s) => s.categoria_id === categoria);
  const s2Opts = categoria === NONE ? [] : sub2.filter((s) => s.categoria_id === categoria);

  // Subcoleção é conceito de OTB e depende da coleção: a escolhida no diálogo ou, se
  // nenhuma, a coleção comum dos cards selecionados. Cada subcoleção resolve suas semanas
  // de colecao_subcolecoes.semanas (PV) + colecao_semanas.semana (Orçamento); se der UMA só,
  // vira auto-preenchimento da Semana.
  const effColecaoId = colecaoId !== NONE ? colecaoId : (defaultColecaoId ?? null);
  const { data: subcolOpts = [] } = useQuery({
    queryKey: ["bulk-subcolecoes", effColecaoId],
    enabled: otbOn && !!effColecaoId,
    queryFn: async () => {
      const { data, error } = await supabase.from("colecao_subcolecoes")
        .select("nome, semanas, colecao_semanas(semana)").eq("colecao_id", effColecaoId!).order("ordem");
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((s) => {
        const wk = new Set<number>();
        (s.semanas ?? []).forEach((w: number) => wk.add(Number(w)));
        (s.colecao_semanas ?? []).forEach((cs: any) => cs?.semana != null && wk.add(Number(cs.semana)));
        const weeks = [...wk].filter((n) => n >= 1 && n <= 5).sort((a, b) => a - b);
        return { nome: s.nome as string, autoWeek: weeks.length === 1 ? String(weeks[0]) : null };
      });
    },
  });
  const subcolAutoWeek = useMemo(() => Object.fromEntries(subcolOpts.map((s) => [s.nome, s.autoWeek])), [subcolOpts]);

  const apply = useMutation({
    // Colab (spec 2026-08-03, Task 2 — adoção Plan. Produto): edição em MASSA fica FORA do
    // escopo do padrão colaborativo (rev-check/merge/banner). É uma ação explícita do usuário
    // sobre N cards escolhidos deliberadamente — não há "meu rascunho" por card para mesclar,
    // e travar por `rev` individual exigiria buscar o rev de cada um antes (custo desproporcional
    // p/ uma ação em lote que o próprio usuário disparou de olhos abertos). Último-a-escrever-
    // vence aqui é aceitável (classe c do brief da Task 2).
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patch: any = {};
      if (otbOn && colecaoId !== NONE) {
        patch.colecao_id = colecaoId;
        const col = colecoes.find((c) => c.id === colecaoId);
        if (col) patch.colecao = col.nome;
      }
      if (otbOn && subcolecao !== NONE) patch.subcolecao = subcolecao;
      if (categoria !== NONE) {
        patch.categoria_principal_id = categoria;
        patch.subcategoria1_id = null;
        patch.subcategoria2_id = null;
      }
      if (s1 !== NONE) patch.subcategoria1_id = s1;
      if (s2 !== NONE) patch.subcategoria2_id = s2;
      if (estilista !== NONE) patch.estilista_id = estilista;
      if (linha !== NONE) patch.linha_id = linha;
      if (origem !== NONE) patch.origem = origem;
      if (semana !== NONE) patch.semana = semana;
      if (mes !== NONE) patch.mes_id = mes;
      if (ano !== NONE) patch.ano_id = ano;
      if (status !== NONE) patch.status_planejamento = status;
      if (Object.keys(patch).length === 0) throw new Error("Nada para alterar. Preencha ao menos um campo.");
      const { error } = await supabase.from("modelos").update(patch as any).in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} card(s) atualizado(s)`);
      onSaved();
      onClose();
    },
    onError: (e: unknown) => toast.error(mensagemErro(e, "Erro ao atualizar cards")),
  });

  // Campo destacado quando SAI de "Não alterar" (laudo jul/2026): 13 dropdowns idênticos não davam
  // pista do que muda. `persiste=false` (Grupo) = só filtra, não grava.
  const field = (label: string, value: string, set: (v: string) => void, opts: Opt[], persiste = true) => {
    const changed = persiste && value !== NONE;
    return (
      <div className="grid gap-1">
        <Label className={`text-xs ${changed ? "font-semibold text-primary" : ""}`}>{label}{changed ? " ✦" : ""}</Label>
        <Select value={value} onValueChange={set}>
          <SelectTrigger className={`h-8 text-sm ${changed ? "border-primary/50 bg-primary/5 font-medium text-primary" : ""}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Não alterar</SelectItem>
            {opts.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  };
  // Campos que GRAVAM (Grupo não entra — só filtra). Rótulo em pt-BR p/ o resumo da confirmação.
  const alterados: string[] = [
    otbOn && colecaoId !== NONE ? "Coleção" : "",
    otbOn && subcolecao !== NONE ? "Subcoleção" : "",
    categoria !== NONE ? "Categoria" : "", s1 !== NONE ? "Subcategoria 1" : "", s2 !== NONE ? "Subcategoria 2" : "",
    estilista !== NONE ? "Estilista" : "", linha !== NONE ? "Linha" : "", origem !== NONE ? "Origem" : "",
    semana !== NONE ? "Lançamento" : "", mes !== NONE ? "Mês" : "", ano !== NONE ? "Ano" : "", status !== NONE ? "Status" : "",
  ].filter(Boolean);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent fixedFooter mobileFull className="max-w-2xl">
        <DialogHeader><DialogTitle>Definir em massa · {ids.length} card(s)</DialogTitle></DialogHeader>
        <DialogBody className="space-y-3">
          <p className="text-xs text-muted-foreground">Só os campos que você mudar de "Não alterar" são aplicados.{alterados.length > 0 && <> <b className="text-primary">{alterados.length} alterado{alterados.length > 1 ? "s" : ""}</b>.</>}</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {otbOn && field("Coleção", colecaoId, (v) => { setColecaoId(v); setSubcolecao(NONE); }, colecoes)}
            {otbOn && (
              <div className="grid gap-1">
                <Label className="text-xs">Subcoleção</Label>
                <Select
                  value={subcolecao}
                  onValueChange={(v) => {
                    setSubcolecao(v);
                    const aw = v !== NONE ? subcolAutoWeek[v] : null; // uma semana só → auto-preenche
                    if (aw) setSemana(aw);
                  }}
                  disabled={!effColecaoId}
                >
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{effColecaoId ? "Não alterar" : "Escolha a coleção"}</SelectItem>
                    {subcolOpts.map((o) => (
                      <SelectItem key={o.nome} value={o.nome}>{o.nome}{o.autoWeek ? ` · Lan ${o.autoWeek}` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {field("Grupo (só filtra categoria)", grupo, (v) => { setGrupo(v); setCategoria(NONE); setS1(NONE); setS2(NONE); }, grupos, false)}
            {field("Categoria", categoria, (v) => { setCategoria(v); setS1(NONE); setS2(NONE); }, catOpts)}
            {field("Subcategoria 1", s1, setS1, s1Opts)}
            {field("Subcategoria 2", s2, setS2, s2Opts)}
            {field("Estilista", estilista, setEstilista, estilistas)}
            {field("Linha", linha, setLinha, linhas)}
            {field("Origem", origem, setOrigem, [{ id: "interno", nome: "Interno" }, { id: "revenda", nome: "Revenda" }])}
            {field("Lançamento", semana, setSemana, ["1","2","3","4","5"].map((s) => ({ id: s, nome: s })))}
            {field("Mês", mes, setMes, meses)}
            {field("Ano", ano, setAno, anos)}
            {field("Status", status, setStatus, statusOpts)}
          </div>
        </DialogBody>
        <DialogFooter className="border-t bg-background -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 py-3">
          <span className="mr-auto self-center text-xs text-muted-foreground max-sm:hidden">
            {alterados.length === 0 ? "Nada a aplicar" : `Vai gravar ${alterados.join(", ")} em ${ids.length} card(s)`}
          </span>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          {/* Confirma antes de gravar em N cards — simétrico com o Excluir em massa (laudo). */}
          <Button onClick={() => setConfirmOpen(true)} disabled={apply.isPending || alterados.length === 0}>
            {apply.isPending ? "Aplicando…" : "Aplicar…"}
          </Button>
        </DialogFooter>
      </DialogContent>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar em {ids.length} card(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai gravar <b>{alterados.join(", ")}</b> em <b>{ids.length}</b> card(s). Os demais campos não mudam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); apply.mutate(); }}>Aplicar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
