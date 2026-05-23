import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import type { AIConfig } from './AISettingsModal';
import {
    createSession,
    listSessions,
    appendMessage,
    listMessages,
    renameSession,
    type ChatSession,
    type ChatMessage,
} from '../services/chatStorage';
import { askQuestionStream, askSynthesisStream, generateSessionTitle, isRerankerEnabled, setRerankerEnabled, isQueryRewriteEnabled, setQueryRewriteEnabled, isThinkingVisible, setThinkingVisible, getLastQueryWarnings, cleanupLlmAnswer, type RagCitation, type RagScope } from '../services/ragService';
import { routeChatIntent } from '../services/routeIntent';
import { commandDeleteChatSession } from '../services/undoCommands';
import { undo as undoAction } from '../services/undoRedo';
import { exportSessionToMarkdown, downloadMarkdown } from '../services/chatExport';
import { searchImagesByText } from '../services/visualSearch';
import { getAssetById } from '../services/database';
import { notifyError, notifyInfo, notifySuccess } from '../services/notificationCenter';
import { queryAll, getChunkStatsAsync, getAssetsMissingMetadataChunkAsync } from '../services/database';
import { getAllTags } from '../services/tagService';
import { chatModel, setOllamaCors } from '../services/ollamaService';
import { useOllamaStatus } from '../hooks/useOllamaStatus';
import { useChatStream } from '../hooks/useChatStream';
import AssetPickerModal from './AssetPickerModal';
import { useTranslation } from 'react-i18next';
import { chatStyles as styles } from './chat/chatStyles';
import type { AssetChipMeta } from './chat/chatStyles';
import ChatSessionSidebar from './chat/ChatSessionSidebar';
import ChatHeader from './chat/ChatHeader';
import ChatSynthesisBar from './chat/ChatSynthesisBar';
import ChatMessageList from './chat/ChatMessageList';
import ChatInput from './chat/ChatInput';
import ChatHelpOverlay from './chat/ChatHelpOverlay';
import RagIndexModal from './RagIndexModal';
import DetailPanel from './DetailPanel';
import ModalErrorBoundary from './ModalErrorBoundary';

interface ChatPanelProps {
    isOpen: boolean;
    onClose: () => void;
    aiConfig: AIConfig;
}

export default function ChatPanel({ isOpen, onClose, aiConfig }: ChatPanelProps) {
    const { t } = useTranslation();
    // Child bileşenlerin t prop imzası legacy (key, fallback?) — TFunction'dan cast
    const tLegacy = t as unknown as (key: string, fallback?: string, opts?: Record<string, unknown>) => string;
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    // Streaming state + abort + retrieve diagnostics tek hook'ta toplanır
    const stream = useChatStream();
    const { streamingText, phaseText, retrieveDiag } = stream;
    // Görsel arama (CLIP) — streaming değil; ayrı busy bayrağı
    const [visualBusy, setVisualBusy] = useState(false);
    const busy = stream.busy || visualBusy;
    const [indexBadge, setIndexBadge] = useState<{ indexed: number; total: number; missing: number; skipped: number; contentIndexed?: number } | null>(null);
    const [autoSyncProgress, setAutoSyncProgress] = useState<{ done: number; failed: number; total: number } | null>(null);
    const autoSyncRanRef = useRef(false);
    // Silme sonrası inline undo — TopBar overlay altında kaldığı için panel içinde göster
    const [recentlyDeletedLabel, setRecentlyDeletedLabel] = useState<string | null>(null);
    const deletedLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Ollama durum kontrolü — useOllamaStatus hook'u (30sn periyodik)
    const { status: ollamaStatus, recheck: recheckOllama } = useOllamaStatus({ enabled: isOpen });
    const ollamaOk = ollamaStatus.running;
    const corsWarning = ollamaStatus.running === true && ollamaStatus.corsOk === false;
    const [corsFixing, setCorsFixing] = useState(false);

    const [scope, setScope] = useState<RagScope>({ type: 'all' });
    const [scopeOptions, setScopeOptions] = useState<{ projects: string[]; tags: string[] }>({ projects: [], tags: [] });
    const [rerankerOn, setRerankerOn] = useState<boolean>(isRerankerEnabled());
    const [queryRewriteOn, setQueryRewriteOn] = useState<boolean>(isQueryRewriteEnabled());
    const [thinkingOn, setThinkingOn] = useState<boolean>(isThinkingVisible());
    const [helpOpen, setHelpOpen] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [ragIndexModalOpen, setRagIndexModalOpen] = useState(false);
    const [assetChips, setAssetChips] = useState<AssetChipMeta[]>([]);
    const autoSyncAbortRef = useRef<AbortController | null>(null);
    const listEndRef = useRef<HTMLDivElement>(null);
    // Citation tıklamasıyla açılan detay paneli — chat'e özgü, ana store'a yazmıyoruz
    // (chat kapanınca arkada "hayalet" detay paneli kalmasın).
    const [chatDetailAssetId, setChatDetailAssetId] = useState<string | null>(null);
    const chatDetailAsset = useMemo(
        () => (chatDetailAssetId ? getAssetById(chatDetailAssetId) : null),
        [chatDetailAssetId],
    );

    // Scope seçeneklerini yükle — panel açılınca bir kez
    useEffect(() => {
        if (!isOpen) return;
        try {
            const projRows = queryAll(`SELECT DISTINCT project_name FROM assets WHERE project_name IS NOT NULL AND project_name != '' ORDER BY project_name`);
            const projects = projRows.map((r) => r[0] as string);
            const tags = getAllTags().map((t) => t.name).sort();
            setScopeOptions({ projects, tags });
        } catch { /* ignore */ }
    }, [isOpen]);

    const refreshIndexBadge = useCallback(() => {
        // V3 PRE-5f: total assets sql.js'te; meta/content chunk sayımları
        // epoch>=2'de vec.db'de → getChunkStatsAsync ile routing.
        void (async () => {
            try {
                const totalRows = queryAll(`SELECT COUNT(*) FROM assets WHERE is_deleted = 0`);
                const total = Number((totalRows?.[0] as unknown[] | undefined)?.[0] ?? 0);
                const stats = await getChunkStatsAsync();
                const missing = Math.max(0, total - stats.metaAssets);
                setIndexBadge({
                    indexed: stats.metaAssets,
                    total,
                    missing,
                    skipped: 0,
                    contentIndexed: stats.contentAssets,
                });
            } catch { /* ignore */ }
        })();
    }, []);

    useEffect(() => {
        if (!isOpen) {
            autoSyncRanRef.current = false;
            return;
        }
        refreshIndexBadge();
    }, [isOpen, refreshIndexBadge]);

    // B2 — Chat açıldığında metadata chunk'ı eksik olan TÜM asset'ler için üret.
    // `analyzeRagIndex` yalnızca RAG_INDEXABLE tipleri (PDF/DOC/...) sayar;
    // DWG/MAX dahil genel kapsamı SQL ile doğrudan çekiyoruz.
    //
    // METADATA_CHUNK_VERSION: `buildMetadataText` formatı değişince artır →
    // ilk chat açılışında tüm eski chunk'lar silinip yeniden üretilir (migration).
    //
    // PERF v2 — iki iyileştirme:
    //   1. requestIdleCallback ile gecikmeli başlat: Chat açılır açılmaz
    //      CPU yoğun döngü yerine tarayıcı idle olduğunda başlat.
    //   2. Büyük rebuild (>=500 dosya) için kullanıcıya onay sor — sessiz
    //      4 dakikalık arka plan iş yerine şeffaf karar.
    useEffect(() => {
        if (!isOpen || !indexBadge || autoSyncRanRef.current) return;
        const METADATA_CHUNK_VERSION = '3'; // v3: EK ALANLAR + FTS5 LIKE fallback testi
        const storedVersion = localStorage.getItem('archivistpro.metadata-chunk-version');
        const needsRebuild = storedVersion !== METADATA_CHUNK_VERSION;
        if (!needsRebuild && indexBadge.missing === 0) return;

        const abortCtrl = new AbortController();
        autoSyncAbortRef.current = abortCtrl;

        const runIndexing = async (missingIds: string[]) => {
            try {
                const total = missingIds.length;
                setAutoSyncProgress({ done: 0, failed: 0, total });
                const { indexAssetMetadata } = await import('../services/textChunker');
                notifyInfo(
                    needsRebuild ? 'AI Chat güncelleniyor' : 'AI Chat hazırlanıyor',
                    needsRebuild
                        ? `Metadata formatı güncellendi — ${total} dosya yeniden indekslenecek…`
                        : `${total} dosya için metadata arkaplanda üretiliyor…`,
                );
                let done = 0;
                let failed = 0;
                // saveDatabase çağrıları kaldırıldı — indexAssetMetadata her asset için targeted
                // rusqlite mirror yapıyor (mirrorRagWriteToDisk + updateAssetRagStatus mirror).
                // db.export() ana thread bloku yok, "DB kaydediliyor" turuncu banner gözükmez.
                for (let i = 0; i < missingIds.length; i++) {
                    if (abortCtrl.signal.aborted) break;
                    const aid = missingIds[i];
                    try {
                        await indexAssetMetadata(aid);
                        done++;
                    } catch (err) {
                        failed++;
                        if (failed <= 3) console.warn('[ChatPanel] indexAssetMetadata failed', aid, err);
                    }
                    // Her 3 asset'te bir UI'ı güncelle + React'a nefes aldır
                    if (i % 3 === 0 || i === missingIds.length - 1) {
                        setAutoSyncProgress({ done, failed, total });
                        await new Promise((res) => setTimeout(res, 0));
                    }
                }
                refreshIndexBadge();
                // Migration başarılı bitti → versiyon bayrağını kaydet (bir daha rebuild yok)
                if (failed === 0 || done > failed) {
                    localStorage.setItem('archivistpro.metadata-chunk-version', METADATA_CHUNK_VERSION);
                }
                if (done > 0 && !abortCtrl.signal.aborted) {
                    notifySuccess(
                        'AI Chat hazır',
                        failed > 0
                            ? `${done} dosya indekslendi, ${failed} atlandı. Artık sorgulayabilirsiniz.`
                            : `${done} dosya indekslendi. Artık sorgulayabilirsiniz.`,
                    );
                } else if (failed > 0 && !abortCtrl.signal.aborted) {
                    notifyError(
                        'AI Chat hazırlanamadı',
                        `${failed} dosyada hata oluştu. Konsolu kontrol edin (F12).`,
                    );
                }
            } catch (err) {
                console.warn('[ChatPanel] auto-sync failed:', err);
            } finally {
                setAutoSyncProgress(null);
                autoSyncAbortRef.current = null;
            }
        };

        const startLater = async () => {
            if (abortCtrl.signal.aborted) return;
            // V3 PRE-6c: epoch>=2'de text_chunks vec.db'de → "metadata chunk
            // eksik" sorgusu vec.db'ye yönlenir (getAssetsMissingMetadataChunkAsync).
            const missingIds: string[] = needsRebuild
                ? queryAll(`SELECT id FROM assets WHERE is_deleted = 0 LIMIT 10000`).map((r) => r[0] as string)
                : await getAssetsMissingMetadataChunkAsync(5000);
            if (abortCtrl.signal.aborted) return;
            if (missingIds.length === 0) {
                localStorage.setItem('archivistpro.metadata-chunk-version', METADATA_CHUNK_VERSION);
                autoSyncRanRef.current = true;
                return;
            }
            const total = missingIds.length;
            // Büyük rebuild → kullanıcıya onay sor (sessizce 4+ dakikalık CPU iş başlatma)
            if (needsRebuild && total >= 500) {
                useStore.getState().showConfirmDialog(
                    t('chat.autoSync.confirmTitle'),
                    t('chat.autoSync.confirmDetail', { count: total }),
                    () => {
                        autoSyncRanRef.current = true;
                        runIndexing(missingIds);
                    },
                    t('chat.autoSync.confirmStart'),
                    false, // isDanger = false — info tonu
                    false, // hideCancel = false — İptal göster
                );
                // Dismiss edilirse autoSyncRanRef false kalır; panel tekrar açılınca
                // yine sorulur (kullanıcı "şimdi değil" seçmiş olabilir).
                return;
            }
            // Normal akış: doğrudan başla
            autoSyncRanRef.current = true;
            runIndexing(missingIds);
        };

        // requestIdleCallback ile tarayıcı idle olduğunda başlat (3sn en geç).
        // Kullanıcı chat'e yazmaya başlamışsa browser meşgul → iş gecikir, iyi.
        const ric = (window as unknown as {
            requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        }).requestIdleCallback;
        const cic = (window as unknown as {
            cancelIdleCallback?: (handle: number) => void;
        }).cancelIdleCallback;
        let idleHandle: number | null = null;
        let startTimer: ReturnType<typeof setTimeout> | null = null;
        if (ric) {
            idleHandle = ric(startLater, { timeout: 3000 });
        } else {
            startTimer = setTimeout(startLater, 500);
        }

        return () => {
            abortCtrl.abort();
            if (idleHandle !== null && cic) cic(idleHandle);
            if (startTimer !== null) clearTimeout(startTimer);
        };
    }, [isOpen, indexBadge, refreshIndexBadge, t]);

    const refreshSessions = useCallback(() => {
        setSessions(listSessions(100));
    }, []);

    const refreshMessages = useCallback((sessionId: string | null) => {
        setMessages(sessionId ? listMessages(sessionId) : []);
    }, []);

    useEffect(() => {
        if (isOpen) refreshSessions();
    }, [isOpen, refreshSessions]);

    useEffect(() => {
        refreshMessages(activeSessionId);
    }, [activeSessionId, refreshMessages]);

    useEffect(() => {
        listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, busy]);

    const handleNewSession = useCallback(() => {
        const s = createSession('Yeni Sohbet', { type: 'all' }, chatModel(aiConfig));
        refreshSessions();
        setActiveSessionId(s.id);
    }, [aiConfig.chatModel, aiConfig.ollamaModel, refreshSessions]);

    const handleDelete = useCallback((id: string) => {
        const wasActive = activeSessionId === id;
        // Silmeden önce başlığı yakala — banner için (undo'dan sonra sesion object kayboluyor)
        const deletedTitle = sessions.find((s) => s.id === id)?.title ?? 'Sohbet';
        void commandDeleteChatSession(id, () => {
            refreshSessions();
            if (wasActive) {
                setActiveSessionId((cur) => (cur === id ? null : cur));
            }
        }).then((ok) => {
            if (!ok) return;
            setRecentlyDeletedLabel(`Silindi: ${deletedTitle}`);
            if (deletedLabelTimerRef.current) clearTimeout(deletedLabelTimerRef.current);
            // 10 sn sonra banner otomatik gizlen
            deletedLabelTimerRef.current = setTimeout(() => setRecentlyDeletedLabel(null), 10_000);
        });
    }, [activeSessionId, refreshSessions, sessions]);

    const handleUndoDelete = useCallback(async () => {
        if (deletedLabelTimerRef.current) { clearTimeout(deletedLabelTimerRef.current); deletedLabelTimerRef.current = null; }
        setRecentlyDeletedLabel(null);
        const ok = await undoAction();
        if (ok) refreshSessions();
    }, [refreshSessions]);

    // Panel kapanınca timer'ı temizle
    useEffect(() => {
        if (!isOpen && deletedLabelTimerRef.current) {
            clearTimeout(deletedLabelTimerRef.current);
            deletedLabelTimerRef.current = null;
            setRecentlyDeletedLabel(null);
        }
    }, [isOpen]);

    /**
     * /görsel komutu için: CLIP text→image arama yapar, sonucu sohbet bubble'ına işler.
     * Citation field'ını yeniden kullanır — her hit chunkId='visual:<assetId>' ile işaretlenir,
     * MessageBubble bunu görünce thumbnail grid render eder.
     */
    const runVisualSearchAsMessage = useCallback(async (visualQuery: string) => {
        let sessionId = activeSessionId;
        let isFirstExchange = false;
        if (!sessionId) {
            const s = createSession(visualQuery.slice(0, 40), { type: 'all' }, chatModel(aiConfig));
            sessionId = s.id;
            setActiveSessionId(sessionId);
            refreshSessions();
            isFirstExchange = true;
        } else {
            isFirstExchange = listMessages(sessionId).length === 0;
        }

        appendMessage(sessionId, 'user', `/görsel ${visualQuery}`);
        setInput('');
        setMessages(listMessages(sessionId));
        setVisualBusy(true);
        try {
            const { hits, effectiveQuery } = await searchImagesByText(visualQuery, aiConfig, 18, { translate: true });
            const visualCitations: RagCitation[] = hits.map((h, i) => {
                const a = getAssetById(h.assetId);
                return {
                    index: i + 1,
                    chunkId: `visual:${h.assetId}`,
                    assetId: h.assetId,
                    fileName: a?.fileName ?? h.assetId,
                    filePath: a?.filePath ?? '',
                    page: null,
                    score: h.score,
                    snippet: '', // Render zamanında asset.id'den taze thumbnail URL üretilir
                };
            });
            const headerLine = effectiveQuery && effectiveQuery !== visualQuery
                ? `[VISUAL] Aranan (EN): "${effectiveQuery}" — ${hits.length} sonuç`
                : `[VISUAL] "${visualQuery}" — ${hits.length} sonuç`;
            const body = hits.length === 0
                ? '\n\nEşleşme bulunamadı. Asset\'lerin görsel embedding\'leri (image_global) olmayabilir veya CLIP eşiği altında.'
                : '';
            appendMessage(sessionId, 'assistant', headerLine + body, visualCitations);
            setMessages(listMessages(sessionId));
            refreshSessions();

            if (isFirstExchange) {
                const sid = sessionId;
                const title = `Görsel: ${visualQuery.slice(0, 30)}`;
                renameSession(sid, title);
                refreshSessions();
            }
        } catch (err) {
            notifyError(`Görsel arama hatası: ${String((err as Error).message || err)}`);
            appendMessage(sessionId, 'assistant', `[VISUAL] Hata: ${String((err as Error).message || err)}`);
            setMessages(listMessages(sessionId));
        } finally {
            setVisualBusy(false);
        }
    }, [activeSessionId, aiConfig, refreshSessions]);

    const handleSend = useCallback(async () => {
        if (stream.isBusy()) return;
        const intent = routeChatIntent(input);
        if (!intent.query) return;

        // Slash komutu: /görsel <sorgu> veya /g <sorgu> → CLIP text→image arama
        if (intent.kind === 'visual') {
            await runVisualSearchAsMessage(intent.query);
            return;
        }

        const q = intent.query;
        let sessionId = activeSessionId;
        let isFirstExchange = false;
        if (!sessionId) {
            const s = createSession(q.slice(0, 40), { type: 'all' }, chatModel(aiConfig));
            sessionId = s.id;
            setActiveSessionId(sessionId);
            refreshSessions();
            isFirstExchange = true;
        } else {
            isFirstExchange = listMessages(sessionId).length === 0;
        }

        // GPU kontrolü — GPU yoksa kibarca uyar ve LLM çağrısı yapma
        if (ollamaStatus.gpuDetected === false) {
            appendMessage(sessionId, 'user', q);
            setInput('');
            const noGpuMsg = t('chat.noGpu', 'Bu makinede GPU algılanamadı. AI sohbet yalnızca GPU destekli makinelerde kullanılabilir. Sol paneldeki arama özelliğini kullanabilirsiniz.');
            appendMessage(sessionId, 'assistant', noGpuMsg);
            setMessages(listMessages(sessionId));
            return;
        }

        appendMessage(sessionId, 'user', q);
        setInput('');
        setMessages(listMessages(sessionId));

        const history = listMessages(sessionId)
            .slice(-6, -1)
            .map((m) => ({ role: m.role, content: m.content }));

        const { result, aborted } = await stream.runStream(
            (callbacks, signal) => scope.type === 'assets'
                ? askSynthesisStream(
                    q,
                    (scope as { values: string[] }).values,
                    aiConfig,
                    callbacks,
                    { topPerAsset: 3 },
                    history,
                    signal,
                )
                : askQuestionStream(
                    q,
                    aiConfig,
                    callbacks,
                    { topK: 8 },
                    scope,
                    history,
                    signal,
                ),
            (err) => {
                notifyError(String((err as Error).message || err));
            },
        );

        const rawAnswer = stream.finalAnswer();
        const citations: RagCitation[] = result?.citations ?? [];

        if (aborted) {
            // Kullanıcı durdurdu — varsa kısmi cevabı kaydet
            if (rawAnswer) {
                appendMessage(sessionId, 'assistant', rawAnswer + '\n\n⏹ (durduruldu)', citations);
                setMessages(listMessages(sessionId));
            }
        } else if (!result) {
            // Hata — runStream error handler notify etti; basit bir hata mesajı ekle
            appendMessage(sessionId, 'assistant', 'Hata: AI sunucusuna ulaşılamadı. Ollama çalışıyor mu?');
            setMessages(listMessages(sessionId));
        } else {
            // Normal tamamlama — cleanup + <thinking> markerı + DB yazma
            const answer = cleanupLlmAnswer(rawAnswer || 'Model boş cevap döndürdü.');
            const content = result.thinking
                ? `<thinking>${result.thinking}</thinking>\n\n${answer}`
                : answer;
            const ts = result.tokenStats;
            appendMessage(sessionId, 'assistant', content, citations, ts.tokensIn, ts.tokensOut);
            setMessages(listMessages(sessionId));
            refreshSessions();

            // İlk alışverişten sonra başlığı LLM ile otomatik üret (fire-and-forget)
            if (isFirstExchange && answer) {
                const sid = sessionId;
                generateSessionTitle(q, answer, aiConfig).then((title) => {
                    if (title) {
                        renameSession(sid, title);
                        refreshSessions();
                    }
                }).catch(() => { /* sessizce fallback başlığa düş */ });
            }
        }

        // Fallback uyarıları (reranker/queryRewrite sessiz düşüş) — başarı/hata fark etmez göster
        const warnings = getLastQueryWarnings();
        if (warnings.includes('reranker_failed')) {
            notifyInfo(t('chat.fallback.reranker'));
        }
        if (warnings.includes('query_rewrite_failed')) {
            notifyInfo(t('chat.fallback.queryRewrite'));
        }
    }, [input, stream, activeSessionId, aiConfig, refreshSessions, scope, runVisualSearchAsMessage, ollamaStatus.gpuDetected, t]);

    const handleAbort = useCallback(() => {
        stream.abort();
    }, [stream]);

    const handleExport = useCallback(() => {
        if (!activeSessionId) return;
        const md = exportSessionToMarkdown(activeSessionId);
        if (!md) {
            notifyInfo(t('chat.export.empty'));
            return;
        }
        const session = sessions.find((s) => s.id === activeSessionId);
        const title = session?.title ?? 'sohbet';
        const safeName = title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').slice(0, 60);
        const date = new Date().toISOString().slice(0, 10);
        downloadMarkdown(md, `${safeName}_${date}.md`);
    }, [activeSessionId, sessions, t]);

    const onCitationClick = useCallback((c: RagCitation) => {
        if (c.assetId) setChatDetailAssetId(c.assetId);
    }, []);

    const modelLabel = useMemo(() => chatModel(aiConfig), [aiConfig.chatModel, aiConfig.ollamaModel]);

    const handleScopeChange = useCallback((value: string) => {
        if (value === 'all') { setScope({ type: 'all' }); return; }
        const [type, ...rest] = value.split(':');
        const val = rest.join(':');
        setScope({ type: type as 'project' | 'tag' | 'folder', value: val });
    }, []);

    const handleRemoveChip = useCallback((id: string) => {
        setAssetChips((prev) => {
            const next = prev.filter((ch) => ch.id !== id);
            if (next.length === 0) {
                setScope({ type: 'all' });
            } else {
                setScope({ type: 'assets', values: next.map((x) => x.id) });
            }
            return next;
        });
    }, []);

    const handleClearAllChips = useCallback(() => {
        setAssetChips([]);
        setScope({ type: 'all' });
    }, []);

    if (!isOpen) return null;

    return (
        <div style={styles.overlay} onClick={onClose}>
            <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
                {/* Sol: oturum listesi — detay paneli açıkken gizlenir (yer kazanma) */}
                {!chatDetailAsset && (
                    <ChatSessionSidebar
                        sessions={sessions}
                        activeSessionId={activeSessionId}
                        onSelectSession={setActiveSessionId}
                        onNewSession={handleNewSession}
                        onDeleteSession={handleDelete}
                        recentlyDeletedLabel={recentlyDeletedLabel}
                        onUndoDelete={handleUndoDelete}
                        t={tLegacy}
                    />
                )}

                {/* Sağ: mesajlar + input */}
                <section style={styles.main}>
                    <ChatHeader
                        modelLabel={modelLabel}
                        ollamaOk={ollamaOk}
                        rerankerOn={rerankerOn}
                        queryRewriteOn={queryRewriteOn}
                        showThinking={thinkingOn}
                        scope={scope}
                        scopeOptions={scopeOptions}
                        indexBadge={indexBadge}
                        hasMessages={messages.length > 0}
                        onToggleReranker={() => { const v = !rerankerOn; setRerankerEnabled(v); setRerankerOn(v); }}
                        onToggleQueryRewrite={() => { const v = !queryRewriteOn; setQueryRewriteEnabled(v); setQueryRewriteOn(v); }}
                        onToggleThinking={() => { const v = !thinkingOn; setThinkingVisible(v); setThinkingOn(v); }}
                        onScopeChange={handleScopeChange}
                        onPickerOpen={() => setPickerOpen(true)}
                        onHelpOpen={() => setHelpOpen(true)}
                        onExport={handleExport}
                        onClose={onClose}
                        onPrepareIndex={() => setRagIndexModalOpen(true)}
                        t={tLegacy}
                    />

                    {corsWarning && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 16px',
                            background: 'rgba(245,158,11,0.1)',
                            borderBottom: '1px solid rgba(245,158,11,0.3)',
                            fontSize: '0.75rem', color: 'var(--color-text-secondary)',
                        }}>
                            <span style={{ flex: 1 }}>{t('chat.corsWarning')}</span>
                            <button
                                disabled={corsFixing}
                                onClick={async () => {
                                    setCorsFixing(true);
                                    try { await setOllamaCors(); recheckOllama(); } catch { /* ignore */ }
                                    finally { setCorsFixing(false); }
                                }}
                                style={{
                                    padding: '3px 10px', fontSize: '0.72rem', fontWeight: 600,
                                    background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.5)',
                                    borderRadius: 6, cursor: 'pointer', color: '#f59e0b', whiteSpace: 'nowrap',
                                }}
                            >
                                {corsFixing ? '…' : t('aiSettings.setCors')}
                            </button>
                        </div>
                    )}

                    {scope.type === 'assets' && assetChips.length > 0 && (
                        <ChatSynthesisBar
                            assetChips={assetChips}
                            onRemoveChip={handleRemoveChip}
                            onClearAll={handleClearAllChips}
                            t={tLegacy}
                        />
                    )}

                    <ChatMessageList
                        messages={messages}
                        busy={busy}
                        streamingText={streamingText}
                        phaseText={phaseText}
                        retrieveDiag={retrieveDiag}
                        ollamaOk={ollamaOk}
                        indexBadge={indexBadge}
                        autoSyncProgress={autoSyncProgress}
                        onCitationClick={onCitationClick}
                        onAbort={handleAbort}
                        listEndRef={listEndRef}
                        t={tLegacy}
                        showThinking={thinkingOn}
                    />

                    <ChatInput
                        input={input}
                        onInputChange={setInput}
                        onSend={handleSend}
                        onAbort={handleAbort}
                        busy={busy}
                        t={tLegacy}
                    />
                </section>

                {/* Sağ: citation tıklamasıyla açılan asset detay paneli — sessions sidebar gizlendiğinde yer açılır */}
                {chatDetailAsset && (
                    <ModalErrorBoundary onClose={() => setChatDetailAssetId(null)}>
                        <DetailPanel
                            asset={chatDetailAsset}
                            onClose={() => setChatDetailAssetId(null)}
                        />
                    </ModalErrorBoundary>
                )}
            </div>
            <AssetPickerModal
                isOpen={pickerOpen}
                initialSelected={scope.type === 'assets' ? (scope as { values: string[] }).values : []}
                onClose={() => setPickerOpen(false)}
                onConfirm={(ids) => {
                    // Chip meta'yı DB'den getir (picker sadece ID'leri döner)
                    const chips: AssetChipMeta[] = [];
                    for (const id of ids) {
                        const a = getAssetById(id);
                        if (a) {
                            chips.push({ id, fileName: a.fileName, fileType: a.fileType });
                        }
                    }
                    setAssetChips(chips);
                    setScope({ type: 'assets', values: ids });
                    setPickerOpen(false);
                }}
            />
            {helpOpen && <ChatHelpOverlay onClose={() => setHelpOpen(false)} t={tLegacy} />}
            <RagIndexModal
                isOpen={ragIndexModalOpen}
                onClose={() => setRagIndexModalOpen(false)}
            />
        </div>
    );
}
