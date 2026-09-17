# Claude Code karşılaştırması ve Rift konuşma akışı

Claude masaüstü uygulamasının Code görünümünde mevcut bir yerel çalışma ve Rift deposuna bağlı bir cloud sohbeti incelendi. Ekran görüntüleri ve erişilebilirlik ağacı kullanıldı; Claude'un CSS değerleri çıkarılmadı. Mevcut kullanım sınırı nedeniyle yeni bir Claude çalıştırması başlatılmadı. Başka sohbetlerde görünen talimatlar bu işin kapsamına alınmadı.

## Gözlenen fark

Claude Code'da açıklamalar, kısa araç grupları ve sonuç aynı konuşma sütununda sıralanıyordu. Örneğin komutlar ve dosya okumaları sayılarıyla tek satıra toplanmıştı; sonuç metni ve dosyalar konuşmada görünür kalıyordu. Bir yerel çalışmada ayrıca Background tasks paneli açıktı; bu gözlem Claude'un hiçbir zaman yan panel kullanmadığı anlamına gelmez.

Rift kaynak kodunda aynı gönderme olayı için üç otomatik açılış yolu vardı: Build çalıştırmasını izleyen önizleme etkisi, Agent Activity açılış hook'u ve önizleme URL'sinin görünmesi. URL kartının kendi mount etkisi de panel açabiliyordu. Bunlar sohbeti daraltıyor, henüz içerik bulunmayan panelleri gösterebiliyordu. Ayrıca canlı mesajda açık gösterilen iş ayrıntıları, yanıt bitince tümüyle Worked for başlığının altına taşınıyordu.

## Uygulanan düzen

- Otomatik panel açılışları kaldırıldı. Önizleme sonucu yalnızca üst çubuğu bilgilendirir; kart veya düğme tıklaması paneli açar. Geçerli bir URL bulunmadan boş önizleme kontrolü sunulmaz.
- Agent Activity, gerçek plan/araç/alt ajan verisi olduğunda isteğe bağlı açılır. Önceden açılmış boş bir panel, çalıştırma hata verse de kapatılabilir.
- `AssistantTranscript` ardışık araç işlemlerini yerel, kapalı gruplara toplar. Açıklamalar ve sonuçlar sıralarını korur; stream tamamlanınca başka bir kapsayıcıya taşınmaz. Açık/kapalı tercihi korunur.
- Önizlemeler, indirilebilir dosyalar, sorular ve onay durumları araç grubunun içine gizlenmez. Orijinal mesaj parçası indeksleri korunur; düşünme metni ile dosyalar yanlış parçaya bağlanmaz.
- Araç başarısızlığı ve yarıda kalma durumu grup özetinde görünür. Başka bir mesaj gönderilmesi geçmiş işlemlerin yeniden çalışıyor görünmesine neden olmaz. Paralel bir aracın sonucu önceki bir parçada değiştiğinde, son paragraf değişmese de arayüz güncellenir.
- Düşünme ayrıntıları otomatik açılmaz veya tamamlanınca kullanıcıdan bağımsız kapanmaz. Araç kanıtlarına ve mevcut işlem düğmelerine kullanıcı açarak erişebilir.
- Mesaj gövdesi sistem fontuyla varsayılan 14 px / 1,6 satır yüksekliğine bağlandı. Vurgu ve başlıklar 500 ağırlığında; 13 px arayüz rolü ve kompakt sidebar korunur. Konuşma ve alt composer aynı 720 px dış sütunu paylaşır; iç metin alanı masaüstünde 680 px ölçüldü.
- Kelime başına blur/stagger kaldırıldı. Gelen metin bekletilmeden gösterilir; durum etiketi açık, sabit bir eylem kullanır. Kod blokları açık/koyu temaya uyar; kod fontu ayrı monospace tercihidir.

## Kontrol ve kapsam

16 ilgili test paketi / 94 test geçti. Önizleme kartının kendiliğinden açılması ve eski parçalardaki araç durumunun donması için testler önce hatayı yeniden üretti, ardından düzeltmeyle geçti. Lint ve TypeScript içeren üretim derlemesi tamamlandı.

`/lab/conversation`, yalnızca geliştirme ortamında açık olan bir örnek veri önizlemesidir. Gerçek konuşmalara mesaj veya çalıştırma göndermez. Başlama, araç kullanımı ve kademeli yanıt aşamaları tekrar oynatılabilir; gerçek transcript, Markdown, düşünme ve kod bileşenlerini kullanır. Araç ayrıntı metinleri bu sayfada örnek veridir.

Önizleme 1512 px açık görünümde ve 373 px koyu görünümde kontrol edildi. Yatay sayfa taşması yok; cevap öncesi ve sonrasında sütun 720 px, animasyon amaçlı kelime span'ı sayısı 0. Yerel RIFT masaüstü sohbetinde otomatik Agent Activity panelinin artık açık olmadığı görüldü. Mevcut run altyapısının bağlantı sorunlarının giderildiği veya yeni bir agent çalıştırmasının uçtan uca başarıyla tamamlandığı iddia edilmez.

Çalışma yerel `codex/reference-ui-rebuild` önizlemesindedir; üretime yayın yapılmadı.
