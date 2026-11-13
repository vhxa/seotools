import { isInternalUrl, renderRequestDecision } from '@seotools/core'
import type { Browser, BrowserContext, HTTPRequest } from 'puppeteer-core'
import { FetchError } from '../crawl/fetcher'
import { bestEffort } from './cleanup'
import { seedPageRandom } from './determinism'
import { renderRequestHeaders, renderResponseHeaders } from './headers'
import { addSample, oneLine, RENDER_LIMITS } from './limits'
import { RenderInterruptedError, type RenderInput, type RenderOutcome } from './types'

export async function renderPage(
  browser: Browser,
  input: RenderInput,
  ownedContext?: BrowserContext,
): Promise<RenderOutcome> {
  const started = Date.now()
  const waitMs = Math.max(
    0,
    Math.min(input.waitMs ?? RENDER_LIMITS.waitMs, RENDER_LIMITS.maxWaitMs),
  )
  const result: RenderOutcome = {
    status: 'rendered',
    settled: false,
    finalUrl: input.url,
    html: '',
    truncated: false,
    durationMs: 0,
    requests: {
      made: 0,
      cached: 0,
      failedCount: 0,
      omittedCount: 0,
      blockedByRobotsCount: 0,
      refusedCount: 0,
      failed: [],
      omitted: [],
      blockedByRobots: [],
      refused: [],
    },
    scriptErrors: { count: 0, first: [] },
  }
  const context = ownedContext ?? (await browser.createBrowserContext())
  const stop = new AbortController()
  const signal = AbortSignal.any([input.signal, stop.signal])
  let crashed = false
  let finished = false
  let inFlight = 0
  let lastActivity = started
  let requested = 0
  let bytes = input.document.body?.length ?? 0
  let resourceQueue = Promise.resolve()
  let requestBodyBytes = 0
  let supplied = false
  let redirected = false
  const pending = new Set<Promise<void>>()
  const fail = (code: NonNullable<RenderOutcome['failure']>['code'], message: string) => {
    result.status = 'failed'
    result.failure = { code, message }
  }
  try {
    const page = await context.newPage()
    const cdp = await page.createCDPSession()
    // No origin means every origin in this fresh context: unlisted permissions are denied.
    await cdp.send('Browser.grantPermissions', { permissions: [], browserContextId: context.id })
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'deny',
      browserContextId: context.id,
    })
    context.on('targetcreated', (target) => {
      if (target === page.target()) return
      void (async () => {
        const session = await target.createCDPSession()
        try {
          const { targetInfo } = await session.send('Target.getTargetInfo')
          if (targetInfo.type === 'iframe') return
          await cdp.send('Target.closeTarget', { targetId: targetInfo.targetId })
        } finally {
          await bestEffort(() => session.detach())
        }
      })().catch(() => {})
    })
    await page.setViewport({
      width: 412,
      height: 2400,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    })
    await page.setUserAgent({ userAgent: input.userAgent })
    await page.evaluateOnNewDocument(seedPageRandom, input.url)
    await page.setBypassServiceWorker(true)
    await page.setCacheEnabled(false)
    // Dedicated workers are page events and cannot be closed with Target.closeTarget.
    page.on('workercreated', (worker) => {
      void worker.close().catch(() => {})
    })
    page.on('dialog', (dialog) => void dialog.dismiss().catch(() => {}))
    let rejectInterrupted: (error: Error) => void = () => {}
    const interrupted = new Promise<never>((_resolve, reject) => {
      rejectInterrupted = reject
    })
    void interrupted.catch(() => {})
    const onDisconnect = () => rejectInterrupted(new RenderInterruptedError('Browser disconnected'))
    browser.once('disconnected', onDisconnect)
    page.on('close', () => browser.off('disconnected', onDisconnect))
    page.on('error', () => {
      crashed = true
      rejectInterrupted(new RenderInterruptedError('Page crashed'))
    })
    page.on('pageerror', (error) => {
      if (finished) return
      result.scriptErrors.count++
      if (result.scriptErrors.first.length < RENDER_LIMITS.scriptErrors) {
        result.scriptErrors.first.push(
          oneLine(error instanceof Error ? error.message : String(error)),
        )
      }
    })
    const omit = (url: string, reason: RenderOutcome['requests']['omitted'][number]['reason']) => {
      url = url.slice(0, RENDER_LIMITS.urlChars)
      result.requests.omittedCount++
      addSample(result.requests.omitted, { url, reason }, (value) => `${value.url} ${value.reason}`)
    }
    const handle = async (request: HTTPRequest) => {
      const url = request.url()
      const abort = () => request.abort('blockedbyclient').catch(() => {})
      if (finished || signal.aborted) return abort()
      requested++
      if (requested > RENDER_LIMITS.requests || bytes >= RENDER_LIMITS.pageBytes) {
        omit(url, 'limit')
        return abort()
      }
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        if (!supplied) {
          supplied = true
          return request.respond({
            status: input.document.statusCode,
            headers: renderResponseHeaders(input.document.headers),
            body: input.document.body ?? Buffer.alloc(0),
          })
        }
        // Keep the original document. The target is recorded, never fetched or rendered here.
        redirected = true
        result.finalUrl = url
        omit(url, 'redirect')
        return abort()
      }
      if (!['GET', 'HEAD', 'OPTIONS', 'POST'].includes(request.method())) {
        omit(url, 'method')
        return abort()
      }
      const resourceType =
        request.method() === 'OPTIONS' && request.headers()['access-control-request-method']
          ? 'preflight'
          : request.resourceType()
      const decision = renderRequestDecision({
        url,
        resourceType,
        trackedSite: isInternalUrl(url, input.host),
        allowedByRobots: input.allowedByRobots,
        extraOmittedHosts: input.extraOmittedHosts,
      })
      if (decision.action === 'robots') {
        result.requests.blockedByRobotsCount++
        addSample(
          result.requests.blockedByRobots,
          url.slice(0, RENDER_LIMITS.urlChars),
          (value) => value,
        )
        return abort()
      }
      if (decision.action !== 'fetch') {
        omit(url, decision.action === 'omit' ? decision.reason : 'scheme')
        return abort()
      }
      inFlight++
      lastActivity = Date.now()
      let release = () => {}
      const previous = resourceQueue
      resourceQueue = new Promise<void>((resolve) => {
        release = resolve
      })
      try {
        await previous
        if (signal.aborted) return abort()
        if (bytes >= RENDER_LIMITS.pageBytes) {
          omit(url, 'limit')
          return abort()
        }
        const postData = await request.content()
        requestBodyBytes += postData?.byteLength ?? 0
        if (
          (postData && postData.byteLength > RENDER_LIMITS.requestBodyBytes) ||
          requestBodyBytes > RENDER_LIMITS.pageRequestBodyBytes
        ) {
          omit(url, 'limit')
          return abort()
        }
        if (request.hasPostData() && postData === undefined) {
          result.requests.failedCount++
          addSample(
            result.requests.failed,
            { url: url.slice(0, RENDER_LIMITS.urlChars), code: 'BODY_UNAVAILABLE' },
            (value) => `${value.url} ${value.code}`,
          )
          return abort()
        }
        const { answer, cached } = await input.cache.request(
          url,
          request.method(),
          request.resourceType(),
          async () => {
            result.requests.made++
            return input.requester.fetchWithRetries(url, {
              signal,
              method: request.method(),
              headers: renderRequestHeaders(request.headers()),
              ...(postData === undefined ? {} : { body: Buffer.from(postData) }),
              readBody: 'force',
              maxBytes: RENDER_LIMITS.resourceBytes,
              beforeAttempt: () => {
                if (bytes >= RENDER_LIMITS.pageBytes)
                  throw new FetchError('BODY_LIMIT', 'Page byte budget exceeded')
              },
              onBodyBytes: (size) => {
                bytes += size
                const cacheable =
                  request.method() === 'GET' &&
                  ['script', 'stylesheet'].includes(request.resourceType())
                if (!cacheable && bytes > RENDER_LIMITS.pageBytes)
                  throw new FetchError('BODY_LIMIT', 'Page byte budget exceeded')
              },
            })
          },
        )
        if (finished || signal.aborted) return abort()
        if (cached) result.requests.cached++
        if (answer instanceof FetchError) {
          if (answer.code === 'BODY_LIMIT') {
            omit(url, 'limit')
            return abort()
          }
          if (answer.code === 'BLOCKED_ADDRESS') {
            result.requests.refusedCount++
            addSample(
              result.requests.refused,
              url.slice(0, RENDER_LIMITS.urlChars),
              (value) => value,
            )
          } else {
            result.requests.failedCount++
            addSample(
              result.requests.failed,
              { url: url.slice(0, RENDER_LIMITS.urlChars), code: answer.code },
              (value) => `${value.url} ${value.code}`,
            )
          }
          return abort()
        }
        const size = answer.body?.length ?? 0
        if (cached) bytes += size
        if (bytes > RENDER_LIMITS.pageBytes || answer.truncated) {
          omit(url, 'limit')
          return abort()
        }
        if (answer.statusCode >= 400) {
          result.requests.failedCount++
          addSample(
            result.requests.failed,
            { url: url.slice(0, RENDER_LIMITS.urlChars), code: `HTTP_${answer.statusCode}` },
            (value) => `${value.url} ${value.code}`,
          )
        }
        await request.respond({
          status: answer.statusCode,
          headers: renderResponseHeaders(answer.headers),
          body: answer.body ?? Buffer.alloc(0),
        })
      } catch {
        if (!finished && !signal.aborted) {
          result.requests.failedCount++
          addSample(
            result.requests.failed,
            { url: url.slice(0, RENDER_LIMITS.urlChars), code: 'REQUEST_FAILED' },
            (value) => `${value.url} ${value.code}`,
          )
        }
        await abort()
      } finally {
        release()
        inFlight--
        lastActivity = Date.now()
      }
    }
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      const work = handle(request).catch(() => {})
      pending.add(work)
      void work.finally(() => pending.delete(work))
    })
    try {
      await Promise.race([
        interrupted,
        page.goto(input.url, {
          waitUntil: 'load',
          timeout: waitMs + RENDER_LIMITS.loadGraceMs,
          signal,
        }),
      ])
    } catch (error) {
      if (!redirected)
        fail(
          error instanceof Error && error.name === 'TimeoutError' ? 'load-timeout' : 'navigation',
          'The document did not finish loading.',
        )
    }
    if (signal.aborted) throw new DOMException('Render stopped', 'AbortError')
    if (crashed || !browser.connected) throw new RenderInterruptedError('Browser or page crashed')
    const deadline = started + waitMs
    while (
      result.status === 'rendered' &&
      !redirected &&
      Date.now() < deadline &&
      !signal.aborted
    ) {
      if (inFlight === 0 && Date.now() - lastActivity >= RENDER_LIMITS.quietMs) {
        result.settled = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
      if (crashed || !browser.connected) throw new RenderInterruptedError('Browser or page crashed')
    }
    if (signal.aborted) throw new DOMException('Render stopped', 'AbortError')
    // Evaluate inside the browser; cap UTF-8 bytes there before sending the DOM over CDP.
    try {
      const serialize = async () => {
        const { frameTree } = await cdp.send('Page.getFrameTree')
        const { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
          frameId: frameTree.frame.id,
          worldName: 'seotools-serialization',
          grantUniveralAccess: false,
        })
        return cdp.send('Runtime.evaluate', {
          contextId: executionContextId,
          returnByValue: true,
          timeout: RENDER_LIMITS.waitMs,
          expression: `(() => {
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
          truncated: bytes.length > ${RENDER_LIMITS.domBytes} };
      })()`,
        })
      }
      const serialized = await Promise.race([interrupted, serialize()])
      const dom: unknown = serialized.result.value
      if (
        serialized.exceptionDetails ||
        !dom ||
        typeof dom !== 'object' ||
        !('html' in dom) ||
        typeof dom.html !== 'string' ||
        !('truncated' in dom) ||
        typeof dom.truncated !== 'boolean'
      )
        throw new Error('Invalid DOM snapshot')
      result.html = dom.html
      result.truncated = dom.truncated
    } catch {
      if (crashed || !browser.connected) throw new RenderInterruptedError('Browser or page crashed')
      fail('serialization', 'The document could not be serialized.')
    }
    return result
  } catch (error) {
    if (crashed || !browser.connected) throw new RenderInterruptedError('Browser or page crashed')
    throw error
  } finally {
    finished = true
    stop.abort()
    await bestEffort(() => context.close())
    // Every resource uses our abort signal, so all requester waits and requests now stop.
    await Promise.allSettled([...pending])
    result.scriptErrors.first.sort()
    result.durationMs = Date.now() - started
  }
}
