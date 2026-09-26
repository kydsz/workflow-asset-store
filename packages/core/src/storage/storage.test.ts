import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorage, type Storage } from './storage.js';

const root = join(tmpdir(), `was-storage-${process.pid}`);
const srcDir = join(root, 'src');
let storage: Storage;

beforeAll(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(srcDir, { recursive: true });
  storage = createStorage({ dataDir: join(root, 'data'), mode: 'copy' });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeSource(name: string, content: string): string {
  const p = join(srcDir, name);
  writeFileSync(p, content);
  return p;
}

const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

describe('copy 模式（ADR-0004 默认）', () => {
  it('文件复制进 data/files/，以内容哈希命名，返回绝对路径与相对路径', () => {
    const src = makeSource('a.txt', 'hello-a');
    const placed = storage.place(src);
    expect(placed.mode).toBe('copy');
    expect(placed.relativePath).toBe(`files/${sha256('hello-a')}.txt`);
    expect(readFileSync(placed.path, 'utf8')).toBe('hello-a');
    expect(placed.path).toContain(join('data', 'files'));
  });

  it('同内容重复安置不新增文件、返回同一目标', () => {
    const src1 = makeSource('b1.txt', 'hello-b');
    const src2 = makeSource('b2.txt', 'hello-b');
    const first = storage.place(src1);
    const second = storage.place(src2);
    expect(second.path).toBe(first.path);
    expect(storage.exists(first.contentHash)).toBe(true);
  });

  it('unknown 扩展名保留空后缀落库，不抛错', () => {
    const src = makeSource('mystery', 'no-extension');
    const placed = storage.place(src);
    expect(readFileSync(placed.path, 'utf8')).toBe('no-extension');
  });
});

describe('reference 模式', () => {
  it('不复制文件，路径即原路径', () => {
    const refStorage = createStorage({ dataDir: join(root, 'data-ref'), mode: 'reference' });
    const src = makeSource('c.txt', 'hello-c');
    const placed = refStorage.place(src);
    expect(placed.mode).toBe('reference');
    expect(placed.path).toBe(src);
    expect(placed.contentHash).toBe(sha256('hello-c'));
    expect(readFileSync(src, 'utf8')).toBe('hello-c');
    expect(rmSync(join(root, 'data-ref'), { recursive: true, force: true })).toBeUndefined();
  });
});
