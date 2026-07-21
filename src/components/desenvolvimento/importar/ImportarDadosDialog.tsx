// src/components/desenvolvimento/importar/ImportarDadosDialog.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { useModeloParaCopia } from "./useModeloParaCopia";
import { construirCopia, gradeAplicavel, type Selecao, type ItemTecido, type ResultadoCopia, type ModeloParaCopia } from "./importar-copia";
import { TIPOS, TIPO_LABEL, type TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";

function selVazia(): Selecao {
  const item = (): ItemTecido => ({ artigo: false, consumo: false, variantes: false });
  return { obsTecnica: false, tecidos: { tecido: item(), forro: item(), entretela: item() }, aviamentos: false, etiquetas: false, grade: false, custosAdicionais: false, obsBloco: false };
}

export function ImportarDadosDialog({ open, onOpenChange, modeloDestinoId, destinoBlocks, onCopiar }: {
  open: boolean; onOpenChange: (o: boolean) => void; modeloDestinoId: string; destinoBlocks: TecidoBlock[];
  onCopiar: (r: ResultadoCopia, origem: ModeloParaCopia, sel: Selecao) => void;
}) {
  const [termo, setTermo] = useState("");
  const [origemOpen, setOrigemOpen] = useState(false);
  const [origemId, setOrigemId] = useState<string | null>(null);
  const [origemSel, setOrigemSel] = useState<{ id: string; nome: string; ref: string | null; versao: number | null } | null>(null);
  const [sel, setSel] = useState<Selecao>(selVazia());
  const { data: origem } = useModeloParaCopia(origemId);

  const { data: opcoes = [] } = useQuery({
    queryKey: ["modelos-importar", termo, modeloDestinoId],
    queryFn: async () => {
      let q = supabase.from("modelos").select("id, nome, ref, versao").neq("id", modeloDestinoId).order("nome").limit(30);
      if (termo.trim()) q = q.or(`nome.ilike.%${termo}%,ref.ilike.%${termo}%`);
      const { data } = await q;
      return (data ?? []) as { id: string; nome: string; ref: string | null; versao: number | null }[];
    },
  });

  const podeGrade = gradeAplicavel(sel);
  const setItem = (tipo: TecidoBlock["tipo"], k: keyof ItemTecido, v: boolean) =>
    setSel((s) => ({ ...s, tecidos: { ...s.tecidos, [tipo]: { ...s.tecidos[tipo], [k]: v } } }));

  const selecionarTudo = () => setSel({
    obsTecnica: true, aviamentos: true, etiquetas: true, grade: true, custosAdicionais: true, obsBloco: true,
    tecidos: { tecido: { artigo: true, consumo: true, variantes: true }, forro: { artigo: true, consumo: true, variantes: true }, entretela: { artigo: true, consumo: true, variantes: true } },
  });

  const copiar = () => {
    if (!origem) return;
    onCopiar(construirCopia(origem, destinoBlocks, { ...sel, grade: sel.grade && podeGrade }), origem, sel);
    onOpenChange(false);
    setSel(selVazia()); setOrigemId(null); setOrigemSel(null); setTermo("");
  };

  const origemLabel = (m: { nome: string; ref: string | null; versao: number | null }) =>
    `${m.nome}${m.ref ? ` · ${m.ref}` : ""}${m.versao ? ` · v${m.versao}` : ""}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Importar dados de outro modelo</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Origem</Label>
            <Popover open={origemOpen} onOpenChange={setOrigemOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" role="combobox" aria-expanded={origemOpen}
                  className="w-full justify-between font-normal">
                  <span className="truncate">{origemSel ? origemLabel(origemSel) : "Selecione um modelo…"}</span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
                <div className="p-2 border-b">
                  <Input placeholder="buscar por nome / ref…" value={termo} onChange={(e) => setTermo(e.target.value)} autoFocus />
                </div>
                <div className="max-h-56 overflow-auto py-1">
                  {opcoes.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">Nenhum modelo encontrado.</div>
                  ) : (
                    opcoes.map((m) => (
                      <button key={m.id} type="button"
                        onClick={() => { setOrigemSel(m); setOrigemId(m.id); setOrigemOpen(false); }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted ${origemId === m.id ? "bg-muted" : ""}`}>
                        <Check className={`h-4 w-4 shrink-0 ${origemId === m.id ? "opacity-100" : "opacity-0"}`} />
                        <span className="truncate">{origemLabel(m)}</span>
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <fieldset disabled={!origemId} className="space-y-2 disabled:opacity-50">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Áreas a importar</span>
              <Button type="button" size="sm" variant="outline" onClick={selecionarTudo}>Selecionar tudo</Button>
            </div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={sel.obsTecnica} onCheckedChange={(v) => setSel((s) => ({ ...s, obsTecnica: !!v }))} /> Observações técnicas (manual)</label>
            {TIPOS.map((tipo) => (
              <div key={tipo} className="text-sm">
                <div className="font-medium">{TIPO_LABEL[tipo]}</div>
                <div className="flex gap-4 pl-3">
                  {(["artigo", "consumo", "variantes"] as (keyof ItemTecido)[]).map((k) => (
                    <label key={k} className="flex items-center gap-1.5">
                      <Checkbox checked={sel.tecidos[tipo][k]} onCheckedChange={(v) => setItem(tipo, k, !!v)} /> {k[0].toUpperCase() + k.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={sel.aviamentos} onCheckedChange={(v) => setSel((s) => ({ ...s, aviamentos: !!v }))} /> Aviamentos</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={sel.etiquetas} onCheckedChange={(v) => setSel((s) => ({ ...s, etiquetas: !!v }))} /> Insumos / Etiquetas</label>
            <label className={`flex items-center gap-2 text-sm ${!podeGrade ? "opacity-50" : ""}`}>
              <Checkbox disabled={!podeGrade} checked={sel.grade && podeGrade} onCheckedChange={(v) => setSel((s) => ({ ...s, grade: !!v }))} /> Grade {!podeGrade && <span className="text-xs text-muted-foreground">(requer Variantes do Tecido)</span>}
            </label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={sel.custosAdicionais} onCheckedChange={(v) => setSel((s) => ({ ...s, custosAdicionais: !!v }))} /> Custos adicionais</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={sel.obsBloco} onCheckedChange={(v) => setSel((s) => ({ ...s, obsBloco: !!v }))} /> Observações (bloco) <span className="text-xs text-muted-foreground">(menos a Composição auto)</span></label>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!origem} onClick={copiar}>Copiar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
