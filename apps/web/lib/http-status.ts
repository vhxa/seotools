/** Only confirmed unreferenced automatic probes get a neutral absence badge. */
export function httpStatusVariant(status: number | null, automaticCheck = false) {
  if (automaticCheck && (status === 404 || status === 410)) return 'secondary'
  if (status === null || status >= 400) return 'destructive'
  return status >= 300 ? 'secondary' : 'outline'
}
