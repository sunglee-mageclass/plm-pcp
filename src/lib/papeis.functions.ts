// #4d — Server functions de Papéis/roles customizados (presets de permissão POR LOJA).
// A authz (super_admin escolhe a loja / tenant_admin só a própria) é refeita DENTRO das RPCs
// (_papel_tenant_autorizado no banco), então estas fns servem os DOIS perfis: o client
// autenticado (context.supabase) carrega o token do usuário → auth.uid() correto na RPC.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const permSchema = z.object({
  pagina: z.string().min(1).max(64),
  pode_ver: z.boolean(),
  pode_editar: z.boolean(),
});

// Cria/atualiza um papel + suas permissões (delete+insert atômico no banco). _id null = novo.
export const salvarPapel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      id: z.string().uuid().nullable(),
      tenant_id: z.string().uuid(),
      nome: z.string().trim().min(1).max(120),
      descricao: z.string().trim().max(500).nullable(),
      perms: z.array(permSchema),
    }),
  )
  .handler(async ({ data, context }) => {
    const { data: pid, error } = await context.supabase.rpc("salvar_papel", {
      // _id (null = criar novo) e _descricao são nullable na RPC SQL, mas o types.ts gerado
      // os marca como string não-nula — cast pontual no argumento nullable (não no cliente todo).
      _id: data.id as string,
      _tenant_id: data.tenant_id,
      _nome: data.nome,
      _descricao: data.descricao as string,
      _perms: data.perms,
    });
    if (error) throw new Error(error.message);
    return { id: pid as string };
  });

// Exclui um papel (a RPC bloqueia se houver usuário vinculado).
export const excluirPapel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("excluir_papel", {
      _id: data.id,
      _tenant_id: data.tenant_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Vincula (ou desvincula, papel_id null) um usuário a um papel.
export const definirPapelUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      user_id: z.string().uuid(),
      papel_id: z.string().uuid().nullable(),
      tenant_id: z.string().uuid(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("definir_papel_usuario", {
      _user_id: data.user_id,
      _papel_id: data.papel_id as string, // null = desvincular (nullable na RPC; types marca não-nulo)
      _tenant_id: data.tenant_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
