# RIFT CLI — OpenCode kaynak tabanına geçiş

## Amaç

`rift` komutu, OpenCode kaynak kodundan derlenen RIFT CLI'ı açar. GPT ve diğer desteklenen RIFT modelleri aynı arayüzde, `/models` menüsünde ve aynı oturum altyapısında çalışır. Mevcut RIFT hesabı ve kredi sistemi kullanılır.

## Yaklaşım seçimi

1. **Kaynak fork'u (önerilen):** OpenCode kaynak kodu ayrı RIFT CLI deposunda, sabitlenmiş upstream commit üzerinden geliştirilir. İsim, terminal arayüzü, hesap bağlantısı, paketleme ve güncellemeler RIFT'e uyarlanır. Upstream düzeltmelerini almak için değişiklikler küçük ve belirgin tutulur.
2. **Mevcut binary'yi sarmalamak:** Daha hızlıdır; ancak OpenCode markası ve iki ayrı motor sorunu bütünüyle çözülemez. Kullanıcının istediği kaynak seviyesinde uyarlamayı karşılamaz.
3. **Terminali tamamen yeniden yazmak:** En fazla kontrolü verir; OpenCode'un mevcut oturum, araç, izin ve terminal davranışlarını yeniden geliştirmeyi gerektirir. Bu geçiş için seçilmez.

## Kaynak ve marka

- Resmi kaynak: https://github.com/anomalyco/opencode.
- Uygulamaya başlarken uygun release etiketi ve tam commit kimliği doğrulanıp sabitlenir; geliştirme hareketli `dev` dalına bağlanmaz.
- Yerel kaynak deposu için hedef: `/Users/cetto/RIFT-CLI`. Dizin mevcutsa içeriği incelenir, üzerine yazılmaz.
- Komut ve ürün adı RIFT / `rift` olur. Açılış logosu, başlıklar, yardım metinleri, sürüm çıktısı, hesap ekranları ve ürün bağlantıları RIFT'e uyarlanır.
- Kullanıcı ayarları ve verileri RIFT'e ait dizinlerde tutulur. Uyumluluk gerektiren dahili protokol isimleri körlemesine değiştirilmez.
- Upstream lisans ve telif bildirimleri dağıtımda korunur.

## Çalışma mimarisi

- Varsayılan CLI çalışma motoru yalnızca OpenCode kaynak tabanlı RIFT olur; model seçimi motor değiştirmez.
- RIFT servisinin model kataloğu GPT modellerini de içerir. Model yetenekleri, araç çağrıları ve reasoning seçenekleri model bazında eşlenir.
- Kimlik doğrulama, `rift login` ve oturum kontrolü RIFT akışına bağlanır. Mevcut giriş güvenli biçimde devralınır; ayrı OpenCode hesabı gerekmez.
- Model çağrıları RIFT sunucusu üzerinden gider. Sağlayıcı anahtarları CLI'a verilmez; fiyatlandırma ve kredi düşümü sunucu tarafında kalır.
- Mevcut Responses geçidinin GPT ve diğer modellerle uyumluluğu doğrulanır. Gerekli adaptasyonlar RIFT geçidinde yapılır; sağlayıcıya doğrudan ücretlendirmesiz kaçış yolu açılmaz.
- Model değişikliği aynı oturumda yeni istekleri etkiler. Devam eden araç çalışırken model değişimi bir sonraki turda uygulanır; paralel belirsiz istek başlatılmaz.

## Oturumlar, araçlar ve hatalar

- Dosya okuma/yazma, komut çalıştırma, onay isteme, iptal ve oturumu yeniden açma OpenCode'un yerleşik mekanizmalarından uyarlanır.
- İzinler kullanıcıya açıkça gösterilir; yazma ve komut çalıştırma onay politikası korunur.
- Başlangıç/bağlantı hataları ve kredi yetersizliği görünür ve anlaşılır olur. Tamamlanıp tamamlanmadığı belirsiz model çağrıları otomatik yeniden gönderilmez.
- OpenCode tabanlı eski RIFT geçmişi uyumluysa doğrulanmış kopyalama ile devralınır. Codex geçmişi korunur; uyumluluğu doğrulanmadan çalıştırılabilir oturuma dönüştürülmez.

## Kurulum ve geçiş

- Önce mevcut macOS makinesinde kaynak derleme ve test yapılır, sonra `~/.local/bin/rift` doğrulanmış sürüme atomik geçirilir.
- Önceki kurulum geri dönüş için saklanır. Global OpenCode kurulumu ve ilgisiz çalışma dosyaları korunur.
- `rift opencode` eski kullanım için uyumluluk takma adı olabilir; aynı RIFT motorunu açar.
- İlk teslim bağımsız RIFT CLI'dır. Masaüstü uygulamasının gömülü terminali ayrı istemci kullandığından, onun motor geçişi sonraki açık adımdır; CLI değişince kendiliğinden değişmiş sayılmaz.
- Her yerden kurulum için üretim RIFT servis adresi ve dağıtım gerekir. Yerel servisle doğrulanan sürüm kamuya yayınlanmış diye sunulmaz.

## Kabul ölçütleri

1. `rift`, `rift --help` ve `rift --version` RIFT markasını ve doğru sürümü gösterir.
2. Tek `/models` menüsünde yetkili GPT ve diğer modeller görünür; seçim kaydedilir.
3. En az bir GPT ve bir GPT dışı modelle gerçek hesap üzerinden dosya okuma, onaylı düzenleme/komut, araç sonucundan devam ve kredi kaydı doğrulanır. Diğer modellerin durumu tek tek raporlanır.
4. Aynı oturumda model değişimi, uygulamayı kapatıp yeniden açma ve geçmişten devam çalışır.
5. İzin reddi, Ctrl+C, bağlantı kopması, zaman aşımı ve yetersiz kredi senaryoları test edilir.
6. Kurulum, geri dönüş, bağımsız veri dizinleri ve lisans dosyaları doğrulanır.

## Teslim sırası

Kaynak ve derleme → RIFT marka/komut/veri dizinleri → hesap ve birleşik model kataloğu → araç/oturum/ücretlendirme testleri → yerel kurulum ve kullanım doğrulaması.
