# NexaPlay AI — Batch 1 Data Pipeline

Pipeline Python 3.12+ ini mengumpulkan metadata inti untuk film, serial, drama Asia, serial streaming, dan anime. Semua provider dinormalisasi ke tabel Supabase `contents` dengan natural key `(source, external_id)` sehingga eksekusi berulang tidak membuat duplikat.

Batch ini hanya mencakup:

- TMDB Movie: popular, top rated, detail, credits.
- TMDB TV: popular, top rated, detail, aggregate credits.
- MyAnimeList API v2 resmi: top anime, anime musim berjalan, dan detail anime.
- Normalisasi, validasi Pydantic, logging, retry, dan upload Supabase.

Fitur AI, embedding, vector database, RAG, rekomendasi, OMDb, YouTube, dan Wikidata tidak termasuk Batch 1.

## Struktur

```text
data-pipeline/
├── config/settings.py
├── database/
│   ├── supabase_client.py
│   └── uploader.py
├── logs/
│   ├── pipeline.log
│   └── import_report.json
├── processors/normalizer.py
├── sources/
│   ├── http_client.py
│   ├── mal_anime.py
│   ├── tmdb_movie.py
│   └── tmdb_series.py
├── tests/
├── .env.example
├── main.py
└── requirements.txt
```

## Instalasi

```bash
cd data-pipeline
python -m venv .venv
```

Aktifkan virtual environment, lalu:

```bash
python -m pip install -r requirements.txt
```

Salin `.env.example` menjadi `.env` dan isi kredensial:

```dotenv
TMDB_API_KEY=...
MAL_CLIENT_ID=...
MAL_CLIENT_SECRET=...
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_KEY=SERVICE_ROLE_KEY
BATCH_SIZE=100
MOVIE_PAGES=50
SERIES_PAGES=50
ANIME_PAGES=10
```

Gunakan Supabase service-role key hanya di pipeline backend. Jangan kirim key tersebut ke browser atau commit ke Git.

TMDB API key dibuat dari akun TMDB. MyAnimeList client dibuat dari halaman API settings akun MAL. Endpoint katalog publik MAL dapat dibaca dengan `MAL_CLIENT_ID`. Dukungan OAuth PKCE juga tersedia melalui `exchange_authorization_code()` dan token dapat diperbarui otomatis dengan `MAL_REFRESH_TOKEN` ketika bearer token kedaluwarsa.

Variabel OAuth opsional:

```dotenv
MAL_ACCESS_TOKEN=
MAL_REFRESH_TOKEN=
MAL_REDIRECT_URI=
```

## Menjalankan pipeline

Impor semua provider memakai jumlah halaman dari `.env`:

```bash
python main.py
```

Override semua jumlah halaman untuk satu eksekusi:

```bash
python main.py --pages 5
```

Atur setiap provider secara terpisah melalui `.env` atau CLI:

```bash
python main.py --movie-pages 50 --series-pages 50 --anime-pages 10
```

Jalankan provider tertentu saja:

```bash
python main.py --source tmdb-movies --source mal-anime
```

Uji API dan normalisasi tanpa menulis ke Supabase:

```bash
python main.py --dry-run
```

Log lengkap disimpan di `logs/pipeline.log`. Ringkasan terbaru disimpan sebagai JSON di `logs/import_report.json`. Kegagalan satu provider dicatat dan tidak membatalkan provider lain.

## Pemetaan database

Setiap record mengisi kolom Batch 1 pada tabel `contents`: identitas provider, klasifikasi, judul, deskripsi, media, genre, bahasa/negara, tanggal rilis, durasi, season/episode, studio/network/platform, creator/director/cast/character, rating, dan popularity.

Nilai scalar yang tidak tersedia tidak dikirim sehingga Supabase dapat memakai `NULL` atau mempertahankan data lama. Kolom JSON memakai array kosong agar sesuai constraint JSONB. Anime selalu memakai `source = MAL`; Jikan tidak digunakan.

Catatan: MyAnimeList API v2 resmi saat ini tidak menyediakan endpoint karakter anime. Karena Batch 1 dilarang memakai Jikan atau sumber lain, `characters` untuk MAL disimpan sebagai array kosong sampai provider resmi mendukungnya atau Batch berikutnya menambahkan sumber enrichment.

`series_type` ditentukan otomatis dengan urutan:

1. South Korea → `kdrama`
2. Japan → `jdrama`
3. China → `cdrama`
4. Network streaming → `streaming_series`
5. Lainnya → `tv_series`

Untuk MAL, `media_type` dipetakan ke `anime_series`, `anime_movie`, atau `ova`.

## Contoh output

```text
Pipeline Batch 1 started
Importing TMDB movies...
Importing TMDB series...
Importing MyAnimeList anime...

============================
NEXAPLAY AI BATCH 1 REPORT

TMDB MOVIES:
1000

TMDB SERIES:
1000

MAL ANIME:
500

FAILED:
0

TOTAL IMPORTED:
2500
============================
```

## Testing

```bash
python -m unittest discover -s tests -v
```

Test mencakup normalisasi TMDB Movie, TMDB Series, MAL Anime, ukuran batch Supabase, dan pencegahan duplikat.

Referensi API: [TMDB developer docs](https://developer.themoviedb.org/reference/intro/getting-started) dan [MyAnimeList API v2](https://myanimelist.net/apiconfig/references/api/v2).
