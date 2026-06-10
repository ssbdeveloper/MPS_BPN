# 🐧 Ubuntu Server CLI Cheat Sheet

> Panduan lengkap command line interface untuk Ubuntu Server - dari basic hingga advanced

---

## 📁 Navigasi & Direktori

### Navigasi Dasar

| Command | Deskripsi |
|---------|-----------|
| `pwd` | Melihat lokasi direktori saat ini |
| `ls` | Menampilkan isi direktori |
| `ls -l` | Menampilkan isi direktori lengkap |
| `ls -a` | Menampilkan semua file termasuk hidden |
| `ls -lh` | Menampilkan ukuran file dalam format human-readable |
| `cd /var/log` | Masuk ke direktori tertentu |
| `cd ..` | Kembali ke direktori sebelumnya |
| `cd ~` | Masuk ke home directory user |

---

## 📄 File & Folder Management

### Membuat File & Folder

```bash
# Membuat file kosong
touch file.txt

# Membuat folder
mkdir data

# Membuat folder bertingkat
mkdir -p data/log/nginx
```

### Copy, Move & Delete

```bash
# Menyalin file
cp file1.txt file2.txt

# Menyalin folder beserta isinya
cp -r folder1 folder2

# Memindahkan atau rename file
mv old.txt new.txt

# Menghapus file
rm file.txt

# ⚠️ Menghapus folder beserta isinya (hati-hati!)
rm -rf folder
```

---

## 👁️ Melihat Isi File

| Command | Deskripsi |
|---------|-----------|
| `cat file.txt` | Menampilkan seluruh isi file |
| `less file.txt` | Menampilkan file per halaman |
| `head file.txt` | Menampilkan 10 baris awal file |
| `tail file.txt` | Menampilkan 10 baris terakhir file |
| `tail -f /var/log/syslog` | Monitoring file log secara realtime |

---

## ✏️ Edit File (Text Editor)

### Nano (Recommended for Beginners)

```bash
nano file.conf
```

**Shortcut Nano:**
- `CTRL + O` → Save
- `CTRL + X` → Keluar
- `CTRL + W` → Cari

### Vim (Advanced)

```bash
vim file.conf
```

**Basic Vim Commands:**
- `i` → Insert mode
- `ESC` → Keluar dari insert mode
- `:w` → Save
- `:q` → Quit
- `:wq` → Save & quit
- `:q!` → Quit tanpa save

---

## 👥 User & Permission Management

### User Commands

```bash
# Melihat user yang sedang aktif
whoami

# Melihat info user
id

# Menambah user baru
adduser username

# Menambahkan user ke group sudo
usermod -aG sudo username

# Menghapus user
deluser username
```

### File Permissions

**Format Permission:**
- `r` = read (4)
- `w` = write (2)
- `x` = execute (1)

```bash
# Mengubah permission file
chmod 644 file.txt      # rw-r--r--
chmod 755 script.sh     # rwxr-xr-x

# Mengubah owner file
chown user:user file.txt

# Mengubah owner folder beserta isinya
chown -R user:user folder
```

---

## 📦 Package Management (APT)

```bash
# Update daftar repository
apt update

# Upgrade semua package
apt upgrade

# Install package
apt install nginx

# Install tanpa konfirmasi
apt install nginx -y

# Menghapus package
apt remove nginx

# Menghapus package + config
apt purge nginx

# Membersihkan dependency tidak terpakai
apt autoremove
```

---

## ⚙️ Service Management (Systemctl)

```bash
# Melihat status service
systemctl status nginx

# Menjalankan service
systemctl start nginx

# Menghentikan service
systemctl stop nginx

# Restart service
systemctl restart nginx

# Enable service saat boot
systemctl enable nginx

# Disable service saat boot
systemctl disable nginx
```

---

## 💻 Process & Resource Monitoring

### Process Management

```bash
# Menampilkan semua proses
ps aux

# Mencari proses tertentu
ps aux | grep nginx

# Monitoring proses realtime
top

# Kill process dengan PID
kill 1234

# Kill paksa
kill -9 1234
```

### Resource Monitoring

```bash
# Melihat penggunaan RAM
free -h

# Melihat penggunaan disk
df -h

# Melihat ukuran folder
du -sh /var/log

# Melihat uptime dan load server
uptime
```

---

## 🌐 Networking

```bash
# Melihat IP address
ip a

# Melihat routing
ip r

# Melihat port yang sedang digunakan
ss -tulpn

# Test koneksi jaringan
ping google.com
```

---

## 🔥 Firewall (UFW)

```bash
# Melihat status firewall
ufw status

# Mengaktifkan firewall
ufw enable

# Mengizinkan port tertentu
ufw allow 22
ufw allow 80/tcp

# Menutup port
ufw deny 3306

# Reload firewall
ufw reload
```

---

## 📊 Log & Troubleshooting

```bash
# Melihat log system
journalctl

# Melihat log service tertentu
journalctl -u nginx

# Melihat log hari ini
journalctl --since today

# Melihat kernel log
dmesg
```

---

## 💾 Disk & Filesystem

```bash
# Melihat daftar disk
lsblk

# Melihat UUID disk
blkid

# Mount disk
mount /dev/sdb1 /mnt/data

# Unmount disk
umount /mnt/data
```

---

## 📦 Archive & Compression

```bash
# Membuat archive tar.gz
tar -czvf backup.tar.gz folder

# Extract tar.gz
tar -xzvf backup.tar.gz

# Zip folder
zip -r backup.zip folder

# Unzip file
unzip backup.zip
```

---

## 🔐 SSH & Remote Access

```bash
# Login ke server via SSH
ssh user@ip_address

# Copy file ke server
scp file.txt user@ip:/path

# Sync data antar server
rsync -av folder/ user@ip:/backup/
```

---

## ⏰ Cron Jobs (Task Scheduler)

```bash
# Edit cron job
crontab -e

# Lihat cron job
crontab -l
```

### Format Cron

```
 *    *    *    *    *    command
 │    │    │    │    │
 │    │    │    │    └─── Hari (0-7, 0 & 7 = Minggu)
 │    │    │    └──────── Bulan (1-12)
 │    │    └───────────── Tanggal (1-31)
 │    └────────────────── Jam (0-23)
 └─────────────────────── Menit (0-59)
```

**Contoh:**

```bash
# Backup setiap jam 2 pagi
0 2 * * * /backup.sh

# Setiap 5 menit
*/5 * * * * /script.sh

# Setiap hari Senin jam 9 pagi
0 9 * * 1 /script.sh
```

---

## 🔧 Environment Variables

```bash
# Melihat environment variable
env

# Set environment variable
export APP_ENV=production

# Reload bash config
source ~/.bashrc
```

---

## 💡 Tips & Best Practices

1. **Selalu gunakan `sudo` dengan hati-hati** - Periksa command sebelum menjalankan
2. **Backup sebelum perubahan besar** - Gunakan `cp` atau `tar` untuk backup
3. **Gunakan `tab` untuk autocomplete** - Hemat waktu dan hindari typo
4. **Cek log saat troubleshooting** - `journalctl` dan `/var/log/` adalah teman terbaik
5. **Update sistem secara berkala** - `apt update && apt upgrade`

---

## 📚 Resource Tambahan

- [Ubuntu Server Guide](https://ubuntu.com/server/docs)
- [Linux Command Line Basics](https://ubuntu.com/tutorials/command-line-for-beginners)
- [Systemd Documentation](https://systemd.io/)

---

**Made with ❤️ for Linux enthusiasts**

> **Note:** Semua command di atas menggunakan `sudo`. Pastikan Anda memiliki privilege yang cukup sebelum menjalankan command.