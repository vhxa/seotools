import { describe, expect, it } from 'vitest'
import {
  RENDER_OMITTED_HOSTS,
  RENDER_OMITTED_PATHS,
  RENDER_OMITTED_TYPES,
  renderRequestDecision,
} from './render-policy'

const decide = (url: string, extra = {}) =>
  renderRequestDecision({
    url,
    resourceType: 'script',
    trackedSite: true,
    allowedByRobots: () => true,
    ...extra,
  })

describe('render request policy', () => {
  for (const [host, reason] of RENDER_OMITTED_HOSTS) {
    it(`omits ${host} and subdomains without matching unrelated hosts`, () => {
      expect(decide(`https://${host}/loader`)).toEqual({ action: 'omit', reason })
      expect(decide(`https://SUB.${host.toUpperCase()}:8443/loader`)).toEqual({
        action: 'omit',
        reason,
      })
      expect(decide(`https://not${host}/loader`)).toEqual({ action: 'fetch' })
      expect(decide(`https://${host}.evil.test/loader`)).toEqual({ action: 'fetch' })
    })
  }
  for (const rule of RENDER_OMITTED_PATHS) {
    it(`omits ${'host' in rule ? rule.host : 'any host'} ${rule.path}`, () => {
      expect(
        decide(
          `https://${'host' in rule ? rule.host : 'site.test'}${rule.path.toUpperCase()}?id=1`,
        ),
      ).toEqual({ action: 'omit', reason: rule.reason })
    })
  }
  for (const resourceType of RENDER_OMITTED_TYPES) {
    it(`never requests ${resourceType}`, () => {
      expect(decide('https://site.test/file', { resourceType })).toEqual({
        action: 'omit',
        reason: 'type',
      })
    })
  }
  it('allows GTM, fetch, xhr, styles, documents and OPTIONS preflights', () => {
    expect(decide('https://site.test/analytics/matomo.php')).toEqual({
      action: 'omit',
      reason: 'analytics',
    })
    expect(decide('https://www.googletagmanager.com/gtm.js?id=GTM-123')).toEqual({
      action: 'fetch',
    })
    for (const resourceType of ['fetch', 'xhr', 'stylesheet', 'document', 'preflight'])
      expect(decide('https://site.test/api', { resourceType })).toEqual({ action: 'fetch' })
    expect(decide('https://site.test/api', { resourceType: 'new-unknown-type' })).toEqual({
      action: 'omit',
      reason: 'type',
    })
  })
  it('rejects malformed URLs and every non-HTTP scheme', () => {
    for (const url of [
      'garbage',
      'file:///etc/passwd',
      'ftp://site.test/',
      'data:text/html,x',
      'javascript:alert(1)',
      'ws://site.test/',
    ])
      expect(decide(url)).toEqual({ action: 'scheme' })
  })
  it('applies the per-domain list by suffix and respects robots only for the site', () => {
    const extraOmittedHosts = ['CUSTOM.TEST']
    expect(decide('https://sub.custom.test/x', { extraOmittedHosts })).toEqual({
      action: 'omit',
      reason: 'domain-list',
    })
    expect(decide('https://custom.test.evil.test/', { extraOmittedHosts })).toEqual({
      action: 'fetch',
    })
    expect(decide('https://site.test/a', { allowedByRobots: () => false })).toEqual({
      action: 'robots',
    })
    expect(
      decide('https://external.test/a', { trackedSite: false, allowedByRobots: () => false }),
    ).toEqual({ action: 'fetch' })
    expect(decide('https://site.test/a', { allowedByRobots: () => 'unknown' })).toEqual({
      action: 'fetch',
    })
  })
})
