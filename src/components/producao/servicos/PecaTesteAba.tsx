// F6 Fluxo 1 (A1) — a MESMA seção de Peça Teste do Sheet do Planejamento, trazida para PCP › Serviços,
// para o PCP trabalhar a peça teste sem entrar no Sheet do time de estilo. MÃO DUPLA: edita o MESMO dado
// (RPC salvar_peca_teste + trilha por modelo); o merge/P0409 do próprio hook cobre edição simultânea.
// Standalone: `usePecaTeste` recebe `modeloId` e lê/salva pelas próprias RPCs (fornecedorMo/mini = null
// aqui — a aba não espelha a M.O. nem roda a mini-explosão ao vivo; a troca de fornecedor é direta).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useConfirmacao } from "@/components/shared/ConfirmarAcaoDialog";
import { usePecaTeste, salvarComConfirmacaoEstorno } from "@/components/planejamento/planejamento-detail/usePecaTeste";
import { PecaTesteSecao, type FornecedorServicoPT } from "@/components/planejamento/planejamento-detail/PecaTesteSecao";
import { mensagemErro } from "@/lib/erro-mensagem";

export function PecaTesteAba({ modeloId, podeEditar }: { modeloId: string; podeEditar: boolean }) {
  const tenantId = useActiveTenantId();
  // `habilitado: true` = o card existe e a seção se aplica (o hook ainda gateia por canView(PERM_PECA_TESTE)
  // internamente via `ativo`). fornecedorMo/linhasIgnoradas/mini = null: a aba não mexe na M.O. nem na mini.
  const pt = usePecaTeste({ modeloId, habilitado: true, podeEditar, fornecedorMo: null, linhasIgnoradas: null, mini: null });
  const { pedir, dialog } = useConfirmacao();
  const [salvando, setSalvando] = useState(false);

  // Fornecedores de SERVIÇO da loja — mesma fonte do Sheet (empresas tipo='servico'); só carrega quando
  // a seção está ativa e pode editar (seletor de troca de fornecedor).
  const { data: fornecedores = [] } = useQuery<FornecedorServicoPT[]>({
    queryKey: ["empresas-servico-mo", tenantId],
    enabled: pt.ativo && podeEditar && !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nome_fantasia").eq("tipo", "servico").order("nome_fantasia");
      if (error) throw error;
      return (data ?? []) as FornecedorServicoPT[];
    },
  });

  // Grava SÓ a seção Peça Teste (sem a cadeia do Salvar do Sheet). Trava em conflito; captura síncrona;
  // re-baseia só no ok. Reusa o mesmo contrato `pecaTesteSave` do Sheet — mão dupla garantida.
  const gravar = async () => {
    if (pt.pecaTesteSave.conflitos() > 0) {
      toast.error("Resolva os conflitos da Peça Teste antes de salvar.");
      return;
    }
    const captura = pt.pecaTesteSave.capturar();
    if (!captura) { toast.success("Nada para salvar."); return; }
    setSalvando(true);
    try {
      const res = await pt.pecaTesteSave.salvar(captura);
      if ("ok" in res) { pt.pecaTesteSave.aposSalvar(captura); toast.success("Peça teste salva."); }
      else if ("conflito" in res) toast.error("Outra pessoa salvou — confira os conflitos na seção.");
      else toast.error(mensagemErro(res.erro, "Não foi possível salvar a peça teste."));
    } finally { setSalvando(false); }
  };

  // `salvarComConfirmacaoEstorno` abre a confirmação de estorno (se houver baixa a estornar) e só então
  // chama `gravar` — idêntico ao Salvar do Sheet.
  const onSalvar = () => salvarComConfirmacaoEstorno(pt.pecaTesteSave, pedir, () => void gravar());

  return (
    <div className="space-y-3">
      <PecaTesteSecao
        estado={pt.estado}
        base={pt.base}
        fornecedores={fornecedores}
        somenteLeitura={!podeEditar}
        carregando={pt.carregando}
        erro={pt.erro}
        onTentarDeNovo={pt.tentarDeNovo}
        conflitos={pt.conflitos}
        onResolverConflito={pt.resolverConflito}
        onEditarAtual={pt.editarAtual}
        onAprovar={pt.aprovarAtual}
        onDesfazer={pt.desfazerAtual}
        onReprovar={pt.reprovarAtual}
        onTrocarFornecedor={pt.trocarFornecedor}
        avisos={pt.avisos}
        defaultAberta
        linkPlanejamento={`/criacao/planejamento?modelo=${modeloId}`}
      />
      {podeEditar && pt.dirty && (
        <div className="flex justify-end">
          <Button size="sm" onClick={onSalvar} disabled={salvando || pt.conflitos.length > 0}>
            {salvando ? "Salvando…" : "Salvar peça teste"}
          </Button>
        </div>
      )}
      {dialog}
    </div>
  );
}
