package id.ssb.mpsheartbeat

import android.content.Context
import android.provider.Settings

/** Satu tempat untuk semua konfigurasi app (SharedPreferences). */
object Prefs {
    private const val FILE = "heartbeat_prefs"

    fun ctx(c: Context) = c.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun serverBase(c: Context): String =
        ctx(c).getString("server_base", "https://10.169.1.12/api")!!.trimEnd('/')

    fun deviceName(c: Context): String =
        ctx(c).getString("device_name", "")!!

    fun token(c: Context): String =
        ctx(c).getString("token", "")!!

    fun intervalSec(c: Context): Int =
        ctx(c).getInt("interval_sec", 60).coerceIn(15, 3600)

    fun allowSelfSigned(c: Context): Boolean =
        ctx(c).getBoolean("allow_self_signed", true)

    fun save(c: Context, base: String, name: String, token: String, interval: Int, selfSigned: Boolean) {
        ctx(c).edit()
            .putString("server_base", base.trim())
            .putString("device_name", name.trim())
            .putString("token", token.trim())
            .putInt("interval_sec", interval)
            .putBoolean("allow_self_signed", selfSigned)
            .apply()
    }

    /** ID stabil per device (bertahan selama tidak factory reset). */
    @Suppress("HardwareIds")
    fun deviceId(c: Context): String =
        Settings.Secure.getString(c.contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown"

    // Status terakhir — ditulis service, dibaca UI.
    fun setLastStatus(c: Context, s: String) = ctx(c).edit().putString("last_status", s).apply()
    fun lastStatus(c: Context): String = ctx(c).getString("last_status", "-")!!
}
