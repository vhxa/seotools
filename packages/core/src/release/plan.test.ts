import { describe, expect, it } from 'vitest'
import { parseTag } from '../version'
import { imageTagsFor, planPublish } from './plan'

const tagsOf = (...names: string[]) => names.map((name) => parseTag(name)!)
const forVersion = (version: string, known: string[]) =>
  imageTagsFor(parseTag(`v${version}`)!, tagsOf(...known))

describe('imageTagsFor', () => {
  it('gives the newest stable release its exact tag, its minor line and latest', () => {
    expect(forVersion('0.2.1', ['v0.1.0', 'v0.2.0', 'v0.2.1'])).toEqual({
      exact: ['0.2.1'],
      channels: ['0.2', 'latest'],
    })
  })

  it('has no tag for the whole of 0.x, where a minor release can break things', () => {
    const { channels } = forVersion('0.2.1', ['v0.2.1'])
    expect(channels).not.toContain('0')
  })

  it('adds the major line from 1.0.0 on', () => {
    expect(forVersion('1.4.2', ['v1.0.0', 'v1.4.2'])).toEqual({
      exact: ['1.4.2'],
      channels: ['1.4', '1', 'latest'],
    })
  })

  it('does not take a channel back when an older line gets a patch', () => {
    // 0.1.5 comes out after 0.2.0 exists: 0.1 follows it, latest stays on 0.2.0.
    expect(forVersion('0.1.5', ['v0.1.4', 'v0.1.5', 'v0.2.0'])).toEqual({
      exact: ['0.1.5'],
      channels: ['0.1'],
    })
    expect(forVersion('1.2.4', ['v1.2.4', 'v1.3.0', 'v2.0.0']).channels).toEqual(['1.2'])
    expect(forVersion('1.3.1', ['v1.2.4', 'v1.3.1', 'v2.0.0']).channels).toEqual(['1.3', '1'])
  })

  it('leaves a patch behind a newer one in its line', () => {
    expect(forVersion('0.2.0', ['v0.2.0', 'v0.2.1']).channels).toEqual([])
  })

  it('gives a candidate its exact tag only', () => {
    expect(forVersion('0.3.0-rc.1', ['v0.2.0', 'v0.3.0-rc.1'])).toEqual({
      exact: ['0.3.0-rc.1'],
      channels: [],
    })
  })

  it('does not count candidates or odd tags as releases', () => {
    expect(forVersion('0.2.0', ['v0.2.0', 'v0.3.0-rc.1']).channels).toEqual(['0.2', 'latest'])
  })
})

describe('planPublish', () => {
  const base = { event: 'push', sha: 'a651c7a0123456789', version: '0.2.0', tags: ['v0.2.0'] }

  it('publishes a release for a tag that matches the version', () => {
    expect(planPublish({ ...base, ref: 'refs/tags/v0.2.0' })).toEqual({
      publish: true,
      channel: 'release',
      version: '0.2.0',
      prerelease: false,
      latest: true,
      exactTags: ['0.2.0'],
      channelTags: ['0.2', 'latest'],
    })
  })

  it('marks a candidate as one', () => {
    const plan = planPublish({
      ...base,
      version: '0.3.0-rc.1',
      tags: ['v0.2.0', 'v0.3.0-rc.1'],
      ref: 'refs/tags/v0.3.0-rc.1',
    })
    expect(plan).toMatchObject({
      channel: 'release',
      prerelease: true,
      latest: false,
      channelTags: [],
    })
  })

  it('refuses a tag that is not the version of the code', () => {
    expect(() => planPublish({ ...base, ref: 'refs/tags/v0.2.1' })).toThrow(/does not match/)
    expect(() => planPublish({ ...base, ref: 'refs/tags/v0.2' })).toThrow(/not a version/)
    expect(() => planPublish({ ...base, ref: 'refs/tags/vNext' })).toThrow(/not a version/)
  })

  it('publishes main as a development build, never as a release', () => {
    expect(planPublish({ ...base, ref: 'refs/heads/main' })).toEqual({
      publish: true,
      channel: 'development',
      version: '0.2.0',
      prerelease: false,
      latest: false,
      exactTags: ['sha-a651c7a'],
      channelTags: ['edge'],
    })
  })

  it('only builds a pull request or another branch', () => {
    for (const [event, ref] of [
      ['pull_request', 'refs/pull/9/merge'],
      ['pull_request', 'refs/heads/main'],
      ['workflow_dispatch', 'refs/heads/feat/x'],
    ] as const) {
      expect(planPublish({ ...base, event, ref })).toMatchObject({
        publish: false,
        channel: 'development',
        exactTags: [],
        channelTags: [],
      })
    }
  })
})
