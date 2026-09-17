# Cloud, Local ve native pencere doğrulaması

7 Eylül 2026 · `codex/reference-ui-rebuild` · RIFT UI Preview

## Doğru uygulama ve kapsam

Çalışılan uygulama `dist/RIFT UI Preview.app` (`app.riftsys.ui-preview`), web yüzeyi `http://localhost:3020`, kaynak ağacı `/Users/cetto/.codex/worktrees/rift/reference-ui`.
`/Applications/RIFT.app` eski kopyadır; bu çalışmada güncellenmedi. Üretim deployment'ı yapılmadı.

Kullanıcının “rakipler Cloud'da da Mac kullanıyorsa RIFT de kullansın” koşulu resmî kaynaklarla kontrol edildi. Standart yönetilen Cloud ortamları Mac değildir:

| Ürün | Cloud ortamı | Birincil kaynak |
| --- | --- | --- |
| Codex | Linux container; `universal` tabanı | [Cloud ortamı](https://developers.openai.com/codex/cloud/environments/), [OpenAI container kaynağı](https://github.com/openai/codex-universal) |
| Claude Code | Ubuntu 24.04 / x86_64 VM | [Anthropic cloud environments](https://code.claude.com/docs/en/cloud-environments#whats-available-in-cloud-sessions) |
| Cursor | İzole Ubuntu makinesi | [Cursor cloud setup](https://cursor.com/docs/cloud-agent/setup) |

RIFT bu nedenle seçilmiş bilgisayarda Local komut çalıştırmayı ve ayrı Linux ortamında Cloud komut çalıştırmayı korur. Mac masaüstü arayüzü, modelin hizmet aldığı sunucu ve araçların çalıştığı işletim sistemi ayrı katmanlardır. Local çalışma çevrimdışı model anlamına gelmez.

## Önce / sonra / gerekçe

| Önce | Sonra | Neden |
| --- | --- | --- |
| Local tercihi manager/worker tarafından Cloud'a çevrilebiliyordu. | Gerçek owner-checked runner'a yönlendirilir; bağlantı yoksa açık hata, Cloud allocation yok. | İş kullanıcının seçtiği bilgisayarda kalmalı. |
| Eksik runner sohbet açılırken Cloud'a düşebiliyor; Plan→Build seçimi kendiliğinden Local'a geçebiliyordu. | Hedef restore edilir ve mod değişiminde korunur. | Mod ve bilgisayar seçimi farklı kararlardır. |
| CLI kurulum talimatı mevcut olmayan npm paketine yönlendiriyordu. | Workbench ayarlarında gerçek dağıtım paketiyle bağlantı komutu ve bilgisayar seçimi bulunur. | Local araç yürütmenin kullanılabilir bir bağlantı akışı olmalı. |
| Bağlantı yenilenirken komut/yazma tekrar dispatch edilebiliyordu. | Tek dispatch, native sonuç cache'i ve belirsiz sonuçta otomatik tekrar etmeme. | ACK kaybı, işlemin hiç gerçekleşmediği anlamına gelmez. |
| Uyku/bağlantı kesilmesi eski SDK okuyucusunu bırakabiliyor; yeni okuyucu eskiyle çakışabiliyordu. | Mevcut run'a tek GET recovery; eski okuyucu kapandıktan sonra yeni okuyucu. | Yeni iş başlatmadan transcript toparlanmalı. |
| Offline tamamlanan yanıt aynı message ID / part sayısı nedeniyle eksik kalabiliyordu. | İçeriği karşılaştıran ve daha yeni yerel metni koruyan persisted hydration. | Mesaj kimliğinin eşitliği, içeriğin tamamlandığını kanıtlamaz. |
| Native pencere compact titlebar stilindeydi. | Public AppKit `NSToolbar` + `Unified` stil, native gölge ve separator kapatma. | Dış maske, köşeler ve fullscreen geçişini macOS belirler. |
| Mac'te pencere kapatma süreç ve native çalışma durumunu bitirebiliyordu. | Close gizler; Reopen gösterir; açık Quit mevcut terminal temizliğini korur. | Pencere kapatma ve uygulamadan çıkma farklı niyetlerdir. |

## Gerçek çalışma kanıtı

**Local:** test için oluşturulan named CLI runner, mevcut dev hesaba ait tokenı döndürmeden/kayıt etmeksizin kullanılarak çalıştırıldı. Latest Hybrid manager tam connection ID'sine bağlandı. Gerçek komut `darwin LOCAL_OK` döndürdü; `/tmp/rift-local-resilience-smoke/verified.txt` nonce'ı orijinal Mac filesystem'inden doğrulandı. Cloud allocation yapılmadı. Test runner'ı sonunda kapatıldı.

**Cloud:** designated smoke chat için yalnız ayrı HMAC namespace kullanıldı; mevcut kullanıcı/project sandbox'ı değiştirilmedi. Latest Hybrid manager `e2b` seçimiyle gerçek Linux ortamında komut çalıştırdı ve remote dosya okumasıyla nonce doğrulandı. Aynı yol Mac'te oluşmadı. Test dosyası ve yeni test sandbox'ı temizlendi. Model çağrısı yapılmadı.

**CLI artifact:** `rift-cli` 0.8.4 build/pack başarılı; 23.229 byte, SHA-256 `541d7b63dd911020f275af4028bc95f2729fa06321172d36f704355631474e45`. UI Preview'ın `/downloads/rift-cli.tgz?v=0.8.4` yanıtı HTTP 200 ve paketle byte/hash olarak aynı. Npm publish yapılmadı.

## Native ve arayüz kontrolü

- Doğru bundle yeniden derlenip açıldı; `cargo check` ve native build başarılı.
- Açık uygulamada köşe geometrisi ve dark tema görsel olarak kontrol edildi.
- Native close kontrolü sonrası aynı PID ve URL korundu. Daha önce verilmiş test klasörü grant'i Settings'te hâlâ vardı; test sonunda yalnız bu geçici grant kaldırıldı.
- Native fullscreen'e girildi ve View menüsüyle normal pencereye dönüldü; aynı Settings sayfası korundu. Fullscreen menüsünün metni hâlâ `Enter Full Screen` kalabiliyor; bu kontrol, dinamik menü başlığının doğruluğunu kanıtlamaz.
- Account menüsü → Settings → Workbench & terminal akışı ve gerçek Local runner kartı native uygulamada görüldü. Özel token UI'a basılmadı. Native clipboard'a özel komut kopyalama ayrıca denenmedi.
- Kullanıcının başka canlı sohbetleri gönderilmedi, iptal edilmedi veya yeniden başlatılmadı.
- Ana ekrana dönünce test için yazılmış `Window recovery check — keep this draft` taslağı aynı içerikle duruyordu; doğrulandıktan sonra yalnız bu test taslağı temizlendi. Hedef menüsünde Cloud, gerçek bilgisayar adı ve Manage computers bağlantısı native uygulamada görüldü. Uygulama normal pencere modunda, temiz ana ekranda bırakıldı.

## Kontroller

- Native: 37 Rust testi geçti; log `/tmp/rift-native-final-tests.log`.
- Hedef seçimi / mod / gönderim: son 4 suite / 20 test; `/tmp/rift-final-target-tests.log`. Önceki GlobalState 4 suite / 15 test ve ek cancellation kontrolleri ayrı loglardadır.
- Stream recovery ve hydration: 8 suite / 91 test; gerçek kurulu SDK reader lifecycle dahil. [Stream raporu](stream-resilience.md).
- Local relay / CLI / PTY: 9 suite / 112 test. Terminal follow-up 5 suite / 61 test; bu sayı öncekiyle örtüşür, toplanmamalıdır. [Local raporu](local-resilience.md).
- Cloud routing/checkpoint/onboarding: 17 suite / 109 test. Son Plan/prompt follow-up 8 suite / 122 test ve 24 snapshot; öncekiyle örtüşür. [Cloud raporu](cloud-resilience.md).
- Tam TypeScript kontrolü ve değiştirilen root dosyalarının ESLint kontrolü başarılı. Son ek sidebar düzeltmesi kendi regression doğrulamasına sahiptir.
- Son ortak doğrulama: **18 suite / 148 test**, sıfır hata; hedef seçimi, mode switch, cancellation, dört GlobalState alanı, sidebar ve sekiz stream/hydration suite birlikte çalıştırıldı. Log `/tmp/rift-resilience-integrated-tests.log`. Bu koşudan sonra tam TypeScript kontrolü de exit 0 verdi.

Sidebar son kontrolü: artık bulunmayan veya kullanıcıya ait olmayan sohbetin run kaydı, owner-enforced chat lookup ile Active bağlantısından çıkarılır. Sorgu yüklenirken run korunur ve bağlantısı devre dışıdır. Mevcut run/Activity kayıtları değiştirilmez. Canlı gözlemdeki ORBIT sohbeti servis query'sinde de yoktu; geçici mi, silinmiş mi veya başka istemci/worker ortamında mı oluşturulduğu kanıtlanmadı. Bu nedenle gerçek run iptal edilmedi veya yeniden gönderilmedi.

## Sınırlar

Bu doğrulama iki gerçek araç yürütme ortamını kanıtlar; bütün modellerde uçtan uca başarılı Build veya her ağ arızasında kayıpsız devam garantisi değildir. Bu geçişte ücretli LLM Build çalıştırılmadı.

UI Preview web sunucusu ve `trigger dev` worker'ı geliştirme Mac'inde çalışır. Cloud araç sandbox'ının Linux'ta olması, bu geliştirme worker'ının Mac kapalıyken devam edebildiği anlamına gelmez. Bilgisayar kapalıyken tam Cloud iş yaşam döngüsü, dağıtılmış hosted worker sürümüyle ayrıca doğrulanmalıdır.

Local runner model/orchestration bağlantısı için ağa ihtiyaç duyar. App/runner process ölümü sırasında dış komut sonucu belirsiz kalabilir; in-memory dedup restart sonrası kalıcı exactly-once garantisi vermez. Native file grant'leri açık Quit sonrası tekrar seçilmelidir. Cloud-specific workspace API'leri, genel Local Build komutlarından ayrı kalır.

## Kanıt dosyaları

- `/tmp/rift-real-local-smoke.log`
- `/tmp/rift-cloud-resilience-smoke-evidence.json`
- `/tmp/rift-cloud-resilience-smoke.log`
- `/tmp/rift-cli-0.8.4-verification.json`
- `/tmp/rift-resilience-final-typecheck.log`
- `/tmp/rift-final-root-lint.log`

Native geometri dayanağı: [Apple — Build an AppKit app with the new design](https://developer.apple.com/videos/play/wwdc2025/310/).
