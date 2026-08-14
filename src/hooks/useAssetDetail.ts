// Asset detayi hook'u — secili id icin get_asset (metadata + etiketler). null = secim yok.
//
// `dataVersion`'a ABONE: dis kaynakli veri degisiklikleri (toplu "Proje durumu", toplu
// projeye-atama, geri-al/yinele, ingest, refile...) paneli de tazeler. Abonelik OLMADAN
// panel BAYAT kalirdi ve kullanici orada Kaydet'e bastiginda ProjectSection TUM alanlari
// yazdigi icin az once toplu atanan degerler SESSIZCE eski haline donerdi (lost-update).
// Ayni desen: src/features/dashboard/DashboardView.tsx:24,30.

import type { AssetDetail } from "../ipc/client";
import { ipc } from "../ipc/client";
import { useUiStore } from "../store/useUiStore";
import { useIpcQuery, type QueryResult } from "./useIpcQuery";

export function useAssetDetail(id: number | null): QueryResult<AssetDetail | null> {
  const dataVersion = useUiStore((s) => s.dataVersion);
  // LAN Faz 3: uzak arsivdeyken detay HOST'tan gelir.
  //
  // 🔑 NEDEN YONLENDIRME SART: `getAsset(id)` YEREL DB'yi okur, uzak satirlarin id'leri ise
  // HOST'un id'leridir ⇒ ayni numaraya denk gelen BASKA bir yerel dosyanin detayi gosterilirdi
  // (hata da vermeden). Faz 2'de bu yuzden panel tamamen kapatilmisti; Faz 3'te `/asset/{id}`
  // ucu acildigi icin panel GERI GELDI — ama yalnizca dogru kaynaktan okuyarak.
  const remote = useUiStore((s) => s.assetSource === "remote");
  return useIpcQuery<AssetDetail | null>(
    () => {
      if (id == null) return Promise.resolve(null);
      return remote ? ipc.remoteGetAsset(id) : ipc.getAsset(id);
    },
    // `remote` deps'te: kaynak degisince panel yeniden sorgular (bayat detay kalmaz).
    [id, dataVersion, remote],
  );
}
