# Cursor karşılaştırması sonrası Rift düzenlemesi

7 Eylül 2026. Uygulama: `codex/reference-ui-rebuild`, yerel `http://localhost:3020` ve RIFT UI Preview. Bu çalışma, [masaüstü karşılaştırmasındaki](2026-09-07-cursor-desktop-comparison.md) dokuz bulguyu ele alır. Üretimdeki web veya kurulu RIFT uygulaması yayımlanmadı.

## Ortak tipografi

`app/styles/typography.css` sayfalara, menülere, diyaloglara ve masaüstü webview'ına ortak roller sağlar. Sistem arayüz fontu varsayılandır; kod ve terminal ayrı monospace tercihini korur. Aşağıdaki değerler Rift'te ölçüldü; Cursor desktop CSS değerlerinin birebir çıkarıldığı iddia edilmez.

| Rol              | Varsayılan boyut | Ağırlık |
| ---------------- | ---------------- | ------- |
| Gövde            | 13 px            | 400     |
| Sidebar satırı   | 12,5 px          | 400     |
| Kontrol / etiket | 12 px            | 400     |
| Yardımcı metin   | 11 px            | 400     |
| Bölüm başlığı    | 14 px            | 500     |
| Sayfa başlığı    | 18 px            | 500     |

Gövde harf aralığı 0, başlık aralığı −0,012 em; satır yüksekliği gövdede 1,5 ve başlıklarda 1,35. Görünüm ayarındaki yazı boyutu rolleri birlikte ölçekler. Sidebar varsayılanı 248 px, satırları 32 px ve ikonları 14 px; kayıtlı özel genişlik korunur. Dokunmatik dar ekranlarda girişlerin okunabilirliği ve 44 px hedefler korunur.

## Uygulanan davranışlar

1. Projelerin altına ilişkili sohbetler yerleşir; proje dışındaki konuşmalar Recent içinde kalır. Proje satırı son konuşmaya döner.
2. Dosya paneli başlangıçta kapalıdır, kullanıcı açtığında gerçek dosyaları yükler. Hata halinde sonsuz tekrar yerine Retry sunulur.
3. New chat yeni sohbet başlatır; Build ve Studio mevcut veya son çalışma alanını açar. New chat → Build → Studio → Hack Workbench sırası ve More grubu korunur.
4. Proje, çalışma ortamı ve Files seçimi mesaj kutusunun üstünde toplanır. Yer tutucu klasör adı kaldırılır.
5. Sidebar, başlık çubuğu ve komut paleti ortak ad/ikon kayıtlarını kullanır. Palet yakın konuşmaları öne alır; Chats, Files, Actions ve Settings kapsamları sunar. Files, seçili klasörün gerçek içeriğini arar; tüm proje çapında arama iddiası taşımaz.
6. Model menüsüne açık düşünme seviyesi seçenekleri ve bağlam bilgisi eklenir. Model ayrıntıları ve tekrar eden açıklamalar ana kontrolü kalabalıklaştırmaz.
7. Sohbetler gerçek run ve yerel taslak verisine göre durum gösterir. Running / Needs attention / Drafts filtreleri yüklenmiş konuşmaları filtreler; run sorgusu en yeni 60 kaydı kapsar. Eski bağlantı işaretleri sürekli çalışıyor gibi sunulmaz.
8. Ana ekranın pastel zemini ve boş dosya paneli kaldırılır; composer 640 px, başlık 18 px ve köşe yarıçapı 12 px olur. Ayarlar, Plugins, Agents, Runs, Tasks, Artifacts, Studio ve Hack Workbench ortak font rollerini kullanır.
9. Üst çubuğa sayfa/sohbet adı ve gözlenen uygulama rotaları arasında geri/ileri eklenir. Sohbet URL değişimi gezinmeyi uygulama dışına taşımaz.

## Doğrulama

- Ana değişikliklerde 23 test paketi / 179 test geçti. Son Hack Workbench ve eski tipografi sözleşmesi kontrolünde ayrıca 6 paket / 27 test geçti.
- ESLint ve Next.js üretim derlemesi geçti; derleme TypeScript kontrolünü içerir.
- Dokuz ayar sayfasında sistem fontu ve 18 px / 500 sayfa başlıkları ölçüldü. Plugins, Agents, Runs, Tasks ve Artifacts başlıkları da kontrol edildi.
- Studio ana başlığı 18 px / 500, Studio bölüm başlığı 14 px / 500; Hack Workbench karşılama başlığı 18 px / 500 olarak doğrulandı.
- 390 px önizlemede yatay taşma yok; model adı, düşünme seviyesi ve Cloud etiketi görünür. Geçici ekran boyutu değişikliği geri alındı.
- Model/düşünme menüsü, ayarlar araması, sayfa gezinmesi ve yerel masaüstü önizlemesi kontrol edildi. Proje gruplaması, canlı hesapta proje bulunmadığı için test verisiyle doğrulandı.

## Artifacts sunucu hatası

Canlı önizlemede `artifacts:listForUser`, büyük mesaj belgeleri nedeniyle Convex okuma sınırını aşıyordu. Kaynak sorgu 8 MiB mesaj okuma bütçesi ve yaklaşık 4 MiB eski dosya kurtarma bütçesiyle sınırlandı; yetki kontrolleri korunur. Galeri yakın geçmişin bütçeye sığan bölümünü döndürür; bu değişiklik tam arşiv sayfalaması eklemez.

Bu Convex değişikliği **henüz yayımlanmadı**. Mevcut sunucu hatası dolayısıyla galeri verisi önizlemede yüklenemeyebilir. Arayüzde eklenen sayfa hata sınırı, bu hatanın bütün çalışma alanını kapatmasını önler; sidebar ve başka sayfalara geçiş canlı olarak doğrulandı.

Son masaüstü kontrolünde kullanıcının mevcut sohbetinde agent başlatma zaman aşımı da görünüyordu. Bu çalışma bir agent çalıştırma veya bağlantı testi yapmadı; bu sunucu/çalıştırma sorununun giderildiği iddia edilmez.
