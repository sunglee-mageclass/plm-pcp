import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ModeloThumb } from "./ModeloThumb";
import { OcResumoCores } from "./OcResumoCores";
import type { SituacaoOcRow } from "@/lib/plan-tecido/useSituacaoOcs";
import { useModelosDaOc, type ModeloDaOc } from "./useModelosDaOc";

// Dialog de uma OC vinculada (Modo Plano, set/2026). Mostra, daquela OC:
//  • Cores: Pedido · Reserva · Sobra por variante (de `situacaoRows` filtrado pela OC).
//    Reserva = usada (baixa real) + comprometida (uso planejado/enviado); Sobra = pedida − reserva.
//  • Modelos que usam a OC: foto + nome + REF + COLEÇÃO — escopo GLOBAL (todas as coleções da loja,
//    via RPC `plan_tecido_modelos_da_oc`), pra casar com a Reserva (que já é global). Antes listava só
//    os slots da subcoleção aberta e escondia quem reserva de outra coleção → Sobra parecia maior.
export function OcVinculadaDialog({
  open, onOpenChange, ocId, numero, fornecedor, status, situacaoRows,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ocId: string;
  numero: string | null;
  fornecedor: string | null;
  status: string | null;
  situacaoRows: SituacaoOcRow[];
}) {
  const recebido = status === "recebido";
  const { data: modelosDaOc = [], isLoading: carregandoModelos } = useModelosDaOc(open ? ocId : null);
  const navigate = useNavigate();
  // Modelo a confirmar redirecionamento (clique no card, fora da foto) → AlertDialog. null = fechado.
  const [redirModelo, setRedirModelo] = useState<ModeloDaOc | null>(null);
  // Navega para o Plan.Tecido do modelo: coleção + subcoleção dele, em Modo Plano, com a faixa daquele
  // tecido aberta e o card destacado (o Sheet lê `modo`/`focoModelo` do search e monta o estado).
  const irParaPlanTecido = (m: ModeloDaOc) => {
    if (!m.colecao_id) return;
    onOpenChange(false); // fecha o dialog da OC antes de navegar
    navigate({
      to: "/criacao/plan-tecido",
      // ?sub= casa contra subcolecao_id (uuid), NÃO o nome — usa o id da sub do modelo.
      search: { colecao: m.colecao_id, sub: m.subcolecao_id ?? undefined, modo: "plano", focoModelo: m.modelo_id },
    });
  };
  // Planejamento de PRODUTO: abre o Sheet do modelo direto (deep-link `?modelo=<id>`).
  const irParaPlanProduto = (m: ModeloDaOc) => {
    onOpenChange(false);
    navigate({ to: "/criacao/planejamento", search: { modelo: m.modelo_id } });
  };
  // Semântica ÚNICA (decisão do dono jul/2026, espelha `contabilizarOc` em calc.ts:124-133):
  //  • Reserva = max(comprometido, baixa) — NÃO a soma (o comprometido e a baixa da MESMA demanda se
  //    sobrepõem; somar dupla-conta).
  //  • Sobra = ENTREGUE − Reserva (o físico que REALMENTE chegou, não a metragem pedida). NÃO clampa:
  //    negativo = déficit real (vermelho), igual ao Resumo. Encomendada (entregue 0) → sobra negativa.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>OC {numero ?? "s/ nº"}</span>
            {fornecedor && <span className="text-sm font-normal text-muted-foreground">{fornecedor}</span>}
            <StatusBadge tone={recebido ? "success" : "warning"} className="normal-case tracking-normal">
              {recebido ? "Recebido" : "Encomendado"}
            </StatusBadge>
          </DialogTitle>
        </DialogHeader>

        {/* Cores: Pedido · Reserva · Sobra (tabela compartilhada com o popover de hover). */}
        <OcResumoCores situacaoRows={situacaoRows} ocId={ocId} />

        {/* Modelos que usam a OC — GLOBAL (todas as coleções). Foto + nome + REF + coleção. */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Modelos que usam esta OC</p>
          {carregandoModelos ? (
            <p className="text-xs text-muted-foreground">Carregando…</p>
          ) : modelosDaOc.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum modelo vinculado.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
              {modelosDaOc.map((m) => (
                <div key={m.modelo_id} className="overflow-hidden rounded-lg border">
                  {/* Foto abre ZOOM (ModeloThumb `zoom`) — NÃO redireciona. */}
                  <ModeloThumb path={m.thumb_path} className="aspect-[4/5] w-full" zoom alt={m.nome ?? "Modelo"} />
                  {/* A área de TEXTO é o botão de redirecionar (clicar → alerta com as opções de página).
                      Sempre clicável — o Plan. Produto funciona sem coleção; a opção de Plan. Tecido é
                      que fica desabilitada no alerta quando o modelo não tem coleção. */}
                  <button
                    type="button"
                    onClick={() => setRedirModelo(m)}
                    title="Ir para este produto"
                    className="block w-full px-2 py-1 text-left hover:bg-muted"
                  >
                    <div className="truncate text-xs font-medium">{m.nome ?? "Modelo"}</div>
                    {m.ref && <div className="truncate text-[10px] tabular-nums text-muted-foreground">{m.ref}</div>}
                    {m.colecao_nome && (
                      <div className="truncate text-[10px] text-muted-foreground" title={`Coleção: ${m.colecao_nome}`}>
                        {m.colecao_nome}{m.subcolecao ? ` · ${m.subcolecao}` : ""}
                      </div>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>

      {/* Redirecionamento (clique num card de modelo) — 3 opções: cancelar / Plan. Produto (Sheet do
          modelo) / Plan. Tecido (Modo Plano com o card destacado). Montado só quando há um pendente. */}
      {redirModelo && (
        <AlertDialog open onOpenChange={(o) => !o && setRedirModelo(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Ir para este produto?</AlertDialogTitle>
              <AlertDialogDescription>
                {redirModelo.nome ?? "Modelo"}{redirModelo.ref ? ` · ${redirModelo.ref}` : ""}
                {redirModelo.colecao_nome ? ` — ${redirModelo.colecao_nome}${redirModelo.subcolecao ? ` · ${redirModelo.subcolecao}` : ""}` : ""}.
                Escolha para onde ir.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
              <AlertDialogCancel className="mt-0">Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => { const m = redirModelo; setRedirModelo(null); irParaPlanProduto(m); }}>
                Planejamento de Produto
              </AlertDialogAction>
              <AlertDialogAction
                disabled={!redirModelo.colecao_id}
                onClick={() => { const m = redirModelo; setRedirModelo(null); irParaPlanTecido(m); }}
              >
                Planejamento de Tecido
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Dialog>
  );
}
