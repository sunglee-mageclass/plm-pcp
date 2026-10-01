// Blocos de PRODUTO COMPRADO do detalhe do Planejamento: preço da revenda (markups + preços fixos), seção "Produto
// Acabado"/"Produto Importado" (vínculo) e seção "Grade" cor×tamanho. Extraídos na F3.0 de `PlanejamentoDetail.tsx` SEM
// mudança de comportamento; F3.4: a grade passa a valer p/ revenda E importado (`useGradeComprado`, decisão F3 #4) e o
// importado ganha a seção do produto. Componentes de nível de MÓDULO de propósito — declarados dentro do orquestrador,
// eles remontariam a cada render e o input perderia o foco.
import { useMemo, useRef } from "react";
import { ExternalLink, PackagePlus, RotateCcw } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/shared/NumberInput";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { brl } from "@/lib/format";
import { markupCanalIntocado } from "@/components/produto-acabado/shared";
import { varianteLabel } from "@/lib/variante";
import { type PrecoInfo } from "@/lib/preco";
import { type Draft } from "@/components/planejamento/modelo-shared";
import { Secao, CampoRO } from "@/components/planejamento/planejamento-detail/campos";
import { precoAnteriorExibido, precoAnteriorOuNull } from "@/components/planejamento/planejamento-detail/helpers";
import { InfoHover } from "@/components/shared/InfoHover";
import {
  DICA_PRECO_ANTERIOR_EDITADO, dicaPrecoAnterior, hoverPrecoAnteriorTravado, precoAnteriorAutomatico, seloPrecoAnterior,
  type VersaoAnteriorInfo,
} from "@/lib/versao-anterior";
import { FalhaVersaoAnterior } from "@/components/shared/FalhaVersaoAnterior";
import { type RevendaPlanejamento } from "@/components/planejamento/planejamento-detail/useRevendaPlanejamento";
import { type GradeComprado } from "@/components/planejamento/planejamento-detail/useGradeComprado";
import { tamanhosVisiveis } from "@/lib/tamanho-exibicao";
import type { TamanhoTipo } from "@/lib/tamanho";
import type { ReactNode } from "react";

/** Seção "Preço" do card REVENDA (ramo `isRevenda` do orquestrador). */
export function PrecoRevendaBloco({ rv, custoReal, piRevenda, draft, blocoMaoObra, obsMaoObra, podeEditarPreco, planBloqueado, precoAnterior, onPrecoAnterior, travaVarejo = false, travaPrecoAnterior = false, versaoAnterior = null, versaoAnteriorCarregando = false, versaoAnteriorErro = false, onTentarVersaoAnterior }: {
  rv: RevendaPlanejamento; custoReal: boolean; piRevenda: PrecoInfo; draft: Draft;
  /** F3.6 (Parte A, opção A do dono) — a MO do comprado entra NO bloco de preço (não é mais seção própria). */
  blocoMaoObra?: ReactNode; obsMaoObra?: ReactNode;
  /** F3.6 (Parte B, ruling 11) — Preço anterior: NULL = automático (P-146/P-158: o da versão anterior; v1 = o varejo gravado); editar =
   *  `criacao_planejamento:preco_venda`; grava no Salvar da página (não pela RPC de preço fixo). */
  podeEditarPreco: boolean; precoAnterior: number | null; onPrecoAnterior: (v: number | null) => void;
  /** P-53 A (fix 1, I-1b/c) — markup atacado/varejo (`salvar_markups_produto_acabado`) e preço fixo
   *  atacado/varejo (`salvar_precos_fixo_produto_acabado`) gravam NA HORA (fora do Salvar da página) — mas
   *  são campos SÓ do Planejamento (nenhum Sheet do Dev antigo os tinha). Sem `podeEditarPlanejamento`, os
   *  4 inputs travam (o slot de M.O., abaixo, fica de fora — é compartilhado, trava própria no orquestrador). */
  planBloqueado: boolean;
  /** Integração (F4, D34/R8) — "Preço de venda" marcado trava o VAREJO (Preço varejo + Markup varejo); "Preço anterior"
   *  marcado trava o anterior. Preço atacado e Markup atacado ficam LIVRES (não vão na API). O banco recusa; aqui só desabilita. */
  travaVarejo?: boolean; travaPrecoAnterior?: boolean;
  /** P-146/P-158 + M4 — mesma regra de PrecoTabela.tsx: v2+ = o VAREJO gravado da versão anterior (vazio = "aguardando
   *  preço da vN"); v1/órfã = o próprio varejo GRAVADO (`draft.preco_venda`, o que o retrato manda). */
  versaoAnterior?: VersaoAnteriorInfo; versaoAnteriorCarregando?: boolean;
  /** I1 (revisão front): falhou SEM dado em cache → mostra a falha + "Tentar de novo" (nunca "…" eterno). */
  versaoAnteriorErro?: boolean; onTentarVersaoAnterior?: () => void;
}) {
  const autoAnterior = precoAnteriorAutomatico(versaoAnterior, draft.preco_venda);
  const seloAnterior = seloPrecoAnterior(precoAnterior, autoAnterior);
  const carregandoAnterior = versaoAnteriorCarregando && precoAnterior === null;
  const falhaAnterior = versaoAnteriorErro && precoAnterior === null; // sem o automático: "—" + falha com "Tentar de novo"
  const exibidoAnterior = precoAnteriorExibido(precoAnterior, autoAnterior.valor ?? 0);
  const {
    produtoRevenda, produtoRevendaLoading,
    markupAtacadoInput, setMarkupAtacadoInput, markupVarejoInput, setMarkupVarejoInput,
    markupAtacadoBaseRef, markupVarejoBaseRef, enviadoAtacadoRef, enviadoVarejoRef, salvarMarkupsRevenda,
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
                          // P-53 A (fix 1, I-1b): grava na hora via salvar_markups_produto_acabado — SÓ do Planejamento.
                          disabled={planBloqueado || salvarMarkupsRevenda.isPending}
                          onChange={(e) => setMarkupAtacadoInput(Number(e.target.value) > 0 ? Number(e.target.value) : null)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                          onBlur={() => { if (markupAtacadoInput !== markupAtacadoBaseRef.current) salvarMarkupsRevenda.mutate({ markup_atacado: markupAtacadoInput, markup_varejo: markupCanalIntocado(produtoRevenda?.markup_varejo, markupVarejoInput, enviadoVarejoRef.current) }); }}
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
                          // P-53 A (fix 1, I-1b): mesma trava do markup atacado acima + Integração (D34/R8).
                          disabled={planBloqueado || travaVarejo || salvarMarkupsRevenda.isPending}
                          onChange={(e) => setMarkupVarejoInput(Number(e.target.value) > 0 ? Number(e.target.value) : null)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                          onBlur={() => { if (markupVarejoInput !== markupVarejoBaseRef.current) salvarMarkupsRevenda.mutate({ markup_atacado: markupCanalIntocado(produtoRevenda?.markup_atacado, markupAtacadoInput, enviadoAtacadoRef.current), markup_varejo: markupVarejoInput }); }}
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">×</span>
                      </div>
                    </div>
                    {/* F3.6 (ruling 11, R17; M2 — revisão Opus fix1): Preço anterior em linha própria, na posição do
                        brief (Step 4.3) — logo ANTES do par atacado/varejo, DEPOIS dos Markups; acompanha o VAREJO. */}
                    {podeEditarPreco && !travaPrecoAnterior ? (
                      <div className="grid gap-1 sm:col-span-2">
                        <div className="flex items-center gap-1.5">
                          <Label htmlFor="preco-anterior-revenda">Preço anterior</Label>
                          {!carregandoAnterior && !falhaAnterior && (
                            <StatusBadge tone={seloAnterior.tom} className="rounded-full px-2 py-0.5 normal-case tracking-normal">
                              {seloAnterior.texto}
                            </StatusBadge>
                          )}
                        </div>
                        <div className="flex items-center gap-1 sm:max-w-xs">
                          {/* M3 (fix1) — 44px no celular, como a lixeira de PrecoTabela.tsx. */}
                          <Button type="button" variant="ghost" size="iconSm" className="text-muted-foreground max-sm:h-11 max-sm:w-11" disabled={precoAnterior === null}
                            aria-label="Preço anterior: voltar ao automático" title="Voltar ao automático" onClick={() => onPrecoAnterior(null)}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                          <MoneyInput
                            id="preco-anterior-revenda"
                            fixedDecimals
                            aria-label="Preço anterior"
                            className="min-w-0 flex-1"
                            // M1 (fix1) — 0/negativo volta ao automático NA TELA (não só no payload); evita "editado · 0,00".
                            value={carregandoAnterior || falhaAnterior ? "" : exibidoAnterior ?? ""}
                            placeholder={carregandoAnterior ? "…" : (falhaAnterior || autoAnterior.aguardando) && precoAnterior === null ? "—" : "0,00"}
                            data-colab-path="preco_anterior"
                            onChange={(e) => onPrecoAnterior(precoAnteriorOuNull(e.target.value))}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">{precoAnterior !== null ? DICA_PRECO_ANTERIOR_EDITADO : carregandoAnterior ? "…" : falhaAnterior && onTentarVersaoAnterior ? <FalhaVersaoAnterior onTentar={onTentarVersaoAnterior} /> : dicaPrecoAnterior(autoAnterior)}</p>
                      </div>
                    ) : (
                      <div className="sm:col-span-2 sm:max-w-xs">
                        <div className="flex items-center gap-1.5">
                          <CampoRO label="Preço anterior" value={carregandoAnterior ? "…" : falhaAnterior ? "—" : exibidoAnterior != null ? brl(exibidoAnterior) : "—"} />
                          {falhaAnterior && onTentarVersaoAnterior && <FalhaVersaoAnterior onTentar={onTentarVersaoAnterior} />}
                          {!carregandoAnterior && !falhaAnterior && (
                            <StatusBadge tone={seloAnterior.tom} className="rounded-full px-2 py-0.5 normal-case tracking-normal">
                              {seloAnterior.texto}
                            </StatusBadge>
                          )}
                          {/* Ruling da revisão (Task 21): travado + automático — mesmo aviso de PrecoTabela.tsx. */}
                          {travaPrecoAnterior && precoAnterior === null && !carregandoAnterior && !falhaAnterior && (
                            <InfoHover ariaLabel="Preço anterior travado pela Integração">
                              <p>{hoverPrecoAnteriorTravado(autoAnterior)}</p>
                            </InfoHover>
                          )}
                        </div>
                      </div>
                    )}
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
                        // P-53 A (fix 1, I-1c): grava na hora via salvar_precos_fixo_produto_acabado — SÓ do Planejamento.
                        disabled={planBloqueado}
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
                        // P-53 A (fix 1, I-1c): mesma trava do preço atacado acima + Integração (D34/R8).
                        disabled={planBloqueado || travaVarejo}
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
                {/* F3.6 (R17) — M.O. no fim do bloco de preço da revenda (a revenda não tem parte "Custos" depois dos preços). */}
                {blocoMaoObra && (
                  <div className="space-y-2 border-t pt-3 sm:col-span-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mão de obra</p>
                    {blocoMaoObra}
                    {obsMaoObra}
                  </div>
                )}
              </div>
  );
}

/** Seção "Produto Acabado" do card revenda: vínculo (atalho ⧉) ou "Criar produto acabado". */
export function ProdutoAcabadoSecao({ rv, contexto, modeloId, navigate, numero, podeAcoesPlanejamento }: {
  rv: RevendaPlanejamento; contexto: "planejamento" | "produto-acabado"; modeloId: string | null;
  navigate: ReturnType<typeof useNavigate>; numero?: number;
  /** P-53 A (fix 1, I-1d) — criar o espelho Produto Acabado é ação de ciclo do Planejamento (mesma família de
   *  Excluir/Duplicar/Lançar); sem a permissão, o botão nem aparece (como as demais ações escondidas). */
  podeAcoesPlanejamento: boolean;
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
                  {podeAcoesPlanejamento && (
                    <Button
                      type="button" variant="outline" size="sm" className="ml-auto gap-1.5"
                      onClick={() => criarProdutoAcabado.mutate()}
                      disabled={criarProdutoAcabado.isPending || !modeloId}
                    >
                      <PackagePlus className="h-3.5 w-3.5" /> Criar produto acabado
                    </Button>
                  )}
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
              {/* Fix minors (item 3) — ganha o MESMO ramo de erro do `GradeRevendaSecao` (Fix round T7, M1): sem ele,
                  a query de `gc.produto` falhando caía direto no ramo "sem produto ainda" (`!gc.produto`) — texto
                  errado (convida a "salvar para criar" quando na verdade é a CONSULTA que falhou, não "não existe
                  ainda"; um Salvar nesse estado tentaria criar um 2º produto por cima de um que pode já existir). */}
              {gc.produtoLoading ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : gc.produtoError ? (
                <p className="text-sm text-destructive">Não foi possível carregar o produto vinculado. Recarregue o card e tente de novo.</p>
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
export function GradeRevendaSecao({ gc, numero, selo, motivoSomenteLeitura = null, motivoSemProduto = null, tamanhoTipo }: {
  gc: GradeComprado; numero?: number; selo?: ReactNode; motivoSomenteLeitura?: string | null;
  /** Fix minors (M1) — motivo do "sem produto vinculado" QUANDO ele realmente impede criar o produto por aqui (ex.:
   *  ficha travada no importado). `null`/omitido = mantém o texto genérico "salve para criar" — cobre o caso comum
   *  (card recém-criado, sem OC ainda) E a troca de Origem pendente (é O PRÓPRIO Salvar do Planejamento que cria o
   *  produto ali, sem depender do Dev — mostrar "editar a grade" seria enganoso, ver `PlanejamentoDetail.tsx`). */
  motivoSemProduto?: string | null;
  /** P-120 A (plano `2026-09-29-tamanho-em`, Tarefa 7; fix M-3 da revisão) — "Tamanho em" do rascunho
   *  (`draft.tamanho_tipo`): o cabeçalho da grade mostra o LADO escolhido (`tamanhosVisiveis`) em vez da chave
   *  cheia ("34|PPP"), e um par `36|PP` + um solto `PP` deixam de repetir "PP" 2× (M-3: antes só trocava o
   *  RÓTULO, sem filtrar — `tamanhosRevenda` continua sendo a lista completa de `useGradeComprado`; aqui é só
   *  QUAIS colunas renderizam. A CHAVE que `setCelulaGradeRevenda`/`gradeRevenda` usa nunca muda (ressalva #3:
   *  filtro de exibição nunca reduz o que é gravado). */
  tamanhoTipo?: TamanhoTipo | null;
}) {
  const {
    origem, produto, produtoLoading, produtoError, gradeRevenda, variantesRevenda, tamanhosRevenda,
    setCelulaGradeRevenda, totalLinhaRevenda, totalColunaRevenda, totalGeralRevenda,
  } = gc;
  const tela = origem === "importado" ? "Produto Importado" : "Produto Acabado";
  // Fix M-3 — mesma receita do `ModeloGradeSection` (M-1): `comValor` ACUMULATIVO (nunca encolhe durante a
  // sessão) evita que uma célula esmaecida desmonte no meio da digitação (Backspace até 0). Sem `tamanhoTipo`,
  // `colunasRevenda` cai de volta em `tamanhosRevenda` cheio (byte a byte o de antes desta fix).
  const comValorAcumuladoRef = useRef<Set<string>>(new Set());
  const comValorRevenda = useMemo(() => {
    const s = comValorAcumuladoRef.current;
    for (const t of tamanhosRevenda) {
      for (const v of variantesRevenda) if (Number(gradeRevenda[v.ordem]?.[t]) > 0) { s.add(t); break; }
    }
    return new Set(s);
  }, [tamanhosRevenda, variantesRevenda, gradeRevenda]);
  const colunasRevenda = tamanhoTipo
    ? tamanhosVisiveis(tamanhosRevenda, tamanhoTipo, comValorRevenda)
    : tamanhosRevenda.map((t) => ({ chave: t, rotulo: t, esmaecido: false }));
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
                // usuário está prestes a virar Importado, por ex.).
                // Fix minors (M1, revisão pós-T7) — `motivoSomenteLeitura` cobria ESSE caso, mas também o de ficha
                // travada no importado (enviado à Explosão / sem permissão do Dev) — aí o texto virava "Card enviado
                // à Explosão: a grade do importado trava junto com a ficha…", que fala de EDITAR uma grade que ainda
                // nem existe (sem produto, não há grade pra travar). `motivoSemProduto` (calculado no orquestrador)
                // só chega preenchido quando o motivo REALMENTE impede criar o produto por aqui: a troca de Origem
                // pendente NÃO conta (é o PRÓPRIO Salvar do Planejamento que cria o produto, sem depender do Dev) —
                // nesse caso mantém o "salve para criar" genérico, como no card recém-criado sem OC.
                <p className="text-sm text-muted-foreground">
                  {motivoSemProduto ?? `Este card ainda não tem produto vinculado. Salve o card (com Grupo e Categoria) para o sistema criá-lo no ${tela}.`}
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
                            {colunasRevenda.map(({ chave: t, rotulo, esmaecido }) => (
                              <th key={t} className={`px-3 py-2 text-right ${esmaecido ? "opacity-50" : ""}`}>
                                {rotulo}
                              </th>
                            ))}
                            <th className="px-3 py-2 text-right font-semibold">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {variantesRevenda.map((v) => (
                            <tr key={v.ordem} className="border-t">
                              <td className="px-3 py-2">{varianteLabel({ cor: v.cor?.nome, apelido: v.apelido?.nome })}</td>
                              {colunasRevenda.map(({ chave: t, esmaecido }) => (
                                <td key={t} className={`px-3 py-1.5 text-right ${esmaecido ? "opacity-50" : ""}`}>
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
                            {colunasRevenda.map(({ chave: t, esmaecido }) => (
                              <td key={t} className={`px-3 py-2 text-right tabular-nums ${esmaecido ? "opacity-50" : ""}`}>{totalColunaRevenda(t)}</td>
                            ))}
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
