/**
 * What Google asks of the structured data that can show as a rich result, for the JSON-LD a page
 * declares. A property in a list of alternatives is enough with any one of them. Only the types
 * listed are judged (an unknown type is not an error), only top-level nodes and the nodes of an
 * `@graph`, and only whether each property is there: values are not validated. Microdata and RDFa
 * are counted as structured data but not judged. Pure, so client components can import it.
 */

/** A property, or a list of alternatives of which one is enough. */
type Requirement = string | readonly string[]

interface TypeRequirements {
  required: readonly Requirement[]
  recommended: readonly Requirement[]
}

const LOCAL_BUSINESS: TypeRequirements = {
  required: ['name', 'address'],
  recommended: ['telephone', 'url', 'image', 'openingHoursSpecification', 'geo'],
}

const ARTICLE: TypeRequirements = {
  required: [],
  recommended: ['headline', 'image', 'datePublished', 'author'],
}

export const RICH_RESULT_TYPES: Readonly<Record<string, TypeRequirements>> = {
  Product: {
    required: ['name', ['offers', 'review', 'aggregateRating']],
    recommended: ['image', 'description'],
  },
  Article: ARTICLE,
  NewsArticle: ARTICLE,
  BlogPosting: ARTICLE,
  BreadcrumbList: { required: ['itemListElement'], recommended: [] },
  FAQPage: { required: ['mainEntity'], recommended: [] },
  LocalBusiness: LOCAL_BUSINESS,
  Restaurant: LOCAL_BUSINESS,
  FoodEstablishment: LOCAL_BUSINESS,
  Store: LOCAL_BUSINESS,
  Hotel: LOCAL_BUSINESS,
  LodgingBusiness: LOCAL_BUSINESS,
  HealthAndBeautyBusiness: LOCAL_BUSINESS,
  DaySpa: LOCAL_BUSINESS,
  BeautySalon: LOCAL_BUSINESS,
  ProfessionalService: LOCAL_BUSINESS,
  Event: {
    required: ['name', 'startDate', 'location'],
    recommended: ['description', 'endDate', 'image', 'offers', 'organizer', 'eventStatus'],
  },
  Recipe: {
    required: ['name', 'image'],
    recommended: [
      'author',
      'datePublished',
      'description',
      'recipeIngredient',
      'recipeInstructions',
    ],
  },
  VideoObject: {
    required: ['name', 'thumbnailUrl', 'uploadDate'],
    recommended: ['description', ['contentUrl', 'embedUrl'], 'duration'],
  },
  JobPosting: {
    required: [
      'title',
      'description',
      'datePosted',
      'hiringOrganization',
      ['jobLocation', 'applicantLocationRequirements'],
    ],
    recommended: ['validThrough', 'employmentType', 'baseSalary'],
  },
  Organization: { required: [], recommended: ['name', 'url', 'logo'] },
  SoftwareApplication: {
    required: ['name', 'offers', ['aggregateRating', 'review']],
    recommended: ['operatingSystem', 'applicationCategory'],
  },
  Review: { required: ['itemReviewed', 'author', 'reviewRating'], recommended: [] },
  AggregateRating: {
    required: ['itemReviewed', 'ratingValue', ['ratingCount', 'reviewCount']],
    recommended: [],
  },
}

/** A typed node that lacks properties Google asks for, with what it lacks. */
export interface StructuredDataProblem {
  type: string
  level: 'required' | 'recommended'
  /** Each missing requirement; alternatives joined with ` | `. */
  missing: string[]
}

export interface StructuredDataReport {
  /** The `@type`s declared, once each, in the order found. */
  types: string[]
  problems: StructuredDataProblem[]
}

const MAX_NODES = 100
/** Values looked at, at most: lists and objects, however deep. */
const MAX_VISITS = 10_000
const MAX_TYPES = 20
const MAX_PROBLEMS = 20

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether a property holds something: not absent, `null`, an empty string or an empty list. */
function present(node: Record<string, unknown>, property: string): boolean {
  const value = node[property]
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

const satisfied = (node: Record<string, unknown>, requirement: Requirement) =>
  typeof requirement === 'string'
    ? present(node, requirement)
    : requirement.some((property) => present(node, property))

const label = (requirement: Requirement) =>
  typeof requirement === 'string' ? requirement : requirement.join(' | ')

/** `schema:Product`, `https://schema.org/Product` and `Product` are the same type. */
function typesOf(node: Record<string, unknown>): string[] {
  const raw = node['@type']
  const values = Array.isArray(raw) ? raw : [raw]
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.replace(/^(?:https?:\/\/schema\.org\/|schema:)/, ''))
}

/**
 * The nodes the JSON-LD blocks declare at their top: each block, a list of them, or its `@graph`,
 * the nodes of a graph before the node that holds it. A loop with a budget, never recursion: a page
 * can nest lists thousands deep in a few kilobytes, and what does not fit the budget is not judged.
 */
function topNodes(blocks: readonly unknown[]): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = []
  type Step = { visit: unknown } | { emit: Record<string, unknown> }
  const stack: Step[] = []
  const pushAll = (values: readonly unknown[]) => {
    const room = Math.max(0, MAX_VISITS - stack.length)
    for (let i = Math.min(values.length, room) - 1; i >= 0; i--) stack.push({ visit: values[i] })
  }
  pushAll(blocks)
  let visits = 0
  while (stack.length > 0 && nodes.length < MAX_NODES && visits < MAX_VISITS) {
    const step = stack.pop()!
    if ('emit' in step) {
      nodes.push(step.emit)
      continue
    }
    visits++
    const value = step.visit
    if (Array.isArray(value)) {
      pushAll(value)
      continue
    }
    if (!isObject(value)) continue
    if (value['@type'] !== undefined) stack.push({ emit: value })
    if (Array.isArray(value['@graph'])) pushAll(value['@graph'])
  }
  return nodes
}

/** Judges the parsed JSON-LD blocks of a page. */
export function checkStructuredData(blocks: readonly unknown[]): StructuredDataReport {
  const nodes = topNodes(blocks)
  const types: string[] = []
  const problems: StructuredDataProblem[] = []
  for (const node of nodes) {
    for (const type of typesOf(node)) {
      if (!types.includes(type) && types.length < MAX_TYPES) types.push(type)
      const rules = Object.hasOwn(RICH_RESULT_TYPES, type) ? RICH_RESULT_TYPES[type] : undefined
      if (!rules) continue
      for (const level of ['required', 'recommended'] as const) {
        const missing = rules[level].filter((rule) => !satisfied(node, rule)).map(label)
        if (missing.length > 0 && problems.length < MAX_PROBLEMS) {
          problems.push({ type, level, missing })
        }
      }
    }
  }
  return { types, problems }
}
