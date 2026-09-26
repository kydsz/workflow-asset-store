'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CopyPlus } from 'lucide-react';
import { toast } from 'sonner';
import { duplicateRecipeAction } from '@/app/actions';
import { useT } from '@/components/locale-provider';
import { Button } from '@/components/ui/button';

export function DuplicateRecipeButton({ recipeId }: { recipeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const t = useT();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await duplicateRecipeAction(recipeId);
        setBusy(false);
        if (r.id) {
          toast.success(t('dup.duplicated'));
          router.push(`/recipes/${r.id}`);
        } else toast.error(r.error ?? t('dup.failed'));
      }}
    >
      <CopyPlus data-icon="inline-start" />
      {t('dup.duplicate')}
    </Button>
  );
}
