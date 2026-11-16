import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirmacao } from "@/components/shared/ConfirmarAcaoDialog";
import { textoRegerarSkusLoja } from "@/lib/confirmacoes-textos";
import { chaveLista } from "@/components/integracao/useIntegracao";
import {
  TAMANHO_PAGINA_PADRAO, TEXTO_FALHA_TEMPO, TEXTO_FALHA_TEMPO_GRAVACAO, calcularPrevia, gravarEmLotes, itensParaGravar, resumirGravacao, resumirPrevia, temFormatoSku, totalAGravar,
  type ItemPrevia, type ResultadoItem,
} from "@/lib/regerar-skus-loja";
import { RegerarSkusLojaDialog, type FaseDialog, type ResultadoGravacaoTela } from "./RegerarSkusLojaDialog";

// Card "Regerar todos os SKUs da loja" (Config da Loja, logo ABAIXO do "Formato do SKU"; só admin — a página já navega os demais e as RPCs conferem de novo).
// Ação de administração com o SEU botão (como o "Salvar formato do SKU"): PRÉVIA detalhada em PÁGINAS (nada grava) → Dialog de revisão → AlertDialog de
// confirmar → gravação em lotes (cada lote atômico por produto; o que já gravou FICA se cancelar). O laço (recuo ÷2 no timeout) é `@/lib/regerar-skus-loja`.
// Lê o Formato GRAVADO (o servidor também): com o Formato do card acima em rascunho o botão fica desabilitado (`formatoSujo`).

export function RegerarSkusLojaCard({ paginaSuja, formatoSujo }: { paginaSuja: boolean; formatoSujo: boolean }) {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const { pedir, dialog } = useConfirmacao();
  const formato = useQuery({
    queryKey: ["regerar-skus-formato", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("sku_config").eq("tenant_id", tenantId as string).maybeSingle();
      if (error) throw error;
      return temFormatoSku((data as any)?.sku_config ?? null);
    },
  });
  // o Formato acabou de ser salvo no card de cima: relê (a tela também relê ao voltar o foco)
  useEffect(() => { if (tenantId && !formatoSujo) void formato.refetch(); }, [formatoSujo, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [fase, setFase] = useState<FaseDialog | null>(null); // null = Dialog fechado
  const [itens, setItens] = useState<ItemPrevia[]>([]);
  const [progresso, setProgresso] = useState<{ feitos: number; total: number | null }>({ feitos: 0, total: null });
  const [tamanho, setTamanho] = useState(TAMANHO_PAGINA_PADRAO);
  const [falhaPrevia, setFalhaPrevia] = useState<{ texto: string; proximo: string | null } | null>(null);
  const [resultado, setResultado] = useState<ResultadoGravacaoTela | null>(null);
  const [restantes, setRestantes] = useState<ItemPrevia[]>([]);
  const cancelar = useRef(false);
  const gravandoRef = useRef(false); // duplo clique em "Continuar gravando"/confirmar não pode abrir 2 laços
  const todosResultados = useRef<ResultadoItem[]>([]);

  const chamarPrevia = async (a: { tenantId: string; apos: string | null; limite: number }) => {
    const { data, error } = await supabase.rpc("regerar_skus_loja_previa" as any, { _tenant_id: a.tenantId, _apos: a.apos, _limite: a.limite });
    if (error) throw error;
    return data;
  };
  const chamarAplicar = async (a: { tenantId: string; itens: { modelo_id: string; assinatura: string }[] }) => {
    const { data, error } = await supabase.rpc("regerar_skus_loja_aplicar" as any, { _tenant_id: a.tenantId, _itens: a.itens });
    if (error) throw error;
    return data;
  };

  const calcular = async (continuarDe: string | null = null) => {
    if (!tenantId) return;
    cancelar.current = false;
    setFase("calculando");
    setFalhaPrevia(null);
    const jaTem = continuarDe ? itens : [];
    if (!continuarDe) { setItens([]); setProgresso({ feitos: 0, total: null }); }
    const r = await calcularPrevia({
      tenantId, chamar: chamarPrevia, tamanhoInicial: tamanho, continuarDe, jaTem, total: continuarDe ? progresso.total : null,
      cancelado: () => cancelar.current,
      aoPagina: ({ feitos, total }) => setProgresso({ feitos, total }),
      aoRecuar: setTamanho,
    });
    setTamanho(r.tamanho);
    if (r.status === "cancelado") { setFase(null); return; }
    if (r.status === "falha") {
      setItens(r.itens);
      setFalhaPrevia({ texto: r.falha?.tempo ? TEXTO_FALHA_TEMPO : mensagemErro(r.falha?.erro, "Não foi possível calcular a prévia."), proximo: r.proximo });
      return;
    }
    if (!r.formatoOk) {
      setFase(null);
      toast.error("A loja ainda não tem o Formato do SKU — configure no card acima.");
      void formato.refetch();
      return;
    }
    setItens(r.itens);
    setFase("revisao");
  };

  const gravar = async (lista: ItemPrevia[]) => {
    if (!tenantId || gravandoRef.current) return;
    gravandoRef.current = true;
    cancelar.current = false;
    setFase("gravando");
    setProgresso({ feitos: 0, total: lista.length });
    let r: Awaited<ReturnType<typeof gravarEmLotes>>;
    try {
      r = await gravarEmLotes({
        tenantId, itens: lista, chamar: chamarAplicar, tamanhoInicial: tamanho, cancelado: () => cancelar.current,
        aoLote: ({ feitos, total }) => setProgresso({ feitos, total }),
        aoRecuar: setTamanho,
      });
    } finally {
      gravandoRef.current = false;
    }
    todosResultados.current = [...todosResultados.current, ...r.resultados];
    setTamanho(r.tamanho);
    setRestantes(r.restantes);
    setResultado({
      resumo: resumirGravacao(todosResultados.current),
      restantes: r.restantes.length,
      parou: r.status === "completo" ? null : r.status,
      textoFalha: r.status === "falha" ? (r.falha?.tempo ? TEXTO_FALHA_TEMPO_GRAVACAO : mensagemErro(r.falha?.erro, "A gravação parou por um erro.")) : null,
    });
    setFase("concluido");
    // o que a lista de SKUs de cada card, a prévia do Planejamento e a Integração (SKU desatualizado = falta) mostram
    void qc.invalidateQueries({ queryKey: ["plan-skus"] });
    void qc.invalidateQueries({ queryKey: ["plan-skus-previa"] });
    void qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
    void qc.invalidateQueries({ queryKey: ["modelo"] });
    void qc.invalidateQueries({ queryKey: chaveLista(tenantId) });
  };

  const confirmar = () => {
    const t = totalAGravar(itens);
    if (t.skus === 0) return;
    pedir({ ...textoRegerarSkusLoja(t), onConfirmar: () => { todosResultados.current = []; void gravar(itensParaGravar(itens)); } });
  };
  const fechar = () => { setFase(null); setResultado(null); setItens([]); setRestantes([]); todosResultados.current = []; };

  const semFormato = formato.isSuccess && formato.data === false;
  const motivo = paginaSuja ? "Salve ou descarte as outras alterações da página antes."
    : formatoSujo ? "O Formato do SKU tem alterações não salvas — salve (ou descarte) o Formato antes: o lote usa o Formato gravado."
    : semFormato ? null
    : formato.isError ? "Não foi possível ler o Formato do SKU — recarregue a página." : null;
  const desabilitado = !!motivo || semFormato || !formato.isSuccess || fase !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Regerar todos os SKUs da loja</CardTitle>
        <CardDescription>
          Refaz os SKUs de todos os produtos da loja pelo Formato do SKU gravado. Primeiro você vê uma prévia detalhada (nada é gravado); depois confirma. Os SKUs editados
          à mão, os produtos Integráveis/Integrados (ou já exportados) e os sem REF ou sem “Tamanho em” não mudam.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {semFormato && (
          <p className="text-sm text-muted-foreground">A loja ainda não tem o Formato do SKU — configure no card “Formato do SKU” acima{" "}(<Link to="/admin/configuracoes" className="underline">Config da Loja</Link>).</p>
        )}
        {motivo && <p className="text-xs text-amber-700 dark:text-amber-300">{motivo}</p>}
        <Button type="button" disabled={desabilitado} onClick={() => { todosResultados.current = []; void calcular(); }} className="max-sm:min-h-11">
          {fase === "calculando" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />} Gerar prévia
        </Button>
      </CardContent>
      {fase !== null && (
        <RegerarSkusLojaDialog
          fase={fase}
          progresso={progresso}
          tamanhoPagina={tamanho}
          falhaPrevia={fase === "calculando" && falhaPrevia ? { texto: falhaPrevia.texto } : null}
          itens={itens}
          resumo={resumirPrevia(itens)}
          aGravar={totalAGravar(itens)}
          resultado={resultado}
          onCancelar={() => { cancelar.current = true; if (falhaPrevia) fechar(); }}
          onFechar={fechar}
          onConfirmar={confirmar}
          onContinuarPrevia={() => { void calcular(falhaPrevia?.proximo ?? null); }}
          onContinuarGravacao={() => { void gravar(restantes); }}
          onRefazerPrevia={() => { setResultado(null); todosResultados.current = []; void calcular(); }}
        />
      )}
      {dialog}
    </Card>
  );
}
