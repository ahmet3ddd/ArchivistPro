#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gate #1 — gerçek v2.4.9 archivist.db anonimleştirici.

Bkz: docs/v3/GATE1-ANONYMIZATION.md

Gerçek üretim DB'sinin İÇERİĞİNİ (PII / müşteri-gizli) temizler ama YAPISINI
birebir korur (user_version, şema, id/FK, embedding blob'ları, satır sayıları)
— böylece v3 migrasyonu (epoch 0→1→2→3 + vec.db ayrımı) gerçek-veri sadakatiyle
test edilebilir.

İLKELER
  * Orijinale ASLA dokunmaz: --src kopyalanır, yalnız --out üzerinde çalışır.
  * Stdlib-only (sqlite3, hashlib, json) — ek paket yok.
  * Defansif: yalnız VAR OLAN tablo/kolonları temizler (şema sürüklenmesine
    dayanıklı). NULL değerler NULL kalır (NOT NULL + kod-yolu davranışı korunur).
  * audit_log hash-chain'i uygulamanın BİREBİR algoritmasıyla yeniden hesaplar
    (src/services/logger.ts:187-211 + src/utils/sha256.ts) — aksi halde
    uygulama "tamper" der ve Gate #1 yanlış sebeple FAIL ederdi.

KULLANIM
  python scripts/anonymize-db.py --src test-data/archivist_anon_src.db \
                                 --out test-data/archivist_anon.db
"""

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import sys

# Windows konsolu çoğu kez cp1254 (Türkçe) — çıktıdaki Unicode (örn. '→')
# UnicodeEncodeError verir. stdout/stderr'i UTF-8'e sabitle (3.7+).
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="backslashreplace")
    except Exception:
        pass

# ── audit_log hash-chain (uygulamayla BİREBİR) ──────────────────────────────
# logger.ts:187  JSON.stringify([timestamp, role??'', action, target??'',
#                                 detail??'', result, prevHash])
# logger.ts:211  sha256Hex(...)  → küçük-harf 64-hex (FIPS 180-4 std SHA-256)


def _coalesce(v):
    """TS `x ?? ''` — yalnız null/undefined boş string olur (boş string kalır)."""
    return "" if v is None else str(v)


def audit_row_hash(timestamp, role, action, target, detail, result, prev_hash):
    # JS JSON.stringify(dizi) → elemanlar arası ayraç ',' (boşluksuz),
    # non-ASCII ham (ensure_ascii=False), aynı kontrol-karakter kaçışları.
    payload = json.dumps(
        [
            _coalesce(timestamp),
            _coalesce(role),
            _coalesce(action),
            _coalesce(target),
            _coalesce(detail),
            _coalesce(result),
            _coalesce(prev_hash),
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ── yardımcılar ─────────────────────────────────────────────────────────────


def table_exists(cur, name):
    cur.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    )
    return cur.fetchone() is not None


def columns(cur, table):
    cur.execute(f"PRAGMA table_info({table})")
    return [r[1] for r in cur.fetchall()]


def ext_of(path_or_name):
    if not path_or_name:
        return ""
    base = str(path_or_name).replace("\\", "/").split("/")[-1]
    return base[base.rfind(".") :] if "." in base else ""


def json_placeholder(original):
    """Geçerli minimal JSON üret; orijinal dizi gibiyse [] değilse {}."""
    if original is None:
        return None
    s = str(original).lstrip()
    return "[]" if s.startswith("[") else "{}"


def scrub_table(cur, table, rules, stats):
    """rules: {col: fn(rowid, old_value) -> new_value}. Yalnız var olan kolon."""
    if not table_exists(cur, table):
        return
    cols = set(columns(cur, table))
    active = {c: f for c, f in rules.items() if c in cols}
    if not active:
        return
    has_rowid = "id" in cols
    key = "id" if has_rowid else "rowid"
    sel_cols = ", ".join(active.keys())
    cur.execute(f"SELECT {key}, {sel_cols} FROM {table}")
    rows = cur.fetchall()
    n = 0
    for row in rows:
        rid = row[0]
        sets, params = [], []
        for idx, col in enumerate(active.keys(), start=1):
            old = row[idx]
            if old is None:  # NULL korunur
                continue
            new = active[col](rid, old)
            if new != old:
                sets.append(f"{col}=?")
                params.append(new)
        if sets:
            params.append(rid)
            cur.execute(
                f"UPDATE {table} SET {', '.join(sets)} WHERE {key}=?", params
            )
            n += 1
    stats[table] = f"{n}/{len(rows)} satır temizlendi ({len(active)} kolon)"


def rehash_audit_chain(cur, stats):
    if not table_exists(cur, "audit_log"):
        return
    cols = set(columns(cur, "audit_log"))
    if not {"prev_hash", "row_hash"}.issubset(cols):
        stats["audit_log[chain]"] = (
            "ATLANDI — prev_hash/row_hash kolonu yok "
            "(eski şema; uygulama açılışta backfill eder — Yol B)"
        )
        return
    cur.execute(
        "SELECT id, timestamp, role, action, target, detail, result "
        "FROM audit_log ORDER BY id ASC"
    )
    prev = ""
    n = 0
    for (rid, ts, role, action, target, detail, result) in cur.fetchall():
        rh = audit_row_hash(ts, role, action, target, detail, result, prev)
        cur.execute(
            "UPDATE audit_log SET prev_hash=?, row_hash=? WHERE id=?",
            (prev, rh, rid),
        )
        prev = rh
        n += 1
    stats["audit_log[chain]"] = f"{n} satır yeniden hash'lendi (Yol A)"


# ── ana akış ────────────────────────────────────────────────────────────────


def build_rules():
    """Tablo → {kolon: (rowid, old)->new}. Yalnız PII/gizli içerik."""

    def fp(rid, old):  # dosya yolu — uzantı KORUNUR
        return f"C:\\arsiv\\anon\\a-{rid}{ext_of(old)}"

    def fn(rid, old):  # dosya adı — uzantı KORUNUR
        return f"f-{rid}{ext_of(old)}"

    txt = lambda rid, old: f"anon-{rid}"  # NOT NULL → boş bırakma  # noqa: E731
    jsn = lambda rid, old: json_placeholder(old)  # geçerli JSON  # noqa: E731
    lbl = lambda pfx: (lambda rid, old: f"{pfx}-{rid}")  # noqa: E731

    return {
        "assets": {
            "file_name": fn,
            "file_path": fp,
            "project_name": lbl("proje"),
            "project_phase": lbl("faz"),
            "metadata_json": jsn,
            "ai_tags_json": jsn,
            "color_palette_json": jsn,
            "raw_metadata": jsn,
            "thumbnail_url": lambda rid, old: "",
            "rag_status_reason": lbl("neden"),
        },
        "text_chunks": {"text": txt},
        "asset_summaries": {"summary": txt, "keywords_json": jsn},
        "projects": {"name": lbl("proje")},
        "tags": {"name": lbl("etiket")},
        "root_groups": {"name": lbl("grup")},
        "collections": {"name": lbl("koleksiyon"), "description": lbl("aciklama")},
        "asset_relations": {"notes": lbl("not")},
        "chat_sessions": {"title": lbl("sohbet")},
        "chat_messages": {"content": txt},
        "user_messages": {
            "subject": lbl("konu"),
            "body": txt,
            # kimlik kolonları = kullanıcı adı → PII
            "sender": lbl("kullanici"),
            "recipient": lbl("kullanici"),
            "assigned_to": lbl("kullanici"),
        },
        "users": {
            "username": lbl("kullanici"),
            "display_name": lbl("ad"),
            "avatar": lambda rid, old: "",
            # bcrypt geri-çevrilemez ama yine de sentinel; auth testi için
            # uygulama üzerinden parola sıfırla (script doğru cost bilemez).
            "password_hash": lambda rid, old: "ANONYMIZED-NO-LOGIN",
        },
        # label = klasör etiketi → çoğu kez proje/müşteri adı (PII).
        "scanned_roots": {"path": fp, "label": lbl("kok")},
        "scan_log": {"root_path": fp, "message": txt},
        "audit_log": {
            "target": lambda rid, old: f"anon-target-{rid}",
            "detail": lambda rid, old: f"anon-detail-{rid}",
        },
    }


def sensitive_app_settings(cur, stats):
    """app_settings: anahtar KALIR, hassas değer maskelenir."""
    if not table_exists(cur, "app_settings"):
        return
    cols = set(columns(cur, "app_settings"))
    if not {"key", "value"}.issubset(cols):
        return
    masked = 0
    cur.execute("SELECT key, value FROM app_settings")
    for k, v in cur.fetchall():
        if v is None:
            continue
        lk = str(k).lower()
        if any(t in lk for t in ("auth", "code", "path", "secret", "token", "url")):
            cur.execute(
                "UPDATE app_settings SET value=? WHERE key=?",
                (f"ANON:{k}", k),
            )
            masked += 1
    stats["app_settings"] = f"{masked} hassas değer maskelendi (anahtarlar korundu)"


def main():
    ap = argparse.ArgumentParser(description="Gate #1 DB anonimleştirici")
    ap.add_argument("--src", required=True, help="gerçek DB KOPYASI (dokunulmaz)")
    ap.add_argument("--out", required=True, help="üretilecek anonim DB")
    ap.add_argument("--force", action="store_true", help="--out varsa üzerine yaz")
    ap.add_argument(
        "--no-vacuum",
        action="store_true",
        help="VACUUM'u ATLA (GÜVENLİK RİSKİ: temizlenen PII serbest "
        "sayfalarda kalır, ham dosyadan kurtarılabilir — kullanma)",
    )
    args = ap.parse_args()

    src, out = os.path.abspath(args.src), os.path.abspath(args.out)
    if not os.path.isfile(src):
        sys.exit(f"HATA: --src bulunamadı: {src}")
    if src == out:
        sys.exit("HATA: --src ile --out aynı olamaz (orijinal korunmalı)")
    if os.path.exists(out) and not args.force:
        sys.exit(f"HATA: --out zaten var ({out}). --force ile üzerine yaz.")

    shutil.copy2(src, out)
    print(f"[1/5] Kopyalandı: {src}\n           -> {out}")

    con = sqlite3.connect(out)
    con.execute("PRAGMA foreign_keys=OFF;")
    # GÜVENLİK: üzerine yazılan/silinen içerik sıfırlanır (eski PII serbest
    # sayfada okunur kalmasın). Sondaki VACUUM ile birlikte zorunlu.
    con.execute("PRAGMA secure_delete=ON;")
    cur = con.cursor()

    ic = cur.execute("PRAGMA integrity_check;").fetchone()[0]
    if ic != "ok":
        sys.exit(f"HATA: kaynak kopya bütünlüğü bozuk: {ic}")
    uv_before = cur.execute("PRAGMA user_version;").fetchone()[0]
    print(f"[2/5] integrity_check=ok  user_version={uv_before}")

    stats = {}
    for table, rules in build_rules().items():
        scrub_table(cur, table, rules, stats)
    sensitive_app_settings(cur, stats)
    print("[3/5] İçerik temizlendi:")
    for t, s in sorted(stats.items()):
        print(f"        - {t}: {s}")

    rehash_audit_chain(cur, stats)
    if "audit_log[chain]" in stats:
        print(f"[4/5] audit zinciri: {stats['audit_log[chain]']}")
    else:
        print("[4/5] audit_log yok — atlandı")

    con.commit()
    if args.no_vacuum:
        print("[*]  UYARI: VACUUM atlandı — temizlenen PII serbest sayfalarda "
              "kalmış olabilir (ham dosyadan kurtarılabilir).")
    else:
        con.execute("VACUUM;")
        con.commit()
        print("[*]  VACUUM tamam — serbest sayfalar yeniden yazıldı.")
    # Doğrulama
    uv_after = cur.execute("PRAGMA user_version;").fetchone()[0]
    ic2 = cur.execute("PRAGMA integrity_check;").fetchone()[0]
    fk = cur.execute("PRAGMA foreign_key_check;").fetchall()
    con.close()

    ok = uv_after == uv_before and ic2 == "ok" and not fk
    print("[5/5] Doğrulama:")
    print(f"        - user_version: {uv_before} -> {uv_after}"
          f" {'OK' if uv_after == uv_before else 'DEĞİŞMİŞ!!'}")
    print(f"        - integrity_check: {ic2}")
    print(f"        - foreign_key_check: {'temiz' if not fk else f'{len(fk)} ihlal!!'}")
    print()
    print("UYARI: users.password_hash maskelendi → bu DB ile login YAPILAMAZ."
          " Auth testi gerekiyorsa uygulama üzerinden parola belirle.")
    print("SONRAKİ: docs/v3/GATE1-ANONYMIZATION.md §5–§6 (PII grep + migrasyon testi).")
    sys.exit(0 if ok else 2)


if __name__ == "__main__":
    main()
