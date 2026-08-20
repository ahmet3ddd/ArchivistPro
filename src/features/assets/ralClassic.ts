// RAL CLASSIC referans tablosu (213 renk) + en yakın renk eşleştirici.
//
// ⚠️ BU TABLO YAKLAŞIKTIR — ve bu, düzeltilecek bir kusur değil, standardın doğasıdır:
// RAL fiziksel bir boya/kaplama standardıdır (belirli aydınlatma altında, belirli yüzeyde ölçülür).
// sRGB karşılıkları yayınlanmış YAKLAŞIK dönüşümlerdir ve kaynaktan kaynağa birkaç birim oynar.
// Üstelik eşleştirdiğimiz renk de bir fotoğraftan/render'dan gelir: aydınlatma, beyaz dengesi,
// JPEG sıkıştırması ve ekran gamut'u zaten rengi kaydırmıştır.
//
// Bu yüzden UI'da:
//   · değer DAİMA "≈" ile gösterilir,
//   · yanında ΔE (algısal mesafe) verilir ve uzak eşleşme AÇIKÇA işaretlenir,
//   · hiçbir yerde "bu rengin RAL karşılığı budur" denmez.
// Boya siparişi kararı fiziksel RAL kartelasıyla verilir; buradaki değer YÖNLENDİRİCİDİR.
//
// Tabloyu değiştirmek: yalnız bu dosyadaki `RAL_CLASSIC` dizisi güncellenir (kod · ad · hex).
// Ofisin resmi bir RAL→sRGB listesi varsa birebir onunla değiştirilebilir; eşleştirme mantığı
// (CIEDE2000) veriden bağımsızdır. `ralClassic.test.ts` tablonun BÜTÜNLÜĞÜNÜ (biçim/benzersizlik/
// beklenen aile sayıları) korur — tek tek değerlerin doğruluğunu değil (o, kaynağın sorumluluğu).
//
// Adlar RAL'in kendi (uluslararası kullanılan İngilizce) adlarıdır: ürün kodunun parçası gibi
// davranılır, i18n'e SOKULMAZ — "RAL 5008" gibi "Grey blue" da standardın yazımıdır.

import { hexToRgb, rgbDeltaE, type Rgb } from "./colorMath";

export interface RalColor {
  /** "RAL 1000" biçiminde tam kod. */
  code: string;
  /** Standardın İngilizce adı (ör. "Green beige"). */
  name: string;
  /** Yaklaşık sRGB karşılığı. */
  hex: string;
}

export const RAL_CLASSIC: readonly RalColor[] = [
  // ── 1000 serisi: sarı tonları ──
  { code: "RAL 1000", name: "Green beige", hex: "#BEBD7F" },
  { code: "RAL 1001", name: "Beige", hex: "#C2B078" },
  { code: "RAL 1002", name: "Sand yellow", hex: "#C6A664" },
  { code: "RAL 1003", name: "Signal yellow", hex: "#E5BE01" },
  { code: "RAL 1004", name: "Golden yellow", hex: "#CDA434" },
  { code: "RAL 1005", name: "Honey yellow", hex: "#A98307" },
  { code: "RAL 1006", name: "Maize yellow", hex: "#E4A010" },
  { code: "RAL 1007", name: "Daffodil yellow", hex: "#DC9D00" },
  { code: "RAL 1011", name: "Brown beige", hex: "#8A6642" },
  { code: "RAL 1012", name: "Lemon yellow", hex: "#C7B446" },
  { code: "RAL 1013", name: "Oyster white", hex: "#EAE6CA" },
  { code: "RAL 1014", name: "Ivory", hex: "#E1CC4F" },
  { code: "RAL 1015", name: "Light ivory", hex: "#E6D690" },
  { code: "RAL 1016", name: "Sulfur yellow", hex: "#EDFF21" },
  { code: "RAL 1017", name: "Saffron yellow", hex: "#F5D033" },
  { code: "RAL 1018", name: "Zinc yellow", hex: "#F8F32B" },
  { code: "RAL 1019", name: "Grey beige", hex: "#9E9764" },
  { code: "RAL 1020", name: "Olive yellow", hex: "#999950" },
  { code: "RAL 1021", name: "Rape yellow", hex: "#F3DA0B" },
  { code: "RAL 1023", name: "Traffic yellow", hex: "#FAD201" },
  { code: "RAL 1024", name: "Ochre yellow", hex: "#AEA04B" },
  { code: "RAL 1026", name: "Luminous yellow", hex: "#FFFF00" },
  { code: "RAL 1027", name: "Curry", hex: "#9D9101" },
  { code: "RAL 1028", name: "Melon yellow", hex: "#F4A900" },
  { code: "RAL 1032", name: "Broom yellow", hex: "#D6AE01" },
  { code: "RAL 1033", name: "Dahlia yellow", hex: "#F3A505" },
  { code: "RAL 1034", name: "Pastel yellow", hex: "#EFA94A" },
  { code: "RAL 1035", name: "Pearl beige", hex: "#6A5D4D" },
  { code: "RAL 1036", name: "Pearl gold", hex: "#705335" },
  { code: "RAL 1037", name: "Sun yellow", hex: "#F09200" },
  // ── 2000 serisi: turuncu ──
  { code: "RAL 2000", name: "Yellow orange", hex: "#ED760E" },
  { code: "RAL 2001", name: "Red orange", hex: "#C93C20" },
  { code: "RAL 2002", name: "Vermilion", hex: "#CB2821" },
  { code: "RAL 2003", name: "Pastel orange", hex: "#FF7514" },
  { code: "RAL 2004", name: "Pure orange", hex: "#F44611" },
  { code: "RAL 2005", name: "Luminous orange", hex: "#FF2301" },
  { code: "RAL 2007", name: "Luminous bright orange", hex: "#FFA420" },
  { code: "RAL 2008", name: "Bright red orange", hex: "#F75E25" },
  { code: "RAL 2009", name: "Traffic orange", hex: "#F54021" },
  { code: "RAL 2010", name: "Signal orange", hex: "#D84B20" },
  { code: "RAL 2011", name: "Deep orange", hex: "#EC7C26" },
  { code: "RAL 2012", name: "Salmon orange", hex: "#E55137" },
  { code: "RAL 2013", name: "Pearl orange", hex: "#C35831" },
  // ── 3000 serisi: kırmızı ──
  { code: "RAL 3000", name: "Flame red", hex: "#AF2B1E" },
  { code: "RAL 3001", name: "Signal red", hex: "#A52019" },
  { code: "RAL 3002", name: "Carmine red", hex: "#A2231D" },
  { code: "RAL 3003", name: "Ruby red", hex: "#9B111E" },
  { code: "RAL 3004", name: "Purple red", hex: "#75151E" },
  { code: "RAL 3005", name: "Wine red", hex: "#5E2129" },
  { code: "RAL 3007", name: "Black red", hex: "#412227" },
  { code: "RAL 3009", name: "Oxide red", hex: "#642424" },
  { code: "RAL 3011", name: "Brown red", hex: "#781F19" },
  { code: "RAL 3012", name: "Beige red", hex: "#C1876B" },
  { code: "RAL 3013", name: "Tomato red", hex: "#A12312" },
  { code: "RAL 3014", name: "Antique pink", hex: "#D36E70" },
  { code: "RAL 3015", name: "Light pink", hex: "#EA899A" },
  { code: "RAL 3016", name: "Coral red", hex: "#B32821" },
  { code: "RAL 3017", name: "Rose", hex: "#E63244" },
  { code: "RAL 3018", name: "Strawberry red", hex: "#D53032" },
  { code: "RAL 3020", name: "Traffic red", hex: "#CC0605" },
  { code: "RAL 3022", name: "Salmon pink", hex: "#D95030" },
  { code: "RAL 3024", name: "Luminous red", hex: "#F80000" },
  { code: "RAL 3026", name: "Luminous bright red", hex: "#FE0000" },
  { code: "RAL 3027", name: "Raspberry red", hex: "#C51D34" },
  { code: "RAL 3028", name: "Pure red", hex: "#CB3234" },
  { code: "RAL 3031", name: "Orient red", hex: "#B32428" },
  { code: "RAL 3032", name: "Pearl ruby red", hex: "#721422" },
  { code: "RAL 3033", name: "Pearl pink", hex: "#B44C43" },
  // ── 4000 serisi: mor ──
  { code: "RAL 4001", name: "Red lilac", hex: "#6D3F5B" },
  { code: "RAL 4002", name: "Red violet", hex: "#922B3E" },
  { code: "RAL 4003", name: "Heather violet", hex: "#DE4C8A" },
  { code: "RAL 4004", name: "Claret violet", hex: "#641C34" },
  { code: "RAL 4005", name: "Blue lilac", hex: "#6C4675" },
  { code: "RAL 4006", name: "Traffic purple", hex: "#A03472" },
  { code: "RAL 4007", name: "Purple violet", hex: "#4A192C" },
  { code: "RAL 4008", name: "Signal violet", hex: "#924E7D" },
  { code: "RAL 4009", name: "Pastel violet", hex: "#A18594" },
  { code: "RAL 4010", name: "Telemagenta", hex: "#CF3476" },
  { code: "RAL 4011", name: "Pearl violet", hex: "#8673A1" },
  { code: "RAL 4012", name: "Pearl blackberry", hex: "#6C6874" },
  // ── 5000 serisi: mavi ──
  { code: "RAL 5000", name: "Violet blue", hex: "#354D73" },
  { code: "RAL 5001", name: "Green blue", hex: "#1F3438" },
  { code: "RAL 5002", name: "Ultramarine blue", hex: "#20214F" },
  { code: "RAL 5003", name: "Sapphire blue", hex: "#1D1E33" },
  { code: "RAL 5004", name: "Black blue", hex: "#18171C" },
  { code: "RAL 5005", name: "Signal blue", hex: "#1E2460" },
  { code: "RAL 5007", name: "Brilliant blue", hex: "#3E5F8A" },
  { code: "RAL 5008", name: "Grey blue", hex: "#26252D" },
  { code: "RAL 5009", name: "Azure blue", hex: "#025669" },
  { code: "RAL 5010", name: "Gentian blue", hex: "#0E294B" },
  { code: "RAL 5011", name: "Steel blue", hex: "#231A24" },
  { code: "RAL 5012", name: "Light blue", hex: "#3B83BD" },
  { code: "RAL 5013", name: "Cobalt blue", hex: "#1E213D" },
  { code: "RAL 5014", name: "Pigeon blue", hex: "#606E8C" },
  { code: "RAL 5015", name: "Sky blue", hex: "#2271B3" },
  { code: "RAL 5017", name: "Traffic blue", hex: "#063971" },
  { code: "RAL 5018", name: "Turquoise blue", hex: "#3F888F" },
  { code: "RAL 5019", name: "Capri blue", hex: "#1B5583" },
  { code: "RAL 5020", name: "Ocean blue", hex: "#1D334A" },
  { code: "RAL 5021", name: "Water blue", hex: "#256D7B" },
  { code: "RAL 5022", name: "Night blue", hex: "#252850" },
  { code: "RAL 5023", name: "Distant blue", hex: "#49678D" },
  { code: "RAL 5024", name: "Pastel blue", hex: "#5D9B9B" },
  { code: "RAL 5025", name: "Pearl gentian blue", hex: "#2A6478" },
  { code: "RAL 5026", name: "Pearl night blue", hex: "#102C54" },
  // ── 6000 serisi: yeşil ──
  { code: "RAL 6000", name: "Patina green", hex: "#316650" },
  { code: "RAL 6001", name: "Emerald green", hex: "#287233" },
  { code: "RAL 6002", name: "Leaf green", hex: "#2D572C" },
  { code: "RAL 6003", name: "Olive green", hex: "#424632" },
  { code: "RAL 6004", name: "Blue green", hex: "#1F3A3D" },
  { code: "RAL 6005", name: "Moss green", hex: "#2F4538" },
  { code: "RAL 6006", name: "Grey olive", hex: "#3E3B32" },
  { code: "RAL 6007", name: "Bottle green", hex: "#343B29" },
  { code: "RAL 6008", name: "Brown green", hex: "#39352A" },
  { code: "RAL 6009", name: "Fir green", hex: "#31372B" },
  { code: "RAL 6010", name: "Grass green", hex: "#35682D" },
  { code: "RAL 6011", name: "Reseda green", hex: "#587246" },
  { code: "RAL 6012", name: "Black green", hex: "#343E40" },
  { code: "RAL 6013", name: "Reed green", hex: "#6C7156" },
  { code: "RAL 6014", name: "Yellow olive", hex: "#47402E" },
  { code: "RAL 6015", name: "Black olive", hex: "#3B3C36" },
  { code: "RAL 6016", name: "Turquoise green", hex: "#1E5945" },
  { code: "RAL 6017", name: "May green", hex: "#4C9141" },
  { code: "RAL 6018", name: "Yellow green", hex: "#57A639" },
  { code: "RAL 6019", name: "Pastel green", hex: "#BDECB6" },
  { code: "RAL 6020", name: "Chrome green", hex: "#2E3A23" },
  { code: "RAL 6021", name: "Pale green", hex: "#89AC76" },
  { code: "RAL 6022", name: "Olive drab", hex: "#25221B" },
  { code: "RAL 6024", name: "Traffic green", hex: "#308446" },
  { code: "RAL 6025", name: "Fern green", hex: "#3D642D" },
  { code: "RAL 6026", name: "Opal green", hex: "#015D52" },
  { code: "RAL 6027", name: "Light green", hex: "#84C3BE" },
  { code: "RAL 6028", name: "Pine green", hex: "#2C5545" },
  { code: "RAL 6029", name: "Mint green", hex: "#20603D" },
  { code: "RAL 6032", name: "Signal green", hex: "#317F43" },
  { code: "RAL 6033", name: "Mint turquoise", hex: "#497E76" },
  { code: "RAL 6034", name: "Pastel turquoise", hex: "#7FB5B5" },
  { code: "RAL 6035", name: "Pearl green", hex: "#1C542D" },
  { code: "RAL 6036", name: "Pearl opal green", hex: "#193737" },
  { code: "RAL 6037", name: "Pure green", hex: "#008F39" },
  { code: "RAL 6038", name: "Luminous green", hex: "#00BB2D" },
  // ── 7000 serisi: gri ──
  { code: "RAL 7000", name: "Squirrel grey", hex: "#78858B" },
  { code: "RAL 7001", name: "Silver grey", hex: "#8A9597" },
  { code: "RAL 7002", name: "Olive grey", hex: "#7E7B52" },
  { code: "RAL 7003", name: "Moss grey", hex: "#6C7059" },
  { code: "RAL 7004", name: "Signal grey", hex: "#969992" },
  { code: "RAL 7005", name: "Mouse grey", hex: "#646B63" },
  { code: "RAL 7006", name: "Beige grey", hex: "#6D6552" },
  { code: "RAL 7008", name: "Khaki grey", hex: "#6A5F31" },
  { code: "RAL 7009", name: "Green grey", hex: "#4D5645" },
  { code: "RAL 7010", name: "Tarpaulin grey", hex: "#4C514A" },
  { code: "RAL 7011", name: "Iron grey", hex: "#434B4D" },
  { code: "RAL 7012", name: "Basalt grey", hex: "#4E5754" },
  { code: "RAL 7013", name: "Brown grey", hex: "#464531" },
  { code: "RAL 7015", name: "Slate grey", hex: "#434750" },
  { code: "RAL 7016", name: "Anthracite grey", hex: "#293133" },
  { code: "RAL 7021", name: "Black grey", hex: "#23282B" },
  { code: "RAL 7022", name: "Umbra grey", hex: "#332F2C" },
  { code: "RAL 7023", name: "Concrete grey", hex: "#686C5E" },
  { code: "RAL 7024", name: "Graphite grey", hex: "#474A51" },
  { code: "RAL 7026", name: "Granite grey", hex: "#2F353B" },
  { code: "RAL 7030", name: "Stone grey", hex: "#8B8C7A" },
  { code: "RAL 7031", name: "Blue grey", hex: "#474B4E" },
  { code: "RAL 7032", name: "Pebble grey", hex: "#B8B799" },
  { code: "RAL 7033", name: "Cement grey", hex: "#7D8471" },
  { code: "RAL 7034", name: "Yellow grey", hex: "#8F8B66" },
  { code: "RAL 7035", name: "Light grey", hex: "#D7D7D7" },
  { code: "RAL 7036", name: "Platinum grey", hex: "#7F7679" },
  { code: "RAL 7037", name: "Dusty grey", hex: "#7D7F7D" },
  { code: "RAL 7038", name: "Agate grey", hex: "#B5B8B1" },
  { code: "RAL 7039", name: "Quartz grey", hex: "#6C6960" },
  { code: "RAL 7040", name: "Window grey", hex: "#9DA1AA" },
  { code: "RAL 7042", name: "Traffic grey A", hex: "#8D948D" },
  { code: "RAL 7043", name: "Traffic grey B", hex: "#4E5452" },
  { code: "RAL 7044", name: "Silk grey", hex: "#CAC4B0" },
  { code: "RAL 7045", name: "Telegrey 1", hex: "#909090" },
  { code: "RAL 7046", name: "Telegrey 2", hex: "#82898F" },
  { code: "RAL 7047", name: "Telegrey 4", hex: "#D0D0D0" },
  { code: "RAL 7048", name: "Pearl mouse grey", hex: "#898176" },
  // ── 8000 serisi: kahverengi ──
  { code: "RAL 8000", name: "Green brown", hex: "#826C34" },
  { code: "RAL 8001", name: "Ochre brown", hex: "#955F20" },
  { code: "RAL 8002", name: "Signal brown", hex: "#6C3B2A" },
  { code: "RAL 8003", name: "Clay brown", hex: "#734222" },
  { code: "RAL 8004", name: "Copper brown", hex: "#8E402A" },
  { code: "RAL 8007", name: "Fawn brown", hex: "#59351F" },
  { code: "RAL 8008", name: "Olive brown", hex: "#6F4F28" },
  { code: "RAL 8011", name: "Nut brown", hex: "#5B3A29" },
  { code: "RAL 8012", name: "Red brown", hex: "#592321" },
  { code: "RAL 8014", name: "Sepia brown", hex: "#382C1E" },
  { code: "RAL 8015", name: "Chestnut brown", hex: "#633A34" },
  { code: "RAL 8016", name: "Mahogany brown", hex: "#4C2F27" },
  { code: "RAL 8017", name: "Chocolate brown", hex: "#45322E" },
  { code: "RAL 8019", name: "Grey brown", hex: "#403A3A" },
  { code: "RAL 8022", name: "Black brown", hex: "#212121" },
  { code: "RAL 8023", name: "Orange brown", hex: "#A65E2E" },
  { code: "RAL 8024", name: "Beige brown", hex: "#79553D" },
  { code: "RAL 8025", name: "Pale brown", hex: "#755C48" },
  { code: "RAL 8028", name: "Terra brown", hex: "#4E3B31" },
  { code: "RAL 8029", name: "Pearl copper", hex: "#763C28" },
  // ── 9000 serisi: beyaz / siyah ──
  { code: "RAL 9001", name: "Cream", hex: "#FDF4E3" },
  { code: "RAL 9002", name: "Grey white", hex: "#E7EBDA" },
  { code: "RAL 9003", name: "Signal white", hex: "#F4F4F4" },
  { code: "RAL 9004", name: "Signal black", hex: "#282828" },
  { code: "RAL 9005", name: "Jet black", hex: "#0A0A0A" },
  { code: "RAL 9006", name: "White aluminium", hex: "#A5A5A5" },
  { code: "RAL 9007", name: "Grey aluminium", hex: "#8F8F8F" },
  { code: "RAL 9010", name: "Pure white", hex: "#FFFFFF" },
  { code: "RAL 9011", name: "Graphite black", hex: "#1C1C1C" },
  { code: "RAL 9016", name: "Traffic white", hex: "#F6F6F6" },
  { code: "RAL 9017", name: "Traffic black", hex: "#1E1E1E" },
  { code: "RAL 9018", name: "Papyrus white", hex: "#CFD3CD" },
  { code: "RAL 9022", name: "Pearl light grey", hex: "#9C9C9C" },
  { code: "RAL 9023", name: "Pearl dark grey", hex: "#828282" },
];

/** ΔE00 eşiği: bunun ÜSTÜ "uzak eşleşme" sayılır ve UI'da açıkça öyle işaretlenir.
 *  10 ≈ "gözle bakınca başka bir renk" sınırı (bkz `deltaE2000` doküman notu). */
export const RAL_FAR_MATCH_DELTA = 10;

export interface RalMatch extends RalColor {
  /** Algısal mesafe (ΔE00). Küçük = daha iyi eşleşme. */
  delta: number;
  /** `delta > RAL_FAR_MATCH_DELTA` → eşleşme zayıf; UI bunu gizlemez ama işaretler. */
  far: boolean;
}

/** Tabloyu bir kez ayrıştır (her çağrıda 213 hex çözmek gereksiz iş olurdu). */
const PARSED: { color: RalColor; rgb: Rgb }[] = RAL_CLASSIC.flatMap((color) => {
  const rgb = hexToRgb(color.hex);
  return rgb ? [{ color, rgb }] : []; // bozuk satır tabloyu çökertmez, sessizce elenir
});

/**
 * Verilen sRGB rengine algısal olarak EN YAKIN RAL Classic rengi (CIEDE2000).
 * Tablo boşsa `null`. Sonuç DAİMA yaklaşıktır — bkz dosya başındaki not.
 */
export function nearestRal(rgb: Rgb): RalMatch | null {
  let best: RalMatch | null = null;
  for (const { color, rgb: ralRgb } of PARSED) {
    const delta = rgbDeltaE(rgb, ralRgb);
    if (best === null || delta < best.delta) {
      best = { ...color, delta, far: delta > RAL_FAR_MATCH_DELTA };
    }
  }
  return best;
}
