import { cookies } from 'next/headers';
import { makeT, normalizeLocale, type Translate } from '@/lib/locale';

export async function getServerLocale() {
  const store = await cookies();
  return normalizeLocale(store.get('was-locale')?.value);
}

export async function getServerT(): Promise<Translate> {
  return makeT(await getServerLocale());
}
