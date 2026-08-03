import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/shared/DateField";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { FileField } from "./FileField";
import { TecidoGroup } from "./TecidoGroup";
import { FornecedorSelect } from "@/components/shared/FornecedorSelect";
import { ResponsavelSelect } from "@/components/shared/ResponsavelSelect";
import type { Artigo, Draft, Empresa, ItemDraft, ParcelaRecebimento, Variante } from "./shared";
import type { Conflito } from "@/lib/colab/merge";

// Colab (spec 2026-08-03) — piloto na OC de Tecido: presença/conflito por campo do
// CABEÇALHO (numero_pedido/datas/prazo) + realce da LINHA de item em conflito.
export type ColabHeaderProps = {
  emConflito: (path: string) => boolean;
  conflitoDe: (path: string) => Conflito | undefined;
  focadoPor: (path: string) => string | undefined;
  onResolverConflito: (c: Conflito, useDele: boolean) => void;
  conflitoLinha: (id: string | undefined) => Conflito | undefined;
};

/** Pequeno aviso inline "editado por outra pessoa" com as 2 ações de resolução. */
function ConflitoAviso({ conflito, onResolver }: { conflito: Conflito; onResolver: (useDele: boolean) => void }) {
  return (
    <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
      <span>Editado por outra pessoa.</span>
      <button type="button" className="underline underline-offset-2" onClick={() => onResolver(false)}>manter meu</button>
      <span aria-hidden>·</span>
      <button type="button" className="underline underline-offset-2" onClick={() => onResolver(true)}>usar o novo</button>
    </div>
  );
}

export function OcTecidoForm({
  draft, setDraft,
  empresas,
  artigos, variantesByArtigo, varianteMap,
  itemsBy, artigoIdFor, setArtigo, toggleVariante, setQtd, setPreco, setPrecoAll, setRendimento,
  tecido2Aberto, setTecido2Aberto, removeTecido2,
  handleSingleUpload,
  colab,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  empresas: Empresa[];
  artigos: Artigo[];
  variantesByArtigo: Record<string, Variante[]>;
  varianteMap: Record<string, Variante>;
  itemsBy: (n: 1 | 2) => ItemDraft[];
  artigoIdFor: (n: 1 | 2) => string | null;
  setArtigo: (n: 1 | 2, artigoId: string) => void;
  toggleVariante: (n: 1 | 2, varId: string, checked: boolean) => void;
  setQtd: (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number | null) => void;
  setPreco: (tempId: string, v: number | null) => void;
  setPrecoAll: (n: 1 | 2, v: number | null) => void;
  setRendimento: (n: 1 | 2, v: number | null) => void;
  tecido2Aberto: boolean;
  setTecido2Aberto: (v: boolean) => void;
  removeTecido2: () => void;
  handleSingleUpload: (file: File, key: keyof Draft) => void;
  colab: ColabHeaderProps;
}) {
  // Um por campo instrumentado: ring âmbar (conflito) OU sky (alguém focado ali agora).
  const campo = (path: string) => {
    const conflito = colab.emConflito(path) ? colab.conflitoDe(path) : undefined;
    const nome = colab.focadoPor(path);
    return {
      "data-colab-path": path,
      title: nome ? `${nome} está neste campo` : undefined,
      className: cn(conflito ? "ring-1 ring-amber-500" : nome ? "ring-1 ring-sky-400" : undefined),
      conflito,
    };
  };
  const cNumero = campo("numero_pedido");
  const cPrazo = campo("prazo_pagamento");
  const cDataPedido = campo("data_pedido");
  const cDataEntrega = campo("data_prevista_entrega");
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="grid gap-1">
          <Label>Número do Pedido</Label>
          <Input
            value={draft.numero_pedido}
            onChange={(e) => setDraft((d) => ({ ...d, numero_pedido: e.target.value }))}
            data-colab-path={cNumero["data-colab-path"]}
            title={cNumero.title}
            className={cNumero.className}
          />
          {cNumero.conflito && (
            <ConflitoAviso conflito={cNumero.conflito} onResolver={(useDele) => colab.onResolverConflito(cNumero.conflito!, useDele)} />
          )}
        </div>
        <div className="grid gap-1">
          <Label>Fornecedor</Label>
          {/* Dropdown único: empresa (direto) OU empresa via representante. */}
          <FornecedorSelect
            empresas={empresas}
            empresaId={draft.empresa_id}
            representanteId={draft.representante_id}
            onChange={(empresa_id, representante_id) => setDraft((d) => ({ ...d, empresa_id, representante_id }))}
          />
        </div>

        <div className="grid gap-1">
          <Label>Responsável</Label>
          <ResponsavelSelect
            nome={draft.responsavel_nome}
            id={draft.responsavel_id}
            onChange={(n, cid) => setDraft((d) => ({ ...d, responsavel_nome: n ?? "", responsavel_id: cid }))}
          />
        </div>

        <div className="grid gap-1">
          <Label>Prazo de Pagamento *</Label>
          <Input value={draft.prazo_pagamento} onChange={(e) => {
            const v = e.target.value;
            const parts = v.split(/[\/,-\s]+/).filter((p) => p.trim() !== "" && !isNaN(Number(p)));
            const qtd = parts.length > 0 ? Math.max(1, Math.min(6, parts.length)) : 1;
            setDraft((d) => ({ ...d, prazo_pagamento: v, quantidade_prazos: qtd }));
          }} placeholder="Ex: 30/60/90"
            data-colab-path={cPrazo["data-colab-path"]}
            title={cPrazo.title}
            className={cPrazo.className}
          />
          {cPrazo.conflito && (
            <ConflitoAviso conflito={cPrazo.conflito} onResolver={(useDele) => colab.onResolverConflito(cPrazo.conflito!, useDele)} />
          )}
        </div>

        <div className="grid gap-1">
          <Label>Data do Pedido</Label>
          <DateField
            value={draft.data_pedido}
            onChange={(e) => setDraft((d) => ({ ...d, data_pedido: e.target.value }))}
            data-colab-path={cDataPedido["data-colab-path"]}
            title={cDataPedido.title}
            inputClassName={cDataPedido.className}
          />
          {cDataPedido.conflito && (
            <ConflitoAviso conflito={cDataPedido.conflito} onResolver={(useDele) => colab.onResolverConflito(cDataPedido.conflito!, useDele)} />
          )}
        </div>
        <div className="grid gap-1">
          <Label>Data Prevista de Entrega *</Label>
          <DateField
            value={draft.data_prevista_entrega}
            onChange={(e) => setDraft((d) => ({ ...d, data_prevista_entrega: e.target.value }))}
            data-colab-path={cDataEntrega["data-colab-path"]}
            title={cDataEntrega.title}
            inputClassName={cDataEntrega.className}
          />
          {cDataEntrega.conflito && (
            <ConflitoAviso conflito={cDataEntrega.conflito} onResolver={(useDele) => colab.onResolverConflito(cDataEntrega.conflito!, useDele)} />
          )}
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
        </div>

        <div className="grid gap-1">
          <Label>Qtd de Parcelas (Pagamento)</Label>
          <NumberInput type="number" value={draft.quantidade_prazos} readOnly disabled />
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
            setPreco={setPreco}
            setPrecoAll={(v) => setPrecoAll(1, v)}
            setRendimento={(v) => setRendimento(1, v)}
            varianteMap={varianteMap}
            conflitoLinha={colab.conflitoLinha}
            onResolverConflito={colab.onResolverConflito}
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
                setPreco={setPreco}
                setPrecoAll={(v) => setPrecoAll(2, v)}
                setRendimento={(v) => setRendimento(2, v)}
                varianteMap={varianteMap}
                conflitoLinha={colab.conflitoLinha}
                onResolverConflito={colab.onResolverConflito}
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
