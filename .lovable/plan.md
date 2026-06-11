## Objetivo

Dividir `src/components/desenvolvimento/ModeloDetailPanel.tsx` (899 linhas) em 6 subcomponentes focados, mantendo `ModeloDetailPanel` como orquestrador de state e mutations.

## Estrutura de arquivos

```text
src/components/desenvolvimento/
├── ModeloDetailPanel.tsx              (orquestrador, ~200 linhas)
├── modelo-detail/
│   ├── types.ts                       (TecidoBlock, AviamentoRow, GradeRow, Opt, constantes)
│   ├── hooks.ts                       (useModeloData, useOptions, useMutations)
│   ├── ModeloInfoSection.tsx
│   ├── ModeloTecidosSection.tsx
│   ├── ModeloAviamentosSection.tsx
│   ├── ModeloGradeSection.tsx
│   ├── ModeloCustosSection.tsx
│   └── ModeloAnexosSection.tsx
```

## Estratégia de state

State e mutations ficam no parent (`ModeloDetailPanel`). Cada seção recebe seu slice + callback de update — padrão controlado, sem Context:

```tsx
<ModeloTecidosSection
  blocks={tecidoBlocks}
  artigosOpts={artigos}
  onChange={setTecidoBlocks}
  disabled={isSaving}
/>
```

Vantagens: tipagem explícita, fácil de testar, sem re-renders desnecessários via Context.

## Responsabilidades por componente

| Componente | Props principais | Responsabilidade |
|---|---|---|
| `ModeloInfoSection` | `modelo`, `colaboradores`, `onChange` | Nome, REF, status, estilista, modelista, piloteiros 1-3, datas, coleção, semana/mês/ano |
| `ModeloTecidosSection` | `blocks: TecidoBlock[]`, `artigos`, `onChange` | Renderiza 9 blocos (3 tipos × 3 numerados), cada um com até 10 variantes |
| `ModeloAviamentosSection` | `rows: AviamentoRow[]`, `aviamentos`, `onChange` | 10 linhas de aviamento com consumo/loss/custo |
| `ModeloGradeSection` | `grades: GradeRow[]`, `tamanhos`, `onChange` | Tabela proporções por variante + cálculo automático de total |
| `ModeloCustosSection` | `tecidoBlocks`, `aviamentos`, `servicos` | Read-only; soma `custo_previsto` de tecidos/aviamentos/serviços |
| `ModeloAnexosSection` | `modelo`, `onUpload`, `onRemove` | Ficha de medida (upload), observações (textarea), fotos (galeria + upload) |

## Parent (ModeloDetailPanel) após refatoração

```tsx
export function ModeloDetailPanel({ modeloId, onClose }) {
  const { modelo, setModelo, tecidoBlocks, setTecidoBlocks, ... } = useModeloData(modeloId);
  const { artigos, aviamentos, colaboradores, tamanhos } = useOptions();
  const saveMutation = useSaveModelo(modeloId);

  return (
    <Sheet open={!!modeloId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="...">
        <SheetHeader>...</SheetHeader>
        <Accordion type="multiple">
          <AccordionItem value="info">
            <ModeloInfoSection modelo={modelo} colaboradores={colaboradores} onChange={setModelo} />
          </AccordionItem>
          <AccordionItem value="tecidos">
            <ModeloTecidosSection blocks={tecidoBlocks} artigos={artigos} onChange={setTecidoBlocks} />
          </AccordionItem>
          {/* …aviamentos, grade, custos, anexos */}
        </Accordion>
        <Button onClick={() => saveMutation.mutate()}>Salvar</Button>
      </SheetContent>
    </Sheet>
  );
}
```

## Passos de execução

1. Criar `modelo-detail/types.ts` extraindo `TecidoBlock`, `AviamentoRow`, `GradeRow`, `Opt`, `TIPOS`, `STATUS_DESENV_OPTS`, `BUCKET`, helpers como `makeEmptyBlocks`.
2. Criar `modelo-detail/hooks.ts` com `useModeloData(modeloId)` (carrega modelo + relacionados) e `useOptions()` (artigos, aviamentos, colaboradores por tipo, tamanhos).
3. Criar os 6 arquivos de seção, cada um exportando um componente puro (props in → JSX out).
4. Reescrever `ModeloDetailPanel.tsx` apenas com Sheet + Accordion + composição das seções + mutation de salvar.
5. Validar build e abrir o painel em `/criacao/desenvolvimento` para confirmar comportamento idêntico (campos, upload de fotos, cálculo de grade, salvar).

## Notas técnicas

- Nenhuma mudança de schema, mutation ou query — apenas reorganização visual.
- Mantém uma única chamada de save (mutation no parent) para preservar atomicidade.
- Uploads de fotos/ficha continuam no parent (precisam de `modeloId` + invalidate de queries); `ModeloAnexosSection` recebe handlers prontos.
- Cálculos derivados (`ModeloCustosSection`, total de grade) usam `useMemo` dentro da seção.