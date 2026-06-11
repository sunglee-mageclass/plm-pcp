
## Bugs a corrigir

### 1. Mês e Ano não puxam do cadastro (Planejamento e Desenvolvimento)
**Causa:** `useOpts("meses")` e `useOpts("anos")` usam a chave default `nome`, mas a tabela `meses` tem coluna `mes` e a tabela `anos` tem coluna `ano`. Resultado: SELECT falha silenciosamente e os dropdowns ficam vazios.
**Fix:** trocar para `useOpts("meses", "mes")` e `useOpts("anos", "ano")` em `criacao.planejamento.tsx` e `criacao.desenvolvimento.tsx`.

### 2. Semana — selecionável 1 a 5
**Fix:** trocar o `<Input>` de Semana por `<Select>` com opções fixas "1", "2", "3", "4", "5". Aplicar nos filtros e no dialog em Planejamento, e no filtro em Desenvolvimento.

### 3. Categoria Secundária — só abre se Principal = "Conjunto"
**Fix:** no dialog de Planejamento, desabilitar (e limpar valor) o select de Categoria Secundária a menos que o `nome` da categoria selecionada como Principal seja "conjunto" (case-insensitive).

### 4. Tecido Planejado — puxar do cadastro (seleção múltipla)
**Fix:** substituir o `FieldText` por um seletor múltiplo de artigos (tabela `artigos`, label via `artigoLabel`). Persistir em coluna `tecidos_planejados text[]` em `modelos` (criar via migração se ainda não existir).

### 5. UI de Colaboradores igual à de Atributos
**Fix:** reescrever `cadastro.colaboradores.tsx` para usar o mesmo layout sidebar+grupo do `cadastro.atributos.tsx` (lista lateral à esquerda agrupando Estilista / Modelista / Piloteiro, painel à direita com `AttributeTab`, badge de contagem, seletor mobile).

### 6. Kanban de Desenvolvimento — novos status + permitir editar
A edição já existe em `admin/configuracoes` (status_kanban). Apenas:
- Atualizar `DEFAULTS.status_kanban` em `admin/configuracoes.tsx` para a lista solicitada:
  `Em Modelagem, Corte de Piloto (I), Corte de Piloto (II), Corte de Piloto (III), Em Pilotagem, Prova de Roupa (I)..(V), Em Ajuste, Stand By, Reprovado, Aprovado`.
- Atualizar `DEFAULT_STATUSES` em `criacao.desenvolvimento.tsx` para a mesma lista (fallback quando tenant_config vazio).
- Lógica de "último status = Aprovado" já funciona via `lastStatusKeys` em `ModeloDetailPanel`.

### 7. Variantes duplicáveis no card de Desenvolvimento
**Causa:** em `ModeloTecidosSection.tsx`, cada `<Select>` de variante mostra a lista completa.
**Fix:** filtrar `variantesArtigo` removendo IDs já selecionados em outros slots do mesmo bloco (mantendo o próprio valor do slot atual).

### 8. Grade PPP→GG + Grade Total automática
- **Padrão de tamanhos:** atualizar fallback em `ModeloDetailPanel.tsx` (e `DEFAULTS.tamanhos_grade` em admin) para `["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"]` (já é o default no admin; ajustar o fallback hardcoded `["PP","P","M","G","GG"]` no painel).
- **Grade Total automática:** em `ModeloGradeSection.tsx`, tornar o input de Grade Total **readonly**, calculado pela soma das células. Remover `onChangeGradeTotal` (ou mantê-lo apenas internamente). A função `updateGradeCell` já recalcula o total; o input precisa apenas exibir `g.grade_total` em readonly.

### 9. Foto do Modelo / Foto de Referência em Desenvolvimento
**Causa:** `ModeloAnexosSection` só renderiza Ficha de Medida.
**Fix:** estender a seção "Anexos" para exibir e permitir gerenciar `fotos_modelo[]` e `fotos_referencia[]` (mesmo componente `PhotoList` usado em Planejamento — extrair para `components/desenvolvimento/modelo-detail/PhotoList.tsx` ou compartilhar). Persistir as duas arrays no `save` do `ModeloDetailPanel`.

## Detalhes técnicos

- **Migração necessária (apenas bug #4):**
  ```sql
  ALTER TABLE public.modelos
    ADD COLUMN IF NOT EXISTS tecidos_planejados uuid[] DEFAULT '{}';
  ```
- Arquivos tocados:
  - `src/routes/_authenticated/criacao.planejamento.tsx`
  - `src/routes/_authenticated/criacao.desenvolvimento.tsx`
  - `src/routes/_authenticated/cadastro.colaboradores.tsx`
  - `src/routes/_authenticated/admin/configuracoes.tsx`
  - `src/components/desenvolvimento/ModeloDetailPanel.tsx`
  - `src/components/desenvolvimento/modelo-detail/ModeloTecidosSection.tsx`
  - `src/components/desenvolvimento/modelo-detail/ModeloGradeSection.tsx`
  - `src/components/desenvolvimento/modelo-detail/ModeloAnexosSection.tsx`

## Fora do escopo (avisar)
A definição/ordem dos status em `tenant_config.status_kanban` para tenants existentes só será atualizada para novos cadastros (DEFAULTS). Tenants atuais precisam abrir Admin > Configurações e editar/salvar para receber a nova lista — ou posso fazer um UPDATE em massa se quiser.
