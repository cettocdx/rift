# Modelden bağımsız Build harness geçişi

Kullanıcı kararı: GPT, Claude ve diğer modeller kalacak; Build çalışma sistemi Claude Code'un bağlam → araçlarla eylem → doğrulama yaklaşımını izleyecek. Anthropic Agent SDK kullanılmıyor; tüm modeller için ortak Rift harness'i geliştiriliyor.

## Uygulama kapsamı

1. OpenCode worker dalını, rollout seçimini, yeni sandbox imajı kurulumunu ve eski smoke başlatıcısını devreden çıkar. Mevcut model/provider/effort, billing, claims, cancellation, UI ve dosya geçmişini koru.
2. Plan'ın mevcut bulut projesini salt okunur keşfetmesini sağla; genel Build görevlerini zorunlu web-app ve preview talimatlarından ayır.
3. Delegasyonu gerçek, araç kullanan, sınırlı ve salt okunur araştırma/inceleme alt ajanlarına dönüştür. Aynı dosyaya paralel yazma açılmaz.
4. Tamamlanmış model/araç adımlarını sahiplik denetimli kalıcı checkpoint ile koru; iptal/yeni tur/eski worker yarışlarına karşı sınırla. Yarım kalmış dış araç etkilerini otomatik replay-safe olarak sunma.
5. Deterministik harness, policy, claim, provider/effort ve regresyon testleri; TypeScript, lint, dev worker kontrolü.

## Geçiş sınırları

Eski OpenCode sohbetleri per-chat sandbox kimliğinde; native sohbetler per-user kimlikte olabilir. Dosyaları taşımadan mevcut kimlik korunur. Sandbox version değiştirilmez. Convex'teki opsiyonel eski session alanları geçmiş uyumluluğu için kalır. Eski proxy yalnız daha önce verilmiş lease'lerin bitmesini destekler; yeni Build worker OpenCode lease'i oluşturmaz. Arşiv adapter modülleri yeni uygulama akışına bağlı değildir.

Tam kaynak ve karşılaştırma: [Claude Build reference](claude-build-reference.md).

## Tamamlanan uygulama ve doğrulama

- Build worker tüm modelleri tek native `createAgentStream` üzerinden çalıştırıyor. Eski OpenCode rollout flagleri çalıştırma yolunu geri açamıyor; Docker kurulumu ve eski smoke başlatıcısı kaldırıldı/devre dışı bırakıldı. Sandbox version yükseltilmedi, mevcut dosyalar yerinde kaldı.
- Plan buluttaki dosya/dizinleri salt okunur açabiliyor. Tüm Build model promptları genel inceleme, eylem ve işe uygun doğrulama akışını kullanıyor.
- Alt ajanlar parent'ın son izin katmanındaki okuma araçlarını kullanıyor; 6 adım/12 tool/90 saniye sınırları ve kullanım denetimi var. Parent Stop ve approval reddi alt ajanı da durduruyor.
- Tamamlanan canonical assistant/tool geçmişi transaction kontrollü checkpoint'e kaydediliyor. Adım başlamadan işaret bırakılıyor; commit başarısızlığı yeni provider/tool adımını durduruyor. İstek içeriği hash'i, kullanıcı, chat, run/claim ve model eşleşmeleri korunuyor.
- İptal ve bitmiş istekler otomatik canlandırılmıyor; eski worker transcript yazamıyor. Kurtarılan desteklenen tool geçmişi yeni yan etkiler başlamadan kalıcı sohbet mesajına aktarılıyor. Sohbet ve hesap silme checkpoint'leri de temizliyor.
- Kalıcı sohbetlerin boş Trigger payload yerine Convex'ten yüklenen mesajlarından checkpoint request seçmesi gerçek masaüstü denemesinde düzeltilip yeniden doğrulandı.

**685 test geçti:** 58 suite'deki 661 test + ayrı 24 prompt snapshot testi. TypeScript, scoped ESLint ve diff kontrolü geçti. İki bağımsız istemciyle Dev Convex'te 38 canlı invariant kontrolü geçti. Sayı eski UI/worker regresyonlarını da içerir; tamamı harness benchmark'ı değildir.

Masaüstü: GPT-5.6 Sol yeni fixture'da iki dosya oluşturup Node testini çalıştırdı; Claude Sonnet 5 aynı dosyaları değiştirmeden tekrar doğruladı. Üç denemenin her birinde 3 test geçti, 0 başarısız. Son Claude run'ında kalıcı kaydın gerçekten `finished`, adım 2, `stop` olduğu backend'den okundu. İlk GPT denemesi 4 tool çağrısı talebine rağmen 5 çağrı kullandı; bu talimat takibi kusuru ölçümde saklanmadı. Sonraki iki Claude denemesi tek terminal çağrısı kullandı.

Kanıtlar: [test özeti](native-harness-test-summary.json), [masaüstü denemeleri](native-harness-desktop-smoke.json), [38 canlı checkpoint kontrolü](checkpoint-live.json).

## Gerçek sınırlar

- Bu, tüm modeller için Rift'in kendi harness'idir; Anthropic Agent SDK veya Claude Code'un birebir kapalı iç uygulaması değildir. Claude yaklaşımı uygulandı; rakiplere üstünlük veya aynı başarı oranı iddia edilmiyor.
- Alt ajanlar şimdilik salt okunur araştırma/inceleme yapar. Kod değiştirme ve terminal doğrulaması ana ajan tarafından yürütülür.
- Crash sırasında sonucu belirsiz araçlar otomatik tekrar yürütülmez. Böyle bir durumda mevcut dosyaları inceleyerek devam etmesi için yeni kullanıcı talimatı gerekir. Exactly-once dış yan etki garantisi yoktur.
- 750KB üzerindeki checkpoint geçmişinde çalışma devam eder, otomatik crash recovery kalıcı olarak kapatılır. Model fallback'i/servis edilen model değişimi de yanlış modelin reasoning geçmişini taşımamak için recovery'yi kapatır. Kayıpsız UI'ya dönüştürülemeyen tool sonuçları otomatik restore edilmez.
- Kullanıcı mesajını değiştirmeden aynı bitmiş attempt'i tekrar oynatmak engellenir. İlk explicit regenerate ayrı fingerprint kullanır; tekrar aynı regenerate için yeni kullanıcı talimatı gerekebilir.
- Gerçek deneme Cloud/E2B'de yapıldı. Masaüstü yerel dosya grant köprüsü korunuyor; tam yerel terminal harness eşitliği bu geçişte tamamlanmış sayılmıyor.
- Canlı MCP yükleme denemesinde GitHub ve Stripe bağlantı hataları görüldü; 7/9 bağlantı açıldı. Bu iki OAuth bağlantısının sağlıklı olduğu iddia edilmiyor. Çok sayıda önceden yüklenen MCP şeması küçük işlerde bağlam yükü oluşturabiliyor; tembel araç keşfi sonraki performans işi.
- Değişiklikler yerel UI Preview, Trigger dev ve Dev Convex'te doğrulandı. Üretim dağıtımı ve yeni sandbox imajı yayını yapılmadı; eski sandbox'ta duran OpenCode binary'si çalıştırılmıyor.
