import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  locateConfigFile,
  readConfiguredDataDir,
  readStorageConfig,
  resolveDataDir,
  writeStorageConfig,
  STORAGE_CONFIG_FILE,
} from './storageDir.js';

const root = join(tmpdir(), `was-storage-dir-${process.pid}`);
const cwd = join(root, 'apps', 'web');

describe('resolveDataDir', () => {
  beforeAll(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(cwd, { recursive: true });
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('都没有时回落 cwd/data', () => {
    const r = resolveDataDir({ cwd, env: {} });
    expect(r.configFile).toBe(join(cwd, STORAGE_CONFIG_FILE));
    expect(r.dataDir).toBe(resolve(cwd, 'data'));
    expect(r.source).toBe('default');
  });

  it('环境变量优先，相对值按 cwd 解析', () => {
    const r = resolveDataDir({ cwd, env: { ASSET_DATA_DIR: 'custom' } });
    expect(r.dataDir).toBe(resolve(cwd, 'custom'));
    expect(r.source).toBe('env');
  });

  it('配置文件可自父级目录向下命中，相对值按配置文件所在目录解析', () => {
    writeStorageConfig(join(root, STORAGE_CONFIG_FILE), 'shared-data');
    const r = resolveDataDir({ cwd, env: {} });
    expect(r.configFile).toBe(join(root, STORAGE_CONFIG_FILE));
    expect(r.dataDir).toBe(resolve(root, 'shared-data'));
    expect(r.source).toBe('config');
  });

  it('环境变量盖过配置文件', () => {
    const r = resolveDataDir({ cwd, env: { ASSET_DATA_DIR: resolve(root, 'from-env') } });
    expect(r.dataDir).toBe(resolve(root, 'from-env'));
    expect(r.source).toBe('env');
    // 被遮住时配置文件里的值仍可单独读出，供界面提示「待生效」
    expect(readConfiguredDataDir(r.configFile)).toBe(resolve(root, 'shared-data'));
  });

  it('配置文件写绝对路径时原样采用', () => {
    const target = resolve('D:/was-data');
    writeStorageConfig(join(root, STORAGE_CONFIG_FILE), target);
    expect(resolveDataDir({ cwd, env: {} }).dataDir).toBe(target);
  });

  it('坏 JSON 与空 dataDir 都按未配置处理', () => {
    const f = join(root, STORAGE_CONFIG_FILE);
    writeFileSync(f, '{ not json');
    expect(readStorageConfig(f)).toBeNull();
    writeFileSync(f, JSON.stringify({ dataDir: '  ' }));
    expect(readStorageConfig(f)).toBeNull();
    expect(resolveDataDir({ cwd, env: {} }).source).toBe('default');
  });

  it('配置文件是带缩进的 JSON，便于手改', () => {
    const f = join(cwd, STORAGE_CONFIG_FILE);
    writeStorageConfig(f, 'D:/was-data');
    expect(readFileSync(f, 'utf8')).toContain('\n  "dataDir": "D:/was-data"');
    expect(locateConfigFile(cwd)).toBe(f);
  });
});
