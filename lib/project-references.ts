import type { CalendarEvent, ProjectReference, ProjectReferenceDataset } from '@/lib/types'

const PROJECT_CODE_PATTERN = /\b([A-Z]{1,6}[A-Z0-9-]*\d{3,}[A-Z0-9-]*)\b/

const PROJECT_CODE_HEADERS = [
  'kp',
  'nomor kp',
  'no kp',
  'kode kp',
  'kode project',
  'kode proyek',
  'project code',
  'project id',
  'project number',
  'kode pekerjaan',
]

const CUSTOMER_HEADERS = [
  'customer',
  'nama customer',
  'customer name',
  'account',
  'nama account',
  'client',
  'klien',
  'perusahaan',
  'company',
  'instansi',
  'site',
  'lokasi',
]

const PROJECT_NAME_HEADERS = [
  'project',
  'nama project',
  'nama proyek',
  'project name',
  'proyek',
  'pekerjaan',
  'deskripsi',
  'description',
  'aktivitas',
  'task',
  'judul',
]

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeLookupText(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeHeader(value: string) {
  return normalizeLookupText(value)
}

function tokenize(value: string) {
  return normalizeLookupText(value)
    .split(' ')
    .filter((token) => token.length >= 3)
}

function uniqueTokens(value: string) {
  return Array.from(new Set(tokenize(value)))
}

function looksLikeProjectCode(value: string) {
  return PROJECT_CODE_PATTERN.test(value.trim())
}

function extractProjectCodeCandidate(value: string) {
  const match = value.match(PROJECT_CODE_PATTERN)
  return match?.[1] || ''
}

function scoreHeader(header: string, candidates: string[]) {
  const normalized = normalizeHeader(header)

  if (!normalized) return 0
  if (candidates.includes(normalized)) return 100
  if (candidates.some((candidate) => normalized.includes(candidate))) return 60
  return 0
}

function detectColumn(headers: string[], candidates: string[]) {
  let bestHeader: string | null = null
  let bestScore = 0

  for (const header of headers) {
    const score = scoreHeader(header, candidates)
    if (score > bestScore) {
      bestHeader = header
      bestScore = score
    }
  }

  return bestHeader
}

function stringifyCellValue(value: unknown) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return normalizeWhitespace(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  return normalizeWhitespace(String(value))
}

function pickBestCustomer(sourceValues: Record<string, string>, customerColumn: string | null) {
  if (customerColumn && sourceValues[customerColumn]) {
    return sourceValues[customerColumn]
  }

  for (const [key, value] of Object.entries(sourceValues)) {
    const normalizedKey = normalizeHeader(key)
    if (normalizedKey === 'no' || normalizedKey === 'nomor') continue
    if (PROJECT_CODE_HEADERS.some((header) => normalizedKey.includes(header))) continue
    if (!value || value.length < 3) continue
    if (looksLikeProjectCode(value)) continue
    if (/\d{5,}/.test(value)) continue
    return value
  }

  return ''
}

function pickBestProjectName(
  sourceValues: Record<string, string>,
  projectNameColumn: string | null,
  projectCodeColumn: string | null,
  customerColumn: string | null,
) {
  if (projectNameColumn && sourceValues[projectNameColumn]) {
    return sourceValues[projectNameColumn]
  }

  for (const [key, value] of Object.entries(sourceValues)) {
    if (!value || value.length < 4) continue
    if (key === projectCodeColumn || key === customerColumn) continue
    if (looksLikeProjectCode(value)) continue
    return value
  }

  return ''
}

export function createProjectReferenceDataset(
  rows: Array<Record<string, unknown>>,
  options: { fileName: string; uploadedAt?: string; sheetName: string; sheets?: string[] },
) {
  const normalizedRows = rows
    .map((row) => {
      const normalized: Record<string, string> = {}
      for (const [key, value] of Object.entries(row)) {
        const stringValue = stringifyCellValue(value)
        if (stringValue) normalized[key] = stringValue
      }
      return normalized
    })
    .filter((row) => Object.keys(row).length > 0)

  const headers = Array.from(new Set(normalizedRows.flatMap((row) => Object.keys(row))))
  const projectCodeColumn = detectColumn(headers, PROJECT_CODE_HEADERS)
  const customerColumn = detectColumn(headers, CUSTOMER_HEADERS)
  const projectNameColumn = detectColumn(headers, PROJECT_NAME_HEADERS)

  const references: ProjectReference[] = normalizedRows
    .map((sourceValues, index) => {
      const rawProjectCode =
        (projectCodeColumn ? sourceValues[projectCodeColumn] : '') ||
        Object.values(sourceValues).find((value) => looksLikeProjectCode(value)) ||
        ''
      const projectCode = extractProjectCodeCandidate(rawProjectCode)
      const customer = pickBestCustomer(sourceValues, customerColumn)
      const projectName = pickBestProjectName(sourceValues, projectNameColumn, projectCodeColumn, customerColumn)
      const account = customer
      const searchableText = Object.values(sourceValues).join(' | ')

      if (!projectCode && !customer) {
        return null
      }

      return {
        id: `${options.sheetName}-${index + 2}-${projectCode || customer || 'row'}`,
        projectCode,
        customer,
        account,
        projectName,
        searchableText,
        rowNumber: index + 2,
        sheetName: options.sheetName,
        sourceValues,
      }
    })
    .filter((reference): reference is ProjectReference => Boolean(reference))

  return {
    fileName: options.fileName,
    uploadedAt: options.uploadedAt || new Date().toISOString(),
    totalRows: normalizedRows.length,
    headers,
    sheets: options.sheets || [options.sheetName],
    detectedColumns: {
      projectCode: projectCodeColumn,
      customer: customerColumn,
      projectName: projectNameColumn,
    },
    references,
  } satisfies ProjectReferenceDataset
}

function countOverlap(source: string, target: string) {
  const sourceTokens = uniqueTokens(source)
  const targetTokens = new Set(uniqueTokens(target))
  let overlap = 0

  for (const token of sourceTokens) {
    if (targetTokens.has(token)) overlap += 1
  }

  return overlap
}

function containsNormalized(haystack: string, needle: string) {
  const normalizedHaystack = normalizeLookupText(haystack)
  const normalizedNeedle = normalizeLookupText(needle)

  if (!normalizedHaystack || !normalizedNeedle) return false
  return normalizedHaystack.includes(normalizedNeedle)
}

function scoreReferenceAgainstEvent(event: CalendarEvent, reference: ProjectReference, documentText: string) {
  let score = 0
  const reasons: string[] = []
  const queryText = [event.customer, event.activity, event.rawText, documentText].join(' ')

  if (event.projectCode && reference.projectCode) {
    const eventCode = normalizeLookupText(event.projectCode)
    const referenceCode = normalizeLookupText(reference.projectCode)

    if (eventCode === referenceCode) {
      score += 100
      reasons.push('kode project exact')
    }
  }

  if (reference.projectCode && containsNormalized(queryText, reference.projectCode)) {
    score += 40
    reasons.push('kode project di dokumen')
  }

  if (event.customer && reference.customer) {
    const eventCustomer = normalizeLookupText(event.customer)
    const referenceCustomer = normalizeLookupText(reference.customer)

    if (eventCustomer === referenceCustomer) {
      score += 35
      reasons.push('customer exact')
    } else if (
      eventCustomer &&
      referenceCustomer &&
      (eventCustomer.includes(referenceCustomer) || referenceCustomer.includes(eventCustomer))
    ) {
      score += 22
      reasons.push('customer mirip')
    }
  }

  if (reference.customer && containsNormalized(queryText, reference.customer)) {
    score += 18
    reasons.push('customer ada di dokumen')
  }

  if (reference.projectName && containsNormalized(queryText, reference.projectName)) {
    score += 16
    reasons.push('nama project ada di dokumen')
  }

  const overlap = countOverlap(queryText, reference.searchableText)
  if (overlap > 0) {
    score += Math.min(overlap * 3, 18)
    reasons.push(`overlap kata ${overlap}`)
  }

  return {
    score,
    matchedBy: reasons.join(', '),
  }
}

export function findBestProjectReference(event: CalendarEvent, references: ProjectReference[], documentText: string) {
  let bestReference: ProjectReference | null = null
  let bestScore = 0
  let bestMatchedBy = ''

  for (const reference of references) {
    const { score, matchedBy } = scoreReferenceAgainstEvent(event, reference, documentText)

    if (score > bestScore) {
      bestReference = reference
      bestScore = score
      bestMatchedBy = matchedBy
    }
  }

  if (!bestReference || bestScore < 20) {
    return null
  }

  return {
    reference: bestReference,
    score: bestScore,
    matchedBy: bestMatchedBy,
    confidence: Math.min(bestScore / 100, 0.99),
  }
}

export function shortlistProjectReferences(references: ProjectReference[], queryText: string, limit = 25) {
  const ranked = references
    .map((reference) => {
      let score = 0

      if (reference.projectCode && containsNormalized(queryText, reference.projectCode)) score += 40
      if (reference.customer && containsNormalized(queryText, reference.customer)) score += 24
      if (reference.projectName && containsNormalized(queryText, reference.projectName)) score += 16

      const overlap = countOverlap(queryText, reference.searchableText)
      score += Math.min(overlap * 2, 12)

      return { reference, score }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)

  return ranked.slice(0, limit).map((item) => item.reference)
}

export function formatProjectReferencesForPrompt(references: ProjectReference[]) {
  if (references.length === 0) return 'Tidak ada referensi KP.'

  return references
    .map((reference, index) => {
      const parts = [
        `${index + 1}. KP: ${reference.projectCode || '-'}`,
        `Customer: ${reference.customer || '-'}`,
      ]

      if (reference.projectName) {
        parts.push(`Project: ${reference.projectName}`)
      }

      return parts.join(' | ')
    })
    .join('\n')
}

