# Alerta + mini-janela "Desmarcar etapas posteriores"

**Data:** 2026-07-16 · **Status:** aprovado, em implementação

## Problema
Ao editar um modelo que já avançou (tem CAD/corte/CQ/etc.), a mudança **não propaga sozinha** para as etapas seguintes — é preciso **desmarcar/refazer** as posições posteriores antes. O aviso ao salvar já existe (`DownstreamConfirmDialog`), mas (1) não deixa claro que é preciso desmarcar antes e (2) não oferece um jeito de desmarcar sem sair da tela.

## Solução (2 partes)

### 1. Reforçar o aviso ao salvar (`DownstreamConfirmDialog`)
- Intro passa a dizer explicitamente: *as etapas seguintes não atualizam sozinhas; para a mudança valer, desmarque/refaça as posições posteriores (da última para a primeira)*.
- Novo botão **"Desmarcar etapas…"** abre a mini-janela. Mantém *Voltar a editar* / *Salvar mesmo assim*.
- (Opcional) incluir **"Insumos"** no `FIELD_IMPACT` para o texto de impacto específico cobrir edição de insumo (hoje só Grade/Consumo/Aviamentos).

### 2. Mini-janela `DesmarcarEtapasDialog`
Sub-modal por cima do Desenvolvimento. Lista **só as etapas atingidas** em **ordem reversa do fluxo** (última primeiro).

| Etapa | Ação | Como |
|-------|------|------|
| Lançamentos | Desmarcar | `modelos.lancado = false` (por modelo_id) |
| Direcionamento | Desmarcar | `cad.direcionamento_status='pendente', direcionamento_confirmado_at=null` (por cad_id) |
| CQ | Desmarcar | `desmarcar_cq_pos(_cad_id)` depois `desmarcar_cq(_cad_id)` |
| Oficina | Abrir ↗ | navega (status derivado de `data_entregue`; sem desmarca de 1 clique) |
| Serviços | Abrir ↗ | navega (status derivado dos blocos) |
| Corte | Desmarcar | `reverter_corte_tecido(_cad_id)` — estorna a baixa (nota: mostra `baixa_total` m) |

- **Ordem guiada**: entre as etapas *desmarcáveis* (Lançamentos→Direcionamento→CQ→Corte), só a mais recente atingida fica ativa; as de baixo aguardam. Serviços/Oficina (abrir) ficam sempre acessíveis. As guardas das próprias RPCs reforçam constraints reais.
- **Confirm curto** nas destrutivas (Corte, CQ).
- A cada desmarcação: invalida `["etapas-afetadas", modeloId]` + queryKeys da etapa (cad-grades, estoque, parcelas, sidebar-badges), **refetcha** e a etapa some.
- Sem downstream restante → mostra *"Pronto — pode salvar"* + botão **Salvar agora** (dispara o mesmo `save.mutate()` do painel).
- **Permissão** por etapa (`canEdit`: producao_cad/cq/direcionamento/lancamentos): sem permissão → botão desabilitado com aviso.

## Fora de escopo (YAGNI)
- Nenhum "desmarcar tudo de uma vez" (ordem/efeitos importam).
- Não muda o que conta como downstream (segue `modelo_etapas_afetadas`).
- Serviços/Oficina não ganham desmarca de 1 clique (status é derivado).

## Segurança / dados
Reaproveita 100% das RPCs/ações já existentes → todas as guardas, RLS e triggers (estorno de baixa do corte, rebaixa de CQ) continuam valendo. Nenhum backend novo. `cad_id` obtido por `cad.modelo_id = modeloId` (invariante: 1 CAD por modelo).

## Componentes
- `DownstreamImpactAlert.tsx`: reescreve intro do `DownstreamConfirmDialog` + botão; adiciona `DesmarcarEtapasDialog`.
- `ModeloDetailPanel.tsx`: estado do sub-modal + `onAllClear`→ habilita "Salvar agora".
