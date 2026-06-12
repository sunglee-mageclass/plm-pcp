## Problema
Em desktop, o Kanban de Desenvolvimento (14 colunas × ~288px) força o `<main>` a crescer além da largura da viewport, gerando uma barra de scroll horizontal no nível da página. Isso empurra o cabeçalho (com Pesquisar/Filtrar) para fora da área visível, exigindo que o usuário role para a direita.

## Causa
Em `src/routes/_authenticated.tsx`, o wrapper ao lado da sidebar é:
```tsx
<div className="flex-1 flex flex-col">
```
Sem `min-w-0`, esse flex item expande para acomodar o conteúdo interno, anulando o `overflow-x-auto` do Kanban. É o problema clássico de flex child sem `min-w-0`.

## Correção
Adicionar `min-w-0` ao wrapper para que o `overflow-x-auto` do Kanban funcione dentro dele (apenas o Kanban rola horizontalmente, e o header permanece dentro da viewport):

```tsx
<div className="flex-1 min-w-0 flex flex-col">
```

Nenhuma outra mudança é necessária — o header da página já é responsivo, e o `overflow-x-auto` do Kanban passa a conter o scroll horizontal corretamente.

## Arquivos
- `src/routes/_authenticated.tsx` — adicionar `min-w-0` à div `flex-1 flex flex-col`
