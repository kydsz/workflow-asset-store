'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud, X, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ingestFilesToLibrary } from '@/lib/upload';
import { createManual } from '@/app/actions';
import { toast } from 'sonner';
import { useT } from '@/components/locale-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const NONE = '__none__';

function DropArea({ files, setFiles }: { files: File[]; setFiles: (f: File[]) => void }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useT();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        setFiles(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-10 text-center transition-colors cursor-pointer',
        over ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent/40',
      )}
    >
      <UploadCloud className="size-6 text-muted-foreground" />
      <div className="text-sm">{t('upload.dropHint')}</div>
      <div className="text-xs text-muted-foreground">{t('upload.dropSub')}</div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".png,.json,.mp4,.webp,.jpg,.jpeg,.mov,.webm"
        className="hidden"
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
      />
    </div>
  );
}

export function UploadDialog({ recipes }: { recipes: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [recipeId, setRecipeId] = useState(NONE);
  const [tool, setTool] = useState('');
  const [prompt, setPrompt] = useState('');
  const [pending, start] = useTransition();
  const t = useT();

  const submitUpload = () =>
    start(async () => {
      const ids = await ingestFilesToLibrary(files, t, { recipeId: recipeId === NONE ? undefined : recipeId, tool, prompt });
      if (ids) {
        setFiles([]);
        setTool('');
        setPrompt('');
        setOpen(false);
        router.refresh();
      }
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full">
          <UploadCloud data-icon="inline-start" />
          {t('upload.title')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('upload.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('upload.dialogDesc')}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="upload">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload">{t('upload.tabFiles')}</TabsTrigger>
            <TabsTrigger value="manual">{t('upload.tabManual')}</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="flex flex-col gap-4">
            <DropArea files={files} setFiles={setFiles} />
            {files.length ? (
              <div className="flex flex-wrap gap-1.5">
                {files.map((f, i) => (
                  <span key={i} className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs">
                    <span className="min-w-0 break-all">{f.name}</span>
                    <button type="button" aria-label={`${t('upload.removeFile')} ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                      <X className="size-3 text-muted-foreground" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="grid min-w-0 gap-2">
              <Label>
                {t('upload.linkRecipe')} {t('common.optional')}
              </Label>
              <Select value={recipeId} onValueChange={setRecipeId}>
                <SelectTrigger className="w-full min-w-0">
                  <SelectValue placeholder={t('upload.noLinkAuto')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('upload.noLinkAuto')}</SelectItem>
                  {recipes.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <div className="grid min-w-0 gap-2">
                <Label htmlFor="up-tool">
                  {t('common.tool')} {t('common.optional')}
                </Label>
                <Input id="up-tool" value={tool} onChange={(e) => setTool(e.target.value)} placeholder={t('upload.toolPlaceholder')} />
              </div>
              <div className="grid min-w-0 gap-2">
                <Label htmlFor="up-prompt">
                  {t('upload.promptOverride')} {t('common.optional')}
                </Label>
                <Input id="up-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('upload.promptOverridePlaceholder')} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={submitUpload} disabled={pending || !files.length}>
                {pending ? t('upload.submitting') : `${t('upload.submit')} ${files.length ? t('upload.fileCount', files.length) : ''}`.trim()}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="manual" className="flex flex-col gap-4">
            <ManualTab recipes={recipes} onDone={() => setOpen(false)} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function ManualTab({ recipes, onDone }: { recipes: { id: string; name: string }[]; onDone: () => void }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [recipeId, setRecipeId] = useState(NONE);
  const t = useT();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (recipeId !== NONE) fd.set('recipeId', recipeId);
    else fd.delete('recipeId');
    start(async () => {
      const r = await createManual(fd);
      if (r.error) {
        toast.error(t('toast.saveFailed', r.error));
        return;
      }
      toast.success(t('toast.createdView'), { action: { label: t('common.viewRecord'), onClick: () => window.location.assign(`/records/${r.id}`) } });
      onDone();
      router.refresh();
    });
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor="mn-tool">{t('common.tool')}</Label>
          <Input id="mn-tool" name="tool" placeholder={t('upload.manualToolPlaceholder')} required />
        </div>
        <div className="grid min-w-0 gap-2">
          <Label>
            {t('upload.linkRecipe')} {t('common.optional')}
          </Label>
          <Select value={recipeId} onValueChange={setRecipeId}>
            <SelectTrigger className="w-full min-w-0">
              <SelectValue placeholder={t('upload.noLink')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('upload.noLink')}</SelectItem>
              {recipes.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="mn-prompt">
          {t('upload.manualPrompt')} {t('common.optional')}
        </Label>
        <Input id="mn-prompt" name="prompt" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="mn-note">
          {t('upload.manualNote')} {t('common.optional')}
        </Label>
        <Input id="mn-note" name="note" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="mn-paths">{t('upload.paths')}</Label>
        <Textarea id="mn-paths" name="paths" rows={4} placeholder={'D:\\renders\\a.png'} required />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          <ClipboardList data-icon="inline-start" />
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
