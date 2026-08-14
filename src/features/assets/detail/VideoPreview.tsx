import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "../../../ipc/client";

interface Props {
  assetId: number;
  fileName: string;
  poster: string | undefined;
}

/** Yerel video oynatici. Kaynak yol yalniz backend id-dogrulamasindan sonra asset URL'ye cevrilir. */
export function VideoPreview({ assetId, fileName, poster }: Props) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSource(null);
    setError(null);
    void ipc
      .prepareMediaSource(assetId)
      .then((path) => {
        if (active) setSource(convertFileSrc(path));
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [assetId]);

  if (error) {
    return (
      <div className="flex min-h-[12rem] flex-col items-center justify-center gap-2 rounded-lg border border-border bg-bg-primary/60 p-4 text-center">
        <span className="text-xs text-text-secondary">{t("detail.video_error")}</span>
        <span className="text-[10px] text-text-muted" title={error}>
          {t("detail.video_open_fallback")}
        </span>
      </div>
    );
  }

  if (!source) {
    return (
      <div
        role="status"
        className="flex min-h-[12rem] items-center justify-center rounded-lg border border-border bg-bg-primary/60 text-xs text-text-muted"
      >
        {t("detail.video_loading")}
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      src={source}
      poster={poster}
      controls
      preload="metadata"
      playsInline
      aria-label={t("detail.video_player", { name: fileName })}
      onError={() => setError("media_decode_failed")}
      className="max-h-[60vh] w-full rounded-lg border border-border bg-black object-contain"
    >
      {t("detail.video_unsupported")}
    </video>
  );
}
