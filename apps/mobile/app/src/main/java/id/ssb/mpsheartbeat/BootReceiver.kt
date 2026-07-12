package id.ssb.mpsheartbeat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Autostart setelah tablet reboot — tanpa ini reboot = heartbeat mati diam-diam. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            HeartbeatService.start(context)
            WatchdogWorker.schedule(context)
        }
    }
}
