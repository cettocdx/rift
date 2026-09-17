# RIFT
## Ürün ve agent denetimi
7 Eylül 2026 · İlk düzeltme paketi · Yerel geliştirme sürümü

### Temel sonuç
Rift’in sorunları yalnızca font, ikon veya boşluk düzeniyle sınırlı değil. İnceleme, kullanıcı bir işlem başlattığında hangi ayarın kullanıldığını, görevin ne zaman bittiğini ve doğrulamanın hâlâ geçerli olup olmadığını etkileyen hatalar ortaya çıkardı. İlk düzeltme paketi bu akışlara odaklandı.

Agent tarafında araç kullanımı, kalıcı worker, akışa yeniden bağlanma, context özetleme, bütçe takibi ve doğrulanmış önizleme için uygulanmış altyapı var. Buna karşılık kesintisiz uzun görev, atomik görev başlatma ve bağımsız araç kullanabilen alt agent kabiliyetleri henüz rakiplerle eşdeğer kabul edilemez. Aynı görevleri aynı koşullarda çalıştırmadan bir güç yüzdesi vermek doğru olmaz.

### Ölçülenler
| Kontrol | Sonuç | Ne anlama geliyor? |
|---|---|---|
| İlk harness taraması | 23 test grubu / 236 test geçti | Mevcut çalışma sözleşmeleri; gerçek model görev başarısı değil. |
| Harness düzeltmeleri | 10 grup / 129 test geçti | Sahiplik, durum belirsizliği, doğrulama ve Stop davranışları. |
| Görev tamamlama politikası | 2 grup / 29 test geçti | Gerçek AI SDK döngüsü, senaryolu model ile sınandı. |
| UI akışları | 5 grup / 35 test geçti | Agent kaydı/testi, giriş, yönlendirme ve sohbet entegrasyonu. |
| Tema içe aktarma | 1 grup / 13 test geçti | Geçersiz dosya mevcut görünümü artık değiştirmiyor. |
| Son UI regresyonları | 3 grup / 14 test; sekmeler 7/7 | Taslak/test izolasyonu, uzun test metni ve sekme odağı. |
| Oturum yenileme | 1 grup / 9 test geçti | Geçici hata oturumu silmez; kesin geçersizlik çıkışa izin verir. |

Test grupları kısmen örtüşür; rakamlar toplanarak tek bir benzersiz test sayısı oluşturulmadı. TypeScript ve değişen dosyaların lint kontrolleri temiz geçti. Gerçek rakip görev koşuları veya yeni ücretli LLM denemeleri yapılmadı.

### Kapsam sınırı
Kaynak: codex/reference-ui-rebuild çalışma ağacı ve localhost:3020. Ana ekran, Studio, Plugins ve Skills açık temada canlı incelendi; sekme odak kaybı doğrulandı. Oturum/bağlantı kesintileri nedeniyle tam görsel, koyu tema ve native masaüstü taraması tamamlanamadı. Üretim riftsys.app ve kurulu dağıtım bu paketin yayımlandığı sürümler değildir.

<!-- pagebreak -->
## Düzeltilen davranışlar
### Agent ve yürütme
**1. Görev sahipliği önce denetleniyor.** Başka bir kullanıcıya ait sohbet kimliği verildiğinde, önceki akış aktif görev bilgisini açıklayabiliyor veya iptale girişebiliyordu. Sohbet ve proje yetkisi artık bu işlemlerden önce doğrulanıyor. Eski kodda beş regresyondan üçü başarısız oldu; yeni akış aynı sahibin değiştirme davranışını koruyor.

**2. Bağlantı hatası “görev bitmiş” sayılmıyor.** Trigger sorgusunda ağ hatası, 5xx veya bilinmeyen durum yeni görev başlatmaya izin vermiyor. Yalnızca kesin sonlanma veya 404, görevi pasif kabul ettiriyor. Eşzamanlı iki başlangıcın atomik biçimde engellenmesi ayrı bir açık konu.

**3. Her komut web sitesi işi sayılmıyor.** pwd, kütüphane düzenleme veya görsel üretme gibi işler artık zorunlu web önizlemesi döngüsüne sokulmuyor. verify_app / expose_preview ile açıkça başlayan önizleme akışı mevcut doğrulama kapısını koruyor. Regresyonda üç yanlış zorunlu-tool seçimi yeniden üretildi.

**4. Eski doğrulama yeni düzenlemeyi onaylamıyor.** Rift yürütücüsünde düzenleme başladığında ve bittiğinde çalışma revizyonu değişiyor; eski önizleme kanıtı temizleniyor. Başarısız yazma ve eşzamanlı düzenleme de kapsanıyor. Salt okuma ve onaylanmadan reddedilen işlem geçerli kanıtı bozmaz. Harici/background değişiklikler ve OpenCode’un native düzenlemeleri bu yeni takibin kapsamı dışında.

**5. Stop doğrulama aşamalarına iletiliyor.** Doğrulama aracı iptal sinyalini kontrol ediyor; E2B build/probe işleminin handle’ı üzerinden kill çağırıyor, masaüstü komutuna sinyal aktarıyor, tarayıcıyı kapatıyor. İptal sonrası sonraki doğrulama aşamasına geçilmiyor. Canlı E2B durdurma gecikmesi ölçülmedi; doğrulama kontrollü test çiftleriyle yapıldı.

**6. Geçici auth hatası oturumu silmiyor.** Yenileme sırasında ağ/sunucu hatası, geçersiz kimlik gibi çerezleri temizliyordu. Proxy artık refresh’i 250 ms sonra en fazla bir kez tekrar dener; sorun sürerse kimliği koruyarak genel 503 ve Retry-After döner. Açık tokens:null veya bozuk refresh hâlâ çıkışa götürür. OAuth kodları tekrar gönderilmez. Önce altı regresyon başarısız oldu; düzeltmeyle dokuz test geçti. Mevcut istemci 503’ü kendisi otomatik tekrar denemiyor. Canlı kopuşun tema değişiminden kaynaklandığı kanıtlanmadı.

<!-- pagebreak -->
## Düzeltilen kullanıcı akışları
**7. Save & test kayıt sonucuna bağlı.** Kayıt başarısızsa test açılmıyor. Başarılı kayıttan sonra doğru @agent: ifadesiyle, yeni sohbet hazır olduğunda tek gönderim yapılıyor; sabit süreli bekleme kaldırıldı. Test, önceki composer taslağının dosyalarını ve upload durumunu devralmıyor; taslak metni/eklerini temizlemiyor. Limit aşan test metni navigasyon öncesinde reddedilip düzenlenebilmesi için dialogda tutuluyor. Son kontrolde dört regresyon yeniden üretildi; ardından ilgili üç grupta 14 test geçti.

**8. Giriş bağlantıları doğru hedefe gidiyor.** Korunan sayfalar ve Tasks, login sayfasına yönlendiriyor; güvenli dönüş yolu ve query korunuyor.

**9. Run detayından doğru çalışma açılıyor.** Build, Studio ve Hack kendi hedeflerine gider; geçersiz veya eksik kimlik için yanıltıcı açma düğmesi gösterilmez.

**10. Tema importu görünümü koruyor.** Boş veya ilgisiz JSON dosyası başarı olarak kabul edilmiyor. Altı renk alanı ve varsa biçim bilgileri doğrulanıyor; mevcut renkler/font ayarı korunuyor. Önce 5 hata, sonra 13/13 başarılı test.

**11. Plugins / Skills sekmeleri sabit ve odak korunuyor.** Canlı ekranda Skills'e geçişte odak sayfa köküne düşüyordu. Sekme listesi artık panel değişiminden bağımsız ve aynı konumda. Tıklama ve ok tuşuyla seçim sonrası URL güncellemesi iki regresyonda önce başarısız oldu; düzeltmeyle yedi sekme testi geçti. Klavye odağı için nötr, yalnız focus-visible durumunda görünen çerçeve kullanılıyor. Son değişikliğin canlı yeniden kontrolü bağlantı kesintisi nedeniyle tamamlanamadı.

Kod kanıtları: agent-long/route.ts, agent-long-runs.ts, agent-step-tool-choice.ts, agent-stream-runner.ts, verify-app.ts, app-verification-mutations.ts; AgentsWorkbench, ProtectedPageSignIn, RunDetail ve AppearanceSettingsTab.

<!-- pagebreak -->
## Arayüz kapsamı ve kalan sorunlar
Aşağıdaki kapsam ağırlıkla kaynak kodu incelemesidir. Ana ekran, Studio, Plugins ve Skills ayrıca canlı görüntülendi; bu, tüm işlevlerin uçtan uca doğrulandığı anlamına gelmez. Önceki tipografi, hollow ikon, doğrudan Files seçimi, hesap menüsündeki Settings, nötr composer odağı ve gradient effort düzeni korundu.

| Alan | İncelenen akış / durum |
|---|---|
| Build ve sohbet | Rota eşitleme, yeni sohbet, agent test aktarımı; entegrasyon testleri geçti. IME koruması mevcut. |
| Studio | Amaç seçimi, giriş sınırı, sohbet rotası. Bu denetimde medya üretimi yapılmadı. |
| Plugins | Bağlantı/OAuth durumları, sekmeler, yeniden kontrol. Hesap bağlanmadı veya değiştirilmedi. |
| Agents | Profil, roster, template, Save & test; hata ve başarı akışı sınandı. |
| Runs / Tasks | Filtreler, log/kanıt, hedef rotaları; takvim/saat dilimi ve form kodu. Gerçek görev takvimi yazılmadı. |
| Notebook / Hack | Notebook bilinçli olarak Hack’e yönleniyor; erişim ve oturum yolu incelendi. Güvenlik çalıştırması yapılmadı. |
| Artifacts | Önizleme, filtre, kaynak ilişkisi, indirme ve kopyalama. |
| Settings | Dokuz bölüm, tema importu, gizlilik/hesap/billing sarmalayıcıları. Hesap veya ödeme değiştirilmedi. |
| Public / auth / admin | Giriş dönüş yolu, landing, pricing/download ve erişim sınırları. Yetkili admin verilerine girilmedi. |

### Sıradaki UI düzeltmeleri
**P2 - Klavye sekmeleri:** Runs, Tasks ve Agents ARIA tab bildiriyor; ok tuşları ve tek odaklı tab sırası eksik. Ortak klavye davranışı ya da uygun yerlerde filtre düğmesi kullanılmalı.

**P2 - Artifact hata geri bildirimi:** İndirme/kopyalama hatası kullanıcıya görünür bir kurtarma yolu sunmuyor. Beklenen: hata mesajı ve açık “orijinali aç / tekrar dene” eylemi.

**P2 - Studio giriş devamlılığı:** Çıkış yapılmış Studio eski landing’i kullanıyor; kayıt/girişten sonra Studio’ya dönüş amacı korunmuyor.

**Plugins odağı düzeltildi:** Ortak sekme satırının tıklama ve klavye ile panel değişiminde odağı koruduğu test edildi. Tam Skills yönetimi ve OAuth akışları canlı olarak sınanmadı.

**P3 - Admin erişim reddi:** Açıklama var fakat doğrudan giriş/uygulamaya dönüş eylemi yok. “Soon” bağlantıları tamamlanmış özellik sayılmamalı.

Settings ana sidebar’ı gizliyor; önceki çift-sidebar sorunu güncel bulgu sayılmadı. Canlı kontrolde API auth hatası sonrası giriş ekranı görüldü; tema değişimiyle nedensellik kurulmadı. Cursor ile piksel/font eşliği ve tüm tema kontrastları yeniden ölçülemedi.

<!-- pagebreak -->
## Harness nasıl çalışıyor, sınırı nerede?
### Mevcut yapı
Kullanıcı isteği → API sahiplik/abonelik/amaç kontrolleri → Trigger görevi → ortak model/araç döngüsü → izin kapısı ve sandbox/MCP araçları → akış + kalıcı kayıt → UI yeniden bağlanma ve sonuç gösterimi.

Ortak stream runner; bağlam özetleme, model hatası/fallback, döngü tespiti, token/süre/bütçe sınırları ve adım telemetrisini yönetiyor. Bu ortaklık web handler ile worker davranışının ayrışmasını azaltıyor. Araç çeşitliliği tek başına iş bitirme kalitesinin ölçüsü değil.

| Yetenek | Gözlenen durum | Ürün açısından sonuç |
|---|---|---|
| Worker ve akış devamlılığı | Trigger yürütme, replay/reconnect kodu ve testleri var. | Sekmenin anlık bağlantısı ile arka plan görevi ayrılabiliyor. |
| İzin kapısı | Sahiplik, ret, expiry ve loop durdurma sınanıyor. | Ret sonrası işi sessizce sürdürmemek temel sözleşme. |
| Context / bütçe | Özetleme, pruning, doom-loop ve run bütçesi mevcut. | Uzun iş için temel; tüm görev ömrüne yayılan garanti değil. |
| Doğrulama | Build/live/browser kontrolleri ve dosya kanıtı mevcut. | Yeni revizyon takibi Rift araç yolunda eski kanıtı geçersiz kılıyor. |
| Alt agent | En fazla dört, araçsız ve sınırlı düşünme çağrısı. | Bağımsız dosya okuyan, düzenleyen ve test eden çalışan takım sayılmaz. |
| Telemetri | İlk çıktı, adım/araç süresi, hata, token, cache, maliyet ve stop nedeni. | Gerçek görev benchmark’ı kurmak için kullanılabilir temel. |

### Öncelikli mimari açıklar
**P1 - Atomik başlatma:** Sohbet başına kontrol bir oku-sonra-başlat akışı. Aynı anda gelen istekler yarışabilir; devam/regenerate yolları ayrıca ele alınmalı. Kabul koşulu: iki eşzamanlı istek tek kalıcı run üretmeli.

**P1 - Kalıcı devam ve toplam bütçe:** Auto-continue sayacı browser ref’inde; yenilemede sıfırlanabilir, kapalı UI yeni bacağı başlatamaz. Devam kararı, kalan bütçe ve checkpoint sunucu durumuna taşınmalı.

**P1 - Yürütücüler arasında eşlik:** Full access/rollout ayarı OpenCode’u seçebilir; diğer modlar Rift yürütücüsüne gidebilir. İzin, iptal ve doğrulama testleri engine alanıyla ayrı koşulmalı. Native OpenCode ve harici düzenlemeler için revizyon takibi eksik.

**P2 - Gerçek çıktı değerlendirmesi:** Bazı e2e kontrolleri çıktı dosyasını ölçmek yerine yanıttaki “created/saved” gibi kelimeleri kontrol ediyor. Üretildi denilen dosyanın kendisi ve beklenen davranış denetlenmeli.

<!-- pagebreak -->
## Rakiplerle karşılaştırma
Bu tablo belgelenen kabiliyetleri karşılaştırır. Rakiplerin her görevi başarıyla tamamladığını veya Rift’ten belirli bir yüzde daha iyi olduğunu göstermez. Kaynaklara 7 Eylül 2026’da erişildi.

| Sistem | Belgelenen güçlü mekanizma | Rift için anlamı |
|---|---|---|
| Claude Code | Context temizleme/özetleme, ayrı alt-agent context’i, resume/fork; izin ile OS sandbox ayrımı. [S1, S2] | Yalnız model seçimi yerine context, kalıcı durum ve yürütme sınırını birlikte tasarlamak. |
| Cursor | Tarayıcı screenshot/console/network kanıtı; bağımsız cloud ortamında build/test ve branch handoff. [S4, S5] | UI değişikliği “render oldu” ile bitmemeli; davranış ve görünüm kanıtı completion kararına bağlanmalı. |
| Codex | Worktree, diff review, paralel uzman agent’lar; hedef ve doğrulama ölçütleriyle devam. [S9, S10, S13] | Bağımsız çalışma alanı, sonuç birleştirme ve kullanıcının devam eden işe yön verebilmesi önem kazanıyor. |
| OpenHands SDK | Event tabanlı durum, ayrılmış tool/workspace/context bileşenleri ve katmanlı değerlendirme. [S8] | Sistem hatasını model hatasından ayırmak; restart ve replay davranışını ilk sınıf sözleşme yapmak. |

### Reklam metninin ötesinde önemli ayrımlar
Claude checkpoint’i doğrudan file-edit araçlarına odaklanır; Bash ile değişen dosyalar ve çoğu subagent düzenlemesi rewind kapsamı dışındadır. Dolayısıyla Rift’te “Undo” eklenirse kapsamı açık olmalı; yalnız diff göstermek checkpoint değildir. [S3]

Cursor’un izin/allowlist mekanizması sert bir güvenlik sınırı olarak tanımlanmıyor. Codex ve Claude’un OS sandbox belgeleri ayrı bir izolasyon katmanını anlatıyor. Rift’te Ask/Auto/Full menüsünü göstermek, bu izolasyonu tek başına sağlamaz. [S2, S6, S11]

Cursor’ın Composer 2 raporu, kendi harness sonuçları ile üreticilerin bildirdiği sonuçları ayrı tutuyor; özel CursorBench doğrudan yeniden üretilebilir bir Rift karşılaştırması değil. OpenHands’ın 15 günlük kendi geçişinde bildirdiği 78→30 sistem hatası / 1.000 sohbet, Rift’e uygulanabilecek bir başarı puanı değildir. [S7, S8]

OpenAI’ın harness engineering anlatısı da sonucu repo yapısı, testler ve geri bildirim araçlarına bağlıyor; belirli bir modelin her projede aynı özerkliği sağlayacağı iddiası çıkarmıyor. [S12]

**Karar:** Bir sonraki yatırım, daha fazla ikon veya model adı eklemeden önce atomik görev durumu, kalıcı devam, doğrulama eşliği ve gerçek görev ölçümü olmalı. Görsel sadeleştirme bununla paralel, ekran kanıtı üzerinden yürümeli.

<!-- pagebreak -->
## Gücü ölçmek için tekrarlanabilir protokol
Bu protokol öneridir; aşağıdaki gerçek görev koşuları henüz yapılmadı. Mevcut deterministik testler ayrı raporlandı.

### Sabit değerlendirme koşulları
Aynı git başlangıcı, görev metni, model, effort, engine, approval mode, araç erişimi, süre ve maliyet bütçesi kullanılmalı. Her görev için en az üç tekrar başlangıç gürültüsünü görünür kılar; bu küçük örnek tek başına istatistiksel üstünlük ispatı değildir. Rakip bu koşulları desteklemiyorsa fark açıkça kaydedilmeli.

| Görev ailesi | Bağımsız başarı kanıtı |
|---|---|
| 1. Tek dosyalı bug | Önce başarısız olan davranış testi geçer; ilgisiz davranış bozulmaz. |
| 2. Çok dosyalı refactor | API uyumu ve fixture çıktıları korunur. |
| 3. Test yazma / teşhis | Eklenen test bilinen kusuru yakalar; yalnız uygulamayı kopyalamaz. |
| 4. UI düzeni | 390 ve 1440 px ekran, taşma kontrolü, klavye ile temel görev. |
| 5. API + UI değişikliği | Hata/başarı akışı ve yetki sınırı birlikte doğrulanır. |
| 6. MCP işlemi | Kontrollü test kaynağında gerçek sonuç ve izin kaydı. |
| 7. Uzun bağlam | Özetleme sonrası kullanıcı koşulları ve bekleyen işler korunur. |
| 8. Kullanıcı yönlendirmesi | Yeni talimat uygun araç sınırında uygulanır. |
| 9. Stop / reconnect | İptal sonrası yeni yan etki yok; replay ikinci yazma üretmez. |
| 10. Provider kesintisi | Yanlış tamamlandı iddiası yok; fallback ve bütçe kaydı tutarlı. |
| 11. Eşzamanlı başlatma | Aynı sohbet için yalnız bir kalıcı çalışma başlar. |
| 12. Ret / süre aşımı / sahiplik | Onaysız araç yürütme ve başka kullanıcı etkisi sıfır. |

Başarı oranı (pass@1), yanlış tamamlandı iddiası, sistem hatası / 100 run, izinsiz işlem, kullanıcı müdahalesi, p50/p95 süre, Stop gecikmesi, token ve başarılı görev başına maliyet ayrı sütunlarda tutulmalı. Başarısız run’lar paydadan çıkarılmamalı. Gerçek dosya ve test sonucu olmayan cevap, yalnız doğru tonda yazıldığı için başarılı sayılmamalı.

### Önizleme performansı notu
İlk HTTP turunda 35 rota planlandı; 16 istek timeout, iki sonuç belirsiz, 17 rota ziyaret edilmedi. Yeniden başlatma sonrası tur üç 20 saniyelik timeout ile durduruldu. Bunlar 500 hatası veya görsel bozukluk sayılmadı. Bir sıcak ana sayfa isteği 200 / 0,56 saniye; sonraki soğuk derleme 117 saniye sürdü. Canlı Studio ve Plugins sayfa istekleri daha sonra 200 / 226 ve 128 ms döndü; bu süreler etkileşime hazır olmayı ölçmez.

Next’in yanlış proje kökü düzeltildi; 7,9 GB geliştirme önbelleği için preview başlatıcısında disk cache kapatıldı, ikon paketinin import optimizasyonu eklendi. Soğuk derleme hâlâ yavaş; sıcak/soğuk ve makine yükü ayrılmadan hızlanma oranı verilemez. Next kök dizini dosya izleme ve çözümleme kapsamını etkiler. [S14]

<!-- pagebreak -->
## Kaynaklar ve kanıt notları
Kaynak türü: resmi ürün dokümanları ve özgün araştırma. Tarihi görünmeyen dokümanlarda erişim tarihi 07.09.2026’dır. Üretici kabiliyet beyanları bağımsız kalite ölçümü olarak sunulmadı.

[S1] Anthropic · How Claude Code works. https://code.claude.com/docs/en/how-claude-code-works

[S2] Anthropic · Sandboxing. https://code.claude.com/docs/en/sandboxing

[S3] Anthropic · Checkpointing. https://code.claude.com/docs/en/checkpointing

[S4] Cursor · Browser. https://cursor.com/docs/agent/tools/browser

[S5] Cursor · Cloud Agents. https://cursor.com/docs/cloud-agent

[S6] Cursor · Agent Security. https://cursor.com/docs/agent/security

[S7] Cursor Research Team · Composer 2 Technical Report. https://cursor.com/resources/Composer2.pdf

[S8] Wang ve diğerleri · The OpenHands Software Agent SDK, v2, 22.04.2026. https://arxiv.org/html/2511.03690v2

[S9] OpenAI · Introducing the Codex app, 02.02.2026. Lansman yazısı; güncel alt-agent ve hedef akışları S10/S13 ile kontrol edildi. https://openai.com/index/introducing-the-codex-app/

[S10] OpenAI · Subagents. https://learn.chatgpt.com/docs/agent-configuration/subagents

[S11] OpenAI · Sandbox. https://learn.chatgpt.com/docs/sandboxing

[S12] Ryan Lopopolo / OpenAI · Harness engineering, 11.02.2026. https://openai.com/index/harness-engineering/

[S13] OpenAI · Long-running work. https://learn.chatgpt.com/docs/long-running-work

[S14] Next.js · Turbopack configuration, 25.08.2026. Kurulu 16.2.6 tür tanımları da incelendi. https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory

### Yerel kanıt
Çalışma ağacı: /Users/cetto/.codex/worktrees/rift/reference-ui. Rapor tarihi itibarıyla kod, test günlükleri, route envanteri ve kaynak kayıtları karşılaştırıldı. Daha önceki sınırlı canlı izin denemesi, bu turdaki karşılaştırmalı performans sonucu olarak sayılmadı.

Tam görsel onay, gerçek OAuth bağlantısı, üretim yayını, canlı benchmark ve tam regresyon taraması ayrı doğrulama gerektirir. Bu rapor; gerçekleşen düzeltmeler, test edilmiş sözleşmeler, kaynak üzerinden saptanan açıklar ve henüz gözlenmeyen alanları birbirinden ayırır.
