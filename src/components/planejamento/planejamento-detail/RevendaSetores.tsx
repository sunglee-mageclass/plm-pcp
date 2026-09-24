// Blocos de PRODUTO COMPRADO do detalhe do Planejamento: preço da revenda (markups + preços fixos), seção "Produto
// Acabado"/"Produto Importado" (vínculo) e seção "Grade" cor×tamanho. Extraídos na F3.0 de `PlanejamentoDetail.tsx` SEM
// mudança de comportamento; F3.4: a grade passa a valer p/ revenda E importado (`useGradeComprado`, decisão F3 #4) e o
// importado ganha a seção do produto. Componentes de nível de MÓDULO de propósito — declarados dentro do orquestrador,
// eles remontariam a cada render e o input perderia o foco.
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
import { type GradeComprado } from "@/components/planejamento/planejamento-detail/useGradeComprado";
import type { ReactNode } from "react";

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

/** F3.4 — Seção "Produto Importado" do card importado (espelho da "Produto Acabado"): vínculo + atalho ⧉. Sem botão de criar —
 *  o Salvar cria o produto sozinho (plano F3.4 D1). MESMA chave de seção `produto_acabado` (numeração/abertura). */
export function ProdutoImportadoSecao({ gc, numero, navigate }: {
  gc: GradeComprado; numero?: number; navigate: ReturnType<typeof useNavigate>;
}) {
  return (
            <Secao id="produto_acabado" titulo="Produto Importado" numero={numero} defaultOpen={false}>
              {gc.produtoLoading ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : gc.produto ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-muted-foreground">Este modelo está vinculado a um produto importado.</p>
                  <Button
                    type="button" variant="outline" size="sm" className="ml-auto gap-1.5"
                    onClick={() => navigate({ to: "/criacao/produto-importado", search: gc.produto?.colecao_id ? ({ colecao: gc.produto.colecao_id } as any) : ({} as any) })}
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Ver no Produto Importado
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum produto importado vinculado ainda. Ao salvar (com Grupo e Categoria preenchidos), o sistema cria o produto no Produto Importado — câmbio, variantes e etapas você completa lá.
                </p>
              )}
            </Secao>
  );
}

/** Seção "Grade" cor×tamanho do card COMPRADO (revenda e importado — F3.4, decisão F3 #4: a fonte ÚNICA da grade do
 *  comprado). Edita o rascunho de `useGradeComprado`; o Salvar grava (revenda: `salvar_grade_revenda`; importado: junto
 *  com o BOM — plano F3.4 §3). `motivoSomenteLeitura`: texto do porquê de não editar (ou null = editável). */
export function GradeRevendaSecao({ gc, numero, selo, motivoSomenteLeitura = null }: {
  gc: GradeComprado; numero?: number; selo?: ReactNode; motivoSomenteLeitura?: string | null;
}) {
  const {
    origem, produto, produtoLoading, produtoError, gradeRevenda, variantesRevenda, tamanhosRevenda,
    setCelulaGradeRevenda, totalLinhaRevenda, totalColunaRevenda, totalGeralRevenda,
  } = gc;
  const tela = origem === "importado" ? "Produto Importado" : "Produto Acabado";
  return (
            <Secao id="grade_revenda" titulo="Grade" numero={numero} selo={selo} defaultOpen={false}>
              {/* Fix round T7 (M1) — esta seção NÃO tinha o ramo `produtoLoading`/erro (só `ProdutoImportadoSecao`
                  tinha, ~:171); acrescentado no MESMO padrão: "Carregando…" enquanto a query de `useGradeComprado`
                  não resolveu, e um texto PT distinto em caso de FALHA (a query lançou) — "sem produto" (não
                  carregando, sem erro, `produto===null`) é um estado válido (card ainda sem OC), diferente de "a
                  busca falhou" (precisa recarregar, não criar). */}
              {produtoLoading ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : produtoError ? (
                <p className="text-sm text-destructive">Não foi possível carregar o produto vinculado. Recarregue o card e tente de novo.</p>
              ) : !produto ? (
                // Fix round T7 (M3a) — `gc.origem` é a origem SALVA (o produto lido é dela); com o RASCUNHO trocado
                // pra outra origem (Select ainda não salvo), `{tela}` ficaria errado ("Produto Acabado" quando o
                // usuário está prestes a virar Importado, por ex.). `motivoSomenteLeitura` já cobre exatamente esse
                // caso ("Salve a troca de Origem antes de editar a grade.", calculado pelo orquestrador a partir do
                // RASCUNHO) — mostra ELE no lugar do texto genérico de "tela", que só faz sentido quando a origem
                // exibida É a que o usuário está editando.
                <p className="text-sm text-muted-foreground">
                  {motivoSomenteLeitura ?? `Este card ainda não tem produto vinculado. Salve o card (com Grupo e Categoria) para o sistema criá-lo no ${tela}.`}
                </p>
              ) : variantesRevenda.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  O produto vinculado ainda não tem variantes de cor — cadastre-as no {tela}.
                </p>
              ) : tamanhosRevenda.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Defina a proporção de tamanhos deste produto no {tela} antes de preencher a grade.
                </p>
              ) : (
                <>
                  {motivoSomenteLeitura && <p className="text-xs text-muted-foreground">{motivoSomenteLeitura}</p>}
                  <fieldset disabled={!!motivoSomenteLeitura} className="contents">
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
                  </fieldset>
                </>
              )}
            </Secao>
  );
}
