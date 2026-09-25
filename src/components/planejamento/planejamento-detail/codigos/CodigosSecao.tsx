// Seção "4. Códigos" do Sheet do Planejamento (F3.6 — spec 2026-09-25 §5.1; F3.5b da spec do SKU §4.3).
// L1: REF (o MESMO campo que saiu da seção 3 — aparece a partir da etapa configurada, `refVisivel`, e só o INPUT trava com
// `refEditavel`, como hoje; sem aviso de campos do Dev nesta seção — R29) · "Tamanho em" (rádio Letra | Número SEM padrão
// da LOJA — nada na Config; decisão P-25 do dono 25/set 14:57: todo produto NASCE marcado em Letra e pode trocar p/
// Número, legado migra p/ Letra no banco; Draft → `modelos.tamanho_tipo`, grava no Salvar — R10) · "Regerar SKUs"
// (AlertDialog; nunca muda os editados à mão; travado com REF/"Tamanho em" digitados e diferentes do que está SALVO,
// senão regeraria com um valor que o servidor nem tem — rodada 2, Important). Tabela "SKUs por variante e tamanho":
// o SKU GRAVADO (editável à mão — RPC imediata `salvar_sku_manual` com `_rev_base`, fora do Salvar da página; NÃO
// trava depois da Explosão — spec SKU §4.2; validação LOCAL inválida OU falha NA RPC devolvem o campo ao valor do
// servidor — rodada 2, Minor 3/5) e a situação de cada linha. Geração e leitura 100% no servidor (F3.5a + Task 6;
// status desconhecido = fail-closed); regras de exibição puras em ./sku-card.ts; siglas do rótulo por consulta
// própria (`useSiglasCores` — R11).
import { Fragment, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { Draft } from "@/components/planejamento/modelo-shared";
import {
  agruparPorVariante, avisoSku, rotuloTamanho, rotuloVariante, siglasDoGrupo, situacaoSku, skuDigitadoParaSalvar, type LinhaSku,
} from "./sku-card";
import { useSiglasCores, type SkusModelo } from "./useSkusModelo";

// P-25 (dono 25/set) — SEM padrão da LOJA (nada na Config): as 2 opções; o Draft chega aqui já marcado em Letra
// (default de fábrica) e o rádio segue o Draft normalmente.
const TAMANHOS_EM = [{ v: "letra", rotulo: "Letra" }, { v: "numero", rotulo: "Número" }] as const;

// Nível de MÓDULO (não dentro do render): declarado dentro, remontaria a cada render e o input perderia o foco.
function SkuCampo({ linha, editavel, salvando, ariaLabel, onSalvar }: {
  linha: LinhaSku; editavel: boolean; salvando: boolean;
  /** Minor (6) da revisão — variante + tamanho (não a chave crua "34|PPP"), ex.: "SKU — Variante 1 · Marrom · 34". */
  ariaLabel: string;
  /** Minor (3)/rodada 2 — `onSalvar` chama `salvarManual(v, { onError })`; se a RPC recusar (ex.: SKU duplicado),
   *  sku/rev da linha NÃO mudam, então o `useEffect([linha.sku, linha.rev])` abaixo sozinho NÃO dispararia — o
   *  `onError` devolve o campo ao valor gravado explicitamente. */
  onSalvar: (sku: string, onErro: () => void) => void;
}) {
  const [texto, setTexto] = useState(linha.sku ?? "");
  // Recarregou do servidor (salvou / regerou / outra pessoa): o campo acompanha.
  useEffect(() => { setTexto(linha.sku ?? ""); }, [linha.sku, linha.rev]);
  const voltarAoServidor = () => setTexto(linha.sku ?? "");
  const confirmar = () => {
    const r = skuDigitadoParaSalvar(linha, texto);
    if (r.acao === "salvar") { onSalvar(r.sku, voltarAoServidor); return; }
    // Minor (5) — inválido OU sem mudança real (validação LOCAL, antes de ir ao servidor): o campo volta ao valor
    // GRAVADO no servidor (`linha.sku`), nunca fica preso no texto digitado que falhou.
    if (r.acao === "erro") toast.error(r.erro);
    voltarAoServidor();
  };
  return (
    <Input
      className="h-8 w-full min-w-0 font-mono text-xs"
      value={texto}
      placeholder={linha.sku_previsto ?? ""}
      disabled={!editavel || salvando}
      aria-label={ariaLabel}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
      data-colab-path={`sku:${linha.variante_key}:${linha.tamanho_key}`}
    />
  );
}

export function CodigosSecao({
  draft, setDraftTracked, rotuloRef, refVisivel, refEditavel, refSalva, tamanhoTipoSalvo, skus, podeVerSkus, podeEditarSkus,
}: {
  draft: Draft;
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  rotuloRef: string;
  /** A REF aparece a partir da etapa configurada (`refCampoVisivel`; posição DERIVADA com a chave ligada — inv. #11). */
  refVisivel: boolean;
  /** = `refEditavel` do orquestrador (isEdit && !devBloqueado && refVisivel) — o MESMO que põe a REF no payload. */
  refEditavel: boolean;
  /** Minor (4) — REF/"Tamanho em" tal como o SERVIDOR os tem agora (`modeloData`), p/ comparar com o Draft e travar
   *  o Regerar quando há algo digitado e ainda não salvo (o Regerar usa o que está SALVO, não o rascunho). */
  refSalva: string;
  tamanhoTipoSalvo: "letra" | "numero";
  skus: SkusModelo;
  /** Ver SKUs = ver o Planejamento; editar/Regerar = editar o Planejamento (spec SKU §4.4 — o servidor confere). */
  podeVerSkus: boolean;
  podeEditarSkus: boolean;
}) {
  const [confirmarRegerar, setConfirmarRegerar] = useState(false);
  const m = skus.matriz;
  const grupos = m ? agruparPorVariante(m.linhas) : [];
  // SKU editável = matriz ok + o SERVIDOR já decidiu o "Tamanho em" deste card + editar o Planejamento. NÃO depende
  // da trava do Dev/Explosão (spec SKU §4.2; R29). Minor (2) da rodada 2 — mesma guarda `tamanho_tipo_card !== null`
  // de `deveGerarPrimeiraVez` (sku-card.ts): rede p/ deploy fora de ordem/volta de emergência (a coluna ainda NULL
  // no banco não deveria destravar Regerar/input aqui também).
  const editavel = !!m && m.status === "ok" && m.tamanho_tipo_card !== null && podeEditarSkus;
  // Minor (4)/rodada 2 (Important) — REF ou "Tamanho em" digitados e diferentes do que está SALVO: Regerar usaria
  // valores que o servidor ainda não tem (o AlertDialog já avisa que recalcula pelo que está "SALVO agora") — trava
  // até o próximo Salvar. `refSalva` vem de `modeloData.ref`, que o SERVIDOR guarda APARADO (`helpers.ts` faz
  // `.trim()` antes do payload); `draft.ref` continua CRU de propósito (o usuário pode estar digitando) — comparar
  // os dois crus travaria pra sempre uma REF salva com espaço nas pontas. Compara os dois aparados.
  const draftSujoParaRegerar = (draft.ref ?? "").trim() !== (refSalva ?? "").trim() || draft.tamanho_tipo !== tamanhoTipoSalvo;
  const siglas = useSiglasCores(podeVerSkus);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        {refVisivel ? (
          <div className="grid gap-1">
            <Label htmlFor="codigos-ref">{rotuloRef}</Label>
            <Input
              id="codigos-ref"
              className="font-mono"
              value={draft.ref}
              // R29 — só o INPUT trava (enviado à Explosão / sem permissão do Dev), como hoje; sem aviso nesta seção.
              disabled={!refEditavel}
              onChange={(e) => setDraftTracked((d) => ({ ...d, ref: e.target.value }))}
              data-colab-path="ref"
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">A {rotuloRef} aparece a partir da etapa configurada na Config da Loja.</p>
        )}
        {/* P-25 (dono 25/set 14:57) — SEM padrão da LOJA: o Draft já chega marcado em Letra (default de fábrica); dá
            p/ trocar p/ Número. Rádio nativo (não há RadioGroup em ui/, que não se edita): grupo rotulado; alvo de
            toque 44px no mobile. */}
        <div className="grid gap-1" role="radiogroup" aria-labelledby="codigos-tamanho-em" data-colab-path="tamanho_tipo">
          <Label id="codigos-tamanho-em">
            Tamanho em <span className="font-normal text-muted-foreground">· nasce em Letra; troque para Número se o produto usa numeração</span>
          </Label>
          <div className="flex min-h-9 items-center gap-4 text-sm">
            {TAMANHOS_EM.map((o) => (
              <label key={o.v} className="flex cursor-pointer items-center gap-1.5 max-sm:min-h-11">
                <input
                  type="radio"
                  name="codigos-tamanho-em"
                  value={o.v}
                  className="h-4 w-4 accent-primary"
                  checked={draft.tamanho_tipo === o.v}
                  onChange={() => setDraftTracked((d) => ({ ...d, tamanho_tipo: o.v }))}
                />
                {o.rotulo}
              </label>
            ))}
          </div>
        </div>
        {podeVerSkus && (
          <Button type="button" variant="outline" size="sm" className="max-sm:min-h-11"
            disabled={!editavel || skus.regerando || draftSujoParaRegerar}
            title={draftSujoParaRegerar ? "Salve o card antes de regerar" : undefined}
            onClick={() => setConfirmarRegerar(true)}>
            <RefreshCw className="mr-1 h-4 w-4" /> Regerar SKUs
          </Button>
        )}
      </div>

      {podeVerSkus && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">SKUs por variante e tamanho</p>
          {skus.carregando ? (
            <p className="text-sm text-muted-foreground">Carregando os SKUs…</p>
          ) : skus.erro ? (
            <p className="text-sm text-destructive">Não foi possível carregar os SKUs — recarregue a página.</p>
          ) : !m ? null : m.linhas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {m.status === "sem_formato" ? (
                <>A loja ainda não tem o Formato do SKU — <Link to="/admin/configuracoes" className="underline">configurar na Config da Loja</Link>.</>
              ) : m.status === "aguardando_ref" ? (
                `Os SKUs são gerados quando o card tiver ${rotuloRef} (salve o card depois que ela aparecer).`
              ) : m.status === "sem_tamanho" ? (
                // P-25 — só card LEGADO antes da migration T6 rodar (todo produto novo já nasce em Letra); não é
                // mais uma escolha pendente do usuário, então o texto não fala em "escolha".
                "Este card é de antes da migração do “Tamanho em” — salve o card para atualizá-lo e gerar os SKUs."
              ) : m.status === "desconhecido" ? (
                "Não foi possível ler a situação dos SKUs — recarregue a página."
              ) : (
                "Sem linhas: preencha a Grade (variantes do Tecido 1 × tamanhos com quantidade)."
              )}
            </p>
          ) : (
            <div className="overflow-x-auto">
              {/* R23 — SKUs já gravados num card LEGADO (P-25: sem "Tamanho em" só existe em card de antes da
                  migração): a tabela mostra os gravados; gerar/regerar espera o Salvar que atualiza o card. */}
              {m.status === "sem_tamanho" && (
                <p className="mb-2 text-xs text-muted-foreground">Card de antes da migração do “Tamanho em” — salve o card para gerar ou regerar os SKUs.</p>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-3 font-semibold">Variante / Tamanho</th>
                    <th className="py-1.5 px-2 font-semibold">SKU</th>
                    <th className="py-1.5 pl-2 font-semibold">Situação</th>
                  </tr>
                </thead>
                <tbody className="align-middle">
                  {grupos.map((g) => {
                    const rotuloVar = rotuloVariante(g, siglasDoGrupo(g, siglas.cores, siglas.apelidos));
                    return (
                    <Fragment key={g.chave}>
                      <tr className="bg-muted/40">
                        <td colSpan={3} className="py-1.5 px-2 text-xs font-semibold text-muted-foreground">{rotuloVar}</td>
                      </tr>
                      {g.linhas.map((l) => {
                        const sit = situacaoSku(l);
                        const aviso = avisoSku(l);
                        const chave = `${l.variante_key}|${l.tamanho_key}`;
                        const rotuloTam = rotuloTamanho(l.tamanho_key, m.tamanho_tipo);
                        return (
                          <tr key={chave} className="border-t">
                            <td className="py-2 pr-3 pl-4 whitespace-nowrap">{rotuloTam}</td>
                            <td className="py-2 px-2 min-w-40">
                              <SkuCampo
                                linha={l}
                                editavel={editavel && l.estado !== "orfa"}
                                salvando={skus.salvandoChave === chave}
                                // Minor (6) — variante + tamanho, não a chave crua (ex.: "SKU — Variante 1 · Marrom · 34").
                                ariaLabel={`SKU — ${rotuloVar} · ${rotuloTam}`}
                                onSalvar={(sku, onErro) => skus.salvarManual(
                                  { id: l.id, sku, rev: l.rev, varianteKey: l.variante_key, tamanhoKey: l.tamanho_key },
                                  { onError: onErro },
                                )}
                              />
                            </td>
                            <td className="py-2 pl-2 text-xs">
                              <span className="inline-flex flex-wrap items-center gap-1">
                                {sit.tom === "neutral" ? (
                                  <span className="text-muted-foreground">{sit.texto}</span>
                                ) : (
                                  <StatusBadge tone={sit.tom} className="normal-case tracking-normal">{sit.texto}</StatusBadge>
                                )}
                                {sit.cadastrar && <Link to="/cadastro/atributos" className="underline">cadastrar</Link>}
                              </span>
                              {aviso && (
                                <span className="mt-1 block text-muted-foreground">
                                  {aviso} — <Link to="/cadastro/atributos" className="underline">cadastrar</Link>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">As variantes vêm do Tecido 1 (seção Tecidos) e os tamanhos, da Grade. Formato: REF - cor base + apelido + tamanho (Config da Loja › Formato do SKU). 'Regerar SKUs' pede confirmação e nunca muda os editados à mão.</p>
        </div>
      )}

      <AlertDialog open={confirmarRegerar} onOpenChange={setConfirmarRegerar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regerar os SKUs?</AlertDialogTitle>
            <AlertDialogDescription>
              Os SKUs automáticos são recalculados pelo Formato do SKU, pelas siglas e pelo “Tamanho em” SALVOS agora. SKUs editados à mão não mudam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmarRegerar(false); skus.regerar(); }}>Regerar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
