import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FornecedorSelect, type EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import { ehGrupoAcessorio, previewRefProduto } from "@/lib/produto-acabado";
import { erroValidacao, type Opt, type CatOpt, type SubOpt } from "./shared";

/** "+ Novo produto" — Dialog central (§G: criar = Dialog). Sem dirty-guard: a ação "Criar"
 *  COMMITA na hora (RPC grava e a REF nasce no INSERT) — não há rascunho pra descartar,
 *  mesmo caso "Fora de escopo" do guard citado em ui-padroes.md §A ("botão principal
 *  Aplicar/Confirmar e commita na hora"). */
export function NovoProdutoDialog({
  open,
  onClose,
  colecaoId,
  subcolecaoNome,
  grupos,
  categorias,
  subcats1,
  subcats2,
  empresas,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  colecaoId: string | null;
  subcolecaoNome: string | null;
  grupos: Opt[];
  categorias: CatOpt[];
  subcats1: SubOpt[];
  subcats2: SubOpt[];
  empresas: EmpresaFornecedor[];
  onCreated: (id: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [grupoId, setGrupoId] = useState<string | null>(null);
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [sub1Id, setSub1Id] = useState<string | null>(null);
  const [sub2Id, setSub2Id] = useState<string | null>(null);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [representanteId, setRepresentanteId] = useState<string | null>(null);

  const reset = () => {
    setNome(""); setGrupoId(null); setCategoriaId(null); setSub1Id(null); setSub2Id(null);
    setEmpresaId(null); setRepresentanteId(null);
  };

  const grupoNome = grupos.find((g) => g.id === grupoId)?.nome ?? "";
  const categoriaNome = categorias.find((c) => c.id === categoriaId)?.nome ?? "";
  const sub1Nome = subcats1.find((s) => s.id === sub1Id)?.nome ?? "";
  const acessorio = ehGrupoAcessorio(grupoNome);
  const refPreview = grupoId && categoriaId ? previewRefProduto(grupoNome, categoriaNome, sub1Nome, acessorio) : null;

  const criarMut = useMutation({
    mutationFn: async () => {
      if (!nome.trim()) throw erroValidacao("Informe o nome do produto.");
      if (!grupoId || !categoriaId) throw erroValidacao("Informe grupo e categoria do produto.");
      const { data, error } = await supabase.rpc("salvar_produto_acabado" as any, {
        _id: null,
        _dados: {
          nome,
          grupo_id: grupoId,
          categoria_id: categoriaId,
          subcategoria1_id: acessorio ? null : sub1Id,
          subcategoria2_id: acessorio ? null : sub2Id,
          empresa_id: empresaId,
          representante_id: representanteId,
          colecao_id: colecaoId,
          subcolecao: subcolecaoNome,
        },
        _variantes: [],
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success("Produto criado.");
      reset();
      onCreated(id);
      onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao criar produto.")),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Novo produto</DialogTitle></DialogHeader>
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
            {!acessorio && (
              <>
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
              </>
            )}
          </div>
          <div className="grid gap-1">
            <Label>Fornecedor</Label>
            <FornecedorSelect empresas={empresas} empresaId={empresaId} representanteId={representanteId}
              onChange={(e, r) => { setEmpresaId(e); setRepresentanteId(r); }} />
          </div>
          {refPreview && (
            <p className="text-xs text-muted-foreground">
              Prévia da REF: <span className="font-medium tabular-nums text-foreground">{refPreview}NNNNNNN</span> (número sequencial ao criar)
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
          <Button onClick={() => criarMut.mutate()} disabled={criarMut.isPending}>
            {criarMut.isPending ? "Criando…" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
