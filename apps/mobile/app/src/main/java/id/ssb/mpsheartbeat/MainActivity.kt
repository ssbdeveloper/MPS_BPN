package id.ssb.mpsheartbeat

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/**
 * Layar setting sederhana (UI programatik — tanpa layout XML).
 * Field: server base URL, nama device, token, interval, izinkan self-signed.
 */
class MainActivity : Activity() {

    private lateinit var statusView: TextView
    private val ui = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() {
            statusView.text = "Status terakhir: ${Prefs.lastStatus(this@MainActivity)}\n" +
                "Device ID: ${Prefs.deviceId(this@MainActivity)}"
            ui.postDelayed(this, 3000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)

        val pad = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        fun label(t: String) = root.addView(TextView(this).apply { text = t })
        fun field(value: String, hint: String) = EditText(this).apply {
            setText(value); this.hint = hint; also { root.addView(it) }
        }

        label("Server API base (lewat nginx):")
        val fBase = field(Prefs.serverBase(this), "https://10.169.1.12/api")

        label("Nama device (kosong = model):")
        val fName = field(Prefs.deviceName(this), "TABLET-WELDING-01")

        label("Device token (harus sama dengan DEVICE_HEARTBEAT_TOKEN di server):")
        val fToken = field(Prefs.token(this), "token")

        label("Interval detik (15–3600):")
        val fInterval = field(Prefs.intervalSec(this).toString(), "60").apply {
            inputType = InputType.TYPE_CLASS_NUMBER
        }

        val cbSelfSigned = CheckBox(this).apply {
            text = "Izinkan sertifikat self-signed (nginx internal)"
            isChecked = Prefs.allowSelfSigned(this@MainActivity)
        }
        root.addView(cbSelfSigned)

        root.addView(Button(this).apply {
            text = "SIMPAN + START"
            setOnClickListener {
                Prefs.save(
                    this@MainActivity,
                    fBase.text.toString(),
                    fName.text.toString(),
                    fToken.text.toString(),
                    fInterval.text.toString().toIntOrNull() ?: 60,
                    cbSelfSigned.isChecked,
                )
                HeartbeatService.start(this@MainActivity)
                WatchdogWorker.schedule(this@MainActivity)
                Toast.makeText(this@MainActivity, "Heartbeat berjalan", Toast.LENGTH_SHORT).show()
            }
        })

        root.addView(Button(this).apply {
            text = "STOP"
            setOnClickListener {
                HeartbeatService.stop(this@MainActivity)
                Toast.makeText(this@MainActivity, "Heartbeat dihentikan", Toast.LENGTH_SHORT).show()
            }
        })

        statusView = TextView(this).apply { setPadding(0, pad, 0, 0) }
        root.addView(statusView)

        setContentView(ScrollView(this).apply { addView(root) })
    }

    override fun onResume() { super.onResume(); ui.post(refresh) }
    override fun onPause() { super.onPause(); ui.removeCallbacks(refresh) }
}
