# RIFT `reference-ui` — Production-Hazırlık & Rakip Karşılaştırma Raporu

**Tarih:** 2026-09-10 · **Checkout:** `reference-ui` (worktree, branch `codex/reference-ui-rebuild`) · **Denetçi:** Claude (Fable 5.1)
**Yüzeyler:** Web dev (localhost:3020), production preview (localhost:3022), native **RIFT UI Preview.app** (Tauri), karşılaştırma: **ChatGPT/Codex** masaüstü, **Cursor**.

---

## 0. Verdict — Production'a hazır mı?

**Hayır, henüz değil. Ama mimari veya ürün olarak bir çıkmaz yok — kalan iş "bitirme" işidir, "yeniden tasarım" değil.**

RIFT şu an çalışan, gerçekten etkileyici, Codex/Cursor ile bilinçli olarak parity hedefleyen bir agent workbench'i. Canlı native uygulamada eşzamanlı çoklu agent aktivitesi (build + görsel üretimi + todo planı + reasoning izleri) akıcı biçimde stream oluyor ve kaliteli çıktı üretiyor. Ancak **bu worktree yarım kalmış bir yeniden-yapılanmanın (mid-rebuild) ortasında**: ~645 commit edilmemiş dosya, release build'i bugün kırık, 24+ test kırık (ajan iptal/resume ve desktop-release kontratları dahil), lint hataları render performansına dokunuyor, başlangıç gecikmesi ekibin kendi hedefinin ~2.5 katı, ve temizlenmemiş teknik borç var (emekliye ayrılmış motorun ölü kodu, yetim auth-proxy route'u, çakışan Tauri kimlikleri).

Ekibin kendi 09-09 tarihli denetim notu da bunu doğruluyor ve dürüstçe şöyle diyor: fonksiyonel testler geçiyor, Chromium akıcı, ama **"FAIL for the fluidity target"** ve **"No comparative performance win or parity claim is supported."**

---

## 1. Kapsam, yöntem ve dürüst sınırlar

**Yapılanlar (bağımsız, bugün):**
- `tsc --noEmit` (kök), `pnpm lint`, `pnpm test:ci` (5278 test), `pnpm build:ui-release-preview` bağımsız çalıştırıldı.
- İki paralel keşif ajanı ile kod mimarisi ve agent/build motoru dosya:satır düzeyinde haritalandı.
- Canlı native **RIFT UI Preview** uygulaması gözlemlendi (Build sohbeti, canlı çalışma, sağ paneller, üretilen görsel).
- **ChatGPT/Codex** ve **Cursor** masaüstü uygulamaları yan yana gözlemlendi.
- Ekibin mevcut denetim/QA dokümanları (`docs/audits/2026-09-07..09`, `docs/qa/2026-09-09-*`) ve ölçüm scriptleri okundu ve sentezlendi.

**Yapılmayanlar (bilinçli):** Kullanıcının hesabında yeni ücretli agent çalışması başlatılmadı; gerçek sohbetlerine mesaj gönderilmedi; kod düzeltilmedi (bu bir değerlendirme, düzeltme değil). Authenticated web akışı tarayıcıdan test edilmedi (kimlik bilgisi girmek yasak); asıl ürün testi zaten açık olan native uygulamadan yapıldı.

**Sınırlar:** Performans sayılarının bir kısmı ekibin kendi enstrümante ölçümlerinden alıntıdır (izole lab değil, kullanıcının Mac'i, başka uygulamalar açıkken). Rakip karşılaştırması yapı/mimari + gözlem temellidir; eşleştirilmiş sayısal native benchmark yoktur (ne bende ne ekipte). Native uygulamadaki gezinme, arka plan otomasyonunun webview'a sentetik tıklama sınırı yüzünden tam sürülemedi — bu bir araç sınırı, uygulama hatası değil.

---

## 2. Skorkart

| Boyut | Skor | Özet |
| --- | :---: | --- |
| Mimari & agent motoru | **8.5 / 10** | Sunucu-taraflı dayanıklı (durable) çalışma, resumable stream, CAS yarış koruması, onay modları, verify-then-preview build kapısı. Gerçek bir güç. |
| UI/UX kalitesi & tutarlılık | **8 / 10** | Cilalı, Codex/Cursor-parity kabuk; tutarlı marka dili. Birkaç parity kontrat testi şu an kırık (metin hiyerarşisi, yoğunluk). |
| Çalışma doğruluğu (build/test) | **4 / 10** | Typecheck temiz; ama **release build kırık**, 24 test + 12 snapshot kırık, 4 lint hatası. |
| Akıcılık (fluidity) | **6 / 10** | Chromium hedefte; native WebKit iyileşti ama artık sıçramalar + izole route/panel takılmaları var. |
| Hız (startup/latency) | **4.5 / 10** | İlk-metin gecikmesi ~10–11s medyan, hedef ≤4s (ekip "red"). Streaming render hızlı; startup yavaş. |
| Üretim olgunluğu / temizlik | **5 / 10** | ~645 uncommitted dosya, emekli motor ölü kodu, yetim proxy route, çift Tauri kimliği. |
| Güvenlik hijyeni | **6.5 / 10** | Sır yönetimi iyi (env gitignore, redaksiyon testleri). Ama yetim auth-proxy + NOPASSWD Kali kutusu + denylist guardrail. |

---

## 3. Kod sağlığı & çalışma doğruluğu (bağımsız, bugün)

| Kontrol | Sonuç | Detay |
| --- | :---: | --- |
| `tsc --noEmit` (kök) | ✅ Pass | 0 hata, ~15s. |
| `pnpm lint` | ❌ **4 hata, 4 uyarı** | Aşağıda. |
| `pnpm test:ci` | ❌ **24 fail + 12 snapshot fail** | 5253/5278 pass, 11/601 suite fail, ~98s. |
| `pnpm build:ui-release-preview` | ❌ **Fail** | Web bundle 36.3s'de derlendi; tip-kontrol kapısı `packages/console/src/opentui.ts` (untracked) `backgroundColor`/`TextOptions` hatasıyla patladı. |
| Production preview (3022) | ❌ **HTTP 500** | Önceki build'den çalışan server şu an 500 dönüyor. |
| Çalışma ağacı | ⚠️ | 349 tracked-modified + 296 untracked ≈ **645 uncommitted** dosya. |

**Lint hataları (render performansına dokunuyor):**
- `app/components/terminal/useRiftConsoleRuntime.ts:18` — effect içinde senkron `setState` → cascading render.
- `app/hack/HackSessionEntry.tsx:36` — aynı sınıf: effect içinde senkron `setState`.
- `app/components/HackerMode.tsx:2236` — render sırasında ref erişimi (bu dosya tek başına **4040 satır**).
- `app/components/__tests__/chat.integration.test.tsx:247` — bileşen dışı değişken yeniden atama (test).

**Test kırıkları rastgele değil — tam da bu raporun boyutlarında kontrat testleri:**
- **Cursor-parity:** `CodexPageShell.cursor-parity`, `cursor-text-hierarchy-contract`, `app-theme-contract` → parity drift.
- **Desktop release:** `desktop-release-contract` (prod host izolasyonu, native macOS sidebar vibrancy, imzalı loader).
- **Agent dayanıklılığı:** `agent-long-contracts`, `resume/route`, "durable cancellation" (disconnected run'ın regenerate ile iptali) → iptal/resume garantileri.
- **System-prompt bütçesi:** 12 snapshot (model isim değişimi churn'ü: gpt-5.6-sol, grok-4.3).
- Ayrıca `useSlashCommandRuntime` (model kataloğu), `ExposePreviewCard`, `resizableToolPane`, `packages/console/opentui`.

> **Not (adil olması için):** Ekibin 09-09 raporları "build + TypeScript: Pass" diyor. Yani build kırığı 09-09 sonrası, untracked/yarım bir dosyadan gelen **güncel bir regresyon** — mid-rebuild durumuyla tutarlı, kalıcı bir mimari sorun değil.

---

## 4. Mimari & agent/build mantığı

**Stack:** Next.js 16 (App Router, Turbopack) + React 19 + **Convex** (dayanıklı durum) + **Trigger.dev v4** (dayanıklı worker) + Vercel AI SDK 6 + Tailwind v4. Ayrıca **Tauri** native kabuk ve **E2B/Docker (Kali)** sandbox. 933 ts/tsx (app), 106 Convex fonksiyonu, ~205k satır.

**Çalışma yaşam döngüsü (uçtan uca güç):**
- `app/api/agent-long/route.ts` ince bir dispatcher; asıl döngü **Trigger.dev worker'ında** (60 dk'ya kadar) çalışır. Tarayıcı sadece realtime stream'e abone olan bir **izleyicidir** — kopabilir, yeniden bağlanabilir (`resume`), "leg"ler arasında devredilebilir. Bu, Codex-*cloud* / Cursor *background agents* mimarisine yakın; yerel CLI'lardan farklı ve uzun otonom çalışmalar için gerçek bir avantaj.
- **CAS claim sistemi** (`agent_run_claims`, compare-and-swap) start/cancel/replace yarışlarını kapatır. `retry.maxAttempts: 1` çift-stream re-emit'i önler. `onCancel` temizlikten önce sahiplik yeniden doğrular.
- Döngü içi mekanikler (`lib/api/agent-stream-runner.ts`): adım-başı **özetleme (summarization)**, tool-çıktı budama, **doom-loop tespiti**, **bütçe/maliyet tavanı** abort'u, Anthropic cache breakpoint'leri. Bunlar Codex/Cursor CLI'larının çoğunlukla dışarıda bıraktığı production endişeleridir.
- **Onay modları** `ask` / `auto` / `full` = *"Review first" / "Allow edits" / "Run freely"* — Codex'in suggest/auto-edit/full-auto ve Cursor'ın auto-run'ının dengi; Convex-destekli dayanıklı onay kapısı.
- **Build akışı:** `verify_app` geçmeden `expose_preview` canlı URL vermez (port HTTP-probe edilir). Sağlam.
- **Modeller:** OpenRouter tek geçit. Varsayılanlar: ask=gemini-3-flash, agent=grok-4.3 (bilinçli: "no cyber content-filter"), Build varsayılanı build-codex (GPT-5.6 Sol). Model isimleri yakın-gelecek placeholder'ları (bu bir referans build).

**Kritik durum — "OpenCode engine" zaten emekli:** Son 8 commit bir "OpenCode engine" ekledi; **ama commit edilmemiş çalışma ağacında bu zaten geri alınmış.** `lib/opencode/engine.ts` artık koşulsuz `"rift"` döndüren bir shim; `docker/Dockerfile` OpenCode binary'sini artık bake etmiyor. Geride kalan borç:
- Ölü `lib/opencode/*`, ve **yetim, auth taşıyan LLM proxy route'u** `app/api/llm/v1/chat/completions/route.ts` (hâlâ mevcut — güvenlik yüzeyi).
- Convex'te `opencode_session_id`/`opencode_sandbox_id` kolonları ve onlara bağlı ölü `project-runtime.ts` dalı.
- `SANDBOX_VERSION = v15` yorumu hâlâ "OpenCode baked in" diyor ama Dockerfile öyle demiyor (tutarsızlık).
- `apply_patch`/`search` UI render'ları yalnızca replay uyumu için tutuluyor.

---

## 5. UI/UX & akıcılık

**UI/UX (güçlü):** Native uygulama cilalı, Codex/Cursor tarzı bir workbench. Sol menü taksonomisi (New chat, Build, Studio, Hack Workbench, Projects, Recents), agent-run izi (collapsible reasoning adımları + süreler: "Reviewing test results 2m 42s"), composer (model + effort + erişim/guardrail toggle), sağ paneller (Browser/Terminal/Workspace). Landing ve login sayfaları da tutarlı marka dili taşıyor (siyah-beyaz, dithered logo, SANDBOX/EVIDENCE/COST kolonları). Studio'nun ürettiği "MIZAN" hero görseli inline ve yüksek kaliteli — creative pipeline gerçekten çalışıyor.

**Akıcılık (karışık — ekibin ölçümleri):**

| Ortam / senaryo | Sonuç | Hedef | Durum |
| --- | ---: | ---: | :---: |
| Chromium sustained frame p95 | 16.7–16.8 ms | ≤33.4 ms | ✅ |
| WebKit (native WKWebView) mixed p95 — düzeltme öncesi | 149 ms | ≤33.4 ms | ❌ |
| WebKit mixed p95 — 09-09 düzeltme sonrası | 24–30 ms | ≤33.4 ms | ✅ (ama izole 683 ms sıçramalar) |
| Prod walkthrough interaction event p95 | 56–80 ms | ≤100 ms | ✅ |
| Prod walkthrough en kötü frame | **416 ms** (28 long task) | — | ⚠️ |
| Native app hitches (Instruments, 30s) | 341.7 ms'ye varan; 9×>50ms, 4×>100ms | — | ⚠️ |
| Console/TUI renderer p95 | 0.060–0.074 ms | — | ✅ mükemmel |

Ekibin yaptığı gerçek düzeltmeler (iyi mühendislik): Build/Studio draft sızması, gizli native browser'ın alakasız mutasyonlarda geometri okuması (44→0 `getBoundingClientRect`), kapalıyken bile çalışan TerminalDock observer'ları, Markdown link-repair O(n²) taraması, ve Streamdown'un her delta'da tüm dokümanı yeniden parse etmesi (incremental block parser'a geçirildi). Bunların hepsi akıcılığı doğrudan iyileştiren gerçek düzeltmeler.

**Gözlem:** Canlı native uygulamada eşzamanlı çoklu aktivite akıcı stream oldu ve sürekli auto-scroll ile güncellendi — öznel olarak akıcı. Ama ekibin enstrümante verisi izole route/panel takılmalarının ve native hitch'lerin sürdüğünü gösteriyor.

---

## 6. Hız / startup latency

Ekibin kendi benchmark'ı (`scripts/benchmark-agent-startup.cjs`, aynı prompt, Sol, medium, 3 örnek — istatistiksel olarak güçlü değil):

| Metrik | Ölçüm | Hedef | Durum |
| --- | ---: | ---: | :---: |
| Request → ilk metin (medyan) | **10,328–11,057 ms** | ≤4,000 ms | ❌ |
| Request → ilk metin (p95) | 11,351–14,430 ms | ≤8,000 ms | ❌ |
| Worker-start → model isteği (medyan) | 2,630–3,229 ms | — | — |
| HTTP admission (medyan) | 2,819–2,990 ms | — | — |
| Gereksiz tag HTTP çağrısı | 533–619 ms → **0 ms** | — | ✅ (elendi) |
| Production FCP (tek örnek) | 308 ms (sıcak) … 4,832 ms (soğuk) | — | ⚠️ tutarsız |

**Yorum:** Streaming render hızlı (frame p95 ~16.8ms), ama **ilk-token'a kadar geçen süre yavaş** — sunucu-taraflı dayanıklı çalışmanın bedeli (worker admission + provider prefill). Bu, dayanıklılık için bilinçli bir takas; yerel CLI'lar (Codex/Cursor) genelde daha hızlı başlar çünkü cloud worker admission'ı yoktur. Ekip "quality check correctly remains red for latency" diyor. Continuity kanıtı güçlü: 120 satırlık canlı görev, gezinme boyunca korundu, tek yanıt olarak tamamlandı ($0.02, 27s).

---

## 7. Karşılaştırma: RIFT vs Codex (ChatGPT) vs Cursor

Yan yana gözlem: **ChatGPT/Codex** masaüstü (`com.openai.codex`) ile RIFT neredeyse **birebir aynı yapıda** — aynı sol menü taksonomisi, aynı agent-run izi ("Working for Xm", "Read files, ran commands", "Viewed an image"), aynı composer (model + effort + Full access/Run freely), aynı sağ önizleme/review paneli. RIFT kodunda `CodexPageShell` bileşeni ve `cursor-parity` testleri var — **parity bilinçli ve açık bir tasarım hedefi.**

| Boyut | RIFT `reference-ui` | ChatGPT/Codex masaüstü | Cursor |
| --- | --- | --- | --- |
| **Çalışma sistemi** | Sunucu-taraflı **dayanıklı** worker (Trigger.dev, 60dk), tarayıcı izleyici, resumable/reconnect | Yerel `codex` app-server süreci + cloud; MCP araç köprüsü | Editör-gömülü agent + cloud "background agents" |
| **Agent build mantığı** | verify-then-preview kapısı, ask/auto/full onay, doom-loop tespiti, döngü-içi özetleme, bütçe tavanı | Onay modları (suggest/auto/full), plan + apply_patch | Auto-run/YOLO, apply + editör diff, terminal |
| **Sandbox** | E2B **Kali** (pentest arsenali) — ürünün kendisi; NOPASSWD sudo, denylist guardrail | Yerel/host koruması odaklı | Yerel/host koruması odaklı |
| **UI/UX** | Cilalı, **Codex/Cursor kabuğunun kasıtlı yüksek-sadakat klonu** | Referans nokta | Referans nokta |
| **Akıcılık** | Chromium hedefte; native WebKit iyi ama sıçramalı | (eşleştirilmiş sayı yok) | Gözlemde AgentPanel hata veriyordu |
| **Startup hızı** | ~10–11s ilk metin (dayanıklılık takası) | Yerel süreç, genelde daha hızlı başlar | Yerel süreç, genelde daha hızlı başlar |

**Dürüst sonuç:** RIFT'in **mimari duruşu (dayanıklı, sunucu-taraflı, resumable çalışma + güvenlik-odaklı sandbox)** uzun otonom görevler ve pentest için Codex/Cursor'ın yerel-CLI modelinden daha iddialı ve bu bağlamda daha güçlü. **UI/UX** bilinçli bir parity klonu ve cilalı. Ama **ham hız ve akıcılıkta** RIFT şu an ölçülebilir bir üstünlük gösteremiyor; ekip de böyle bir iddiada bulunmuyor. Cursor bu oturumda kendi agent panelinde hata veriyordu (RIFT değil), Codex ise sağlıklı çalışıyordu.

---

## 8. Güvenlik & paketleme

**İyi:** `.env.local` gitignore'da; commit'li env yok; kaynakta sabit-kodlu sır yok (bulunan "sk-" eşleşmeleri, anahtarların prompt'tan redakte edildiğini doğrulayan **test fixture'ları**).

**Dikkat:**
- **Yetim auth-proxy route'u** `app/api/llm/v1/chat/completions/route.ts` — emekli OpenCode'dan kalma, model çağrılarını RIFT üzerinden geçiren, per-run leasing/metering yapan bir route. Kaldırılmalı veya açık kill-switch'e bağlanmalı.
- **İki Tauri projesi aynı kimliği paylaşıyor:** `src-tauri/tauri.conf.json` ve `packages/desktop/src-tauri/tauri.conf.json` ikisi de `identifier: app.riftsys.desktop`, farklı `frontendDist` — yanlış kabuğu shipping riski.
- **Kali sandbox** NOPASSWD sudo + denylist tabanlı `checkCommandGuardrails` — doğası gereği bypass edilebilir; izolasyon tamamen E2B `secure: true` per-user kutusuna dayanıyor (ürün için uygun ama bilinçli bir risk kabulü).
- Fire-and-forget yazımlar (`emitTerminal`, telemetri) hataları yutuyor — production'da UI-terminal kaybı/telemetri boşluğu görünmez olabilir.

---

## 9. Öncelikli bulgular (aksiyon)

**P0 — production'dan önce zorunlu:**
1. **Release build'i düzelt.** `packages/console/src/opentui.ts:455` `backgroundColor`/`TextOptions` tip hatası (untracked dosya) `build:ui-release-preview`'i kırıyor. Temiz bir prod bundle üretilemiyor.
2. **Kırık testleri yeşile çek** — özellikle agent iptal/resume (`agent-long-contracts`, durable cancellation) ve `desktop-release-contract`. Bunlar davranışsal garantiler; snapshot churn'ünden ayır.
3. **Çalışma ağacını commit'le/temizle.** ~645 uncommitted dosya denetlenemez ve dağıtılamaz bir durum.

**P1 — güçlü öneri:**
4. **Emekli OpenCode temizliği.** Yetim `app/api/llm/v1/chat/completions/route.ts` proxy route'unu kaldır/gate'le; `lib/opencode/*` ölü kodu, Convex `opencode_*` kolonlarını, bayat `SANDBOX_VERSION` yorumunu temizle.
5. **Çift Tauri kimliğini** tek canonical projeye indir.
6. **Lint hatalarını gider** — özellikle effect-içi senkron setState (cascading render → jank kaynağı) `useRiftConsoleRuntime.ts` ve `HackSessionEntry.tsx`.
7. **Startup latency'yi hedefe çek** (~10s → ≤4s): admission, provider prefill ve stream-delivery gecikmesini ayrı ayrı enstrümante et (ekibin planı da bu).

**P2 — olgunluk:**
8. **`GlobalState` tanrı-context'ini** (109 alan, 59 tüketici) endişeye göre böl — en büyük yapısal re-render riski.
9. **WebKit izole frame sıçramaları** (683ms) ve route/panel takılmaları (416ms) için atıf + düzeltme.
10. **Landing sprawl** (9 varyant ~30k satır) ve kopya `settings` ağacını (`app/(chat)` vs `app/workspace`) buda.
11. Dev bileşenleri (`HackerMode.tsx` 4040, `chat.tsx` 2338) böl — inceleme/test/bundle maliyeti.

---

## 10. Kanıt kaynakları

- Bağımsız çalıştırmalar (bugün): typecheck, lint, `test:ci` (5278 test), `build:ui-release-preview`, curl probe'ları (3020/3022).
- Kod haritası: `app/layout.tsx`, `app/(chat)/*`, `app/contexts/GlobalState.tsx`, `lib/api/agent-stream-runner.ts`, `trigger/agent-long.ts`, `app/api/agent-long/*`, `lib/ai/tools/*`, `docker/Dockerfile`, `src-tauri/*`, `packages/*`.
- Ekip dokümanları: `docs/audits/2026-09-08/performance-quality-baseline.md`, `docs/qa/2026-09-09-full-performance/report.md`, `docs/qa/2026-09-09-performance-followup/report.md`, `docs/audits/2026-09-08/app-fluidity-review.md`.
- Canlı gözlem: RIFT UI Preview.app, ChatGPT/Codex, Cursor.

*Bu rapor değerlendirmedir; hiçbir kod değiştirilmedi ve kullanıcının hesabında yeni ücretli çalışma başlatılmadı.*
