// BAKIM KAPISI — AI görsel analizi koşarken dosyanın YOLUNU ya da ÖNİZLEMESİNİ değiştiren
// (veya yazma kilidini uzun süre tutan) eylemleri kilitler. `RemoteWriteGate` ikizi: aynı desen
// (gizleme YOK → `fieldset disabled` + sebebi söyleyen ipucu), farklı sebep.
//
// NEDEN VAR (kullanıcı bulgusu 2026-08-20): koşu sırasında bu eylemler kullanılınca
//  · taşınan/yeniden adlandırılan dosyanın ~768px kaynak önizlemesi okunamaz olur → kod sessizce
//    256px thumbnail'e düşer (uyarısız, daha düşük kaliteli analiz),
//  · yeniden indeksleme analiz edilmekte olan dosyanın thumbnail'ini altından değiştirir,
//  · klasör TARAMASI (`ingest_folders`) yazma kilidini TÜM koşu boyunca tutar (STATUS B2) →
//    analiz döngüsü ilk kilit talebinde durur.
// Kilit ceza değil: koşu resumable → kullanıcı "İptal" deyip işini yapabilir, kalan iş bekler.
//
// ⚠️ Kapı YALNIZ UI'dır (RemoteWriteGate ile aynı sözleşme). Gerçek eşzamanlılık güvenliği
// backend'de: komutlar kilidi dosya-başı alır ve `VISION_ACTIVE` ikinci koşuyu reddeder.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useVisionRunState } from "../../hooks/useVisionLock";

export function MaintenanceGate({
  children,
  className = "flex items-center gap-2",
  alsoLocked = false,
}: {
  children: ReactNode;
  /** Sarmalayıcının yerleşim sınıfları — kilit açıkken de kapalıyken de AYNI (düzen kaymasın). */
  className?: string;
  /** Çağıranın kendi bildiği kilit sebebi (ör. koşuyu BU bileşen başlattı → yoklamayı bekleme).
   *  Yoklama ≤1 sn gecikebilir; kendi koşusunu bilen çağıran kapıyı anında kapatabilsin. */
  alsoLocked?: boolean;
}) {
  const { t } = useTranslation();
  const locked = useVisionRunState().active || alsoLocked;

  if (!locked) return <div className={className}>{children}</div>;

  return (
    <div title={t("vision_index.maintenance_locked")}>
      {/* fieldset varsayilan kenarlik/bosluklarini sifirla → gorsel olarak saf sarmalayici.
          Ipucu DIS div'de: disabled kontrol Chromium'da fare olayi almaz → tooltip cikmaz. */}
      <fieldset disabled className={`${className} m-0 border-0 p-0 opacity-40`}>
        {children}
      </fieldset>
    </div>
  );
}
