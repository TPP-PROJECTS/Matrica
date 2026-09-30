// ── AI activity tracker ───────────────────────────────────────────────────────
// apiFetch reports every AI-backed request here, so one overlay can tell the
// user that the model is working no matter which screen started the call.
//
// The chat endpoints are left out on purpose: the chat panels show their own
// typing indicator, and a page-blocking overlay would stop the user reading
// the conversation while the reply is on its way.

// Path (after the /api prefix) → what the user is told is happening.
const AI_ENDPOINTS: Record<string, string> = {
  '/topics/generate': 'Generating research topics',
  '/topics/generate-profile': 'Generating research topics',
  '/topics/explain-type': 'Explaining the topic type',
  '/topics/reason': 'Reasoning about this topic',
  '/queries/generate': 'Generating search queries',
  '/search': 'Searching the literature',
  '/recognise': 'Assessing paper relevance',
  '/papers/insights': 'Summarising the paper',
  '/screening/classify': 'Screening papers',
  '/matrix/generate-columns': 'Designing extraction columns',
  '/matrix/generate-system-columns': 'Designing extraction columns',
  '/matrix/assess-system-schema': 'Checking the extraction schema',
  '/matrix/autofill-row': 'Extracting data into the matrix',
  '/matrix/autofill-system-row': 'Extracting data into the matrix',
  '/matrix/cell-evidence': 'Finding supporting evidence',
  '/matrix/ingest-paper-file': 'Reading the paper',
  '/matrix/ingest-paper-url': 'Reading the paper',
  '/rob/assess': 'Assessing risk of bias',
  '/certainty/assess': 'Rating certainty of evidence',
  '/systems/recommend': 'Recommending systems',
  '/systems/lookup': 'Looking up the system',
  '/systems/link-topics': 'Linking systems to topics',
  '/gaps/generate': 'Identifying research gaps',
  '/synthesis/generate': 'Writing the synthesis',
  '/synthesis/regenerate-block': 'Rewriting this section',
  '/final-question/generate-topics': 'Drafting research questions',
  '/final-question/match-design': 'Matching a study design',
  '/final-question/generate-structure': 'Structuring the question',
  '/final-question/generate-sample': 'Writing a sample',
  '/final-question/generate': 'Drafting the final question',
}

/** The label for an AI-backed request, or null for anything else. */
export function aiLabelFor(url: string, apiBase: string): string | null {
  if (!url.startsWith(apiBase)) return null
  const path = url.slice(apiBase.length).split(/[?#]/)[0].replace(/\/+$/, '')
  return AI_ENDPOINTS[path] ?? null
}

export interface AiRequest {
  id: number
  label: string
  startedAt: number
  /**
   * Started by the app rather than by the user (relevance scores fired after a
   * search, the assessment run when a paper is opened). These are shown
   * without blocking the page: the user did not ask to wait for them.
   */
  background: boolean
}

export interface AiActivity {
  /** Requests in flight, oldest first. */
  requests: AiRequest[]
}

let nextId = 1
let snapshot: AiActivity = { requests: [] }
const listeners = new Set<() => void>()
const controllers = new Map<number, AbortController>()
let cancelEpoch = 0

function publish(next: AiActivity) {
  snapshot = next
  listeners.forEach(l => l())
}

/**
 * Mark an AI request as started. Pass the returned signal to fetch so the
 * request can be cancelled, and call `end` when it settles.
 */
export function beginAiRequest(
  label: string,
  opts: { background?: boolean; signal?: AbortSignal | null } = {},
): { signal: AbortSignal; end: () => void } {
  const id = nextId++
  const controller = new AbortController()
  const forward = () => controller.abort(opts.signal?.reason)
  if (opts.signal?.aborted) forward()
  else opts.signal?.addEventListener('abort', forward, { once: true })
  controllers.set(id, controller)
  publish({
    requests: [...snapshot.requests, { id, label, startedAt: Date.now(), background: !!opts.background }],
  })
  let ended = false
  return {
    signal: controller.signal,
    end: () => {
      if (ended) return
      ended = true
      controllers.delete(id)
      opts.signal?.removeEventListener('abort', forward)
      publish({ requests: snapshot.requests.filter(r => r.id !== id) })
    },
  }
}

/**
 * Cancel the AI work the user is waiting on: every foreground request in
 * flight is aborted, and batch runs (see runPool) stop before their next item.
 */
export function cancelAiRequests(): void {
  cancelEpoch++
  for (const r of snapshot.requests) {
    if (!r.background) controllers.get(r.id)?.abort(new DOMException('Cancelled', 'AbortError'))
  }
}

/** Increments on every cancel; a batch compares it with the value it started with. */
export function getAiCancelEpoch(): number {
  return cancelEpoch
}

export function subscribeAiActivity(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAiActivity(): AiActivity {
  return snapshot
}
