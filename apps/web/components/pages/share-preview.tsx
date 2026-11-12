import { ImageOffIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import type { SharePreview } from '@/lib/share-preview'

const MUTED = 'text-muted-foreground'

/**
 * How a page would look in a search result and when it is shared, from what the crawl stored of it.
 * Read-only, so anyone who can see the URL sees it. It is an approximation: what search engines and
 * networks show is theirs to decide.
 */
export async function SharePreviewView({ preview }: { preview: SharePreview }) {
  const t = await getTranslations('UrlDetail.preview')
  const { google, social } = preview
  return (
    <div className="grid gap-4 @min-[36rem]/url-detail:grid-cols-2">
      <div className="grid min-w-0 content-start gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('google')}
        </h3>
        <div className="grid min-w-0 gap-1 rounded-lg border bg-card p-3 text-sm">
          <p className={`${MUTED} truncate text-xs`}>
            {[google.host, ...google.segments].join(' › ')}
          </p>
          {google.title ? (
            <p className="text-base leading-snug text-blue-700 dark:text-blue-400">
              {google.title}
            </p>
          ) : (
            <p className={MUTED}>{t('noTitle')}</p>
          )}
          {google.description ? (
            <p className={MUTED}>{google.description}</p>
          ) : (
            <p className={`${MUTED} italic`}>{t('noDescription')}</p>
          )}
        </div>
      </div>

      <div className="grid min-w-0 content-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('social')}
          </h3>
          {social?.card && <Badge variant="secondary">{t('card', { card: social.card })}</Badge>}
        </div>
        {social === null ? (
          <p className={`${MUTED} rounded-lg border border-dashed p-3 text-sm`}>
            {t('notRecorded')}
          </p>
        ) : (
          <div className="grid min-w-0 overflow-hidden rounded-lg border bg-card text-sm">
            {social.image.kind === 'https' ? (
              // A plain `<img>`: the address is somebody else's, so it goes through no optimizer,
              // sends no referrer and loads only when it is on screen.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={social.image.url}
                alt=""
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                className="aspect-[1.91/1] w-full bg-muted object-cover"
              />
            ) : (
              <div
                className={`${MUTED} flex aspect-[1.91/1] w-full flex-col items-center justify-center gap-1 bg-muted p-3 text-center text-xs`}
              >
                <ImageOffIcon aria-hidden className="size-5" />
                {social.image.kind === 'insecure' ? t('imageInsecure') : t('noImage')}
              </div>
            )}
            <div className="grid gap-1 border-t p-3">
              <p className={`${MUTED} truncate text-xs uppercase`}>
                {social.siteName ?? social.host}
              </p>
              {social.title ? (
                <p className="line-clamp-2 font-medium">{social.title}</p>
              ) : (
                <p className={MUTED}>{t('noSocialTitle')}</p>
              )}
              {social.description && (
                <p className={`${MUTED} line-clamp-3`}>{social.description}</p>
              )}
            </div>
          </div>
        )}
        {social?.untagged && <p className={`${MUTED} text-xs`}>{t('untagged')}</p>}
      </div>
    </div>
  )
}
