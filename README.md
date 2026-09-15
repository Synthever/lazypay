# LazyPay — Autonomous DANA Bisnis QRIS Payment Gateway

<div align="center">

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![Flutter](https://img.shields.io/badge/flutter-%3E%3D3.13.0-02569B.svg)
![Platform](https://img.shields.io/badge/platform-Self--Hosted-orange.svg)

**Payment gateway mandiri (self-hosted) untuk menerima pembayaran QRIS otomatis melalui akun DANA Bisnis tanpa potongan biaya transaksi (0% fee) dan tanpa agregator pihak ketiga.**

[Fitur Utama](#-fitur-utama) • [Arsitektur Alur](#-arsitektur-alur-kerja) • [Instalasi Server](#-instalasi--menjalankan-server) • [Setup Forwarder App](#-setup-android-notification-forwarder) • [Integrasi API](#-dokumentasi-api-merchant) • [Desain UI](#-desain-ui)

</div>

---

## 💡 Mengapa LazyPay?

Menggunakan agregator pembayaran resmi (seperti Midtrans, Xendit, atau Tripay) sering kali membutuhkan verifikasi dokumen bisnis legal (CV/PT/KTP), waktu persetujuan yang lama, serta mengenakan potongan MDR (*Merchant Discount Rate*) sebesar **0.7% s/d 1%** untuk setiap transaksi QRIS.

**LazyPay** memberikan solusi alternatif berbiaya Rp 0:
- **100% Milik Sendiri:** Dijalankan di VPS/server Anda sendiri (Node.js + Lowdb + Caddy/Nginx).
- **0% Platform Fee:** Saldo pembayaran masuk langsung secara utuh ke akun DANA Bisnis Anda.
- **Dynamic QRIS Otomatis:** Mengubah QRIS Statis standar DANA menjadi QRIS Dinamis (EMVCo) dengan nominal transaksi terkunci saat discan pelanggan.
- **Verifikasi Realtime:** Menggunakan aplikasi Android background service (Flutter) yang membaca notifikasi mutasi DANA Bisnis dan mem-forward data ke server secara instan.

---

## ⚡ Fitur Utama

1. **Dynamic QRIS Generator (EMVCo TLV Parser):**
   - Mengurai (*parsing*) susunan TLV (*Tag-Length-Value*) dari QRIS Statis DANA Bisnis.
   - Mengubah Tag `01` (*Point of Initiation Method*) dari `11` (Statis) menjadi `12` (Dinamis).
   - Menginjeksikan Tag `54` (*Transaction Amount*) sesuai total invoice tagihan.
   - Mengkalkulasi ulang *checksum* CRC16 (Tag `63`) standar EMVCo sehingga QR langsung menampilkan nominal yang terkunci saat di-scan oleh pembeli via BCA, Mandiri, BRI, GoPay, OVO, ShopeePay, DANA, dll.

2. **Smart Unique Code Allocator:**
   - Menghasilkan kode unik acak (rentang default `1`–`499`) yang ditambahkan pada nominal dasar tagihan.
   - Algoritma anti-bentrok: kode unik yang sedang digunakan oleh invoice berstatus `PENDING` tidak akan dipakai ulang untuk tagihan nominal yang sama sampai invoice selesai atau kadaluarsa.

3. **Flutter Android Notification Forwarder:**
   - Aplikasi Android native berbasis Flutter yang berjalan sebagai *Background Notification Listener Service*.
   - Menyaring notifikasi masuk secara cerdas (`id.dana`), mengekstrak nominal uang rupiah menggunakan regex multi-pola, dan langsung mem-forward payload ke endpoint webhook server.
   - Dilengkapi persistensi pengaturan (*Server URL*, *API Key*, *Filter Target*) dan log riwayat penangkapan notifikasi langsung di HP.

4. **Sinkronisasi Realtime (WebSocket & Webhook):**
   - Server mengekspos WebSocket server (`ws://`) untuk menyiarkan status mutasi.
   - Halaman checkout pembeli (`/pay/:id`) otomatis berganti tampilan menjadi **"Pembayaran Berhasil"** begitu mutasi masuk tanpa perlu me-refresh halaman.
   - Outbound Webhook otomatis mengirimkan notifikasi HTTP POST ke URL callback merchant/toko Anda begitu pembayaran terkonfirmasi.

5. **Claude Warm Editorial Dashboard & UI:**
   - Tampilan web didesain dengan estetika editorial modern (terinspirasi dari tipografi Newsreader serif, font monospace JetBrains Mono, canvas warm cream `#faf9f5`, dan aksen coral `#cc785c`).
   - Halaman Dashboard Admin terlindungi dengan proteksi kata sandi (*bcrypt* + *JWT HTTP-only cookie*).
   - Fitur sensor keamanan: string QRIS disensor secara default di antarmuka web dan hanya bisa dibuka setelah konfirmasi ulang password admin.
   - Monitoring komprehensif: daftar invoice, riwayat mutasi masuk, log webhook forwarder mentah, serta tombol simulator mutasi untuk pengujian.

---

## 🔄 Arsitektur Alur Kerja

```
[ Merchant App / Toko Online ]
         │
         │  1. POST /api/v1/invoices (orderId, amount, callbackUrl)
         ▼
[ LazyPay Server (Port 8940) ] ─────────► [ DB Lowdb: invoice PENDING ]
         │                                (Dynamic QRIS Tag 54 di-generate)
         │  2. Menampilkan Halaman Checkout (/pay/:id)
         ▼
    [ Pembeli ]
         │
         │  3. Scan Dynamic QRIS (Nominal terkunci otomatis)
         ▼
[ DANA Bisnis Merchant ]
         │
         │  4. Notifikasi Masuk: "Kamu menerima Rp 50.217..."
         ▼
[ HP Android Dedicated ]
 (LazyPay Forwarder App)
         │
         │  5. Background Listener menangkap notifikasi & parse nominal
         │  6. POST /api/v1/webhook/dana (x-forwarder-key)
         ▼
[ LazyPay Server ]
   ├── Match nominal Rp 50.217 dengan Invoice aktif
   ├── Update Status Invoice ──► PAID
   ├── Broadcast via WebSocket ──► Halaman Checkout Pembeli berganti sukses
   └── Kirim HTTP Webhook ─────► Merchant Callback URL (orderId, status PAID)
```

---

## 📁 Struktur Direktori

```
lazypay/
├── server/                    # Backend API Gateway & QRIS Engine (Node.js Express)
│   ├── src/
│   │   ├── index.js           # Server entry point, route definitions, WebSocket server
│   │   ├── db.js              # Lowdb JSON persistence engine
│   │   ├── services/
│   │   │   └── invoiceService.js # Logika alokasi kode unik, lifecycle invoice & matching
│   │   └── utils/
│   │       ├── parser.js      # Regex parser notifikasi DANA (ekstraksi nominal rupiah)
│   │       └── qris.js        # EMVCo TLV parser & kalkulator CRC16 Dynamic QRIS
│   ├── package.json
│   └── .env                   # Konfigurasi environment server
├── client/                    # Frontend Web (Tanpa Build Tooling / Pure Tailwind CDN)
│   └── public/
│       ├── landing.html       # Halaman beranda publik (/)
│       ├── docs.html          # Dokumentasi integrasi API (/docs)
│       ├── login.html         # Halaman masuk admin dashboard (/login)
│       ├── dashboard.html     # Admin dashboard interaktif (/dashboard, /invoices, /settings)
│       └── pay.html           # Halaman checkout pembeli dengan QRIS & timer (/pay/:id)
├── forwarder-app/             # Aplikasi Android Flutter Notification Listener
│   ├── lib/
│   │   └── main.dart          # Isolasi background listener & HTTP forwarder logic
│   └── pubspec.yaml
├── data/                      # Direktori penyimpanan database lokal
│   └── db.json                # Database JSON Lowdb (invoices, mutations, settings, auth)
├── downloads/                 # Tempat peletakan file binary APK
│   └── lazypay-forwarder.apk  # File release APK untuk diunduh langsung dari server
├── Dockerfile                 # Container image definition untuk deployment Docker
├── docker-compose.yml         # Konfigurasi multi-container / deployment cepat
├── ecosystem.config.cjs       # Konfigurasi runner proses PM2 production
└── README.md                  # Dokumentasi resmi proyek
```

---

## 🛠️ Prasyarat Sistem

- **Server / VPS:**
  - Node.js versi 18.x atau 20.x ke atas.
  - Port default: `8940` (dapat disesuaikan di `.env`).
  - Web server reverse proxy (Caddy / Nginx) dengan sertifikat SSL/TLS (HTTPS).
- **Perangkat Android (Dedicated):**
  - Smartphone Android (Android 8.0 Oreo s/d Android 14+).
  - Terinstall aplikasi **DANA** dengan akun **DANA Bisnis** yang sudah disetujui.
  - Terkoneksi internet stabil (WiFi atau Paket Data).

---

## 🚀 Instalasi & Menjalankan Server

### 1. Clone Repository & Setup Dependency

```bash
git clone git@github.com:Synthever/lazypay.git
cd lazypay/server
npm install
```

### 2. Konfigurasi Environment (`.env`)

Buat atau sesuaikan file `.env` di dalam folder `server/` (atau di root proyek):

```env
# Port & Mode Server
PORT=8940
NODE_ENV=production

# Kunci Rahasia JWT untuk Sesi Admin
JWT_SECRET=rahasia_jwt_super_aman_acak_12345

# Konfigurasi DANA Bisnis Merchant
MERCHANT_NAME="Nama Toko Anda"
# String mentah QRIS Statis dari DANA Bisnis Anda (dimulai dengan 000201...)
QRIS_STATIC_STRING="00020101021126670014ID.DANA.WWW01189360091100223456785204549953033605802ID5913NAMA MERCHANT6007JAKARTA6105123406304ABCD"

# Pengaturan Invoice & Kode Unik
MIN_UNIQUE_CODE=1
MAX_UNIQUE_CODE=499
INVOICE_EXPIRY_MINUTES=15
```

> **Cara Mendapatkan QRIS Static String:**  
> Buka aplikasi DANA Bisnis Anda, unduh gambar QRIS toko Anda, lalu gunakan scanner QR code (seperti Google Lens atau [zxing.org](https://zxing.org/w/decode)) untuk menyalin teks utuh dari QR tersebut.

### 3. Menjalankan Server

#### Opsi A: Menggunakan PM2 (Rekomendasi untuk VPS)

Di folder root `lazypay`:

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

Untuk memantau log transaksi dan server:
```bash
pm2 logs lazypay
```

#### Opsi B: Menggunakan Docker Compose

```bash
docker compose up -d --build
```

#### Opsi C: Menjalankan Langsung (Development)

```bash
cd server
npm run dev
```

### 4. Konfigurasi Reverse Proxy (HTTPS)

#### Contoh Caddy (`/etc/caddy/Caddyfile`):

```caddy
lazypay.rkhyg.xyz {
    reverse_proxy 127.0.0.1:8940
}
```

#### Contoh Nginx:

```nginx
server {
    server_name lazypay.rkhyg.xyz;

    location / {
        proxy_pass http://127.0.0.1:8940;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 📱 Setup Android Notification Forwarder

Agar server dapat memverifikasi pembayaran secara otomatis, pasang aplikasi forwarder di smartphone Android yang memiliki akun DANA Bisnis:

1. **Download & Install APK:**
   - Unduh APK release langsung dari server di `https://lazypay.rkhyg.xyz/downloads/lazypay-forwarder.apk` (atau ganti dengan domain LazyPay Anda).
   - Atau salin langsung dari VPS via terminal SSH:
     ```bash
     scp root@213.163.199.236:/root/workspace/lazypay/downloads/lazypay-forwarder.apk .
     ```
   - Buka file APK di smartphone Android dan berikan izin instalasi dari sumber tidak dikenal (*Install Unknown Apps*).

2. **Pengaturan Aplikasi:**
   - Buka aplikasi **LazyPay Forwarder**.
   - **Server URL:** Masukkan alamat server backend Anda (contoh: `https://lazypay.rkhyg.xyz` atau domain Anda).
   - **Forwarder API Key:** Salin kunci `forwarderApiKey` dari Dashboard Admin LazyPay (menu **Settings** atau tab **Forwarder**).
   - **Target App Filter:** Pilih `id.dana` (default).
   - Simpan pengaturan (*Save Settings*).

3. **Perizinan Khusus Android (Wajib):**
   - **Akses Notifikasi (Notification Listener):** Aktifkan izin "Akses Notifikasi" untuk LazyPay Forwarder saat diminta.
   - **Abaikan Optimasi Baterai (*Battery Unrestricted*):** Masuk ke Info Aplikasi → Penggunaan Baterai → Pilih **Tidak Dibatasi (*Unrestricted*)** agar Android tidak mematikan service di latar belakang.
   - **Kunci Aplikasi di Recent Apps:** Kunci (*lock*) aplikasi di layar *Recent Apps* agar tidak tertutup otomatis oleh sistem pembersih RAM.
   - **Autostart:** Pada perangkat Xiaomi (MIUI/HyperOS), Oppo (ColorOS), atau Vivo (FuntouchOS), aktifkan izin **Mulai Otomatis (*Auto-start*)**.

4. **Uji Koneksi:**
   - Tekan tombol **Test Connection / Ping** di aplikasi forwarder. Jika server merespons "Connected", integrasi siap bekerja.

---

## 🔌 Dokumentasi API Merchant

Semua request API merchant harus menyertakan header `x-api-key` yang dapat diambil dari Dashboard Admin.

### 1. Membuat Invoice Baru

Membuat tagihan pembayaran QRIS baru beserta tautan halaman checkout.

- **Endpoint:** `POST /api/v1/invoices`
- **Headers:**
  ```http
  Content-Type: application/json
  x-api-key: lazypay_sec_your_secret_api_key
  ```
- **Request Body:**
  ```json
  {
    "orderId": "ORDER-10023",
    "amount": 25000,
    "customerName": "Budi Santoso",
    "customerEmail": "budi@example.com",
    "description": "Langganan VIP 1 Bulan",
    "callbackUrl": "https://toko-anda.com/api/payment-callback"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Invoice berhasil dibuat",
    "data": {
      "invoiceId": "INV-MTO3AB8-XY21",
      "orderId": "ORDER-10023",
      "baseAmount": 25000,
      "uniqueCode": 142,
      "totalAmount": 25142,
      "status": "PENDING",
      "expiredAt": "2026-09-13T10:45:00.000Z",
      "checkoutUrl": "https://lazypay.rkhyg.xyz/pay/INV-MTO3AB8-XY21"
    }
  }
  ```

---

### 2. Mengecek Status Invoice (Polling)

- **Endpoint:** `GET /api/v1/invoices/:id/status`
- **Headers:**
  ```http
  x-api-key: lazypa..._key
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "invoiceId": "INV-MTO3AB8-XY21",
      "orderId": "ORDER-10023",
      "status": "PAID",
      "baseAmount": 25000,
      "uniqueCode": 142,
      "totalAmount": 25142,
      "paidAt": "2026-09-13T10:32:15.120Z",
      "expiredAt": "2026-09-13T10:45:00.000Z"
    }
  }
  ```

---

### 3. Outbound Webhook Callback

Ketika notifikasi mutasi berhasil dicocokkan dengan invoice yang pending, server LazyPay akan langsung mengirimkan request HTTP POST ke `callbackUrl` yang didaftarkan pada invoice:

- **Method:** `POST`
- **Headers:** `Content-Type: application/json`
- **Payload:**
  ```json
  {
    "event": "payment.success",
    "data": {
      "invoiceId": "INV-MTO3AB8-XY21",
      "orderId": "ORDER-10023",
      "baseAmount": 25000,
      "uniqueCode": 142,
      "totalAmount": 25142,
      "status": "PAID",
      "paidAt": "2026-09-13T10:32:15.120Z",
      "customerName": "Budi Santoso"
    },
    "timestamp": "2026-09-13T10:32:15.125Z"
  }
  ```

---

### 4. Contoh Kode Integrasi

#### Node.js (JavaScript / Fetch):

```javascript
async function createLazyPayInvoice() {
  const response = await fetch('https://lazypay.rkhyg.xyz/api/v1/invoices', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'lazypay_sec_your_secret_api_key'
    },
    body: JSON.stringify({
      orderId: 'ORDER-5512',
      amount: 50000,
      customerName: 'Ahmad',
      callbackUrl: 'https://aplikasi-saya.com/webhook/lazypay'
    })
  });

  const result = await response.json();
  if (result.success) {
    console.log('Buka link pembayaran:', result.data.checkoutUrl);
    // Redirect pelanggan ke result.data.checkoutUrl
  }
}
```

#### PHP (Laravel / cURL):

```php
<?php
use Illuminate\Support\Facades\Http;

$response = Http::withHeaders([
    'x-api-key' => 'lazypay_sec_your_secret_api_key',
    'Content-Type' => 'application/json'
])->post('https://lazypay.rkhyg.xyz/api/v1/invoices', [
    'orderId' => 'ORDER-5512',
    'amount' => 50000,
    'customerName' => 'Ahmad',
    'callbackUrl' => 'https://aplikasi-saya.com/webhook/lazypay'
]);

if ($response->successful()) {
    $checkoutUrl = $response->json('data.checkoutUrl');
    header('Location: ' . $checkoutUrl);
    exit;
}
```

---

## 🎨 Desain UI & Rute Halaman

LazyPay menerapkan filosofi desain minimalis **Claude Warm Editorial**:
- **Tipografi:** Newsreader (display serif) berpadu dengan Inter (UI sans) dan JetBrains Mono (data angka & kode teknis).
- **Warna:** Canvas bernuansa warm cream (`#faf9f5`), surface card (`#efe9de`), kontras teks dark navy/espresso (`#181715`), dan aksen warm coral (`#cc785c`).
- **Antarmuka Bersih:** Tanpa elemen neon/glow atau gradien berlebih (*anti-slop compliant*).

| Rute URL | Akses | Keterangan Halaman |
|---|---|---|
| `/` | Publik | Landing page resmi dengan penjelasan fitur dan alur kerja |
| `/docs` | Publik | Dokumentasi interaktif spesifikasi API dan webhook |
| `/pay/:id` | Publik | Halaman kasir (checkout) pembeli lengkap dengan QRIS dinamis, hitung mundur expired, dan auto-detect bayar via WebSocket |
| `/login` | Publik | Autentikasi masuk dashboard administrator |
| `/dashboard` | Terproteksi | Ringkasan omset total, jumlah invoice, mutasi, dan grafik |
| `/invoices` | Terproteksi | Manajemen dan tabel pencarian riwayat seluruh invoice |
| `/mutations` | Terproteksi | Daftar transaksi mutasi dana yang masuk dari notifikasi |
| `/settings` | Terproteksi | Pengaturan kode unik, masa berlaku invoice, dan ganti password |
| `/forwarder` | Terproteksi | Panduan integrasi APK forwarder dan log notifikasi mentah |

---

## 🧪 Pengujian & Simulasi

LazyPay dilengkapi fitur simulator pembayaran bawaan di dalam Dashboard Admin:
1. Buka menu **Dashboard** di `/dashboard`.
2. Pada panel **Simulasi Pembayaran**, masukkan nominal transaksi yang sesuai dengan invoice yang sedang menunggu pembayaran (`PENDING`).
3. Klik tombol **Kirim Simulasi**.
4. Sistem akan menirukan penerimaan notifikasi DANA Bisnis, mencocokkan nominal dengan invoice, mengubah statusnya menjadi `PAID`, menyiarkan event melalui WebSocket, dan menembak webhook callback.

---

## 🔒 Keamanan

- **Proteksi Admin:** Menggunakan hashing password dengan `bcryptjs` (salt rounds 10) dan otentikasi sesi via cookie `HttpOnly` bertanda `SameSite=Lax`.
- **Pemisahan Kunci API:**
  - `x-api-key`: Khusus untuk otentikasi backend toko/merchant saat membuat invoice atau query status.
  - `x-forwarder-key`: Kunci terpisah khusus aplikasi Android forwarder untuk mencegah penyalahgunaan webhook.
- **Sensor Data Sensitif:** String QRIS statis DANA tidak ditampilkan secara telanjang di halaman dashboard dan membutuhkan input password admin untuk dibuka (*reveal*).
- **Pembersihan Log Otomatis:** Buffer log notifikasi mentah dibatasi hingga 200 entri terbaru untuk mencegah beban berlebih pada database JSON.

---

## 📄 Lisensi

Proyek ini dirilis di bawah lisensi **MIT License**.
Dibuat dan dikembangkan untuk kebutuhan sistem pembayaran mandiri yang efisien, transparan, dan otonom.
