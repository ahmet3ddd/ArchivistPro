import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  executeCommand,
  undo,
  redo,
  getUndoRedoState,
  clearUndoRedoStack,
  onUndoRedoChange,
  _resetForTesting,
} from '../services/undoRedo';

vi.mock('../services/logger', () => ({
  auditLog: vi.fn(),
  debugLog: vi.fn(),
}));

beforeEach(() => {
  _resetForTesting();
});

describe('UndoRedo — Temel İşlemler', () => {
  it('başlangıçta undo/redo yapılamaz', () => {
    const state = getUndoRedoState();
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);
    expect(state.undoLabel).toBeNull();
    expect(state.redoLabel).toBeNull();
    expect(state.stackSize).toBe(0);
  });

  it('executeCommand sonrası undo yapılabilir', async () => {
    await executeCommand({
      type: 'TEST',
      label: 'Test komutu',
      execute: () => {},
      undo: () => {},
    });
    const state = getUndoRedoState();
    expect(state.canUndo).toBe(true);
    expect(state.undoLabel).toBe('Test komutu');
    expect(state.stackSize).toBe(1);
  });

  it('execute fonksiyonu çağrılır', async () => {
    const executeFn = vi.fn();
    await executeCommand({
      type: 'TEST',
      label: 'Test',
      execute: executeFn,
      undo: () => {},
    });
    expect(executeFn).toHaveBeenCalledOnce();
  });
});

describe('UndoRedo — Undo', () => {
  it('undo, undo fonksiyonunu çağırır', async () => {
    const undoFn = vi.fn();
    await executeCommand({ type: 'TEST', label: 'A', execute: () => {}, undo: undoFn });
    await undo();
    expect(undoFn).toHaveBeenCalledOnce();
  });

  it('undo sonrası redo yapılabilir', async () => {
    await executeCommand({ type: 'TEST', label: 'A', execute: () => {}, undo: () => {} });
    await undo();
    const state = getUndoRedoState();
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(true);
    expect(state.redoLabel).toBe('A');
  });

  it('boş stack ile undo false döner', async () => {
    const result = await undo();
    expect(result).toBe(false);
  });

  it('birden fazla undo sırasıyla geri alır', async () => {
    const order: string[] = [];
    await executeCommand({ type: 'T', label: 'Cmd1', execute: () => {}, undo: () => order.push('undo1') });
    await executeCommand({ type: 'T', label: 'Cmd2', execute: () => {}, undo: () => order.push('undo2') });
    await executeCommand({ type: 'T', label: 'Cmd3', execute: () => {}, undo: () => order.push('undo3') });

    await undo();
    await undo();
    await undo();

    expect(order).toEqual(['undo3', 'undo2', 'undo1']);
  });
});

describe('UndoRedo — Redo', () => {
  it('redo, execute fonksiyonunu tekrar çağırır', async () => {
    const executeFn = vi.fn();
    await executeCommand({ type: 'T', label: 'A', execute: executeFn, undo: () => {} });
    executeFn.mockClear();
    await undo();
    await redo();
    expect(executeFn).toHaveBeenCalledOnce();
  });

  it('boş redo stack ile redo false döner', async () => {
    const result = await redo();
    expect(result).toBe(false);
  });

  it('yeni komut redo geçmişini temizler', async () => {
    await executeCommand({ type: 'T', label: 'A', execute: () => {}, undo: () => {} });
    await undo();
    expect(getUndoRedoState().canRedo).toBe(true);

    await executeCommand({ type: 'T', label: 'B', execute: () => {}, undo: () => {} });
    expect(getUndoRedoState().canRedo).toBe(false);
  });
});

describe('UndoRedo — Stack Limiti', () => {
  it('50 komuttan fazlası stack taşar, en eski silinir', async () => {
    for (let i = 0; i < 55; i++) {
      await executeCommand({ type: 'T', label: `Cmd ${i}`, execute: () => {}, undo: () => {} });
    }
    const state = getUndoRedoState();
    expect(state.stackSize).toBe(50);
  });

  it('taşma sonrası en son eklenen undo edilebilir', async () => {
    for (let i = 0; i < 55; i++) {
      await executeCommand({ type: 'T', label: `Cmd ${i}`, execute: () => {}, undo: () => {} });
    }
    expect(getUndoRedoState().undoLabel).toBe('Cmd 54');
  });
});

describe('UndoRedo — Clear', () => {
  it('clearUndoRedoStack her şeyi temizler', async () => {
    await executeCommand({ type: 'T', label: 'A', execute: () => {}, undo: () => {} });
    await executeCommand({ type: 'T', label: 'B', execute: () => {}, undo: () => {} });
    await undo();
    clearUndoRedoStack();
    const state = getUndoRedoState();
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);
    expect(state.stackSize).toBe(0);
  });
});

describe('UndoRedo — Listener', () => {
  it('listener durum değişikliğinde çağrılır', async () => {
    const cb = vi.fn();
    onUndoRedoChange(cb);
    // İlk kayıt sırasında hemen çağrılır
    expect(cb).toHaveBeenCalledOnce();
    cb.mockClear();

    await executeCommand({ type: 'T', label: 'A', execute: () => {}, undo: () => {} });
    expect(cb).toHaveBeenCalled();
    expect(cb.mock.calls[0][0].canUndo).toBe(true);
  });

  it('unsubscribe sonrası listener çağrılmaz', async () => {
    const cb = vi.fn();
    const unsub = onUndoRedoChange(cb);
    cb.mockClear();
    unsub();
    await executeCommand({ type: 'T', label: 'A', execute: () => {}, undo: () => {} });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('UndoRedo — Async Komutlar', () => {
  it('async execute desteklenir', async () => {
    let value = 0;
    await executeCommand({
      type: 'T',
      label: 'Async',
      execute: async () => { value = 42; },
      undo: async () => { value = 0; },
    });
    expect(value).toBe(42);
    await undo();
    expect(value).toBe(0);
  });
});
