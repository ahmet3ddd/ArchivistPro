// Thumbnail hook'lari (id → data-URI).
// - useThumbnails: sabit/kucuk id kumesi (detay paneli) — id degisince yeniden ceker.
// - useGridThumbnails: sonsuz-kaydirmali grid — yalniz EKSIK id'leri batch ceker ve
//   SINIRLI (LRU) cache'te tutar; id listesi bosaldiginda (yeni sorgu) cache temizlenir.

import { useEffect, useRef, useState } from "react";

import { ipc } from "../ipc/client";
import { useUiStore } from "../store/useUiStore";

/** Aktif kaynagin thumbnail cagrisi (LAN Faz 3). Sekil iki tarafta da AYNI (`ThumbnailDto[]`)
 *  → cagiran kod degismez, yalniz hedef degisir. */
function fetchThumbs(remote: boolean, ids: number[]) {
  return remote ? ipc.remoteThumbnails(ids) : ipc.getThumbnails(ids);
}

// Grid thumbnail cache ust siniri (en-son-istenen id sayisi). ~400 ≈ birkac ekran
// dolusu overscan; 100K+ arsivde kaydirilan HER thumbnail'i bellekte tutmamak icin
// (base64 JPEG'ler GB'lara cikar) sinir asilinca en eski girisler hem map'ten hem
// requestedRef'ten atilir — geri kaydirilan thumbnail tekrar cekilebilir kalir.
const GRID_CACHE_MAX = 400;

export function useThumbnails(ids: number[]): Record<number, string> {
  const [map, setMap] = useState<Record<number, string>>({});
  const remote = useUiStore((s) => s.assetSource === "remote");
  const key = ids.join(","); // kararli deps anahtari

  useEffect(() => {
    if (ids.length === 0) {
      setMap({});
      return;
    }
    let active = true;
    fetchThumbs(remote, ids)
      .then((list) => {
        if (!active) return;
        const next: Record<number, string> = {};
        for (const t of list) {
          next[t.asset_id] = `data:${t.mime};base64,${t.data_base64}`;
        }
        setMap(next);
      })
      .catch(() => {
        if (active) setMap({});
      });
    return () => {
      active = false;
    };
    // ids degil `key` (icerik) izlenir; her render yeni dizi kimligi olusturur.
    // `remote` de izlenir: kaynak degisince ayni id BASKA bir gorsele karsilik gelir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, remote]);

  return map;
}

export function useGridThumbnails(ids: number[]): Record<number, string> {
  const [map, setMap] = useState<Record<number, string>>({});
  const remote = useUiStore((s) => s.assetSource === "remote");
  const requestedRef = useRef<Set<number>>(new Set()); // tekrar istemeyi onler
  // En-son-istenen id'lerin sirasi (LRU kuyrugu): bas = en eski, son = en yeni.
  // requestedRef ile birlikte tutulur; sinir asilinca bastan atilir.
  const orderRef = useRef<number[]>([]);

  // Yeni sorgu sifirlandiginda (id listesi bosaldi) cache temizle.
  const empty = ids.length === 0;
  useEffect(() => {
    if (empty) {
      requestedRef.current = new Set();
      orderRef.current = [];
      setMap({});
    }
  }, [empty]);

  // 🔑 KAYNAK DEGISINCE CACHE TAMAMEN TEMIZLENIR (LAN Faz 3).
  //
  // Cache YALNIZ `id` ile anahtarlanir, ama uzak ve yerel id uzaylari BAGIMSIZDIR: host'un
  // 5 numarali asset'i ile bu makinenin 5 numarali asset'i alakasizdir. Temizlemezsek
  // `requestedRef.has(5)` true kalir → uzak kartta YEREL dosyanin gorseli gosterilirdi
  // (kart adi uzaktan, resmi yerelden — gorunur ve yaniltici bir yanlislik).
  // Bu effect `empty` sifirlamasindan SONRA tanimli; React effect'leri tanim sirasiyla
  // kosar → kaynak degisiminde temizlik, ayni commit'teki cekme effect'inden once biter.
  useEffect(() => {
    requestedRef.current = new Set();
    orderRef.current = [];
    setMap({});
  }, [remote]);

  const key = ids.join(",");
  useEffect(() => {
    const missing = ids.filter((id) => !requestedRef.current.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => requestedRef.current.add(id));
    let active = true;
    fetchThumbs(remote, missing)
      .then((list) => {
        // SUPERSEDED (yeni pencere devraldi → active=false): sonuclari YINE DE map'e uygula.
        // id→thumbnail SABIT oldugundan bayat degil. Birakirsak bu id'ler requestedRef'te
        // "istendi" kalir ama map'te olmaz → KALICI BOSLUK (kart ikon fallback'ine duser).
        // Bu, "grid'de thumbnail cikmiyor ama .jpg filtreleyince cikiyor" bug'inin kokuydu:
        // acilistaki rangeChanged FIRTINASI ardarda fetch'leri iptal edip sonuclari atiyordu.
        // Eviction bookkeeping'i ATLA (kapanistaki `ids` bayat; guncel pencereyi aktif effect yonetir).
        if (!active) {
          setMap((prev) => {
            const next = { ...prev };
            for (const t of list) {
              next[t.asset_id] = `data:${t.mime};base64,${t.data_base64}`;
            }
            return next;
          });
          return;
        }
        // LRU kuyrugunu guncelle: gorunur id'leri sona tasi (en-son-kullanildi), boylece
        // ekrandaki thumbnail'ler atilmaktan korunur. Sonra SINIR (GRID_CACHE_MAX) asilirsa
        // en eski id'leri sec — bellek O(pencere), O(kaydirilan) DEGIL.
        // (Tum ref mutasyonlari burada; setMap updater'i saf kalir — StrictMode'da
        // updater'in cift cagrilmasinda yanlislikla iki kez evict edilmez.)
        const visible = new Set(ids);
        const order = orderRef.current.filter((id) => !visible.has(id)).concat(ids);
        let evict: number[] = [];
        if (order.length > GRID_CACHE_MAX) {
          evict = order.slice(0, order.length - GRID_CACHE_MAX);
          orderRef.current = order.slice(order.length - GRID_CACHE_MAX);
        } else {
          orderRef.current = order;
        }
        for (const id of evict) requestedRef.current.delete(id);
        setMap((prev) => {
          const next = { ...prev };
          for (const t of list) {
            next[t.asset_id] = `data:${t.mime};base64,${t.data_base64}`;
          }
          for (const id of evict) delete next[id];
          return next;
        });
      })
      .catch(() => {
        // Hata: bu id'ler cekilemedi → requestedRef'ten CIKAR ki sonraki pencerede TEKRAR
        // denensin (aksi halde kalici "istendi ama bos" boslugu olusur). Kart ikon fallback'inde kalir.
        missing.forEach((id) => requestedRef.current.delete(id));
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, remote]);

  return map;
}
