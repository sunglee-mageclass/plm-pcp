import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { rotuloTamanho } from "@/components/planejamento/planejamento-detail/codigos/sku-card";
import {
  FILTROS_PREVIA, ROTULO_ACAO_LINHA, TEXTO_MOTIVO_PULO, filtrarItens, resumirGravacao, type AcaoLinha, type FiltroPrevia, type ItemPrevia, type MotivoPulo,
  type ResumoPrevia,
} from "@/lib/regerar-skus-loja";

// "Regerar todos os SKUs da loja" — Dialog de REVISÃO (largo; tela cheia no celular): progresso da prévia em páginas, contadores, lista produto → (variante ·
// tamanho) → SKU antes → depois, e o resumo da gravação. Só apresenta: o laço, as RPCs e o AlertDialog de confirmar moram em `RegerarSkusLojaCard`.
// Dialog de REVISÃO (não é "editar" nem "novo" — regra dura de UI intacta). Rodapé fixo; só o corpo rola; produto recolhido por padrão (a lista pode ter centenas).

const RODAPE = "border-t bg-background -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 py-3 flex-row flex-wrap items-center gap-2";
const POR_VEZ = 50;
const TOM_ACAO: Record<AcaoLinha, StatusTone> = { muda: "warning", novo: "info", sai: "neutral", conflito: "danger" };

export type FaseDialog = "calculando" | "revisao" | "gravando" | "concluido";
export type ResultadoGravacaoTela = {
  resumo: ReturnType<typeof resumirGravacao>;
  /** produtos que a falha/o cancelamento deixou sem gravar */
  restantes: number;
  parou: "falha" | "cancelado" | null;
  textoFalha: string | null;
};

export function RegerarSkusLojaDialog(p: {
  fase: FaseDialog;
  progresso: { feitos: number; total: number | null };
  tamanhoPagina: number;
  /** a prévia parou (tempo esgotado repetido ou erro): `texto` em PT; dá para continuar de onde parou */
  falhaPrevia: { texto: string } | null;
  itens: ItemPrevia[];
  resumo: ResumoPrevia;
  aGravar: { skus: number; produtos: number };
  resultado: ResultadoGravacaoTela | null;
  onCancelar: () => void;
  onFechar: () => void;
  onConfirmar: () => void;
  onContinuarPrevia: () => void;
  onContinuarGravacao: () => void;
  onRefazerPrevia: () => void;
}) {
  const [filtro, setFiltro] = useState<FiltroPrevia>("muda");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [visiveis, setVisiveis] = useState(POR_VEZ);
  const emCurso = p.fase === "calculando" || p.fase === "gravando";
  const pct = p.progresso.total && p.progresso.total > 0 ? Math.min(100, Math.round((p.progresso.feitos / p.progresso.total) * 100)) : null;
  const lista = filtrarItens(p.itens, filtro);
  const alterna = (id: string) => setAbertos((a) => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const r = p.resumo;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !emCurso) p.onFechar(); }}>
      <DialogContent fixedFooter mobileFull className="max-w-4xl" data-testid="regerar-skus-dialogo">
        <DialogHeader>
          <DialogTitle>
            {p.fase === "calculando" ? "Calculando a prévia…" : p.fase === "gravando" ? "Gravando os SKUs…"
              : p.fase === "concluido" ? "Regeração dos SKUs" : "Prévia — Regerar todos os SKUs da loja"}
          </DialogTitle>
          <DialogDescription>
            {p.fase === "revisao"
              ? "Nada foi gravado ainda. Confira o que muda: só o botão “Regerar” abaixo grava, em lotes pequenos."
              : p.fase === "calculando" ? "Lendo os produtos da loja em lotes pequenos. Nada é gravado nesta fase."
              : p.fase === "gravando" ? "Gravando em lotes. Cancelar para depois do lote atual: o que já foi gravado fica."
              : "Resumo do que foi gravado."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {(p.fase === "calculando" || p.fase === "gravando") && (
            <div className="space-y-2" data-testid="regerar-skus-progresso">
              <p className="text-sm">
                {p.fase === "calculando" ? "Calculando" : "Gravando"}… {p.progresso.feitos} de {p.progresso.total ?? "?"} produtos
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-primary transition-all" style={{ width: `${pct ?? 5}%` }} />
              </div>
              {p.tamanhoPagina < 25 && (
                <p className="text-xs text-muted-foreground">O servidor demorou: lotes menores ({p.tamanhoPagina} produtos por vez) para responder a tempo.</p>
              )}
              {p.falhaPrevia && (
                <div className="space-y-2 rounded-md border border-destructive/40 p-3" role="alert">
                  <p className="text-sm text-destructive">{p.falhaPrevia.texto}</p>
                  <Button type="button" size="sm" onClick={p.onContinuarPrevia} className="max-sm:min-h-11">
                    <RefreshCw className="mr-1 h-4 w-4" /> Continuar de onde parou
                  </Button>
                </div>
              )}
            </div>
          )}

          {p.fase === "revisao" && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="regerar-skus-contadores">
                {[
                  ["SKUs que mudam", r.mudam], ["SKUs novos", r.novos], ["SKUs removidos", r.removidos],
                  ["SKUs manuais preservados", r.manuaisPreservados], ["Conflitos", r.conflitos],
                ].map(([rotulo, n]) => (
                  <div key={String(rotulo)} className="rounded-md border px-3 py-2">
                    <p className="text-lg font-semibold tabular-nums">{n}</p>
                    <p className="text-xs text-muted-foreground">{rotulo}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground" data-testid="regerar-skus-pulados">
                {r.produtosMudam} produto(s) mudam · {r.produtosIguais} já estão iguais
                {r.totalPulados > 0 && (
                  <> · {r.totalPulados} pulado(s): {(Object.keys(r.pulados) as MotivoPulo[]).filter((m) => r.pulados[m] > 0).map((m) => `${TEXTO_MOTIVO_PULO[m]} ${r.pulados[m]}`).join(" · ")}</>
                )}
                {r.produtosErro > 0 && <> · {r.produtosErro} com erro na leitura</>}
              </p>
              {r.produtosMudam === 0 && <p className="text-sm">Nenhum SKU precisa mudar.</p>}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Mostrar:</span>
                <Select value={filtro} onValueChange={(v) => { setFiltro(v as FiltroPrevia); setVisiveis(POR_VEZ); }}>
                  <SelectTrigger className="h-8 w-48 max-sm:h-11" aria-label="Filtrar produtos da prévia"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FILTROS_PREVIA.map((f) => <SelectItem key={f.valor} value={f.valor}>{f.rotulo}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">{lista.length} produto(s)</span>
              </div>
              <ul className="space-y-1" data-testid="regerar-skus-lista">
                {lista.slice(0, visiveis).map((i) => {
                  const aberto = abertos.has(i.modeloId);
                  return (
                    <li key={i.modeloId} className="rounded-md border">
                      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm max-sm:min-h-11" onClick={() => alterna(i.modeloId)} aria-expanded={aberto}>
                        {aberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                        <span className="min-w-0 flex-1 truncate font-medium">{i.nome}</span>
                        <span className="font-mono text-xs text-muted-foreground">{i.ref || "sem REF"}</span>
                        {i.estado === "pulado" && i.motivo && <StatusBadge tone="neutral" className="normal-case tracking-normal">{TEXTO_MOTIVO_PULO[i.motivo]}</StatusBadge>}
                        {i.estado === "erro" && <StatusBadge tone="danger" className="normal-case tracking-normal">erro na leitura</StatusBadge>}
                        {(i.estado === "muda" || i.estado === "conflito") && (
                          <span className="text-xs text-muted-foreground">
                            {i.atualizados + i.criados + i.removidos} SKU(s){i.conflitos > 0 ? ` · ${i.conflitos} em conflito` : ""}
                          </span>
                        )}
                      </button>
                      {aberto && (
                        <div className="overflow-x-auto border-t px-3 py-2">
                          {i.estado === "erro" && <p className="text-xs text-destructive">{i.erro?.detalhe || "Não foi possível ler este produto."}</p>}
                          {i.linhas.length === 0 && i.estado !== "erro" && <p className="text-xs text-muted-foreground">Nada muda neste produto.</p>}
                          {i.linhas.length > 0 && (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left uppercase tracking-wide text-muted-foreground">
                                  <th className="py-1 pr-2 font-semibold">Variante · Tamanho</th><th className="py-1 px-2 font-semibold">Antes</th>
                                  <th className="py-1 px-2 font-semibold">Depois</th><th className="py-1 pl-2 font-semibold">Situação</th>
                                </tr>
                              </thead>
                              <tbody>
                                {i.linhas.map((l) => (
                                  <tr key={`${l.varianteKey}|${l.tamanhoKey}`} className="border-t align-top">
                                    <td className="py-1 pr-2">
                                      {l.corNome ? `${l.corNome}${l.apelidoNome ? ` · ${l.apelidoNome}` : ""}` : "Variante fora da grade"} · {rotuloTamanho(l.tamanhoKey, i.tamanhoTipo)}
                                    </td>
                                    <td className="px-2 font-mono">{l.skuDe ?? "—"}</td>
                                    <td className="px-2 font-mono">{l.acao === "sai" ? "removido" : (l.skuPara ?? "—")}</td>
                                    <td className="pl-2">
                                      <StatusBadge tone={TOM_ACAO[l.acao]} className="normal-case tracking-normal">{ROTULO_ACAO_LINHA[l.acao]}</StatusBadge>
                                      {l.acao === "conflito" && l.mensagem && <span className="ml-1 text-muted-foreground">{l.mensagem}</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {lista.length > visiveis && (
                <Button type="button" variant="outline" size="sm" className="max-sm:min-h-11" onClick={() => setVisiveis((v) => v + POR_VEZ)}>
                  Mostrar mais {Math.min(POR_VEZ, lista.length - visiveis)} de {lista.length - visiveis}
                </Button>
              )}
            </>
          )}

          {p.fase === "concluido" && p.resultado && (
            <div className="space-y-3" data-testid="regerar-skus-resumo">
              <p className="text-sm">
                <strong>{p.resultado.resumo.gravados.length}</strong> produto(s) gravado(s) ({p.resultado.resumo.skusGravados} SKU(s)) ·{" "}
                {p.resultado.resumo.desatualizados.length} desatualizado(s) · {p.resultado.resumo.pulados.length} pulado(s) · {p.resultado.resumo.erros.length} com erro
              </p>
              {p.resultado.parou && (
                <div className="space-y-2 rounded-md border border-[var(--warning)] bg-[var(--tone-warning-bg)] p-3 text-sm text-[var(--tone-warning-fg)]" role="alert">
                  <p>
                    {p.resultado.parou === "cancelado" ? "Cancelado." : (p.resultado.textoFalha ?? "A gravação parou.")} Faltam {p.resultado.restantes} produto(s); os já gravados ficam.
                  </p>
                  <Button type="button" size="sm" onClick={p.onContinuarGravacao} className="max-sm:min-h-11">
                    <RefreshCw className="mr-1 h-4 w-4" /> Continuar gravando ({p.resultado.restantes})
                  </Button>
                </div>
              )}
              {p.resultado.resumo.desatualizados.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold">Desatualizados (o produto mudou depois da prévia — nada foi gravado neles)</p>
                  <ul className="text-xs text-muted-foreground">
                    {p.resultado.resumo.desatualizados.map((d) => <li key={d.modeloId}>{d.nome || d.modeloId} <span className="font-mono">{d.ref}</span></li>)}
                  </ul>
                  <Button type="button" variant="outline" size="sm" className="max-sm:min-h-11" onClick={p.onRefazerPrevia}>Refazer a prévia</Button>
                </div>
              )}
              {p.resultado.resumo.erros.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-destructive">Produtos com erro (não gravaram; os outros seguiram)</p>
                  <ul className="text-xs text-muted-foreground">
                    {p.resultado.resumo.erros.map((e) => <li key={e.modeloId}>{e.nome || e.modeloId} <span className="font-mono">{e.ref}</span> — {e.erro?.detalhe || "erro desconhecido"}</li>)}
                  </ul>
                </div>
              )}
              {p.resultado.resumo.pulados.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Pulados na hora de gravar (o estado mudou desde a prévia): {p.resultado.resumo.pulados.map((x) => `${x.nome || x.modeloId} (${x.motivo ? TEXTO_MOTIVO_PULO[x.motivo] : "pulado"})`).join(", ")}
                </p>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter className={RODAPE}>
          {emCurso ? (
            <Button type="button" variant="outline" onClick={p.onCancelar} className="max-sm:min-h-11">Cancelar</Button>
          ) : (
            <Button type="button" variant="outline" onClick={p.onFechar} className="max-sm:min-h-11">
              <ArrowLeft className="mr-1 h-4 w-4" /> {p.fase === "concluido" ? "Fechar" : "Voltar"}
            </Button>
          )}
          {p.fase === "revisao" && (
            <Button type="button" className="ml-auto max-sm:min-h-11" disabled={p.aGravar.skus === 0} onClick={p.onConfirmar}>
              {emCurso ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
              Regerar {p.aGravar.skus} SKU(s) em {p.aGravar.produtos} produto(s)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
