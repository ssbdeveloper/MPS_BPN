Cara 1: SOCKS5 Proxy Global (paling simpel)

    1. Buka DBeaver → Window → Preferences
    2. General → Network Connections
    3. Active Provider: pilih Manual
    4. Scroll ke SOCKS, klik Edit:
       - Host: 127.0.0.1
       - Port: 1055
       - Authentication: tidak usah diisi
    5. Klik Apply and Close
    6. Bikin koneksi PostgreSQL baru:
       - Host: 100.80.101.53
       - Port: 5433
       - Database: ptssb
       - User: tag
       - Password: <password — jangan commit password asli>

 Cara 2: SSH Tunnel (kalau server ada SSH)

    Buka terminal dan jalankan (biarkan jalan):

    bash
    ssh -L 15433:127.0.0.1:5433 user@100.80.101.53 -N \
      -o "ProxyCommand=C:\Program Files\Git\mingw64\bin\connect.exe -S 127.0.0.1:1055 %h %p"



dir "D:\Users\tee.san\AppData\Roaming\npm\codex*"
npm config get prefix
dir "%APPDATA%\npm\codex*"

set PATH=%PATH%;D:\Users\tee.san\AppData\Roaming\npm

Done. Ini file yang aku buat:

    - C:\Users\tee.san\tools\tailscale\proxy.pac — rule: 100.* dan *.ts.net lewat Tailscale, sisanya direct
    - C:\Users\tee.san\tools\tailscale\brave-tailscale.sh — launcher: start PAC server + buka Brave



    Cara pakai

    Tutup Brave dulu, lalu dari terminal:

    bash
    bash /c/Users/tee.san/tools/tailscale/brave-tailscale.sh


    Script ini akan:
    1. Start mini HTTP server serve PAC file di 127.0.0.1:8090
    2. Buka Brave dengan flag --proxy-pac-url yang ngarah ke PAC file
    3. Print PID server (buat nanti distop)

    Setelah itu di Brave:
    - http://100.80.101.53 → lewat Tailscale
    - http://100.80.101.53:3000 → kalau app React di port 3000, juga lewat Tailscale
    - google.com, github.com → tetap direct



    Stop

    bash
    taskkill //F //PID <PID_yang_ditampilin>


    ------- RDP ----------------
     | File                                           | Fungsi                              |
    |------------------------------------------------|-------------------------------------|
    | C:\Users\tee.san\tools\tailscale\rdp-tunnel.py | Tunnel TCP via SOCKS5               |
    | C:\Users\tee.san\tools\tailscale\rdp-tunnel.sh | Launcher + auto-buka Remote Desktop |

    Cara pakai (tinggal satu command)

    bash
    bash /c/Users/tee.san/tools/tailscale/rdp-tunnel.sh


    Ini akan:
    1. Start tunnel localhost:13389 → 100.69.58.98:3389 via SOCKS5
    2. Otomatis buka Remote Desktop ke 127.0.0.1:13389
    3. Tinggal login seperti biasa

    Manual (kalau mstsc gak auto-buka)

    Buka Remote Desktop Connection (Win+R → mstsc):
    - Computer: 127.0.0.1:13389
    - Username & password: sesuai credential server

    Stop tunnel

    Ctrl+C di terminal, atau:
    bash
    taskkill //F //PID <PID>




    Ringkasan semua tool Tailscale kamu sekarang:

    | Kebutuhan          | Command                                                          |
    |--------------------|------------------------------------------------------------------|
    | Start Tailscale    | bash ~/tools/tailscale/tailscale-start.sh                        |
    | SSH                | ssh -o "ProxyCommand=connect -S 127.0.0.1:1055 %h %p" user@100.x |
    | Database (DBeaver) | SOCKS5 proxy global: 127.0.0.1:1055                              |
    | Browser (Brave)    | bash ~/tools/tailscale/brave-tailscale.sh                        |
    | RDP                | bash ~/tools/tailscale/rdp-tunnel.sh                             |