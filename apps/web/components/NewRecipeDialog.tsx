'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { createRecipeAction } from '@/app/actions';
import { useT } from '@/components/locale-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToolSelect } from '@/components/ToolSelect';

export function NewRecipeDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('workflow-file');
  const [tool, setTool] = useState('');
  const [busy, start] = useTransition();
  const t = useT();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await createRecipeAction(null, fd);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(t('recipeForm.created'));
      setOpen(false);
      router.push(`/recipes/${r.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          {t('recipes.new')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('recipes.new')}</DialogTitle>
          <DialogDescription>{t('recipeForm.desc')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="rc-name">{t('recipeForm.name')}</Label>
            <Input id="rc-name" name="name" placeholder={t('recipeForm.namePlaceholder')} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>{t('recipeForm.kind')}</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="workflow-file">{t('recipeForm.kindWorkflow')}</SelectItem>
                  <SelectItem value="prompt-template">{t('recipeForm.kindPrompt')}</SelectItem>
                  <SelectItem value="param-preset">{t('recipeForm.kindParams')}</SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="kind" value={kind} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rc-tool">
                {t('recipeForm.tool')} {t('common.optional')}
              </Label>
              <ToolSelect id="rc-tool" name="tool" value={tool} onChange={setTool} optional />
            </div>
          </div>
          {kind === 'prompt-template' ? (
            <div className="grid gap-2">
              <Label htmlFor="rc-prompt">{t('recipe.promptTemplate')}</Label>
              <Textarea id="rc-prompt" name="prompt" rows={4} placeholder="a cat astronaut, {style} light" required />
            </div>
          ) : kind === 'param-preset' ? (
            <div className="grid gap-2">
              <Label htmlFor="rc-params">{t('recipeForm.paramsJson')}</Label>
              <Textarea id="rc-params" name="params" rows={4} placeholder='{"steps": 30, "cfg": 4.5}' required />
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="rc-file">{t('recipeForm.workflowFile')}</Label>
              <Input id="rc-file" name="file" type="file" accept=".json,application/json" className="file:mr-2 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm" />
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? t('recipeForm.creating') : t('recipeForm.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
