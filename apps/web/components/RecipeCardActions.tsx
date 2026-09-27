'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CopyPlus, Download } from 'lucide-react';
import { toast } from 'sonner';
import { duplicateRecipeAction } from '@/app/actions';
import { useT } from '@/components/locale-provider';
import { Button } from '@/components/ui/button';
import { TrashButton } from '@/components/TrashButtons';

export function RecipeCardActions({ recipe }: { recipe: { id: string; kind: string; workflowFilePath?: string | null } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const t = useT();
  return (
    <div className="flex items-center gap-1">
      {recipe.kind === 'workflow-file' && recipe.workflowFilePath ? (
        <Button asChild size="xs" variant="ghost" title={t('dup.exportTitle')}>
          <a href={`/api/recipes/${recipe.id}/workflow`} download>
            <Download data-icon="inline-start" />
            {t('dup.export')}
          </a>
        </Button>
      ) : null}
      <Button
        size="xs"
        variant="ghost"
        disabled={busy}
        title={t('dup.duplicate')}
        onClick={async () => {
          setBusy(true);
          const r = await duplicateRecipeAction(recipe.id);
          setBusy(false);
          if (r.id) {
            toast.success(t('dup.duplicated'));
            router.push(`/recipes/${r.id}`);
          } else toast.error(r.error ?? t('dup.failed'));
        }}
      >
        <CopyPlus data-icon="inline-start" />
        {t('dup.copy')}
      </Button>
      <TrashButton kind="recipe" id={recipe.id} size="xs" variant="ghost" />
    </div>
  );
}
