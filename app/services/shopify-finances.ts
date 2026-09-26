export function formatPayoutRows(
  payouts: Array<{
    status: string;
    amount: string;
    currency: string;
    issuedAt: string;
  }>,
) {
  return payouts.map((payout) => [
    payout.status.charAt(0).toUpperCase() + payout.status.slice(1),
    `${payout.currency} $${parseFloat(payout.amount).toFixed(2)}`,
    new Date(payout.issuedAt).toLocaleDateString(),
  ]);
}
