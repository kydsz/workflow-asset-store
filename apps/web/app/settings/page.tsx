import type { Metadata } from 'next';
import { getServerT } from '@/lib/locale-server';
import { getStorageInfo } from '@/src/storageInfo';
import { SettingsPanel } from '@/components/SettingsPanel';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t('nav.settings') };
}

export default async function SettingsPage() {
  const t = await getServerT();
  return (
    <>
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.desc')}</p>
      </div>
      <SettingsPanel storage={getStorageInfo()} />
    </>
  );
}
