# WorkOS Setup Guide for Rift

Bu kılavuz, Rift uygulamasında WorkOS kimlik doğrulamasını tam olarak kurmak için gereken tüm adımları içerir.

## 1. WorkOS Hesabı Oluşturma

1. [https://workos.com/](https://workos.com/) adresine gidin
2. "Sign Up" ile ücretsiz hesap oluşturun
3. Email doğrulamasını tamamlayın

## 2. WorkOS Application Oluşturma

1. WorkOS Dashboard'a gidin
2. "Applications" → "New Application" tıklayın
3. Aşağıdaki bilgileri girin:
   - **Name**: Rift
   - **Environment**: Development
   - **Type**: Single Page Application (SPA)
4. "Create Application" tıklayın

## 3. Client ID ve API Key Alma

Dashboard'da oluşturduğunuz application'a gidin:

- **Client ID**: `client_xxxxx` formatında (kopyalayın)
- **API Key**:
  - "API Keys" sekmesine gidin
  - "Generate API Key" tıklayın
  - `sk_test_xxxxx` formatında (kopyalayın)

## 4. Redirect URI Yapılandırma

Application ayarlarında "Redirect URIs" bölümüne ekleyin:

```
http://127.0.0.1:3010/callback
http://localhost:3010/callback
http://localhost:3000/callback
```

## 5. Environment Variables Güncelleme

`.env.local` dosyanızı açın ve WorkOS ile ilgili değişkenleri güncelleyin:

```bash
# WorkOS Authentication
WORKOS_API_KEY=sk_test_SİZİN_API_KEYİNİZ
WORKOS_CLIENT_ID=client_SİZİN_CLIENT_IDNİZ
WORKOS_COOKIE_PASSWORD=SİZİN_GÜVENLİ_PAROLANIZ
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://127.0.0.1:3010/callback
```

### WORKOS_COOKIE_PASSWORD Oluşturma

Terminal'da şu komutu çalıştırarak güvenli bir parola oluşturun:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Çıkan sonucu `WORKOS_COOKIE_PASSWORD` olarak kullanın.

## 6. Middleware'i Orijinal Haline Getir

`middleware.ts` dosyasında yorum satırlarını kaldırarak authkit'i aktifleştirin:

```typescript
// Bu satırları uncomment yapın:
const { session, headers, authorizationUrl } = await authkit(request, {
  redirectUri: getRedirectUri(),
  eagerAuth: true,
  onSessionRefreshError: ({ error }) => {
    if (isRateLimitError(error)) {
      refreshHitRateLimit = true;
      console.warn(
        "[Auth Middleware] WorkOS rate limit hit during session refresh",
      );
    }
  },
});
```

Ve demo mode satırlarını silin:

```typescript
// Bu satırları silin:
// Demo mode: Skip authentication for UI preview
// const session = { user: null };
// const headers = new Headers();
// const authorizationUrl = null;
```

## 7. Billing Portal Action'ı Geri Yükle

`lib/actions/billing-portal.ts` dosyasını orijinal haline getirin:

```typescript
export default async function redirectToBillingPortal() {
  const { organizationId, user } = await withAuth();

  if (!user?.id) {
    throw new Error("User not authenticated");
  }

  if (!organizationId) {
    throw new Error("No organization found");
  }

  // ... geri kalan kod
}
```

## 8. ConvexClientProvider'ı Geri Yükle

`components/ConvexClientProvider.tsx dosyasını orijinal haline getirin:

```typescript
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [convex] = useState(() => {
    const client = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    return client;
  });

  return (
    <AuthKitProvider onSessionExpired={noop}>
      <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuthKit}>
        {children}
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}
```

## 9. Server'ı Yeniden Başlat

```bash
# Önce çalışan server'ı durdur
pkill -f "next dev"

# Yeniden başlat
pnpm run dev
```

## 10. Test Etme

1. Tarayıcıda http://localhost:3000 açın
2. "Sign in" veya "Get started" butonuna tıklayın
3. WorkOS login sayfasına yönlendirilmelisiniz
4. Test kullanıcı oluşturun veya WorkOS ile kayıt olun
5. Rift uygulamasına geri yönlendirilmelisiniz

## Ek Notlar

### Production İçin

Production'a deploy ederken:

- Development API Key yerine Production API Key kullanın
- Redirect URI'ları production domain'inize göre güncelleyin
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI`'yi production URL olarak ayarlayın

### Test Kullanıcıları

WorkOS Dashboard'da test kullanıcıları oluşturabilir veya:

- Google ile sign-in test edebilirsiniz
- Email/password ile test kullanıcı oluşturabilirsiniz

### Sorun Giderme

**"Empty password" hatası:**

- `WORKOS_COOKIE_PASSWORD` değişkeninin doğru ayarlandığından emin olun
- `.env.local` dosyasını güncelledikten sonra server'ı yeniden başlattığınızdan emin olun

**"Invalid redirect URI" hatası:**

- WorkOS Dashboard'da redirect URI'larınızın doğru ayarlandığından emin olun
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI` ile dashboard'daki URI'nın aynı olduğundan emin olun

**"Client not found" hatası:**

- `WORKOS_CLIENT_ID`'nin doğru kopyalandığından emin olun
- Application'ın "Development" environment'ında olduğundan emin olun

## Tam Environment Variables Örneği

```bash
# Deployment used by `npx convex dev`
CONVEX_DEPLOYMENT=anonymous:anonymous-rift
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211

# WorkOS Authentication
WORKOS_API_KEY=sk_test_SİZİN_API_KEYİNİZ
WORKOS_CLIENT_ID=client_SİZİN_CLIENT_IDNİZ
WORKOS_COOKIE_PASSWORD=SİZİN_GENERATED_PAROLANIZ
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://127.0.0.1:3010/callback

# AI Providers
OPENROUTER_API_KEY=sk-or-v1-SİZİN_OPENROUTER_KEY
OPENAI_API_KEY=sk-proj-SİZİN_OPENAI_KEY
E2B_API_KEY=e2b_SİZİN_E2B_KEY
E2B_TEMPLATE=terminal-agent-sandbox

# App Configuration
NEXT_PUBLIC_BASE_URL=http://127.0.0.1:3010
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3010

# Payment
STRIPE_SECRET_KEY=sk_test_SİZİN_STRIPE_KEY

# Other
CENTRIFUGO_TOKEN_SECRET=REPLACE_WITH_A_NEW_RANDOM_SECRET
CENTRIFUGO_WS_URL=ws://localhost:8000/connection/websocket
TRIGGER_PROJECT_ID=proj_SİZİN_TRIGGER_ID
TRIGGER_SECRET_KEY=tr_dev_SİZİN_TRIGGER_SECRET
```

## Kurulum Sonrası

WorkOS kurulumu tamamlandıktan sonra:

1. Server'ı yeniden başlatın
2. http://localhost:3000 açın
3. Sign in/Sign up akışını test edin
4. Authentication başarılı olmalı ve Rift UI görüntülenmeli
