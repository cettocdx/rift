# Cloud worker ve local runner güvenilirlik denetimi

7 Eylül 2026 · reference-ui çalışma ağacı · kaynak incelemesi ve kontrollü test fixture’ları

Bu denetim, Build’in seçilen bilgisayarda çalışması, iptali kaybetmemesi ve belirsiz bir araç işlemini otomatik tekrar etmemesi üzerine odaklanır. Gerçek kullanıcı sohbeti veya dosyası değiştirilmedi; servis yeniden başlatılmadı, deployment yapılmadı, ücretli model çalıştırılmadı.

## Kanıtlanan ve düzeltilen sorunlar

| Önce | Sonra | Kanıt / gerekçe |
| --- | --- | --- |
| Trigger iptali, worker’ın uzun hazırlık aşamasında gerçekleşirse sonradan eklenen `abort` listener olayı kaçırıyordu. | `linkAgentAbortSignal` mevcut `aborted` durumunu da aktarır. Worker girişinde kurulur; admission, MCP hazırlığı ve sandbox/model öncesinde iptal kontrol edilir; listener finally ile bırakılır. | `linked-abort.test.ts` eski event-only uygulamada önceden iptal edilmiş sinyal için başarısızdı. Yeni helper hem erken hem sonraki iptal nedenini korur. |
| `HybridSandboxManager` istenen local connection ID’sini yok sayıp E2B kullanıyordu. Factory de service key eksikliğinde varsayılan cloud manager’a düşüyordu. | Açık local seçim yalnız sahibine ait, `commands:true`, desktop dosya relay’i olmayan kayda gider. Yetki/config/presence hatası açık hatadır; E2B oluşturulmaz. | `hybrid-sandbox-local.test.ts`: sahiplik, eksik kayıt, dosya relay’i, capability ve presence hatalarında local/cloud factory sayıları kontrol edilir. Factory regression eski kodda Hybrid’in hiç çağrılmadığını gösterdi. |
| Bir cloud boot, kullanıcı local hedefe geçtikten sonra tamamlanıp yeni seçimin sandbox’ını ezebiliyordu. | Selection revision, eski callback/sonucun aktif hedefe yazmasını engeller. Geç kalan istek hata verir; yeni seçim korunur. | Geciktirilmiş cloud promise + tamamlanmış local seçim testi eski kodda yanlış cloud sonucu döndürdü. Yeni kod local adapter’ı ve callback kapsamını korur. |
| Önbellekteki local PTY capability, backend kaydında kaldırıldıktan sonra true kalabiliyordu. | Her local erişimde sahiplik ve presence; PTY sorgusunda güncel doğrulanmış metadata kullanılır. | Capability revoke regression önce true dönüyordu, şimdi false. |
| Worker Build’de local tercihi tools’a iletmiyordu; checkpoint kimliği farklı execution target’ları ayırmıyordu. | `executionPreference` tools’a iletilir. Local bağlantı ilk model çağrısından önce doğrulanır. Checkpoint request hash hedefi içerir; cloud tamamlanmış geçmişi local hedefe taşınmaz. | Worker kaynak bağlantıları: `trigger/agent-long.ts`; manager/factory ve mevcut checkpoint sözleşme testleri. Gerçek ücretli worker run bu geçişte çalıştırılmadı. |
| Cloud Workspace endpoint’leri genişleyen `AnySandbox` türünü E2B API’lerine taşıyabiliyordu. | Açık cloud manager’ı runtime E2B guard ile sınırlandırılır; local adapter kabul edilmez. Bu, seçilmiş local Build için cloud fallback oluşturmaz. | `workspace-server-security.test.ts` local adapter fixture’ında önce cloud action çalışıyordu; şimdi action çağrılmadan reddediliyor. |

## Korunan kurtarma ve iptal sınırları

- `trigger/agent-long.ts` tam agent task’ı için `maxAttempts: 1` kullanır. İçteki dar DB/network retry’ları bütün agent’ın veya tool side effect’inin yeniden çalıştırılması anlamına gelmez.
- Completed-step checkpoint’ler canonical assistant/tool history’yi saklar. Owner, claim, run, request hash ve model bağları doğrulanır; eski worker yeni run’ın checkpoint’ini yazamaz.
- Bir sonraki adımın başladığı fakat tamamlandığı kanıtlanamayan checkpoint otomatik resume için bloklanır. Aynı tamamlanmış request’in tekrarı terminal durumdan yeni araç çalıştırması yaratmaz.
- İptal tombstone’u ve skip-save koşulları, daha sonra stream alanları temizlense bile iptal edilmiş işin otomatik canlandırılmasını engeller.
- Desteklenmeyen büyük checkpoint veya model değişimi durable non-resumable duruma geçer; sıradan büyük dosya okuması sadece checkpoint limitinden dolayı bütün Build’i durdurmaz.
- Süreç ölümü sırasında dış dünyada devam eden bir komut/yazma için exactly-once veya rollback garantisi yoktur. Sonuç belirsizse yeniden çalıştırmak yerine kullanıcıya belirsizlik gösterilmelidir.
- İstemci bağlantısı kesilmesi ile kullanıcı iptali ayrıdır. Frontend’in aynı run’a yeniden bağlanması ayrı denetimde ele alınmıştır; bu rapor yeni run başlatarak belirsiz araçları tekrar çalıştırmayı önermemektedir.

## Local runner kurulumu

`/settings/workbench` içindeki yeni Local runner kartı, mevcut dosya picker erişimini koruyarak ayrı komut çalıştırma bağlantısı sunar. `api.localSandbox.getToken` yalnız **Copy connect command** tıklamasında çağrılır; var olan token döner, otomatik rotate yapılmaz. Token DOM’a/loglara yazılmaz. Clipboard erişimi ilk async çağrıdan sonra engellenirse ikinci tıklama önceden hazırlanmış komutu kopyalar; başarıda gizli geçici kopya silinir.

Komut mevcut origin’deki `/downloads/rift-cli.tgz?v=<package-version>` adresini ve `NEXT_PUBLIC_CONVEX_URL` değerini kullanır. POSIX ve Windows PowerShell literal quoting ayrı uygulanır. Runtime kayıtları yalnız authenticated `commands:true`, non-desktop bağlantılardan gelir. **Use for Build** gerçek execution target’ı değiştirir. **Disconnect** yalnız seçilen connection ID’sini sahiplik kontrolü yapan mevcut mutation ile kapatır; aktif tercihi sessizce Cloud’a çevirmez.

Bağlantı listesi backend’in connected kayıtlarını gösterir; anlık socket presence garantisi olarak sunulmaz. Worker işe başlamadan gerçek subscription presence kontrolü yapar. Kullanıcıya dosya picker grant’i ile runner’ın host shell/filesystem yetkisi arasındaki fark açıklanır. Grant metni pencere kapatma yerine uygulamadan **Quit** ile sona erdiğini belirtir; localhost açıklaması seçilen execution target’a göre değişir.

Birincil dağıtım kontrolü: [resmî RIFT tarball](https://riftsys.app/downloads/rift-cli.tgz) HEAD 200 / application/octet-stream döndü. [npm rift-cli 0.8.3 metadata](https://registry.npmjs.org/rift-cli/0.8.3), [npm rift-cli latest](https://registry.npmjs.org/rift-cli/latest) ve [npm @rift/local latest](https://registry.npmjs.org/@rift%2Flocal/latest) aynı kontrolde 404 döndü. Bu yüzden README’deki `npx @rift/local` ve `rift.co/settings` talimatları düzeltildi. Tarball’ın varlığı çalışan yeni sürümün gerçek PC’de doğrulandığı anlamına gelmez; paket yenilemesi ayrı çalışma kapsamındadır.

Kontrollü PC smoke için sonraki adım: authenticated Settings üzerinden mevcut tokenı koruyarak komut kopyalama, açık dev Convex URL ile named fixture runner, yalnız `/tmp/rift-local-resilience-smoke` içinde zararsız testler ve ardından aynı connection’ın kapatılması. Bu rapor hazırlanırken token alınmadı ve runner başlatılmadı.

## Doğrulama

İlk harness/local grubu **12 suite / 72 test** geçti. Son E2B sınırı, selection race ve Settings davranışlarıyla birleşik son koşu **17 suite / 109 test** geçti. Log: `/tmp/rift-cloud-resilience-tests.log`. Hedefli ESLint ve son değişikliklerden sonra tam `tsc --noEmit` başarılı (exit 0).

Kapsanan test dosyaları:

- `lib/agent/__tests__/linked-abort.test.ts`
- `lib/agent/__tests__/checkpoint.test.ts`
- `lib/agent/__tests__/checkpoint.resume.test.ts`
- `lib/api/__tests__/agent-run-claims.test.ts`
- `lib/api/__tests__/agent-checkpoints.test.ts`
- `lib/api/__tests__/agent-stream-runner.checkpoint.test.ts`
- `lib/api/__tests__/agent-long-cleanup-scope.test.ts`
- `lib/ai/tools/utils/__tests__/hybrid-sandbox-local.test.ts`
- `lib/ai/tools/utils/__tests__/local-sandbox-presence.test.ts`
- `lib/ai/tools/utils/__tests__/project-sandbox-namespace.test.ts`
- `lib/ai/tools/utils/__tests__/hybrid-sandbox-manager.test.ts`
- `lib/ai/tools/__tests__/agent-runtime-tool-policy.test.ts`
- `lib/workbench/__tests__/workspace-server-security.test.ts`
- `lib/local-runner/__tests__/connect-command.test.ts`
- `app/components/__tests__/LocalRunnerSettingsCard.test.tsx`
- `app/components/__tests__/RemoteControlTab.test.tsx`
- `app/components/__tests__/BuildAccessSettings.test.tsx`

Doğrulanmayanlar: paid provider outage; process-kill sonrası gerçek tool side effect’i; gerçek PC shell işi; paket kurulumu; native clipboard ve Settings’in canlı görsel kontrolü. PowerShell quoting string contract ile, POSIX quoting ise `/bin/sh` argv round-trip fixture ile doğrulandı; Windows üzerinde gerçek npx çalıştırılmadı. Bu kapsam bir rakipten daha güçlü olduğu ya da bütün kesintilerde işin kayıpsız tamamlandığı iddiasını desteklemez.

## Son dar kontrol: Local Plan bağlamı

Plan prompt’u ve `list_files` açıklaması artık sabit “current cloud workspace” yerine seçilmiş execution target’ı belirtir. Build Agent prompt’undaki koşulsuz Linux/cloud iddiası da kaldırıldı; bir local bilgisayarın yazılımı veya localhost adresi cloud ile aynı sayılmaz.

`HybridSandboxManager.getReadOnlySandboxContextForPrompt` yalnız doğrulanmış local runner’ın adını ve OS metadata’sını verir. Agent’ın “executing commands / DANGEROUS MODE” talimatı Plan’a taşınmaz. Cloud ve picker seçimlerinde bu işlev boot/connection yapmadan null döner. Local metadata için owner/capability/presence kontrolü kullanılır; komut çalıştırma veya host dosya okuma/yazma yapılmaz.

`chat-handler.ts`, Build Plan için bu dar bağlamı alır. Offline veya desteklenmeyen local runner model çağrısından önce açık hataya döner. `createUIMessageStream.execute` hatası dış refund catch’ine ulaşmadığından, yeni preflight hata yolu upfront kesintiyi iade eder ve açılmış run record’u failed olarak kapatır. `getLocalPlanPromptContext` bu temizliğin hata görünmeden önce tamamlanmasını bekler. Plan’ın araç listesi, approval gate’leri, yazma ve komut yasakları değiştirilmedi.

Focused follow-up: 8 suite / 122 test ve 24 prompt snapshot; sekiz kasıtlı Build metni snapshot’ı güncellendi, token budget sınırları büyütülmedi. İlgili log `/tmp/rift-local-plan-final.log`; lint ve TypeScript logları `/tmp/rift-local-plan-lint.log`, `/tmp/rift-local-plan-tsc.log`.

Bu takipte değişen kaynaklar: `lib/system-prompt.ts`, `lib/ai/tools/list-files.ts`, `lib/ai/tools/utils/hybrid-sandbox-manager.ts`, `lib/api/chat-handler.ts`, `lib/api/local-plan-prompt-context.ts`. Yeni/uyarlanan davranış testleri: `lib/__tests__/system-prompt.test.ts`, `lib/ai/tools/__tests__/list-files.test.ts`, `lib/ai/tools/utils/__tests__/hybrid-sandbox-local.test.ts`, `lib/api/__tests__/local-plan-prompt-context.test.ts`; ayrıca `lib/__tests__/__snapshots__/system-prompt.snapshot.test.ts.snap`.

## Rollout sınırı: uzaktaki sandbox ile uzaktaki agent worker farklıdır

**Bu çalışma ağacının UI Preview kurulumu production cloud-worker rollout’u değildir.** `package.json` içindeki `dev:ui-preview:worker`, bu Mac üzerinde `trigger dev --env-file .env.local` çalıştırır. `dev:ui-preview` Next ve bu worker’ı beraber, `--kill-others` ile başlatır. Desktop preview’nin `devUrl` değeri `http://localhost:3020`’dur. `docs/dev-environment.md` de development key ile açılan işlerin yerel `trigger dev` tarafından alındığını açıkça belirtir.

Cloud seçeneğinde dosya/komut ortamı E2B’deki uzak Linux sandbox’tır; **agent’ın model/tool döngüsü mevcut preview’de hâlâ Mac’teki development worker’dadır**. Dolayısıyla Cloud/Linux protokol veya dosya smoke testinin geçmesi, Mac uyurken/kapanırken bütün Build’in tamamlanacağını kanıtlamaz. Mac uyursa, ağı kesilirse veya `trigger dev` durursa döngü ilerleyemez; önceden başlatılmış uzak komutun sonucu belirsiz kalabilir. RIFT istemcisinden tek başına Quit etmek ise haricen açılmış Next/worker süreçlerini zorunlu olarak sonlandırmaz. Local/Mac hedefinin doğası gereği ilgili Mac’in ve runner’ın erişilebilir olması gerekir.

Production’da `/api/agent-long` yalnız işi Trigger’a gönderir; agent döngüsünü `prod` ortamına dağıtılmış worker almalıdır. `trigger.config.ts` Node 22 ve bir saat üst sınırı tanımlar; `agent-long` tam task retry’ını bir denemeyle sınırlar. Checkpoint/claim kodu ve testleri hazırdır, ancak bu değişikliklerin güncel production worker sürümüne dağıtıldığı, terfi ettirildiği ve istemci Mac çevrimdışıyken ilerlediği bu denetimde doğrulanmamıştır. Repository’deki üç workflow test, desktop bundle ve sandbox image üzerinedir; bu dosyalarda otomatik Trigger worker deploy adımı bulunmadı. Native bundle/E2B template üretimi, Trigger worker deploy’unun yerine geçmez.

### Doğrulanmış komut şekli — çalıştırılmadı

Aşağıdaki seçenekler repository’nin sabitlenmiş `trigger.dev@4.5.4` CLI kaynak dosyası `node_modules/trigger.dev/dist/esm/commands/deploy.js` üzerinden doğrulandı. Komutları yalnız doğru production proje kimliğinin (`TRIGGER_PROJECT_ID`) shell/CI ortamında tanımlı ve CLI hesabının yetkili olduğu deployment ortamında kullanın. `NODE_ENV=production` config’in `.env.local` yüklemesini, `/dev/null` varsayılan env dosyası yüklemesini, `--skip-update-check` istemsiz paket güncellemesini ve `--skip-sync-env-vars` preview keyring’inin remote ortama yazılmasını önler.

Bundle ön kontrolü; deployment oluşturmaz fakat yetkili API erişimi ve yerel build çıktısı gerekir:

```sh
NODE_ENV=production pnpm exec trigger deploy --env prod --config trigger.config.ts --env-file /dev/null --skip-update-check --skip-sync-env-vars --dry-run
```

Aynı değişiklikleri gerçek production worker olarak dağıtan komut; bu artık remote deployment/rollout işlemidir ve bu denetimde çalıştırılmamıştır:

```sh
NODE_ENV=production pnpm exec trigger deploy --env prod --config trigger.config.ts --env-file /dev/null --skip-update-check --skip-sync-env-vars
```

Production Next uygulamasının Trigger anahtarı aynı projenin **production** ortamına iş göndermeli; worker’ın Convex URL/service credential, model, E2B, storage/rate-limit ve gerekli MCP keyring ayarları aynı deployment ile eşleşmelidir. `--skip-sync-env-vars` bu ayarları hazırlamaz. Preview’deki `ws://localhost:8000` relay’i bir production worker’ın kullanabileceği uzak relay değildir; Local/Mac bağlantısı için halihazırdaki production relay erişimi ayrıca doğrulanmalıdır. Bu not yeni servis veya mimari önermez.

Rollout kabul kanıtı: production Trigger run’ında doğru ortam ve yeni deployment sürümü görünmeli; disposable, Cloud/Linux hedefli bir işte istemci Mac kapalı/çevrimdışıyken bağımsız bir istemciden aynı run’ın ilerlediği ve tamamlandığı görülmeli; tekrar bağlanınca aynı run sonucu ve kalıcı checkpoint/transcript yüklenmeli, ikinci agent run veya tekrar edilmiş tool side effect’i oluşmamalıdır. `--dry-run`, unit test veya yalnız sandbox üzerinde Linux komutu bu kabul testinin yerine geçmez. Belirsiz in-flight side effect’ler için mevcut fail-closed resume sınırı production’da da korunur.

Not: `docs/dev-environment.md` sonundaki eski opsiyonel OpenCode bölümü güncel native Build döngüsünü açıklamıyor; bu rollout için OpenCode değişkenleri kullanılmamalıdır. Bu dar incelemede o belge veya dağıtım ayarları değiştirilmedi.
