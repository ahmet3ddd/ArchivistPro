import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  startTask,
  updateTaskProgress,
  pauseTask,
  resumeTask,
  cancelTask,
  completeTask,
  failTask,
  getActiveTask,
  getTaskHistory,
  removeFromHistory,
  clearTaskHistory,
  isTaskRunning,
  onTaskUpdate,
  _resetForTesting,
} from '../services/taskRunner';

// Mock logger — auditLog çağrısını sessizce geç
vi.mock('../services/logger', () => ({
  auditLog: vi.fn(),
}));

beforeEach(() => {
  _resetForTesting();
});

describe('TaskRunner — Başlatma', () => {
  it('startTask bir TaskInfo döndürür', () => {
    const task = startTask('scan', 'Test tarama', 100);
    expect(task.id).toBeTruthy();
    expect(task.type).toBe('scan');
    expect(task.label).toBe('Test tarama');
    expect(task.status).toBe('running');
    expect(task.progress.total).toBe(100);
    expect(task.progress.current).toBe(0);
    expect(task.progress.percent).toBe(0);
    expect(task.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('aktif task varken yeni task başlatılamaz', () => {
    startTask('scan', 'Task 1', 50);
    expect(() => startTask('scan', 'Task 2', 30)).toThrow(/Zaten aktif/);
  });

  it('tamamlanmış task sonrası yeni task başlatılabilir', () => {
    startTask('scan', 'Task 1', 10);
    completeTask();
    const task2 = startTask('index', 'Task 2', 20);
    expect(task2.type).toBe('index');
    expect(task2.status).toBe('running');
  });

  it('getActiveTask aktif task bilgisini döndürür', () => {
    startTask('refile', 'Reorganize', 200);
    const active = getActiveTask();
    expect(active).not.toBeNull();
    expect(active!.type).toBe('refile');
  });

  it('task yokken getActiveTask null döner', () => {
    expect(getActiveTask()).toBeNull();
  });

  it('isTaskRunning doğru durumlarda true döner', () => {
    expect(isTaskRunning()).toBe(false);
    startTask('scan', 'Test', 10);
    expect(isTaskRunning()).toBe(true);
    completeTask();
    expect(isTaskRunning()).toBe(false);
  });
});

describe('TaskRunner — İlerleme', () => {
  it('updateTaskProgress yüzdeyi hesaplar', () => {
    startTask('scan', 'Test', 200);
    updateTaskProgress(50);
    const task = getActiveTask();
    expect(task!.progress.current).toBe(50);
    expect(task!.progress.percent).toBe(25);
  });

  it('updateTaskProgress currentItem günceller', () => {
    startTask('scan', 'Test', 100);
    updateTaskProgress(10, 'dosya.dwg');
    const task = getActiveTask();
    expect(task!.progress.currentItem).toBe('dosya.dwg');
  });

  it('completeTask yüzdeyi 100 yapar', () => {
    startTask('scan', 'Test', 50);
    updateTaskProgress(30);
    completeTask();
    const history = getTaskHistory();
    expect(history[0].progress.percent).toBe(100);
    expect(history[0].progress.current).toBe(50);
    expect(history[0].status).toBe('completed');
    expect(history[0].completedAt).toBeTruthy();
  });

  it('total 0 iken yüzde 0 kalır', () => {
    startTask('scan', 'Boş', 0);
    updateTaskProgress(0);
    const task = getActiveTask();
    expect(task!.progress.percent).toBe(0);
  });
});

describe('TaskRunner — Pause/Resume', () => {
  it('pauseTask durumu paused yapar', () => {
    startTask('scan', 'Test', 100);
    pauseTask();
    const task = getActiveTask();
    expect(task!.status).toBe('paused');
    expect(isTaskRunning()).toBe(true); // paused da aktif sayılır
  });

  it('resumeTask durumu running yapar', () => {
    startTask('scan', 'Test', 100);
    pauseTask();
    resumeTask();
    const task = getActiveTask();
    expect(task!.status).toBe('running');
  });

  it('running olmayan task pause edilemez', () => {
    startTask('scan', 'Test', 100);
    completeTask();
    pauseTask(); // sessizce atlanır
    // Hata fırlatmaz
  });

  it('paused olmayan task resume edilemez', () => {
    startTask('scan', 'Test', 100);
    resumeTask(); // zaten running, sessizce atlanır
    const task = getActiveTask();
    expect(task!.status).toBe('running');
  });
});

describe('TaskRunner — Cancel/Fail', () => {
  it('cancelTask durumu cancelled yapar', () => {
    startTask('scan', 'Test', 100);
    updateTaskProgress(40);
    cancelTask();
    expect(getActiveTask()).toBeNull();
    const history = getTaskHistory();
    expect(history[0].status).toBe('cancelled');
    expect(history[0].completedAt).toBeTruthy();
  });

  it('failTask hata mesajı kaydeder', () => {
    startTask('ai_vision', 'AI analiz', 50);
    failTask('Model yüklenemedi');
    const history = getTaskHistory();
    expect(history[0].status).toBe('failed');
    expect(history[0].error).toBe('Model yüklenemedi');
  });

  it('paused task cancel edilebilir', () => {
    startTask('scan', 'Test', 100);
    pauseTask();
    cancelTask();
    expect(getActiveTask()).toBeNull();
    expect(getTaskHistory()[0].status).toBe('cancelled');
  });
});

describe('TaskRunner — Geçmiş', () => {
  it('tamamlanan task geçmişe eklenir', () => {
    startTask('scan', 'Tarama 1', 10);
    completeTask();
    startTask('index', 'İndeks 1', 20);
    completeTask();
    const history = getTaskHistory();
    expect(history.length).toBe(2);
    expect(history[0].type).toBe('index'); // en yeni ilk
    expect(history[1].type).toBe('scan');
  });

  it('removeFromHistory belirli task silinir', () => {
    startTask('scan', 'Task A', 10);
    completeTask();
    const taskId = getTaskHistory()[0].id;
    startTask('scan', 'Task B', 10);
    completeTask();

    removeFromHistory(taskId);
    const history = getTaskHistory();
    expect(history.length).toBe(1);
    expect(history[0].id).not.toBe(taskId);
  });

  it('clearTaskHistory tüm geçmişi temizler', () => {
    startTask('scan', 'A', 5);
    completeTask();
    startTask('scan', 'B', 5);
    completeTask();
    clearTaskHistory();
    expect(getTaskHistory()).toEqual([]);
  });
});

describe('TaskRunner — Listener', () => {
  it('onTaskUpdate listener çağrılır', () => {
    const cb = vi.fn();
    onTaskUpdate(cb);
    startTask('scan', 'Test', 10);
    expect(cb).toHaveBeenCalled();
    expect(cb.mock.calls[0][0].status).toBe('running');
  });

  it('unsubscribe sonrası listener çağrılmaz', () => {
    const cb = vi.fn();
    const unsub = onTaskUpdate(cb);
    unsub();
    startTask('scan', 'Test', 10);
    expect(cb).not.toHaveBeenCalled();
  });

  it('updateTaskProgress listener tetikler', () => {
    const cb = vi.fn();
    onTaskUpdate(cb);
    startTask('scan', 'Test', 100);
    cb.mockClear();
    updateTaskProgress(50);
    expect(cb).toHaveBeenCalled();
    expect(cb.mock.calls[0][0].progress.current).toBe(50);
  });
});

describe('TaskRunner — Benzersiz ID', () => {
  it('her task farklı id alır', () => {
    startTask('scan', 'A', 5);
    completeTask();
    const id1 = getTaskHistory()[0].id;

    startTask('scan', 'B', 5);
    completeTask();
    const id2 = getTaskHistory()[0].id;

    expect(id1).not.toBe(id2);
  });
});
