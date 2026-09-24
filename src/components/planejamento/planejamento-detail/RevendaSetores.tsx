// Blocos de REVENDA do detalhe do Planejamento (Produto Acabado): preço (markups + preços fixos),
// seção "Produto Acabado" (vínculo / criar) e seção "Grade" cor×tamanho. Extraídos na F3.0 (set/2026)
// de `PlanejamentoDetail.tsx` SEM mudança de comportamento: o JSX de cada bloco foi MOVIDO como
// estava; o estado vem de `useRevendaPlanejamento` (prop `rv`) e é desestruturado com os MESMOS nomes
// de antes. Componentes de nível de MÓDULO de propósito — declarados dentro do orquestrador, eles
// remontariam a cada render e o input perderia o foco.
import { ExternalLink, PackagePlus } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/shared/NumberInput";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { brl } from "@/lib/format";
import { varianteLabel } from "@/lib/variante";
import { type PrecoInfo } from "@/lib/preco";
import { type Draft } from "@/components/planejamento/modelo-shared";
import { Secao, CampoRO } from "@/components/planejamento/planejamento-detail/campos";
import { type RevendaPlanejamento } from "@/components/planejamento/planejamento-detail/useRevendaPlanejamento";

/** Seção "Preço" do card REVENDA (ramo `isRevenda` do orquestrador). */
export function PrecoRevendaBloco({ rv, custoReal, piRevenda, draft }: {
  rv: RevendaPlanejamento; custoReal: boolean; piRevenda: PrecoInfo; draft: Draft;
}) {
  const {
    produtoRevenda, produtoRevendaLoading,
    markupAtacadoInput, setMarkupAtacadoInput, markupVarejoInput, setMarkupVarejoInput,
    markupAtacadoBaseRef, markupVarejoBaseRef, salvarMarkupsRevenda,
    precoAtacadoDraft, setPrecoAtacadoDraft, precoVarejoDraft, setPrecoVarejoDraft, salvarPrecosFixoRevenda,
  } = rv;
  return (
              <div className="grid sm:grid-cols-2 gap-3">
                {/* Cadeia íntegra da revenda (base = custo previsto + M.O.; ver `piRevenda`):
                    Custo → Preço (custo × markup da linha) → Preço sugerido (derivado). */}
                <CampoRO label={custoReal ? "Custo (real)" : "Custo (previsto)"} value={piRevenda.custo > 0 ? brl(piRevenda.custo) : "—"} />
                <CampoRO label="Markup (linha)" value={piRevenda.markupAplicado > 0 ? piRevenda.markupAplicado.toLocaleString("pt-BR") : "—"} />
                <CampoRO label="Preço" value={piRevenda.preco > 0 ? brl(piRevenda.preco) : "—"} />
                <CampoRO label="Preço sugerido" value={piRevenda.sugerido > 0 ? brl(piRevenda.sugerido) : "—"} />
                {produtoRevenda ? (
                  <>
                    <div className="grid gap-1">
                      <Label>Markup atacado</Label>
                      <div className="relative">
                        {/* value = markup EFETIVO (gravado OU derivado do preço — re-semeado no topo).
                            onBlur SÓ salva se o valor MUDOU vs o efetivo anterior (`markupAtacadoBaseRef`)
                            — senão está só exibindo o derivado e salvar destravaria o preço à toa.
                            Editar markup grava markup (o banco limpa o preço fixo → preço deriva). */}
                        <NumberInput
                          blankZero
                          placeholder="2,50"
                          className="pr-6"
                          value={markupAtacadoInput ?? 0}
                          onChange={(e) => setMarkupAtacadoInput(Number(e.target.value) > 0 ? Number(e.target.value) : null)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                          onBlur={() => { if (markupAtacadoInput !== markupAtacadoBaseRef.current) salvarMarkupsRevenda.mutate({ markup_atacado: markupAtacadoInput, markup_varejo: markupVarejoInput }); }}
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">×</span>
                      </div>
                    </div>
                    <div className="grid gap-1">
                      <Label>Markup varejo</Label>
                      <div className="relative">
                        <NumberInput
                          blankZero
                          placeholder="2,50"
                          className="pr-6"
                          value={markupVarejoInput ?? 0}
                          onChange={(e) => setMarkupVarejoInput(Number(e.target.value) > 0 ? Number(e.target.value) : null)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                          onBlur={() => { if (markupVarejoInput !== markupVarejoBaseRef.current) salvarMarkupsRevenda.mutate({ markup_atacado: markupAtacadoInput, markup_varejo: markupVarejoInput }); }}
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">×</span>
                      </div>
                    </div>
                    {/* Preços EDITÁVEIS = preço FIXO (set/2026, sem derivar do markup): o que se EXIBE
                        em repouso é o preço REAL do modelo (`draft.preco_atacado`/`preco_venda`, já
                        fixo-ou-derivado pelo servidor) — NÃO mais o derivado do markup, que mostraria
                        valor errado quando há preço fixo. onChange só guarda o texto num rascunho local;
                        o save (onBlur/Enter) manda o número EXATO à RPC `salvar_precos_fixo_...`, tocando
                        SÓ o canal do campo. Vazio/≤0 = null = DESTRAVA (volta a derivar do markup).
                        Só dispara se o valor mudou vs o preço real atual (evita salvar à toa). */}
                    <div className="grid gap-1">
                      <Label>Preço atacado</Label>
                      <MoneyInput
                        fixedDecimals
                        value={precoAtacadoDraft}
                        placeholder="0,00"
                        onChange={(e) => setPrecoAtacadoDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                        onBlur={() => {
                          const n = Number(precoAtacadoDraft) || 0;
                          const novo = n > 0 ? n : null;
                          const atual = draft.preco_atacado ?? null;
                          if (novo === atual) return;
                          salvarPrecosFixoRevenda.mutate({ tocarAtacado: true, precoAtacado: novo, tocarVarejo: false, precoVarejo: null });
                        }}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label>Preço varejo</Label>
                      <MoneyInput
                        fixedDecimals
                        value={precoVarejoDraft}
                        placeholder="0,00"
                        onChange={(e) => setPrecoVarejoDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                        onBlur={() => {
                          const n = Number(precoVarejoDraft) || 0;
                          const novo = n > 0 ? n : null;
                          const atual = draft.preco_venda ?? null;
                          if (novo === atual) return;
                          salvarPrecosFixoRevenda.mutate({ tocarVarejo: true, precoVarejo: novo, tocarAtacado: false, precoAtacado: null });
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground sm:col-span-2">
                    {produtoRevendaLoading ? "Carregando…" : "Crie o produto acabado (abaixo) para definir os markups de preço."}
                  </p>
                )}
              </div>
  );
}

/** Seção "Produto Acabado" do card revenda: vínculo (atalho ⧉) ou "Criar produto acabado". */
export function ProdutoAcabadoSecao({ rv, contexto, modeloId, navigate, numero }: {
  rv: RevendaPlanejamento; contexto: "planejamento" | "produto-acabado"; modeloId: string | null;
  navigate: ReturnType<typeof useNavigate>; numero?: number;
}) {
  const { produtoRevenda, produtoRevendaLoading, criarProdutoAcabado } = rv;
  return (
            <Secao id="produto_acabado" titulo="Produto Acabado" numero={numero} defaultOpen={false}>
              {produtoRevendaLoading ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : produtoRevenda ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-muted-foreground">Este modelo está vinculado a um produto de revenda.</p>
                  {contexto !== "produto-acabado" && (
                    <Button
                      type="button" variant="outline" size="sm" className="ml-auto gap-1.5"
                      onClick={() => navigate({ to: "/criacao/produto-acabado", search: produtoRevenda.colecao_id ? ({ colecao: produtoRevenda.colecao_id } as any) : ({} as any) })}
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Ver no Produto Acabado
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-muted-foreground">Nenhum produto de revenda vinculado ainda.</p>
                  <Button
                    type="button" variant="outline" size="sm" className="ml-auto gap-1.5"
                    onClick={() => criarProdutoAcabado.mutate()}
                    disabled={criarProdutoAcabado.isPending || !modeloId}
                  >
                    <PackagePlus className="h-3.5 w-3.5" /> Criar produto acabado
                  </Button>
                </div>
              )}
            </Secao>
  );
}

/** Seção "Grade" cor×tamanho do card revenda (lê/grava `modelo_grades` pelo Salvar da página). */
export function GradeRevendaSecao({ rv, numero }: { rv: RevendaPlanejamento; numero?: number }) {
  const {
    gradeRevenda, variantesRevenda, tamanhosRevenda,
    setCelulaGradeRevenda, totalLinhaRevenda, totalColunaRevenda, totalGeralRevenda,
  } = rv;
  return (
            <Secao id="grade_revenda" titulo="Grade" numero={numero} defaultOpen={false}>
              {variantesRevenda.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  O produto vinculado ainda não tem variantes de cor — cadastre-as no Produto Acabado.
                </p>
              ) : tamanhosRevenda.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Defina a proporção de tamanhos deste produto no Produto Acabado antes de preencher a grade.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="px-3 py-2">Variante</th>
                        {tamanhosRevenda.map((t) => <th key={t} className="px-3 py-2 text-right">{t}</th>)}
                        <th className="px-3 py-2 text-right font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variantesRevenda.map((v) => (
                        <tr key={v.ordem} className="border-t">
                          <td className="px-3 py-2">{varianteLabel({ cor: v.cor?.nome, apelido: v.apelido?.nome })}</td>
                          {tamanhosRevenda.map((t) => (
                            <td key={t} className="px-3 py-1.5 text-right">
                              <NumberInput
                                integer
                                blankZero
                                placeholder="0"
                                className="h-8 w-20 text-right ml-auto"
                                value={gradeRevenda[v.ordem]?.[t] ?? 0}
                                data-colab-path={`grade-revenda:${v.ordem}:${t}`}
                                onChange={(e) => setCelulaGradeRevenda(v.ordem, t, Number(e.target.value) || 0)}
                              />
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{totalLinhaRevenda(v.ordem)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/30 font-medium">
                        <td className="px-3 py-2">Total</td>
                        {tamanhosRevenda.map((t) => <td key={t} className="px-3 py-2 text-right tabular-nums">{totalColunaRevenda(t)}</td>)}
                        <td className="px-3 py-2 text-right tabular-nums">{totalGeralRevenda}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Secao>
  );
}
