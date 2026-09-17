# RIFT Proje Botları ve Market Tasarımı

Durum: Uygulama öncesi tasarım önerisi. Bu belge yeni özelliklerin kodlandığı anlamına gelmez.

Araştırma: [Bot ve MCP Market Araştırması](../../audits/2026-09-09/bot-marketplace-research.md).

## Yaklaşım

Üç seçenek değerlendirildi:

1. **RIFT’e ait kalıcı bot modeli ve mevcut harness; Registry destekli market.** Önerilen yaklaşım. Proje verisi, sohbet, skill ve görevler RIFT içinde kalır. Doğrudan OAuth korunur. Daha fazla veri modeli ve entegrasyon işi gerektirir.
2. **Yönetilen bağlantı platformunu merkez yapmak.** Smithery veya Composio bazı entegrasyonları hızlandırabilir. Ek hesap, maliyet ve çalışma zamanı bağımlılığı oluşturur; bu sağlayıcılar bot/proje modelinin yerine geçmez.
3. **Mevcut agent roster’ını yalnızca yeniden adlandırmak.** Hızlı görsel sonuç verir; kalıcı bot sohbeti, proje üyeliği ve toplantı ihtiyacını karşılamaz.

Uygulama dört bağımsız teslim dilimine ayrılır. Önce bot kimliği ve sohbet, ardından görev/toplantı, market ve açılış kabuğu. Her dilim kendi doğrulamasıyla tamamlanır; boş düğmelerle bütün ekranların var olduğu izlenimi oluşturulmaz.

## 1. Proje botu ve özel sohbet

Proje ekranına Bots görünümü eklenir. Solda kompakt bot listesi, merkezde seçili botun özel sohbeti bulunur. Sağdaki profil paneli varsayılan kapalıdır; bot adına basılınca açılır. Agent Activity, kısa süreli alt görevlerin çalışma görünümü olarak kalır. Kalıcı bot ile bir defalık subagent aynı kayıt sayılmaz.

Bot ekleme akışı: rol seç → ad/sorumluluk/skill paketi önizle → projeye ekle → özel sohbeti aç. Eklemek tek başına görev başlatmaz. Eksik bağlantılar profilde görünür ve ilgili sağlayıcının Connect akışına gider. Bütün araçlar ve botlar varsayılan olarak etkinleştirilmez.

Başlangıç rolleri: proje koordinatörü, mühendis, tasarımcı, kalite uzmanı, araştırmacı, içerik uzmanı, video uzmanı ve operasyon uzmanı. Her şablon sürümlü rol açıklaması, ihtiyaç duyduğu girdiler, teslim çıktıları, bitiş koşulları ve seçili skill kimliklerini içerir. Kullanıcı adını, sorumluluğu, modelini, skill’lerini ve görevlerini değiştirebilir.

Yeni proje botları mevcut profile referansla oluşturulur, fakat proje içindeki değişiklikler diğer projelerdeki botları sessizce değiştirmez. Profil ve skill paketi sürümü bot üzerinde saklanır. Kullanıcının yaptığı değişiklikler yeni şablon sürümü geldiğinde ezilmez. Şablon güncelleme açık bir eylemdir.

### Kalıcı kayıtlar

- `project_bots`: owner, project, template/profile referansı ve sürümü, ad, görev tanımı, avatar anahtarı, model/effort, skill seçimi, bağlantı referansları, arşiv durumu, zaman damgaları.
- Mevcut `chats`: isteğe bağlı bot referansı ve konuşma türü. Botun ana sohbeti oluşturma sırasında atomik olarak bağlanır; çift tıklama iki ana sohbet oluşturmaz.
- Mevcut `tasks`: isteğe bağlı project ve assigneeBot referansları. Eski görevler değişmeden çalışır.

Her mutasyon kimliği sunucudaki oturumdan alır. Bot, proje, sohbet ve bağlantı sahipliği birlikte doğrulanır. Model/runtime talimatları yalnızca istemcinin gönderdiği bot adından türetilmez. Mevcut `runtime-policy.ts` üzerinden sunucuda çözümlenen profile bağlanır.

Bot sohbeti ortak ChatRouteShell ve retained conversation davranışını kullanır. Ayrı, zayıf bir streaming arayüzü oluşturulmaz. Ekrandan çıkmak iptal değildir; Stop eylemi gerçek çalışma kimliğine yönelir. Botun Active işareti durable run durumundan türetilir, yerel süre sayacıyla canlılık uydurulmaz.

### Bot kimlikleri

Avatarlar RIFT’in parçalı işaretinden türetilir. Her rolün ayırt edici geometrik ayrıntısı olur; aynı Grok karakterleri veya mevcut ayrıntılı hayvan çizimleri kullanılmaz. Küçük ölçekte az çizgi, net siluet ve kontrollü renk kullanılır. Çalışma/dinlenme/hata göstergesi avatardan bağımsızdır.

## 2. Görevler, rutinler ve toplantı

Bot profilinde Tasks görünümü, atanmış işlerin kısa listesini sunar. Görev; başlık, amaç, beklenen çıktı, zamanlama ve sorumlu bot içerir. Mevcut Convex tasks/task_runs scheduler ve Trigger yürütmesi tekrar kullanılır. Proje ve bot referansları dispatch sırasında yeniden doğrulanır.

İlk toplantı modeli yazılıdır: proje, gündem, katılımcılar, isteğe bağlı zaman ve ortak konuşma. Sesli toplantı bu tasarımda uygulanmış gibi gösterilmez; ayrı medya/ses yürütmesi gerektirir. Toplantı, hemen başlatılabilir veya mevcut scheduler üzerinden zamanlanabilir.

Bir koordinatör işi katılımcılara sınırlandırılmış görevler halinde dağıtır. Yalnızca seçili/atanmış botlar çalışır. Başlangıçta en çok altı katılımcı ve iki eşzamanlı uzman çalışması kullanılır; bu sınırlar açık ürün ayarıdır. Her mesajda tüm botlar çağrılmaz. İki uzman aynı dosyayı değiştirecekse değişiklik işi sıraya alınır.

Toplantı mesajları gerçek bot ve run kimliği taşır. Tek model yanıtı farklı avatarlarla sahte çoklu konuşma olarak gösterilmez. Çıktı; katılımcı katkıları, karar özeti ve önerilen görevlerdir. Önerilen görevleri kaydetmek/atamak görünür bir kullanıcı eylemidir. Dış hizmetlere yazma ve mesaj gönderme mevcut onay politikalarına tabidir.

`bot_meetings` kaydı: owner/project, katılımcılar, gündem, conversation, schedule/task referansı ve durum. Başlatma anahtarı tekrar dispatch’i engeller. Aynı çalışmayı tekrar almak mesajları çoğaltmaz. Bir katılımcı hata alırsa toplantı kısmi sonuç ve ilgili durumla tamamlanabilir; hata sessizce başarıya çevrilmez.

Arşivlenen bot yeni görev alamaz. Planlı işleri transaction içinde pasifleştirilir. Aktif işi varsa arşivleme ekranı çalışmanın durumunu açık gösterir; arşivleme ile iptal aynı işlem sayılmaz. Geçmiş ve karar kayıtları korunur.

## 3. Plugin ve bot marketi

Plugins ekranı aynı ölçülerde satırlardan oluşur: 40 px logo alanı, 24 px optik logo sınırı, isim, tek/iki satır açıklama, sağda tek bağlantı eylemi. 13 px isim ve 12 px ikincil metin mevcut uygulama fontuyla kullanılır. Geniş ekranda iki sütun, dar panelde tek sütun. Bağlı kayıtlar aynı sağlayıcı için tekrar listelenmez.

Keşif kaynağı, resmî Registry’den sunucu tarafında alınır. Sürüm/aktiflik ayıklanır; veri önbelleğe ve kalıcı son başarılı snapshot’a yazılır. Registry kesilirse mevcut katalog kullanılabilir kalır. İlk sürüm yalnızca desteklenen remote HTTP/SSE transportlarını bağlar; STDIO kayıtları kurulmuş gibi gösterilmez.

RIFT curated kayıtları sağlayıcı logosu, kategori ve doğrulanmış bağlantı bilgisi için önceliklidir. Dinamik kayıtlar namespace+version ile ayrı kaynak kimliği taşır. Katalog metadata’sı talimat olarak yürütülmez. Uzak ikonlar için kontrollü yükleme ve tek boyutlu fallback kullanılır; bulunmayan resmî logonun yerine yanlış bir marka işareti konmaz.

Bağlantı durumları: idle → authorizing/configuring → verifying → connected; ayrıca cancelled ve needs_attention. OAuth state/PKCE ve mevcut endpoint güven kontrolleri korunur. Callback sahibi başlangıç sahibiyle eşleştirilir. Bir oturum, yalnızca protokol başlangıcı/araç listeleme başarılı olduktan sonra connected olur. OAuth penceresi kapandığında kart kullanılabilir duruma döner.

Smithery/Composio adaptörleri ayrı sağlayıcı arayüzü arkasında tutulabilir, ancak platform anahtarları tanımlanmadan bunlara bağlı çalışan düğmeler yayımlanmaz. Bu dilimin kabulü için yönetilen bir servis aboneliği zorunlu değildir.

Bot marketinde rol, skill paketi ve ihtiyaç duyulan bağlantılar ekleme öncesi gösterilir. Şablonun özel sohbeti, belleği veya kimlik bilgileri kopyalanmaz. Bağlantılar hesaba aittir ve yeni botta açıkça seçilir.

## 4. Açılış ve uygulama kabuğu

Gerçek boot ekranı ile kullanılabilir başlangıç ekranı ayrılır. Boot ekranında küçük RIFT logosu ve Recursive Intelligence for Technology açıklaması bulunur; büyük ufuk efekti ve bekleten giriş animasyonu kaldırılır. Hazır uygulama hemen görünür. Hata halinde kısa neden ve Retry gösterilir.

Başlangıç ekranı New chat, Open project ve son proje/bot erişimlerini sunar. Tipografi ve boşluklar mevcut çalışma ekranıyla aynıdır. Yeni pazarlama sayfası gibi davranmaz. React boot bileşeni ve native launch HTML aynı kaynak tasarımdan üretilir; renk/ölçek değişerek ikinci bir splash oluşmaz.

macOS traffic light bölgesi ve drag alanı korunur. Etkileşimli düğmeler drag bölgesinden hariçtir. Karanlık/açık tema, azaltılmış hareket ve pencere boyutu değişiklikleri ayrı kontrol edilir. Odak göstergesi nötr ve görünür olur; parlak mavi glow eklenmez.

## Doğrulama ve kabul

1. Aynı projeye bot ekleme, yeniden açma, ad/skill/görev değiştirip kalıcılığı doğrulama.
2. Aynı şablondan iki projede oluşturulan botların sohbet ve ayarlarının ayrılması; başka kullanıcı referanslarına erişimin reddi.
3. Botla gerçek mesajlaşma; görev sırasında sayfa değiştirme, geri dönme, tek nihai yanıt ve korunmuş okuma konumu.
4. Bot görevini bir kez/zamanlı başlatma; yeniden dispatch ve ağ kesintisinde mükerrer işlem olmaması.
5. Üç botlu yazılı toplantı; gerçek katılımcı run kimlikleri, kısmi hata durumu ve karar/görev ilişkisinin doğrulanması.
6. OAuth onaylama/iptal/yenileme, anahtar isteyen servis ve Registry kesintisi; sahte Connected durumu olmaması.
7. Yoğun akış ve uzun bot listesinde yazma, seçim ve sağ panel geçişi ölçümü. Üretim derlemesinde en az 30 etkileşim örneği; ana etkileşim p95 hedefi 100 ms altında. Sonuç ölçülmeden hedef gerçekleşti denmez.
8. Dark/light, dar/geniş pencere, klavye ve reduced-motion kontrolleri; mevcut normal sohbet, CLI ve izin testlerinin korunması.

Bu tasarımın tamamlanma ölçütü bütün kartların görünmesi değildir. Kalıcı bot kimliği, özel sohbet, görev ataması, toplantı yürütmesi ve doğrulanmış bağlantılar birlikte çalışmalı; ölçülmemiş hız/eşitlik iddiasında bulunulmamalıdır.
