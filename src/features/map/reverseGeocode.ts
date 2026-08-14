/**
 * Offline ters-geocoding: GPS koordinatı → en yakın şehir + ülke.
 *
 * %100 offline: şehir verisi `public/geo/cities.json` (GeoNames cities15000'den
 * türetilmiş, CC BY 4.0 — bkz. public/geo/CREDITS.txt); ülke adı tarayıcının
 * `Intl.DisplayNames` API'si ile yerelleştirilir (ek isim tablosu yok).
 *
 * Sınırlar: "şehir" = en yakın >15k nüfuslu yerleşim (yaklaşık; küçük bir kasaba
 * en yakın büyük şehre eşlenebilir). Semt/sokak offline mümkün değil — bkz.
 * bu oturumdaki fizibilite analizi.
 */

export interface CityRecord {
    name: string;
    lat: number;
    lon: number;
    cc: string;
}

export interface PlaceLabel {
    city: string;
    cc: string;
    country: string;
}

export interface CityIndex {
    list: CityRecord[];
    /** 1°×1° ızgara — "latCell:lonCell" → o hücredeki şehirler (en yakın-komşu hızlandırma). */
    grid: Map<string, CityRecord[]>;
}

const CITIES_URL = `${import.meta.env.BASE_URL}geo/cities.json`;

function cellKey(latCell: number, lonCell: number): string {
    return `${latCell}:${lonCell}`;
}

/** Ham [ad, lat, lon, cc] satırlarından arama indeksi kurar. */
export function buildCityIndex(rows: Array<[string, number, number, string]>): CityIndex {
    const list: CityRecord[] = new Array(rows.length);
    const grid = new Map<string, CityRecord[]>();
    for (let i = 0; i < rows.length; i++) {
        const [name, lat, lon, cc] = rows[i];
        const rec: CityRecord = { name, lat, lon, cc };
        list[i] = rec;
        const k = cellKey(Math.floor(lat), Math.floor(lon));
        const arr = grid.get(k);
        if (arr) arr.push(rec);
        else grid.set(k, [rec]);
    }
    return { list, grid };
}

let indexPromise: Promise<CityIndex> | null = null;
function loadIndex(): Promise<CityIndex> {
    if (!indexPromise) {
        indexPromise = fetch(CITIES_URL)
            .then((r) => r.json())
            .then((rows: Array<[string, number, number, string]>) => buildCityIndex(rows))
            .catch((): CityIndex => ({ list: [], grid: new Map() }));
    }
    return indexPromise;
}

/** Ekvatoral yaklaşık karesel mesafe (şehir ölçeğinde yeterli; sqrt yok). */
function sqDist(aLat: number, aLon: number, bLat: number, bLon: number): number {
    const cos = Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
    const dx = (aLon - bLon) * cos;
    const dy = aLat - bLat;
    return dx * dx + dy * dy;
}

/** Izgara üzerinde genişleyen halka aramasıyla en yakın şehir (senkron çekirdek). */
export function nearestInIndex(index: CityIndex, lat: number, lon: number): CityRecord | null {
    if (!index.list.length) return null;
    const baseLat = Math.floor(lat);
    const baseLon = Math.floor(lon);
    let best: CityRecord | null = null;
    let bestD = Infinity;
    let foundRing = -1;
    for (let ring = 0; ring <= 90; ring++) {
        for (let dLat = -ring; dLat <= ring; dLat++) {
            for (let dLon = -ring; dLon <= ring; dLon++) {
                if (Math.max(Math.abs(dLat), Math.abs(dLon)) !== ring) continue; // yalnız halkanın kenarı
                const cell = index.grid.get(cellKey(baseLat + dLat, baseLon + dLon));
                if (!cell) continue;
                for (const c of cell) {
                    const d = sqDist(lat, lon, c.lat, c.lon);
                    if (d < bestD) { bestD = d; best = c; }
                }
            }
        }
        if (best && foundRing < 0) foundRing = ring;
        // Komşu hücrede daha yakını olabilir → ilk bulgudan sonra +2 halka daha tara.
        if (foundRing >= 0 && ring >= foundRing + 2) break;
    }
    return best;
}

const displayNamesCache = new Map<string, Intl.DisplayNames>();
function getDisplayNames(locale: string): Intl.DisplayNames | null {
    let dn = displayNamesCache.get(locale);
    if (!dn) {
        try {
            dn = new Intl.DisplayNames([locale], { type: 'region' });
        } catch {
            return null;
        }
        displayNamesCache.set(locale, dn);
    }
    return dn;
}

/** ISO alpha-2 ülke kodu → yerelleştirilmiş ülke adı (çözülemezse kodu döner). */
export function countryName(cc: string, locale: string): string {
    const dn = getDisplayNames(locale);
    if (!dn) return cc;
    try {
        return dn.of(cc) ?? cc;
    } catch {
        return cc;
    }
}

/** Tek koordinat için ülke + en yakın şehir. */
export async function reverseGeocode(lat: number, lon: number, locale: string): Promise<PlaceLabel | null> {
    const index = await loadIndex();
    const c = nearestInIndex(index, lat, lon);
    if (!c) return null;
    return { city: c.name, cc: c.cc, country: countryName(c.cc, locale) };
}

/** Çok sayıda nokta için toplu çözüm (indeks bir kez yüklenir). */
export async function reverseGeocodeBatch(
    points: Array<{ id: string; lat: number; lon: number }>,
    locale: string,
): Promise<Map<string, PlaceLabel>> {
    const index = await loadIndex();
    const out = new Map<string, PlaceLabel>();
    if (!index.list.length) return out;
    for (const p of points) {
        const c = nearestInIndex(index, p.lat, p.lon);
        if (c) out.set(p.id, { city: c.name, cc: c.cc, country: countryName(c.cc, locale) });
    }
    return out;
}
