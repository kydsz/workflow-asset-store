'use server';

import { revalidatePath } from 'next/cache';
import { sniffSource } from '@was/core';
import { getWebApi } from '../src/webApi';
import { getServerT } from '@/lib/locale-server';
import { errorText } from '@/lib/locale';

export async function uploadIngest(formData: FormData) {
  const api = getWebApi();
  const result = await api.ingestUpload(formData);
  revalidatePath('/');
  return result;
}

export async function createManual(formData: FormData) {
  const api = getWebApi();
  const tool = String(formData.get('tool') ?? '').trim();
  const prompt = String(formData.get('prompt') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();
  const recipeId = String(formData.get('recipeId') ?? '').trim() || undefined;
  const t = await getServerT();
  const paths = String(formData.get('paths') ?? '')
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!tool || paths.length === 0) return { error: t('action.errToolAndPaths') };
  try {
    const rec = api.createManualRecord({ tool, prompt: prompt || undefined, note: note || undefined, recipeId, paths });
    revalidatePath('/');
    return { id: rec.id };
  } catch (e) {
    return { error: errorText(t, e) };
  }
}

export async function patchRecordAction(recordId: string, formData: FormData) {
  const api = getWebApi();
  const t = await getServerT();
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const patch = {
    tool: get('tool'),
    prompt: get('prompt'),
    note: get('note'),
    recipeId: get('recipeId'),
    resolve: formData.getAll('resolve').flatMap((v) => (typeof v === 'string' && v ? [v] : [])),
  };
  if (patch.recipeId && !patch.resolve.includes('recipe')) patch.resolve = [...patch.resolve, 'recipe'];
  try {
    api.patchRecord(recordId, patch);
  } catch {
    return { error: t('action.errRecordMissing') };
  }
  revalidatePath('/');
  revalidatePath(`/records/${recordId}`);
  return { ok: true };
}

export async function createRecipeAction(_prev: unknown, formData: FormData) {
  const api = getWebApi();
  const name = String(formData.get('name') ?? '').trim();
  const kind = String(formData.get('kind') ?? 'workflow-file') as 'workflow-file' | 'prompt-template' | 'param-preset';
  const tool = String(formData.get('tool') ?? '').trim() || undefined;
  const prompt = String(formData.get('prompt') ?? '').trim() || undefined;
  const paramsText = String(formData.get('params') ?? '').trim();
  const t = await getServerT();
  if (!name) return { error: t('action.errRecipeName') };
  let params: Record<string, unknown> | undefined;
  if (kind === 'param-preset') {
    try {
      params = JSON.parse(paramsText || '{}') as Record<string, unknown>;
    } catch {
      return { error: t('action.errParamsJson') };
    }
  }
  try {
    const file = formData.get('file');
    const hasFile = kind === 'workflow-file' && typeof File !== 'undefined' && file instanceof File && file.size > 0;
    let toolFinal = tool;
    if (hasFile && !toolFinal) {
      const buf = Buffer.from(await (file as File).arrayBuffer());
      if (sniffSource(buf, (file as File).name) === 'comfyui') toolFinal = 'comfyui';
    }
    const recipe = api.createRecipe({ name, kind, tool: toolFinal, prompt, params });
    if (hasFile) await api.attachWorkflowFile(recipe.id, file as File, (file as File).name);
    revalidatePath('/recipes');
    return { id: recipe.id };
  } catch (e) {
    return { error: errorText(t, e) };
  }
}

export async function attachWorkflowAction(recipeId: string, _prev: unknown, formData: FormData) {
  const api = getWebApi();
  const file = formData.get('file');
  const t = await getServerT();
  if (typeof File === 'undefined' || !(file instanceof File)) return { error: t('action.errChooseWorkflow') };
  try {
    await api.attachWorkflowFile(recipeId, file, file.name);
    revalidatePath(`/recipes/${recipeId}`);
    return { message: t('attach.done') };
  } catch (e) {
    return { error: errorText(t, e) };
  }
}

export async function duplicateRecipeAction(recipeId: string) {
  const api = getWebApi();
  const t = await getServerT();
  try {
    const copy = api.duplicateRecipe(recipeId);
    revalidatePath('/recipes');
    return { id: copy.id };
  } catch (e) {
    return { error: errorText(t, e) };
  }
}
