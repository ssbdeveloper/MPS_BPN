package id.ssb.mpsheartbeat

import android.app.ActivityManager
import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Jaring pengaman: tiap 15 menit (minimum WorkManager) cek service masih hidup;
 * kalau dibunuh OS/battery-optimizer, hidupkan lagi. Beat utamanya tetap dari service.
 */
class WatchdogWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        if (!isServiceRunning(applicationContext)) HeartbeatService.start(applicationContext)
        return Result.success()
    }

    @Suppress("DEPRECATION")
    private fun isServiceRunning(c: Context): Boolean {
        val am = c.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return am.getRunningServices(Int.MAX_VALUE)
            .any { it.service.className == HeartbeatService::class.java.name }
    }

    companion object {
        fun schedule(c: Context) {
            WorkManager.getInstance(c).enqueueUniquePeriodicWork(
                "heartbeat-watchdog",
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<WatchdogWorker>(15, TimeUnit.MINUTES).build(),
            )
        }
    }
}
