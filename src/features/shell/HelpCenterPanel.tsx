import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { useSession } from "../../hooks/useSession";
import { useUiStore } from "../../store/useUiStore";

type TabId = "guide" | "scenarios" | "shortcuts" | "technical" | "changelog";
interface Section { id: string; title: string; paragraphs?: string[]; steps?: string[]; note?: string; }
interface Article { title: string; intro: string; sections: Section[]; }

const SHORTCUTS = [
  { keys: ["Ctrl", "K"], tr: "Arama kutusuna odaklan", en: "Focus the search box" },
  { keys: ["/"], tr: "Arama kutusuna odaklan", en: "Focus the search box" },
  { keys: ["Ctrl", "A"], tr: "Yüklenmiş sonuçların tümünü seç", en: "Select all loaded results" },
  { keys: ["↑", "↓", "←", "→"], tr: "Kartlar arasında ilerle", en: "Move between cards" },
  { keys: ["Enter"], tr: "Odaktaki dosyayı aç", en: "Open the focused file" },
  { keys: ["Space"], tr: "Odaktaki dosyanın seçimini değiştir", en: "Toggle the focused file" },
  { keys: ["Delete"], tr: "Seçili dosyaları çöp kutusuna taşı", en: "Move selected files to trash" },
  { keys: ["Esc"], tr: "Seçimi ve detay panelini kapat", en: "Clear selection and close the detail panel" },
  { keys: ["?"], tr: "Yardım Merkezini aç veya kapat", en: "Open or close Help Center" },
] as const;

function turkishDocuments(isAdmin: boolean): Record<TabId, Article> {
  const guide: Section[] = [
    { id: "explorer", title: "Gezgin ve dosya detayları", paragraphs: [
      "Gezgin, arşivdeki dosyaları kartlar halinde gösterir. Bir karta tıklamak sağdaki detay panelini açar; önizleme, yol, etiketler ve kullanılabilir işlemler burada görünür.",
      "Pano arşivin genel durumunu özetler. Teknik görünüm dosyaları tablo halinde karşılaştırmak için uygundur. Haritadaki bir nokta veya küme seçildiğinde, o konumdaki dosyalar Gezgin'de ayrı bir kapsam olarak açılır.",
    ]},
    { id: "search", title: "Arama", paragraphs: [
      "Üstteki arama alanı dosya adı ve indekslenmiş içerikte arar. Arama varken sonuç sayısı, Gezgin'de gördüğünüz listeyle aynı kapsamı ifade eder.",
      "Anlamlı arama açıkken sonuçlar kelimelerin birebir eşleşmesine değil, anlam yakınlığına göre bulunur. Bunun için arşivde arama indeksi bulunmalıdır.",
    ], note: "Kısa ve net bir sorguyla başlayın; ardından filtrelerle sonucu daraltın."},
    { id: "filters", title: "Filtreler, Favoriler ve kayıtlı filtreler", paragraphs: [
      "Sol paneldeki filtreler tür, etiket, tarih, AI analiz durumu ve diğer metadata alanlarıyla sonucu daraltır. Etkin koşulları üst çubuktaki çiplerden kaldırabilir veya tümünü temizleyebilirsiniz.",
      "Favoriler, yalnızca işaretlediğiniz dosyaları gösteren isteğe bağlı bir filtredir. Görünürlüğünü Filtreleri özelleştir penceresinden açabilir, kapatabilir veya sırasını değiştirebilirsiniz.",
      "Kayıtlı filtreler, geçerli arama ve filtre bileşimini adlandırıp saklar. Aynı arşive döndüğünüzde tek tıklamayla yeniden uygular; dosyaları ya da arşivi değiştirmez.",
    ]},
    { id: "ai-tools", title: "AI araçları", paragraphs: [
      "Sohbet, arşivdeki kaynaklara göre soru sormanızı sağlar. Yanıttaki kaynak kartları, cevabı doğrulamak için ilgili dosyaya götürür.",
      "Görsel Arama ve Şekil Arama, benzer görselleri veya çizim karakterlerini bulur. Kopya Bulucu ise taramayı önce salt-okunur yapar; hiçbir dosya siz onaylamadan taşınmaz.",
    ], note: "AI özelliklerinin kullanılabilirliği, yerel model ve indeks durumuna bağlıdır; Ayarlar › AI bölümünden kontrol edilir."},
  ];
  if (isAdmin) guide.push({ id: "admin-archive", title: "Tarama, bakım ve paylaşım", paragraphs: [
    "Sol seritteki Arşiv bölümü, indeksleme ve arşiv yönetiminin giriş noktasıdır. Buradan İndeksle, Kaynak Klasörler, Projeler ve Kural ile düzenle açılır. Kural ile düzenle, seçili dosyaların işlem çubuğundan veya bir klasörün sağ tık menüsünden de başlatılabilir.",
    "İndekslemede birden fazla klasör ekleyebilirsiniz. Uzun işlerde ilerleme, etkin dosyalar ve son işlenen dosyalar görünür; durdurma veya iptal etme dosyaları diskte silmez.",
    "Ayarlar'daki Tarama, Veri ve Bakım sekmeleri kaynak ayarlarını, yedekleri ve arşiv sağlığını yönetir. Yerel ağ paylaşımı ve ana arşive bağlanma ayarları Bakım sekmesindedir.",
  ], note: "Uzak arşiv görünümünde yerel yazma araçları ve yerel arama araçları bilinçli olarak kilitlenir; yanlış arşivde işlem yapılmasını önler."});
  return {
    guide: { title: isAdmin ? "Yönetici kılavuzu" : "Kullanım kılavuzu", intro: "Arşivde dosya bulma, sonuçları daraltma ve güvenli biçimde çalışma için temel akışlar.", sections: guide },
    scenarios: { title: "Kullanım senaryoları", intro: "Sık yapılan işleri baştan sona izleyebileceğiniz kısa akışlar.", sections: [
      { id: "find-file", title: "Bir dosyayı hızla bulmak", steps: ["Üst arama alanına proje adı, konu veya dosya adından bildiğiniz bir parça yazın.", "Gerekirse Tür, Etiket veya Tarih filtresini ekleyin.", "Sonuç kartına tıklayıp detay panelinden önizleme ve yolu doğrulayın."]},
      { id: "save-filter", title: "Tekrarlanan bir görünümü kaydetmek", steps: ["Arama ve filtreleri istediğiniz sonuç kümesini verecek şekilde ayarlayın.", "Sol panelde Kayıtlı filtreler bölümünü açın.", "Anlamlı bir ad verip Kaydet'i seçin; daha sonra aynı arşivde filtre adına tıklayın."]},
      { id: "review-duplicates", title: "Olası kopyaları güvenle gözden geçirmek", steps: ["Sol seritte Kopya Bulucu'yu açın ve uygun tarama modunu seçin.", "Tara'yı seçin; sonuçlar grup halinde listelenir.", "Her grubu karşılaştırın. Yalnızca emin olduğunuz dosyaları çöp kutusuna taşıyın; işlem geri alınabilir."]},
      { id: "ask-archive", title: "Arşive soru sormak", steps: ["Sohbet görünümünü açın ve kapsamı tüm arşiv, aktif filtre veya seçim olarak belirleyin.", "Sorunuzu doğal dille yazın.", "Yanıttaki kaynakları açarak sonucu dosya üzerinden doğrulayın."]},
    ]},
    shortcuts: { title: "Klavye kısayolları", intro: "Kısayollar, metin yazdığınız alanlarda yazma davranışını engellemez.", sections: [] },
    technical: { title: "Teknik referans", intro: "Arşivin çalışma biçimi ve güvenlik sınırları hakkında kısa başvuru.", sections: [
      { id: "local-first", title: "Yerel çalışma", paragraphs: ["H3 masaüstü uygulamasıdır. Arşiv işlemleri yapılandırıldığı bilgisayarda yürür; yerel ağ erişimi ayrıca yapılandırılır.", "Uzak arşiv görünümünde listeleme ve detaylar doğru kaynağa yönlendirilir. Yerel veriye yazabilecek araçlar yanlış arşive işlem yapılmasını önlemek için kapatılır."]},
      { id: "roles", title: "Roller ve güvenli işlemler", paragraphs: ["Görüntüleyiciler arşivi inceler; editör ve yöneticiler yetkileri dahilinde düzenleme yapar. Yetki, yalnızca arayüzde değil uygulama katmanında da denetlenir.", "Çöp kutusuna taşıma geri alınabilir bir işlemdir; kopya taraması ve arama işlemleri salt-okunurdur."]},
      { id: "indexing", title: "İndeks ve AI", paragraphs: ["Klasör taraması dosya envanterini oluşturur. Arama ve AI sonuçlarının kapsamı, etkin indekslerin ve modellerin durumuna göre değişebilir.", "AI kurulumu, model durumu ve yeniden indeksleme Ayarlar › AI bölümünden izlenir."]},
      { id: "status-bar", title: "Alt durum çubuğu", paragraphs: [
        "Sağlık bilgisindeki yeşil veya kırmızı nokta, yerel veritabanının bütünlük denetiminin sonucudur. Kırmızı görünürse Ayarlar › Bakım bölümündeki Veri Sağlığı kartından ayrıntıyı inceleyin.",
        "“Şema v31” gibi bir ifade, arşiv veritabanının yapı sürümünü gösterir; uygulamanın veya dosyalarınızın sürümü değildir. Gerekli yapı güncellemeleri uygulama açılırken otomatik uygulanır. Yanındaki varlık sayısı, arşivdeki etkin dosya kaydı sayısıdır.",
        "Dosya güncelliği denetimi görünüyorsa, ayrı renkli nokta dosyaların diskte eksik, değişmiş ya da erişilemez olup olmadığını özetler.",
      ]},
    ]},
    changelog: { title: "Bu sürümde", intro: "H3 arayüzündeki güncel kullanıcı odaklı iyileştirmeler.", sections: [
      { id: "archive-management", title: "Arşiv yönetimi", paragraphs: ["İndeksle, Kaynak Klasörler, Projeler ve Kural ile düzenle eylemleri üst çubuk yerine sol seritteki Arşiv panelinde toplandı. Böylece arama ve sonuç bağlamı daha sade kaldı."]},
      { id: "indexing-progress", title: "İndeksleme akışı", paragraphs: ["Bir indeksleme işine birden fazla klasör eklenebilir. İş sürerken etkin ve yakın zamanda işlenen dosyalar, ilerleme ve tahmini süre ile birlikte görünür; iptal isteğinin tamamlanması da açıkça bildirilir."]},
      { id: "asset-views", title: "Dosyaları inceleme", paragraphs: ["Yerel video dosyaları detay panelinden oynatılabilir. Haritadaki konum noktaları ve kümeler, temsil ettikleri dosyaları doğrudan Gezgin'de açar."]},
      { id: "previews", title: "Önizlemeler", paragraphs: ["WebP ve ICO dosyalarının önizlemesi artık üretiliyor. Bu biçimler daha önce sessizce önizlemesiz kalıyordu; görsel analizi önizleme üzerinden çalıştığı için AI taramasına da girmiyorlardı.", "Önizlemeler geriye dönük oluşturulmaz. Daha eski bir sürümle indekslenmiş video, webp veya ico dosyalarınız önizlemesizse: Gezgin'de o dosyaları seçin ve «Yeniden indeksle» deyin. Önizleme oluştuktan sonra AI görsel analizi de çalışır. Yeniden indeksleme etiketleri, favorileri, koleksiyonları ve mevcut AI verilerini korur; dosyalarınıza dokunmaz."]},
      { id: "filters-and-ai", title: "Filtreler ve AI", paragraphs: ["Kayıtlı filtreler filtre sisteminin parçasıdır; Favoriler isteğe bağlı bir filtre olarak açılıp kapatılabilir. AI görsel analiz durumu tümü / analiz edilmiş / analiz edilmemiş seçenekleriyle sonuç sayılarını gösterir.", "\"Analiz edilmemiş\" yalnızca hiç analize girmemiş görselleri sayar: denenip sonuç alınamayanlar ayrı bir satırda durur, görsel analize hiç giremeyen dosyalar (küçük resmi olmayan çizim/belge) ise bu sayıya girmez. Her satırın sayısı, tıklanınca gelen listeyle aynıdır.", "Seçtiğiniz dosyalar analiz edilemiyorsa koşu artık sessizce «başarılı» demez: kaç dosyanın neden atlandığı ve ne yapılabileceği bildirilir."]},
      { id: "help-center", title: "Yardım Merkezi", paragraphs: ["Yardım; kılavuz, senaryolar, kısayollar ve teknik başvuruyu tek panelde aratır. Alt durum çubuğundaki veritabanı sağlığı ve şema bilgisi de burada açıklanır."]},
    ]},
  };
}

function documentsFor(language: string, isAdmin: boolean): Record<TabId, Article> {
  // Türkçe kılavuz H3'ün birincil ve güncel yayın metnidir. Diğer arayüz dillerinde
  // aynı başvuru metni gösterilir; sekme/kontrol etiketleri i18n üzerinden çevrilir.
  void language;
  return turkishDocuments(isAdmin);
}
function matches(section: Section, query: string) {
  return [section.title, ...(section.paragraphs ?? []), ...(section.steps ?? []), section.note ?? ""].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase());
}
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^$()|[]\]/g, "\$&");
  const parts = text.split(new RegExp("(" + escaped + ")", "ig"));
  return <>{parts.map((part, index) => index % 2 ? <mark key={index} className="rounded bg-accent/25 px-0.5 text-text-primary">{part}</mark> : part)}</>;
}

export function HelpCenterPanel() {
  const { t, i18n } = useTranslation();
  const { isAdmin } = useSession();
  const open = useUiStore((state) => state.shortcutHelpOpen);
  const setOpen = useUiStore((state) => state.setShortcutHelp);
  const [tab, setTab] = useState<TabId>("guide");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const docs = useMemo(() => documentsFor(i18n.language, isAdmin), [i18n.language, isAdmin]);
  const current = docs[tab];
  const needle = query.trim();
  const visible = current.sections.filter((section) => !needle || matches(section, needle));
  const counts = useMemo(() => Object.fromEntries((Object.keys(docs) as TabId[]).map((id) => [id, needle ? docs[id].sections.filter((section) => matches(section, needle)).length : 0])) as Record<TabId, number>, [docs, needle]);

  useEffect(() => {
    if (!open) return;
    const focus = window.setTimeout(() => searchRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); } };
    document.addEventListener("keydown", onKeyDown);
    return () => { window.clearTimeout(focus); document.removeEventListener("keydown", onKeyDown); };
  }, [open, setOpen]);
  useEffect(() => {
    if (needle && counts[tab] === 0) {
      const next = (Object.keys(docs) as TabId[]).find((id) => counts[id] > 0);
      if (next) setTab(next);
    }
  }, [counts, docs, needle, tab]);
  if (!open) return null;

  const tabs: { id: TabId; label: string }[] = [
    { id: "guide", label: t(isAdmin ? "help.admin_guide" : "help.user_guide") },
    { id: "scenarios", label: t("help.scenarios") },
    { id: "shortcuts", label: t("help.shortcuts") },
    { id: "technical", label: t("help.technical") },
    { id: "changelog", label: t("help.changelog") },
  ];
  const scrollTo = (id: string) => contentRef.current?.querySelector("#help-" + id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6" onMouseDown={() => setOpen(false)}>
      <section data-shortcut-help role="dialog" aria-modal="true" aria-label={t("help.title")} onMouseDown={(event) => event.stopPropagation()} className="flex h-[min(86vh,760px)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-bg-primary shadow-2xl">
        <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-5">
          <div><h2 className="font-display text-base font-bold text-accent">{t("help.title")}</h2><p className="mt-0.5 text-xs text-text-muted">{t(isAdmin ? "help.admin_badge" : "help.user_badge")}</p></div>
          <button type="button" onClick={() => setOpen(false)} aria-label={t("common.close")} className="rounded p-2 text-text-secondary hover:bg-bg-tertiary hover:text-text-primary">×</button>
        </header>
        <div className="grid min-h-0 flex-1 md:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-border bg-bg-secondary p-3 md:border-b-0 md:border-e">
            <label><span className="sr-only">{t("help.search")}</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("help.search_placeholder")} className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent" /></label>
            <nav aria-label={t("help.sections")} className="mt-3 flex gap-1 overflow-x-auto md:flex-col">
              {tabs.map(({ id, label }) => <button key={id} type="button" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)} className={"flex shrink-0 items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition " + (tab === id ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary")}><span>{label}</span>{needle && counts[id] > 0 && <span className={"rounded-full px-1.5 text-[11px] " + (tab === id ? "bg-white/20" : "bg-accent/15 text-accent")}>{counts[id]}</span>}</button>)}
            </nav>
            {current.sections.length > 0 && <div className="mt-4 hidden min-h-0 overflow-y-auto border-t border-border pt-3 md:block"><p className="px-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{t("help.on_this_page")}</p><div className="mt-1">{visible.map((section) => <button key={section.id} type="button" onClick={() => scrollTo(section.id)} className="w-full rounded px-2.5 py-1.5 text-left text-xs text-text-secondary hover:bg-bg-tertiary hover:text-text-primary">{section.title}</button>)}</div></div>}
          </aside>
          <main ref={contentRef} className="min-h-0 overflow-y-auto px-5 py-5 sm:px-8 sm:py-7"><article className="mx-auto max-w-3xl">
            <h1 className="font-display text-2xl font-bold text-text-primary"><Highlight text={current.title} query={needle} /></h1><p className="mt-2 text-sm leading-6 text-text-secondary"><Highlight text={current.intro} query={needle} /></p>
            {tab === "shortcuts" ? <div className="mt-7 overflow-hidden rounded-lg border border-border">{SHORTCUTS.map((shortcut) => <div key={shortcut.keys.join("+")} className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"><span className="text-sm text-text-primary"><Highlight text={i18n.language.startsWith("tr") ? shortcut.tr : shortcut.en} query={needle} /></span><span className="flex shrink-0 gap-1" dir="ltr">{shortcut.keys.map((key) => <kbd key={key} className="rounded border border-border bg-bg-tertiary px-1.5 py-0.5 font-mono text-xs text-text-secondary">{key}</kbd>)}</span></div>)}</div>
            : visible.length > 0 ? <div className="mt-8 space-y-9">{visible.map((section) => <section key={section.id} id={"help-" + section.id} className="scroll-mt-4"><h2 className="border-b border-border pb-2 font-display text-lg font-bold text-text-primary"><Highlight text={section.title} query={needle} /></h2><div className="mt-3 space-y-3 text-sm leading-6 text-text-secondary">{section.paragraphs?.map((paragraph) => <p key={paragraph}><Highlight text={paragraph} query={needle} /></p>)}{section.steps && <ol className="list-decimal space-y-2 ps-5">{section.steps.map((step) => <li key={step}><Highlight text={step} query={needle} /></li>)}</ol>}{section.note && <p className="rounded-md border border-accent/25 bg-accent/10 px-3 py-2 text-text-primary"><Highlight text={section.note} query={needle} /></p>}</div></section>)}</div>
            : <p className="mt-8 rounded-md border border-border bg-bg-secondary px-4 py-3 text-sm text-text-secondary">{t("help.no_results")}</p>}
          </article></main>
        </div>
      </section>
    </div>, document.body,
  );
}
