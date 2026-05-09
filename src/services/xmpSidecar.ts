/**
 * XMP Sidecar Export
 *
 * Asset metadata'sını Adobe XMP (Extensible Metadata Platform) standardında
 * `.xmp` sidecar dosyasına yazar. Bu dosya orijinal dosyanın yanına bırakılır
 * ve Adobe Bridge, Lightroom, diğer DAM araçları tarafından okunabilir.
 *
 * Kullanılan namespace'ler:
 *  - Dublin Core (dc:) — başlık, açıklama, konu, creator
 *  - XMP Basic (xmp:) — oluşturma/değiştirme tarihi, araç
 *  - IPTC (Iptc4xmpCore:) — sahne, konu kodu
 *  - Photoshop (photoshop:) — kategori
 *  - ArchivistPro (archpro:) — uygulama özel alanlar
 *
 * Yazma Rust tauri komutu üzerinden yapılır (fs:allow-write yok).
 */

import { invoke } from '@tauri-apps/api/core';
import type { Asset } from '../types';

/** Tek bir asset için XMP XML üretir */
export function generateXmpXml(asset: Asset): string {
    const esc = (s: string) => s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const lines: string[] = [];
    lines.push('<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>');
    lines.push('<x:xmpmeta xmlns:x="adobe:ns:meta/">');
    lines.push(' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">');
    lines.push('  <rdf:Description');
    lines.push('   xmlns:dc="http://purl.org/dc/elements/1.1/"');
    lines.push('   xmlns:xmp="http://ns.adobe.com/xap/1.0/"');
    lines.push('   xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"');
    lines.push('   xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"');
    lines.push('   xmlns:archpro="http://archivist.pro/ns/1.0/"');
    lines.push(`   xmp:CreatorTool="ArchivistPro"`);
    if (asset.createdAt) lines.push(`   xmp:CreateDate="${esc(asset.createdAt)}"`);
    if (asset.modifiedAt) lines.push(`   xmp:ModifyDate="${esc(asset.modifiedAt)}"`);
    lines.push(`   photoshop:Category="${esc(asset.category)}"`);
    if (asset.projectName) lines.push(`   archpro:ProjectName="${esc(asset.projectName)}"`);
    if (asset.projectPhase) lines.push(`   archpro:ProjectPhase="${esc(asset.projectPhase)}"`);
    if (asset.materialGroup) lines.push(`   archpro:MaterialGroup="${esc(asset.materialGroup)}"`);
    if (asset.colorTheme) lines.push(`   archpro:ColorTheme="${esc(asset.colorTheme)}"`);
    if (asset.architecturalStyle) lines.push(`   archpro:ArchitecturalStyle="${esc(asset.architecturalStyle)}"`);
    if (asset.approvalStatus) lines.push(`   archpro:ApprovalStatus="${esc(asset.approvalStatus)}"`);
    if (asset.rejectionReason) lines.push(`   archpro:RejectionReason="${esc(asset.rejectionReason)}"`);
    if (asset.versionLabel) lines.push(`   archpro:VersionLabel="${esc(asset.versionLabel)}"`);
    if (asset.clientName) lines.push(`   archpro:ClientName="${esc(asset.clientName)}"`);
    if (asset.deadline) lines.push(`   archpro:Deadline="${esc(asset.deadline)}"`);
    if (asset.omniclassCode) lines.push(`   archpro:OmniclassCode="${esc(asset.omniclassCode)}"`);
    lines.push('  >');

    // dc:title
    lines.push('   <dc:title>');
    lines.push('    <rdf:Alt>');
    lines.push(`     <rdf:li xml:lang="x-default">${esc(asset.fileName)}</rdf:li>`);
    lines.push('    </rdf:Alt>');
    lines.push('   </dc:title>');

    // dc:subject — user tags + AI tags
    const subjects: string[] = [];
    if (asset.userTags) {
        for (const tag of asset.userTags) subjects.push(tag.name);
    }
    for (const tag of asset.aiTags) subjects.push(tag.label);
    if (subjects.length > 0) {
        lines.push('   <dc:subject>');
        lines.push('    <rdf:Bag>');
        for (const s of subjects) lines.push(`     <rdf:li>${esc(s)}</rdf:li>`);
        lines.push('    </rdf:Bag>');
        lines.push('   </dc:subject>');
    }

    // dc:format
    lines.push(`   <dc:format>${esc(asset.fileType)}</dc:format>`);

    lines.push('  </rdf:Description>');
    lines.push(' </rdf:RDF>');
    lines.push('</x:xmpmeta>');
    lines.push('<?xpacket end="w"?>');
    lines.push('');

    return lines.join('\n');
}

/** XMP sidecar yolu: orijinal dosya yolunun yanına .xmp ekler */
export function xmpPath(filePath: string): string {
    return filePath + '.xmp';
}

/** Tek asset için XMP sidecar dosyasını diske yazar.
 *  Önce dosyanın yanına yazar; yazılamazsa APP_DATA/xmp-sidecar/ altına fallback.
 *  Gerçek yazılan yolu döndürür. */
export async function writeXmpSidecar(asset: Asset): Promise<string> {
    const xml = generateXmpXml(asset);
    const outPath = xmpPath(asset.filePath);
    const actualPath = await invoke<string>('write_xmp_sidecar', { path: outPath, content: xml });
    return actualPath;
}

/** Birden fazla asset için toplu XMP export */
export async function writeXmpBatch(
    assets: Asset[],
    onProgress?: (done: number, total: number, current: string) => void,
): Promise<{ written: number; fallback: number; errors: Array<{ fileName: string; error: string }> }> {
    let written = 0;
    let fallback = 0;
    const errors: Array<{ fileName: string; error: string }> = [];

    for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        onProgress?.(i, assets.length, asset.fileName);
        try {
            const actualPath = await writeXmpSidecar(asset);
            written++;
            // Fallback tespiti: dosyanın yanına yazılamadıysa yol farklı döner
            const expectedPath = xmpPath(asset.filePath);
            if (actualPath.replace(/\\/g, '/') !== expectedPath.replace(/\\/g, '/')) {
                fallback++;
            }
        } catch (err) {
            errors.push({
                fileName: asset.fileName,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    onProgress?.(assets.length, assets.length, '');
    return { written, fallback, errors };
}
