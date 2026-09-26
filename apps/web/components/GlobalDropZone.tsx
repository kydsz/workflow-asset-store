'use client';

import { useEffect, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { ingestFilesToLibrary } from '@/lib/upload';
import { useT } from '@/components/locale-provider';

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

export function GlobalDropZone() {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const depth = useRef(0);
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      if (depth.current === 1) setActive(true);
    };
    const onLeave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      setBusy(true);
      void ingestFilesToLibrary(files, tRef.current).finally(() => setBusy(false));
    };
    for (const [ev, fn] of [['dragenter', onEnter], ['dragleave', onLeave], ['dragover', onOver], ['drop', onDrop]] as const) {
      window.addEventListener(ev, fn);
    }
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (!active && !busy) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-dashed border-primary/70 bg-card/90 px-16 py-12 text-center shadow-2xl">
        <UploadCloud className="size-10 animate-pulse text-primary" />
        <div className="text-lg font-medium">{busy ? t('dropzone.busy') : t('dropzone.title')}</div>
        <div className="text-sm text-muted-foreground">{t('dropzone.hint')}</div>
      </div>
    </div>
  );
}
