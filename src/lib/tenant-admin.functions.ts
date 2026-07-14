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
  .validator(
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
    const { error: rErr } = await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: "user" as any });
    if (rErr) {
      // Compensa: sem papel o usuário não acessa nada. Desfaz users + auth.
      await supabaseAdmin.from("users").delete().eq("id", uid);
      await supabaseAdmin.auth.admin.deleteUser(uid);
      throw new Error(rErr.message);
    }
    return { id: uid };
  });

// Admin da loja exclui um usuário da PRÓPRIA loja (espelha deleteUser, mas escopado ao
// tenant + bloqueia self e super_admin). Audit_log preservado (sem FK, com snapshot).
export const deleteStoreUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ user_id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const tenantId = await assertTenantAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) throw new Error("Você não pode excluir a si mesmo.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: target } = await supabaseAdmin
      .from("users")
      .select("tenant_id, role")
      .eq("id", data.user_id)
      .maybeSingle();
    if (!target || target.tenant_id !== tenantId) {
      throw new Error("Usuário não pertence à sua loja.");
    }
    if (target.role === "super_admin") {
      throw new Error("Não é permitido excluir um super_admin.");
    }

    await supabaseAdmin.from("user_permissions").delete().eq("user_id", data.user_id);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    await supabaseAdmin.from("users").delete().eq("id", data.user_id);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const savePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
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
