# Rift denetimi — ikinci düzeltme grubu

7 Eylül 2026. Geliştirme önizlemesi: `localhost:3020`, `RIFT UI Preview`, `codex/reference-ui-rebuild`. Bu kayıt ilk PDF raporundan sonra tamamlanan işleri içerir.

## Tamamlanan değişiklikler

| Sorun | Yeni davranış |
|---|---|
| Aynı sohbete eşzamanlı istekler iki worker başlatabiliyordu | Convex üzerinde kullanıcıya ve sohbet kimliğine bağlı atomik başlangıç kaydı alınır. Yeni sohbet, geçici sohbet, yeniden üretme ve otomatik devam aynı kapıdan geçer. Trigger isteği kayıt kimliğiyle idempotenttir. |
| Geç gelen eski worker yeni işi etkileyebiliyordu | Worker, kullanıcı içeriğine ve araçlara erişmeden kendi kaydını etkinleştirir. Eski/iptal edilmiş kayıt reddedilir. Kuyrukta 90 saniyeden uzun kalmak tek başına geçerli işi düşürmez; yeni rezervasyon ile etkinleştirme yarışı atomik olarak çözülür. |
| Stop, henüz run kimliği oluşmadan etkisiz kalabiliyordu | Başlangıç kaydı da iptal edilir. Dosya hazırlığı sonrasında ve dispatch öncesinde kayıt tekrar kontrol edilir. Belirsiz iptal başarılı gösterilmez. |
| Başlangıç sırasında token veya kayıt yazımı hatası sohbeti kilitleyebiliyordu | Doğrulanmış iptal, run'a bağlanmış veya henüz bağlanmamış aynı başlangıç kaydını bırakır. Yeni neslin kaydı korunur. Kabul edilip edilmediği bilinmeyen dispatch için kayıt körlemesine silinmez. |
| Eski run temizliği yeni terminali veya erişim yetkisini kapatabiliyordu | PTY oturumları run kapsamında tutulur. OpenCode lease silme ve yenileme işlemleri Redis Lua ile aynı run'ı karşılaştırır. İptal edilmiş lease yenilemeyle yeniden oluşturulamaz. |
| Eski run sohbetin durumunu/görev listesini değiştirebiliyordu | Worker'ın dört bitiş/stream temizleme çağrısı beklenen run kimliğini Convex transaction'ına iletir. Farklı veya temizlenmiş run kaydı güncellenmez. |
| Otomatik devam kısa süreli `run_active` yanıtında kesiliyordu | Gerçek HTTP 409 sözleşmesi korunur. 1/2/4 saniye aralıklarla en fazla üç kez aynı gizli mesaj/body denenir. Her retry yeni mesaj veya yeni continuation sayacı oluşturmaz. Stop, reset, unmount ve mod değişimi beklemeyi iptal eder. 500 ve belirsiz hatalar tekrarlanmaz. |
| Agents/Runs/Tasks kontrollerinin klavye anlamı tutarsızdı | Agents gerçek sekmelerde tek Tab durağı, ok tuşları, Home/End ve etiketli panel kullanır. Runs ve Tasks filtreleri `aria-pressed` düğmeleridir. Odak göstergesi nötr ve klavyeye özeldir. |
| Dosya indirme/kopyalama başarısızlığı görünmüyordu | Artifacts görünür hata, tekrar deneme ve gerektiğinde seçilebilir metin sunar. Kapanmış/değişmiş önizlemeye geç gelen sonuç yeni içeriği etkileyemez. |
| Studio'dan giriş sonrası bağlam kayboluyordu | Giriş/kayıt ve fiyatlandırma akışları güvenli `/studio` dönüş yolunu korur. |
| Bağlantısı kesilmiş kayıt hâlâ “running for” diyordu | Gerçek çalışma durumu dışında başlangıç veya son aktivite zamanı gösterilir; tamamlanmış süre gösterimi korunur. |
| Agents sayfası geliştirme uyarısı üretiyordu | Sekme düğmesinin React `key` yerleşimi düzeltildi; temiz masaüstü yüklemesinde uyarı tekrar oluşmadı. |

## Doğrulama

- Tek birleşik Jest çalıştırmasında **32 suite / 407 test başarılı, 0 başarısız, 0 atlanan**. Kayıt: [second-pass-test-summary.json](./second-pass-test-summary.json).
- TypeScript `tsc --noEmit`, değişen alanların ESLint kontrolleri ve `git diff --check` temiz.
- Geliştirme Convex deployment'ına claim modülü ve sohbet güncelleme koşulları gönderildi. TLS kontrolü kapatılmadı; Node'un sistem sertifika deposu kullanıldı. Convex'e özel tsconfig bulunmadığından CLI typecheck yerine projedeki tüm üretim TS kaynaklarını kapsayan kök TypeScript kontrolü çalıştırıldı.
- İki bağımsız HTTP istemcisiyle gerçek geliştirme Convex transaction yarışında **9/9 kontrol geçti**: tek kazanan, yanlış claim/run reddi, aktif kayıt korunması, released kaydın dirilmemesi ve yeni neslin geç cleanup'tan korunması. [Canlı kayıt](./claim-race-live.json). Sentetik kimlikler kullanıldı; gerçek sohbet, model veya Trigger işi başlatılmadı. Tek sentetik audit satırı released durumda bırakıldı.
- Lease testleri izole yerel Redis Unix socket üzerinde gerçek Lua yürüttü; uygulama Redis kimlik bilgileri kullanılmadı.
- Trigger geliştirme worker'ı yeniden derlendi ve hazır. Son rutin dispatcher heartbeat'i başarıyla tamamlandı; bu bir gerçek model görev başarısı ölçümü değildir.

## Masaüstünde görülenler

CUA ile `RIFT UI Preview` incelendi. Ana ekranın açık ve koyu temalarında chatbox odağı nötr çerçeve gösterdi. Files doğrudan macOS dosya seçicisini açtı; seçim yapılmadan kapatıldı. Settings hesap menüsünde görüldü. Agents'ta sağ ok ve Home sekmeyi ve odağı birlikte değiştirdi. Runs Running filtresi doğru boş durumu gösterdi. Studio koyu temada açıldı ve runtime ready durumuna geçti.

İnceleme sırasında PTY'nin Node bağımlılığının tarayıcıya taşındığı derleme hatası yakalandı; paylaşılan sabitler ayrı tarayıcı güvenli modüle taşındı. Ekran yeniden açıldı. Agents liste anahtarı uyarısı da temiz reload ile yeniden üretilip giderildi. Önizleme sonunda açık temada ana ekrana döndürüldü.

## Açık sınırlar

Bu doğrulama tüm sayfaların her ekran boyutunda görsel onayı veya rakiplerle eşit koşullarda model başarı benchmark'ı değildir. Kurulu üretim RIFT uygulaması ve production web dağıtımı bu çalışmanın çıktısı olarak doğrulanmadı.

OpenCode'un kalıcı session abort API'si atomik beklenen run parametresi sunmuyor: güncel claim okuması ile uzak abort arasında dar bir servisler arası yarış ihtimali kalıyor. İlk lease oluşturma hâlâ ayrı bir işlem; burada karşılaştırmalı koruma revoke/refresh için uygulandı. Hazırlık kontrolü ile mesaj kaydı ayrı transaction'lar olduğundan, özellikle geliştirmede çok uzun duraksamalar için mesaj kalıcılığının da claim koşuluyla aynı transaction'a taşınması sonraki sertleştirme işidir. Yerel/background veya native OpenCode dosya değişikliklerinin tüm doğrulama kayıtlarını geçersizleştirmesi ve devam zincirinin bütünüyle sunucuya taşınması da açık kapsamdır.

Rakip değerlendirmesinin kaynakları ve karşılaştırılabilir canlı benchmark eksikliği ilk raporda korunur. Test sayısı bir agent güç puanı olarak yorumlanmamalıdır.
