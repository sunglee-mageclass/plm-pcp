import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { FileField } from "./FileField";
import { TecidoGroup } from "./TecidoGroup";
import type { Artigo, Colab, Draft, Empresa, ItemDraft, ParcelaRecebimento, Variante } from "./shared";

export function OcTecidoForm({
  draft, setDraft, respMode, setRespMode,
  empresas, estilistas,
  artigos, variantesByArtigo, varianteMap,
  itemsBy, artigoIdFor, setArtigo, toggleVariante, setQtd, setRendimento,
  tecido2Aberto, setTecido2Aberto, removeTecido2,
  handleSingleUpload,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  respMode: "select" | "text";
  setRespMode: (m: "select" | "text") => void;
  empresas: Empresa[];
  estilistas: Colab[];
  artigos: Artigo[];
  variantesByArtigo: Record<string, Variante[]>;
  varianteMap: Record<string, Variante>;
  itemsBy: (n: 1 | 2) => ItemDraft[];
  artigoIdFor: (n: 1 | 2) => string | null;
  setArtigo: (n: 1 | 2, artigoId: string) => void;
  toggleVariante: (n: 1 | 2, varId: string, checked: boolean) => void;
  setQtd: (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number | null) => void;
  setRendimento: (n: 1 | 2, v: number | null) => void;
  tecido2Aberto: boolean;
  setTecido2Aberto: (v: boolean) => void;
  removeTecido2: () => void;
  handleSingleUpload: (file: File, key: keyof Draft) => void;
}) {
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="grid gap-1">
          <Label>Número do Pedido</Label>
          <Input value={draft.numero_pedido} onChange={(e) => setDraft((d) => ({ ...d, numero_pedido: e.target.value }))} />
        </div>
        <div className="grid gap-1">
          <Label>Fornecedor</Label>
          <Select value={draft.empresa_id ?? ""} onValueChange={(v) => setDraft((d) => ({ ...d, empresa_id: v }))}>
            <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
            <SelectContent>
              {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome_fantasia}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1">
          <Label>Responsável</Label>
          <div className="flex gap-2">
            <Select value={respMode} onValueChange={(v) => setRespMode(v as "select" | "text")}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="select">Estilista</SelectItem>
                <SelectItem value="text">Livre</SelectItem>
              </SelectContent>
            </Select>
            {respMode === "select" ? (
              <Select value={draft.responsavel_id ?? ""} onValueChange={(v) => setDraft((d) => ({ ...d, responsavel_id: v }))}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  {estilistas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input className="flex-1" value={draft.responsavel_nome} onChange={(e) => setDraft((d) => ({ ...d, responsavel_nome: e.target.value }))} />
            )}
          </div>
        </div>

        <div className="grid gap-1">
          <Label>Prazo de Pagamento *</Label>
          <Input value={draft.prazo_pagamento} onChange={(e) => {
            const v = e.target.value;
            const parts = v.split(/[\/,-\s]+/).filter((p) => p.trim() !== "" && !isNaN(Number(p)));
            const qtd = parts.length > 0 ? Math.max(1, Math.min(6, parts.length)) : 1;
            setDraft((d) => ({ ...d, prazo_pagamento: v, quantidade_prazos: qtd }));
          }} placeholder="Ex: 30/60/90" />
          <p className="text-[11px] text-muted-foreground">Gera as parcelas a pagar no Financeiro (ex.: 30/60/90 = 3 parcelas).</p>
        </div>

        <div className="grid gap-1">
          <Label>Data do Pedido</Label>
          <Input type="date" value={draft.data_pedido} onChange={(e) => setDraft((d) => ({ ...d, data_pedido: e.target.value }))} />
        </div>
        <div className="grid gap-1">
          <Label>Data Prevista de Entrega *</Label>
          <Input type="date" value={draft.data_prevista_entrega} onChange={(e) => setDraft((d) => ({ ...d, data_prevista_entrega: e.target.value }))} />
        </div>

        <div className="grid gap-1">
          <Label>Qtd. Parcelas de Recebimento</Label>
          <NumberInput
            type="number"
            min={1}
            max={24}
            value={draft.parcelas_recebimento?.length || 1}
            onChange={(e) => {
              const n = Math.max(1, Math.min(24, Number(e.target.value) || 1));
              setDraft((d) => {
                const prev = d.parcelas_recebimento ?? [];
                const next = Array.from({ length: n }, (_, i) =>
                  prev[i] ?? { data: "", recebido: false },
                );
                return { ...d, parcelas_recebimento: next };
              });
            }}
          />
          <p className="text-[11px] text-muted-foreground">Cronograma de entregas da mercadoria — não afeta o pagamento.</p>
        </div>

        <div className="grid gap-1">
          <Label>Qtd de Parcelas (Pagamento)</Label>
          <NumberInput type="number" value={draft.quantidade_prazos} readOnly disabled />
          <p className="text-[11px] text-muted-foreground">Derivada do prazo de pagamento.</p>
        </div>
      </div>

      <Separator />
      {!draft.empresa_id ? (
        <p className="text-sm text-muted-foreground">
          Selecione o <strong>fornecedor</strong> acima para escolher os tecidos.
        </p>
      ) : (
        <>
          <TecidoGroup
            n={1}
            artigos={artigos}
            artigoId={artigoIdFor(1)}
            onArtigoChange={(id) => setArtigo(1, id)}
            variantes={artigoIdFor(1) ? variantesByArtigo[artigoIdFor(1)!] ?? [] : []}
            items={itemsBy(1).filter((i) => i.variante_tecido_id)}
            toggleVariante={(vid, c) => toggleVariante(1, vid, c)}
            setQtd={setQtd}
            setRendimento={(v) => setRendimento(1, v)}
            varianteMap={varianteMap}
          />

          {!tecido2Aberto ? (
            <Button variant="outline" onClick={() => setTecido2Aberto(true)}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar Tecido 2
            </Button>
          ) : (
            <>
              <TecidoGroup
                n={2}
                artigos={artigos}
                artigoId={artigoIdFor(2)}
                onArtigoChange={(id) => setArtigo(2, id)}
                variantes={artigoIdFor(2) ? variantesByArtigo[artigoIdFor(2)!] ?? [] : []}
                items={itemsBy(2).filter((i) => i.variante_tecido_id)}
                toggleVariante={(vid, c) => toggleVariante(2, vid, c)}
                setQtd={setQtd}
                setRendimento={(v) => setRendimento(2, v)}
                varianteMap={varianteMap}
              />
              <Button variant="ghost" size="sm" onClick={removeTecido2}>
                <Trash2 className="h-4 w-4 mr-1" /> Remover Tecido 2
              </Button>
            </>
          )}
        </>
      )}

      <Separator />
      <div className="grid sm:grid-cols-2 gap-4">
        <FileField label="Anexo do Pedido" path={draft.anexo_pedido_url}
          onChange={(f) => handleSingleUpload(f, "anexo_pedido_url")}
          onClear={() => setDraft((d) => ({ ...d, anexo_pedido_url: null }))} />
        <FileField label="Modelo Sugerido" path={draft.modelo_sugerido_url}
          onChange={(f) => handleSingleUpload(f, "modelo_sugerido_url")}
          onClear={() => setDraft((d) => ({ ...d, modelo_sugerido_url: null }))} />
      </div>

      <div className="grid gap-1">
        <Label>Observações sobre Entrega</Label>
        <Textarea value={draft.observacoes_entrega} onChange={(e) => setDraft((d) => ({ ...d, observacoes_entrega: e.target.value }))} />
      </div>
    </>
  );
}
