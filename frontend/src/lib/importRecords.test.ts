import { describe, it, expect } from 'vitest'
import {
  parseRis, parseBibtex, parseReferenceFile, detectFormat,
  normaliseAuthor, parseYear, deLatex,
} from './importRecords'

// A Scopus-shaped RIS export: two spaces before the hyphen, a wrapped abstract,
// a date with trailing slashes, and no blank line between records.
const SCOPUS_RIS = `TY  - JOUR
TI  - Machine learning for sepsis prediction in the emergency department
AU  - Smith, John A.
AU  - Doe, Jane
AU  - Nguyen, Thi Minh
AU  - Okafor, Chidi
PY  - 2021///
AB  - Background: Early recognition of sepsis remains difficult.
Methods: We trained a gradient boosting model on 40,000 encounters.
JO  - Journal of Emergency Medicine
DO  - 10.1016/j.jem.2021.03.004
UR  - https://www.scopus.com/record/display.uri?eid=2-s2.0-85102
ER  -

TY  - CONF
TI  - Triage decision support: a controlled trial
A1  - Rossi, Marco
PY  - 2019/06/12/
UR  - https://doi.org/10.1109/ICHI.2019.00021
ER  -
`

describe('parseRis', () => {
  const { records, skipped } = parseRis(SCOPUS_RIS)

  it('reads every terminated record', () => {
    expect(records).toHaveLength(2)
    expect(skipped).toBe(0)
  })

  it('turns surname-first authors into citation order', () => {
    expect(records[0].authors).toEqual([
      'John A. Smith', 'Jane Doe', 'Thi Minh Nguyen', 'Chidi Okafor',
    ])
  })

  it('joins a wrapped abstract back into one field', () => {
    expect(records[0].abstract).toBe(
      'Background: Early recognition of sepsis remains difficult. ' +
      'Methods: We trained a gradient boosting model on 40,000 encounters.',
    )
  })

  it('takes the year out of a RIS date', () => {
    expect(records[0].year).toBe(2021)
    expect(records[1].year).toBe(2019)
  })

  it('accepts A1 where an exporter used it instead of AU', () => {
    expect(records[1].authors).toEqual(['Marco Rossi'])
  })

  it('falls back to the URL for a DOI when no DO tag was exported', () => {
    expect(records[0].doi).toBe('10.1016/j.jem.2021.03.004')
    expect(records[1].doi).toBe('10.1109/ICHI.2019.00021')
  })

  it('keeps a record whose ER terminator is missing', () => {
    const out = parseRis('TY  - JOUR\nTI  - An unterminated record\nPY  - 2020\n')
    expect(out.records.map(r => r.title)).toEqual(['An unterminated record'])
  })

  it('starts a new record at TY when the previous one was not terminated', () => {
    const out = parseRis('TY  - JOUR\nTI  - First\nTY  - JOUR\nTI  - Second\nER  -\n')
    expect(out.records.map(r => r.title)).toEqual(['First', 'Second'])
  })

  it('counts an entry with no title as skipped rather than importing a blank', () => {
    const out = parseRis('TY  - JOUR\nAU  - Ghost, A\nER  -\n')
    expect(out.records).toHaveLength(0)
    expect(out.skipped).toBe(1)
  })

  it('ignores exporter preamble before the first record', () => {
    const out = parseRis('Record 1 of 2\n\nTY  - JOUR\nTI  - Real\nER  -\n')
    expect(out.records.map(r => r.title)).toEqual(['Real'])
  })
})

const WOS_BIBTEX = `@article{ Smith2021Sepsis,
Author = {Smith, John A. and Doe, Jane and Nguyen, Thi Minh},
Title = {Machine learning for sepsis prediction, with {ED} triage data},
Journal = {JOURNAL OF EMERGENCY MEDICINE},
Year = {2021},
Volume = {60},
DOI = {10.1016/j.jem.2021.03.004},
Abstract = {Early recognition remains difficult; we trained a model.},
}

@inproceedings{Rossi2019,
  author = "Rossi, Marco and Müller, Jörg",
  title = "Triage decision support: a controlled trial",
  year = 2019,
  url = {\\url{https://doi.org/10.1109/ICHI.2019.00021}},
}
`

describe('parseBibtex', () => {
  const { records, skipped } = parseBibtex(WOS_BIBTEX)

  it('reads both entries', () => {
    expect(records).toHaveLength(2)
    expect(skipped).toBe(0)
  })

  it('keeps a braced acronym inside a title as part of the title', () => {
    expect(records[0].title).toBe('Machine learning for sepsis prediction, with ED triage data')
  })

  it('splits authors on "and", not on the comma inside a name', () => {
    expect(records[0].authors).toEqual(['John A. Smith', 'Jane Doe', 'Thi Minh Nguyen'])
  })

  it('accepts quote-delimited and bare values', () => {
    expect(records[1].title).toBe('Triage decision support: a controlled trial')
    expect(records[1].year).toBe(2019)
  })

  it('reads a DOI out of a url wrapped in \\url{}', () => {
    expect(records[1].doi).toBe('10.1109/ICHI.2019.00021')
  })

  it('skips @comment and @string blocks', () => {
    const out = parseBibtex('@string{jem = "J Emerg Med"}\n@article{a, title={Real}}\n')
    expect(out.records.map(r => r.title)).toEqual(['Real'])
    expect(out.skipped).toBe(0)
  })
})

describe('deLatex', () => {
  it('rebuilds accented characters rather than dropping the accent', () => {
    expect(deLatex("Jos{\\'e} Mu{\\~n}oz")).toBe('José Muñoz')
    expect(deLatex('J\\"org M\\"uller')).toBe('Jörg Müller')
    expect(deLatex('Fran\\c{c}ois')).toBe('François')
  })

  it('leaves a command name that only looks like an accent alone', () => {
    expect(deLatex('see \\url{https://example.org/a}')).toBe('see https://example.org/a')
  })

  it('renders escaped punctuation and dashes', () => {
    expect(deLatex('Risk \\& benefit, 2019--2021')).toBe('Risk & benefit, 2019–2021')
  })
})

describe('normaliseAuthor', () => {
  it('reorders a surname-first name', () => {
    expect(normaliseAuthor('Smith, John A.')).toBe('John A. Smith')
  })

  it('leaves an already-natural name alone', () => {
    expect(normaliseAuthor('John A. Smith')).toBe('John A. Smith')
  })

  it('treats only the first comma as the surname boundary', () => {
    expect(normaliseAuthor('Smith, John, Jr.')).toBe('John, Jr. Smith')
  })
})

describe('parseYear', () => {
  it('rejects a number that cannot be a publication year', () => {
    expect(parseYear('40,000 encounters in 2021')).toBe(2021)
  })

  it('returns 0 when there is no year at all', () => {
    expect(parseYear('n.d.')).toBe(0)
  })
})

describe('detectFormat', () => {
  it('recognises each format from its content', () => {
    expect(detectFormat(SCOPUS_RIS)).toBe('ris')
    expect(detectFormat(WOS_BIBTEX)).toBe('bibtex')
    expect(detectFormat('title,authors,year\nA study,Smith,2020')).toBeNull()
  })

  it('refuses a file it cannot parse instead of importing nothing silently', () => {
    expect(() => parseReferenceFile('just some prose')).toThrow(/RIS or BibTeX/)
  })

  it('tolerates a byte-order mark on the first tag', () => {
    const out = parseReferenceFile('\uFEFFTY  - JOUR\nTI  - Marked\nER  -\n')
    expect(out.format).toBe('ris')
    expect(out.records.map(r => r.title)).toEqual(['Marked'])
  })
})
