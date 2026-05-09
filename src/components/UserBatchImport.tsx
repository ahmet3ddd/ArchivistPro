/**
 * Archivist Pro — Toplu Kullanıcı İçe Aktarma
 *
 * CSV dosyasından kullanıcıları toplu olarak ekler.
 * Format: username,password,role,displayName
 * (role: admin veya viewer, displayName opsiyonel)
 */

import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, FileText, CheckCircle, AlertTriangle, X } from 'lucide-react';
import { createUser } from '../services/userService';
import { useStore } from '../store/useStore';

interface UserRow {
  username: string;
  password: string;
  role: 'admin' | 'viewer';
  displayName?: string;
}

interface ImportResult {
  username: string;
  success: boolean;
  error?: string;
}

interface UserBatchImportProps {
  onDone: () => void;
  onClose: () => void;
}

function parseCsv(text: string): UserRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const rows: UserRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Başlık satırını atla
    if (i === 0 && (line.toLowerCase().startsWith('username') || line.toLowerCase().startsWith('kullanıcı'))) continue;

    const parts = line.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
    if (parts.length < 2) continue;

    const username = parts[0];
    const password = parts[1];
    const role = (parts[2]?.toLowerCase() === 'admin' ? 'admin' : 'viewer') as 'admin' | 'viewer';
    const displayName = parts[3] || undefined;

    if (username && password) {
      rows.push({ username, password, role, displayName });
    }
  }

  return rows;
}

export default function UserBatchImport({ onDone, onClose }: UserBatchImportProps) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<UserRow[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCsv(text);
      setRows(parsed);
      setResults([]);
      setDone(false);
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleImport = async () => {
    if (rows.length === 0) return;
    setImporting(true);
    const importResults: ImportResult[] = [];

    for (const row of rows) {
      try {
        const user = await createUser({
          username: row.username,
          password: row.password,
          role: row.role,
          displayName: row.displayName,
          isDeveloper: false,
        });
        if (user) {
          importResults.push({ username: row.username, success: true });
        } else {
          importResults.push({ username: row.username, success: false, error: t('userBatch.errorExists') });
        }
      } catch (err) {
        importResults.push({ username: row.username, success: false, error: String(err) });
      }
    }

    setResults(importResults);
    setDone(true);
    setImporting(false);

    const successCount = importResults.filter(r => r.success).length;
    useStore.getState().addToast(
      t('userBatch.importDone', { success: successCount, total: importResults.length }),
      successCount > 0 ? 'success' : 'warning',
    );
    onDone();
  };

  return (
    <div style={{ padding: 16 }}>
      {/* Başlık */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Upload size={16} style={{ color: 'var(--color-accent)' }} />
          <span style={{ fontSize: '0.86rem', fontWeight: 600 }}>{t('userBatch.title')}</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}>
          <X size={16} />
        </button>
      </div>

      {/* Format bilgisi */}
      <div style={{
        fontSize: '0.72rem', color: 'var(--color-text-muted)',
        padding: '8px 12px', background: 'var(--color-bg-tertiary)',
        borderRadius: 6, marginBottom: 12, lineHeight: 1.6,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>CSV Format:</div>
        <code style={{ fontSize: '0.7rem' }}>username,password,role,displayName</code>
        <div style={{ marginTop: 4 }}>role: admin | viewer (varsayılan: viewer)</div>
      </div>

      {/* Dosya seçici */}
      <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFileSelect} style={{ display: 'none' }} />
      <button
        onClick={() => fileRef.current?.click()}
        className="btn btn-ghost"
        style={{ width: '100%', padding: '10px 0', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
      >
        <FileText size={14} />
        {t('userBatch.selectFile')}
      </button>

      {/* Önizleme tablosu */}
      {rows.length > 0 && !done && (
        <>
          <div style={{ fontSize: '0.74rem', fontWeight: 500, marginBottom: 6 }}>
            {t('userBatch.preview', { count: rows.length })}
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 6, marginBottom: 12 }}>
            <table style={{ width: '100%', fontSize: '0.72rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-tertiary)' }}>
                  <th style={{ padding: '4px 8px', textAlign: 'left' }}>{t('userMgmt.username')}</th>
                  <th style={{ padding: '4px 8px', textAlign: 'left' }}>{t('userMgmt.role')}</th>
                  <th style={{ padding: '4px 8px', textAlign: 'left' }}>{t('userMgmt.displayName')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '4px 8px' }}>{row.username}</td>
                    <td style={{ padding: '4px 8px' }}>{row.role}</td>
                    <td style={{ padding: '4px 8px', opacity: 0.6 }}>{row.displayName || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={handleImport}
            disabled={importing}
            className="btn btn-primary"
            style={{ width: '100%', padding: '8px 0' }}
          >
            {importing ? '...' : t('userBatch.import', { count: rows.length })}
          </button>
        </>
      )}

      {/* Sonuçlar */}
      {done && results.length > 0 && (
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {results.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', fontSize: '0.74rem' }}>
              {r.success ? (
                <CheckCircle size={13} style={{ color: 'var(--color-success)' }} />
              ) : (
                <AlertTriangle size={13} style={{ color: 'var(--color-danger)' }} />
              )}
              <span>{r.username}</span>
              {r.error && <span style={{ color: 'var(--color-text-muted)', fontSize: '0.68rem' }}>({r.error})</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
