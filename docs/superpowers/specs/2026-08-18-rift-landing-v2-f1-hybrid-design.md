# RIFT Landing V2 F1 Hibrit Tasarım Spesifikasyonu

Tarih: 2026-08-18  
Durum: Tasarım yönü onaylandı, uygulama onayı bekleniyor  
Hedef rota: `/landing/v2`  
Seçilen yön: F1 = A3 yapı + B1 ürün yoğunluğu + C2 sinematik marka anları

## 1. Amaç

RIFT'i yalnızca başka bir AI aracı gibi değil, yazılım üretimi, medya üretimi ve sistem araştırmasını aynı bağlam katmanında birleştiren profesyonel bir agent workstation olarak konumlandırmak.

Yeni landing sayfası şu üç hissi aynı anda vermelidir:

1. Güvenilir ve kurumsal: ürün gerçek, sistemli ve satın alınabilir görünmeli.
2. Teknik ve güçlü: gerçek ürün yüzeyleri, çalışma akışları ve execution çıktıları görünmeli.
3. Özgün ve hatırlanabilir: RIFT Aperture etrafında kontrollü, sinematik bir görsel dil kurulmalı.

Hedef, Axiom'ın tipografik disiplini ve ürün kanıtı seviyesine yaklaşırken RIFT'e ait daha karanlık, daha sinematik ve daha sistem odaklı bir kimlik oluşturmaktır. Axiom birebir kopyalanmayacaktır.

## 2. Onaylanmış tasarım kararı

F1 üç yönün görev dağılımıdır:

| Kaynak yön | Nihai sistemdeki görevi |
| --- | --- |
| A3, daha cesur | Sayfa omurgası, güçlü hero, Build odaklı ilk ürün hikayesi, büyük tipografi |
| B1, dengeli | Studio ve model kataloğu için kontrollü medya yoğunluğu, gerçek çıktı çeşitliliği |
| C2, daha sinematik | Aperture marka anı, Build / Studio / Hack arasında ortak bağlam hikayesi |

Bu üç yaklaşım eşit ağırlıkta kullanılmayacaktır. A3 ana omurgadır. B1 tek bir ürün vitrini katmanıdır. C2 ise nadir kullanılan marka imzasıdır.

## 3. Kapsamın ayrıştırılması

### Faz 1: Landing V2

Bir sonraki uygulama planının kapsamı:

- `/landing/v2` sayfasının bilgi mimarisi ve görsel sisteminin yenilenmesi
- Landing bileşenlerinin yeniden düzenlenmesi
- Gerçek Build, Studio ve Hack ekranlarının ürün kanıtı olarak kullanılması
- Yeni tipografi, renk, spacing ve motion tokenlarının landing düzeyinde uygulanması
- RIFT Aperture'ın deterministik SVG veya CSS tabanlı display signature olarak oluşturulması
- Mobil, erişilebilirlik, performans ve reduced-motion davranışlarının tamamlanması

### Faz 2: Uygulama içi görsel sistem

Landing tamamlandıktan sonra ayrı bir keşif ve onay döngüsü gerektirir:

- Build, Studio ve Hack için ortak app shell
- Paylaşılan navigasyon, yan panel, composer, execution status ve command surface dili
- Tipografi, yoğunluk, border, surface ve motion standardizasyonu
- Landing üzerinde vaat edilen ortak bağlam deneyiminin gerçek ürün arayüzünde karşılanması

### Faz 3: Tam marka üretimi

Ayrı bir kimlik üretim döngüsü gerektirir:

- Ana RIFT glyph'inin optik düzeltmeleri
- Aperture display signature'ın master vektörü
- Favicon, app icon, tek renk, küçük boyut ve reverse-on-dark varyantları
- Motion logo exportları
- Marka kullanım rehberi

Faz 1, Faz 2 veya Faz 3 için geri döndürülemez bir marka değişikliği yapmayacaktır.

## 4. Marka mimarisi

RIFT'in mevcut iki şeritli glyph'i ana kurumsal logo olarak korunur. Kullanıcıların tanıdığı işaret bu olduğu için yerini yeni bir sembol almaz.

Yeni görsel öğelerin rolleri:

- **RIFT Glyph:** Navigasyon, uygulama ikonu, favicon ve küçük boyutlu kurumsal imza.
- **Rift Aperture:** Hero veya sistem anlatısında büyük ölçekli display signature. Ana logo değildir.
- **Rift Field:** Agent activity, processing ve çalışan sistem hissi için noktasal alan dokusu.
- **Rift Strata:** Model, çıktı ve katmanlı üretim bölümlerinde ikincil çizgisel doku.

Kural: Aynı viewport içinde glyph, Aperture, Field ve Strata birlikte yarışmayacaktır. Bir ana sembol, en fazla bir destek dokusu görünür.

### Aperture yapım ilkeleri

- Monokrom, radyal ve geometrik olmalı.
- Siyah zemin üzerinde kırık beyaz çizgilerden oluşmalı.
- Çizgi kalınlığı ve boşlukları küçük boyutta birleşmeyecek şekilde optik olarak ayarlanmalı.
- Merkezindeki negatif alan, okunaklı ve kontrollü kalmalı.
- Rastgele üretilmiş bitmap olarak değil, deterministik SVG/CSS geometri olarak uygulanmalı.
- Fotoğrafik glow, lens flare, yoğun blur veya dekoratif neon kullanılmamalı.

Üretilen konsept görseller yalnızca yön referansıdır. Üretim asset'i olarak doğrudan kullanılmayacaktır.

## 5. Konumlandırma ve mesaj

### Birincil önerme

RIFT, farklı araçlar arasında taşınan işi tek bir agent katmanında toplar.

### Hero metni

Eyebrow kullanılmayacak.

Başlık:

> Give RIFT the work.

Alt metin:

> Build software, create media and investigate systems through the same agent layer.

Birincil CTA:

> Download RIFT

İkincil CTA:

> Watch RIFT work

Hero metni tek ana iddiaya odaklanır. Birden fazla özellik, model adı veya soyut AI vaadi hero içine eklenmez.

## 6. Sayfa bilgi mimarisi

Sayfa sırası ve her bölümün tek görevi:

1. **Navigation:** RIFT'i tanımlar, ürün alanlarına ve indirmeye hızlı erişim verir.
2. **Hero:** Tek cümlede değer önerisini kurar ve gerçek ürün yüzeyini ilk viewport içinde gösterir.
3. **Product proof strip:** RIFT'in Build, Studio ve Hack yüzeylerini aynı ürün ailesi olarak kanıtlar.
4. **Build narrative:** Ana ürün hikayesini, görevden doğrulanmış çıktıya giden akışla anlatır.
5. **Studio showcase:** Model ve medya çeşitliliğini B1 yoğunluğunda gösterir.
6. **System continuity:** Aynı bağlamın Build, Studio ve Hack arasında nasıl taşındığını C2 sinematik anlatıyla açıklar.
7. **Enterprise proof:** Güvenlik, kontrol ve gerçek kurumsal kanıtı sunar.
8. **Pricing and download:** Satın alma veya ürünü deneme kararını sadeleştirir.
9. **Final CTA and footer:** Son dönüşüm noktası ve yasal navigasyon.

Tekrarlanan eyebrow, birbirine benzeyen kart ızgaraları ve arka arkaya aynı kompozisyona sahip bölümler kaldırılır. En fazla her üç ana bölümden birinde eyebrow kullanılabilir.

## 7. Bölüm spesifikasyonları

### 7.1 Navigation

- Sol: RIFT glyph + wordmark.
- Orta veya sağ: Product, Studio, Hack, Enterprise, Pricing.
- Sağ uç: Sign in ve birincil `Download` CTA.
- Yükseklik: masaüstünde 64 px, mobilde 56 px.
- Başlangıçta saydam veya zemine yakın görünür; scroll sonrasında ince border ve yüksek opaklıklı surface alır.
- Mega menu veya dikkat dağıtan açılır menü Faz 1 kapsamında değildir.

### 7.2 Hero

Masaüstü kompozisyonu iki katmanlıdır:

- Üst katman: 7 kolon metin, 5 kolon Aperture.
- Alt katman: gerçek RIFT ürün ekranı, viewport altına hafifçe taşan geniş bir workstation yüzeyi.

Hero başlığı 2 veya 3 satırdan fazla olmamalıdır. CTA grubu başlığın hemen altında yer alır. Ürün ekranı ilk 900 px yüksekliğinde görünmeye başlamalıdır.

Aperture ilk yüklemede bir kez oluşur. Sürekli dönmez. Kullanıcı scroll yaptığında çok hafif derinlik veya çizgi fazı değişimi olabilir; bu hareket bilgi hiyerarşisini bozmaz.

Mobilde sıra:

1. Başlık
2. Alt metin
3. CTA'lar
4. Aperture'ın statik veya düşük hareketli sürümü
5. Kırpılmadan okunabilen ürün preview

### 7.3 Product proof strip

Üç küçük logo veya soyut kart yerine üç gerçek ürün durumu gösterilir:

- Build: aktif görev ve execution state
- Studio: prompt, model ve üretilmiş çıktı
- Hack: araştırma yüzeyi veya doğrulanabilir bulgu

Her öğe tek satırlık bir sonuç cümlesi taşır. Yalnızca ürünün gerçekten yapabildiği, gösterilebilir cümleler yayınlanır.

Masaüstünde yatay şerit, mobilde snap gerektirmeyen dikey yığın kullanılır.

### 7.4 Build narrative

Bu, sayfanın en açık ürün anlatısıdır. Başlık önerisi:

> From task to verified change.

Üç aşama:

1. Plan
2. Execute
3. Verify

Metin solda, gerçek ürün yüzeyi sağda bulunur. Scroll ilerledikçe metin adımı değişebilir ancak ürün ekranı erişilebilir bir statik içerik olarak da anlaşılmalıdır. Scroll-jacking yapılmaz.

Öncelik, agent'ın yalnızca metin üretmediğini; dosya, komut, diff ve doğrulama zinciri içinde çalıştığını göstermektir.

### 7.5 Studio showcase

B1 yönünün kontrollü medya yoğunluğu burada kullanılır.

- Bir büyük ana çıktı
- İki veya üç küçük destek çıktısı
- Model, modality ve execution bilgisini gösteren minimal metadata
- Kullanıcı tarafından kontrol edilen filtre veya carousel

Sonsuz kayan marquee, otomatik hızlanan slider veya aynı anda ondan fazla kart gösterilmez. Medya görsellerinin arkasında koyu nötr surface ve tutarlı aspect ratio kullanılır.

Başlık önerisi:

> The right model, inside the same workflow.

Model logoları sayfanın ana marka öğesine dönüşmez. RIFT, yalnızca bir model kataloğu gibi görünmemelidir.

### 7.6 System continuity

C2 yönünün ana sinematik anıdır. Rift Aperture burada ikinci ve son kez büyük ölçekte kullanılabilir.

Hikaye:

1. Bir görev Build içinde başlar.
2. Aynı bağlam Studio'da bir medya veya model çıktısı üretir.
3. Hack aynı bağlamı araştırma veya doğrulama için kullanır.
4. Sonuç tekrar ortak iş akışına döner.

Bu geçiş, üç ayrı ürün satışı yerine bir işletim sistemi sürekliliği olarak gösterilir. Masaüstünde tek geniş sahne, mobilde üç açık kart ve bağlayıcı bir ilerleme çizgisi kullanılır.

### 7.7 Enterprise proof

Bu bölüm yayınlanmadan önce gerçek kanıt gerektirir. Kabul edilen kanıt türleri:

- Gerçek müşteri veya tasarım partneri logoları için yazılı kullanım izni
- Doğrulanmış müşteri alıntısı
- Belgelenmiş güvenlik veya deployment özelliği
- Ölçüm yöntemi belli performans metriği
- Gerçek vaka çalışması bağlantısı

Kanıt hazır değilse sahte logo, anonim alıntı veya uydurma metrik gösterilmez. Bölüm kısa bir ürün kontrol listesine indirgenir ya da tamamen gizlenir.

Başlık önerisi:

> Built for work that has to hold up.

### 7.8 Pricing and download

Fiyatlandırma bilgisi kesinleşmişse en fazla üç plan gösterilir. Fiyat veya paketler kesin değilse landing üzerinde hayali tier oluşturulmaz; doğrudan download veya contact akışına gidilir.

Kartlar sayfanın geri kalanından daha süslü olmaz. Önerilen plan yalnızca border, küçük label ve CTA önceliğiyle ayrılır.

### 7.9 Final CTA and footer

Final CTA, hero'nun mesajını yeni bir iddia eklemeden kapatır:

> Put RIFT to work.

Footer içinde Product, Resources, Company, Legal ve sosyal kanallar bulunur. Link isimleri ve hedefleri gerçek olmalıdır.

## 8. Görsel sistem

### 8.1 Renk tokenları

| Token | Değer | Kullanım |
| --- | --- | --- |
| `--rift-bg` | `#080808` | Ana sayfa zemini |
| `--rift-surface` | `#101010` | Kart ve ürün çevresi |
| `--rift-border` | `#282828` | İnce ayırıcılar |
| `--rift-text` | `#F3F3EF` | Başlık ve ana metin |
| `--rift-muted` | `#A9A9A2` | Destek metni |
| `--rift-signal` | `#FF756A` | Ana CTA ve nadir vurgu |

Sinyal rengi sayfanın yüzde 5'inden azında görünmelidir. Mavi ve yeşil yalnızca gerçek ürün ekranlarının semantik durum renkleri olarak kalır.

Hesaplanan kontrastlar:

- `#F3F3EF` / `#080808`: yaklaşık 18.0:1
- `#A9A9A2` / `#080808`: yaklaşık 7.95:1
- `#FF756A` / `#080808`: yaklaşık 7.63:1

### 8.2 Tipografi

Ana aile: Geist  
Veri ve execution ailesi: JetBrains Mono

| Rol | Masaüstü | Mobil | Ağırlık | Satır yüksekliği |
| --- | --- | --- | --- | --- |
| Hero | 72-88 px | 48-56 px | 520 | 0.94-0.98 |
| Section title | 44-54 px | 34-40 px | 520 | 1.02-1.08 |
| Lead body | 18 px | 17 px | 400 | 1.5 |
| Body | 16 px | 16 px | 400 | 1.55 |
| UI label | 13-14 px | 13-14 px | 500 | 1.35 |
| Data | 11-13 px | 11-13 px | 450-500 | 1.45 |

Kurallar:

- Başlık tracking değeri masaüstünde yaklaşık `-0.025em`, küçük boyutta en fazla `-0.015em`.
- Uzun metin genişliği en fazla `65ch`.
- JetBrains Mono yalnızca model, durum, komut, veri ve execution etiketlerinde kullanılır.
- Tamamı büyük harf paragraflar kullanılmaz.
- Görünür pazarlama metninde uzun tire karakteri kullanılmaz.

### 8.3 Layout ve spacing

- Ana container: en fazla 1240 px.
- Masaüstü grid: 12 kolon.
- Büyük section dikey ritmi: 96 px.
- Hero üst boşluğu: navigasyon sonrası 96-120 px.
- Mobil section ritmi: 56-64 px.
- Ana metin ile CTA arası: 28-32 px.
- Başlık ile açıklama arası: 20-24 px.
- İç kart padding: masaüstü 24-32 px, mobil 18-20 px.

### 8.4 Radius, border ve gölge

- UI yüzeyleri: 8-10 px radius.
- Büyük medya yüzeyleri: 12-16 px radius.
- Landing seviyesindeki CTA'lar tam pill kullanır. Ürün preview içindeki kompakt kontroller 8 px radius kullanır.
- Border: çoğunlukla 1 px `#282828`.
- Gölge yerine zemin farkı ve border tercih edilir.
- Ağır glow, glassmorphism, neon gradient ve birden fazla iç gölge kullanılmaz.

## 9. Motion sistemi

Tüm motion bir durumu açıklamalı, hiyerarşi kurmalı veya doğrudan girdiye yanıt vermelidir.

| Hareket | Süre | Easing | Not |
| --- | --- | --- | --- |
| Aperture oluşumu | 900 ms | `cubic-bezier(0.23, 1, 0.32, 1)` | İlk görünümde bir kez |
| Büyük bölüm reveal | 600-750 ms | aynı ease-out | Opacity + en fazla 16 px hareket |
| UI hover/focus | 150-220 ms | güçlü ease-out | Renk, border, 1-2 px konum |
| Gallery geçişi | 280-420 ms | ease-out | Kullanıcı kontrolünde |
| Modal veya preview | 220-320 ms | ease-out | Origin tetikleyiciye bağlı |

Kurallar:

- `scale(0)` giriş animasyonu kullanılmaz.
- Sürekli dönen logo veya dekoratif orbit kullanılmaz.
- Büyük blur katmanları scroll sırasında hareket ettirilmez.
- Hover animasyonu layout shift yaratmaz.
- `prefers-reduced-motion` altında Aperture statik olur, reveal yalnızca kısa opacity geçişine düşer ve parallax kapatılır.

## 10. Ürün içi görsel sistem bağlantısı

Landing, gelecekteki uygulama içi sistem için şu sözleşmeyi kurar:

- Build, Studio ve Hack aynı navigation ve surface ailesine ait görünür.
- Ortak agent durumu, execution dili ve composer modeli korunur.
- Ürün ekranları pazarlama için sahte veya yeniden çizilmiş mockup değil, gerçek uygulama durumlarından alınır.
- Landing için yapılan kozmetik ekran kurguları ürünün gerçek davranışını yanlış temsil etmez.

Faz 1 içinde uygulamanın çalışma mantığı veya app shell'i değiştirilmez. Gerekirse landing için özel, read-only product preview bileşenleri oluşturulur.

## 11. Bileşen mimarisi hedefi

Uygulama planı mevcut dosyaları inceledikten sonra kesinleştirecek olsa da tasarım sorumlulukları şu sınırları izlemelidir:

- `LandingShell`: tema, container ve section ritmi
- `LandingNav`: masaüstü ve mobil navigasyon
- `LandingHero`: mesaj, CTA ve ürün preview
- `ApertureSignature`: deterministik marka geometrisi
- `ProductProof`: üç gerçek ürün durumu
- `BuildNarrative`: plan, execute, verify hikayesi
- `StudioShowcase`: medya ve model vitrini
- `SystemContinuity`: ortak bağlam hikayesi
- `EnterpriseProof`: yalnızca gerçek kanıt
- `PricingDownload`: plan veya download kararı
- `FinalCTA`: kapanış dönüşümü

Client-side JavaScript yalnızca gerçek etkileşim ve motion gereken yaprak bileşenlerde kullanılmalıdır. Statik metin ve layout, Server Component olarak kalmalıdır.

## 12. İçerik ve kanıt kuralları

- Sahte müşteri logosu yok.
- Uydurma testimonial yok.
- Ölçüm yöntemi belirtilmemiş hız, doğruluk veya verim metriği yok.
- Üründe bulunmayan güvenlik ve deployment iddiası yok.
- Görseller gerçek RIFT ürününü veya açıkça soyut marka dokusunu göstermeli.
- Rakiplerin marka isimleri ve ekran görüntüleri RIFT landing üzerinde kullanılmamalı.
- Her CTA gerçek ve çalışan bir hedefe bağlanmalı.

Eksik kanıt, placeholder metinle yayına çıkmak yerine ilgili modülün gizlenmesiyle yönetilir.

## 13. Erişilebilirlik

Minimum hedef WCAG 2.2 AA'dır.

- Normal metin kontrastı en az 4.5:1.
- Büyük metin kontrastı en az 3:1.
- Tüm etkileşimler klavye ile erişilebilir.
- Görünür focus ring minimum 2 px ve çevresine karşı en az 3:1 kontrastlı.
- Birincil etkileşim hedefleri en az 44 x 44 px; sıkışık ikincil UI en az 24 x 24 px.
- 200 yüzde zoom altında yatay sayfa scroll'u oluşmaz.
- Bilgi yalnızca renkle aktarılmaz.
- Dekoratif marka geometrileri screen reader ağacından çıkarılır.
- Ürün ekranlarının açıklayıcı alt metni veya yakındaki metinsel karşılığı bulunur.
- Carousel varsa klavye kontrolü, durdurma ve aktif öğe bilgisi sunar.
- Reduced motion ayarı eksiksiz desteklenir.

## 14. Performans bütçesi

Hedefler:

- LCP: 2.5 saniyenin altında
- INP: 200 ms altında
- CLS: 0.1 altında
- İlk route için landing'e özel client JavaScript mümkün olduğunca küçük
- Toplam yeni font transferi 200 KB altında

Uygulama ilkeleri:

- Ürün görselleri `next/image` ile doğru `sizes`, ölçü ve modern format kullanır.
- LCP görseli önceliklendirilir; viewport dışı medya lazy load edilir.
- Hero içinde Three.js, WebGL veya yüksek maliyetli canvas sistemi kullanılmaz.
- Aperture SVG/CSS ile oluşturulur.
- Büyük blur, sürekli RAF döngüsü ve scroll'a bağlı layout ölçümü kullanılmaz.
- Animasyonlarda `transform` ve `opacity` tercih edilir.

## 15. Responsive davranış

Kontrol genişlikleri: 375, 768, 1024 ve 1440 px.

- 375 px: Tek kolon, tam genişlik CTA, okunabilir product preview.
- 768 px: İki kolon yalnızca içerik izin veriyorsa; medya çoğunlukla tam genişlik.
- 1024 px: Masaüstü bilgi mimarisi korunur, hero tipi ve boşluklar kademeli küçülür.
- 1440 px: Container 1240 px'de durur; satırlar aşırı uzamaz.

Hiçbir bölüm masaüstü kompozisyonunu küçültüp mobil ekrana sıkıştırmamalıdır. Mobil, aynı hiyerarşinin yeniden sıralanmış sürümüdür.

## 16. Kabul kriterleri

Faz 1 tamamlanmış sayılmadan önce:

- Hero ilk viewport içinde başlık, CTA ve gerçek ürün kanıtının başlangıcını gösterir.
- A3, B1 ve C2 rolleri birbirine karışmadan açıkça okunur.
- Ana glyph korunur; Aperture yalnızca display signature rolündedir.
- Sayfada sahte logo, testimonial, metrik veya doğrulanmamış iddia yoktur.
- Tekrarlanan section şablonu hissi yoktur.
- Tüm görünür CTA'lar hedefe gider ve dar ekranda taşmaz.
- 375, 768, 1024 ve 1440 px görsel regresyon ekranları alınır.
- Klavye navigasyonu ve focus sırası manuel kontrol edilir.
- 200 yüzde zoom ve reduced motion manuel kontrol edilir.
- Otomatik erişilebilirlik taramasında kritik hata yoktur.
- Lighthouse veya eşdeğer ölçüm performans bütçelerini karşılar ya da sapmalar belgelenir.
- `pnpm` üzerinden ilgili lint, typecheck ve test komutları geçer.
- `/landing/v2` tanıtım öncesinde `noindex` durumunu korur.

## 17. Yayına alma yaklaşımı

1. Yeni tasarım yalnızca `/landing/v2` üzerinde geliştirilir.
2. Mevcut landing ve ürün route'ları etkilenmez.
3. Gerçek içerik ve kanıt doğrulaması tamamlanır.
4. Responsive, erişilebilirlik ve performans kabul kriterleri kontrol edilir.
5. Kullanıcı tarafından görsel onay verilir.
6. Ayrı bir kararla ana landing'e promotion yapılır.

## 18. Kapsam dışı

- Build, Studio ve Hack ürün davranışlarının yeniden yazılması
- Backend, model routing veya agent mantığı değişiklikleri
- Axiom'ın görsel kimliğinin veya kodunun kopyalanması
- Tam kapsamlı marka rehberi ve yasal marka tescil çalışması
- Gerçek veri olmadan müşteri kanıtı üretmek
- Ana landing route'una otomatik promotion

## 19. Uygulama öncesi gereken girdiler

Uygulama planı mevcut asset'leri kullanarak başlayabilir. Aşağıdaki eksikler ilgili modüllerin yayınlanmasını sınırlar ancak landing iskeletini bloke etmez:

- Yayınlanabilir müşteri logoları veya testimonial izni
- Kesin pricing ve download hedefleri
- Hangi Build, Studio ve Hack durumlarının kamuya açık gösterilebileceğinin teyidi
- Ana CTA'nın platform ve dağıtım davranışı

Bu girdiler hazır değilse spesifikasyonda tanımlanan modül gizleme davranışı uygulanır; sahte içerik oluşturulmaz.
