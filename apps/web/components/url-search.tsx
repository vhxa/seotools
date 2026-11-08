'use client'

import { SearchIcon, XIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { searchUrlsAction } from '@/app/(protected)/domains/[host]/search-actions'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { InputGroupAddon } from '@/components/ui/input-group'
import { type UrlSearchHit } from '@/lib/url-search'
import { cn } from '@/lib/utils'

/** Wait this long after the last key before asking the server. */
const DEBOUNCE_MS = 200

/**
 * Jumps to a URL of the domain from anywhere inside it: type part of its address or title, pick
 * one, and its detail opens. It only reads what the latest full crawl stored. On narrow screens it
 * is an icon that unfolds over the whole header.
 */
export function UrlSearch({ host }: { host: string }) {
  const t = useTranslations('Header')
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  // What the server last answered, and for which text: it is "loading" until it answers this one.
  const [answer, setAnswer] = useState<{ term: string; hits: UrlSearchHit[] }>({
    term: '',
    hits: [],
  })
  // Only on narrow screens: wide ones always show the field.
  const [expanded, setExpanded] = useState(false)

  const term = text.trim()
  const loading = term !== '' && answer.term !== term
  useEffect(() => {
    if (term === '') return
    // A later key makes this answer stale: it must never replace the newer one.
    let stale = false
    const timer = setTimeout(async () => {
      let hits: UrlSearchHit[] = []
      try {
        hits = await searchUrlsAction(host, term)
      } catch {
        // A failed search reads as no results rather than as a broken header.
      }
      if (!stale) setAnswer({ term, hits })
    }, DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [host, term])

  useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  const close = () => {
    setOpen(false)
    setExpanded(false)
    setText('')
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn('ml-auto md:hidden', expanded && 'hidden')}
        aria-label={t('searchOpen')}
        onClick={() => setExpanded(true)}
      >
        <SearchIcon />
      </Button>
      <div
        className={cn(
          'items-center gap-2',
          expanded ? 'absolute inset-0 z-30 flex bg-background px-4' : 'hidden',
          'md:static md:z-auto md:flex md:max-w-xl md:flex-1 md:bg-transparent md:px-0',
        )}
      >
        <Combobox<UrlSearchHit>
          items={answer.hits}
          // The server already chose what matches: the client must not filter it again.
          filter={null}
          value={null}
          inputValue={text}
          open={open && term !== ''}
          onOpenChange={setOpen}
          onInputValueChange={(value, details) => {
            // Choosing an item writes its label into the field; the field is cleared instead.
            if (details.reason !== 'item-press') setText(value)
          }}
          onValueChange={(hit) => {
            if (!hit) return
            close()
            router.push(`/domains/${host}/pages/details/${hit.hash}`)
          }}
          itemToStringLabel={(hit) => hit.url}
          isItemEqualToValue={(a, b) => a.hash === b.hash}
          autoHighlight
        >
          <ComboboxInput
            ref={inputRef}
            showTrigger={false}
            className="flex-1"
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !open) close()
            }}
          >
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
          </ComboboxInput>
          <ComboboxContent className="min-w-80">
            <ComboboxList>
              {(hit: UrlSearchHit) => (
                <ComboboxItem key={hit.hash} value={hit}>
                  <span className="grid min-w-0 flex-1 leading-tight">
                    <span className="truncate font-mono text-xs">{hit.url}</span>
                    {hit.title && (
                      <span className="truncate text-xs text-muted-foreground">{hit.title}</span>
                    )}
                  </span>
                </ComboboxItem>
              )}
            </ComboboxList>
            <ComboboxEmpty>{loading ? t('searching') : t('noResults')}</ComboboxEmpty>
          </ComboboxContent>
        </Combobox>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={t('searchClose')}
          onClick={close}
        >
          <XIcon />
        </Button>
      </div>
    </>
  )
}
