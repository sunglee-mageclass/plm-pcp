## Diagnóstico — Terceirizados (botões de categoria vazios)

### O que já foi verificado

1. **Banco** — A tabela `categorias_terceirizado` tem **3 registros** para o tenant do usuário logado (`Corte`, `Costura`, `Caseado`).
2. **RLS** — Política `tenant_select` em `categorias_terceirizado` usa `(tenant_id = get_user_tenant_id())`. Correto.
3. **Componente** `producao.terceirizados.$modeloId.tsx` — A query e o `map` dos botões **estão corretos** e **não são gated** por nenhum estado (rendem direto de `categorias`):

```tsx
const { data: categorias = [] } = useQuery({
  queryKey: ["categorias_terceirizado"],
  queryFn: async () =>
    (await supabase.from("categorias_terceirizado").select("id, nome").order("nome")).data ?? [],
});
...
{(categorias as any[]).map((c) => <Button ...>{c.nome}</Button>)}
```

4. Sem logs de console nem requests de rede capturados no snapshot atual — não há erro visível.

### Hipótese mais provável (causa raiz)

A query `["terc-modelo", modeloId]` usa um embed com **ambiguidade potencial** em `modelos`:

```ts
.select("id, ref, nome, colecao, categorias_produto:categoria_principal_id(nome)")
.single()
```

`modelos` tem **duas FKs** apontando para `categorias_produto` (`categoria_principal_id` e `categoria_secundaria_id`). Se o PostgREST não resolver a desambiguação por nome de coluna nesta versão, retorna **400** e o `useQuery` do modelo entra em erro. Isso por si só **não esconde os botões** (são queries independentes), mas indica o mesmo padrão de falha silenciosa do Financeiro.

Causa real mais provável dos botões não aparecerem: **erro silencioso em uma das queries que disparam re-render** ou um erro de runtime mais cedo no componente (ex.: `modelo` undefined em algum acesso) que faz o React **abortar a render antes do Card de categorias**. Como o snapshot não tem console, preciso instrumentar.

### Plano de correção

1. **Adicionar diagnóstico mínimo** no componente: logar `categorias`, `error` da query, e o tamanho de `(categorias as any[])` para confirmar via console se os dados chegam.
2. **Endurecer a query de `modelo`** trocando o embed ambíguo por **queries separadas** (mesmo padrão que aplicamos no Financeiro):
   - `modelos`: só colunas escalares.
   - `categorias_produto` separado, por `categoria_principal_id`.
3. **Endurecer a query de `categorias_terceirizado`**: tratar erro explicitamente (não engolir com `?? []`), e exibir uma mensagem se falhar.
4. **Verificar live** abrindo uma REF: confirmar nas DevTools que `GET /rest/v1/categorias_terceirizado` retorna 200 com 3 itens.
5. Se os 3 itens chegarem e os botões ainda não renderizarem, suspeitar de **erro de runtime acima** (ex.: acesso a `modelo.categorias_produto.nome` quando `modelo` é `undefined`). Adicionar `?.` em todos os acessos derivados de `modelo`.

### Arquivos a editar

- `src/routes/_authenticated/producao.terceirizados.$modeloId.tsx`

### Critério de sucesso

- Ao abrir `/producao/terceirizados/<modeloId>`, aparecem 3 botões (`Corte`, `Costura`, `Caseado`).
- Clicar em um botão adiciona um bloco com os campos (Responsável, Preço, Datas, Quantidades).
- Salvar persiste em `producao_terceirizados` com `ativo=true`.
