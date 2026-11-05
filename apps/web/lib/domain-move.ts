/**
 * How access to a domain changes when it moves to another company, as the confirmation dialog says
 * it. Per-company permissions do not exist yet: every signed-in user sees every domain, whatever
 * its company, so a move never changes who can see it. When permissions arrive, this is the one
 * place that learns to say who gains or loses access; the dialog only renders the `kind` it
 * returns (`Companies.move.access.<kind>`).
 */
export function accessAfterMove(_move: {
  from: { id: string; name: string }
  to: { id: string; name: string }
}): { kind: 'unchanged' } {
  return { kind: 'unchanged' }
}
