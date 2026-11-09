# Dikey Hikâye Reels Stüdyosu

Yazılan bir konudan grafik roman stilinde, seslendirmeli, dikey (9:16) hikâye
videoları üreten web uygulaması. Kullanıcı konuyu yazar; senaryoyu ve karakter
kartlarını onaylar; kareler, ses ve zamanlama arka planda üretilir; önizleme
ile indirilen MP4 aynı Remotion kompozisyonundan çıkar.

## Akış

1. **Konu** — konu, süre, ton, anlatım, isteğe bağlı ürün adı ve ikonu.
2. **Senaryo** — Claude yazar; metin düzenlenebilir ya da hazır düğmelerle
   yeniden yazdırılır. Onaylanmadan devam edilmez.
3. **Karakterler** — her karakter için kart üretilir; tek tek onaylanır. Bu
   sırada kare planı da hazırlanır, böylece üretim düğmesinde kare sayısı ve
   kredi maliyeti görünür.
4. **Üretim** — kareler paralel üretilir, her kare Claude ile kontrol edilir,
   gerekirse otomatik düzeltilir. Paralelde ses üretilir, sessizlikler kırpılır,
   kare zamanları hesaplanır.
5. **Önizleme ve dışa aktarma** — Remotion Player, zaman çizelgesi, kare
   yenileme, kart düzenleme; kartlı ve temiz iki MP4 (1080x1920, 30 fps).

## Kurulum

Gerekenler: Node 22+, ffmpeg (PATH'te), bir Supabase projesi, Anthropic,
Replicate ve ElevenLabs anahtarları.

1. `npm install`
2. Supabase projesi aç; `supabase/migrations/0001_init.sql` dosyasını SQL
   düzenleyicide çalıştır (ya da `supabase db push`).
3. Supabase Auth ayarlarında Site URL'i `APP_URL` yap, yönlendirme adreslerine
   `APP_URL/auth/confirm` ekle. Kendi kullanımın için e-posta onayını
   kapatabilirsin (Authentication > Providers > Email > Confirm email).
4. `.env.example` dosyasını `.env.local` olarak kopyala ve doldur. En az:
   `APP_URL`, `SUPABASE_*`, `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`,
   `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `INNGEST_DEV=1`, `ADMIN_EMAILS`.
5. İki terminalde:
   - `npm run dev`
   - `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`
6. `http://localhost:3000` adresinde hesap oluştur. Yeni hesaba 200 kredi
   tanımlanır; daha fazlası için Yönetim sayfasındaki "Kredi yükle" formunu kullan.

R2 değişkenleri boşsa dosyalar `.data/storage` klasörüne yazılır ve imzalı,
süreli adreslerle sunulur; tek makinede kişisel kullanım için yeterlidir.
Remotion Lambda değişkenleri boşsa render aynı makinede yapılır.

### Yayına alırken

- **R2:** `R2_*` değişkenlerini doldur; kod değişikliği gerekmez.
- **Inngest Cloud:** `INNGEST_DEV` değişkenini kaldır, `INNGEST_EVENT_KEY` ve
  `INNGEST_SIGNING_KEY` ekle, uygulamayı Inngest'e `/api/inngest` adresiyle tanıt.
- **Replicate webhook:** `APP_URL` https olduğunda ve `REPLICATE_WEBHOOK_SECRET`
  girildiğinde sonuçlar `/api/webhooks/replicate` üzerinden alınır; yoklama yedek
  olarak çalışmaya devam eder.
- **Remotion Lambda:** fonksiyonu ve siteyi Remotion CLI ile kur
  (`npx remotion lambda functions deploy`, `npx remotion lambda sites create src/remotion/index.ts`),
  `REMOTION_AWS_REGION`, `REMOTION_FUNCTION_NAME`, `REMOTION_SERVE_URL` değerlerini gir.
  AWS kimlik bilgileri `REMOTION_AWS_ACCESS_KEY_ID` / `REMOTION_AWS_SECRET_ACCESS_KEY`
  olarak okunur. Bu yol yazıldı ama gerçek bir AWS hesabıyla denenmedi.
- **ffmpeg:** sessizlik kırpma ffmpeg çağırır. ffmpeg bulunmayan sunucusuz
  ortamlarda `FFMPEG_PATH` / `FFPROBE_PATH` ile bir ikili dosya göster.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` / `npm start` | Üretim derlemesi |
| `npm run lint` / `npm run typecheck` | Kod denetimi |
| `npm test` | Birim testleri: etiket/metin eşleşmesi, kelime hizalama, trim_map dönüşümü, kare zamanları, kartlar |
| `npm run test:db` | Göçü, RLS'yi ve kredi rezerve/iade fonksiyonlarını geçici bir yerel Postgres veritabanında sınar |
| `node scripts/render-local.mjs props.json out.mp4` | Kompozisyonu elle render eder |

## Yapı

| Yol | İçerik |
| --- | --- |
| `src/app/(auth)`, `src/app/(app)` | Giriş/kayıt; pano, yeni proje, proje sayfası, krediler, ayarlar, yönetim |
| `src/components/project` | Beş adımın ekranları ve canlı durum yoklaması |
| `src/server/actions` | Sunucu eylemleri (kredi rezervi, durum geçişleri, olay gönderimi) |
| `src/server/pipeline` | Üretim adımları: senaryo, kare planı, kalite kontrol, ses, zaman çizelgesi, render |
| `src/inngest` | Inngest fonksiyonları: dayanıklı adımlar, yeniden deneme, eşzamanlılık sınırı |
| `src/lib/pipeline` | Saf mantık ve sabit prompt blokları (birim testli) |
| `src/lib/ai` | Claude, Replicate, ElevenLabs istemcileri |
| `src/lib/storage.ts` | R2 ya da yerel disk; imzalı adresler |
| `src/remotion` | Video kompozisyonu (Player ve render aynı kodu kullanır) |
| `src/i18n/tr.ts` | Arayüzdeki tüm metinler |
| `supabase/migrations` | Şema, RLS, kredi fonksiyonları |

## Üretim hattı

| Adım | Inngest fonksiyonu | Not |
| --- | --- | --- |
| A script.generate | `script-generate` | İçerik denetimi, yapılandırılmış JSON, etiket doğrulaması ve düzelttirme |
| B characters.generate | `characters-generate` | Karakter başına ayrı çalışma, paralel |
| C frames.plan | `production-prepare` | Senaryo onayından hemen sonra, kartlarla paralel |
| D frames.generate + E frames.qc | `frames-generate` | Eşzamanlılık `IMAGE_CONCURRENCY`; en fazla 2 otomatik düzeltme, sonra "gözden geçir" |
| F audio.generate + G timeline.build | `production-run` | Karelerle paralel |
| H render.video | `render-video` | Önce kartlı, sonra temiz varyant |

Her adım çıktısını veritabanına yazar ve var olan çıktıyı yeniden üretmez.
Replicate çağrıları ayrı dayanıklı adımlardır; sunucu yeniden başlasa da
tamamlanan görsel için ikinci kez ödeme yapılmaz.

## Krediler

- Kredi, işlem başlamadan rezerve edilir; adım başarısız olursa aynı referansla
  iade edilir. Rezerv ve iade veritabanı fonksiyonlarıdır ve referans üzerinden
  idempotenttir.
- Fiyatlar `app_settings.pricing` satırında: senaryo 2, karakter kartı 3, kare 3,
  seslendirme 30, render 5, kare yenileme 3. Otomatik kalite düzeltmeleri ve
  başarısız karenin yeniden denenmesi ücretsizdir.
- Gerçek API maliyeti `api_costs` tablosuna yazılır; Yönetim sayfası proje
  başına maliyet, harcanan kredi ve marjı gösterir. Maliyetler
  `app_settings.api_prices` içindeki birim fiyatlarla hesaplanan tahminlerdir;
  kendi faturana göre güncelle.
- Sınırlar `app_settings.limits` satırında: aynı anda üretimde olabilecek proje
  sayısı ve günlük proje sayısı.

## Kararlar ve notlar

Şartnamede açık olmayan yerlerde en basit çözüm seçildi:

- **Ödeme yok.** İstek üzerine Stripe bağlanmadı. `src/lib/payments.ts`
  sağlayıcı arayüzünü tanımlar; krediler şimdilik Yönetim sayfasından yüklenir.
- **Supabase anahtarları tarayıcıya gitmez.** Tüm erişim sunucudadır; bu yüzden
  değişkenler `NEXT_PUBLIC_` önekli değildir. Canlı güncelleme, proje durumunu
  2,5 saniyede bir yoklayan bir uç noktayla yapılır (Supabase Realtime yerine).
- **İstemci rolleri yalnızca okur.** RLS ile herkes kendi satırlarını görür;
  yazma sunucuda `service_role` ile yapılır. Tek istisna: profildeki ayar sütunları.
- **Yönetici:** `ADMIN_EMAILS` içindeki e-postalar ya da `profiles.is_admin = true`.
  Yönetici, proje sayfasının altında olay günlüğünü görür.
- **Kare planı senaryo onayında yapılır** (şartnamedeki sıra: karakterlerden
  sonra). Böylece "Kareleri üret (46 kare, ... kredi)" düğmesi gerçek sayıyı gösterir.
- **Elle düzenlenen senaryo:** onayda yeni sürüm olarak kaydedilir, ses etiketleri
  Claude ile yeniden eklenir ve birebir eşleşme doğrulanır. Eşleşme sağlanamazsa
  yalnızca varsayılan etiket kullanılır (metin asla değişmez).
- **Karakter tarifi değişirse** kare planındaki eski tarif yeni tarifle
  değiştirilir; tarif her karede aynı kelimelerle kalır.
- **Kelime zamanlaması:** eleven_v3 zaman damgalı TTS uç noktasını destekliyor
  (denendi); karakter hizalaması kelimelere çevrilir, etiketler atılır. Hizalama
  gelmezse ya da metinle %10'dan fazla tutmazsa Scribe'a düşülür.
- **Korunan boşluklar:** sorun başlıkları, final sahnesi, "Göremediğin şey" ve
  kapanış öncesinde 0,55 sn bırakılır. Sessizlik zaten 0,55 sn'den kısaysa
  uzatılmaz.
- **"Tın" sesi** dosya olarak değil, kompozisyon içinde bellekte üretilir
  (1318 Hz, 0,6 sn, -9 dB, sönümlü).
- **Referans görseller:** R2 varsa imzalı adres verilir; yerel depolamada
  Replicate dosya deposuna yüklenir (Replicate yerel adrese erişemez).
- **Kalite kontrol** sonrası hâlâ sorunlu kareler "gözden geçir" olarak işaretlenir
  ve önizlemeye geçişi engellemez; kullanıcı kabul eder ya da ücretsiz yeniden dener.
- **E-posta bildirimi** bu sürümde gönderilmiyor (ayar saklanıyor, gönderici
  bağlı değil).
- **Claude reddi:** model bir isteği güvenlik nedeniyle reddederse adım "içerik
  kurallarına takıldı" mesajıyla durur ve kredi iade edilir.
- **shadcn/ui bileşenleri elle yazıldı** (geliştirme ortamından kayıt sunucusuna
  erişilemedi); aynı kalıpla `src/components/ui` altında.
- **Inter ve Poppins** pakete gömülü; derleme ve render dış ağa ihtiyaç duymaz.
- **Next.js 16:** `middleware` yerine `proxy` dosya adı; tüm sayfalar kullanıcıya
  özel olduğu için `cacheComponents` kapalı.
- **Hoş geldin kredisi:** `app_settings.signup_bonus_credits` (varsayılan 200).
