# Cursor Agents ve Rift masaüstü karşılaştırması

7 Eylül 2026. Açık Cursor Agents ve RIFT UI Preview pencereleri bilgisayar kontrol aracıyla doğrudan incelendi. Ana ekran, sidebar, model menüsü, komut araması ve Cursor sidebar filtre menüsü kontrol edildi. İlgili Rift bileşenleri davranışları doğrulamak için okundu. Uygulama kodu bu incelemede değiştirilmedi.

Cursor koyu, Rift açık temadaydı. Bu nedenle renk/kontrast veya font rasterizasyonu için birebir eşdeğerlik iddiası yok. Cursor'un CSS font değerleri ölçülmedi. İnceleme, görünür yerleşim ve erişilebilen etkileşimler üzerinden yapıldı; performans, gerçek bir agent çalışmasının kalitesi veya bütün ürün yetenekleri test edilmedi. Açılan menüler kapatıldı; mesaj gönderilmedi, ayar veya model değiştirilmedi.

## Öncelikli bulgular

### 1. Proje ve sohbet ilişkisi görünür değil — yüksek

Cursor, konuşmaları ilgili repository altında gösteriyor. Sidebar filtre menüsünde Grouping, Ordering, Status ve Environment seçenekleri var. Rift, Projects ve Recent bölümlerini ayrı listeler halinde sunuyor. Proje satırının altında konuşmalar açılmıyor. Birden fazla projede çalışırken geçmişin hangi işe ait olduğu taranarak anlaşılamıyor.

Öneri: Proje → sohbet hiyerarşisi; proje dışı konuşmalar için ayrı bölüm. Mevcut dört ana menü korunabilir. Durum filtreleri bu yapıdan sonra eklenmeli.

Kod: [SidebarProjects.tsx](/Users/cetto/.codex/worktrees/rift/reference-ui/app/components/SidebarProjects.tsx:196), [SidebarHistory.tsx](/Users/cetto/.codex/worktrees/rift/reference-ui/app/components/SidebarHistory.tsx:124).

### 2. Boş dosya paneli ana çalışma alanını daraltıyor — yüksek

Rift ana ekranında sağ panel açık, dosyalar yüklenmemiş ve arama pasif. Ekranda yalnızca açıklama ve Browse workspace eylemi var. Cursor'un incelenen başlangıç ekranında bu tür bir boş yan panel bulunmuyor; Show Apps üzerinden ek alan açılabiliyor.

Öneri: Dosya paneli bağlam olduğunda veya kullanıcı talep ettiğinde açılsın. İlk açılışta gerekli dosya/klasör seçimi doğrudan sunulsun. Kullanıcının açık/kapalı tercihi sonraki oturumlarda korunsun. Bu, uzaktaki ortamı otomatik başlatmayı gerektirmez.

### 3. New chat ve Build aynı başlatma davranışına bağlı — yüksek

Kullanıcının istediği dört ana giriş mevcut, ancak New chat `launchMode("app")` çağırıyor; Build de aynı işlevi çağırıyor. Aktif Build alanında bu işlev yeni konuşma başlatabiliyor. Bir alanı açmak ile yeni konuşma yaratmak görsel olarak ayrı eylemlerken davranışları ayrılmamış.

Öneri: New chat yeni konuşma oluştursun; Build mevcut Build alanını/son çalışmayı açsın. Aynı ayrım Studio ve Hack Workbench için de açıkça tanımlansın. Kullanıcının istediği menü sırası değiştirilmesin.

Kod: [SidebarHeader.tsx](/Users/cetto/.codex/worktrees/rift/reference-ui/app/components/SidebarHeader.tsx:295).

### 4. Çalışma bağlamı farklı kontrollere dağılmış — yüksek

Cursor başlangıç ekranında çalışma kaynağı ve Cloud seçimi mesaj kutusunun üstünde yan yana duruyor. Rift'te ~/rift, No project ve Cloud altta, Workspace etiketi sağ panelde bulunuyor. Yerel yol, uygulama projesi ve yürütme ortamı arasındaki ilişki ilk bakışta açık değil. Bu, görünen etiketlerin yanlış olduğunu değil, anlamlarının yeterince açıklanmadığını gösteriyor.

Öneri: Seçili proje/klasör ve çalışma ortamı tek bir bağlam satırında toplansın. Yerel klasör, proje kaydı ve cloud workspace farklı kavramlarsa seçim menüsünde açıkça ayrıştırılsın. Kullanıcı başlamadan önce nerede çalışacağını anlayabilsin.

### 5. Komut araması ve sidebar aynı dili kullanmıyor — yüksek

Cursor araması All, Agents, Files, Actions ve Settings kapsamlarını gösteriyor; yakın konuşmaları proje ve durum bilgisiyle öne alıyor. Rift araması çalışıyor ve kısayolları var, ancak uzun Actions/Navigate listeleri yakın sohbetlerin önüne geçiyor. Dosya araması bu palete bağlı değil. Ayrıca Build sidebar'da Blocks, palette Hammer; Studio Images/Clapperboard; Plugins Plug/Blocks kullanıyor. Palette emekli Pentest notebook adı hâlâ mevcut.

Öneri: Ad, ikon, rota ve kısayollar ortak bir kayıt üzerinden gelsin. İlk görünüm yakın konuşmalar ve sık kullanılan eylemler olsun; dosya/sohbet/eylem kapsamları açıkça seçilebilsin. Mevcut klavye desteği korunmalı.

Kod: [ProCommandPalette.tsx](/Users/cetto/.codex/worktrees/rift/reference-ui/app/components/pro/ProCommandPalette.tsx:158).

### 6. Model ve düşünme ayarları parçalı — orta

Cursor model kontrolü Thinking, Context, Effort ve Model seçeneklerini bir menüde topluyor. Rift model listesinde sağlayıcı adı, etiket, bağlam ve yetenekler birlikte sunuluyor; düşünme düzeyi yanındaki ayrı düğmeye basılarak seviyeler arasında değişiyor. Kullanıcı bütün düşünme seçeneklerini aynı anda göremiyor. Native erişilebilirlik metninde bazı model satırlarında sağlayıcı adı tekrarlanıyor.

Öneri: Tek model ayarı menüsü; seçili model, düşünme seviyesi ve bağlam açıkça ayrı satırlarda gösterilsin. Ayrıntılı yetenek açıklaması ikinci düzeyde kalsın. Mevcut sağlayıcı ve model seçenekleri korunmalı.

### 7. Görev durumunu taramak zor — orta

Cursor sidebar'ında Needs attention ve Draft durumları görünür; filtre menüsünde Status bulunuyor. Rift sohbet satırları streaming, pinned ve branched göstergelerini destekliyor, fakat bu satır bileşeninde bekleyen onay, hata veya taslak için eşdeğer bir durum sunumu yok. Açık Recent listesi ağırlıklı olarak başlık ve zamandan oluşuyor.

Öneri: Taslak, çalışıyor, kullanıcı bekleniyor ve hata durumları gerçek görev verisine bağlansın. Durumlar metin/erişilebilir ad ve küçük bir göstergeyle sunulsun; yalnızca renge dayanmasın.

Kod: [ChatItem.tsx](/Users/cetto/.codex/worktrees/rift/reference-ui/app/components/ChatItem.tsx:332).

### 8. Görsel vurgu, çalışma akışından daha baskın — orta

Son düzenlemeden sonra Rift'in sidebar yazıları Cursor karşısında belirgin büyük görünmüyor. Yine de Rift'te büyük karşılama başlığı, kutulu composer, ayrı alt şerit, geniş pastel zemin ve boş sağ panel birlikte dikkat çekiyor. Cursor'un incelenen ekranında çalışma alanı/ortam satırı, mesaj alanı ve az sayıda ikincil eylem daha sakin bir bütün oluşturuyor.

Öneri: Önce boş panelin davranışı ve bağlam yerleşimi düzeltilsin; ardından başlık, zemin etkisi, çerçeve ve gölgelerin vurgu seviyesi azaltılsın. Fontu bütün uygulamada tekrar küçültmek yerine gövde, kontrol, bölüm etiketi ve yardımcı metin rollerinin tutarlılığı korunmalı. Renk kararı aynı temada ikinci bir karşılaştırmayla doğrulanmalı.

### 9. Pencere çubuğu gezinme için az kullanılıyor — orta

Cursor başlık çubuğunda geri/ileri ve görünüm kontrollerini sunuyor. Rift'in açık ana ekranındaki üst şerit büyük ölçüde boş; sidebar kapatma ve dosya paneli kontrolleri var, görünür geri/ileri yok. Bu tespit klavye veya tarayıcı geçmişinin hiç bulunmadığı anlamına gelmiyor.

Öneri: Aktif workspace/konuşma adı, geri/ileri ve panel kontrolleri tutarlı bir başlık çubuğunda toplansın. Native pencere sürükleme ve trafik ışıklarıyla çakışmamalı.

## Uygulama sırası

1. New chat / Build davranış ayrımı ve ortak navigasyon kayıtları.
2. Bağlam satırı ve dosya panelinin ihtiyaç halinde açılması.
3. Proje altında sohbetler ve gerçek görev durumları.
4. Model menüsü ve kapsamlı komut araması.
5. Aynı tema ve benzer pencere boyutunda tipografi, kontrast, gölge ve boşluk rötuşu.

Cursor'daki ses girişi ve Multitask düğmesi gözlemlendi, ancak bunları eklemek mevcut düzenin düzeltilmesinden daha öncelikli görülmedi. Görsel kaliteyi artırmak için bütün Cursor özelliklerinin kopyalanması gerekmiyor.
