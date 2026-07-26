// Duplicate detection across searches.
//
// The backend deduplicates within a single response (OpenAlex vs PubMed), but a
// review runs many queries, and the same paper legitimately turns up under
// several of them. Those cross-query duplicates have to be recognised here,
// where the accumulated result set lives — and *counted*, because "duplicate
// records removed" is its own box in a PRISMA flow diagram.

import type { ResultCard } from '../types'

/** Bare, lower-cased DOI from a URL/source string, if present. */
export function extractDoi(source: string): string | null {
  const m = (source || '').match(/10\.\d{4,9}\/[^\s"<>]+/)
  return m ? m[0].replace(/[.,;)]+$/, '').toLowerCase() : null
}

/**
 * Normalised title key. Punctuation, case and whitespace differ freely between
 * databases for the same paper, so they are all flattened away before matching.
 */
export function titleKey(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 80)
}

/** Index of papers already held, keyed by DOI and by normalised title. */
export interface PaperIndex {
  byDoi: Map<string, ResultCard>
  byTitle: Map<string, ResultCard>
}

export function buildIndex(papers: ResultCard[]): PaperIndex {
  const byDoi = new Map<string, ResultCard>()
  const byTitle = new Map<string, ResultCard>()
  for (const p of papers) {
    const doi = extractDoi(p.source)
    if (doi && !byDoi.has(doi)) byDoi.set(doi, p)
    const tk = titleKey(p.title)
    if (tk && !byTitle.has(tk)) byTitle.set(tk, p)
  }
  return { byDoi, byTitle }
}

/** The already-held paper that `candidate` duplicates, or null. */
export function findDuplicate(index: PaperIndex, candidate: ResultCard): ResultCard | null {
  // DOI is authoritative across databases; the title key is the fallback for
  // records that carry no DOI at all.
  const doi = extractDoi(candidate.source)
  if (doi) {
    const hit = index.byDoi.get(doi)
    if (hit) return hit
  }
  const tk = titleKey(candidate.title)
  if (tk) {
    const hit = index.byTitle.get(tk)
    if (hit) return hit
  }
  return null
}

export interface PartitionResult {
  /** Papers not seen before — these enter the result set. */
  fresh: ResultCard[]
  /**
   * Field updates for papers already held whose duplicate carried better data
   * (e.g. a PubMed record with no abstract superseded by an OpenAlex one).
   */
  enrichments: { id: string; abstract: string }[]
  /** How many incoming papers were duplicates, for the PRISMA count. */
  duplicateCount: number
}

/**
 * Split incoming search results into genuinely new papers and duplicates.
 *
 * Duplicates are dropped rather than kept-and-flagged: a screener should see
 * each paper once. Their count is returned so the PRISMA "records removed
 * before screening" figure stays truthful. Incoming duplicates are also matched
 * against each other, so one batch cannot smuggle in its own repeats.
 */
export function partitionNewPapers(existing: ResultCard[], incoming: ResultCard[]): PartitionResult {
  const index = buildIndex(existing)
  const fresh: ResultCard[] = []
  const enrichments: { id: string; abstract: string }[] = []
  let duplicateCount = 0

  for (const candidate of incoming) {
    const held = findDuplicate(index, candidate)
    if (held) {
      duplicateCount++
      // A duplicate is still worth something if it fills a gap in what we kept.
      if (!held.abstract && candidate.abstract) {
        enrichments.push({ id: held.id, abstract: candidate.abstract })
      }
      continue
    }
    fresh.push(candidate)
    // Index the newcomer so later papers in this same batch match against it.
    const doi = extractDoi(candidate.source)
    if (doi && !index.byDoi.has(doi)) index.byDoi.set(doi, candidate)
    const tk = titleKey(candidate.title)
    if (tk && !index.byTitle.has(tk)) index.byTitle.set(tk, candidate)
  }

  return { fresh, enrichments, duplicateCount }
}
