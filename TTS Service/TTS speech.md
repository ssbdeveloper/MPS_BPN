Saya ingin membuat sistem Text-to-Speech (TTS) notification untuk project existing.

PENTING:
Sebelum membuat kode:
1. Inspect struktur project existing terlebih dahulu.
2. Inspect package.json, tsconfig, env, folder structure, database config, websocket/event system, dan pola coding project.
3. Inspect schema PostgreSQL existing.
4. Jangan langsung modify project utama.
5. Buat folder/service baru terpisah:
   services/tts-notification-service
   atau
   tts-notification-service
6. Setelah memahami struktur project baru implementasi.

Target system:
- Production deploy di Linux.
- Development/testing di laptop Windows lokal.
- Server hanya generate audio dan mengirim event realtime.
- Browser client yang memutar audio.
- Tidak memakai external TTS API.
- Menggunakan Piper TTS lokal/offline.
- Bahasa Indonesia.

Tujuan:
Saat ada record notif baru dari database PostgreSQL:
1. Ambil template notif.
2. Render text dinamis.
3. Normalize text supaya natural dibaca TTS.
4. Generate WAV menggunakan Piper.
5. Simpan audio file.
6. Kirim event realtime ke browser.
7. Browser memutar suara otomatis.

Arsitektur yang diinginkan:

PostgreSQL
  ↓
TTS Notification Service
  ↓
Render template + normalize text
  ↓
Piper generate WAV
  ↓
Save audio file
  ↓
WebSocket/SSE emit event
  ↓
Browser play audio

DATABASE REQUIREMENT:

Inspect database existing terlebih dahulu.

Jika belum ada, buat migration baru untuk:

1. notification_templates
- id
- code
- template_text
- is_active
- created_at
- updated_at

2. notification_events
- id
- notif_id (optional reference ke notif existing)
- template_code
- payload JSONB
- generated_text
- audio_path
- status
- error_message
- played
- created_at
- processed_at

CONTOH TEMPLATE:

"Perhatian. Order dengan ID {orderId} telah melewati plan hours."

CONTOH PAYLOAD:

{
  "orderId": "MPS-1029",
  "partName": "Hydraulic Pump"
}

OUTPUT TTS:

"Perhatian. Order dengan ID em pe es satu nol dua sembilan telah melewati plan hours."

NORMALIZATION RULES:

Huruf dibaca satu-satu:
A = a
B = be
C = ce
D = de
E = e
F = ef
G = ge
H = ha
I = i
J = je
K = ka
L = el
M = em
N = en
O = o
P = pe
Q = ki
R = er
S = es
T = te
U = u
V = ve
W = we
X = eks
Y = ye
Z = zet

Angka:
0 = nol
1 = satu
2 = dua
3 = tiga
4 = empat
5 = lima
6 = enam
7 = tujuh
8 = delapan
9 = sembilan

Aturan:
- Huruf kapital dalam ID dibaca satu per satu.
- Angka dalam ID dibaca digit per digit.
- Simbol "-" diubah menjadi spasi.
- Jangan ubah kalimat normal terlalu agresif.
- Fokus normalize kode/order number.

Contoh:
MPS-1029
↓
em pe es satu nol dua sembilan

FEATURE REQUIREMENT:

1. Function:
- renderTemplate()
- normalizeForTTS()
- normalizeId()
- generateAudio()
- saveAudio()
- emitRealtimeEvent()

2. Piper Integration:
- Piper binary path dari env:
  PIPER_BIN
- Model dari env:
  PIPER_MODEL
- Output dir:
  AUDIO_OUTPUT_DIR
- Jalankan Piper via child_process.spawn
- Input text via stdin
- Output WAV file

3. Browser Playback:
Buat halaman demo browser:
- connect WebSocket/SSE
- tampilkan notif masuk
- auto play audio
- ada tombol:
  "Enable Sound"
  karena browser butuh user interaction sebelum autoplay

Gunakan:
new Audio(audioUrl).play()

4. Worker:
Buat worker/background processor:
- polling notification_events status pending
- process satu-satu
- update processing/done/failed
- gunakan PostgreSQL transaction
- gunakan FOR UPDATE SKIP LOCKED

5. Audio Storage:
- simpan WAV ke local filesystem
- expose via HTTP static file
- return public audio URL

6. Realtime:
Gunakan:
- WebSocket
atau
- Server Sent Events (SSE)

Saat audio selesai dibuat:
emit:
{
  id,
  text,
  audioUrl
}

7. Docker:
Buat:
- Dockerfile
- docker-compose.yml

Support:
- Linux production
- Windows local development

8. README:
Buat step-by-step:
- install dependency
- setup env
- setup PostgreSQL
- download Piper binary
- download model Indonesia Piper
- run local Windows
- run via Docker
- open browser demo

1. IMPORTANT:
- Jangan gunakan cloud TTS API.
- Jangan hardcode path.
- Jangan play audio dari server.
- Browser client yang memutar audio.
- Kode harus production-friendly.
- Gunakan TypeScript strict typing.
- Ikuti coding style existing project.

1.  Deliverables:
- folder service baru
- migration SQL
- TypeScript backend
- worker
- realtime event
- browser demo page
- Docker config
- README lengkap