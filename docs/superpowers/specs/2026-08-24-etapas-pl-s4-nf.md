# Etapas PL — S4 (Notas Fiscais no bloco PL) — Design

**Data:** 2026-08-24 · **Sub-projeto:** Etapas PL / S4 · **Depende de:** Fase 1 (colunas `pt_*` + `salvar_terceirizados`), S3 (nada)

## Objetivo

Anexar **Notas Fiscais** a um bloco de serviço PL: uma **lista** de NFs de **Saída** e uma **lista** de NFs de **Entrada**, num painel único "Notas Fiscais" dentro do bloco PL do sheet do PCP. Cada NF = arquivo + data. Visualização/preview via signed URL (imagem/PDF).

## Decisões (confirmadas com o dono)

1. **Lista por direção** (não arquivo único): cada direção é uma lista de NFs `[{url, data}]` → 2 colunas **jsonb** em `producao_terceirizados`: `nf_saida` e `nf_entrada` (default `[]`).
2. **Painel único** "Notas Fiscais": Saída + Entrada lado a lado, numa posição fixa do bloco PL (rodapé do bloco), **não** dividido por etapa.
3. **Bucket novo dedicado** `pcp-servicos` (privado, tenant-scoped): path `{tenant}/{blocoId}/...`; 4 policies (select/insert/update/delete) copiadas do padrão invariante #2 (`(storage.foldername(name))[1] = get_user_tenant_id()`).

## Estado atual (reuso)

- Componente **`NfList`** (`src/components/oc-tecido/NfList.tsx`) já existe e é rotulado "Notas Fiscais", genérico: `value: {url,data}[]`, `onChange`, `uploadFn`, `bucket`, `readOnly`. Renderiza cada NF via `FileField` (badge clicável → Dialog preview: `<img>`/`<iframe>` PDF/`<a>`), com data por nota e botão limpar. **S4 usa `NfList` direto — zero UI nova.**
- `FileField` usa `useSignedUrl(path, bucket)` (`src/hooks/useSignedUrl.ts`, `createSignedUrl(path, 3600)`, cache por 60s) — funciona com qualquer bucket privado tenant-scoped.
- Helper de upload `uploadFile(file, prefix)` (`src/components/oc-tecido/shared.ts`): `path = {tenant}/{prefix}/{uuid}-{sanitizeStorageName(name)}`, `supabase.storage.from(BUCKET).upload(...)`. **Porém** `BUCKET` ali é fixo `"oc-tecido"` — S4 precisa de um `uploadFn` que aponte para `pcp-servicos`. Criar um `uploadFn` local (ou parametrizar) que use o bucket novo.
- Bloco PL: `Bloco` type (`pcp.servicos.$modeloId.tsx` ~:121-154), load `blocosFromRows` (~:657-686), save payload `_blocos.map()` (~:886-916) — **payload é estado COMPLETO** (todo campo tem que ir, senão zera). `pt_data_saida/pt_data_entrada/pt_aprovacao` já foram adicionados nos 3 pontos + na RPC — as colunas nf_ seguem o MESMO caminho.
- `salvar_terceirizados` (`20260821130000_salvar_terceirizados_pt.sql`): `FOR b IN jsonb_array_elements(_blocos)` com UPDATE (SET col-a-col) e INSERT (col+VALUES) explícitos. As 2 colunas jsonb nf_ entram no SET e no INSERT (idioma: `COALESCE(b->'nf_saida','[]'::jsonb)`).
- `producao_terceirizados` é greenfield em NF (0 colunas nf_).

## Arquitetura

### DB
- Migration 1: `ALTER TABLE producao_terceirizados ADD COLUMN nf_saida jsonb NOT NULL DEFAULT '[]'::jsonb, ADD COLUMN nf_entrada jsonb NOT NULL DEFAULT '[]'::jsonb;` (idempotente, IF NOT EXISTS).
- Migration 1 (mesmo arquivo): bucket `pcp-servicos` + 4 policies tenant-scoped. Bucket criado via `INSERT INTO storage.buckets (id, name, public) VALUES ('pcp-servicos','pcp-servicos', false) ON CONFLICT DO NOTHING;` (os buckets antigos foram criados fora de migration, mas criar via SQL é válido e idempotente). Policies em `storage.objects` com `bucket_id='pcp-servicos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text` (select/insert/update/delete, TO authenticated), espelhando `comprovantes`/`oc-tecido`.
- Migration 2: `salvar_terceirizados` (CREATE OR REPLACE, diff-validado): adicionar `nf_saida`/`nf_entrada` ao SET do UPDATE e ao col+VALUES do INSERT (`COALESCE((b->'nf_saida'),'[]'::jsonb)`). Restatar REVOKE se o padrão da função exigir (verificar ACL atual). **Só esse delta.**

### Front (`pcp.servicos.$modeloId.tsx`)
- `Bloco` type: `+ nf_saida: NfItem[]; nf_entrada: NfItem[];` (importar `NfItem` de `NfList`).
- `blocosFromRows`: `nf_saida: Array.isArray(r.nf_saida) ? r.nf_saida : []` (com `as any` p/ coluna fora do types.ts), idem entrada.
- payload `_blocos.map()`: `nf_saida: b.interno ? [] : b.nf_saida, nf_entrada: b.interno ? [] : b.nf_entrada` (só PL/externo tem NF; interno zera — espelha `pt_*`).
- Painel "Notas Fiscais" no bloco PL (guard `!b.interno`): um `<div className="col-span-full rounded-md border ...">` com título "Notas Fiscais" e 2 colunas: `<NfList value={b.nf_saida} onChange=... uploadFn={uploadNfServico} bucket="pcp-servicos" readOnly={!podeEditar} label...>` para Saída e outra para Entrada. Usar o mesmo box highlight do `EtapasPlPanel` p/ consistência visual.
- `uploadNfServico(file)`: helper local que faz `path = {tenant}/{blocoId}/{uuid}-{sanitize(name)}` no bucket `pcp-servicos`. (blocoId disponível no escopo do bloco.)
- Colaboração: nf_saida/nf_entrada entram no snapshot de dirty e no merge? São arrays — o guard de unsaved já cobre por comparação de snapshot; o merge 3-vias por bloco trata como campo (last-write no array inteiro; aceitável — NFs raramente editadas em concorrência). Confirmar no plano que o `_rev_base` cobre.

## Fora de escopo (S4)
- Extração/validação de dados da NF (número, valor, XML) — só anexo de arquivo + data.
- Vincular NF a parcela específica — S4 anexa ao bloco, não à parcela.
- S5 (peça de foto) — sub-projeto próprio.

## Riscos
- (a) `uploadFile` de `shared.ts` tem bucket fixo — NÃO reusar direto; criar `uploadFn` com o bucket novo (senão grava no bucket errado).
- (b) bucket novo precisa das 4 policies OU o upload/preview falha por RLS — testar upload+signed URL após a migration.
- (c) colunas jsonb NOT NULL DEFAULT '[]' — garantir que o front nunca manda `null` (mandar `[]`); a RPC usa `COALESCE(...,'[]')` como cinto e suspensório.
- (d) diff-validação do `salvar_terceirizados` (função grande) obrigatória.
