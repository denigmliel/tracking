# GCal Event Generator

Web app Next.js untuk mengubah dokumen kerja, catatan meeting, dokumen legal/administrasi, atau teks manual menjadi format event Google Calendar dengan bantuan referensi KP dari file Excel.

## Format Output

```text
[M] [Pertamina] [TB00010002] Pembuatan BAST dan Submit
[M] [Pertamina] Pembuatan NDA
```

- `[M]` = Maintenance
- `[I]` = Implementasi
- `[Customer]` = nama perusahaan atau akun
- `[NomorKP]` = nomor KP atau kode project bila relevan
- `Aktivitas` = aktivitas pekerjaan aktual atau tujuan dokumen

## Alur Pakai

1. Upload file Excel referensi KP (`.xlsx`, `.xls`, atau `.csv`).
2. Referensi disimpan di browser ini dan dipakai otomatis saat analisis berikutnya.
3. Upload dokumen (`.docx`, `.doc`, `.pdf`, `.txt`) atau paste teks manual.
4. Sistem mengekstrak tipe pekerjaan, customer, KP opsional, aktivitas, tanggal, dan jam.
5. Hasil bisa langsung di-copy atau dibuka ke Google Calendar.

## Konfigurasi API

App ini mendukung env berikut:

- `ANTHROPIC_API_KEY`
- `CLAUDE_API_KEY`

Opsional:

- `ANTHROPIC_MODEL`

Jika API key belum diisi, app tetap jalan dengan parser lokal sebagai fallback. Referensi KP dari Excel tetap akan dipakai saat mencari kode project yang paling cocok, tetapi tidak akan dipaksakan ke dokumen non-project seperti NDA atau kontrak.

## Development Lokal

Install dependency:

```bash
npm install
```

Buat `.env.local` dari `.env.example`, lalu isi API key:

```env
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx
```

Jalankan development server:

```bash
npm run dev
```

Buka `http://localhost:3000`.

## Deploy ke Vercel

1. Push project ke GitHub.
2. Import repository di Vercel.
3. Masuk ke `Project > Settings > Environment Variables`.
4. Tambahkan `ANTHROPIC_API_KEY` dengan API key Anthropic Anda.
5. Deploy.

Jika ingin mengganti model:

```env
ANTHROPIC_MODEL=claude-opus-4-5
```

## Install sebagai Web App

Setelah deploy ke Vercel:

- Android: Chrome > menu > `Add to Home Screen`
- iPhone/iPad: Safari > Share > `Add to Home Screen`
- Desktop: Chrome/Edge > klik ikon install di address bar

## Tech Stack

- Next.js 14
- Tailwind CSS
- Anthropic API
- Mammoth
- pdf-parse
- xlsx
