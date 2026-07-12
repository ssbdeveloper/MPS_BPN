package id.ssb.mpsheartbeat

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.NetworkInterface
import java.net.URL
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/**
 * POST satu beat ke `<serverBase>/device-heartbeat`.
 * Beat yang GAGAL tidak di-buffer/di-retry — beat hilang justru adalah sinyal
 * downtime yang ingin diukur (meniru semantik machine heartbeat).
 */
object HeartbeatSender {

    fun send(c: Context): Result<Int> {
        val url = URL("${Prefs.serverBase(c)}/device-heartbeat")
        val body = payload(c).toString().toByteArray(Charsets.UTF_8)

        return try {
            val conn = url.openConnection() as HttpURLConnection
            if (conn is HttpsURLConnection && Prefs.allowSelfSigned(c)) trustSelfSigned(conn)
            conn.requestMethod = "POST"
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("X-Device-Token", Prefs.token(c))
            conn.outputStream.use { it.write(body) }
            val code = conn.responseCode
            conn.disconnect()
            if (code in 200..299) Result.success(code)
            else Result.failure(IOException("HTTP $code"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun payload(c: Context): JSONObject {
        val (batteryPct, charging) = batteryInfo(c)
        return JSONObject()
            .put("device_id", Prefs.deviceId(c))
            .put("device_name", Prefs.deviceName(c).ifBlank { android.os.Build.MODEL })
            .put("app_version", BuildConfig.VERSION_NAME)
            .put("android_version", android.os.Build.VERSION.RELEASE)
            .put("model", android.os.Build.MODEL)
            .put("battery_pct", batteryPct)
            .put("charging", charging)
            .put("ip", localIp() ?: JSONObject.NULL)
            .put("interval_sec", Prefs.intervalSec(c))
    }

    private fun batteryInfo(c: Context): Pair<Int, Boolean> {
        val i = c.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return -1 to false
        val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
        val status = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val pct = if (level >= 0 && scale > 0) level * 100 / scale else -1
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL
        return pct to charging
    }

    private fun localIp(): String? = try {
        NetworkInterface.getNetworkInterfaces().asSequence()
            .flatMap { it.inetAddresses.asSequence() }
            .firstOrNull { !it.isLoopbackAddress && it.hostAddress?.contains('.') == true }
            ?.hostAddress
    } catch (_: Exception) { null }

    /**
     * Nginx internal memakai sertifikat self-signed. Trust dilonggarkan HANYA bila
     * opsi settings aktif, dan HANYA untuk koneksi heartbeat ini (bukan proses lain).
     * Data yang lewat cuma telemetri liveness — risiko diterima untuk tool internal.
     */
    private fun trustSelfSigned(conn: HttpsURLConnection) {
        val trustAll = arrayOf<X509TrustManager>(object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        })
        val ssl = SSLContext.getInstance("TLS")
        ssl.init(null, trustAll, SecureRandom())
        conn.sslSocketFactory = ssl.socketFactory
        conn.setHostnameVerifier { _, _ -> true }
    }
}
