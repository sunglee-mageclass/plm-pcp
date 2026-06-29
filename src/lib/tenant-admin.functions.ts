import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { emailSchema } from "@/lib/email";

async function assertTenantAdmin(supabase: any, userId: string) {
  const [{ data: roleRow }, { data: userRow }] = await Promise.all([
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "tenant_admin")
      .maybeSingle(),
    supabase.from("users").select("tenant_id").eq("id", userId).maybeSingle(),
  ]);
  if (!roleRow) throw new Error("Forbidden: tenant_admin only");
  if (!userRow?.tenant_id) throw new Error("Forbidden: no tenant assigned");
  return userRow.tenant_id as string;
}

export const createStoreUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      nome: z.string().min(1).max(255),
      email: emailSchema,
      password: z.string().min(6).max(100),
    }),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await assertTenantAdmin(context.supabase, context.userId);
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
      tenant_id: tenantId,
      nome: data.nome,
      email: data.email,
      role: "user",
      ativo: true,
    });
    if (uErr) {
      await supabaseAdmin.auth.admin.deleteUser(uid);
      throw new Error(uErr.message);
    }
    await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
    await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: "user" as any });
    return { id: uid };
  });

export const savePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      user_id: z.string().uuid(),
      perms: z.array(
        z.object({
          pagina: z.string().min(1).max(64),
          pode_ver: z.boolean(),
          pode_editar: z.boolean(),
        }),
      ),
    }),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await assertTenantAdmin(context.supabase, context.userId);

    // Verify target user is in same tenant
    const { data: target } = await context.supabase
      .from("users")
      .select("tenant_id")
      .eq("id", data.user_id)
      .maybeSingle();
    if (!target || target.tenant_id !== tenantId) {
      throw new Error("Forbidden: user not in your store");
    }

    // Replace all permissions for this user in this tenant
    const { error: delErr } = await context.supabase
      .from("user_permissions")
      .delete()
      .eq("user_id", data.user_id);
    if (delErr) throw new Error(delErr.message);

    if (data.perms.length > 0) {
      const rows = data.perms.map((p) => ({
        user_id: data.user_id,
        tenant_id: tenantId,
        pagina: p.pagina,
        pode_ver: p.pode_ver,
        pode_editar: p.pode_editar,
      }));
      const { error: insErr } = await context.supabase.from("user_permissions").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }
    return { ok: true };
  });
