// Integração › Produtos › "Gerar JSON" (entrega manual = integração; P-249 B). Passo 1 = AlertDialog (ação séria: os
// Integráveis passam a Integrado AGORA — texto do dono VERBATIM, igual ao IntegrarDialog); passo 2 = Dialog (novo) com o JSON,
// "Baixar arquivo", "Copiar" e a confirmação de "você baixou/copiou?" ao fechar. A server function faz tudo no Worker
// (ler → fotos → confirmar); aqui só a pré-classificação LOCAL (o `fora` do servidor tem a palavra final).
// O passo 2 NÃO depende da lista: a relista tira os integrados da Situação "Não integrados", então o resultado vive no
// estado deste diálogo. O arquivo é SÓ o `json` (nunca o `fora`).
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { ForaGerarJson } from "@/lib/integracao/api/resposta";
import { TEXTO_ALERTA_INTEGRAR } from "@/lib/integracao/campos";
import { gerarJsonIntegracao } from "@/lib/integracao/gerar-json.functions";
import {
  MOTIVO_FORA_GERAR_JSON, TEXTO_GERAR_JSON_EXPLICA, TEXTO_GERAR_JSON_FECHAR_SEM_SALVAR, TEXTO_GERAR_JSON_FOTOS,
  TEXTO_GERAR_JSON_REEXPORTA, classificarGerarJson, completarFora, nomeArquivoJson,
} from "@/lib/integracao/gerar-json";
import type { ProdutoLista } from "@/lib/integracao/produtos";
import { confirmarLojaAtiva, invalidarIntegracao } from "./useIntegracao";

type Resultado = {
  texto: string; novos: number; relidos: number; fora: ForaGerarJson[]; validadeFotoDias: number;
  nomeArquivo: string;
};

function ListaFora({ itens }: { itens: { id: string; nome: string; ref: string | null; motivo: ForaGerarJson["motivo"] }[] }) {
  if (itens.length === 0) return null;
  return (
    <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
      {itens.map((f) => (
        <li key={f.id}>Não entram: {f.nome}{f.ref ? ` (${f.ref})` : ""} — {MOTIVO_FORA_GERAR_JSON[f.motivo]}</li>
      ))}
    </ul>
  );
}

export function GerarJsonDialog({ produtos, podeVerCustos, onFechar, onFeito }: {
  produtos: ProdutoLista[]; podeVerCustos: boolean; onFechar: () => void; onFeito: (idsAfetados: string[]) => void;
}) {
  const tenantId = useActiveTenantId();
  const tz = useStoreTimezone();
  const qc = useQueryClient();
  const chamar = useServerFn(gerarJsonIntegracao);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [idsEnviados, setIdsEnviados] = useState<string[]>([]);
  const [salvo, setSalvo] = useState(false);
  const [pedirFechar, setPedirFechar] = useState(false);
  const preRef = useRef<HTMLPreElement | null>(null);

  const classe = useMemo(() => classificarGerarJson(produtos, { podeVerCustos }), [produtos, podeVerCustos]);
  const elegiveis = classe.novos.length + classe.reexportar.length;

  // a geração grava um acesso `manual` (aparece em API › Acessos recentes) além de mexer na lista/estado
  const invalidar = (ids: string[]) => {
    invalidarIntegracao(qc, tenantId, ids);
    void qc.invalidateQueries({ queryKey: ["integracao-acessos", tenantId] });
  };
  const gerar = useMutation({
    mutationFn: async (ids: string[]) => {
      // a MESMA defesa dos outros pontos de escrita da Integração: relê a loja ativa DIRETO do servidor (o banco ainda
      // confere `_loja` = loja ativa, 3ª camada). Traz também o nome (usado no nome do arquivo).
      const loja = await confirmarLojaAtiva(tenantId);
      const res = await chamar({ data: { modelo_ids: ids, loja: loja.tenantId } });
      // a server function NUNCA lança (o `code` se perderia na serialização): o erro vem no resultado
      if (!res.ok) throw Object.assign(new Error(res.erro.message), { code: res.erro.code });
      return { res, loja };
    },
    onSuccess: ({ res, loja }, ids) => {
      // nome/REF que o layout da loja não trouxe: completa pelos produtos carregados (agora, antes de a relista mudar a lista)
      const fora = completarFora(res.fora, produtos);
      if (res.vazio) {
        invalidar(ids);
        const motivos = fora.map((f) => `${f.nome ?? "Produto"}${f.ref ? ` (${f.ref})` : ""} — ${MOTIVO_FORA_GERAR_JSON[f.motivo]}`);
        toast.info("Nenhum produto entrou no arquivo.", { description: motivos.join(" · ") });
        onFechar();
        return;
      }
      setIdsEnviados(ids);
      setResultado({
        texto: res.texto, novos: res.novos, relidos: res.relidos, fora,
        validadeFotoDias: res.validadeFotoDias, nomeArquivo: nomeArquivoJson(loja.nome, new Date(res.geradoEm), tz),
      });
      // os produtos já constam como Integrado no banco: relê a lista (o resultado fica no estado, não depende dela)
      invalidar(ids);
    },
    onError: (e, ids) => {
      toast.error(mensagemErro(e, "Não foi possível gerar o JSON."));
      invalidar(ids);
    },
  });

  // A lista esvaziou com o passo 1 aberto (outra pessoa integrou/voltou): não há o que gerar — fecha.
  useEffect(() => {
    if (!resultado && !gerar.isPending && produtos.length === 0) onFechar();
  }, [resultado, gerar.isPending, produtos.length, onFechar]);

  const baixar = () => {
    if (!resultado) return;
    const url = URL.createObjectURL(new Blob([resultado.texto], { type: "application/json;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = resultado.nomeArquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // revogar no MESMO tick pode abortar o download em alguns navegadores (Safari): adia
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSalvo(true);
  };
  const copiar = async () => {
    if (!resultado) return;
    try {
      await navigator.clipboard.writeText(resultado.texto);
      toast.success("JSON copiado.");
      setSalvo(true);
    } catch {
      // `navigator.clipboard` falhou (contexto não seguro/permissão negada): seleciona o texto e tenta `execCommand("copy")`
      // (roda depois de um await, mas a ativação do clique costuma seguir válida); se ISSO também falhar, o texto fica
      // selecionado e o aviso orienta a copiar à mão.
      const el = preRef.current;
      let copiou = false;
      if (el) {
        const sel = window.getSelection();
        const faixa = document.createRange();
        faixa.selectNodeContents(el);
        sel?.removeAllRanges();
        sel?.addRange(faixa);
        try { copiou = document.execCommand("copy"); } catch { copiou = false; }
      }
      if (copiou) { toast.success("JSON copiado."); setSalvo(true); }
      else toast.error("Não foi possível copiar — selecione o texto e copie à mão.");
    }
  };
  const concluir = () => onFeito(idsEnviados);
  const tentarFechar = () => { if (!salvo) setPedirFechar(true); else concluir(); };

  if (resultado) {
    const foraLista = resultado.fora.map((f) => ({ id: f.modelo_id, nome: f.nome ?? "Produto", ref: f.ref, motivo: f.motivo }));
    return (
      <>
        <Dialog open onOpenChange={(o) => { if (!o) tentarFechar(); }}>
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>JSON gerado</DialogTitle>
              <DialogDescription>
                {resultado.novos} passaram a Integrado · {resultado.relidos} reexportado(s) · {resultado.fora.length} fora
              </DialogDescription>
            </DialogHeader>
            <ListaFora itens={foraLista} />
            <p className="text-sm text-muted-foreground">{TEXTO_GERAR_JSON_FOTOS(resultado.validadeFotoDias)}</p>
            <pre ref={preRef} className="max-h-96 max-w-full overflow-auto rounded-md bg-muted p-3 text-xs">{resultado.texto}</pre>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => void copiar()}>Copiar</Button>
              <Button type="button" variant="outline" onClick={baixar}>Baixar arquivo (.json)</Button>
              <Button type="button" onClick={tentarFechar}>Fechar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog open={pedirFechar} onOpenChange={setPedirFechar}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Fechar sem baixar nem copiar?</AlertDialogTitle>
              <AlertDialogDescription>{TEXTO_GERAR_JSON_FECHAR_SEM_SALVAR}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <Button type="button" variant="destructive" onClick={concluir}>Fechar mesmo assim</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  const foraLista = classe.fora.map(({ p, motivo }) => ({ id: p.modeloId, nome: p.raw.nome, ref: p.raw.ref, motivo }));
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o && !gerar.isPending) onFechar(); }}>
      <AlertDialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Gerar JSON (entrega manual)</AlertDialogTitle>
          <AlertDialogDescription className="text-base font-semibold text-destructive">{TEXTO_ALERTA_INTEGRAR}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 text-sm">
          <p>{TEXTO_GERAR_JSON_EXPLICA}</p>
          <p>
            Entram <strong className="tabular-nums">{elegiveis}</strong> — <strong className="tabular-nums">{classe.novos.length}</strong>{" "}
            passa(m) a Integrado, <strong className="tabular-nums">{classe.reexportar.length}</strong> reexportação (já integrados).
          </p>
          {classe.reexportar.length > 0 && <p className="text-muted-foreground">{TEXTO_GERAR_JSON_REEXPORTA}</p>}
          <ListaFora itens={foraLista} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={gerar.isPending}>Cancelar</AlertDialogCancel>
          <Button type="button" disabled={elegiveis === 0 || gerar.isPending}
            onClick={() => gerar.mutate(produtos.map((p) => p.modeloId))}>
            {gerar.isPending ? "Gerando…" : "Tenho certeza — gerar JSON"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
