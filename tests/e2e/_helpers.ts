import { type Page, expect } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
// Loja com dados onde o robô exercita forms/fluxos (super_admin troca via TenantSwitcher).
export const STORE = process.env.E2E_STORE || "Loja Teste";

// Login robusto contra corrida de hidratação SSR (clicar antes de hidratar dispara
// o submit nativo do <form>). Tenta até 3x, recarregando.
export async function doLogin(page: Page) {
  if (!EMAIL || !PASSWORD) {
    throw new Error("Defina E2E_EMAIL e E2E_PASSWORD no .env (usuário de teste dedicado).");
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto("/auth", { waitUntil: "networkidle" });
    await page.fill("#login-email", EMAIL);
    await page.fill("#login-password", PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    try {
      await page.waitForURL("**/home", { timeout: 15_000 });
      return;
    } catch {
      if (attempt === 3) throw new Error("Login não chegou em /home após 3 tentativas.");
    }
  }
}

// Super_admin: seleciona a loja no TenantSwitcher (sidebar, sob "Loja em visualização")
// para as telas terem dados. Persiste no usuário (users.tenant_id via setActiveTenant).
export async function selectStore(page: Page, name = STORE) {
  // Trigger = o combobox dentro do bloco que contém "Loja em visualização".
  const switcher = page
    .locator('div:has(> div:has-text("Loja em visualização"))')
    .getByRole("combobox")
    .first();
  await switcher.click();
  const wanted = page.getByRole("option", { name, exact: false });
  if (await wanted.count()) {
    await wanted.first().click();
  } else {
    const first = page.getByRole("option").first();
    const txt = (await first.textContent())?.trim();
    await first.click();
    console.log(`[selectStore] loja "${name}" não encontrada; usando "${txt}".`);
  }
  // O switch refaz as queries (limpa cache). Espera assentar.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}
