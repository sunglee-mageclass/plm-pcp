#!/usr/bin/env node
/**
 * Copia os arquivos do Storage do projeto ANTIGO (Lovable) para o NOVO.
 *
 * Uso:
 *   OLD_URL=...  OLD_SERVICE_KEY=...  NEW_URL=...  NEW_SERVICE_KEY=... \
 *   node migracao/copiar-storage.mjs
 *
 * As *service role keys* ficam em Project Settings → API de cada projeto.
 * NUNCA commite essas chaves. Passe por variável de ambiente, como acima.
 *
 * Idempotente: usa upsert; pode rodar de novo sem duplicar.
 */
import { createClient } from "@supabase/supabase-js";

const { OLD_URL, OLD_SERVICE_KEY, NEW_URL, NEW_SERVICE_KEY } = process.env;
if (!OLD_URL || !OLD_SERVICE_KEY || !NEW_URL || !NEW_SERVICE_KEY) {
  console.error("Defina OLD_URL, OLD_SERVICE_KEY, NEW_URL, NEW_SERVICE_KEY.");
  process.exit(1);
}

const OLD = createClient(OLD_URL, OLD_SERVICE_KEY, { auth: { persistSession: false } });
const NEW = createClient(NEW_URL, NEW_SERVICE_KEY, { auth: { persistSession: false } });

const BUCKETS = [
  "tenant-logos", "tecido-variantes", "artigos", "aviamentos", "modelos",
  "oc-tecido", "oc-aviamento", "comprovantes", "lancamentos",
];

/** Lista recursiva de todos os caminhos de arquivo de um bucket. */
async function listAll(client, bucket, prefix = "") {
  const out = [];
  let offset = 0;
  const PAGE = 100;
  for (;;) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      // Itens "pasta" não têm id; descem mais um nível.
      if (item.id == null) out.push(...await listAll(client, bucket, path));
      else out.push(path);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

let totalOk = 0, totalErr = 0;

for (const bucket of BUCKETS) {
  let paths;
  try {
    paths = await listAll(OLD, bucket);
  } catch (e) {
    console.error(`! bucket ${bucket} ignorado: ${e.message}`);
    continue;
  }
  console.log(`\n=== ${bucket} (${paths.length} arquivos) ===`);
  for (const path of paths) {
    try {
      const { data: blob, error: dErr } = await OLD.storage.from(bucket).download(path);
      if (dErr) throw dErr;
      const { error: uErr } = await NEW.storage.from(bucket).upload(path, blob, {
        upsert: true,
        contentType: blob.type || undefined,
      });
      if (uErr) throw uErr;
      totalOk++;
      process.stdout.write(".");
    } catch (e) {
      totalErr++;
      console.error(`\n  ! ${bucket}/${path}: ${e.message}`);
    }
  }
}

console.log(`\n\nConcluído. OK: ${totalOk} · Erros: ${totalErr}`);
process.exit(totalErr > 0 ? 1 : 0);
