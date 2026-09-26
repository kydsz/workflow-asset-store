'use client';

import { useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { toast } from 'sonner';
import { attachWorkflowAction } from '@/app/actions';
import { useT } from '@/components/locale-provider';
import { Button } from '@/components/ui/button';

export function AttachWorkflowForm({ recipeId }: { recipeId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();

  const submit = async (file: File) => {
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file, file.name);
    const r = await attachWorkflowAction(recipeId, null, fd);
    setBusy(false);
    if (r.error) toast.error(r.error);
    else toast.success(r.message ?? t('attach.done'));
  };

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-dashed border-input px-4 py-3 transition-colors hover:bg-accent/40"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) void submit(f);
      }}
    >
      <FileUp className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 text-sm text-muted-foreground">
        {t('attach.hint')}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void submit(f);
          e.target.value = '';
        }}
      />
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? t('attach.uploading') : t('attach.choose')}
      </Button>
    </div>
  );
}
