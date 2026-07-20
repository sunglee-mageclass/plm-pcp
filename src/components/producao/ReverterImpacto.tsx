import { useReverterImpacto } from "@/hooks/useReverterImpacto";

/**
 * Texto de impacto dentro do AlertDialog de "Voltar uma etapa".
 * Lista o que será desfeito e, se houver conta paga, mostra o bloqueio.
 * Reusa a mesma query (dedupe do React Query) que o pai usa p/ desabilitar o botão.
 */
export function ReverterImpacto({ cadId, open }: { cadId: string | undefined; open: boolean }) {
  const { data, isLoading } = useReverterImpacto(cadId, open);

  if (isLoading || !data) {
    return <span>Isso desfaz o corte e volta o modelo para a Explosão.</span>;
  }

  if (data.temPaga) {
    return (
      <span className="text-destructive">
        Não é possível voltar: há {data.contasPagas} conta(s) a pagar de serviço já <strong>paga(s)</strong>.
        Cancele o pagamento antes de reverter.
      </span>
    );
  }

  const partes = [
    data.servicos > 0 ? `${data.servicos} serviço(s)` : null,
    data.contas > 0 ? `${data.contas} conta(s) a pagar` : null,
    data.cq > 0 ? `${data.cq} controle(s) de qualidade` : null,
  ].filter(Boolean);

  return (
    <span>
      Isso desfaz a baixa de estoque (corte); o modelo sai do CQ/Serviços e volta pra Explosão.
      {partes.length > 0 ? (
        <>
          {" "}Serão <strong>desfeitos</strong>: {partes.join(", ")}. Ação irreversível.
        </>
      ) : (
        <> Nada mais precisa ser desfeito.</>
      )}
    </span>
  );
}
