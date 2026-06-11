# Refatorar UI da página Cadastro > Atributos

## Recomendação: Abordagem 1 (layout de 2 colunas com menu vertical agrupado)

Razões:
- Mantém 1 clique para trocar de atributo (a Alternativa 2 exige 2 cliques: card → painel → voltar).
- 12 itens cabem confortavelmente em coluna vertical com agrupamento por seção, o que reduz a poluição visual sem perder densidade.
- Padrão já presente no projeto (sidebar agrupada por módulo), então é coerente com o resto.
- A coluna direita pode reaproveitar 100% do componente `AttributeTab` existente — refator é só na casca da página.

A Alternativa 2 (grid de cards) seria preferível só se houvessem 20+ atributos ou se a contagem por atributo fosse a informação principal — não é o caso aqui.

## Mudanças

### 1. `src/routes/_authenticated/cadastro.atributos.tsx`
- Remover `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`.
- Manter o array `TABS` (renomear para `ATTRIBUTES`) e adicionar campo `group` em cada item:
  - GERAL: cores, anos, meses
  - FORNECEDOR: cat_fornecedor
  - TECIDO: cat_tecido
  - AVIAMENTO: cat_aviamento, subcat_aviamento, material_aviamento, intervalo_largura
  - PRODUTO: cat_produto, linha
  - TERCEIRIZADO: cat_terceirizado
- Estado local `selected` (default: primeiro atributo).
- Layout flex em 2 colunas:
  - Esquerda: `w-60 border-r` com lista vertical agrupada. Cada grupo tem um label pequeno em maiúsculas (text-xs, muted) e botões dos atributos abaixo. Item ativo: `bg-muted text-foreground font-medium`; inativo: `text-muted-foreground hover:bg-muted/50`.
  - Direita: `flex-1` renderiza `<AttributeTab config={selected.config} />` dentro de um container com header (`h2` com o nome plural do atributo + badge com contagem de itens).

### 2. Contagem de itens no header
- Buscar a contagem via `supabase.from(table).select('id', { count: 'exact', head: true })` filtrado por `tenant_id` (mesmo padrão usado em `AttributeTab`).
- Encapsular em um pequeno hook `useAttributeCount(table)` usando TanStack Query, ou ler do próprio `AttributeTab` se ele já expõe — preferir hook isolado no arquivo da página para não tocar no componente compartilhado.

### 3. Responsividade
- Em telas `< md`, colapsar a coluna esquerda em um `Select` no topo (mesma lista de opções agrupadas). Mantém usabilidade em tablet sem reescrever lógica.

## O que NÃO muda
- `AttributeTab` continua igual.
- Comportamento de CRUD, validação, exclusão.
- Rota e permissões.

## Pergunta para confirmar
- Manter a Coluna esquerda **sempre visível** (não colapsável) em desktop? Ou quer um botão para esconder e ganhar mais espaço horizontal no CRUD?
