/**
 * Thrown by the writes of `comparisonWork` when the pair is no longer claimed by the run that writes:
 * another run took it over, or a crawl of the pair was pruned (which removes the claim). The run
 * stops and writes nothing more.
 */
export class ComparisonSupersededError extends Error {
  override name = 'ComparisonSupersededError'
  constructor() {
    super('The explanation of this pair was taken over or its crawls were pruned')
  }
}
