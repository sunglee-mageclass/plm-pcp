import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertSuperAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: super_admin only");
}

export const createTenantUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      email: z.string().email(),
      password: z.string().min(6).max(100),
      nome: z.string().min(1).max(255),
      tenant_id: z.string().uuid(),
      role: z.enum(["admin", "user", "super_admin"]),
    }),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.nome },
    });
    if (authErr || !created.user) throw new Error(authErr?.message ?? "Erro ao criar usuário");

    const uid = created.user.id;
    const { error: uErr } = await supabaseAdmin.from("users").insert({
      id: uid,
      tenant_id: data.tenant_id,
      nome: data.nome,
      email: data.email,
      role: data.role,
      ativo: true,
    });
    if (uErr) {
      await supabaseAdmin.auth.admin.deleteUser(uid);
      throw new Error(uErr.message);
    }

    // ensure user_roles row (handle_new_user already inserts 'user')
    await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
    await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: uid, role: data.role as any });

    return { id: uid };
  });

export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({ user_id: z.string().uuid(), new_password: z.string().min(6).max(100) }),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.new_password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleUserAtivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ user_id: z.string().uuid(), ativo: z.boolean() }))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("users")
      .update({ ativo: data.ativo })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    // also ban/unban in auth
    await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      ban_duration: data.ativo ? "none" : "876000h",
    });
    return { ok: true };
  });
