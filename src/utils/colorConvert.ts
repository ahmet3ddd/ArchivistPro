/**
 * Renk dönüşüm ve RAL eşleşme utiliteleri.
 * Tüm hesaplamalar frontend'de yapılır — ek API çağrısı gerekmez.
 */

// ── Temel dönüşümler ──

export type RGB = { r: number; g: number; b: number };
export type CMYK = { c: number; m: number; y: number; k: number };
export type HSL = { h: number; s: number; l: number };
export type LAB = { l: number; a: number; b: number };

export function hexToRgb(hex: string): RGB {
    const h = hex.replace('#', '');
    return {
        r: parseInt(h.substring(0, 2), 16),
        g: parseInt(h.substring(2, 4), 16),
        b: parseInt(h.substring(4, 6), 16),
    };
}

export function rgbToCmyk({ r, g, b }: RGB): CMYK {
    const r1 = r / 255, g1 = g / 255, b1 = b / 255;
    const k = 1 - Math.max(r1, g1, b1);
    if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
    return {
        c: Math.round(((1 - r1 - k) / (1 - k)) * 100),
        m: Math.round(((1 - g1 - k) / (1 - k)) * 100),
        y: Math.round(((1 - b1 - k) / (1 - k)) * 100),
        k: Math.round(k * 100),
    };
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
    const r1 = r / 255, g1 = g / 255, b1 = b / 255;
    const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r1) h = ((g1 - b1) / d + (g1 < b1 ? 6 : 0)) / 6;
    else if (max === g1) h = ((b1 - r1) / d + 2) / 6;
    else h = ((r1 - g1) / d + 4) / 6;
    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100),
    };
}

/** Beyaz & Siyah oranı — Luminance tabanlı */
export function rgbToWB({ r, g, b }: RGB): { white: number; black: number } {
    // Relative luminance (ITU-R BT.709)
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const white = Math.round(luminance * 100);
    return { white, black: 100 - white };
}

// ── CIE LAB (deltaE hesaplaması için) ──

function rgbToLab({ r, g, b }: RGB): LAB {
    // sRGB → XYZ
    let r1 = r / 255, g1 = g / 255, b1 = b / 255;
    r1 = r1 > 0.04045 ? Math.pow((r1 + 0.055) / 1.055, 2.4) : r1 / 12.92;
    g1 = g1 > 0.04045 ? Math.pow((g1 + 0.055) / 1.055, 2.4) : g1 / 12.92;
    b1 = b1 > 0.04045 ? Math.pow((b1 + 0.055) / 1.055, 2.4) : b1 / 12.92;
    let x = (r1 * 0.4124564 + g1 * 0.3575761 + b1 * 0.1804375) / 0.95047;
    let y = (r1 * 0.2126729 + g1 * 0.7151522 + b1 * 0.0721750);
    let z = (r1 * 0.0193339 + g1 * 0.1191920 + b1 * 0.9503041) / 1.08883;
    const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    x = f(x); y = f(y); z = f(z);
    return {
        l: 116 * y - 16,
        a: 500 * (x - y),
        b: 200 * (y - z),
    };
}

function deltaE76(lab1: LAB, lab2: LAB): number {
    return Math.sqrt(
        (lab1.l - lab2.l) ** 2 +
        (lab1.a - lab2.a) ** 2 +
        (lab1.b - lab2.b) ** 2
    );
}

// ── RAL Classic Kataloğu (en yaygın 213 renk) ──

export interface RALColor {
    code: string;
    name: string;
    hex: string;
}

// Kompakt format: "kod|isim|hex" — parse edilir
const RAL_DATA = [
    '1000|Yeşil Bej|#CDBA88','1001|Bej|#D0B084','1002|Kum Sarısı|#D2AA6D',
    '1003|Sinyal Sarısı|#F9A800','1004|Altın Sarısı|#E49E00','1005|Bal Sarısı|#CB8E00',
    '1006|Mısır Sarısı|#E29000','1007|Nergis Sarısı|#E88C00','1011|Kahverengi Bej|#AF8050',
    '1012|Limon Sarısı|#DDAF27','1013|İnci Beyaz|#E3D9C6','1014|Fildişi|#DDC49A',
    '1015|Açık Fildişi|#E6D2B5','1016|Kükürt Sarısı|#F1DD38','1017|Safran Sarısı|#F6A950',
    '1018|Çinko Sarısı|#FACA30','1019|Gri Bej|#A48F7A','1020|Zeytin Sarısı|#A08F65',
    '1021|Kadmiyum Sarısı|#F6B600','1023|Trafik Sarısı|#F7B500','1024|Okra Sarısı|#BA8F4C',
    '1026|Parlak Sarı|#FFFF00','1027|Kari Sarısı|#A77F0E','1028|Kavun Sarısı|#FF9B00',
    '1032|Süpürge Sarısı|#E2A300','1033|Dahlia Sarısı|#FF9D1E','1034|Pastel Sarı|#F09E00',
    '1035|Inci Bej|#A29985','1036|İnci Altın|#927549','1037|Güneş Sarısı|#F09200',
    '2000|Turuncu|#DD7907','2001|Kırmızı Turuncu|#BE4E20','2002|Kan Portakalı|#C63927',
    '2003|Pastel Turuncu|#FA842B','2004|Saf Turuncu|#E75B12','2005|Parlak Turuncu|#FF2300',
    '2007|Parlak Açık Turuncu|#FFB200','2008|Açık Kırmızı Turuncu|#ED6B21',
    '2009|Trafik Turuncu|#E15501','2010|Sinyal Turuncu|#D4652F','2011|Koyu Turuncu|#EC7C25',
    '2012|Somon Turuncu|#DB6A50','2013|İnci Turuncu|#954527',
    '3000|Ateş Kırmızısı|#AB2524','3001|Sinyal Kırmızısı|#A02128','3002|Karmin Kırmızı|#A1232B',
    '3003|Yakut Kırmızısı|#8D1D2C','3004|Bordo Kırmızı|#701F29','3005|Şarap Kırmızısı|#5E2028',
    '3007|Siyah Kırmızı|#402225','3009|Oksit Kırmızı|#703731','3011|Kahverengi Kırmızı|#7E292C',
    '3012|Bej Kırmızı|#CB8D73','3013|Domates Kırmızısı|#9C322E','3014|Eski Pembe|#D47479',
    '3015|Açık Pembe|#E1A6AD','3016|Mercan Kırmızısı|#AC4034','3017|Gül Kırmızısı|#D3545F',
    '3018|Çilek Kırmızısı|#D14152','3020|Trafik Kırmızısı|#C1121C','3022|Somon Kırmızı|#D56D56',
    '3024|Parlak Kırmızı|#F70000','3026|Parlak Açık Kırmızı|#FF0000',
    '3027|Ahududu Kırmızısı|#B42041','3028|Saf Kırmızı|#CC2C24','3031|Oryant Kırmızısı|#AC323B',
    '3032|İnci Yakut Kırmızı|#711521','3033|İnci Pembe|#B24C43',
    '4001|Kırmızı Leylak|#8A5A83','4002|Kırmızı Mor|#933D50','4003|Erika Moru|#C63678',
    '4004|Bordo Mor|#6B1C50','4005|Mavi Leylak|#76689A','4006|Trafik Moru|#992572',
    '4007|Mor Menekşe|#4A203B','4008|Sinyal Moru|#904684','4009|Pastel Mor|#A38995',
    '4010|Telekom Pembesi|#C63272','4011|İnci Mor|#8773A1','4012|İnci Böğürtlen|#6B6880',
    '5000|Mor Mavi|#384C70','5001|Yeşil Mavi|#1F4764','5002|Ultramar Mavi|#2B2C7C',
    '5003|Safir Mavi|#2A3756','5004|Siyah Mavi|#1D1F2A','5005|Sinyal Mavi|#154889',
    '5007|Parlak Mavi|#41678D','5008|Gri Mavi|#313C48','5009|Azur Mavi|#2E5978',
    '5010|Gentian Mavi|#13447C','5011|Çelik Mavi|#232C3F','5012|Açık Mavi|#3481B8',
    '5013|Kobalt Mavi|#232D53','5014|Güvercin Mavi|#6C7C98','5015|Gök Mavi|#2874B2',
    '5017|Trafik Mavi|#0E518D','5018|Turkuaz Mavi|#21888F','5019|Kapri Mavi|#1A5784',
    '5020|Okyanus Mavi|#0B4151','5021|Su Mavi|#07737A','5022|Gece Mavi|#2F2A5A',
    '5023|Uzak Mavi|#4D668E','5024|Pastel Mavi|#6A93B0','5025|İnci Gentian Mavi|#2E6C96',
    '5026|İnci Gece Mavi|#102C54',
    '6000|Patina Yeşil|#327662','6001|Zümrüt Yeşil|#28713E','6002|Yaprak Yeşil|#276235',
    '6003|Zeytin Yeşil|#4B573E','6004|Mavi Yeşil|#0E4243','6005|Yosun Yeşil|#114232',
    '6006|Gri Zeytin|#3C392E','6007|Şişe Yeşil|#283424','6008|Kahverengi Yeşil|#35382E',
    '6009|Köknar Yeşil|#27352A','6010|Çimen Yeşil|#3E753B','6011|Rezelda Yeşil|#5B7F56',
    '6012|Siyah Yeşil|#2D4030','6013|Kamış Yeşil|#7D7F54','6014|Sarı Zeytin|#474135',
    '6015|Siyah Zeytin|#3D3D36','6016|Turkuaz Yeşil|#047243','6017|Mayıs Yeşil|#468641',
    '6018|Sarı Yeşil|#48A43F','6019|Pastel Yeşil|#B7D9B1','6020|Krom Yeşil|#354733',
    '6021|Soluk Yeşil|#86A47C','6022|Zeytin Kahve|#3E3C32','6024|Trafik Yeşil|#008754',
    '6025|Eğrelti Yeşil|#53753C','6026|Opal Yeşil|#005D52','6027|Açık Yeşil|#81C0BB',
    '6028|Çam Yeşil|#2D5546','6029|Nane Yeşil|#007243','6032|Sinyal Yeşil|#237F52',
    '6033|Nane Turkuaz|#46877F','6034|Pastel Turkuaz|#7AACAC','6035|İnci Yeşil|#194D25',
    '6036|İnci Opal Yeşil|#04574B','6037|Saf Yeşil|#008B29','6038|Parlak Yeşil|#00BB2E',
    '7000|Sincap Gri|#787F84','7001|Gümüş Gri|#8F999F','7002|Zeytin Gri|#817F68',
    '7003|Yosun Gri|#7A7B6D','7004|Sinyal Gri|#9EA0A1','7005|Fare Gri|#6B716F',
    '7006|Bej Gri|#756F61','7008|Haki Gri|#746643','7009|Yeşil Gri|#5B6259',
    '7010|Çadır Gri|#575D57','7011|Demir Gri|#555D61','7012|Bazalt Gri|#596163',
    '7013|Kahverengi Gri|#575044','7015|Arduvaz Gri|#4F5358','7016|Antrasit Gri|#383E42',
    '7021|Siyah Gri|#2E3234','7022|Gölge Gri|#4C4A44','7023|Beton Gri|#808076',
    '7024|Grafit Gri|#474A50','7026|Granit Gri|#374447','7030|Taş Gri|#929089',
    '7031|Mavi Gri|#5D6970','7032|Çakıl Gri|#B9B4A9','7033|Çimento Gri|#818979',
    '7034|Sarı Gri|#939176','7035|Açık Gri|#CBD0CC','7036|Platin Gri|#9A9697',
    '7037|Toz Gri|#7C7F7E','7038|Akik Gri|#B4B8B0','7039|Kuvars Gri|#6B695F',
    '7040|Pencere Gri|#9DA3A6','7042|Trafik Gri A|#8E9291','7043|Trafik Gri B|#4E5451',
    '7044|İpek Gri|#BDBDB2','7045|Telekom Gri 1|#91969A','7046|Telekom Gri 2|#82898E',
    '7047|Telekom Gri 4|#CFD0CF','7048|İnci Fare Gri|#888175',
    '8000|Yeşil Kahve|#887142','8001|Okra Kahve|#9C6B30','8002|Sinyal Kahve|#7B5141',
    '8003|Kil Kahve|#80542F','8004|Bakır Kahve|#8F4E35','8007|Geyik Kahve|#6F4A2F',
    '8008|Zeytin Kahve|#6F4F28','8011|Ceviz Kahve|#5A3A29','8012|Kırmızı Kahve|#66332B',
    '8014|Sepya Kahve|#4A3526','8015|Kestane Kahve|#5E2F26','8016|Maun Kahve|#4C2B20',
    '8017|Çikolata Kahve|#44322D','8019|Gri Kahve|#3D3635','8022|Siyah Kahve|#211F20',
    '8023|Turuncu Kahve|#A65E2F','8024|Bej Kahve|#79553C','8025|Soluk Kahve|#755847',
    '8028|Toprak Kahve|#4E3B2B','8029|İnci Bakır|#773C27',
    '9001|Krem Beyaz|#FDF4E3','9002|Gri Beyaz|#E7EBDA','9003|Sinyal Beyaz|#F4F4F4',
    '9004|Sinyal Siyah|#282828','9005|Simsiyah|#0A0A0A','9006|Beyaz Alüminyum|#A5A8A6',
    '9007|Gri Alüminyum|#8F8F8C','9010|Saf Beyaz|#FFFFFF','9011|Grafit Siyah|#1C1C1C',
    '9016|Trafik Beyaz|#F7FBF5','9017|Trafik Siyah|#1E1E1E','9018|Papiryus Beyaz|#CFD3CD',
    '9022|İnci Açık Gri|#9C9C9C','9023|İnci Koyu Gri|#7E8182',
];

let _ralCache: RALColor[] | null = null;
let _ralLabCache: { color: RALColor; lab: LAB }[] | null = null;

function getRalColors(): RALColor[] {
    if (_ralCache) return _ralCache;
    _ralCache = RAL_DATA.map(entry => {
        const [code, name, hex] = entry.split('|');
        return { code: `RAL ${code}`, name, hex };
    });
    return _ralCache;
}

function getRalLabColors(): { color: RALColor; lab: LAB }[] {
    if (_ralLabCache) return _ralLabCache;
    _ralLabCache = getRalColors().map(c => ({
        color: c,
        lab: rgbToLab(hexToRgb(c.hex)),
    }));
    return _ralLabCache;
}

export interface RALMatch {
    code: string;
    name: string;
    hex: string;
    distance: number;  // deltaE76 mesafesi (0 = tam eşleşme)
}

/** Verilen hex renge en yakın RAL rengini bul (CIE76 deltaE) */
export function findClosestRAL(hex: string): RALMatch {
    const lab = rgbToLab(hexToRgb(hex));
    const ralColors = getRalLabColors();
    let best = ralColors[0];
    let bestDist = Infinity;
    for (const entry of ralColors) {
        const d = deltaE76(lab, entry.lab);
        if (d < bestDist) {
            bestDist = d;
            best = entry;
        }
    }
    return {
        code: best.color.code,
        name: best.color.name,
        hex: best.color.hex,
        distance: Math.round(bestDist * 10) / 10,
    };
}

/** Tüm renk bilgilerini tek seferde hesapla */
export interface ColorInfo {
    rgb: RGB;
    cmyk: CMYK;
    hsl: HSL;
    wb: { white: number; black: number };
    ral: RALMatch;
}

export function getColorInfo(hex: string): ColorInfo {
    const rgb = hexToRgb(hex);
    return {
        rgb,
        cmyk: rgbToCmyk(rgb),
        hsl: rgbToHsl(rgb),
        wb: rgbToWB(rgb),
        ral: findClosestRAL(hex),
    };
}
