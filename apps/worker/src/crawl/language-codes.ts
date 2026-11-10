/** ISO 639-1. */
const LANGUAGES = new Set(
  (
    'aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy da ' +
    'de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy ' +
    'hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg ' +
    'li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or ' +
    'os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta ' +
    'te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'
  ).split(' '),
)

/** ISO 3166-1 alpha-2, in lowercase, and 419: Latin America, which search engines accept. */
const REGIONS = new Set(
  (
    'ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br ' +
    'bs bt bv bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ' +
    'ec ee eg eh er es et fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw ' +
    'gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky ' +
    'kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt mu mv ' +
    'mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py ' +
    'qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg ' +
    'th tj tk tl tm tn to tr tt tv tw tz ua ug um us uy uz va vc ve vg vi vn vu wf ws ye yt za zm ' +
    'zw 419'
  ).split(' '),
)

/**
 * Whether a value is a language with an optional script and region, as search engines and browsers
 * understand it. `en-UK` is the classic mistake: the region of the UK is `GB`.
 */
export function isValidLanguageTag(value: string): boolean {
  const code = value.trim().toLowerCase()
  const [language, ...rest] = code.split('-')
  if (!language || !LANGUAGES.has(language)) return false
  if (rest.length > 0 && /^[a-z]{4}$/.test(rest[0]!)) rest.shift()
  if (rest.length === 0) return true
  return rest.length === 1 && REGIONS.has(rest[0]!)
}

/** Whether a hreflang value is one search engines understand: `x-default` or a language tag. */
export const isValidHreflang = (value: string): boolean =>
  value.trim().toLowerCase() === 'x-default' || isValidLanguageTag(value)
