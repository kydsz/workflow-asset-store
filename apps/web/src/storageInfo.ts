import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ASSET_DATA_DIR_ENV, locateConfigFile, readConfiguredDataDir, writeStorageConfig } from '@was/core';
import { getWebApi } from './webApi';
import type { TKey } from '@/lib/locale';

const DB_NAME = 'asset-store.db';
const hasLibrary = (dir: string) => existsSync(join(dir, DB_NAME));

export interface StorageInfo {
  /** 当前进程正在用的数据目录 */
  activeDir: string;
  /** 读写配置的文件位置（可能尚不存在） */
  configFile: string;
  /** 环境变量给的值；非空时它会盖过配置文件 */
  envValue: string | null;
  /** 配置文件里保存的目录 */
  configuredDir: string | null;
  /** 已保存但尚未生效的目录（与 activeDir 不同，重启后才切换） */
  pendingDir: string | null;
  /** 待生效目录里是否已有 SQLite 库；没有则重启后是空库 */
  pendingHasDb: boolean;
}

export function getStorageInfo(): StorageInfo {
  const activeDir = getWebApi().dataDir;
  const configFile = locateConfigFile();
  const configuredDir = readConfiguredDataDir(configFile);
  const pendingDir = configuredDir && configuredDir !== activeDir ? configuredDir : null;
  return {
    activeDir,
    configFile,
    envValue: process.env[ASSET_DATA_DIR_ENV]?.trim() || null,
    configuredDir,
    pendingDir,
    pendingHasDb: pendingDir ? hasLibrary(pendingDir) : false,
  };
}

export type SaveStorageResult =
  | { ok: true; pendingDir: string; configFile: string; targetHasDb: boolean }
  | { ok: false; errorKey: TKey; detail?: string };

/** 只写配置文件，不动任何数据：新目录在下一次启动时才被 createLibrary 打开 */
export function saveStorageDir(input: string): SaveStorageResult {
  const value = input.trim();
  if (!value) return { ok: false, errorKey: 'settings.storage.errEmpty' };
  const target = resolve(process.cwd(), value);
  if (existsSync(target) && !statSync(target).isDirectory()) return { ok: false, errorKey: 'settings.storage.errIsFile' };
  const configFile = locateConfigFile();
  try {
    mkdirSync(target, { recursive: true });
    writeStorageConfig(configFile, target);
  } catch (e) {
    return { ok: false, errorKey: 'settings.storage.errWrite', detail: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, pendingDir: target, configFile, targetHasDb: hasLibrary(target) };
}
