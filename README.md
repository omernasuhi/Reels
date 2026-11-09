# Dikey Hikâye Reels Stüdyosu

Yazılan bir konudan grafik roman stilinde, seslendirmeli, 2-3 dakikalık dikey (9:16)
hikâye videoları üreten web uygulaması.

## Durum

Yapım sekiz aşamalı ilerliyor. Şu an **1. aşama (iskelet)** tamam:

| Aşama | Kapsam | Durum |
| --- | --- | --- |
| 1 | Kimlik doğrulama, pano, veri modeli, tema, sözlük | Tamam |
| 2 | Konu formu seçenekleri, senaryo üretimi, düzenleme ve onay | Sırada |
| 3 | Karakter kartları, onay akışı, R2 | Bekliyor |
| 4 | Kare planı, paralel üretim, kalite kontrol, canlı ızgara | Bekliyor |
| 5 | Ses, zamanlama, sessizlik kırpma | Bekliyor |
| 6 | Remotion kompozisyonu, önizleme, zaman çizelgesi, kart düzenleme | Bekliyor |
| 7 | Render (iki varyant), indirme | Bekliyor |
| 8 | Ödeme, maliyet sayfası, sınırlar | Bekliyor |

## Kurulum

1. `npm install`
2. Bir Supabase projesi aç; `supabase/migrations/0001_init.sql` dosyasını SQL
   düzenleyicide (ya da `supabase db push` ile) çalıştır.
3. `.env.example` dosyasını `.env.local` olarak kopyala; şimdilik yalnızca `APP_URL`
   ve `SUPABASE_*` değişkenleri gerekli.
4. Supabase Auth ayarlarında Site URL'i `APP_URL` yap ve yönlendirme adreslerine
   `APP_URL/auth/confirm` ekle.
5. `npm run dev`

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` / `npm start` | Üretim derlemesi |
| `npm run lint` / `npm run typecheck` | Kod denetimi |
| `npm test` | Birim testleri (Vitest) |
| `npm run test:db` | Göçü, RLS'yi ve kredi fonksiyonlarını geçici bir yerel Postgres veritabanında sınar |

## Yapı

- `src/app/(auth)` giriş ve kayıt; `src/app/(app)` oturum gerektiren ekranlar
  (pano, yeni proje, proje sayfası, krediler, ayarlar).
- `src/proxy.ts` her istekte oturumu yeniler, giriş yapmamış kullanıcıyı `/login`'e yollar.
- `src/i18n/tr.ts` arayüzdeki tüm metinler. Yeni dil: aynı yapıda bir dosya ekle,
  `src/i18n/index.ts` içine kaydet.
- `src/components/ui` shadcn/ui kalıbında temel bileşenler.
- `src/server` sunucu eylemleri ve oturum yardımcıları.
- `supabase/migrations` şema; `supabase/tests` veritabanı testleri.

## Kararlar ve notlar

Şartnamede açık olmayan yerlerde en basit çözüm seçildi:

- **Supabase anahtarları tarayıcıya hiç gitmiyor.** Tüm Supabase erişimi sunucuda
  (sunucu bileşenleri ve sunucu eylemleri). Bu yüzden değişkenler `NEXT_PUBLIC_` önekli
  değil: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- **İstemci rolleri yalnızca okur.** RLS ile herkes kendi satırlarını görür; tüm yazma
  işlemleri sunucuda `service_role` ile yapılır. Tek istisna: kullanıcı kendi profilinde
  yalnızca `locale`, `default_voice_id`, `notify_email` sütunlarını değiştirebilir
  (sütun düzeyinde yetki). Kredi bakiyesi istemciden değiştirilemez.
- **Kredi rezerve/iade veritabanı fonksiyonlarıyla** (`reserve_credits`,
  `refund_credits`, `grant_credits`). Hepsi bir `ref` anahtarı üzerinden idempotent:
  aynı adım yeniden çalışırsa ikinci kez ücret düşmez, aynı iade iki kez yapılmaz.
- **Hoş geldin kredisi:** yeni hesaba `app_settings.signup_bonus_credits` kadar kredi
  verilir (varsayılan 200; bir 2-3 dakikalık videoya yaklaşık yeter). İstemiyorsan 0 yap.
- **Fiyatlar ve sınırlar** `app_settings` tablosunda (`pricing`, `limits`).
- **Şartnameye ek sütunlar/tablolar:** `profiles` (is_admin, locale, default_voice_id,
  notify_email), `projects.cover_image_url`, `scripts.vote_options`,
  `frames.replicate_prediction_id`, `cards.enabled`, `credit_transactions.kind/ref`,
  `api_costs` (gerçek USD maliyeti), `project_events` (olay günlüğü), `app_settings`.
- **shadcn/ui bileşenleri elle yazıldı.** Geliştirme ortamından shadcn kayıt sunucusuna
  erişilemedi; bileşenler aynı kalıpla (cva, `cn`, `components.json`) `src/components/ui`
  altında. `npx shadcn add ...` ile yenileri eklenebilir.
- **Inter yazı tipi pakete gömülü** (`@fontsource-variable/inter`); derleme sırasında
  dış ağa ihtiyaç duymaz.
- **Tema** çerezde tutulur (varsayılan koyu), sunucuda okunur; ilk boyamada titreme olmaz.
- **Next.js 16:** `middleware` yerine `proxy` dosya adı kullanılıyor. Tüm sayfalar
  kullanıcıya özel olduğu için `cacheComponents` kapalı.
- **Proje başlığı** senaryo yazılana kadar konunun ilk cümlesinden türetilir.
- `.env.example` içindeki sonraki aşamalara ait değişken adları (R2, Inngest, Remotion,
  Stripe), ilgili aşamada resmi dokümanlara göre kesinleşecek.
