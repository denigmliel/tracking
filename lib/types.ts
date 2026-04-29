export interface ProjectReference {
  id: string
  projectCode: string
  customer: string
  account: string
  projectName: string
  searchableText: string
  rowNumber: number
  sheetName: string
  sourceValues: Record<string, string>
}

export interface ProjectReferenceDataset {
  fileName: string
  uploadedAt: string
  totalRows: number
  headers: string[]
  sheets: string[]
  detectedColumns: {
    projectCode: string | null
    customer: string | null
    projectName: string | null
  }
  references: ProjectReference[]
}

export interface ProjectReferenceMatch {
  referenceId: string
  projectCode: string
  customer: string
  projectName: string
  matchedBy: string
  confidence: number
}

export interface CalendarEvent {
  title: string
  date: string | null
  startTime: string | null
  endTime: string | null
  type: string
  customer: string
  projectCode: string
  activity: string
  rawText: string
  referenceMatch?: ProjectReferenceMatch | null
}

export interface SetupHints {
  envNames: string[]
  local: string
  vercel: string
}

export interface ProcessResponse {
  events?: CalendarEvent[]
  warning?: string
  mode?: 'ai' | 'fallback'
  setup?: SetupHints
  error?: string
}
