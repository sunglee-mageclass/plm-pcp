import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Opt, CatOpt, SubOpt } from "@/components/produto-acabado/shared";

/**
 * "+ Novo produto" — Dialog central (padrão do sistema, §G: criar = Dialog). FASE 1: NÃO
 * persiste no banco (RPC ainda não existe) — `onCriar` recebe os dados e o Sheet monta um
 * `emptyDraft` local com eles (ver `ProdutoImportadoSheet`). Sem dirty-guard, mesmo
 * raciocínio do `NovoProdutoDialog` (Produto Acabado): "Criar" aqui só adiciona ao estado
 * em memória — não há nada persistido pra "descartar" ainda.
 */
export function NovoProdutoImportadoDialog({
  open,
  onClose,
  grupos,
  categorias,
  subcats1,
  subcats2,
  onCriar,
}: {
  open: boolean;
  onClose: () => void;
  grupos: Opt[];
  categorias: CatOpt[];
  subcats1: SubOpt[];
  subcats2: SubOpt[];
  onCriar: (dados: { nome: string; grupo_id: string | null; categoria_id: string | null; subcategoria1_id: string | null; subcategoria2_id: string | null }) => void;
}) {
  const [nome, setNome] = useState("");
  const [grupoId, setGrupoId] = useState<string | null>(null);
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [sub1Id, setSub1Id] = useState<string | null>(null);
  const [sub2Id, setSub2Id] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const reset = () => {
    setNome(""); setGrupoId(null); setCategoriaId(null); setSub1Id(null); setSub2Id(null); setErro(null);
  };

  const criar = () => {
    if (!nome.trim()) { setErro("Informe o nome do produto."); return; }
    if (!grupoId || !categoriaId) { setErro("Informe grupo e categoria do produto."); return; }
    onCriar({ nome: nome.trim(), grupo_id: grupoId, categoria_id: categoriaId, subcategoria1_id: sub1Id, subcategoria2_id: sub2Id });
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Novo produto importado</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-1">
            <Label>Nome *</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>Grupo *</Label>
              <Select value={grupoId ?? ""} onValueChange={(v) => { setGrupoId(v || null); setCategoriaId(null); setSub1Id(null); setSub2Id(null); }}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>{grupos.map((g) => <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Categoria *</Label>
              <Select value={categoriaId ?? ""} onValueChange={(v) => { setCategoriaId(v || null); setSub1Id(null); setSub2Id(null); }} disabled={!grupoId}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>{categorias.filter((c) => c.grupo_id === grupoId).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Subcategoria 1</Label>
              <Select value={sub1Id ?? ""} onValueChange={(v) => setSub1Id(v || null)} disabled={!categoriaId}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>{subcats1.filter((s) => s.categoria_id === categoriaId).map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Subcategoria 2</Label>
              <Select value={sub2Id ?? ""} onValueChange={(v) => setSub2Id(v || null)} disabled={!categoriaId}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>{subcats2.filter((s) => s.categoria_id === categoriaId).map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {erro && <p className="text-xs text-destructive">{erro}</p>}
          <p className="text-xs text-muted-foreground">
            Fase 1 — o produto fica só nesta tela (rascunho local); a persistência no banco chega numa próxima etapa.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
          <Button onClick={criar}>Criar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
