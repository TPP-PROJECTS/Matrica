import type { AppState } from '../types'

/**
 * Builds a structured research_context payload from the current AppState.
 * This is sent to /api/chat/assistant so the AI has full memory of the session.
 *
 * Every entity carries its `id`: the assistant emits reducer actions directly
 * (see lib/actionRegistry), so it must be able to reference entities by id.
 */
export function buildResearchContext(state: AppState) {
  // Step 2: all systems (with selection state) and selected systems
  const all_systems = state.systemItems.map(s => ({
    id: s.id,
    name: s.name,
    selected: s.selected,
    category: s.category,
  }))
  const selected_systems = state.systemItems
    .filter(s => s.selected)
    .map(s => s.name)

  // Step 3: topics, query count
  const all_topics = state.topics.map(t => ({
    id: t.id,
    title: t.title,
    selected: t.selected,
  }))
  const selected_topics = state.topics
    .filter(t => t.selected)
    .map(t => t.title)
  const total_queries = state.queries.length

  // Step 4: papers in review list + full search results pool (capped at 100)
  const review_papers = state.reviewList.map(p => ({
    id: p.id,
    title: p.title,
    authors: p.authors,
    year: p.year,
    status: p.status ?? 'maybe',
  }))
  const total_results = state.results.length

  // All search results (so the AI can add a paper to the review list by id).
  // Send at most 100 entries to keep context size manageable
  const reviewIds = new Set(state.reviewList.map(r => r.id))
  const search_results = state.results
    .slice(0, 100)
    .map(r => ({
      id: r.id,
      title: r.title,
      authors: r.authors,
      year: r.year,
      relevance: r.relevanceScore,
      in_review: reviewIds.has(r.id),
      status: r.status ?? null,
    }))

  // Step 5: matrix columns
  const lit_matrix_columns = state.matrixColumns
  const sys_matrix_columns = state.systemMatrixColumns

  // Step 6: themes with blocks
  const themes = state.themes.map(theme => ({
    id: theme.id,
    name: theme.name,
    coverage: theme.coverageLabel,
    paper_count: theme.paperCount,
    blocks: theme.blocks.map(block => ({
      id: block.id,
      block_type: block.blockType,
      title: block.title,
      content_preview: block.content.slice(0, 200),
    })),
  }))

  // Step 7: gaps, gap statement, selected RQ
  const all_gaps = state.gaps.map(g => ({
    id: g.id,
    label: g.label,
    type: g.type,
    selected: g.selected,
  }))
  const selected_gaps = state.gaps
    .filter(g => g.selected)
    .map(g => ({ id: g.id, label: g.label, type: g.type }))
  const gap_statement = state.gapStatement
  const selectedRQ = state.rqOptions.find(r => r.id === state.selectedRQId)
  const selected_rq = selectedRQ?.text ?? null
  const all_rqs = state.rqOptions.map(r => ({ id: r.id, text: r.text }))

  // Step 8: final topic, study design, paper structure
  const selectedFinalTopic = state.finalTopicOptions.find(
    t => t.id === state.selectedFinalTopicId
  )
  const final_topic_title = selectedFinalTopic?.title ?? null
  const all_final_topics = state.finalTopicOptions.map(t => ({ id: t.id, title: t.title }))

  const selectedDesign = state.studyDesignOptions.find(
    d => d.id === state.selectedStudyDesignId
  )
  const study_design = selectedDesign?.name ?? null
  const all_study_designs = state.studyDesignOptions.map(d => ({ id: d.id, name: d.name }))

  const activeFinalData = state.topicFinalData.find(
    d => d.topicId === state.selectedFinalTopicId
  )
  const paper_structure_sections = activeFinalData?.paperSections.map(s => s.name) ?? []

  return {
    current_step: state.currentStep,
    profile: {
      domain: state.profile.domain,
      population: state.profile.population,
      focus: state.profile.focus,
      method: state.profile.method,
      reviewType: state.profile.reviewType,
    },
    all_systems,
    selected_systems,
    selected_topics,
    all_topics,
    total_queries,
    total_results,
    search_results,
    review_papers,
    lit_matrix_columns,
    sys_matrix_columns,
    themes,
    selected_gaps,
    all_gaps,
    gap_statement,
    selected_rq,
    all_rqs,
    final_topic_title,
    all_final_topics,
    study_design,
    all_study_designs,
    paper_structure_sections,
  }
}
