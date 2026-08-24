# Etapas PL — S5 (Peça de foto) — Design

**Data:** 2026-08-24 · **Sub-projeto:** Etapas PL / S5 · **Depende de:** Fase 1 + S4 (mesmo caminho de round-trip). ÚLTIMO sub-projeto da campanha Etapas PL.

## Objetivo

No bloco de serviço PL: um toggle **"Peça de foto"** + campo **"Data de entrega da peça de foto"** (visível quando ligado). Na **lista de produtos do PCP**, um **ícone de câmera** na célula da REF (junto do `MoDot`) quando a data está preenchida. Sem tela nova. (Já especificado no design original `2026-08-21-pcp-etapas-pl-design.md` §K:84-85, §11:166-167, §DB:131.)

## Semântica (do design original, sem novas decisões)

- `producao_terceirizados.peca_foto boolean default false` + `peca_foto_data date` (2 colunas novas — greenfield, 0 hits em migrations).
- Toggle liga/desliga o acompanhamento da peça de foto do bloco PL; quando ligado, aparece o campo de data.
- Ícone de câmera na lista aparece quando **`peca_foto_data` está preenchida** (não só o toggle ligado) — critério do design (§11:167).
- Como os demais campos PL, zera quando `interno=true` (espelha `pt_*`/`nf_*`): `peca_foto=false, peca_foto_data=null`.

## Decisão de UI (minha, dentro do specado)

O toggle "Peça de foto" **não** entra no controle segmentado do header (Interno/PL é um segmented de 2 botões apertado); entra no **corpo do card** como um checkbox+label (idioma idêntico ao checkbox `detalhado` "Quantidade por tamanho e variante", `pcp.servicos.$modeloId.tsx:1197-1211`), com o `<DateField>` condicional logo abaixo (mesma props dos DateField existentes: `value={b.peca_foto_data ?? ""}`, `onChange={(e)=>updateBloco(idx,{peca_foto_data: e.target.value || null})}`).

**Guarda:** o toggle+data usam a MESMA guarda das outras adições Etapas PL (`!b.interno && isServicoPL(catNome) && isModuleEnabled("etapas_pl")`) — assim "Peça de foto" só aparece quando o módulo opt-in está ligado, mantendo o módulo significativo e consistente com o EtapasPlPanel/painel de NF. (Persistência no banco NÃO é gated por módulo — a coluna existe sempre; só a UI respeita a guarda.) O ícone de câmera na LISTA também só faz sentido com o módulo ligado; como ele lê `peca_foto_data` (que só é preenchível com o módulo on), o ícone naturalmente não aparece com o módulo off — mas por segurança/clareza, gatear o ícone da lista por `isModuleEnabled("etapas_pl")` também.

## Estado atual (reuso / anchors)

- `Bloco` type ~:153-158 (pt_/nf_); round-trip: load `blocosFromRows` ~:688-692, novo bloco ~:821-825, payload `blocos.map` ~:932-936 (todos com o idioma `b.interno ? falsy : b.campo`).
- `salvar_terceirizados`: migration mais nova = `20260824170000_salvar_terceirizados_nf.sql`. UPDATE SET tail (nf_) ~:79-83; INSERT col+VALUES tail ~:87-106. Idioma: bool `COALESCE((b->>'x')::boolean,false)`, date `NULLIF(b->>'x','')::date`.
- **Lista PCP** = `pcp.servicos.index.tsx`. `MoDot` (:28-33) na célula REF (:208-215): `<MoDot estado={moEstadoMap[r.modelo_id]} /> <span>REF</span> <VersaoBadge/> <RevisaoErroBadge/>`. A query principal (:50-102) **embeda** `producao_terceirizados(...)` (:56) mas só seleciona 6 campos e **descarta** os blocos no `.map` (:62-100, mantém só escalares derivados). → precisa: (a) add `peca_foto_data` ao embed select, (b) derivar `temFotoPeca = tercs.some(t => !!t.peca_foto_data)` no `.map` e incluir no objeto retornado, (c) renderizar o ícone. NÃO precisa de RPC nova (é coluna da mesma tabela já embedada).
- `Camera` do `lucide-react` já é idioma no codebase (ex. `expedicao.lancamentos.tsx:643` inline junto de badges, `h-4 w-4`; `expedicao.cq.$modeloId.tsx:1318` `h-3.5 w-3.5`). Usar `<Camera className="h-3.5 w-3.5 text-muted-foreground" title="Peça de foto" />` após o `MoDot`.

## Arquitetura

### DB
- Migration 1: `ALTER TABLE producao_terceirizados ADD COLUMN IF NOT EXISTS peca_foto boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS peca_foto_data date;` (`BEGIN;…COMMIT;`).
- Migration 2: `salvar_terceirizados` (CREATE OR REPLACE, diff-validado): +`peca_foto`/`peca_foto_data` no SET do UPDATE e no col+VALUES do INSERT (bool COALESCE false, date NULLIF). Só esse delta.

### Front — bloco (`pcp.servicos.$modeloId.tsx`)
- `Bloco` type: `+ peca_foto: boolean; peca_foto_data: string | null;`.
- round-trip nos 3 pontos (load/novo/payload), idioma `b.interno ? false/null : b.campo`.
- checkbox "Peça de foto" + DateField condicional no corpo do card (guard `!b.interno`).

### Front — lista (`pcp.servicos.index.tsx`)
- embed select +`peca_foto_data`; `.map` deriva `temFotoPeca`; ícone `Camera` na célula REF após `MoDot`, gated por `row.temFotoPeca`.

## Fora de escopo (S5)
- Upload de foto da peça (é só toggle+data, não anexo — o design distingue de S4). Se quiser anexar a foto real, é fast-follow (reusaria PhotoList/bucket `modelos`).
- Ícone na lista do Planejamento (o design diz PCP, não Planejamento §11:166).

## Riscos
- (a) diff-validação do `salvar_terceirizados` (função grande) obrigatória.
- (b) a lista descarta os blocos no `.map` — garantir que `peca_foto_data` seja lido ANTES do descarte e derivado corretamente (`.some`).
- (c) coluna nova fora do types.ts → `as any` no embed/leitura.
- (d) `peca_foto` NOT NULL default false — front nunca manda null (manda false); RPC COALESCE como cinto.
