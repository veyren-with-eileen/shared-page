import type { PlacedItem, StickerLibraryItem } from "../domain/scrapbook";

export const SCRAPBOOK_DB_NAME = "shared-page-scrapbook";
export const SCRAPBOOK_DB_VERSION = 1;

export interface ScrapbookSnapshotData {
  placements: PlacedItem[];
  stickers: StickerLibraryItem[];
  blobs: Map<string, Blob>;
}

export interface ScrapbookRepository {
  load(): Promise<ScrapbookSnapshotData>;
  putPlacement(item: PlacedItem): Promise<void>;
  putPhoto(item: PlacedItem, key: string, blob: Blob): Promise<void>;
  removePlacement(item: PlacedItem, removePhotoBlob: boolean): Promise<void>;
  putSticker(item: StickerLibraryItem, key: string, blob: Blob): Promise<void>;
  removeSticker(item: StickerLibraryItem, placementIds: string[]): Promise<void>;
}

interface StoredBlob { key: string; blob: Blob }

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export class IndexedDbScrapbookRepository implements ScrapbookRepository {
  private database?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open(SCRAPBOOK_DB_NAME, SCRAPBOOK_DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("placements")) {
            const placements = database.createObjectStore("placements", { keyPath: "id" });
            placements.createIndex("dayKey", "dayKey", { unique: false });
          }
          if (!database.objectStoreNames.contains("stickers")) {
            database.createObjectStore("stickers", { keyPath: "id" });
          }
          if (!database.objectStoreNames.contains("blobs")) {
            database.createObjectStore("blobs", { keyPath: "key" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Could not open scrapbook storage"));
        request.onblocked = () => reject(new Error("Scrapbook storage upgrade is blocked"));
      });
    }
    return this.database;
  }

  async load(): Promise<ScrapbookSnapshotData> {
    const database = await this.open();
    const transaction = database.transaction(["placements", "stickers", "blobs"], "readonly");
    const placements = requestResult(transaction.objectStore("placements").getAll() as IDBRequest<PlacedItem[]>);
    const stickers = requestResult(transaction.objectStore("stickers").getAll() as IDBRequest<StickerLibraryItem[]>);
    const storedBlobs = requestResult(transaction.objectStore("blobs").getAll() as IDBRequest<StoredBlob[]>);
    const done = transactionDone(transaction);
    const [placed, library, blobs] = await Promise.all([placements, stickers, storedBlobs]);
    await done;
    return { placements: placed, stickers: library, blobs: new Map(blobs.map((item) => [item.key, item.blob])) };
  }

  async putPlacement(item: PlacedItem): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction("placements", "readwrite");
    transaction.objectStore("placements").put(item);
    await transactionDone(transaction);
  }

  async putPhoto(item: PlacedItem, key: string, blob: Blob): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(["placements", "blobs"], "readwrite");
    transaction.objectStore("blobs").put({ key, blob } satisfies StoredBlob);
    transaction.objectStore("placements").put(item);
    await transactionDone(transaction);
  }

  async removePlacement(item: PlacedItem, removePhotoBlob: boolean): Promise<void> {
    const database = await this.open();
    const stores = removePhotoBlob ? ["placements", "blobs"] : ["placements"];
    const transaction = database.transaction(stores, "readwrite");
    transaction.objectStore("placements").delete(item.id);
    if (removePhotoBlob && item.photoKey) transaction.objectStore("blobs").delete(item.photoKey);
    await transactionDone(transaction);
  }

  async putSticker(item: StickerLibraryItem, key: string, blob: Blob): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(["stickers", "blobs"], "readwrite");
    transaction.objectStore("blobs").put({ key, blob } satisfies StoredBlob);
    transaction.objectStore("stickers").put(item);
    await transactionDone(transaction);
  }

  async removeSticker(item: StickerLibraryItem, placementIds: string[]): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(["placements", "stickers", "blobs"], "readwrite");
    const placements = transaction.objectStore("placements");
    for (const id of placementIds) placements.delete(id);
    transaction.objectStore("stickers").delete(item.id);
    if (item.blobKey) transaction.objectStore("blobs").delete(item.blobKey);
    await transactionDone(transaction);
  }
}

export class MemoryScrapbookRepository implements ScrapbookRepository {
  placements = new Map<string, PlacedItem>();
  stickers = new Map<string, StickerLibraryItem>();
  blobs = new Map<string, Blob>();
  failReads = false;
  failWrites = false;

  async load(): Promise<ScrapbookSnapshotData> {
    if (this.failReads) throw new Error("read failed");
    return {
      placements: [...this.placements.values()].map((item) => ({ ...item })),
      stickers: [...this.stickers.values()].map((item) => ({ ...item })),
      blobs: new Map(this.blobs)
    };
  }

  private writable() { if (this.failWrites) throw new Error("write failed"); }

  async putPlacement(item: PlacedItem): Promise<void> {
    this.writable();
    this.placements.set(item.id, { ...item });
  }

  async putPhoto(item: PlacedItem, key: string, blob: Blob): Promise<void> {
    this.writable();
    this.blobs.set(key, blob);
    this.placements.set(item.id, { ...item });
  }

  async removePlacement(item: PlacedItem, removePhotoBlob: boolean): Promise<void> {
    this.writable();
    this.placements.delete(item.id);
    if (removePhotoBlob && item.photoKey) this.blobs.delete(item.photoKey);
  }

  async putSticker(item: StickerLibraryItem, key: string, blob: Blob): Promise<void> {
    this.writable();
    this.blobs.set(key, blob);
    this.stickers.set(item.id, { ...item });
  }

  async removeSticker(item: StickerLibraryItem, placementIds: string[]): Promise<void> {
    this.writable();
    for (const id of placementIds) this.placements.delete(id);
    this.stickers.delete(item.id);
    if (item.blobKey) this.blobs.delete(item.blobKey);
  }
}
