import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/** Where uploaded files live. Local disk today; implement this interface for S3 or similar later. */
export interface FileStorage {
  /** Stores the bytes and returns an opaque key to keep in the database. */
  save(data: Buffer, ext: string): Promise<string>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalDiskStorage implements FileStorage {
  constructor(private dir: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.dir, key);
    if (!p.startsWith(path.resolve(this.dir) + path.sep)) throw new Error('Bad storage key');
    return p;
  }
  async save(data: Buffer, ext: string) {
    const key = `${randomUUID()}${ext}`;
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.resolve(key), data);
    return key;
  }
  read(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async delete(key: string) {
    await fs.unlink(this.resolve(key)).catch(() => undefined);
  }
}

export const storage: FileStorage = new LocalDiskStorage(process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads'));
