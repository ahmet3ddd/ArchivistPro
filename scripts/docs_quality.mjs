#!/usr/bin/env node
// Dokuman kalite kapilari — CI'da ve yerelde ayni sekilde kosar:
//   node scripts/docs_quality.mjs
// Uc denetim: (1) surum tutarliligi (2) eski repo adi yasagi (3) goreli link/gorsel hedefleri.
// Ayni betik hem public repoda hem ozel calisma reposunda YESIL kalacak sekilde
// kapsamlanmistir: tarihsel/ic dokumanlar asagidaki istisna listeleriyle disarida.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };

const tracked = execSync("git ls-files", { encoding: "utf8" })
  .split("\n").map((s) => s.trim()).filter(Boolean);

// ── 1) Surum tutarliligi ────────────────────────────────────────────────────
console.log("[1/3] Surum tutarliligi (package.json = tauri.conf.json = Cargo.toml)");
{
  const pkg = JSON.parse(readFileSync("package.json", "utf8")).version;
  const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
  const cargo = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync("src-tauri/Cargo.toml", "utf8"))?.[1];
  if (!pkg || pkg !== conf || pkg !== cargo) {
    fail(`surumler uyumsuz: package.json=${pkg} tauri.conf=${conf} Cargo.toml=${cargo}`);
  } else {
    console.log(`  ✓ ${pkg}`);
  }
}

// ── 2) Eski repo adi yasagi ─────────────────────────────────────────────────
// Aktif dokumanlarda "Arsiv-H2" gecmez; tarihsel kayitlar ve ic calisma
// dokumanlari (yalniz ozel repoda bulunur) istisna.
console.log("[2/3] Eski repo adi yasagi (Arsiv-H2)");
{
  const exemptPrefixes = [
    "docs/archive/", "docs/status-archive/", "docs/reviews/", "docs/design/",
    "docs/PUBLIC_REPO_DENETIMI",
  ];
  const exemptFiles = new Set([
    "CHANGELOG.md", "docs/CHANGELOG.md", // tarihsel surum kayitlari
    "docs/STATUS.md", "docs/H2_PARITY.md", "docs/MIGRATION_PLAN.md",
    "docs/ONBOARDING.md", "docs/HANDOFF.md", "docs/KURULUM_OFIS.md",
    "docs/00_RATIONALE_ALTERNATIF_RAPOR.md", "docs/DENETIM_2026-07-07.md",
    "docs/LAN_ACCESS_MODEL.md", "docs/ARCHITECTURE.md",
  ]);
  const scope = tracked.filter((f) =>
    (f.endsWith(".md") && (f.startsWith("docs/") || f === "README.md" || f === "README_EN.md")) &&
    !exemptPrefixes.some((p) => f.startsWith(p)) && !exemptFiles.has(f)
  );
  let hits = 0;
  for (const f of scope) {
    if (readFileSync(f, "utf8").includes("Arsiv-H2")) { hits++; fail(`${f}: 'Arsiv-H2' referansi`); }
  }
  if (!hits) console.log(`  ✓ ${scope.length} dosyada eski repo adi yok`);

  const repoField = /^repository\s*=\s*"([^"]+)"/m.exec(readFileSync("src-tauri/Cargo.toml", "utf8"))?.[1];
  if (repoField && !repoField.includes("ahmet3ddd/ArchivistPro")) {
    fail(`Cargo.toml repository eski adrese isaret ediyor: ${repoField}`);
  }
}

// ── 3) Goreli link ve gorsel hedefleri ──────────────────────────────────────
console.log("[3/3] Goreli link/gorsel hedefleri (docs/ + README, archive haric)");
{
  const exemptPrefixes = ["docs/archive/", "docs/status-archive/"];
  // README'nin link hedefleri yalniz TAM (public) agacta bulunur; ozel calisma
  // reposunda README bir kopyadir ve hedefleri orada yoktur. Tam-agac isareti:
  // kokte CONTRIBUTING.md. Yoksa README'ler denetim disi birakilir (docs/ surer).
  const fullTree = existsSync("CONTRIBUTING.md");
  if (!fullTree) console.log("  (not: tam agac degil — README linkleri atlandi, docs/ denetleniyor)");
  const scope = tracked.filter((f) =>
    ((fullTree && (f === "README.md" || f === "README_EN.md")) ||
      (f.startsWith("docs/") && f.endsWith(".md"))) &&
    !exemptPrefixes.some((p) => f.startsWith(p))
  );
  let broken = 0, checked = 0;
  const linkRe = /!?\[[^\]]*\]\(([^()\s]+)\)/g;
  // Kod bloklari ve satir-ici kod ORNEK metindir, link degildir: bir dokuman
  // baska bir dosyanin linkini `[MIT](LICENSE)` diye ALINTILAYABILIR — o hedef
  // alintilayanin dizinine gore cozulmez ve cozulmemelidir.
  const stripCode = (s) => s.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const f of scope) {
    const text = stripCode(readFileSync(f, "utf8"));
    for (const m of text.matchAll(linkRe)) {
      const raw = m[1];
      if (/^(https?:|mailto:|#|ipc:)/.test(raw) || raw.includes("://")) continue;
      const target = raw.split("#")[0];
      if (!target) continue;
      checked++;
      if (!existsSync(join(dirname(f), decodeURIComponent(target)))) {
        broken++; fail(`${f}: kirik hedef → ${raw}`);
      }
    }
  }
  if (!broken) console.log(`  ✓ ${scope.length} dosyada ${checked} goreli hedefin tumu mevcut`);
}

if (failures) {
  console.error(`\nDokuman kalitesi: ${failures} sorun bulundu.`);
  process.exit(1);
}
console.log("\nDokuman kalitesi: temiz.");
