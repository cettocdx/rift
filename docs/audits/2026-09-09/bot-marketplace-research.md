# RIFT Bot ve MCP Market Araştırması

## Sonuç

RIFT için önerilen yapı, mevcut model bağımsız harness üzerinde çalışan kalıcı proje botları ve resmî MCP Registry’den beslenen, RIFT tarafından doğrulanan bir katalogdur. Bot kimliği, sohbeti, görevleri ve proje üyeliği kalıcı kayıtlara bağlanmalıdır. Mevcut agent kartlarının görsel olarak yenilenmesi tek başına bu çalışma biçimini sağlamaz.

MCP marketi ile bağlantı servisi farklı katmanlardır. Registry sunucuları keşfetmeye yarar; OAuth oturumlarını yönetmez. OAuth destekleyen sağlayıcılar tek Connect eylemiyle kendi izin ekranlarına yönlendirilebilir. API anahtarı veya yerel kurulum isteyen sunucular için evrensel, kimlik bilgisi gerektirmeyen bir OAuth akışı yoktur.[1][2]

Smithery ve Composio yönetilen bağlantı seçenekleridir. RIFT’in var olan doğrudan OAuth bağlantılarını değiştirmek yerine, kapsamı gerçekten artırdıkları sağlayıcılarda isteğe bağlı adaptör olarak değerlendirilmelidir. Böylece proje ve bot kayıtları başka bir bağlantı şirketinin veri modeline bağımlı olmaz.[3][4]

## Grok Bot: kalıcı ekip üyesi modeli

Grok’un bot modeli ad, sorumluluk, özel sohbet ve zaman içinde korunan çalışma bağlamını bir araya getirir. Bot kopyalama, çalışma kimliğini yeniden kullanmaya yarar; özel konuşma geçmişinin kopyalanmasıyla aynı işlem değildir. Grup sohbetleri uzmanlar arasındaki iş devrini görünür tutar.[5]

Mesajlaşma akışında skill, bot ve bağlantı referansları bulunur. Bir grupta belirli bir bota yönlendirme ile ortak sonuç için iş paylaşımı ayrılır; başka bir bota gönderilen iş asenkron olarak ilerleyebilir. Bu ayrım, her mesajda bütün botların aynı anda çalışmasını önlemek için RIFT açısından değerlidir.[6]

Grok Bot’un bulut bilgisayarı hesap kapsamındadır: farklı botların farklı kimlikleri olması, dosya ve giriş oturumlarının kendiliğinden birbirinden izole olduğu anlamına gelmez. RIFT’in proje ayrımı açık bir veri ve erişim sınırı olarak tasarlanmalıdır.[7]

### Masaüstü gözlemleri

Grok Bot masaüstünde bot sohbeti, profil düzenleme bölümü, rutin paneli, Plugins ve Bots marketleri ve bir proje yöneticisi şablonunun detayları incelendi. Bu gözlemler görsel ve etkileşim düzenine ilişkindir; arka plandaki yürütme motorunun performans ölçümü değildir.

Arayüzün temel nesnesi bot satırıdır. Avatar, isim ve son etkinlik kısa bir satırda yer alır; bot seçilince sohbet açılır. Ayrıntılar gerektiğinde sağ panelde gösterilir. Rutinler sohbetin içine sürekli bir yönetim formu olarak yerleşmez.

Marketin Plugins ve Bots görünümleri ayrıdır. Bot şablonu detayında Instructions, Skills ve Integrations ayrı bölümlerdir. Şablonun rolü, eklenmeden önce okunabilir. Büyük renkli illüstrasyonlar yerine küçük ölçekte tanınan basit avatarlar kullanılır. RIFT için alınması gereken ilke bu okunabilirliktir; aynı avatar çizimlerinin kullanılması önerilmez.

| Alan | RIFT kodunda mevcut durum | Önerilen değişiklik | Kullanım gerekçesi |
|---|---|---|---|
| Agent kimliği | Ortak roster, özel profil ve runtime ayarları | Proje üyeliği olan kalıcı bot | Aynı uzmanla sonraki gün devam etmek |
| Botla konuşma | Profil testinden yeni Build sohbeti | Bot için sabit özel sohbet | Geçmişi ve sorumluluğu korumak |
| Uzman seçimi | Katalog ve ayar yoğunluğu | Kompakt roster ve isteğe bağlı detay | Sohbeti ana çalışma alanı yapmak |
| Skill paketi | Profilde seçilen skill kimlikleri | Sürümlü rol paketi, görev çıktısı ve bitiş ölçütleri | Rolün yalnızca bir isim olmamasını sağlamak |
| Proje görevleri | Genel görev kayıtları | Proje ve bot ataması | Görevin sahibini görünür kılmak |
| Toplantı | Kalıcı toplantı modeli yok | Gündemli yazılı grup oturumu | Kararları görevlerle ilişkilendirmek |
| Bağlantılar | Sabit katalog ve gerçek OAuth doğrulaması | Katalog kaynağı ekleme, doğrulamayı koruma | Daha geniş keşif ve doğru bağlantı durumu |

## MCP market seçenekleri

### Resmî MCP Registry

Registry, sunucu metadata kayıtlarını yayımlayan bir kaynaktır. Paketleri barındırmaz. RIFT gibi bir ürün için uygun kullanım, sunucuda önbelleklenen bir keşif katmanı oluşturmak ve kullanılabilir kayıtları kendi bağlantı doğrulamasıyla sunmaktır.[1]

Resmî rehber, aşağı akış toplayıcılarının veriyi önbelleklemesini ve kendi kalıcı katmanlarını kullanmasını önerir. RIFT sayfasını her açışta Registry’ye bağlı kılmak gereksiz gecikme ve dış servis bağımlılığı yaratır.[8]

Canlı API örneği 9 Eylül 2026 tarihinde iki kayıtla kontrol edildi. Yanıtta `servers`, `server.name`, `version`, `remotes`, resmî metadata içinde `status` ve `isLatest`, ayrıca `metadata.nextCursor` alanları bulundu. İki kayıt aynı sunucunun farklı eski sürümleriydi. Bu nedenle ilk sayfayı olduğu gibi kartlara çevirmek hem mükerrer hem eski sonuçlar üretebilir. Sürüm ve aktiflik filtreleri gereklidir.[9]

Registry kaydı; endpoint’in o anda erişilebilir olduğunu, hesabın OAuth alabileceğini veya kullanılan araçların bir projeye uygun olduğunu tek başına kanıtlamaz. Katalog kartı keşif bilgisi, bağlantı kaydı ise kullanıcıya ait doğrulanmış oturum olarak ayrı tutulmalıdır.

### Smithery

Smithery Connect, bağlantı nesnesi ve yetkilendirme için yönlendirme URL’si sağlayabilir; yönetilen akış, upstream kimlik doğrulama ayrıntılarını azaltır. Yetkilendirme tamamlanmadan araç çağrısının kullanılabilir olduğu varsayılmamalıdır. Entegrasyon, RIFT kullanıcıları arasında ayrı bağlantı kapsamları ve sunucuda tutulan platform kimlik bilgileri gerektirir.[3]

Avantajı, bazı sunucularda kurulum ve token yenileme yükünü azaltmasıdır. Dezavantajı ek çalışma zamanı bağımlılığı ve bağlantı servisinin işletim koşullarıdır. Kapsam ve toplam maliyet gerçek sağlayıcı listesiyle doğrulanmadan bütün kataloğu buna taşımak önerilmez.

### Composio

Composio, kullanıcıya bağlanan hesaplar ve sağlayıcı izinleri için yönetilen bağlantı akışları sunar. OAuth token yenilemesi ve tekrar bağlantı ihtiyaçları platform akışının parçasıdır. Bazı entegrasyonlar API anahtarı veya farklı kurulum biçimleri kullanır; bir toolkit’in bulunması tüm kullanıcılar için izinsiz otomatik erişim demek değildir.[4]

Ürün araçları kapsamı için güçlü bir seçenek olabilir, ancak bir MCP sunucu diziniyle birebir eşdeğer kabul edilmemelidir. Uygulama kendi kullanıcı kimliğini, proje erişimini ve bağlı hesap sahipliğini korumalıdır.

### Karşılaştırma

| Seçenek | Keşif | Kimlik doğrulama | RIFT için konum |
|---|---|---|---|
| Resmî Registry + mevcut OAuth | Açık MCP metadata | RIFT ve sağlayıcı arasında | Önerilen temel |
| Smithery Connect | Sunucu/bağlantı ekosistemi | Yönetilen bağlantı servisi | Sağlayıcı bazında isteğe bağlı adaptör |
| Composio | Toolkit ve hesap entegrasyonları | Yönetilen bağlı hesaplar | Ek uygulama kapsamı için adaptör |

## Tek tık bağlantının ürün anlamı

Kart üzerindeki birincil eylem sağlayıcının gerçek durumuna göre seçilmelidir. OAuth destekleniyorsa Connect, izin ekranını açar. Genel erişime açık sunucuda Connect doğrulamayı başlatır. Anahtar gerekiyorsa Set up, küçük ve açık bir kimlik bilgisi formu açar. Yerel STDIO sunucusu gerekiyorsa çalışma ortamı ve paket kurulumu ayrı belirtilir; bir HTTP adresi varmış gibi sunulmaz.[2]

RIFT’in mevcut kodu doğrulanmış bağlantı ile belirsiz veya dikkat gerektiren bağlantıyı ayırıyor. Yeni market bu ayrımı korumalıdır. OAuth callback’inden sonra protokol başlangıcı ve araç listesinin alınması başarılı olmadan Connected etiketi görünmemelidir. İptal edilen izin akışı katalog kartını kalıcı yükleniyor durumunda bırakmamalıdır.

Yeni Registry kayıtları mevcut sabit sağlayıcı kimliklerine doğrudan taklit ettirilmemelidir. Kodda `mcp-oauth-catalog.ts` endpoint ve katalog kimliği eşleşmesini doğruluyor. Dinamik kayıtlar için sunucu tarafında kaynak, sürüm ve endpoint’i çözen ayrı yol gerekir. Bu, yeni katalog eklenirken korunması gereken somut bir sınırdır.

## RIFT altyapısı ve değişiklik kapsamı

İncelenen çalışma kopyası `/Users/cetto/.codex/worktrees/rift/reference-ui` dizinidir. Agent profilleri, ekipler, skill ve MCP seçimleri zaten vardır. Bunlar `pet-roster.ts`, `runtime-policy.ts` ve `AgentsWorkbench.tsx` üzerinden kullanılmaktadır. Roster bir yönetilen skill kaydında saklanır; yalnızca tarayıcı belleğine dayanmamakla birlikte proje botu ve özel bot sohbeti için ayrı bir veri modeli değildir.

Convex `projects` kayıtlarında `agent_mention` bulunur. `tasks` ve `task_runs` kayıtları zamanlama ve dayanıklı çalışma altyapısı sağlar. Bunların üzerine proje ve bot ilişkileri eklenebilir. Yeni bot sistemi için ikinci bir scheduler veya farklı bir model motoru kurmak gereksizdir. Mevcut Vercel AI SDK/harness, onay sınırları, checkpoint ve iptal davranışları kullanılmalıdır.

Botun rolü sistemin her aracı kullanması anlamına gelmemelidir. Her rol için dar başlangıç skill paketi, bağlı kaynaklar, beklenen çıktılar ve tamamlanma koşulları tanımlanmalıdır. Bir bota yeni skill eklemek, ilgili MCP hesabına otomatik erişim vermemelidir. Profil, erişim ve görev ataması ayrı kararlar olarak tutulmalıdır.

## Açılış ekranı ve görsel yön

Mevcut RIFT açılış bileşeni büyük kelime işareti, ışık ufku ve animasyon içeriyor. Daha sade bir uygulama açılışı için küçük RIFT işareti, tek satır açıklama ve yalnızca gerçek bekleme/hata durumunun gösterilmesi önerilir. Uygulama hazırsa animasyonun bitmesi beklenmemelidir. Son proje ve botlara geçiş, başlangıç ekranının asıl işlevi olmalıdır.

Cursor masaüstü kabuğu bu oturumda incelendi; New Chat eylemi mevcut kurulumda AgentPanel hatasına döndü. Bu nedenle Cursor’un açılış akışının eksiksiz gözlendiği veya başlangıç süresinin ölçüldüğü iddia edilemez. Sade kabuk ve kompakt tipografi referans olarak kullanılabilir; RIFT açılışının sonucu kendi ölçümleriyle doğrulanmalıdır.

RIFT bot avatarları için öneri, mevcut parçalı RIFT işaretinden türetilen sade bir çekirdek ailesidir. Her uzmanı farklı küçük geometrik detay ve kontrollü vurgu rengi ayırır. Çalışma durumu ayrı bir küçük işaretle gösterilir; avatarın kendisi sürekli hareket etmez. 20, 28 ve 40 piksel boyutlarda tanınabilirlik kontrol edilir.

## Teslim ve doğrulama

İlk uygulama dilimi kalıcı proje botu, özel sohbet ve görev atamasıdır. İkinci dilim market kaynağı ve bağlantı akışının genişletilmesidir. Yazılı toplantı ve rutinler üçüncü dilimde mevcut durable görev altyapısına bağlanır. Açılış kabuğu, normal sohbet ve bot ekranı aynı font, odak ve panel geçiş kurallarını kullanır.

Başarı yalnızca ekran görüntüsüyle ölçülmemelidir. Bot değiştirip geri dönme, devam eden görevden ayrılma, OAuth iptali, bağlantı yenileme, iki kez toplantı başlatma ve özel sohbet sahiplik kontrolleri ayrı senaryolardır. Yoğun çıktı sırasında klavye gecikmesi ve panel kare süreleri üretim derlemesinde ölçülmelidir. Araştırma, rakiplerle performans eşitliği veya sıfır hata garantisi sağlamaz.

## Kaynaklar

1. MCP, [About the MCP Registry](https://modelcontextprotocol.io/registry/about), erişim 9 Eylül 2026.
2. MCP, [Authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), sürüm 2025-11-25.
3. Smithery, [Connect](https://smithery.ai/docs/use/connect), erişim 9 Eylül 2026.
4. Composio, [Authentication](https://docs.composio.dev/docs/authentication), erişim 9 Eylül 2026.
5. SpaceXAI, [Create and manage Bots](https://docs.x.ai/grok-bot/bots), güncelleme 7 Eylül 2026.
6. SpaceXAI, [Message and collaborate](https://docs.x.ai/grok-bot/chat-and-collaboration), güncelleme 2 Eylül 2026.
7. SpaceXAI, [Grok Bot overview](https://docs.x.ai/grok-bot/overview), erişim 9 Eylül 2026.
8. MCP, [Registry aggregators](https://modelcontextprotocol.io/registry/registry-aggregators), erişim 9 Eylül 2026.
9. MCP Registry, [API documentation](https://registry.modelcontextprotocol.io/docs); `/v0.1/servers?limit=2` canlı yanıtı, 9 Eylül 2026.

Yerel kanıtlar: Grok Bot masaüstü profil/rutin/market görünümleri; Cursor Agents masaüstü kabuğu ve New Chat hata durumu; RIFT `convex/schema.ts`, `convex/projects.ts`, `convex/tasks.ts`, `lib/ai/agents/pet-roster.ts`, `lib/ai/agents/runtime-policy.ts`, `app/components/agents/AgentsWorkbench.tsx`, `app/components/mcpCatalog.tsx`, `app/components/McpMarketplace.tsx`, `lib/ai/mcp/mcp-oauth-catalog.ts`, `components/launch/AppLaunchScreen.tsx` ve `components/launch/launch-screen.css`. Bunlar incelenen çalışma kopyasına ait gözlemlerdir; tamamlanmış yeni özellikler olarak sunulmamaktadır.
