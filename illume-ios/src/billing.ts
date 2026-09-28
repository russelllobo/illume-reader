// Port of BillingService.swift (StoreKit 2) -> expo-iap (OpenIAP, dev builds only).
// Product: illume.pro.monthly. Receipt/JWS is synced to Supabase `sync-apple-subscription`.
import { APPLE_PRODUCT_ID } from './lib';
import { syncAppleSubscription } from './supabase';

export const PRODUCT_IDS = [APPLE_PRODUCT_ID];

export async function loadProducts(): Promise<{ id: string; title: string }[]> {
  try {
    const { fetchProducts } = await import('expo-iap');
    const products = await (fetchProducts as any)({ skus: PRODUCT_IDS, type: 'subs' });
    return (products ?? []).map((p: any) => ({ id: p.id ?? p.productId, title: p.title ?? p.id }));
  } catch {
    return [];
  }
}

export async function purchasePro(accessToken: string): Promise<void> {
  const IAP = await import('expo-iap');
  const products = await (IAP.fetchProducts as any)({ skus: PRODUCT_IDS, type: 'subs' });
  const product = products?.[0];
  if (!product) throw new Error('Could not load Pro.');
  const purchase: any = await (IAP.requestPurchase as any)({
    sku: product.id ?? product.productId,
    andDangerouslyFinishTransactionAutomaticallyIOS: false,
  });
  try {
    const jws = purchase?.transactionReceipt ?? purchase?.purchaseToken ?? purchase?.jwsRepresentation ?? '';
    if (!jws) throw new Error('Purchase did not return a receipt.');
    await syncAppleSubscription({ signedTransactionInfo: String(jws) }, accessToken);
  } finally {
    try {
      await (IAP.finishTransaction as any)({ purchase, isConsumable: false });
    } catch {}
  }
}

export async function restorePro(accessToken: string): Promise<void> {
  const IAP = await import('expo-iap');
  const purchases: any[] = await (IAP.getAvailablePurchases as any)();
  const match = purchases.find((p) => (p.productId ?? p.product_id) === APPLE_PRODUCT_ID);
  if (!match) return;
  const jws = match.transactionReceipt ?? match.purchaseToken ?? '';
  if (!jws) return;
  await syncAppleSubscription({ signedTransactionInfo: String(jws) }, accessToken);
}
