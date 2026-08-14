// Detay paneli ortak satir bileseni — etiket/deger ciftleri (dt/dd).
// `dir` deger hucresine uygulanir: yol/hash gibi mantiken-LTR degerler RTL UI'da
// dahi soldan-saga okunur (kullanici cevirisi degil, makine verisi).

interface Props {
  label: string;
  value: string;
  /** Deger hucresinin yon yonergesi (yol/hash icin "ltr"). Varsayilan miras. */
  dir?: "ltr" | "rtl";
  /** Uzun degeri tek satira kirp + tam metni title olarak goster. */
  truncate?: boolean;
}

export function Field({ label, value, dir, truncate = false }: Props) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-text-muted">{label}</dt>
      <dd
        dir={dir}
        title={truncate ? value : undefined}
        className={
          truncate
            ? "min-w-0 truncate text-end text-text-secondary"
            : "break-all text-end text-text-secondary"
        }
      >
        {value}
      </dd>
    </div>
  );
}
