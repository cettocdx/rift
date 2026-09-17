# RIFT görsel yeniden düzenleme — Axiom kıyaslaması

**Tarih:** 18 Ağustos 2026
**Kapsam:** `axiom.co` referans alınarak landing page ve app görsel dilinin yeniden kurgulanması
**Yöntem:** Her sayfa Chrome'da açıldı; renkler, tipografi ve boşluklar `getComputedStyle` ile canlı ölçüldü. Aşağıdaki rakamların hiçbiri tahmin değil.

---

## 1. Axiom'un koşulları — "milyar dolarlık şirket" görüntüsü neyden geliyor?

Ölçüm: `axiom.co`, 1568px viewport, 18 Ağustos 2026.

### 1.1 Tipografi

| Rol | Değer |
|---|---|
| UI ailesi | **Geist** |
| Veri / etiket ailesi | **Berkeley Mono** |
| H1 | 72px / satır 68px (**0.94** — satır aralığı punto'dan KÜÇÜK) / ağırlık **500** / tracking **−1.8px** (−0.025em) |
| H2 | 40px / 44px / 500 / −1px (−0.025em) |
| Gövde | 15px / 22.5px (1.5) / 400 / tracking normal |
| Nav + buton | 13px / 19.5px / **450** |
| Mikro etiket | 11–12px / mono / uppercase / tracking **+1.1px** / `#7b7b7b` |

**Kritik gözlem:** başlıklar **kalın değil**. 72px'te ağırlık 500. Ağırlığı düşürüp puntoyu büyütmek ve tracking'i sıkmak — pahalı görünmenin tek en büyük kaldıracı bu. 700 ağırlık "reklam"; 500 ağırlık "kurumsal".

### 1.2 Renk

| Rol | Değer |
|---|---|
| Zemin | `#060606` — neredeyse saf siyah |
| Birincil metin | `#fafafa` |
| İkincil metin | beyazın **%60**'ı (ayrı bir gri değil — aynı beyazın opaklığı) |
| Kart zemini | **şeffaf** |
| Kart çerçevesi | 1px `#111111` |
| Aksan | `#da5c2b` (sıcak turuncu) — **sadece** birincil butonda ve minik veri işaretlerinde |

Toplam 4 renk. Aksan sayfada iki-üç kez görünüyor, o kadar. Renk azlığı zenginlik sinyali.

### 1.3 Ritim ve düzen

| Ölçü | Değer |
|---|---|
| İçerik genişliği | **1240px** |
| Bölüm dolgusu | **96px üst / 96px alt** — 11 bölümün 8'inde birebir aynı |
| Hero | 128 / 112 |
| Final CTA | 192 / 192 (iki katı — kapanış nefes alıyor) |
| Kart köşesi | 8–10.6px |
| Buton köşesi | 6px |

Tek bir sabit sayı (96px) sayfanın tamamını taşıyor. Ondalıklı, "clamp'ten düşmüş" değer yok.

### 1.4 Görsel içerik — en önemli madde

Axiom'un sayfasında **tek bir dekoratif öge yok**:
- gradyan blob yok
- 3D / three.js yok
- illüstrasyon, izometrik çizim, stok görsel yok
- arka plan deseni yok

Her görsel **gerçek ürün yüzeyi**, DOM'da render edilmiş: sorgu editörü, veri seti listesi, trace tablosu, fatura kartı, terminal. Mono yazı tipi bu yüzeylerde doku olarak kullanılıyor ve mühendislik güvenilirliği yayıyor.

### 1.5 Güven aygıtları

1. Müşteri logosu duvarı — 8 kutu, çerçeveli, sönük, rotasyonlu (asana, Cal.com, Framer, plex, Factory…)
2. Üstünde mono/uppercase mikro etiket: `POWERING MACHINE DATA AT SCALE FOR`
3. İsimli, unvanlı, şirketli müşteri sözü (Cal.com kurucusu)
4. Sayısal iddialar (ingest/ay, $0 fatura kartı)

Bu dördü olmadan hiçbir sayfa "milyar dolarlık" okunmaz. Ürün ne kadar iyi olursa olsun, **başkasının kullandığını göstermek** gerekiyor.

---

## 2. RIFT'teki eksikler, hatalar ve çirkin duran şeyler

Ölçüm: `localhost:3060/landing/v2`, aynı viewport.

### 2.1 Hatalar (bug — tercih değil)

| # | Sorun | Kanıt | Durum |
|---|---|---|---|
| H1 | **Landing sayfası Geist ile değil `-apple-system` ile render oluyordu.** App'teki "yazı tipi tercihi" ayarı (`data-rift-ui-font="system"`) `body` seçicisi üzerinden marketing sayfasına sızıyordu. Marka yazı tipi kullanıcı tercihi değildir. | `getComputedStyle(h1).fontFamily === "-apple-system, …"` | ✅ **düzeltildi** — `LANDING_PALETTE` artık Geist'i inline style ile sabitliyor |
| H2 | Hero'nun birincil CTA'sı ("Start building") **600px yüksekliğindeki ürün panelinin ALTINDA**. Okuyucu başlığı görüyor, sonra dev bir panel, dönüşüm butonunu görmek için kaydırması gerekiyor. Axiom, Cursor, v0, Lovable, Bolt — hepsi CTA'yı alt başlığın hemen altına koyuyor. | `LandingHero.tsx:141` panel, `:147` butonlar | ⬜ |
| H3 | Bölüm dolguları **83.64px** gibi ondalıklı. Bir `clamp()`/vw hesabından düşmüş, tasarlanmamış. | `getComputedStyle(section).paddingTop` | ⬜ |

### 2.2 Tipografi sapmaları

| Ölçü | RIFT | Axiom | Sorun |
|---|---|---|---|
| H1 ağırlık | **600** | 500 | Ağır, bağırıyor |
| H1 punto | 64.8px | 72px | Küçük ve ondalıklı |
| H1 tracking | −2.268px (−0.035em) | −1.8px (−0.025em) | Fazla sıkı, harfler birbirine giriyor |
| H2 punto | **48px** | 40px | Bölüm başlıkları H1'e rakip oluyor |
| H2 ağırlık | 600 | 500 | Aynı sorun |
| Alt metin | **18.4px** | 15px | Şişkin; "sunum slaytı" hissi |
| Nav | 12.5px | 13px | Ondalıklı |
| Mono etiket | yok | 11px mono, +1.1px tracking | Mühendislik dokusu eksik |

### 2.3 Renk sapmaları

| Ölçü | RIFT | Axiom |
|---|---|---|
| Sayfa zemini | `#1a1a1a` (body) / `#000` (sarmalayıcı) | `#060606` tek değer |
| İkincil metin | `#9a9a9a` (ayrı gri) | beyaz %60 opaklık |
| Aksan | `#8ab4ff` (soğuk mavi) | `#da5c2b` (sıcak turuncu) |

Mavi aksan sorunu şu: **her AI ürünü mavi.** v0 siyah-beyaz, Bolt mavi, Lovable mor-pembe gradyan. Mavi seçmek "AI SaaS şablonu" kategorisine girmek demek. Axiom'un sıcak turuncusu ve Cursor'ın sıcak siyahı (`rgb(20,18,11)` — nötr değil, hafif zeytin) tam da bu yüzden akılda kalıyor.

### 2.4 Çirkin duran / kesilmesi gerekenler

1. ~~**Hero arkasındaki moiré / yelpaze deseni.**~~ **Düzeltilmiş tespit:** yakından bakınca bu prosedürel bir desen değil, fotoğraflanmış fırçalanmış çelik plaka (`/landing-v2/hero-metal-*.webp`). Konsept aslında Cursor'ın yaptığıyla aynı — ürün görselinin arkasında fotoğrafik bir malzeme. Sorun malzeme değil, **spekülerin başlığın sağ ucuyla çakışması**: maske gradyanı 17/31/46% duraklarıyla tam da başlığın en uzun satırının bittiği yerde açılıyordu, son iki kelime ışığa giriyor ve fırçalanmış yüzeyin halkalanması tipografinin arkasında moiré gibi okunuyordu. **Silinmedi — duraklar 29%'a çekildi ve daha uzun bir rampayla açılıyor.** Malzeme duruyor, tipografi ışığın dışında. ✅
2. **`ModelConstellation` three.js sahnesi** — marka işareti aşırı parlak, uydu panelleri işaretin üstünden geçiyor, yörünge merkezden kaçık. Bu tür bir öge Axiom/Cursor/v0 dilinde hiç yok; kalırsa 4K kalitede olmalı, yoksa çıkmalı.
3. **Sosyal kanıt sıfır.** Müşteri logosu yok, müşteri sözü yok, sayısal iddia yok. Sayfa tamamen kendi kendini anlatıyor.
4. **`MetalSheen` / parlama efektleri** — hero panelinin üstünden geçen metalik ışık. Ürün ekranını gerçek göstermek yerine render gibi gösteriyor.

---

## 3. Rakip analizi — kim ne yapmış, neden iyi görünüyor?

Hepsi Chrome'da açıldı ve ölçüldü.

### 3.1 Axiom (`axiom.co`) — **hedefimiz**
- **Strateji:** Büyük, hafif, sıkı tipografi + gerçek ürün yüzeyleri + tek sıcak aksan.
- **Neden işe yarıyor:** Hiçbir şey satmaya çalışmıyor gibi görünüyor; sadece ürünü yüksek çözünürlükte gösteriyor. Mono yazı tipi mühendis izleyiciye "bu bizden biri" diyor.
- **Alınacak:** 96px ritim, 1240px kolon, ağırlık 500 başlıklar, mono mikro etiketler, logo duvarı, şeffaf kart + 1px çerçeve.

### 3.2 Cursor (`cursor.com`) — **en şaşırtıcı**
- **Ölçüm:** Kendi yazı tipi **CursorGothic**. H1 sadece **26px**, ağırlık **400**. Zemin `rgb(20,18,11)` — sıcak, hafif zeytin siyah. Butonlar tam yuvarlak (pill). Bölüm dolgusu 112/67.2.
- **Strateji:** **Fısıldamak.** Dev başlık yok. Bir cümle, iki buton, sonra kocaman ürün ekran görüntüsü — üstelik **fotoğrafik bir manzara zemini üzerinde**.
- **Neden işe yarıyor:** Öz güven. "Ne yaptığımızı anlatmama gerek yok, bak" diyor. 26px başlık ancak arkasındaki ürün gerçekten iyi görünüyorsa çalışır.
- **Alınacak:** Hero'da CTA'nın ürün görselinin ÜSTÜNDE olması; pill butonlar; sıcak siyah.

### 3.3 v0 (`v0.app`)
- **Strateji:** Saf siyah, Geist, hero = prompt kutusu. Sıfır dekorasyon. Altında şablon galerisi.
- **Neden işe yarıyor:** Ürünün kendisi hero. Sayfaya girdiğin an ürünü kullanmaya başlayabiliyorsun.
- **Alınacak:** Hero'ya çalışan bir prompt kutusu koymak — RIFT'in en güçlü hamlesi bu olabilir, çünkü RIFT'te de giriş noktası bir prompt.

### 3.4 Lovable (`lovable.dev`)
- **Ölçüm:** Açık tema `#fafafa`, kendi değişken yazı tipi "Camera Plain Variable", H2 48px/600/−1.92px, mor-mavi-pembe mesh gradyan zemin, hero = prompt kutusu.
- **Strateji:** Tüketici sıcaklığı. Mühendis değil, girişimci hedefliyor.
- **Neden işe yarıyor (onlar için):** Yaklaşılabilir. Ama **bizim hedefimiz bu değil** — kullanıcı "milyar dolarlık şirket" istedi, "sevimli" değil. Gradyan mesh tam da kaçınmamız gereken şey.

### 3.5 Bolt (`bolt.new`)
- **Strateji:** Koyu bento ızgarası. Her özellik bir kart, kartların içinde mini ürün UI'ları. Dev istatistik sayıları ("98% less errors"). Mavi aksan.
- **Neden kısmen işe yarıyor:** Bilgi yoğunluğu yüksek, taranabilir. Ama kart-içinde-kart yığını sayfayı yorucu yapıyor ve mavi aksan onları kategorinin geri kalanından ayırmıyor.
- **Alınacak:** Sayısal iddia kartları. **Alınmayacak:** her şeyi karta koymak.

### 3.6 Linear (`linear.app`) — **en güçlü doğrulama**

- **Ölçüm:** Inter Variable. H1 **64px / satır 64px** (oran **1.0**), ağırlık **510**, tracking **−1.408px** (−0.022em). H2 48/48, 510, −1.056px. Alt metin **15px / 24px**, 400, `rgb(138,143,152)`. Zemin `rgb(8,9,10)` — **soğuk** near-black (maviye kaçık). Buton hap şeklinde (`9999px`), 13px / 510. Bölüm dolgusu **128px / 128px**, istisnasız. Kolon 1380px.
- **Strateji:** Axiom'la aynı formül, farklı ölçekte. Dev başlık ama hafif ağırlık; satır aralığı punto'ya eşit; sabit ritim.
- **Neden önemli:** Axiom ve Linear birbirinden bağımsız iki ürün, aynı sayılara varmış. Bu bir stil tercihi değil, bir **kural**:

| Kural | Axiom | Linear | Cursor | RIFT |
|---|---|---|---|---|
| Başlık ağırlığı | 500 | 510 | 400 | **600** ❌ |
| Başlık tracking | −0.025em | −0.022em | −0.0125em | **−0.035em** ❌ |
| Başlık satır/punto | 0.94 | **1.00** | 1.25 | 1.03 |
| Alt metin | 15px | 15px | 14px | **18.4px** ❌ |
| Bölüm ritmi | 96px sabit | 128px sabit | 67.2px sabit | **83.64px ondalık** ❌ |
| Zemin | `#060606` nötr | `#08090a` soğuk | `rgb(20,18,11)` sıcak | `#1a1a1a` ❌ |
| Buton köşesi | 6px | hap | hap | 10px |

Üçünün de zemini **saf siyah değil** ve **nötr değil** — her biri bir yöne kaçmış. RIFT'in `#1a1a1a`'sı hem çok açık hem karaktersiz.

### 3.7 Ortak payda

Altı sitenin altısında da var olan şeyler:

1. **Tek bir tipografi ailesi** (çoğu kendi özel yazı tipini yaptırmış: CursorGothic, Camera Plain, Berkeley Mono)
2. **Hero'da CTA, ürün görselinin üstünde**
3. **Gerçek ürün ekranı, illüstrasyon değil**
4. **Sosyal kanıt** (logo duvarı / müşteri sözü / sayı)
5. **Tek aksan rengi, az kullanılmış**
6. **Sabit, tasarlanmış bir dikey ritim**

RIFT'te şu an 1 ✅ (düzeltildi), 2 ❌, 3 ✅, 4 ❌, 5 ⚠️ (mavi, kategoriye ait), 6 ❌.

---

## 4. Uygulama planı

### Faz A — tipografi ve renk sistemi (temel)
- [x] Geist'i landing'e sabitle (font sızıntısı düzeltildi)
- [x] Başlık ağırlığı 600 → **500**
- [x] H1 `clamp` → sabit **72px** (mobilde 40px), tracking −0.025em, satır 0.95
- [x] H2 48px → **40px**, tracking −0.025em
- [x] Alt metin 18.4px → **15–16px**
- [x] İkincil metin: ayrı gri yerine **beyaz %60**
- [x] Bölüm dolgusu: ondalıklı değerler → sabit **96px**
- [x] İçerik kolonu 1200 → **1240px**
- [ ] Aksan rengini yeniden seç (soğuk mavi kategoriye ait — sıcak bir ton ayırt edici)
- [x] Mono mikro etiket ölçeği ekle (11px, uppercase, +1.1px tracking)

### Faz B — hero yeniden kurgusu
- [x] CTA'yı ürün panelinin **üstüne** taşı
- [x] Spekülerı başlık kolonunun dışına al (arka plan korundu — silinmedi)
- [ ] `MetalSheen` parlamasını gözden geçir
- [ ] (Değerlendirilecek) v0 tarzı çalışan prompt kutusu

### Faz C — güven katmanı
- [ ] Mono mikro etiketli logo duvarı bölümü
- [ ] Müşteri sözü bloğu (isim + unvan + şirket)
- [ ] Sayısal iddia şeridi

### Faz D — app içi
- [ ] Aynı tipografi ölçeğini app'e taşı (sidebar zaten Cursor 1:1)
- [ ] Aksan rengini app'te de uygula

### Faz E — logo
- [ ] Referans görsellerden yola çıkarak marka işareti önerileri
