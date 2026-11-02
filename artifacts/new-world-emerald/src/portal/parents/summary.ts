/** The smallest card payment Paystack takes here, in kobo (₦100). Mirrors the server. */
export const MIN_CARD_KOBO = 10_000;

/**
 * What the parent will pay, matching how the server settles: the wallet is used first, then the card amount.
 * `customKobo` is the amount typed under "Pay a different amount" (null means pay exactly what is owed).
 */
export function paymentSummary(selectedKobo: number, walletKobo: number, customKobo: number | null) {
  const walletUsedKobo = Math.min(walletKobo, selectedKobo);
  const exactKobo = selectedKobo - walletUsedKobo;
  const toPayKobo = customKobo === null ? exactKobo : customKobo;
  const extraToWalletKobo = Math.max(0, toPayKobo - exactKobo);
  const leftOwingKobo = Math.max(0, exactKobo - toPayKobo);
  let problem: string | null = null;
  if (selectedKobo <= 0) problem = "Choose at least one fee.";
  else if (!Number.isSafeInteger(toPayKobo) || toPayKobo < 0) problem = "Enter a valid amount.";
  else if (toPayKobo > 0 && toPayKobo < MIN_CARD_KOBO) problem = "The smallest online payment is ₦100.";
  else if (toPayKobo === 0 && walletUsedKobo === 0) problem = "Enter the amount to pay.";
  return { walletUsedKobo, exactKobo, toPayKobo, extraToWalletKobo, leftOwingKobo, problem };
}

/** Naira typed by a parent ("85,000" or "85000.50") as kobo, or null if it is not a number. */
export function parseNaira(text: string): number | null {
  const clean = text.replace(/[₦,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}
