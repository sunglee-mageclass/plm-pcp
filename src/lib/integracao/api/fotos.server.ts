// Integração › Gerar JSON — links assinados das fotos (só no servidor/Worker). Service role SÓ para assinar o bucket "modelos"
// (mesma chamada de `assinarFotos` do `rota.server.ts` da API — Opus-M2/anti-drift: `rota.server.ts` é o ÚNICO dono do service
// role da API e nenhum arquivo o importa estaticamente, então o Gerar JSON tem este módulo próprio de 1 função).
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function assinarFotosModelos(caminhos: string[], validade: number): Promise<Map<string, string | null>> {
  const { data, error } = await supabaseAdmin.storage.from("modelos").createSignedUrls(caminhos, validade);
  if (error) throw error;
  return new Map((data ?? []).map((d) => [d.path ?? "", d.error ? null : (d.signedUrl ?? null)]));
}
