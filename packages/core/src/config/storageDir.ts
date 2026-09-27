import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const ASSET_DATA_DIR_ENV = 'ASSET_DATA_DIR';
export const DEFAULT_DATA_DIR = 'data';
export const STORAGE_CONFIG_FILE = 'was-storage.json';

export type DataDirSource = 'env' | 'config' | 'default';

export interface StorageConfig {
  dataDir: string;
}

export interface ResolvedDataDir {
  /** 绝对路径 */
  dataDir: string;
  source: DataDirSource;
  /** 读写配置文件的目标路径（未必已存在） */
  configFile: string;
}

/**
 * 从 cwd 逐级向上找第一个 was-storage.json；找不到就以 cwd 下的路径作为写入目标。
 * 向上查找让 Web（cwd=apps/web）与 MCP 从仓库根或子目录启动时读到同一份配置。
 */
export function locateConfigFile(cwd = process.cwd()): string {
  const from = resolve(cwd);
  let dir = from;
  for (;;) {
    const candidate = join(dir, STORAGE_CONFIG_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return join(from, STORAGE_CONFIG_FILE);
    dir = parent;
  }
}

/** 读不到、JSON 不合法或 dataDir 为空都按未配置处理 */
export function readStorageConfig(configFile: string): StorageConfig | null {
  try {
    const raw = JSON.parse(readFileSync(configFile, 'utf8')) as Partial<StorageConfig> | null;
    const dir = raw?.dataDir;
    return typeof dir === 'string' && dir.trim() ? { dataDir: dir.trim() } : null;
  } catch {
    return null;
  }
}

export function writeStorageConfig(configFile: string, dataDir: string): void {
  mkdirSync(dirname(configFile), { recursive: true });
  writeFileSync(configFile, `${JSON.stringify({ dataDir } satisfies StorageConfig, null, 2)}\n`, 'utf8');
}

/** 配置文件里保存的数据目录（绝对）；未配置或值非法为 null */
export function readConfiguredDataDir(configFile: string): string | null {
  const value = readStorageConfig(configFile)?.dataDir;
  // 配置文件的相对值按文件所在目录解析，父级配置不会因启动目录不同而指向别处
  return value ? resolve(dirname(configFile), value) : null;
}

/**
 * 环境变量 > 配置文件 > 默认 ./data。
 * 环境变量的相对值按 cwd 解析（与 README 的备份口径一致），配置文件的相对值按该文件所在目录解析。
 */
export function resolveDataDir(opts: { cwd?: string; env?: Record<string, string | undefined> } = {}): ResolvedDataDir {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const env = opts.env ?? process.env;
  const configFile = locateConfigFile(cwd);
  const fromEnv = env[ASSET_DATA_DIR_ENV]?.trim();
  if (fromEnv) return { dataDir: resolve(cwd, fromEnv), source: 'env', configFile };
  const fromConfig = readConfiguredDataDir(configFile);
  if (fromConfig) return { dataDir: fromConfig, source: 'config', configFile };
  return { dataDir: resolve(cwd, DEFAULT_DATA_DIR), source: 'default', configFile };
}
