import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import type { StorageMode } from '../domain/types.js';

export interface PlacedFile {
  /** copy 模式为库内绝对路径；reference 模式为原路径 */
  path: string;
  /** copy 模式为 data/ 下相对路径；reference 模式为 null */
  relativePath: string | null;
  mode: StorageMode;
  contentHash: string;
}

export interface Storage {
  readonly mode: StorageMode;
  /** ext 仅用于 copy 模式的落盘命名后缀（与源文件扩展名不同时需显式传入，如从 PNG 抽出的工作流 JSON） */
  place(srcPath: string, content?: Buffer, ext?: string): PlacedFile;
  exists(contentHash: string): boolean;
  stats(): { files: number; bytes: number };
}

const sha256hex = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

function toExt(nameOrPath: string): string {
  const ext = extname(nameOrPath).toLowerCase();
  const bare = ext || (nameOrPath.startsWith('.') ? nameOrPath.toLowerCase() : '');
  return /^[a-z0-9.]*$/.test(bare) ? bare : '';
}

export function createStorage(options: { dataDir: string; mode: StorageMode }): Storage {
  const filesDir = join(options.dataDir, 'files');
  mkdirSync(filesDir, { recursive: true });

  return {
    mode: options.mode,
    place(srcPath, content, ext) {
      const buf = content ?? readFileSync(srcPath);
      const contentHash = sha256hex(buf);
      if (options.mode === 'reference') {
        return { path: srcPath, relativePath: null, mode: 'reference', contentHash };
      }
      const name = `${contentHash}${toExt(ext ?? srcPath)}`;
      const dest = join(filesDir, name);
      if (content) {
        writeFileSync(dest, content);
      } else {
        copyFileSync(srcPath, dest);
      }
      return { path: dest, relativePath: relative(options.dataDir, dest).replaceAll('\\', '/'), mode: 'copy', contentHash };
    },
    exists(contentHash) {
      return readdirSync(filesDir).some((f) => f === contentHash || f.startsWith(`${contentHash}.`));
    },
    stats() {
      const names = readdirSync(filesDir);
      return { files: names.length, bytes: names.reduce((s, n) => s + statSync(join(filesDir, n)).size, 0) };
    },
  };
}
