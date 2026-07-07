// EWS TTS Notifier
// ============================================================================
// Meng-enqueue baris audio TTS ke ews.tts_notification saat issue log EWS baru
// ter-generate. Worker Piper (apps/tts-worker/generate_ews_audio.py) yang mengubah
// `message` jadi MP3.
//
// >>> DI SINI TEMPAT MENGUBAH TEKS YANG DIUCAPKAN <<<
// Lihat fungsi buildIssueSpeech() di bawah.
// ============================================================================

// ----------------------------------------------------------------------------
// KONFIGURASI
// ----------------------------------------------------------------------------

// Severity mana yang diumumkan lewat suara. Default: hanya 'Critical'.
// Ubah jadi ['Critical', 'Watch'] kalau mau Watch ikut diumumkan.
const ANNOUNCE_SEVERITIES = new Set(['Critical']);

// true  = ucapkan PERSIS teks issue log (issue_description) apa adanya.
// false = pakai template kalimat rapi di makeTemplateSpeech() (default).
const USE_FULL_ISSUE_TEXT = false;

// Nama KPI dalam Bahasa Indonesia agar enak didengar.
const KPI_LABEL_ID = {
  uptime_tablet: 'Uptime Tablet',
  uptime_hmi: 'Uptime HMI',
  accuracy_labour: 'Akurasi Labour',
  accuracy_machine: 'Akurasi Mesin',
  adoption_labour: 'Adopsi Labour',
  adoption_machine: 'Adopsi Mesin',
  oee: 'O E E',
  ole: 'O L E',
};

// ----------------------------------------------------------------------------
// >>> TEKS SUARA — UBAH DI SINI <<<
// ----------------------------------------------------------------------------
// buildIssueSpeech menerima satu baris issue (dari ews.action_table) dan
// mengembalikan { title, message }.
//   - title   : teks pendek untuk kartu notifikasi di UI.
//   - message : kalimat yang akan diucapkan Piper.
//
// Ada dua mode:
//   A. USE_FULL_ISSUE_TEXT = true  → message = issue_description apa adanya.
//   B. USE_FULL_ISSUE_TEXT = false → message = template di makeTemplateSpeech().
// Silakan edit makeTemplateSpeech() sesuai selera. Field yang tersedia:
//   issue.kpi_type, issue.severity, issue.issue_description, issue.error_type,
//   issue.machine_id, issue.pic, issue.action_taken, issue.scope_key
// ----------------------------------------------------------------------------
function buildIssueSpeech(issue) {
  const kpiName = KPI_LABEL_ID[issue.kpi_type] || issue.kpi_type || 'Indikator';
  const severityWord = String(issue.severity || '').toLowerCase() === 'critical' ? 'kritis' : 'perlu diperhatikan';
  const title = `${issue.severity || 'Issue'} — ${kpiName}`;

  if (USE_FULL_ISSUE_TEXT && issue.issue_description) {
    return { title, message: String(issue.issue_description) };
  }
  return { title, message: makeTemplateSpeech(issue, kpiName, severityWord) };
}

function makeTemplateSpeech(issue, kpiName, severityWord) {
  // ====== EDIT KALIMAT DI BAWAH INI SESUKA HATI ======
  const parts = [];
  parts.push('Perhatian.');
  parts.push(`Indikator ${kpiName} berstatus ${severityWord}.`);
  if (issue.issue_description) parts.push(`${issue.issue_description}.`);
  if (issue.pic) parts.push(`Mohon ditindaklanjuti oleh ${issue.pic}.`);
  // ===================================================
  return parts.join(' ').replace(/\.\.+/g, '.').replace(/\s+/g, ' ').trim();
}

// ----------------------------------------------------------------------------
// ENQUEUE
// ----------------------------------------------------------------------------
// Dipanggil dari syncActions untuk tiap baris issue yang BARU dibuat.
// Idempoten: ON CONFLICT(issue_key) DO NOTHING → satu audio per issue unik.
async function enqueueIssueTts(client, issueRow) {
  if (!issueRow) return false;
  if (!ANNOUNCE_SEVERITIES.has(String(issueRow.severity || ''))) return false;
  if (!issueRow.issue_key) return false;

  const { title, message } = buildIssueSpeech(issueRow);
  if (!message) return false;

  await client.query(
    `
    INSERT INTO ews.tts_notification (issue_key, kpi_type, severity, title, message, generation_status)
    VALUES ($1, $2, $3, $4, $5, 'queued')
    ON CONFLICT (issue_key) DO NOTHING
    `,
    [issueRow.issue_key, issueRow.kpi_type, issueRow.severity, title, message],
  );
  return true;
}

module.exports = {
  buildIssueSpeech,
  enqueueIssueTts,
  ANNOUNCE_SEVERITIES,
  USE_FULL_ISSUE_TEXT,
};
