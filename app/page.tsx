'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Upload,
  FileText,
  Calendar,
  Copy,
  Check,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Clock,
  Building2,
  Hash,
  Zap,
  Database,
} from 'lucide-react'

import { createProjectReferenceDataset } from '@/lib/project-references'
import type { CalendarEvent, ProcessResponse, ProjectReferenceDataset } from '@/lib/types'

const STORAGE_KEY = 'gcal-kp-reference-v1'

function addOneHour(time: string) {
  const [hourText, minuteText] = time.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)

  if (Number.isNaN(hour) || Number.isNaN(minute)) return null

  const totalMinutes = hour * 60 + minute + 60
  const nextHour = Math.floor((totalMinutes % (24 * 60)) / 60)
  const nextMinute = totalMinutes % 60

  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`
}

function mergeReferenceDatasets(datasets: ProjectReferenceDataset[], fileName: string): ProjectReferenceDataset {
  const seen = new Set<string>()
  const references = [] as ProjectReferenceDataset['references']

  for (const dataset of datasets) {
    for (const reference of dataset.references) {
      const key = [reference.projectCode, reference.customer, reference.projectName]
        .join('|')
        .toLowerCase()

      if (seen.has(key)) continue
      seen.add(key)
      references.push(reference)
    }
  }

  return {
    fileName,
    uploadedAt: new Date().toISOString(),
    totalRows: datasets.reduce((total, dataset) => total + dataset.totalRows, 0),
    headers: Array.from(new Set(datasets.flatMap((dataset) => dataset.headers))),
    sheets: Array.from(new Set(datasets.flatMap((dataset) => dataset.sheets))),
    detectedColumns: {
      projectCode: datasets.find((dataset) => dataset.detectedColumns.projectCode)?.detectedColumns.projectCode || null,
      customer: datasets.find((dataset) => dataset.detectedColumns.customer)?.detectedColumns.customer || null,
      projectName: datasets.find((dataset) => dataset.detectedColumns.projectName)?.detectedColumns.projectName || null,
    },
    references,
  }
}

function formatUploadedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [manualText, setManualText] = useState('')
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [referenceError, setReferenceError] = useState('')
  const [referenceLoading, setReferenceLoading] = useState(false)
  const [referenceDataset, setReferenceDataset] = useState<ProjectReferenceDataset | null>(null)
  const [processingMode, setProcessingMode] = useState<'ai' | 'fallback' | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [inputMode, setInputMode] = useState<'file' | 'text'>('file')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const referenceInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      const rawValue = window.localStorage.getItem(STORAGE_KEY)
      if (!rawValue) return

      const parsed = JSON.parse(rawValue) as ProjectReferenceDataset
      if (!parsed || !Array.isArray(parsed.references)) return
      setReferenceDataset(parsed)
    } catch {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(false)
    const dropped = event.dataTransfer.files[0]
    if (dropped) setFile(dropped)
  }, [])

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleReferenceUpload = async (uploadedFile: File) => {
    setReferenceLoading(true)
    setReferenceError('')

    try {
      const XLSX = await import('xlsx')
      const buffer = await uploadedFile.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array', raw: false })
      const datasets = workbook.SheetNames.map((sheetName) => {
        const sheet = workbook.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false })
        return createProjectReferenceDataset(rows, {
          fileName: uploadedFile.name,
          sheetName,
          uploadedAt: new Date().toISOString(),
          sheets: workbook.SheetNames,
        })
      }).filter((dataset) => dataset.references.length > 0)

      if (datasets.length === 0) {
        throw new Error('Tidak ada data KP yang terbaca dari file Excel tersebut')
      }

      const mergedDataset = mergeReferenceDatasets(datasets, uploadedFile.name)
      setReferenceDataset(mergedDataset)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedDataset))
    } catch (uploadError: unknown) {
      setReferenceError(uploadError instanceof Error ? uploadError.message : 'Gagal membaca file Excel')
    } finally {
      setReferenceLoading(false)
    }
  }

  const handleProcess = async () => {
    if (!file && !manualText.trim()) return

    setLoading(true)
    setError('')
    setWarning('')
    setProcessingMode(null)
    setEvents([])

    try {
      const formData = new FormData()
      if (inputMode === 'file' && file) {
        formData.append('file', file)
      } else {
        formData.append('text', manualText)
      }

      const processedAt = new Date()
      const processedDate = `${processedAt.getFullYear()}-${String(processedAt.getMonth() + 1).padStart(2, '0')}-${String(processedAt.getDate()).padStart(2, '0')}`
      const processedTime = `${String(processedAt.getHours()).padStart(2, '0')}:${String(processedAt.getMinutes()).padStart(2, '0')}`
      formData.append('processedAtDate', processedDate)
      formData.append('processedAtTime', processedTime)

      if (referenceDataset?.references.length) {
        formData.append('projectReferences', JSON.stringify(referenceDataset.references))
      }

      const response = await fetch('/api/process', { method: 'POST', body: formData })
      const data = (await response.json()) as ProcessResponse

      if (!response.ok) {
        throw new Error(data.error || 'Terjadi kesalahan')
      }

      setEvents(Array.isArray(data.events) ? data.events : [])
      setWarning(data.warning || '')
      setProcessingMode(data.mode || null)
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : 'Terjadi kesalahan')
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = async (text: string, index: number, field: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedIndex(index)
    setCopiedField(field)
    setTimeout(() => {
      setCopiedIndex(null)
      setCopiedField(null)
    }, 2000)
  }

  const formatDateTime = (event: CalendarEvent) => {
    if (!event.date) return null

    const parts = []
    const date = new Date(`${event.date}T00:00:00`)
    parts.push(
      date.toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    )

    if (event.startTime) {
      const endTime = event.endTime || addOneHour(event.startTime)
      let timeRange = event.startTime
      if (endTime) timeRange += ` - ${endTime}`
      parts.push(timeRange)
    }

    return parts.join(' | ')
  }

  const getGoogleCalendarUrl = (event: CalendarEvent) => {
    if (!event.date || !event.startTime) return null

    const endTime = event.endTime || addOneHour(event.startTime)
    if (!endTime) return null

    const dateText = event.date.replace(/-/g, '')
    const startText = `${dateText}T${event.startTime.replace(':', '')}00`
    const endText = `${dateText}T${endTime.replace(':', '')}00`
    const url = new URL('https://calendar.google.com/calendar/render')
    const details = [event.rawText]

    if (event.referenceMatch?.projectCode) {
      details.push(`KP match: ${event.referenceMatch.projectCode}`)
      details.push(`Sumber referensi: ${event.referenceMatch.customer || '-'}`)
    }

    url.searchParams.set('action', 'TEMPLATE')
    url.searchParams.set('text', event.title)
    url.searchParams.set('dates', `${startText}/${endText}`)
    url.searchParams.set('details', details.filter(Boolean).join('\n'))

    return url.toString()
  }

  const typeColor = (type: string) => {
    if (type === 'M') return 'text-purple-400 bg-purple-400/10 border-purple-400/30'
    if (type === 'I') return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30'
    return 'text-blue-400 bg-blue-400/10 border-blue-400/30'
  }

  const hasInput = inputMode === 'file' ? Boolean(file) : Boolean(manualText.trim())

  return (
    <main className="min-h-screen grid-bg relative">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-purple-600/10 blur-[120px] pointer-events-none" />

      <div className="relative max-w-4xl mx-auto px-4 py-8 pb-20">
        <header className="text-center mb-10 animate-fade-up">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-300 text-xs font-medium mb-4">
            <Sparkles className="w-3 h-3" />
            Referensi KP + analisis dokumen kerja
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3 glow-text" style={{ fontFamily: 'var(--font-display)' }}>
            GCal Event Generator
          </h1>
          <p className="text-[var(--text-muted)] text-sm sm:text-base max-w-2xl mx-auto">
            Simpan referensi KP dari Excel bila perlu, lalu upload dokumen kerja, administrasi, legal, atau project agar
            sistem menyusun judul event, customer, KP opsional, aktivitas, tanggal, dan jam sesuai isi file.
          </p>
        </header>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-6 animate-fade-up animate-delay-100">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
            <div>
              <p className="text-[var(--text)] font-semibold flex items-center gap-2">
                <Database className="w-4 h-4 text-[var(--accent-2)]" />
                Referensi KP dari Excel
              </p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Upload file `.xlsx`, `.xls`, atau `.csv`. Data akan disimpan di browser ini dan dipakai otomatis saat Anda
                memproses dokumen yang memang terkait project/KP.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={referenceInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={async (event) => {
                  const uploadedFile = event.target.files?.[0]
                  if (uploadedFile) await handleReferenceUpload(uploadedFile)
                  event.target.value = ''
                }}
              />
              <button
                onClick={() => referenceInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Upload Excel KP
              </button>
              {referenceDataset && (
                <button
                  onClick={() => {
                    setReferenceDataset(null)
                    setReferenceError('')
                    window.localStorage.removeItem(STORAGE_KEY)
                  }}
                  className="px-4 py-2 rounded-xl border border-red-500/30 text-red-300 text-sm hover:bg-red-500/10 transition-colors"
                >
                  Hapus Referensi
                </button>
              )}
            </div>
          </div>

          {referenceLoading && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/40 px-4 py-3 text-sm text-[var(--text-muted)] flex items-center gap-2">
              <Loader2 className="w-4 h-4 spin-slow" />
              Membaca file Excel dan menyusun referensi KP...
            </div>
          )}

          {referenceError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {referenceError}
            </div>
          )}

          {referenceDataset ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/35 p-3">
                  <p className="text-xs text-[var(--text-dim)] mb-1">File aktif</p>
                  <p className="text-sm text-[var(--text)] break-words">{referenceDataset.fileName}</p>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/35 p-3">
                  <p className="text-xs text-[var(--text-dim)] mb-1">Jumlah KP</p>
                  <p className="text-sm text-[var(--text)]">{referenceDataset.references.length} referensi</p>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/35 p-3">
                  <p className="text-xs text-[var(--text-dim)] mb-1">Sheet dibaca</p>
                  <p className="text-sm text-[var(--text)]">{referenceDataset.sheets.join(', ')}</p>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/35 p-3">
                  <p className="text-xs text-[var(--text-dim)] mb-1">Disimpan</p>
                  <p className="text-sm text-[var(--text)]">{formatUploadedAt(referenceDataset.uploadedAt)}</p>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                Referensi KP aktif. Saat dokumen project diproses, sistem akan mencoba mencari KP yang paling cocok dari
                Excel ini tanpa memaksa KP ke dokumen non-project seperti NDA atau kontrak.
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--text-dim)] mb-3">Preview referensi</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {referenceDataset.references.slice(0, 4).map((reference) => (
                    <div key={reference.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/35 p-3">
                      <p className="text-[var(--text)] text-sm font-medium">{reference.customer || 'Customer belum terbaca'}</p>
                      <p className="text-xs text-[var(--accent-2)] font-mono mt-1">{reference.projectCode || 'KP belum terbaca'}</p>
                      {reference.projectName && (
                        <p className="text-xs text-[var(--text-muted)] mt-2 leading-relaxed">{reference.projectName}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : !referenceLoading ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/35 px-4 py-3 text-sm text-[var(--text-muted)]">
              Belum ada referensi KP yang tersimpan. App tetap bisa memproses dokumen, tetapi pengisian KP hanya mengandalkan isi dokumen.
            </div>
          ) : null}
        </section>

        <div className="flex rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-1 mb-6 animate-fade-up animate-delay-200">
          <button
            onClick={() => setInputMode('file')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              inputMode === 'file'
                ? 'bg-[var(--accent)] text-white shadow-lg'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            <Upload className="w-4 h-4" />
            Upload Dokumen
          </button>
          <button
            onClick={() => setInputMode('text')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              inputMode === 'text'
                ? 'bg-[var(--accent)] text-white shadow-lg'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            <FileText className="w-4 h-4" />
            Paste Teks
          </button>
        </div>

        {inputMode === 'file' && (
          <div className="animate-fade-up animate-delay-200 mb-6">
            <div
              className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                isDragging
                  ? 'drop-zone-active'
                  : file
                    ? 'border-[var(--accent-2)] bg-[var(--accent-2)]/5'
                    : 'border-[var(--border)] hover:border-[var(--border-bright)] bg-[var(--bg-card)]'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.doc,.pdf,.txt"
                className="hidden"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />

              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[var(--accent-2)]/20 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-[var(--accent-2)]" />
                  </div>
                  <div className="text-left">
                    <p className="text-[var(--text)] font-medium text-sm truncate max-w-[200px]">{file.name}</p>
                    <p className="text-[var(--text-muted)] text-xs">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    onClick={(event) => {
                      event.stopPropagation()
                      setFile(null)
                    }}
                    className="ml-auto p-2 rounded-lg hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div>
                  <div className="w-14 h-14 rounded-2xl bg-[var(--bg-hover)] border border-[var(--border)] flex items-center justify-center mx-auto mb-4">
                    <Upload className="w-6 h-6 text-[var(--text-muted)]" />
                  </div>
                  <p className="text-[var(--text)] font-medium mb-1">Drop dokumen kerja atau klik untuk upload</p>
                  <p className="text-[var(--text-muted)] text-xs">.docx, .doc, .pdf, .txt</p>
                </div>
              )}
            </div>
          </div>
        )}

        {inputMode === 'text' && (
          <div className="animate-fade-up animate-delay-200 mb-6">
            <textarea
              value={manualText}
              onChange={(event) => setManualText(event.target.value)}
              placeholder={`Paste isi dokumen atau catatan kerja di sini...

Contoh:
Meeting dengan Pertamina tanggal 17 Juni 2024 jam 09:30 - 10:30 untuk pembuatan BAST dan submit project.

Atau:
Draft NDA untuk Pertamina akan direview dan disubmit hari ini. Jika referensi KP Excel aktif, sistem hanya akan mengisi KP bila dokumen memang terkait project.`}
              className="w-full h-52 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] p-4 text-sm resize-none focus:outline-none focus:border-[var(--accent)] transition-colors placeholder:text-[var(--text-dim)]"
              style={{ fontFamily: 'var(--font-display)' }}
            />
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
            <p className="font-semibold text-red-200 mb-1">Permintaan gagal</p>
            <p>{error}</p>
          </div>
        )}

        {warning && (
          <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-100 text-sm">
            <p className="font-semibold text-amber-200 mb-1">Mode parser lokal aktif</p>
            <p>{warning}</p>
          </div>
        )}

        <button
          onClick={handleProcess}
          disabled={!hasInput || loading}
          className={`w-full py-4 rounded-2xl font-semibold text-base transition-all mb-8 flex items-center justify-center gap-3 ${
            !hasInput || loading
              ? 'bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-dim)] cursor-not-allowed'
              : 'bg-[var(--accent)] text-white hover:opacity-90 glow-accent'
          }`}
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 spin-slow" />
              Sedang menganalisis dokumen dan mencocokkan referensi...
            </>
          ) : (
            <>
              <Zap className="w-5 h-5" />
              Proses dokumen dan susun event
            </>
          )}
        </button>

        {loading && (
          <div className="space-y-3 mb-8">
            {[1, 2].map((item) => (
              <div key={item} className="h-24 rounded-2xl border border-[var(--border)] overflow-hidden">
                <div className="h-full shimmer" />
              </div>
            ))}
          </div>
        )}

        {events.length > 0 && (
          <div className="space-y-4 animate-fade-up">
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <h2 className="text-[var(--text)] font-semibold">{events.length} Event ditemukan</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-card)] px-3 py-1 rounded-full border border-[var(--border)]">
                  Klik judul untuk copy
                </span>
                {processingMode && (
                  <span
                    className={`text-xs px-3 py-1 rounded-full border ${
                      processingMode === 'ai'
                        ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                        : 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                    }`}
                  >
                    {processingMode === 'ai' ? 'Mode AI' : 'Mode lokal'}
                  </span>
                )}
              </div>
            </div>

            {events.map((event, index) => {
              const dateTime = formatDateTime(event)
              const gcalUrl = getGoogleCalendarUrl(event)
              const isExpanded = expandedIndex === index

              return (
                <div key={index} className="result-card overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-md border ${typeColor(event.type)}`}>
                        {event.type || '?'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <button onClick={() => copyToClipboard(event.title, index, 'title')} className="copy-btn w-full text-left group">
                          <p className="event-title text-[var(--text)] text-sm font-medium leading-relaxed break-words group-hover:text-[var(--accent)] transition-colors">
                            {event.title}
                          </p>
                        </button>
                        {event.referenceMatch?.projectCode && event.projectCode === event.referenceMatch.projectCode && (
                          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200">
                            <Database className="w-3 h-3" />
                            KP cocok dari Excel: {event.referenceMatch.projectCode}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => copyToClipboard(event.title, index, 'title')}
                        className="copy-btn shrink-0 p-2 rounded-lg bg-[var(--bg-hover)] hover:bg-[var(--accent)]/20 transition-colors"
                        title="Copy judul"
                      >
                        {copiedIndex === index && copiedField === 'title' ? (
                          <Check className="w-4 h-4 text-[var(--accent-2)]" />
                        ) : (
                          <Copy className="w-4 h-4 text-[var(--text-muted)]" />
                        )}
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      {event.customer && (
                        <span className="flex items-center gap-1 text-[var(--text-muted)]">
                          <Building2 className="w-3 h-3" />
                          {event.customer}
                        </span>
                      )}
                      {event.projectCode && (
                        <span className="flex items-center gap-1 text-[var(--text-muted)] font-mono">
                          <Hash className="w-3 h-3" />
                          {event.projectCode}
                        </span>
                      )}
                      {dateTime && (
                        <span className="flex items-center gap-1 text-[var(--text-muted)]">
                          <Clock className="w-3 h-3" />
                          {dateTime}
                        </span>
                      )}
                    </div>
                  </div>

                  {dateTime && (
                    <div className="border-t border-[var(--border)] px-4 py-2.5 flex items-center justify-between bg-[var(--bg)]/40">
                      <span className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {dateTime}
                      </span>
                      <button
                        onClick={() => copyToClipboard(dateTime, index, 'date')}
                        className="copy-btn flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors px-2 py-1 rounded hover:bg-[var(--bg-hover)]"
                      >
                        {copiedIndex === index && copiedField === 'date' ? (
                          <>
                            <Check className="w-3 h-3 text-[var(--accent-2)]" />
                            Tersalin
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy tanggal
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  <div className="border-t border-[var(--border)] px-4 py-2.5 flex items-center justify-between gap-3">
                    {gcalUrl ? (
                      <a
                        href={gcalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        Buka di Google Calendar
                      </a>
                    ) : (
                      <span className="text-xs text-[var(--text-dim)]">Tanggal atau jam belum terdeteksi</span>
                    )}

                    <button
                      onClick={() => setExpandedIndex(isExpanded ? null : index)}
                      className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                    >
                      Sumber
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-[var(--border)] px-4 py-3 bg-[var(--bg)]/40 space-y-3">
                      {event.referenceMatch && event.projectCode === event.referenceMatch.projectCode && (
                        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                          <p className="font-medium mb-1">Hasil pencocokan KP</p>
                          <p>KP: {event.referenceMatch.projectCode || '-'}</p>
                          <p>Customer referensi: {event.referenceMatch.customer || '-'}</p>
                          <p>Dasar match: {event.referenceMatch.matchedBy || '-'}</p>
                        </div>
                      )}
                      <p className="text-xs text-[var(--text-muted)] italic leading-relaxed">"{event.rawText}"</p>
                    </div>
                  )}
                </div>
              )
            })}

            <button
              onClick={() => {
                const allTitles = events
                  .map((event) => {
                    let line = event.title
                    const dateTime = formatDateTime(event)
                    if (dateTime) line += `\n${dateTime}`
                    return line
                  })
                  .join('\n\n')

                navigator.clipboard.writeText(allTitles)
                setCopiedIndex(-1)
                setTimeout(() => setCopiedIndex(null), 2000)
              }}
              className="copy-btn w-full py-3 rounded-2xl border border-[var(--border)] hover:border-[var(--accent)] text-[var(--text-muted)] hover:text-[var(--accent)] text-sm font-medium flex items-center justify-center gap-2 transition-all"
            >
              {copiedIndex === -1 ? (
                <>
                  <Check className="w-4 h-4 text-[var(--accent-2)]" />
                  Semua tersalin
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy semua event
                </>
              )}
            </button>
          </div>
        )}

        {!loading && events.length === 0 && !error && (
          <div className="text-center py-8 text-[var(--text-dim)] text-sm animate-fade-up animate-delay-300">
            <div className="w-16 h-16 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] flex items-center justify-center mx-auto mb-3">
              <Calendar className="w-7 h-7" />
            </div>
            <p>Upload referensi KP opsional, lalu proses dokumen untuk mulai</p>
            <p className="text-xs mt-1 text-[var(--text-dim)]/60">Mendukung dokumen project, NDA, kontrak, proposal, invoice, dan catatan kerja</p>
          </div>
        )}
      </div>

      <footer className="fixed bottom-0 left-0 right-0 border-t border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-md py-3 px-4">
        <p className="text-center text-xs text-[var(--text-dim)]">
          Format: <span className="text-[var(--text-muted)] font-mono">[M/I] [Customer] [NomorKP opsional] Aktivitas atau tujuan dokumen</span>
        </p>
      </footer>
    </main>
  )
}


