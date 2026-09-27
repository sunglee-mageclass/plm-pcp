// Integração — tabela da aba Produtos. Colunas: [seleção] · seta · Estado · [Integrável] · campos marcados (ordem fixa —
// "Colunas exibidas = campos marcados em Campos da API"). A seta abre as sublinhas (variante × tamanho). A tabela rola
// DENTRO do container; a página não rola na horizontal. Seleção e "Integrável" chegam na Task 13 (props opcionais).
//
// Adaptação do controlador (P-99 A): um produto INTEGRÁVEL reprovado continua na lista — mostra o badge "Reprovado —
// não vai para a API" ao lado do estado (StatusBadge tone="danger", mesmo padrão do resto da tela).
import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CAMPO_BY_KEY, type CampoDef } from "@/lib/integracao/campos";
import { ROTULO_ORIGEM, linhasVariante, type ListaIntegracao, type ProdutoLista } from "@/lib/integracao/produtos";
import type { Rascunho } from "@/lib/integracao/rascunho";
import type { PreviaSkus } from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import { CelulaCampo } from "./CelulaCampo";

export type SelecaoTabela = {
  todos: boolean; alguns: boolean; onTodos: (v: boolean) => void; marcado: (id: string) => boolean;
  onMarcar: (id: string, v: boolean) => void;
};
type Props = {
  lista: ListaIntegracao; rascunhoDe: (p: ProdutoLista) => Rascunho; previas: Record<string, PreviaSkus | undefined>;
  salvando: boolean; onAtualizar: (p: ProdutoLista, f: (r: Rascunho) => Rascunho) => void; onKeywords: () => void;
  onFotos: (p: ProdutoLista) => void; estadoCelula: (p: ProdutoLista) => ReactNode;
  integravelCelula?: (p: ProdutoLista) => ReactNode; selecao?: SelecaoTabela;
};

export function ProdutosTabela({
  lista, rascunhoDe, previas, salvando, onAtualizar, onKeywords, onFotos, estadoCelula, integravelCelula, selecao,
}: Props) {
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set());
  const alternar = (id: string) => setAbertos((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const campos = lista.campos.map((k) => CAMPO_BY_KEY.get(k)).filter((c): c is CampoDef => !!c);
  return (
    <div className="max-w-full overflow-x-auto rounded-md border">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            {selecao && (
              <th className="w-10 px-2 py-2">
                <Checkbox aria-label="Selecionar todos da página" checked={selecao.todos ? true : selecao.alguns ? "indeterminate" : false}
                  onCheckedChange={(v) => selecao.onTodos(v === true)} />
              </th>
            )}
            <th className="w-10 px-1 py-2"><span className="sr-only">Sublinhas</span></th>
            <th className="px-2 py-2">Estado</th>
            {integravelCelula && <th className="px-2 py-2">Integrável</th>}
            {campos.map((c) => <th key={c.key} className="whitespace-nowrap px-2 py-2 font-medium">{c.rotuloCurto}</th>)}
          </tr>
        </thead>
        <tbody>
          {lista.produtos.map((p) => {
            const r = rascunhoDe(p);
            const subs = linhasVariante(p);
            const aberto = abertos.has(p.modeloId);
            const celula = (c: CampoDef, indice: number | null) => (
              <CelulaCampo campo={c} produto={p} indice={indice} rascunho={r} previa={previas[p.modeloId]} salvando={salvando}
                onAtualizar={(f) => onAtualizar(p, f)} onKeywords={onKeywords} onFotos={() => onFotos(p)} />
            );
            return (
              <Fragment key={p.modeloId}>
                <tr className="border-t align-top">
                  {selecao && (
                    <td className="px-2 py-2">
                      <Checkbox aria-label={`Selecionar ${p.raw.nome}`} checked={selecao.marcado(p.modeloId)}
                        onCheckedChange={(v) => selecao.onMarcar(p.modeloId, v === true)} />
                    </td>
                  )}
                  <td className="px-1 py-2">
                    <Button type="button" variant="ghost" size="iconSm" disabled={subs.length === 0}
                      aria-label={aberto ? "Fechar sublinhas" : "Abrir sublinhas"} onClick={() => alternar(p.modeloId)}>
                      {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-col gap-1">
                      {estadoCelula(p)}
                      {p.origem !== "interno" && <StatusBadge tone="info" className="w-fit">{ROTULO_ORIGEM[p.origem]}</StatusBadge>}
                      {/* P-99 A (controlador): integrável reprovado continua na lista — badge ao lado do estado. */}
                      {p.reprovado && (
                        <StatusBadge tone="danger" className="w-fit normal-case tracking-normal">
                          Reprovado — não vai para a API
                        </StatusBadge>
                      )}
                    </div>
                  </td>
                  {integravelCelula && <td className="px-2 py-2">{integravelCelula(p)}</td>}
                  {campos.map((c) => <td key={c.key} className="px-2 py-2">{celula(c, null)}</td>)}
                </tr>
                {aberto && subs.map((_, i) => (
                  <tr key={`${p.modeloId}:${i}`} className="border-t border-dashed bg-muted/20 align-top text-xs">
                    {selecao && <td />}
                    <td />
                    <td className="px-2 py-2 text-muted-foreground">sublinha</td>
                    {integravelCelula && <td />}
                    {campos.map((c) => <td key={c.key} className="px-2 py-2">{celula(c, i)}</td>)}
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
