import type { Metadata, Viewport } from 'next'
import { Sora, DM_Mono } from 'next/font/google'
import './globals.css'

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['300', '400', '500', '600', '700'],
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['300', '400', '500'],
})

export const metadata: Metadata = {
  title: 'GCal Event Generator',
  description: 'Upload dokumen kerja, legal, atau project untuk generate format Google Calendar otomatis',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'GCal Gen',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0a0f',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="id">
      <body className={`${sora.variable} ${dmMono.variable}`}>{children}</body>
    </html>
  )
}
