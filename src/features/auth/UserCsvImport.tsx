import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Role } from "../../ipc/client";
import { ipc } from "../../ipc/client";

export interface CsvUser {
  username: string;
  password: string;
  role: Role;
}

function fields(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { value += ch; i += 1; } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) { out.push(value.trim()); value = ""; } else value += ch;
  }
  out.push(value.trim());
  return out;
}

/** H2 toplu-kullanici CSV: username,password,role basligi; comma or semicolon. */
export function parseUsersCsv(text: string): CsvUser[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const header = fields(lines[0], delimiter).map((value) => value.toLowerCase().replace(/\s|_/g, ""));
  const usernameAt = header.indexOf("username");
  const passwordAt = header.indexOf("password");
  const roleAt = header.indexOf("role");
  if (usernameAt < 0 || passwordAt < 0) return [];
  return lines.slice(1).flatMap((line) => {
    const row = fields(line, delimiter);
    const username = row[usernameAt]?.trim() ?? "";
    const password = row[passwordAt] ?? "";
    const candidate = (roleAt >= 0 ? row[roleAt] : "viewer")?.trim().toLowerCase();
    const role: Role = candidate === "admin" || candidate === "editor" || candidate === "viewer" ? candidate : "viewer";
    return username ? [{ username, password, role }] : [];
  });
}

export function UserCsvImport({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<CsvUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; failed: number } | null>(null);
  const [readError, setReadError] = useState(false);

  const choose = async (file: File | undefined) => {
    setResult(null);
    setReadError(false);
    if (!file) { setUsers([]); return; }
    try {
      const parsed = parseUsersCsv(await file.text());
      setUsers(parsed);
      if (parsed.length === 0) setReadError(true);
    } catch { setUsers([]); setReadError(true); }
  };

  const importUsers = async () => {
    if (busy || users.length === 0) return;
    setBusy(true);
    let created = 0;
    let failed = 0;
    for (const user of users) {
      try { await ipc.adminCreateUser(user.username, user.role, user.password); created += 1; }
      catch { failed += 1; }
    }
    setResult({ created, failed });
    setBusy(false);
    onDone();
  };

  return <div className="border-b border-border px-5 py-3">
    <div className="flex flex-wrap items-center gap-2">
      <label className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition hover:border-border-hover hover:text-text-primary">
        {t("users.import_csv")}
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void choose(event.target.files?.[0])} />
      </label>
      <span className="text-xs text-text-muted">{t("users.csv_hint")}</span>
      {users.length > 0 && <button type="button" disabled={busy} onClick={() => void importUsers()} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? t("list.loading") : t("users.csv_import", { count: users.length })}</button>}
    </div>
    {readError && <p className="mt-2 text-xs text-danger">{t("users.csv_read_error")}</p>}
    {users.length > 0 && <p className="mt-2 text-xs text-text-secondary">{t("users.csv_preview", { count: users.length })}: {users.slice(0, 5).map((user) => user.username).join(", ")}{users.length > 5 ? "..." : ""}</p>}
    {result && <p className="mt-2 text-xs text-text-secondary">{t("users.csv_result", result)}</p>}
  </div>;
}
