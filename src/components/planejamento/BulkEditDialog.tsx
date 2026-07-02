import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Opt = { id: string; nome: string };
const NONE = "__keep__"; // "não alterar"

export function BulkEditDialog({
  ids, otbOn, colecoes, grupos, categorias, sub1, sub2, estilistas, linhas, meses, anos, statusOpts, onClose, onSaved,
}: {
  ids: string[]; otbOn: boolean;
  colecoes: (Opt & { mes_id?: string | null; ano_id?: string | null })[];
  grupos: Opt[]; categorias: (Opt & { grupo_id?: string | null })[];
  sub1: (Opt & { categoria_id?: string | null })[]; sub2: (Opt & { categoria_id?: string | null })[];
  estilistas: Opt[]; linhas: Opt[]; meses: Opt[]; anos: Opt[];
  statusOpts: Opt[];
  onClose: () => void; onSaved: () => void;
}) {
  const [colecaoId, setColecaoId] = useState(NONE);
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

  const apply = useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patch: any = {};
      if (otbOn && colecaoId !== NONE) {
        patch.colecao_id = colecaoId;
        const col = colecoes.find((c) => c.id === colecaoId);
        if (col) patch.colecao = col.nome;
      }
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

  const field = (label: string, value: string, set: (v: string) => void, opts: Opt[]) => (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={set}>
        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Não alterar</SelectItem>
          {opts.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Definir em massa · {ids.length} card(s)</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Só os campos que você mudar de "Não alterar" são aplicados.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {otbOn && field("Coleção", colecaoId, setColecaoId, colecoes)}
          {field("Grupo (filtra categoria)", grupo, (v) => { setGrupo(v); setCategoria(NONE); setS1(NONE); setS2(NONE); }, grupos)}
          {field("Categoria", categoria, (v) => { setCategoria(v); setS1(NONE); setS2(NONE); }, catOpts)}
          {field("Subcategoria 1", s1, setS1, s1Opts)}
          {field("Subcategoria 2", s2, setS2, s2Opts)}
          {field("Estilista", estilista, setEstilista, estilistas)}
          {field("Linha", linha, setLinha, linhas)}
          {field("Origem", origem, setOrigem, [{ id: "interno", nome: "Interno" }, { id: "revenda", nome: "Revenda" }])}
          {field("Semana", semana, setSemana, ["1","2","3","4","5"].map((s) => ({ id: s, nome: s })))}
          {field("Mês", mes, setMes, meses)}
          {field("Ano", ano, setAno, anos)}
          {field("Status", status, setStatus, statusOpts)}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => apply.mutate()} disabled={apply.isPending}>
            {apply.isPending ? "Aplicando…" : "Aplicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
