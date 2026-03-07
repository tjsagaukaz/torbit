/**
 * TORBIT - Knowledge Cache
 * 
 * Time-bound knowledge storage.
 * Read-only, does not alter code.
 */

import type { KnowledgeCache, TrendFact } from './types'

// ============================================
// CACHE STATE
// ============================================

let currentCache: KnowledgeCache = {
  version: '1.0.0',
  lastUpdated: new Date().toISOString(),
  facts: {},
  ttl: 24 * 60 * 60 * 1000, // 24 hours
  fetchedSources: [],
}

// ============================================
// CACHE OPERATIONS
// ============================================

/**
 * Get the current cache (read-only)
 */
export function getCache(): Readonly<KnowledgeCache> {
  return currentCache
}

/**
 * Check if cache is stale
 */
export function isCacheStale(): boolean {
  const lastUpdated = new Date(currentCache.lastUpdated).getTime()
  const now = Date.now()
  return (now - lastUpdated) > currentCache.ttl
}

/**
 * Check if a specific domain's cache is stale
 */
export function isDomainCacheStale(domain: string, maxAge?: number): boolean {
  const facts = currentCache.facts[domain]
  if (!facts || facts.length === 0) return true
  
  const ttl = maxAge || currentCache.ttl
  const oldestFact = facts.reduce((oldest, fact) => {
    const factTime = new Date(fact.detectedAt).getTime()
    return factTime < oldest ? factTime : oldest
  }, Infinity)
  
  return (Date.now() - oldestFact) > ttl
}

/**
 * Add facts to cache
 */
export function addFacts(domain: string, facts: TrendFact[]): void {
  if (!currentCache.facts[domain]) {
    currentCache.facts[domain] = []
  }
  
  // Dedupe by fact ID
  const existingIds = new Set(currentCache.facts[domain].map(f => f.id))
  const newFacts = facts.filter(f => !existingIds.has(f.id))
  
  currentCache.facts[domain].push(...newFacts)
  currentCache.lastUpdated = new Date().toISOString()
}

/**
 * Get facts for a domain
 */
export function getFacts(domain: string): TrendFact[] {
  return currentCache.facts[domain] || []
}

/**
 * Get facts across all domains
 */
export function getAllFacts(): TrendFact[] {
  return Object.values(currentCache.facts).flat()
}

/**
 * Get facts matching a query
 */
export function queryFacts(params: {
  domains?: string[]
  minConfidence?: number
  maxAge?: number
  productionReadyOnly?: boolean
  tags?: string[]
}): TrendFact[] {
  let facts = getAllFacts()
  
  // Filter by domains
  if (params.domains && params.domains.length > 0) {
    facts = facts.filter(f => params.domains!.includes(f.domain))
  }
  
  // Filter by confidence
  if (params.minConfidence !== undefined) {
    facts = facts.filter(f => f.confidence >= params.minConfidence!)
  }
  
  // Filter by age
  if (params.maxAge !== undefined) {
    const cutoff = Date.now() - params.maxAge
    facts = facts.filter(f => new Date(f.detectedAt).getTime() >= cutoff)
  }
  
  // Filter by production readiness
  if (params.productionReadyOnly) {
    facts = facts.filter(f => f.productionReady)
  }
  
  // Filter by tags
  if (params.tags && params.tags.length > 0) {
    facts = facts.filter(f => 
      params.tags!.some(tag => f.tags.includes(tag))
    )
  }
  
  // Sort by relevance, then confidence
  return facts.sort((a, b) => {
    const relevanceOrder = { high: 3, medium: 2, low: 1 }
    const relevanceDiff = relevanceOrder[b.relevance] - relevanceOrder[a.relevance]
    if (relevanceDiff !== 0) return relevanceDiff
    return b.confidence - a.confidence
  })
}

/**
 * Mark a source as fetched
 */
export function markSourceFetched(sourceId: string): void {
  if (!currentCache.fetchedSources.includes(sourceId)) {
    currentCache.fetchedSources.push(sourceId)
  }
}

/**
 * Check if a source has been fetched recently
 */
export function wasSourceFetched(sourceId: string): boolean {
  return currentCache.fetchedSources.includes(sourceId)
}

/**
 * Clear the cache
 */
export function clearCache(): void {
  currentCache = {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    facts: {},
    ttl: 24 * 60 * 60 * 1000,
    fetchedSources: [],
  }
}

/**
 * Set cache TTL
 */
export function setCacheTTL(ttl: number): void {
  currentCache.ttl = ttl
}

/**
 * Export cache for persistence
 */
export function exportCache(): string {
  return JSON.stringify(currentCache, null, 2)
}

/**
 * Import cache from persistence
 */
export function importCache(json: string): boolean {
  try {
    const parsed = JSON.parse(json)
    if (parsed.version && parsed.facts) {
      currentCache = parsed
      return true
    }
    return false
  } catch {
    return false
  }
}

// ============================================
// CACHE STATISTICS
// ============================================

export interface CacheStats {
  totalFacts: number
  factsByDomain: Record<string, number>
  lastUpdated: string
  isStale: boolean
  fetchedSources: number
}

/**
 * Get cache statistics
 */
export function getCacheStats(): CacheStats {
  const factsByDomain: Record<string, number> = {}
  let totalFacts = 0
  
  for (const [domain, facts] of Object.entries(currentCache.facts)) {
    factsByDomain[domain] = facts.length
    totalFacts += facts.length
  }
  
  return {
    totalFacts,
    factsByDomain,
    lastUpdated: currentCache.lastUpdated,
    isStale: isCacheStale(),
    fetchedSources: currentCache.fetchedSources.length,
  }
}
