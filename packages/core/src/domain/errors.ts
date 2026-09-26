/** 面向界面的稳定错误码：message 是人类可读兜底，code 供前端取词翻译 */
export type ErrorCode =
  | 'unknown'
  | 'recipe_kind_unknown'
  | 'recipe_name_required'
  | 'recipe_content_missing'
  | 'recipe_not_found'
  | 'recipe_template_conflict'
  | 'record_tool_required'
  | 'record_artifacts_required'
  | 'artifact_path_required'
  | 'artifact_media_type_unsupported'
  | 'prompt_must_be_text'
  | 'record_not_found'
  | 'file_not_found'
  | 'workflow_kind_mismatch'
  | 'workflow_json_invalid';

export const ERROR_CODES: ErrorCode[] = [
  'unknown',
  'recipe_kind_unknown',
  'recipe_name_required',
  'recipe_content_missing',
  'recipe_not_found',
  'recipe_template_conflict',
  'record_tool_required',
  'record_artifacts_required',
  'artifact_path_required',
  'artifact_media_type_unsupported',
  'prompt_must_be_text',
  'record_not_found',
  'file_not_found',
  'workflow_kind_mismatch',
  'workflow_json_invalid',
];

export class DomainError extends Error {
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode = 'unknown') {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
