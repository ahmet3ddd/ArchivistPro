/**
 * DB Export Worker — Uint8Array → number[] dönüşümünü ana thread'den bağımsız yapar.
 *
 * db.export() ana thread'de (WASM erişimi gerektirir), Array.from() bu worker'da.
 * Transferable ArrayBuffer ile zero-copy aktarım: ana thread kopyalamaz.
 */
self.onmessage = (e: MessageEvent<{ id: number; buf: ArrayBuffer }>) => {
    const { id, buf } = e.data;
    const arr = new Uint8Array(buf);
    const len = arr.length;
    const nums = new Array<number>(len);
    for (let i = 0; i < len; i++) nums[i] = arr[i];
    self.postMessage({ id, nums });
};
