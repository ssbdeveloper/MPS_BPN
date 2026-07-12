package id.ssb.mpsheartbeat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Foreground service: kirim beat tiap interval (default 60s) selamanya.
 * START_STICKY + WatchdogWorker memastikan hidup kembali bila dibunuh sistem.
 */
class HeartbeatService : Service() {

    private lateinit var thread: HandlerThread
    private lateinit var handler: Handler
    private val fmt = SimpleDateFormat("HH:mm:ss", Locale.US)

    private val beat = object : Runnable {
        override fun run() {
            val result = HeartbeatSender.send(this@HeartbeatService)
            val stamp = fmt.format(Date())
            val status = result.fold(
                onSuccess = { "OK $stamp (HTTP $it)" },
                onFailure = { "GAGAL $stamp: ${it.message}" },
            )
            Prefs.setLastStatus(this@HeartbeatService, status)
            updateNotification(status)
            handler.postDelayed(this, Prefs.intervalSec(this@HeartbeatService) * 1000L)
        }
    }

    override fun onCreate() {
        super.onCreate()
        thread = HandlerThread("heartbeat").also { it.start() }
        handler = Handler(thread.looper)
        startForeground(NOTIF_ID, buildNotification("Memulai…"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        handler.removeCallbacks(beat)
        handler.post(beat)
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(beat)
        thread.quitSafely()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun buildNotification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Heartbeat", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val tap = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        val builder = if (Build.VERSION.SDK_INT >= 26)
            Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
        return builder
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("MPS Heartbeat aktif")
            .setContentText(text)
            .setContentIntent(tap)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, buildNotification(text))
    }

    companion object {
        private const val CHANNEL = "heartbeat"
        private const val NOTIF_ID = 1

        fun start(c: Context) {
            val i = Intent(c, HeartbeatService::class.java)
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i)
        }

        fun stop(c: Context) = c.stopService(Intent(c, HeartbeatService::class.java))
    }
}
