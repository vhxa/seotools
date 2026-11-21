import { RENDER_LIMITS } from './limits'

/** Installed before page scripts, in the same isolated world that serializes the DOM. */
export const observeDocument = `(() => {
  let leaving;
  navigation.addEventListener('navigate', event => {
    if (event.isTrusted && (event.navigationType === 'reload' || !event.destination.sameDocument))
      leaving = event;
  });

  const scriptFailures = new Map();
  let overflow = false;
  const record = (url, code) => {
    if (url.length > ${RENDER_LIMITS.urlChars} ||
        (!scriptFailures.has(url) && scriptFailures.size >= ${RENDER_LIMITS.requests})) {
      overflow = true;
      return;
    }
    if (code === 'SCRIPT_BLOCKED_BY_CSP' || !scriptFailures.has(url)) scriptFailures.set(url, code);
  };
  addEventListener('error', event => {
    if (!event.isTrusted) return;
    // An inline module whose import the browser rejects has no src of its own: it still failed.
    if (event.target instanceof HTMLScriptElement)
      record(event.target.src || location.href, 'SCRIPT_LOAD_FAILED');
  }, true);
  addEventListener('securitypolicyviolation', event => {
    if (!event.isTrusted || event.disposition !== 'enforce' ||
        !/^script-src(?:-attr|-elem)?$/.test(event.effectiveDirective)) return;
    const url = /^(?:https?):/.test(event.blockedURI) ? event.blockedURI : location.href;
    record(url, 'SCRIPT_BLOCKED_BY_CSP');
  }, true);

  globalThis.seotoolsDocumentState = () => ({
    // A canceled navigation or a Navigation API interception retains the original document.
    leaving: leaving && !leaving.defaultPrevented && !leaving.signal.aborted && !navigation.transition
      ? leaving.destination.url : null,
    scriptFailures: [...scriptFailures].map(([url, code]) => ({ url, code })),
    overflow,
  });
})()`

export function serializeDocument(cutoffMs: number): string {
  return `(async () => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const parsedAt = navigation?.domContentLoadedEventEnd || null;
    const elapsed = () => parsedAt === null ? null : performance.now() - parsedAt;
    const cutoff = ${cutoffMs};
    let afterMs = elapsed();
    while (afterMs !== null && afterMs < cutoff) {
      await new Promise(resolve => setTimeout(resolve, cutoff - afterMs));
      afterMs = elapsed();
    }
    const url = location.href;
    const state = globalThis.seotoolsDocumentState();
    const roots = [];
    const visit = root => { for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) { roots.push(element.shadowRoot); visit(element.shadowRoot); }
    }};
    visit(document);
    const text = '<!DOCTYPE html><html' + [...document.documentElement.attributes].map(a =>
      ' ' + a.name + '="' + a.value.replaceAll('&', '&amp;').replaceAll('"', '&quot;') + '"').join('') +
      '>' + document.documentElement.getHTML({ shadowRoots: roots }) + '</html>';
    const bytes = new TextEncoder().encode(text);
    return { html: new TextDecoder().decode(bytes.slice(0, ${RENDER_LIMITS.domBytes}), { stream: true }),
      truncated: bytes.length > ${RENDER_LIMITS.domBytes}, afterMs, url, ...state };
  })()`
}

export function isScriptFailure(value: unknown): value is { url: string; code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'url' in value &&
    typeof value.url === 'string' &&
    'code' in value &&
    typeof value.code === 'string'
  )
}
