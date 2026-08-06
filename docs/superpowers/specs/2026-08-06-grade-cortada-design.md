# Grade Cortada (CORTADA) no PCP → CQ → Grade Real — Design (aprovado)

**Objetivo:** o serviço de **confecção** do modelo (PL, ou Oficina) reporta no PCP a **grade cortada** por tamanho×variante. Essa grade vira a **referência do CQ** (renomeia "Grade (CAD)" → "Grade Cortada"), o **Recebido/Defeito** passa a ser **um dado único** compartilhado entre PCP e CQ, e a **Grade Real = Recebido − Defeito** dessa fonte única — preservando o fluxo a jusante (Direcionamento, custo real).

## Contexto atual (verificado)

- **PCP/Serviços** (`pcp.servicos.$modeloId.tsx`): blocos `producao_terceirizados` por (modelo × categoria). Um bloco é `interno` (colaborador) ou **PL** (`interno=false`, empresa externa). Flag `detalhado` + `grade_detalhe` jsonb = `{ variante_tecido_id: { tamanho: { enviada, recebida, defeito } } }`; quando `detalhado`, os totais (`quantidade_enviada/recebida/defeito`) viram Σ da grade. Editor = 3 tabelas (Enviada/Recebida/Defeito), Enviada pré-preenchida da grade planejada (`modelo_grades`).
- **CQ** (`expedicao.cq.$modeloId.tsx`): etapas `recebimento/conserto/lavagem/defeito` (grids por variante×tamanho). **Grade Real = Recebimento − Defeito** (por célula, min 0), gravada em `cad_grades.grades_reais` por `salvar_cq` (invariante #6). Já existe alerta quando a Grade Real diverge da grade planejada do CAD. A Grade Real segue p/ o Direcionamento (invariante #10). `cad_grades.grades_planejada` alimenta o corte/déficit de tecido (invariante #7).
- **Categorias de serviço** = `categorias_terceirizado` (nome, `etapa`, `ordem`, `ativo`). Corte/Oficina semeadas.

## 1. Fonte da grade cortada (por modelo)

- Resolução **automática por prioridade**: se o modelo tem um bloco **PL destrinchado** → PL é a fonte; senão, se tem **Oficina destrinchada** → Oficina; senão o recurso fica **inativo** (o modelo trabalha como hoje). **Um** bloco-fonte por modelo.
- A ordem de prioridade é **configurável no Cadastro** (PL default). Modelagem: uma marca "é confecção (carrega a grade cortada)" + `ordem` nas `categorias_terceirizado` (ou `tenant_config.confeccao_prioridade` = lista ordenada de `categoria_terceirizado_id`). PL marcada por default no seed.
- **Guarda de ambiguidade**: se dois blocos de categorias-confecção destrinchadas coexistirem no mesmo modelo, o sistema avisa (banner) e usa o de maior prioridade; o save pode barrar criar um 2º bloco-fonte destrinchado (decisão do plano — mínimo: aviso claro + prioridade determinística).

## 2. PCP — grade do bloco-fonte

- A célula do `grade_detalhe` ganha um 4º campo: `{ enviada, cortada, recebida, defeito }` (default 0; migração aditiva do jsonb — chave ausente lida como 0).
- Editor: entra a **CORTADA** como coluna/tabela **entre Enviada e Recebida**. Abaixo da Recebida, **Saldo (a receber) = Cortada − Recebida** (por célula + total; negativo = recebido mais que o cortado, sinaliza anomalia).
- Totais do bloco (Σ) passam a exibir Cortada e Saldo além dos atuais.
- CORTADA é editada **só no PCP** (no CQ é read-only). Recebida/Defeito são a fonte única compartilhada (§4).

## 3. Cadastro

- Config de prioridade da fonte de confecção (PL → Oficina), PL default. Exposta no Cadastro (padrão `AttributeTab`/config de loja). Sem prioridade configurada = default PL→Oficina.

## 4. CQ — acoplamento (fonte única)

- **Grade Cortada** substitui o rótulo/valor "Grade (CAD)": lê a **CORTADA** do bloco-fonte (read-only no CQ). Vira a referência do **alerta de divergência** (Grade Real vs Cortada, no lugar de vs CAD-planejada).
- **Recebido e Defeito = FONTE ÚNICA**: para modelo com bloco-fonte destrinchado, o grid de **Recebimento** e o de **Defeito** do CQ **são o mesmo dado** do `grade_detalhe` do bloco-fonte. Editar no PCP ou no CQ escreve na MESMA estrutura (canônica = `producao_terceirizados.grade_detalhe` do bloco-fonte). As etapas `conserto/lavagem` seguem exclusivas do CQ (armazenamento atual do CQ).
- **Grade Real = Recebido − Defeito** dessa fonte única (fórmula preservada), gravada em `cad_grades.grades_reais` na mesma transação atômica de `salvar_cq` (invariante #6 intacto). O gate `cqLiberado()`, o rebaixe de Direcionamento por grade defasada e tudo a jusante seguem inalterados.
- **Bidirecional na prática**: como é o mesmo dado, "editar em um afeta o outro" é literal; sem trigger de cópia, sem drift. O plano decide o mecanismo (o CQ lê/grava o `grade_detalhe` via RPC — a tabela pode virar RLS/RPC-gated se hoje é escrita direta; a atomicidade do `salvar_cq` deve abarcar a escrita do `grade_detalhe` + `cad_grades`).

## 5. Compatibilidade e invariantes

- **Modelo sem bloco-fonte destrinchado** = CQ e PCP como hoje (Grade CAD como referência, recebimento/defeito próprios do CQ). O recurso é **opt-in por existência do bloco destrinchado** — retrocompatível.
- `cad_grades.grades_planejada` **permanece** no dado (corte/déficit de tecido — invariante #7); só a **exibição** da referência no CQ muda para a cortada.
- Nada muda a jusante de `grades_reais` (Direcionamento #10, custo real, dashboards).
- **Reconciliação de dados em voo** (RISCO a tratar no plano): modelos que HOJE já têm recebimento no CQ **e** um bloco-fonte destrinchado com `recebida` própria — os dois números podem divergir. Regra: ao ativar a fonte única, o `grade_detalhe` do bloco-fonte é **autoritativo**; a migração reconcilia (o CQ passa a ler dele). O plano define migração idempotente + o que fazer se divergirem (preferir o mais recente/o do PCP; log).

## Segurança / atomicidade

- Se o `grade_detalhe` passa a alimentar a Grade Real (dado que vira `cad_grades.grades_reais`), a escrita dele + o `salvar_cq` devem ser **atômicos** (uma txn) e o gate de permissão do CQ vale para a escrita do recebido/defeito via CQ. Escrita direta do `grade_detalhe` via PCP mantém o gate do módulo `producao`/`producao_terceirizados`.
- Guarda: Recebida/Cortada ≥ 0; Saldo derivado (não persistido). Grade Real = max(0, recebido − defeito) por célula (como hoje).

## Testes

- Integração transacional: CORTADA no PCP aparece como Grade Cortada no CQ; editar Recebida no PCP muda o Recebimento no CQ e vice-versa (mesmo dado); Grade Real = recebido − defeito da fonte única, gravada em `cad_grades.grades_reais`; alerta de divergência compara vs cortada; modelo SEM bloco-fonte destrinchado = comportamento atual; guarda de 2º bloco-fonte; reconciliação de um modelo em voo.
- Unit: helpers puros de Saldo (cortada−recebida), resolução da fonte por prioridade, Grade Real por célula.

## Fora de escopo (YAGNI)

Grade cortada para blocos NÃO-confecção (Bordado/Entretela/Corte-só); CORTADA quando `detalhado` desligado (o recurso exige a grade destrinchada); histórico de alterações da cortada; múltiplas fontes somadas (decidimos 1 fonte/modelo); mudar a semântica da Grade Real (segue Recebido − Defeito).
