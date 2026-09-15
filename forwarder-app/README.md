# LazyPay Forwarder App (Android)

Aplikasi native Android berbasis **Flutter** yang berfungsi sebagai *Background Notification Listener Service* untuk menangkap notifikasi mutasi masuk dari akun **DANA Bisnis** dan secara otomatis meneruskannya (*forward*) ke server backend LazyPay melalui webhook HTTP POST.

---

## 📱 Fitur Utama

- **Background Notification Listener:** Berjalan di latar belakang menggunakan Android Notification Listener API tanpa mengganggu penggunaan harian HP.
- **Penyaringan Notifikasi Cerdas:**
  - Default filter: `id.dana` (hanya memproses notifikasi dari aplikasi DANA).
  - Opsi filter tambahan: `com.shopee.id` atau `all`.
  - Mengabaikan notifikasi sistem (`android.systemui`) dan notifikasi aplikasi itu sendiri.
- **Multi-Pola Rupiah Extractor:** Meneruskan judul dan teks notifikasi mentah ke server untuk diekstraksi nominal rupiahnya via regex engine backend.
- **Konfigurasi Fleksibel & Tersimpan:**
  - Server URL (default: `https://lazypay.rkhyg.xyz`).
  - Forwarder API Key (otentikasi via header `x-forwarder-key`).
  - Target filter aplikasi.
- **Log Riwayat Penangkapan:** Memonitor status kirim notifikasi secara langsung pada antarmuka aplikasi.
- **Fitur Ping / Test Connection:** Memastikan koneksi antara HP dan server LazyPay berjalan lancar sebelum live.

---

## 🛠️ Persyaratan Sistem & Perangkat

- **Perangkat:** Smartphone Android (Android 8.0 Oreo ke atas, direkomendasikan HP dedicated).
- **Aplikasi Terpasang:** DANA (dengan akun DANA Bisnis aktif).
- **Koneksi:** Jaringan WiFi atau kuota data seluler yang stabil nonstop.

---

## ⚙️ Perizinan Wajib di Android

Agar service forwarder tidak dibunuh (*killed*) oleh sistem operasi Android:

1. **Akses Notifikasi (*Notification Listener Permission*):**
   - Wajib diaktifkan saat pertama kali membuka aplikasi agar app dapat membaca notifikasi DANA masuk.
2. **Optimasi Baterai (*Battery Optimization*):**
   - Buka `Settings` → `Apps` → `LazyPay Forwarder` → `Battery` → Pilih **Unrestricted / Tidak Dibatasi**.
3. **Autostart / Mulai Otomatis:**
   - Pada ROM seperti MIUI, HyperOS, ColorOS, OriginOS, atau FuntouchOS, aktifkan toggle **Autostart**.
4. **Lock App di Recent Apps:**
   - Buka tampilan *Recent Apps*, tekan lama aplikasi LazyPay Forwarder, lalu klik ikon **Gembok (Lock)** agar tidak tertutup saat membersihkan RAM.

---

## 🚀 Panduan Build Release APK

Jika ingin melakukan compile mandiri dari source code:

```bash
cd forwarder-app
flutter pub get
flutter build apk --release
```

File output binary APK akan dihasilkan di:
```text
build/app/outputs/flutter-apk/app-release.apk
```

Setelah dibuild, file dapat disalin ke folder unduhan publik server LazyPay:
```bash
cp build/app/outputs/flutter-apk/app-release.apk ../downloads/lazypay-forwarder.apk
```

---

## 📄 Lisensi

Bagian dari proyek [LazyPay](https://github.com/Synthever/lazypay) di bawah lisensi **MIT License**.
