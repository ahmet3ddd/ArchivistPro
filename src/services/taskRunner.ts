/**
 * Archivist Pro — TaskRunner
 *
 * Uzun süren işlemler için merkezi yönetici.
 * Bir seferde sadece tek task çalışır.
 * Her task: start, pause, resume, cancel destekler.
 * Elapsed time, progress, ETA otomatik hesaplanır.
 *
 * Kararlar:
 * - Tek task (eşzamanlı yok)
 * - Task geçmişi kalıcı, kullanıcı silene kadar
 * - Alt bar + bildirim merkezi gösterimi (UI tarafında)
 */

import { auditLog } from './logger';
import { notifyTaskComplete, notifyTaskFailed } from './notificationCenter';

/* ── Tipler ── */

export type TaskType =
  | 'scan'
  | 'index'
  | 'ai_vision'
  | 'ai_embedding'
  | 'refile'
  | 'archive_export'
  | 'archive_import'
  | 'zip'
  | 'metadata_update';

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface TaskProgress {
  /** İşlenen öğe sayısı */
  current: number;
  /** Toplam öğe sayısı */
  total: number;
  /** Yüzde (0-100) */
  percent: number;
  /** Şu an işlenen öğe adı */
  currentItem?: string;
}

export interface TaskInfo {
  /** Benzersiz task ID */
  id: string;
  /** Task tipi */
  type: TaskType;
  /** Kısa açıklama (örn: "Proje-2024 klasörü taranıyor") */
  label: string;
  /** Durum */
  status: TaskStatus;
  /** İlerleme bilgisi */
  progress: TaskProgress;
  /** Başlangıç zamanı (ISO) */
  startedAt: string;
  /** Bitiş zamanı (ISO, tamamlandıysa) */
  completedAt?: string;
  /** Toplam geçen süre (ms) — pause sırasında duraklar */
  elapsedMs: number;
  /** Tahmini kalan süre (ms) */
  estimatedRemainingMs: number;
  /** Hız (öğe/saniye) */
  speed: number;
  /** Hata mesajı (başarısız olduysa) */
  error?: string;
}

/* ── TaskRunner sınıfı ── */

type TaskListener = (task: TaskInfo) => void;

let _activeTask: TaskInfo | null = null;
let _taskHistory: TaskInfo[] = [];
let _listeners: TaskListener[] = [];
let _timerHandle: ReturnType<typeof setInterval> | null = null;
let _pauseStartTime: number | null = null;
let _totalPausedMs = 0;
let _idCounter = 0;

/** Task güncellendiğinde çağrılacak listener ekler */
export function onTaskUpdate(listener: TaskListener): () => void {
  _listeners.push(listener);
  return () => {
    _listeners = _listeners.filter((l) => l !== listener);
  };
}

function _notify(): void {
  if (_activeTask) {
    _listeners.forEach((l) => l({ ..._activeTask! }));
  }
}

function _generateId(): string {
  _idCounter++;
  return `task_${Date.now()}_${_idCounter}`;
}

/* ── Zamanlayıcı ── */

function _startTimer(): void {
  if (_timerHandle) return;
  _timerHandle = setInterval(() => {
    if (!_activeTask || _activeTask.status !== 'running') return;
    _updateElapsed();
    _notify();
  }, 500); // her 500ms güncelle
}

function _stopTimer(): void {
  if (_timerHandle) {
    clearInterval(_timerHandle);
    _timerHandle = null;
  }
}

function _updateElapsed(): void {
  if (!_activeTask || !_activeTask.startedAt) return;
  const now = Date.now();
  const start = new Date(_activeTask.startedAt).getTime();
  _activeTask.elapsedMs = now - start - _totalPausedMs;

  // ETA hesapla
  if (_activeTask.progress.current > 0 && _activeTask.progress.total > 0) {
    const msPerItem = _activeTask.elapsedMs / _activeTask.progress.current;
    const remaining = _activeTask.progress.total - _activeTask.progress.current;
    _activeTask.estimatedRemainingMs = Math.round(msPerItem * remaining);
    _activeTask.speed = Math.round((_activeTask.progress.current / (_activeTask.elapsedMs / 1000)) * 10) / 10;
  }
}

/* ── Public API ── */

/** Yeni bir task başlatır. Zaten aktif task varsa hata fırlatır. */
export function startTask(type: TaskType, label: string, total: number): TaskInfo {
  if (_activeTask && (_activeTask.status === 'running' || _activeTask.status === 'paused')) {
    throw new Error(`Zaten aktif bir task var: ${_activeTask.label} (${_activeTask.status})`);
  }

  _totalPausedMs = 0;
  _pauseStartTime = null;

  _activeTask = {
    id: _generateId(),
    type,
    label,
    status: 'running',
    progress: { current: 0, total, percent: 0 },
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    estimatedRemainingMs: 0,
    speed: 0,
  };

  auditLog('SCAN_START', label, { type, total });
  _startTimer();
  _notify();
  return { ..._activeTask };
}

/** Task ilerlemesini günceller */
export function updateTaskProgress(current: number, currentItem?: string): void {
  if (!_activeTask || _activeTask.status !== 'running') return;

  _activeTask.progress.current = current;
  _activeTask.progress.percent = _activeTask.progress.total > 0
    ? Math.round((current / _activeTask.progress.total) * 100)
    : 0;
  if (currentItem !== undefined) {
    _activeTask.progress.currentItem = currentItem;
  }
  _updateElapsed();
  _notify();
}

/** Task'ı duraklatır */
export function pauseTask(): void {
  if (!_activeTask || _activeTask.status !== 'running') return;
  _activeTask.status = 'paused';
  _pauseStartTime = Date.now();
  _notify();
}

/** Duraklatılmış task'ı devam ettirir */
export function resumeTask(): void {
  if (!_activeTask || _activeTask.status !== 'paused') return;
  if (_pauseStartTime) {
    _totalPausedMs += Date.now() - _pauseStartTime;
    _pauseStartTime = null;
  }
  _activeTask.status = 'running';
  _notify();
}

/** Task'ı iptal eder */
export function cancelTask(): void {
  if (!_activeTask) return;
  _activeTask.status = 'cancelled';
  _activeTask.completedAt = new Date().toISOString();
  _updateElapsed();
  auditLog('SCAN_CANCEL', _activeTask.label, { type: _activeTask.type, progress: _activeTask.progress.percent });
  _finishTask();
}

/** Task'ı başarıyla tamamlar */
export function completeTask(): void {
  if (!_activeTask) return;
  _activeTask.status = 'completed';
  _activeTask.progress.percent = 100;
  _activeTask.progress.current = _activeTask.progress.total;
  _activeTask.completedAt = new Date().toISOString();
  _activeTask.estimatedRemainingMs = 0;
  _updateElapsed();
  auditLog('SCAN_COMPLETE', _activeTask.label, {
    type: _activeTask.type,
    elapsedMs: _activeTask.elapsedMs,
    total: _activeTask.progress.total,
  });
  notifyTaskComplete(_activeTask.label, _activeTask.id, _activeTask.elapsedMs);
  _finishTask();
}

/** Task'ı hata ile bitirir */
export function failTask(error: string): void {
  if (!_activeTask) return;
  _activeTask.status = 'failed';
  _activeTask.error = error;
  _activeTask.completedAt = new Date().toISOString();
  _updateElapsed();
  notifyTaskFailed(_activeTask.label, _activeTask.id, error);
  _finishTask();
}

function _finishTask(): void {
  _stopTimer();
  if (_activeTask) {
    _taskHistory.unshift({ ..._activeTask });
    _notify();
    _activeTask = null;
  }
}

/* ── Sorgulama ── */

/** Aktif task bilgisini döndürür (yoksa null) */
export function getActiveTask(): TaskInfo | null {
  return _activeTask ? { ..._activeTask } : null;
}

/** Task geçmişini döndürür (en yeni ilk sırada) */
export function getTaskHistory(): TaskInfo[] {
  return _taskHistory.map((t) => ({ ...t }));
}

/** Belirli bir task'ı geçmişten siler */
export function removeFromHistory(taskId: string): void {
  _taskHistory = _taskHistory.filter((t) => t.id !== taskId);
}

/** Tüm task geçmişini temizler */
export function clearTaskHistory(): void {
  _taskHistory = [];
}

/** Aktif task var mı? */
export function isTaskRunning(): boolean {
  return _activeTask !== null && (_activeTask.status === 'running' || _activeTask.status === 'paused');
}

/* ── Test yardımcısı ── */

/** Dahili durumu sıfırlar (sadece testlerde kullanılmalı) */
export function _resetForTesting(): void {
  _stopTimer();
  _activeTask = null;
  _taskHistory = [];
  _listeners = [];
  _totalPausedMs = 0;
  _pauseStartTime = null;
  _idCounter = 0;
}
