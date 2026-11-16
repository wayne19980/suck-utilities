// QQ groups allowed to upload replays and to claim an overlay stream key.
// Read once from ALLOWED_QQ_GROUPS (comma separated).
export const ALLOWED_QQ_GROUPS = (process.env.ALLOWED_QQ_GROUPS || '460309159,1002072430')
  .split(',')
  .map((group) => group.trim())
  .filter(Boolean);

export function isAllowedQQGroup(value) {
  if (value === null || value === undefined) return false;
  return ALLOWED_QQ_GROUPS.includes(String(value).trim());
}
