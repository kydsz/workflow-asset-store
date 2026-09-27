'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { renameRecipeAction } from '@/app/actions';
import { useT } from '@/components/locale-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function RenameRecipeButton({ recipeId, currentName }: { recipeId: string; currentName: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = useT();

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    const r = await renameRecipeAction(recipeId, null, fd);
    setBusy(false);
    if (r.error) {
      toast.error(r.error);
      return;
    }
    toast.success(t('rename.done'));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil data-icon="inline-start" />
          {t('rename.action')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('rename.title')}</DialogTitle>
          <DialogDescription>{t('rename.desc')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="rename-name">{t('rename.name')}</Label>
            <Input id="rename-name" name="name" defaultValue={currentName} required />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? t('rename.saving') : t('rename.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
