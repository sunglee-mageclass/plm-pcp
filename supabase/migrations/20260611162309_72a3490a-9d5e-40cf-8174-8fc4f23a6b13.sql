
DROP POLICY "Insert tenant" ON public.tenants;
CREATE POLICY "Bootstrap own tenant" ON public.tenants FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM public.users WHERE id = auth.uid() AND tenant_id IS NOT NULL
    )
  );
