// Seção "4. Códigos" do Sheet do Planejamento (F3.6 — spec 2026-09-25 §5.1; F3.5b da spec do SKU §4.3).
// L1: REF (o MESMO campo que saiu da seção 3 — aparece a partir da etapa configurada, `refVisivel`, e só o INPUT trava com
// `refEditavel`, como hoje; sem aviso de campos do Dev nesta seção — R29) · "Tamanho em" (rádio Letra | Número SEM padrão da loja — nasce
// sem escolha e é obrigatório p/ GERAR os SKUs; Draft → `modelos.tamanho_tipo`, grava no Salvar — R10) · "Regerar SKUs"
// (AlertDialog; nunca muda os editados à mão). Tabela "SKUs por variante e tamanho": o SKU GRAVADO (editável à mão — RPC
// imediata `salvar_sku_manual` com `_rev_base`, fora do Salvar da página; NÃO trava depois da Explosão — spec SKU §4.2) e a
// situação de cada linha. Geração e leitura 100% no servidor (F3.5a + Task 6); regras de exibição puras em ./sku-card.ts;
// siglas do rótulo por consulta própria (`useSiglasCores` — R11).
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

// R10 — SEM padrão da loja: as 2 opções; nenhuma marcada enquanto `tamanho_tipo` é NULL.
const TAMANHOS_EM = [{ v: "letra", rotulo: "Letra" }, { v: "numero", rotulo: "Número" }] as const;

// Nível de MÓDULO (não dentro do render): declarado dentro, remontaria a cada render e o input perderia o foco.
function SkuCampo({ linha, editavel, salvando, onSalvar }: {
  linha: LinhaSku; editavel: boolean; salvando: boolean; onSalvar: (sku: string) => void;
}) {
  const [texto, setTexto] = useState(linha.sku ?? "");
  // Recarregou do servidor (salvou / regerou / outra pessoa): o campo acompanha.
  useEffect(() => { setTexto(linha.sku ?? ""); }, [linha.sku, linha.rev]);
  const confirmar = () => {
    const r = skuDigitadoParaSalvar(linha, texto);
    if (r.acao === "salvar") { onSalvar(r.sku); return; }
    if (r.acao === "erro") toast.error(r.erro);
    setTexto(linha.sku ?? "");
  };
  return (
    <Input
      className="h-8 w-full min-w-0 font-mono text-xs"
      value={texto}
      placeholder={linha.sku_previsto ?? ""}
      disabled={!editavel || salvando}
      aria-label={`SKU do tamanho ${linha.tamanho_key}`}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
      data-colab-path={`sku:${linha.variante_key}:${linha.tamanho_key}`}
    />
  );
}

export function CodigosSecao({
  draft, setDraftTracked, rotuloRef, refVisivel, refEditavel, skus, podeVerSkus, podeEditarSkus,
}: {
  draft: Draft;
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  rotuloRef: string;
  /** A REF aparece a partir da etapa configurada (`refCampoVisivel`; posição DERIVADA com a chave ligada — inv. #11). */
  refVisivel: boolean;
  /** = `refEditavel` do orquestrador (isEdit && !devBloqueado && refVisivel) — o MESMO que põe a REF no payload. */
  refEditavel: boolean;
  skus: SkusModelo;
  /** Ver SKUs = ver o Planejamento; editar/Regerar = editar o Planejamento (spec SKU §4.4 — o servidor confere). */
  podeVerSkus: boolean;
  podeEditarSkus: boolean;
}) {
  const [confirmarRegerar, setConfirmarRegerar] = useState(false);
  const m = skus.matriz;
  const grupos = m ? agruparPorVariante(m.linhas) : [];
  // SKU editável = matriz ok + editar o Planejamento. NÃO depende da trava do Dev/Explosão (spec SKU §4.2; R29).
  const editavel = !!m && m.status === "ok" && podeEditarSkus;
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
        {/* R10 (dono 25/set) — SEM padrão da loja: nasce sem escolha; obrigatório só p/ GERAR os SKUs (o Salvar segue livre).
            Rádio nativo (não há RadioGroup em ui/, que não se edita): grupo rotulado; alvo de toque 44px no mobile. */}
        <div className="grid gap-1" role="radiogroup" aria-labelledby="codigos-tamanho-em" data-colab-path="tamanho_tipo">
          <Label id="codigos-tamanho-em">
            Tamanho em <span className="font-normal text-muted-foreground">· obrigatório p/ gerar os SKUs (começa sem escolha)</span>
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
            disabled={!editavel || skus.regerando} onClick={() => setConfirmarRegerar(true)}>
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
                "Escolha “Tamanho em” (Letra ou Número) e salve o card para gerar os SKUs."
              ) : (
                "Sem linhas: preencha a Grade (variantes do Tecido 1 × tamanhos com quantidade)."
              )}
            </p>
          ) : (
            <div className="overflow-x-auto">
              {/* R23 — SKUs já gravados num card sem "Tamanho em": a tabela mostra os gravados; gerar/regerar espera a escolha. */}
              {m.status === "sem_tamanho" && (
                <p className="mb-2 text-xs text-muted-foreground">Escolha “Tamanho em” e salve o card para gerar ou regerar os SKUs.</p>
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
                  {grupos.map((g) => (
                    <Fragment key={g.chave}>
                      <tr className="bg-muted/40">
                        <td colSpan={3} className="py-1.5 px-2 text-xs font-semibold text-muted-foreground">{rotuloVariante(g, siglasDoGrupo(g, siglas.cores, siglas.apelidos))}</td>
                      </tr>
                      {g.linhas.map((l) => {
                        const sit = situacaoSku(l);
                        const aviso = avisoSku(l);
                        const chave = `${l.variante_key}|${l.tamanho_key}`;
                        return (
                          <tr key={chave} className="border-t">
                            <td className="py-2 pr-3 pl-4 whitespace-nowrap">{rotuloTamanho(l.tamanho_key, m.tamanho_tipo)}</td>
                            <td className="py-2 px-2 min-w-40">
                              <SkuCampo
                                linha={l}
                                editavel={editavel && l.estado !== "orfa"}
                                salvando={skus.salvandoChave === chave}
                                onSalvar={(sku) => skus.salvarManual({ id: l.id, sku, rev: l.rev, varianteKey: l.variante_key, tamanhoKey: l.tamanho_key })}
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
                  ))}
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
