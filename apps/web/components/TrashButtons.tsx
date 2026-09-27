'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eraser, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { emptyTrashAction, purgeTrashAction, restoreTrashAction, trashRecipeAction, trashRecordsAction, type ActionResult } from '@/app/actions';
import { useT } from '@/components/locale-provider';
import type { TKey } from '@/lib/locale';
import type { TrashKind } from '@/src/webApi';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

type Size = 'xs' | 'sm' | 'default' | 'icon-sm';
type Variant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive';

interface ButtonProps {
  kind: TrashKind;
  id: string;
  /** 动作完成后跳转；缺省为原地刷新 */
  redirectTo?: string;
  size?: Size;
  variant?: Variant;
  className?: string;
}

/** 服务端动作的统一执行：转圈、toast、跳转/刷新；动作本身不抛错，但网络层失败要能收场 */
function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<ActionResult>, done: string, fail: string, redirectTo?: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(done);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } catch (e) {
      toast.error(`${fail}：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** 二次确认弹窗：确认按钮执行期间保持打开并禁用 */
function Confirm({
  titleKey,
  descKey,
  confirmKey,
  danger,
  busy,
  onConfirm,
  children,
}: {
  titleKey: TKey;
  descKey: TKey;
  confirmKey: TKey;
  danger?: boolean;
  busy: boolean;
  onConfirm: () => Promise<void>;
  children: (open: boolean) => React.ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogTrigger asChild>{children(open)}</DialogTrigger>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t(titleKey)}</DialogTitle>
          <DialogDescription>{t(descKey)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
            {t('delete.cancel')}
          </Button>
          <Button variant={danger ? 'destructive' : 'default'} disabled={busy} onClick={async () => {
            await onConfirm();
            setOpen(false);
          }}>
            {t(confirmKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 移入回收站 */
export function TrashButton({ kind, id, redirectTo, size = 'sm', variant = 'outline', className }: ButtonProps) {
  const t = useT();
  const { busy, run } = useAction();
  return (
    <Confirm
      titleKey="delete.confirmTitle"
      descKey={kind === 'recipe' ? 'delete.recipeDesc' : 'delete.recordDesc'}
      confirmKey="delete.confirm"
      busy={busy}
      onConfirm={() => run(() => (kind === 'recipe' ? trashRecipeAction(id) : trashRecordsAction([id])), t('delete.done'), t('delete.failed'), redirectTo)}
    >
      {(open) => (
        <Button size={size} variant={variant} disabled={busy} aria-expanded={open} title={t('delete.action')} className={className}>
          <Trash2 data-icon="inline-start" />
          {size === 'icon-sm' ? null : t('delete.action')}
        </Button>
      )}
    </Confirm>
  );
}

/** 从回收站恢复：一步到位，不弹确认 */
export function RestoreButton({ kind, id, redirectTo, size = 'sm', variant = 'outline', className }: ButtonProps) {
  const t = useT();
  const { busy, run } = useAction();
  return (
    <Button
      size={size}
      variant={variant}
      disabled={busy}
      title={t('trash.restore')}
      className={className}
      onClick={() => run(() => restoreTrashAction(kind, id), t('trash.restored'), t('trash.restoreFailed'), redirectTo)}
    >
      <RotateCcw data-icon="inline-start" />
      {size === 'icon-sm' ? null : t('trash.restore')}
    </Button>
  );
}

/** 彻底删除：连同库内文件一起回收 */
export function PurgeButton({ kind, id, redirectTo, size = 'sm', variant = 'ghost', className }: ButtonProps) {
  const t = useT();
  const { busy, run } = useAction();
  return (
    <Confirm
      danger
      titleKey="trash.purgeConfirmTitle"
      descKey="trash.purgeConfirmDesc"
      confirmKey="trash.purge"
      busy={busy}
      onConfirm={() => run(() => purgeTrashAction(kind, id), t('trash.purged'), t('trash.purgeFailed'), redirectTo)}
    >
      {(open) => (
        <Button size={size} variant={variant} disabled={busy} aria-expanded={open} title={t('trash.purge')} className={className}>
          <Trash2 data-icon="inline-start" />
          {size === 'icon-sm' ? null : t('trash.purge')}
        </Button>
      )}
    </Confirm>
  );
}

export function EmptyTrashButton({ count }: { count: number }) {
  const t = useT();
  const { busy, run } = useAction();
  return (
    <Confirm
      danger
      titleKey="trash.emptyConfirmTitle"
      descKey="trash.purgeConfirmDesc"
      confirmKey="trash.empty"
      busy={busy}
      onConfirm={() => run(emptyTrashAction, t('trash.emptied'), t('trash.emptyFailed'))}
    >
      {(open) => (
        <Button variant="destructive" size="sm" disabled={busy || count === 0} aria-expanded={open}>
          <Eraser data-icon="inline-start" />
          {t('trash.empty')}
        </Button>
      )}
    </Confirm>
  );
}
