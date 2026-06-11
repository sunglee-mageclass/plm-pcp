## Plano de correções

### 1. Cabeçalho padrão (Serviços, OC Tecido, OC Aviamento, Estoque)
Trocar o `<header>` atual destas 4 páginas pelo mesmo padrão do Atributos: ícone em quadrado `h-12 w-12` com fundo `bg-primary text-primary-foreground`, título `text-2xl font-semibold tracking-tight`, subtítulo `text-sm text-muted-foreground`. Padronizar espaçamento da página (`space-y-6`).

Arquivos:
- `src/routes/_authenticated/cadastro.servico.tsx`
- `src/routes/_authenticated/entrada-saida.oc-tecido.tsx`
- `src/routes/_authenticated/entrada-saida.oc-aviamento.tsx`
- `src/routes/_authenticated/entrada-saida.estoque.tsx`

### 2. Financeiro — calendário clicável
Cada item dentro da célula vira `<button>` que abre `ParcelaDetailDialog` mostrando: fornecedor, nº pedido, parcela X/Y, valor, vencimento, status, link do comprovante e botão "Marcar pago" (reusa `PagarDialog`). Clicar no dia (com itens) também abre lista do dia.

Arquivo: `src/routes/_authenticated/financeiro.tsx`.

### 3. Gerenciar Lojas — botão de edição
Adicionar coluna "Ações" com botão lápis abrindo `EditarLojaModal` (mesmo formulário do `NovaLojaModal`, em modo edição: nome, CNPJ, contato, logo). UPDATE em `tenants`.

Arquivo: `src/routes/_authenticated/admin/lojas.tsx`.

### 4. Filtros compactos (global)
Padrão novo: `Label` com `text-xs`, trigger/input com `h-8 text-sm`, larguras `w-40` a `w-48`. Aplicar em todas as barras de filtro (Financeiro, OC Tecido, OC Aviamento, Estoque, Planejamento, Desenvolvimento, Produção, Cadastros).

### 5. OC Tecido — remover busca de artigo
No `TecidoGroup`, remover o `<Input>` de pesquisa e deixar somente o `<Select>` (que já tem busca interna implícita via teclado). Ajustar layout para um só campo largo.

Arquivo: `src/components/oc-tecido/TecidoGroup.tsx`.

### 6. Etiqueta de lavagem por tecido (1 por artigo)
- Migração: adicionar colunas `etiqueta_lavagem_url_1 text` e `etiqueta_lavagem_url_2 text` em `ocs_tecido`; manter `etiqueta_lavagem_urls` por compatibilidade (preencher na leitura).
- `OcTecidoRecebimento`: substituir bloco único de etiquetas por dois `FileField` rotulados "Etiqueta de Lavagem — Tecido 1" e "Etiqueta de Lavagem — Tecido 2" (o segundo só aparece se Tecido 2 estiver aberto).
- Persistência no save (`entrada-saida.oc-tecido.tsx`) usa os novos campos.

### 7. Aba "Recebidos" — mostrar Qtd Recebida
Adicionar coluna **Qtd Recebida** (soma dos itens da OC, com unidades por artigo, ex: "120 m + 8 kg") na tabela da aba Recebidos.

Implementação: incluir `ocs_tecido_itens` + `artigos.unidade_medida` no query do `entrada-saida.oc-tecido.tsx` quando `tab === "recebido"`, agregar por OC e passar para `OcTecidoList`.

Arquivos: `src/routes/_authenticated/entrada-saida.oc-tecido.tsx`, `src/components/oc-tecido/OcTecidoList.tsx`. Aplicar mesma lógica em `oc-aviamento.tsx`.

### 8. Theme toggle no topo da sidebar
Mover `ThemeToggleButton` do `SidebarFooter` para o `SidebarHeader` (à direita do bloco "P+ / PLM+PCP / Moda & Confecção"). Botão `size="icon"` `variant="ghost"`, com tooltip mantido.

Arquivo: `src/components/app-sidebar.tsx`.

### Detalhes técnicos
- Migração SQL adiciona `etiqueta_lavagem_url_1`, `etiqueta_lavagem_url_2` (TEXT NULL). Sem mudança de RLS.
- Tipos do `OC` em `shared.ts` recebem os dois novos campos.
- Nenhuma mudança de regra de negócio em parcelas; o detalhe no calendário apenas reusa dados existentes.
