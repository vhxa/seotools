import {
  isInternalUrl,
  normalizeCrawlUrl,
  renderOmittedEndpoint,
  renderRequestDecision,
  stripIgnoredParameters,
} from '@seotools/core'
import { CAPTURE_DELAY_TOLERANCE_MS } from '@seotools/core/crawl/render-state'
import type { Browser, BrowserContext, HTTPRequest } from 'puppeteer-core'
import { FetchError, textCharset } from '../crawl/fetcher'
import { bestEffort } from './cleanup'
import { seedPageRandom } from './determinism'
import {
  fingerprint,
  fingerprintSet,
  responseFingerprint,
  responseMetadataFingerprint,
} from './fingerprints'
import { renderRequestHeaders, renderResponseHeaders } from './headers'
import { addSample, oneLine, RENDER_LIMITS } from './limits'
import { isScriptFailure, observeDocument, serializeDocument } from './snapshot'
import { createSlots, untilAborted } from './slots'
import { RenderInterruptedError, type RenderInput, type RenderOutcome } from './types'

/** The benchmark can override the earliest quiet capture; Infinity uses the whole window. */
export const MIN_QUIET_CAPTURE_MS = Infinity

export async function renderPage(
  browser: Browser,
  input: RenderInput,
  ownedContext?: BrowserContext,
  minQuietCaptureMs = MIN_QUIET_CAPTURE_MS,
): Promise<RenderOutcome> {
  const started = performance.now()
  const waitMs = Math.max(
    0,
    Math.min(input.waitMs ?? RENDER_LIMITS.waitMs, RENDER_LIMITS.maxWaitMs),
  )
  const loadGraceMs = Math.max(
    0,
    Math.min(input.loadGraceMs ?? RENDER_LIMITS.loadGraceMs, RENDER_LIMITS.loadGraceMs),
  )
  const result: RenderOutcome = {
    status: 'rendered',
    settled: false,
    pending: 0,
    captureMs: null,
    captureDelayMs: null,
    redirected: false,
    finalUrl: input.url,
    html: '',
    truncated: input.document.truncated,
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
  let capturing = false
  let captureHadActivity = false
  const uninterceptedRequests = new Map<string, string>()
  const interceptedRequests = new Set<string>()
  let contextClosing: Promise<void> | undefined
  let endAtCeiling: () => void = () => {}
  const ceilingReached = new Promise<void>((resolve) => {
    endAtCeiling = resolve
  })
  let inFlight = 0
  let lastActivity = started
  const noteActivity = () => {
    if (capturing) captureHadActivity = true
    lastActivity = performance.now()
  }
  let intercepted = 0
  let admitted = 0
  const reservations = new Set<Promise<void>>()
  const waitingForBudget = new Set<HTTPRequest>()
  let bytes = input.document.body?.length ?? 0
  const pageSlots = createSlots(RENDER_LIMITS.pageResources)
  const crawlSlots = input.resourceSlots
  const resourceSignal = input.resourceSignal ?? input.signal
  let requestBodyBytes = 0
  let supplied = false
  const documentHeaders = renderResponseHeaders(input.document.headers)
  const contentType = documentHeaders['content-type'] ?? 'text/html'
  if (!/charset\s*=/i.test(contentType)) {
    documentHeaders['content-type'] =
      `${contentType}; charset=${textCharset(input.document.body ?? Buffer.alloc(0), contentType)}`
  }
  const identity = (value: string) => {
    const normalized = normalizeCrawlUrl(value)
    return (
      normalized && stripIgnoredParameters(normalized, input.ignoredParameters ?? [], input.host)
    )
  }
  const pending = new Set<Promise<void>>()
  const resourceRequests: string[] = []
  const resourceAnswers: string[] = []
  const resourceMetadata: string[] = []
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
      addSample(
        result.scriptErrors.first,
        oneLine(error instanceof Error ? error.message : String(error)),
        (value) => value,
        RENDER_LIMITS.scriptErrors,
      )
    })
    const omit = (url: string, reason: RenderOutcome['requests']['omitted'][number]['reason']) => {
      // Fetches can finish in any order. Any omission for a limit makes the observation partial.
      if (reason === 'limit') result.truncated = true
      if (
        reason === 'analytics' ||
        reason === 'experiment' ||
        reason === 'domain-list' ||
        (reason === 'type' && renderOmittedEndpoint(new URL(url), input.extraOmittedHosts))
      ) {
        // Diagnostic identifies the intentionally omitted endpoint without opaque IDs or tokens.
        url = url.split(/[?#]/, 1)[0]!
      }
      url = url.slice(0, RENDER_LIMITS.urlChars)
      result.requests.omittedCount++
      addSample(result.requests.omitted, { url, reason }, (value) => `${value.url} ${value.reason}`)
    }
    const browserResponses = new WeakMap<HTTPRequest, 'supplied' | 'failed'>()
    const failedScriptUrls = new Set<string>()
    const refusedScriptUrls = new Set<string>()
    const recordFailure = (url: string, code: string) => {
      result.requests.failedCount++
      addSample(
        result.requests.failed,
        { url: url.slice(0, RENDER_LIMITS.urlChars), code },
        (value) => `${value.url} ${value.code}`,
      )
    }
    const failResource = (request: HTTPRequest, code: string) => {
      if (browserResponses.get(request) === 'failed') return
      browserResponses.set(request, 'failed')
      if (request.resourceType() === 'script') failedScriptUrls.add(request.url())
      recordFailure(request.url(), code)
    }
    page.on('requestfailed', (request) => {
      if (finished || signal.aborted || browserResponses.get(request) !== 'supplied') return
      failResource(request, request.failure()?.errorText ?? 'BROWSER_REQUEST_FAILED')
      noteActivity()
    })
    const recordNavigation = (url: string, from = input.url) => {
      if (result.redirected || result.failure?.code === 'navigation') return
      const target = identity(url)
      result.redirected = !!target && target !== identity(from) && target !== identity(input.url)
      result.finalUrl = url
      if (!result.redirected) fail('navigation', 'The document navigated to the same URL identity.')
      result.html = ''
      result.settled = false
      omit(url, 'redirect')
    }
    const requestDecision = (url: string, resourceType: string) =>
      renderRequestDecision({
        url,
        resourceType,
        trackedSite: isInternalUrl(url, input.host),
        allowedByRobots: input.allowedByRobots,
        extraOmittedHosts: input.extraOmittedHosts,
      })
    const allowedMethod = (method: string) => ['GET', 'HEAD', 'OPTIONS', 'POST'].includes(method)
    let interceptedNavigation: { url: string; from: string } | undefined
    const handle = async (request: HTTPRequest) => {
      const url = request.url()
      const abort = () => request.abort('blockedbyclient').catch(() => {})
      if (finished || signal.aborted) return abort()
      if (++intercepted > RENDER_LIMITS.interceptions) {
        omit(url, 'limit')
        contextClosing = bestEffort(() => context.close())
        stop.abort()
        endAtCeiling()
        return
      }
      if (result.redirected) return abort()
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        if (!supplied) {
          supplied = true
          return request.respond({
            status: input.document.statusCode,
            headers: documentHeaders,
            body: input.document.body ?? Buffer.alloc(0),
          })
        }
        // Keep the original document. The target is recorded, never fetched or rendered here.
        const from = page.url()
        if (capturing) {
          // Leave this request paused until teardown so aborting it cannot clear the browser's
          // navigation event before the snapshot reads it.
          interceptedNavigation ??= { url, from }
          return
        }
        recordNavigation(url, from)
        return abort()
      }
      if (!allowedMethod(request.method())) {
        omit(url, 'method')
        return abort()
      }
      const resourceType =
        request.method() === 'OPTIONS' && request.headers()['access-control-request-method']
          ? 'preflight'
          : request.resourceType()
      const decision = requestDecision(url, resourceType)
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
      // Match the two CDP sessions in either delivery order and keep only unmatched events.
      if ('id' in request && typeof request.id === 'string') {
        const key = `${request.id} ${url}`
        if (!uninterceptedRequests.delete(key)) interceptedRequests.add(key)
      }
      waitingForBudget.add(request)
      inFlight++
      noteActivity()
      let slot = false
      let settleReservation: (() => void) | undefined
      try {
        // A browser loads a page's resources in parallel, a few at a time; so does this.
        await pageSlots.acquire(signal)
        slot = true
        if (finished || signal.aborted) return abort()
        if (bytes >= RENDER_LIMITS.pageBytes) {
          omit(url, 'limit')
          return abort()
        }
        const postData = await request.content()
        if (finished || signal.aborted) return abort()
        requestBodyBytes += postData?.byteLength ?? 0
        if (
          (postData && postData.byteLength > RENDER_LIMITS.requestBodyBytes) ||
          requestBodyBytes > RENDER_LIMITS.pageRequestBodyBytes
        ) {
          omit(url, 'limit')
          return abort()
        }
        if (request.hasPostData() && postData === undefined) {
          failResource(request, 'BODY_UNAVAILABLE')
          return abort()
        }
        // A full budget may still have provisional charges for addresses the fetcher will refuse.
        while (admitted >= RENDER_LIMITS.requests && reservations.size > 0)
          await untilAborted(Promise.race(reservations), signal)
        if (finished || signal.aborted) return abort()
        waitingForBudget.delete(request)
        // Charge one admitted subresource, including cache hits, so a warm cache cannot let
        // a page render more of its document than a cold cache. Policy omissions cost no slots
        // in this budget, and retries of an admitted resource keep that resource's single charge.
        if (admitted >= RENDER_LIMITS.requests) {
          omit(url, 'limit')
          return abort()
        }
        admitted++
        let releaseReservation: () => void
        const reservation = new Promise<void>((resolve) => {
          releaseReservation = resolve
        })
        reservations.add(reservation)
        settleReservation = () => {
          reservations.delete(reservation)
          releaseReservation()
        }
        // Scripts and stylesheets may be shared with other pages through the crawl's cache: their
        // bytes are charged to every page once they arrived, and their fetch is never cut by the
        // budget or the end of the page that happened to start it.
        const shared =
          request.method() === 'GET' && ['script', 'stylesheet'].includes(request.resourceType())
        const headers = renderRequestHeaders(request.headers())
        const load = async () => {
          const loadSignal = shared ? resourceSignal : signal
          await crawlSlots?.acquire(loadSignal)
          // Held from here: released below, whatever the fetch comes to.
          try {
            if (!finished) result.requests.made++
            return await input.requester.fetchWithRetries(url, {
              signal: loadSignal,
              // Documents keep the domain's requests per second; resources are bounded by the
              // slots instead, as a browser loads them.
              paced: false,
              method: request.method(),
              headers,
              ...(postData === undefined ? {} : { body: Buffer.from(postData) }),
              readBody: 'force',
              maxBytes: RENDER_LIMITS.resourceBytes,
              ...(shared
                ? {}
                : {
                    beforeAttempt: () => {
                      if (bytes >= RENDER_LIMITS.pageBytes)
                        throw new FetchError('BODY_LIMIT', 'Page byte budget exceeded')
                    },
                    onBodyBytes: (size: number) => {
                      bytes += size
                      if (bytes > RENDER_LIMITS.pageBytes)
                        throw new FetchError('BODY_LIMIT', 'Page byte budget exceeded')
                    },
                  }),
            })
          } finally {
            crawlSlots?.release()
          }
        }
        const { answer, cached } = await untilAborted(
          input.cache.request(url, request.method(), request.resourceType(), load),
          signal,
        )
        if (answer instanceof FetchError && answer.code === 'BLOCKED_ADDRESS') admitted--
        settleReservation()
        settleReservation = undefined
        if (finished || signal.aborted || result.redirected) return abort()
        if (cached) result.requests.cached++
        if (answer instanceof FetchError) {
          if (answer.code === 'BODY_LIMIT') {
            omit(url, 'limit')
            return abort()
          }
          if (answer.code === 'BLOCKED_ADDRESS') {
            if (request.resourceType() === 'script') refusedScriptUrls.add(url)
            if (cached) result.requests.cached--
            else result.requests.made--
            result.requests.refusedCount++
            addSample(
              result.requests.refused,
              url.slice(0, RENDER_LIMITS.urlChars),
              (value) => value,
            )
          } else {
            failResource(request, answer.code)
          }
          return abort()
        }
        const size = answer.body?.length ?? 0
        if (shared) bytes += size
        if (bytes > RENDER_LIMITS.pageBytes || answer.truncated) {
          omit(url, 'limit')
          return abort()
        }
        if (answer.statusCode >= 400) failResource(request, `HTTP_${answer.statusCode}`)
        else browserResponses.set(request, 'supplied')
        await request.respond({
          status: answer.statusCode,
          headers: renderResponseHeaders(answer.headers),
          body: answer.body ?? Buffer.alloc(0),
        })
        if (!finished) {
          const key = fingerprint(
            JSON.stringify([
              request.method(),
              url,
              Object.entries(headers).sort(),
              postData === undefined ? null : fingerprint(postData),
            ]),
          )
          resourceRequests.push(key)
          resourceAnswers.push(key + responseFingerprint(answer))
          resourceMetadata.push(key + responseMetadataFingerprint(answer))
        }
      } catch {
        if (!finished && !signal.aborted) failResource(request, 'REQUEST_FAILED')
        await abort()
      } finally {
        settleReservation?.()
        waitingForBudget.delete(request)
        if (slot) pageSlots.release()
        inFlight--
        noteActivity()
      }
    }
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      const work = handle(request).catch(() => {})
      pending.add(work)
      void work.finally(() => pending.delete(work))
    })
    // The window starts when the DOM is parsed, so neither the document nor the resources it
    // waited for (nor our own queues) eat into it. The load event is not needed.
    let parsedAt: number | null = null
    await cdp.send('Page.enable')
    const { frameTree } = await cdp.send('Page.getFrameTree')
    // Use the snapshot's CDP session to see requests even if Puppeteer's interception is still
    // being paired with its Network event. Count each request once across the two sessions.
    await Promise.all([
      cdp.send('Network.enable', { maxPostDataSize: 0 }),
      cdp.send('Runtime.enable'),
    ])
    const syntaxErrors = new Set<string>()
    let syntaxErrorOverflow = false
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      // A module that fails to parse or link can raise a DevTools exception instead of a DOM
      // error event, even though its response was successfully supplied.
      if (finished || exceptionDetails.exception?.className !== 'SyntaxError') return
      const url = exceptionDetails.url
      if (url && requestDecision(url, 'script').action === 'fetch') {
        if (url.length <= RENDER_LIMITS.urlChars && syntaxErrors.size < RENDER_LIMITS.requests)
          syntaxErrors.add(url)
        else syntaxErrorOverflow ||= !syntaxErrors.has(url)
      }
    })
    let documentLoader: string | undefined
    cdp.on('Page.frameNavigated', ({ frame }) => {
      if (!supplied || finished || frame.id !== frameTree.frame.id) return
      if (documentLoader === undefined) documentLoader = frame.loaderId
      else if (documentLoader !== frame.loaderId) recordNavigation(frame.url)
    })
    cdp.on('Network.requestWillBeSent', ({ requestId, request, frameId, type }) => {
      if (finished || signal.aborted || (type === 'Document' && frameId === frameTree.frame.id))
        return
      const resourceType =
        request.method === 'OPTIONS' &&
        Object.keys(request.headers).some(
          (name) => name.toLowerCase() === 'access-control-request-method',
        )
          ? 'preflight'
          : (type ?? '')
      if (
        !allowedMethod(request.method) ||
        requestDecision(request.url, resourceType).action !== 'fetch'
      )
        return
      const key = `${requestId} ${request.url}`
      if (!interceptedRequests.delete(key)) uninterceptedRequests.set(key, request.url)
      noteActivity()
    })
    const worldName = 'seotools-serialization'
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      worldName,
      source: observeDocument,
    })
    let onParsed: () => void = () => {}
    const parsed = new Promise<void>((resolve) => {
      onParsed = () => {
        parsedAt = performance.now()
        resolve()
      }
      cdp.once('Page.domContentEventFired', onParsed)
    })
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    try {
      const grace = new Promise<never>((_resolve, reject) => {
        graceTimer = setTimeout(() => reject(new Error('load-timeout')), loadGraceMs)
      })
      // Puppeteer's lifecycle watcher waits for child frames too. Observe the main target's own
      // DOM event independently; still consume navigation errors (including stopped redirects).
      const navigation = page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 0, signal })
      await Promise.race([
        interrupted,
        parsed,
        grace,
        ceilingReached,
        navigation.then(() => parsed),
      ])
    } catch (error) {
      if (!result.redirected)
        fail(
          error instanceof Error && error.message === 'load-timeout'
            ? 'load-timeout'
            : 'navigation',
          'The document was not parsed in time.',
        )
    } finally {
      clearTimeout(graceTimer)
      cdp.off('Page.domContentEventFired', onParsed)
    }
    input.signal.throwIfAborted()
    if (contextClosing) return result
    if (crashed || !browser.connected) throw new RenderInterruptedError('Browser or page crashed')
    // A failed initial navigation never reached a document snapshot.
    if (result.status === 'failed' || result.redirected) return result
    // Set up the isolated realm before the cutoff to avoid an extra round trip at capture.
    const world = cdp.send('Page.createIsolatedWorld', {
      frameId: frameTree.frame.id,
      worldName,
      grantUniveralAccess: false,
    })
    void world.catch(() => {})
    let cutoffMs = waitMs
    const networkQuiet = () =>
      inFlight === 0 &&
      uninterceptedRequests.size === 0 &&
      performance.now() - lastActivity >= RENDER_LIMITS.quietMs
    if (parsedAt !== null) {
      // Quiet means quiet since the DOM was parsed: scripts get to start what they start.
      lastActivity = Math.max(lastActivity, parsedAt)
      const deadline = parsedAt + waitMs
      while (
        result.status === 'rendered' &&
        !result.redirected &&
        performance.now() < deadline &&
        !signal.aborted
      ) {
        const elapsed = performance.now() - parsedAt
        if (elapsed >= minQuietCaptureMs && networkQuiet()) {
          cutoffMs = Math.ceil(elapsed)
          break
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(1, Math.min(25, deadline - performance.now()))),
        )
        if (crashed || !browser.connected)
          throw new RenderInterruptedError('Browser or page crashed')
      }
    }
    input.signal.throwIfAborted()
    if (contextClosing) return result
    const quietAtCutoff = networkQuiet()
    capturing = true
    // A redirect is a complete observation of navigation, not of the abandoned DOM.
    if (result.redirected) return result
    // Evaluate inside the browser; cap UTF-8 bytes there before sending the DOM over CDP.
    try {
      const serialize = async () => {
        const { executionContextId } = await world
        return cdp.send('Runtime.evaluate', {
          contextId: executionContextId,
          returnByValue: true,
          timeout: RENDER_LIMITS.waitMs,
          awaitPromise: true,
          expression: serializeDocument(cutoffMs),
        })
      }
      const serialized = await untilAborted(
        Promise.race([interrupted, ceilingReached, serialize()]),
        input.signal,
      )
      input.signal.throwIfAborted()
      if (!serialized) {
        result.settled = false
        return result
      }
      finished = true
      result.pending = inFlight + uninterceptedRequests.size
      const queued = [...waitingForBudget]
        .map((request) => request.url())
        .concat([...uninterceptedRequests.values()])
      for (const url of queued.slice(RENDER_LIMITS.requests - admitted)) omit(url, 'limit')
      const dom: unknown = serialized.result.value
      if (
        serialized.exceptionDetails ||
        !dom ||
        typeof dom !== 'object' ||
        !('html' in dom) ||
        typeof dom.html !== 'string' ||
        !('truncated' in dom) ||
        typeof dom.truncated !== 'boolean' ||
        !('afterMs' in dom) ||
        (dom.afterMs !== null && typeof dom.afterMs !== 'number') ||
        !('url' in dom) ||
        typeof dom.url !== 'string' ||
        !('leaving' in dom) ||
        (dom.leaving !== null && typeof dom.leaving !== 'string') ||
        !('scriptFailures' in dom) ||
        !Array.isArray(dom.scriptFailures) ||
        !dom.scriptFailures.every(isScriptFailure) ||
        !('overflow' in dom) ||
        typeof dom.overflow !== 'boolean'
      )
        throw new Error('Invalid DOM snapshot')
      if (result.redirected || result.failure?.code === 'navigation') return result
      if (dom.leaving !== null) {
        recordNavigation(dom.leaving, dom.url)
        return result
      }
      if (dom.url.split('#', 1)[0] !== new URL(input.url).href.split('#', 1)[0])
        result.documentUrl = dom.url
      if (parsedAt !== null && dom.afterMs !== null) {
        result.captureMs = Math.ceil(dom.afterMs)
        result.captureDelayMs = Math.max(0, result.captureMs - cutoffMs)
      }
      result.settled =
        result.status === 'rendered' &&
        quietAtCutoff &&
        !captureHadActivity &&
        result.pending === 0 &&
        result.captureDelayMs !== null &&
        result.captureDelayMs <= CAPTURE_DELAY_TOLERANCE_MS
      const browserFailures = new Map(dom.scriptFailures.map(({ url, code }) => [url, code]))
      for (const url of syntaxErrors)
        if (!browserFailures.has(url)) browserFailures.set(url, 'SCRIPT_SYNTAX_ERROR')
      for (const [url, code] of browserFailures) {
        if (failedScriptUrls.has(url) || refusedScriptUrls.has(url)) continue
        if (url !== dom.url && requestDecision(url, 'script').action !== 'fetch') continue
        recordFailure(url, code)
      }
      if (dom.overflow || syntaxErrorOverflow) recordFailure(input.url, 'SCRIPT_FAILURE_LIMIT')
      result.html = dom.html
      result.truncated ||= dom.truncated
    } catch {
      input.signal.throwIfAborted()
      if (crashed || !browser.connected) throw new RenderInterruptedError('Browser or page crashed')
      if (interceptedNavigation)
        recordNavigation(interceptedNavigation.url, interceptedNavigation.from)
      else if (!result.redirected && !contextClosing && !result.failure)
        fail('serialization', 'The document could not be serialized.')
    }
    return result
  } catch (error) {
    if (crashed || !browser.connected) throw new RenderInterruptedError('Browser or page crashed')
    throw error
  } finally {
    finished = true
    if (supplied) {
      const document = { ...input.document, headers: documentHeaders }
      result.inputs = {
        document: responseFingerprint(document),
        documentResponseMetadata: responseMetadataFingerprint(document),
        resourceRequests: fingerprintSet(resourceRequests),
        resourceAnswers: fingerprintSet(resourceAnswers),
        resourceResponseMetadata: fingerprintSet(resourceMetadata),
      }
    }
    stop.abort()
    await (contextClosing ?? bestEffort(() => context.close()))
    // The resource handlers stop waiting here. Shared downloads can continue for other pages.
    await Promise.allSettled([...pending])
    result.durationMs = Math.round(performance.now() - started)
  }
}
