import { NextRequest, NextResponse } from 'next/server'

import {
  findBestProjectReference,
  formatProjectReferencesForPrompt,
  normalizeLookupText,
  shortlistProjectReferences,
} from '@/lib/project-references'
import type { CalendarEvent, ProjectReference } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 30

const MONTH_INDEX: Record<string, number> = {
  januari: 1,
  january: 1,
  jan: 1,
  februari: 2,
  february: 2,
  feb: 2,
  maret: 3,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  mei: 5,
  may: 5,
  juni: 6,
  june: 6,
  jun: 6,
  juli: 7,
  july: 7,
  jul: 7,
  agustus: 8,
  august: 8,
  agu: 8,
  ags: 8,
  aug: 8,
  september: 9,
  sep: 9,
  oktober: 10,
  october: 10,
  okt: 10,
  oct: 10,
  november: 11,
  nov: 11,
  desember: 12,
  december: 12,
  des: 12,
  dec: 12,
}

const GENERIC_CUSTOMER_TERMS = new Set([
  'closed',
  'open',
  'report',
  'laporan',
  'activity',
  'aktivitas',
  'daily',
  'weekly',
  'monthly',
  'task',
  'ticket',
  'backup',
  'restore',
  'config',
  'configuration',
  'konfigurasi',
  'ip',
  'ip address',
  'gateway',
  'subnet',
  'dns',
  'route',
  'interface',
  'server',
  'router',
])

const GENERIC_ACTIVITY_TERMS = new Set([
  'aktivitas dokumen',
  'dokumen',
  'document',
  'report',
  'laporan',
  'activity',
  'aktivitas',
  'closed',
  'open',
  'task',
])

const WORK_ACTIVITY_PATTERN =
  /\b(meeting|rapat|diskusi|review|maintenance|implementasi|implementation|submit|bast|training|visit|support|install|instalasi|troubleshoot|cutover|deploy|deployment|testing|uji|analisa|analisis|koordinasi|monitoring|handover|survey|check|validasi|presentasi|workshop|nda|agreement|kontrak|contract|perjanjian|mou|proposal|quotation|invoice|purchase order|procurement|legal|draft|approval|signature|ttd)\b/i

const PROJECT_CONTEXT_PATTERN =
  /\b(project|proyek|kp|kode project|kode proyek|maintenance|implementasi|implementation|support|install|instalasi|cutover|deploy|deployment|go live|go-live|survey|monitoring|handover|testing|uji|task|ticket|troubleshoot|bast)\b/i

const NON_PROJECT_DOCUMENT_PATTERN =
  /\b(nda|non[- ]?disclosure|confidentiality|agreement|kontrak|contract|perjanjian|mou|memorandum of understanding|proposal|quotation|penawaran|invoice|tagihan|purchase order|\bpo\b|procurement|legal|surat kuasa)\b/i

const DOCUMENT_ACTIVITY_RULES = [
  {
    pattern: /\b(?:nda|non[- ]?disclosure(?: agreement)?|confidentiality agreement)\b/i,
    label: 'NDA',
  },
  {
    pattern: /\b(?:mou|memorandum of understanding)\b/i,
    label: 'MoU',
  },
  {
    pattern: /\b(?:bast|berita acara serah terima)\b/i,
    label: 'BAST',
  },
  {
    pattern: /\b(?:spk|surat perintah kerja)\b/i,
    label: 'SPK',
  },
  {
    pattern: /\b(?:contract|kontrak|agreement|perjanjian)\b/i,
    label: 'Kontrak',
  },
  {
    pattern: /\b(?:proposal|quotation|penawaran)\b/i,
    label: 'Proposal',
  },
  {
    pattern: /\b(?:invoice|tagihan|billing)\b/i,
    label: 'Invoice',
  },
  {
    pattern: /\b(?:purchase order|\bpo\b)\b/i,
    label: 'Purchase Order',
  },
  {
    pattern: /\b(?:mom|minutes of meeting|notulen)\b/i,
    label: 'Notulen Meeting',
  },
] as const

const DOCUMENT_ACTION_RULES = [
  { pattern: /\b(review|reviewing)\b/i, label: 'Review' },
  { pattern: /\b(revisi|revision|amend(?:ment)?|update|perubahan)\b/i, label: 'Revisi' },
  { pattern: /\b(submit|submission|pengajuan|kirim|send)\b/i, label: 'Submit' },
  { pattern: /\b(approval|approve|persetujuan|acc)\b/i, label: 'Approval' },
  { pattern: /\b(sign|signed|signature|ttd|tanda tangan)\b/i, label: 'Tanda Tangan' },
  { pattern: /\b(renewal|extend|extension|perpanjangan)\b/i, label: 'Perpanjangan' },
  { pattern: /\b(draft|drafting|buat|membuat|pembuatan|create|creation|penyusunan|prepare|preparation)\b/i, label: 'Pembuatan' },
] as const

const TECHNICAL_LINE_PATTERNS = [
  /\bip[ -]?address\b/i,
  /\bipv[46]\b/i,
  /\bgateway\b/i,
  /\bsubnet\b/i,
  /\bnetmask\b/i,
  /\bdns\b/i,
  /\broute\b/i,
  /\binterface\b/i,
  /\bethernet\b/i,
  /\bmac[ -]?address\b/i,
  /\bhostname\b/i,
  /\bcomment\b/i,
  /\bmtu\b/i,
  /\bprefix\b/i,
]

function normalizeWhitespace(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripFileExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '')
}

function formatDocumentLabel(fileName: string | null) {
  if (!fileName) return ''

  return normalizeWhitespace(
    stripFileExtension(fileName)
      .replace(/[._-]+/g, ' ')
      .replace(/[()[\]]/g, ' '),
  )
}

async function extractDocumentText(file: File | null, manualText: string | null) {
  if (file) {
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const fileName = file.name.toLowerCase()

    if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      return normalizeWhitespace(result.value)
    }

    if (fileName.endsWith('.pdf')) {
      try {
        const pdfParse = await import('pdf-parse/lib/pdf-parse.js')
        const result = await pdfParse.default(buffer)
        return normalizeWhitespace(result.text)
      } catch {
        return normalizeWhitespace(
          buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t\u00C0-\u024F]/g, ' '),
        )
      }
    }

    return normalizeWhitespace(buffer.toString('utf-8'))
  }

  if (manualText) {
    return normalizeWhitespace(manualText)
  }

  return ''
}

function getAnthropicApiKey() {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || ''
}

function getAnthropicModel() {
  return process.env.ANTHROPIC_MODEL || 'claude-opus-4-5'
}

function getSetupHints() {
  return {
    envNames: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
    local: 'Buat file .env.local dari .env.example lalu isi API key Anthropic.',
    vercel: 'Buka Project > Settings > Environment Variables di Vercel, lalu tambahkan ANTHROPIC_API_KEY.',
  }
}

function toIsoDate(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function toTime(hourText: string, minuteText = '00') {
  const hour = Number(hourText)
  const minute = Number(minuteText)

  if (Number.isNaN(hour) || Number.isNaN(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function addOneHour(time: string | null) {
  if (!time) return null

  const [hourText, minuteText] = time.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)

  if (Number.isNaN(hour) || Number.isNaN(minute)) return null

  const totalMinutes = hour * 60 + minute + 60
  const nextHour = Math.floor((totalMinutes % (24 * 60)) / 60)
  const nextMinute = totalMinutes % 60

  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`
}

interface ProcessedTiming {
  date: string | null
  startTime: string | null
  endTime: string | null
}

function readProcessedTiming(formData: FormData): ProcessedTiming {
  const rawDate = formData.get('processedAtDate')
  const rawTime = formData.get('processedAtTime')
  const date = typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null
  const startTime = typeof rawTime === 'string' && /^\d{2}:\d{2}$/.test(rawTime) ? rawTime : null

  return {
    date,
    startTime,
    endTime: addOneHour(startTime),
  }
}

function extractDate(text: string) {
  const isoMatch = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/)
  if (isoMatch) {
    return toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
  }

  const localMatch = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/)
  if (localMatch) {
    const day = Number(localMatch[1])
    const month = Number(localMatch[2])
    const rawYear = Number(localMatch[3])
    const year = rawYear < 100 ? 2000 + rawYear : rawYear
    return toIsoDate(year, month, day)
  }

  const monthPattern = Object.keys(MONTH_INDEX).join('|')
  const textMonthMatch = text.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})\\b`, 'i'))
  if (textMonthMatch) {
    const day = Number(textMonthMatch[1])
    const month = MONTH_INDEX[textMonthMatch[2].toLowerCase()]
    const year = Number(textMonthMatch[3])
    return toIsoDate(year, month, day)
  }

  return null
}

function extractTimeRange(text: string) {
  const rangeMatch = text.match(
    /\b(?:jam|pukul|pk\.?\s*)?(\d{1,2})[:.](\d{2})(?:\s*(?:-|sampai|s\/d|sd|to)\s*(\d{1,2})[:.](\d{2}))?/i,
  )

  if (rangeMatch) {
    const startTime = toTime(rangeMatch[1], rangeMatch[2])
    const endTime = rangeMatch[3] && rangeMatch[4] ? toTime(rangeMatch[3], rangeMatch[4]) : null
    return { startTime, endTime }
  }

  const hourOnlyMatch = text.match(
    /\b(?:jam|pukul|pk\.?\s*)(\d{1,2})(?:\s*(?:-|sampai|s\/d|sd|to)\s*(\d{1,2}))?\b/i,
  )

  if (hourOnlyMatch) {
    const startTime = toTime(hourOnlyMatch[1])
    const endTime = hourOnlyMatch[2] ? toTime(hourOnlyMatch[2]) : null
    return { startTime, endTime }
  }

  return { startTime: null, endTime: null }
}

function extractProjectCode(text: string) {
  const projectMatch = text.match(/\b([A-Z]{1,6}[A-Z0-9-]*\d{3,}[A-Z0-9-]*)\b/)
  return projectMatch?.[1] || ''
}

function cleanCustomer(value: string) {
  return value
    .replace(/[.,;:()[\]"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTechnicalLine(text: string) {
  const normalized = normalizeLookupText(text)

  if (!normalized) return true
  if (TECHNICAL_LINE_PATTERNS.some((pattern) => pattern.test(text))) return true

  if (
    /^[a-z0-9_.-]+\s*[:=]/i.test(text) &&
    normalized.split(' ').length <= 8 &&
    !WORK_ACTIVITY_PATTERN.test(text) &&
    !extractDate(text) &&
    !extractTimeRange(text).startTime
  ) {
    return true
  }

  return false
}

function hasUsableCustomer(value: string) {
  const cleaned = cleanCustomer(value)
  const normalized = normalizeLookupText(cleaned)

  if (!normalized || normalized.length < 3) return false
  if (GENERIC_CUSTOMER_TERMS.has(normalized)) return false
  if (isTechnicalLine(cleaned)) return false
  if (extractProjectCode(cleaned) && normalizeLookupText(extractProjectCode(cleaned)) === normalized) return false

  return true
}

function extractCustomer(text: string) {
  const patterns = [
    /\b(?:dengan|bersama|customer|klien|client|akun|account)\s+([A-Z][A-Za-z0-9&.,-]*(?:\s+[A-Z][A-Za-z0-9&.,-]*){0,3})/i,
    /\b(?:meeting|rapat|support|maintenance|implementasi|visit|call)\s+(?:dengan|ke|untuk)\s+([A-Z][A-Za-z0-9&.,-]*(?:\s+[A-Z][A-Za-z0-9&.,-]*){0,3})/i,
    /\b(?:site|lokasi)\s+([A-Z][A-Za-z0-9&.,-]*(?:\s+[A-Z][A-Za-z0-9&.,-]*){0,2})/i,
    /\b(?:nda|non[- ]?disclosure(?: agreement)?|agreement|contract|kontrak|perjanjian|mou|memorandum of understanding|bast|proposal|quotation|invoice|purchase order|\bpo\b)\s+(?:untuk|dengan|ke|atas nama)?\s*([A-Z][A-Za-z0-9&.,-]*(?:\s+[A-Z][A-Za-z0-9&.,-]*){0,4})/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue

    const candidate = cleanCustomer(match[1])
    if (hasUsableCustomer(candidate)) return candidate
  }

  return ''
}

function inferDocumentActivity(text: string) {
  const normalizedText = normalizeWhitespace(text)
  if (!normalizedText) return ''

  const documentRule = DOCUMENT_ACTIVITY_RULES.find((rule) => rule.pattern.test(normalizedText))
  if (!documentRule) return ''

  const actionRule = DOCUMENT_ACTION_RULES.find((rule) => rule.pattern.test(normalizedText))
  if (actionRule) return `${actionRule.label} ${documentRule.label}`
  if (documentRule.label === 'Notulen Meeting') return documentRule.label

  return `Pembuatan ${documentRule.label}`
}

function guessType(text: string) {
  if (/\b(implementasi|implementation|deploy|deployment|go live|go-live|install|instalasi|rollout|cutover)\b/i.test(text)) {
    return 'I'
  }

  return 'M'
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function looksLowValueActivity(activity: string) {
  const normalized = normalizeLookupText(activity)

  if (!normalized) return true
  if (GENERIC_ACTIVITY_TERMS.has(normalized)) return true
  if (isTechnicalLine(activity)) return true
  if (normalized.length < 4) return true

  return false
}

function buildActivity(text: string, customer: string, projectCode: string) {
  const inferredDocumentActivity = inferDocumentActivity(text)
  let activity = text
    .replace(/\b(?:tanggal|tgl|jam|pukul|pk)\b/gi, ' ')
    .replace(/\b(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/gi, ' ')
    .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g, ' ')
    .replace(/\b\d{1,2}\s+(?:januari|january|jan|februari|february|feb|maret|march|mar|april|apr|mei|may|juni|june|jun|juli|july|jul|agustus|august|agu|ags|aug|september|sep|oktober|october|okt|oct|november|nov|desember|december|des|dec)\s+\d{4}\b/gi, ' ')
    .replace(/\b\d{1,2}[:.]\d{2}(?:\s*(?:-|sampai|s\/d|sd|to)\s*\d{1,2}[:.]\d{2})?\b/gi, ' ')
    .replace(/\b(?:meeting|rapat)\s+dengan\b/gi, ' ')
    .replace(/\b(?:customer|klien|client|akun|account|project|proyek|kode)\b/gi, ' ')

  if (customer) {
    activity = activity.replace(new RegExp(escapeRegExp(customer), 'ig'), ' ')
  }

  if (projectCode) {
    activity = activity.replace(new RegExp(escapeRegExp(projectCode), 'ig'), ' ')
  }

  activity = activity
    .replace(/\s+/g, ' ')
    .replace(/^[,.;:()\-]+|[,.;:()\-]+$/g, '')
    .trim()

  if (!activity) {
    if (inferredDocumentActivity) return inferredDocumentActivity
    if (/\b(?:meeting|rapat|diskusi|call)\b/i.test(text)) return 'Meeting'
    if (/\breview\b/i.test(text)) return 'Review dokumen'
    if (/\b(?:maintenance|support)\b/i.test(text)) return 'Maintenance'
    if (/\b(?:implementasi|deployment|install|instalasi)\b/i.test(text)) return 'Implementasi'
    return 'Aktivitas dokumen'
  }

  if (inferredDocumentActivity && (looksLowValueActivity(activity) || activity.split(' ').length <= 3)) {
    return inferredDocumentActivity
  }

  if (activity.length > 90) {
    return `${activity.slice(0, 87).trim()}...`
  }

  return activity
}

function buildDocumentActivity(documentLabel: string, customer: string, projectCode: string) {
  const inferredDocumentActivity = inferDocumentActivity(documentLabel)
  let activity = documentLabel
    .replace(/[_-]+/g, ' ')
    .replace(/\b(?:laporan|report|doc|document|dokumen|hasil|file)\b/gi, ' ')

  if (customer) {
    activity = activity.replace(new RegExp(escapeRegExp(customer), 'ig'), ' ')
  }

  if (projectCode) {
    activity = activity.replace(new RegExp(escapeRegExp(projectCode), 'ig'), ' ')
  }

  activity = normalizeWhitespace(activity)

  if (inferredDocumentActivity) {
    return inferredDocumentActivity
  }

  if (looksLowValueActivity(activity)) {
    const fallbackLabel = normalizeWhitespace(documentLabel.replace(/[_-]+/g, ' '))
    const fallbackActivity = inferDocumentActivity(fallbackLabel)
    if (fallbackActivity) return fallbackActivity
    if (!looksLowValueActivity(fallbackLabel)) {
      return fallbackLabel.length > 90 ? `${fallbackLabel.slice(0, 87).trim()}...` : fallbackLabel
    }
  }

  if (!activity) return 'Aktivitas dokumen'
  if (activity.length > 90) return `${activity.slice(0, 87).trim()}...`

  return activity
}

function buildTitle(type: string, customer: string, projectCode: string, activity: string) {
  const parts = [`[${type || 'M'}]`]

  if (customer) parts.push(`[${customer}]`)
  if (projectCode) parts.push(`[${projectCode}]`)

  parts.push(activity || 'Aktivitas dokumen')

  return parts.join(' ')
}

function scoreSegment(text: string) {
  let score = 0

  if (extractDate(text)) score += 2
  if (extractTimeRange(text).startTime) score += 2
  if (extractProjectCode(text)) score += 1
  if (WORK_ACTIVITY_PATTERN.test(text)) score += 2
  if (inferDocumentActivity(text)) score += 2
  if (text.length >= 20) score += 1
  if (isTechnicalLine(text)) score -= 3

  return score
}

function normalizeEvent(candidate: Partial<CalendarEvent>, rawTextFallback = ''): CalendarEvent {
  const type = candidate.type === 'I' ? 'I' : 'M'
  const customer = hasUsableCustomer(candidate.customer || '') ? cleanCustomer(candidate.customer || '') : ''
  const projectCode = (candidate.projectCode || '').trim()
  const activity = (candidate.activity || '').trim() || 'Aktivitas dokumen'
  const date = candidate.date && /^\d{4}-\d{2}-\d{2}$/.test(candidate.date) ? candidate.date : null
  const startTime = candidate.startTime && /^\d{2}:\d{2}$/.test(candidate.startTime) ? candidate.startTime : null
  const endTime = candidate.endTime && /^\d{2}:\d{2}$/.test(candidate.endTime) ? candidate.endTime : null
  const rawText = (candidate.rawText || rawTextFallback || activity).trim()
  const title = buildTitle(type, customer, projectCode, activity).trim()

  return {
    title,
    date,
    startTime,
    endTime,
    type,
    customer,
    projectCode,
    activity,
    rawText,
    referenceMatch: candidate.referenceMatch || null,
  }
}

function createCandidateSegments(documentText: string) {
  const segments = documentText
    .split(/\n{2,}/)
    .flatMap((block) => block.split(/\n|\u2022/))
    .map((segment) => normalizeWhitespace(segment))
    .filter((segment) => segment.length >= 12)
    .filter((segment) => !isTechnicalLine(segment))

  const uniqueSegments: string[] = []
  const seen = new Set<string>()

  for (const segment of segments) {
    const key = segment.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    uniqueSegments.push(segment)
  }

  const scored = uniqueSegments
    .map((segment) => ({ segment, score: scoreSegment(segment) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.segment.length - right.segment.length)

  return scored.map((item) => item.segment).slice(0, 10)
}

function buildDocumentSummaryEvent(
  documentText: string,
  documentLabel: string,
  processedTiming: ProcessedTiming,
  seedEvent?: CalendarEvent | null,
) {
  const summarySource = [documentLabel, seedEvent?.rawText].filter(Boolean).join('\n')
  const queryText = [documentLabel, documentText].filter(Boolean).join('\n')
  const customer = extractCustomer(documentLabel) || seedEvent?.customer || extractCustomer(documentText)
  const projectCode = extractProjectCode(documentLabel) || seedEvent?.projectCode || extractProjectCode(documentText)
  const type = seedEvent?.type || guessType(queryText)
  const labelActivity = buildDocumentActivity(documentLabel, customer, projectCode)
  const seedActivity = seedEvent?.activity && !looksLowValueActivity(seedEvent.activity) ? seedEvent.activity : ''
  const activity = !looksLowValueActivity(labelActivity)
    ? labelActivity
    : seedActivity || 'Aktivitas dokumen'
  const extractedTimeRange = seedEvent?.startTime
    ? { startTime: seedEvent.startTime, endTime: seedEvent.endTime || addOneHour(seedEvent.startTime) }
    : extractTimeRange(documentText)
  const date = processedTiming.date || seedEvent?.date || extractDate(documentText)
  const startTime = processedTiming.startTime || extractedTimeRange.startTime
  const endTime = processedTiming.endTime || extractedTimeRange.endTime || addOneHour(startTime)

  return normalizeEvent(
    {
      type,
      customer,
      projectCode,
      activity,
      date,
      startTime,
      endTime,
      rawText: summarySource || documentText.substring(0, 500),
      referenceMatch: seedEvent?.referenceMatch || null,
    },
    summarySource || documentText,
  )
}

function pickBestSummarySeed(events: CalendarEvent[]) {
  if (events.length === 0) return null

  const ranked = [...events].sort((left, right) => {
    const leftScore = Number(Boolean(left.projectCode)) * 3 + Number(Boolean(left.customer)) * 2 + Number(Boolean(left.date)) + Number(Boolean(left.startTime)) + Number(!looksLowValueActivity(left.activity)) * 3
    const rightScore = Number(Boolean(right.projectCode)) * 3 + Number(Boolean(right.customer)) * 2 + Number(Boolean(right.date)) + Number(Boolean(right.startTime)) + Number(!looksLowValueActivity(right.activity)) * 3
    return rightScore - leftScore
  })

  return ranked[0]
}

function applyProcessedTimingToEvent(event: CalendarEvent, processedTiming: ProcessedTiming) {
  return normalizeEvent(
    {
      ...event,
      date: event.date || processedTiming.date,
      startTime: event.startTime || processedTiming.startTime,
      endTime: event.endTime || processedTiming.endTime || addOneHour(event.startTime || processedTiming.startTime),
    },
    event.rawText,
  )
}

function finalizeEvents(
  events: CalendarEvent[],
  documentText: string,
  documentLabel: string,
  preferSingleEvent: boolean,
  processedTiming: ProcessedTiming,
) {
  if (!preferSingleEvent) {
    return events.length > 0
      ? events.map((event) => applyProcessedTimingToEvent(event, processedTiming))
      : [buildDocumentSummaryEvent(documentText, documentLabel, processedTiming)]
  }

  return [buildDocumentSummaryEvent(documentText, documentLabel, processedTiming, pickBestSummarySeed(events))]
}

function fallbackExtractEvents(
  documentText: string,
  documentLabel: string,
  preferSingleEvent: boolean,
  processedTiming: ProcessedTiming,
) {
  const segments = createCandidateSegments(documentText)

  const events = segments.map((segment) => {
    const projectCode = extractProjectCode(segment)
    const customer = extractCustomer(segment)
    const type = guessType(segment)
    const { startTime, endTime } = extractTimeRange(segment)
    const activity = buildActivity(segment, customer, projectCode)

    return normalizeEvent(
      {
        date: extractDate(segment),
        startTime,
        endTime: endTime || addOneHour(startTime),
        type,
        customer,
        projectCode,
        activity,
        rawText: segment,
      },
      segment,
    )
  })

  return finalizeEvents(events, documentText, documentLabel, preferSingleEvent, processedTiming)
}

function parseAiEvents(rawContent: string) {
  let parsed: unknown

  try {
    const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    const match = rawContent.match(/\[[\s\S]*\]/)
    if (!match) {
      throw new Error('Tidak dapat memparse respons AI')
    }

    parsed = JSON.parse(match[0])
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Format respons AI tidak valid')
  }

  return parsed.map((item) => normalizeEvent((item as Partial<CalendarEvent>) || {}))
}

function sanitizeProjectReferences(rawValue: FormDataEntryValue | null) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return [] as ProjectReference[]
  }

  try {
    const parsed = JSON.parse(rawValue)
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null

        const reference = item as Partial<ProjectReference>
        return {
          id: String(reference.id || ''),
          projectCode: String(reference.projectCode || ''),
          customer: String(reference.customer || ''),
          account: String(reference.account || ''),
          projectName: String(reference.projectName || ''),
          searchableText: String(reference.searchableText || ''),
          rowNumber: Number(reference.rowNumber || 0),
          sheetName: String(reference.sheetName || ''),
          sourceValues:
            reference.sourceValues && typeof reference.sourceValues === 'object'
              ? Object.fromEntries(
                  Object.entries(reference.sourceValues).map(([key, value]) => [key, String(value || '')]),
                )
              : {},
        } satisfies ProjectReference
      })
      .filter((reference): reference is ProjectReference => Boolean(reference && (reference.projectCode || reference.customer)))
      .slice(0, 1000)
  } catch {
    return []
  }
}

function applyProjectReferences(events: CalendarEvent[], projectReferences: ProjectReference[], documentContextText: string) {
  if (projectReferences.length === 0) {
    return events
  }

  return events.map((event) => {
    const bestMatch = findBestProjectReference(event, projectReferences, documentContextText)
    if (!bestMatch) return event

    const reference = bestMatch.reference
    const existingProjectCode = normalizeLookupText(event.projectCode)
    const matchedProjectCode = normalizeLookupText(reference.projectCode)
    const documentLooksProjectRelated =
      Boolean(event.projectCode) ||
      PROJECT_CONTEXT_PATTERN.test([event.activity, event.rawText, documentContextText].join(' '))
    const documentLooksNonProject =
      NON_PROJECT_DOCUMENT_PATTERN.test([event.activity, event.rawText, documentContextText].join(' ')) &&
      !documentLooksProjectRelated
    const shouldUseReferenceCode =
      !documentLooksNonProject &&
      documentLooksProjectRelated &&
      Boolean(reference.projectCode) &&
      (!event.projectCode || existingProjectCode === matchedProjectCode || bestMatch.score >= 60)
    const shouldUseReferenceCustomer = !hasUsableCustomer(event.customer) && hasUsableCustomer(reference.customer || reference.account)
    const nextCustomer = shouldUseReferenceCustomer ? reference.customer || reference.account : event.customer
    const nextProjectCode = shouldUseReferenceCode ? reference.projectCode : event.projectCode
    const usedReference = nextCustomer !== event.customer || nextProjectCode !== event.projectCode

    if (!usedReference) return event

    return normalizeEvent(
      {
        ...event,
        customer: nextCustomer,
        projectCode: nextProjectCode,
        referenceMatch: {
          referenceId: reference.id,
          projectCode: reference.projectCode,
          customer: reference.customer,
          projectName: reference.projectName,
          matchedBy: bestMatch.matchedBy || 'referensi KP',
          confidence: bestMatch.confidence,
        },
      },
      event.rawText,
    )
  })
}

function buildReferenceSection(documentContextText: string, projectReferences: ProjectReference[]) {
  if (projectReferences.length === 0) return ''

  const shortlistedReferences = shortlistProjectReferences(projectReferences, documentContextText, 30)
  if (shortlistedReferences.length === 0) return ''

  return `
Gunakan referensi KP berikut bila cocok dengan isi dokumen. Jika dokumen jelas mengarah ke salah satu referensi project, isi field projectCode dengan KP dari referensi tersebut.
Jika tidak ada referensi yang cocok, biarkan projectCode kosong.

Referensi KP:
${formatProjectReferencesForPrompt(shortlistedReferences)}
`
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const manualText = formData.get('text') as string | null
    const projectReferences = sanitizeProjectReferences(formData.get('projectReferences'))
    const processedTiming = readProcessedTiming(formData)
    const documentText = await extractDocumentText(file, manualText)
    const documentLabel = formatDocumentLabel(file?.name || null)
    const documentContextText = [documentLabel, documentText].filter(Boolean).join('\n')
    const preferSingleEvent = Boolean(file)

    if (!documentText.trim()) {
      return NextResponse.json({ error: 'Dokumen kosong atau tidak dapat dibaca' }, { status: 400 })
    }

    const apiKey = getAnthropicApiKey()

    if (!apiKey) {
      return NextResponse.json({
        events: applyProjectReferences(
          fallbackExtractEvents(documentText, documentLabel, preferSingleEvent, processedTiming),
          projectReferences,
          documentContextText,
        ),
        documentText: documentText.substring(0, 500),
        mode: 'fallback',
        warning:
          'API key Anthropic belum dikonfigurasi. Hasil di bawah dibuat dengan parser lokal, mengikuti nama dokumen yang di-upload, dan memakai tanggal/jam saat Anda upload.',
        setup: getSetupHints(),
      })
    }

    const prompt = `Kamu adalah asisten yang membantu mengekstrak informasi dari dokumen kerja, administrasi, legal, atau project untuk membuat event Google Calendar.

Nama dokumen:
${documentLabel || 'Tidak ada nama file'}

Format event Google Calendar yang dibutuhkan adalah:
[Tipe] [Customer/Account] [Kode Project] Deskripsi Aktivitas

Dimana:
- Tipe: [M] untuk Maintenance, [I] untuk Implementasi
- Customer/Account: nama perusahaan/customer bila jelas (contoh: Pertamina, Gudang Garam, PLN)
- Kode Project: isi dengan nomor KP atau kode project seperti TBxxxx0002 hanya jika memang relevan atau cocok kuat dengan referensi KP
- Deskripsi Aktivitas: ringkasan singkat aktivitas atau tujuan dokumen, misalnya Pembuatan NDA, Review Kontrak, Submit Proposal, Pembuatan BAST
${buildReferenceSection(documentContextText, projectReferences)}
Aturan penting:
- Jika file ini adalah satu laporan pekerjaan, hasilkan SATU event utama yang mengikuti nama dokumen.
- Jika file ini adalah dokumen non-project seperti NDA, kontrak, MoU, proposal, invoice, purchase order, notulen, atau dokumen legal/administrasi lain, fokuskan judul pada tujuan dokumen tersebut.
- Jangan membuat judul event dari baris teknis acak seperti ip-address, ipv4.gateway, dns, subnet, route, interface, hostname, atau config line.
- Gunakan nama dokumen sebagai petunjuk utama untuk judul aktivitas jika isi dokumen terlalu teknis atau berisik.
- Jika dokumen tidak menunjukkan hubungan yang jelas ke project/KP, biarkan projectCode kosong.
- Untuk file upload, tanggal dan jam event utama harus mengikuti waktu upload/proses saat ini.

Dari dokumen berikut, ekstrak kegiatan yang benar-benar layak menjadi event calendar. Untuk setiap kegiatan, identifikasi:
1. Judul event dalam format Google Calendar di atas
2. Tanggal (jika ada)
3. Jam mulai (jika ada)
4. Jam selesai (jika ada)

Jika informasi tipe tidak jelas, gunakan [M] sebagai default.
Jika kode project tidak ada dan tidak cocok dengan referensi KP, kosongkan saja bagian itu.
Jika tanggal/jam tidak tersebut, isi dengan null.
Jawab HANYA dengan JSON array seperti ini (tanpa markdown, tanpa penjelasan):
[
  {
    "title": "[M] [Pertamina] [TB00010002] Review Dokumen Teknis",
    "date": "2024-06-17",
    "startTime": "09:30",
    "endTime": "10:30",
    "type": "M",
    "customer": "Pertamina",
    "projectCode": "TB00010002",
    "activity": "Review Dokumen Teknis",
    "rawText": "Kalimat asli dari dokumen yang relevan"
  }
]

Dokumen:
---
${documentText.substring(0, 8000)}
---`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: getAnthropicModel(),
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Anthropic API error:', errorText)

      return NextResponse.json({
        events: applyProjectReferences(
          fallbackExtractEvents(documentText, documentLabel, preferSingleEvent, processedTiming),
          projectReferences,
          documentContextText,
        ),
        documentText: documentText.substring(0, 500),
        mode: 'fallback',
        warning:
          'AI tidak bisa dipanggil saat ini. Hasil di bawah dibuat dengan parser lokal, mengikuti nama dokumen yang di-upload, dan memakai tanggal/jam saat Anda upload.',
        setup: getSetupHints(),
      })
    }

    const aiResponse = await response.json()
    const rawContent = aiResponse.content?.[0]?.text || ''

    try {
      const finalizedEvents = finalizeEvents(parseAiEvents(rawContent), documentText, documentLabel, preferSingleEvent, processedTiming)

      return NextResponse.json({
        events: applyProjectReferences(finalizedEvents, projectReferences, documentContextText),
        documentText: documentText.substring(0, 500),
        mode: 'ai',
      })
    } catch (error) {
      console.error('AI parse error:', error)

      return NextResponse.json({
        events: applyProjectReferences(
          fallbackExtractEvents(documentText, documentLabel, preferSingleEvent, processedTiming),
          projectReferences,
          documentContextText,
        ),
        documentText: documentText.substring(0, 500),
        mode: 'fallback',
        warning:
          'Respons AI tidak bisa dibaca dengan aman, jadi sistem memakai parser lokal, mengikuti nama dokumen yang di-upload, dan memakai tanggal/jam saat Anda upload.',
        setup: getSetupHints(),
      })
    }
  } catch (error) {
    console.error('Process error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}







