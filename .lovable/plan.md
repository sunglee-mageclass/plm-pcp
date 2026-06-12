## Problema
1. No mobile, o header da tela coloca título + busca + filtros na mesma linha. A busca expande horizontalmente e os botões transbordam.
2. O Kanban (colunas de 288px com scroll horizontal + drag-and-drop) é inutilizável em telas pequenas: drag não funciona bem em touch e o usuário precisa rolar lateralmente.

## Solução

### 1. Header responsivo
- Empilhar em mobile usando grid `grid-cols-[minmax(0,1fr)_auto]` para o título + ações, e mover busca/filtros para uma segunda linha em telas <`sm`.
- `SearchToggle` ocupa largura total no mobile quando expandido.
- Aplicar `truncate` no título e `shrink-0` no ícone.

### 2. Visão alternativa em mobile (lista por status)
Em telas `<md` o Kanban horizontal é substituído por uma **lista vertical agrupada por status** (accordion/seções colapsáveis):

- Cada status vira uma seção colapsável (`<details>` nativo ou Accordion shadcn) com o título, cor, contagem.
- Dentro de cada seção, os cards são renderizados na largura total (sem drag).
- Para mover um modelo de status, o card ganha um **Select** ou ação "Mover para…" que altera o status via a mesma `updateStatus` mutation já existente.
- Em desktop (`md:`+) mantém o Kanban horizontal com drag-and-drop como hoje.

### Layout
```text
Desktop (md+):
[Hammer] Desenvolvimento          [Busca] [Filtros]
[col em_modelagem] [col corte_p1] [col corte_p2] ... (scroll-x, drag)

Mobile (<md):
[Hammer] Desenvolvimento
[Busca ........................] [Filtros]
▾ Em Modelagem (3)
   ┌ card .............................┐
   │ foto  Nome              [Status▾] │
   └───────────────────────────────────┘
▸ Corte de Piloto I (0)
▸ Em Pilotagem (2)
...
```

## Detalhes técnicos

**Arquivo único:** `src/routes/_authenticated/criacao.desenvolvimento.tsx`

1. **Header** (linha 223-245): trocar `flex items-center justify-between` por
   ```
   flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between
   ```
   No bloco de busca/filtros: `flex items-center gap-2 w-full sm:w-auto justify-end`. `SearchToggle` recebe `className="flex-1 sm:flex-none"` para esticar no mobile.

2. **Kanban vs Lista**: usar `useIsMobile()` de `src/hooks/use-mobile.tsx` (já existe no projeto) ou Tailwind `hidden md:flex` / `md:hidden`:
   - Bloco atual (linhas 247-282) recebe `hidden md:flex`.
   - Adicionar bloco novo `md:hidden space-y-2` com `<Accordion type="multiple" defaultValue={[firstStatusKey]}>` de shadcn:
     - `AccordionItem` por status com header `{cor} {label} ({count})`.
     - `AccordionContent` lista vertical de `MobileCard`.
   - `MobileCard`: variante de `KanbanCard` sem `draggable`, com `<Select value={status} onValueChange={…}>` na lateral direita que dispara `updateStatus.mutate({ id, status })`.

3. Reutilizar `useSignedUrlBucket` já existente.

4. Sem mudança de banco, sem novas dependências (Accordion e Select já são parte do shadcn/UI do projeto).

## Critérios de aceite
- Em 360–500px de largura, o header não transborda e busca/filtros ficam acessíveis.
- Em mobile, o usuário vê todos os status colapsáveis, sem scroll horizontal.
- Trocar o status de um card no mobile via Select atualiza imediatamente (otimista, igual ao drag atual).
- Em desktop nada muda: Kanban com drag-and-drop continua igual.
