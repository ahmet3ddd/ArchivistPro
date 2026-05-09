/**
 * Archivist Pro — Undo/Redo (Command Pattern)
 *
 * Her kullanıcı aksiyonu bir Command objesi olarak kaydedilir.
 * Stack limiti: 50 işlem.
 * Undo edilemez işlemler (tarama, çöp kutusu boşaltma, export) bu sisteme dahil değil.
 *
 * Kullanım:
 *   executeCommand({ type:'DELETE_ASSET', label:'file.dwg silindi',
 *     execute: () => { ... }, undo: () => { ... } })
 *   undo()
 *   redo()
 */

import { auditLog } from './logger';

/* ── Tipler ── */

export interface Command {
  /** Komut tipi (loglama için) */
  type: string;
  /** Kullanıcıya gösterilecek kısa açıklama */
  label: string;
  /** Komutun zaman damgası */
  timestamp: string;
  /** İşlemi yap */
  execute: () => void | Promise<void>;
  /** İşlemi geri al */
  undo: () => void | Promise<void>;
}

export type UndoRedoListener = (state: UndoRedoState) => void;

export interface UndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  stackSize: number;
  /** Son gerçekleşen aksiyon (toast için) */
  lastAction?: 'execute' | 'undo' | 'redo';
  /** Son aksiyonun label'ı */
  lastLabel?: string;
}

/* ── Sabitler ── */

const MAX_STACK_SIZE = 50;

/* ── Dahili durum ── */

let _past: Command[] = [];
let _future: Command[] = [];
let _listeners: UndoRedoListener[] = [];

function _getState(action?: 'execute' | 'undo' | 'redo', label?: string): UndoRedoState {
  return {
    canUndo: _past.length > 0,
    canRedo: _future.length > 0,
    undoLabel: _past.length > 0 ? _past[_past.length - 1].label : null,
    redoLabel: _future.length > 0 ? _future[_future.length - 1].label : null,
    stackSize: _past.length,
    lastAction: action,
    lastLabel: label,
  };
}

function _notify(action?: 'execute' | 'undo' | 'redo', label?: string): void {
  const state = _getState(action, label);
  _listeners.forEach((l) => l(state));
}

/* ── Public API ── */

/** Durum değişikliğinde çağrılacak listener ekler */
export function onUndoRedoChange(listener: UndoRedoListener): () => void {
  _listeners.push(listener);
  // Hemen mevcut durumu bildir
  listener(_getState());
  return () => {
    _listeners = _listeners.filter((l) => l !== listener);
  };
}

/**
 * Yeni bir komut çalıştırır ve undo stack'e ekler.
 * Yeni komut execute edildikten sonra redo stack temizlenir.
 */
export async function executeCommand(cmd: Omit<Command, 'timestamp'>): Promise<void> {
  const command: Command = {
    ...cmd,
    timestamp: new Date().toISOString(),
  };

  await command.execute();

  _past.push(command);

  // Stack limitini aş — en eskiyi sil
  if (_past.length > MAX_STACK_SIZE) {
    _past.shift();
  }

  // Yeni komut gelince redo geçmişi temizlenir
  _future = [];

  _notify('execute', command.label);
}

/** Son komutu geri alır (Ctrl+Z) */
export async function undo(): Promise<boolean> {
  if (_past.length === 0) return false;

  const cmd = _past.pop()!;
  await cmd.undo();
  _future.push(cmd);

  auditLog('UNDO', cmd.label, { type: cmd.type });
  _notify('undo', cmd.label);
  return true;
}

/** Geri alınan komutu tekrar uygular (Ctrl+Y) */
export async function redo(): Promise<boolean> {
  if (_future.length === 0) return false;

  const cmd = _future.pop()!;
  await cmd.execute();
  _past.push(cmd);

  auditLog('REDO', cmd.label, { type: cmd.type });
  _notify('redo', cmd.label);
  return true;
}

/** Mevcut durumu döndürür */
export function getUndoRedoState(): UndoRedoState {
  return _getState();
}

/** Stack'i tamamen temizler */
export function clearUndoRedoStack(): void {
  _past = [];
  _future = [];
  _notify();
}

/** Test yardımcısı */
export function _resetForTesting(): void {
  _past = [];
  _future = [];
  _listeners = [];
}
