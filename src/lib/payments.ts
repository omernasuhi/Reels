// Ödeme sağlayıcısı arayüzü. Bu sürümde bağlı bir sağlayıcı yok: krediler
// yönetici tarafından Yönetim sayfasından yüklenir. Stripe Checkout (ya da
// başka bir sağlayıcı) eklenirken bu arayüz uygulanır; kredi yükleme her
// zaman grant_credits(p_kind => 'purchase', p_ref => ödeme kimliği) ile yapılır,
// böylece aynı ödeme iki kez gelse de kredi bir kez yüklenir.

export type CreditPack = { id: string; credits: number; priceCents: number; currency: string };

export type CheckoutSession = { url: string };

export type CompletedPayment = { userId: string; packId: string; credits: number; paymentRef: string };

export interface PaymentProvider {
  readonly name: string;
  // Kullanıcıyı ödeme sayfasına yönlendirecek oturumu açar.
  createCheckout(args: { userId: string; pack: CreditPack; successUrl: string; cancelUrl: string }): Promise<CheckoutSession>;
  // Sağlayıcının webhook çağrısını doğrular; tamamlanan ödeme varsa döndürür.
  parseWebhook(request: Request): Promise<CompletedPayment | null>;
}

// Bağlı sağlayıcı. Stripe eklendiğinde burada döndürülür.
export function getPaymentProvider(): PaymentProvider | null {
  return null;
}
