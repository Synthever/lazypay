# LazyPay — Autonomous DANA Bisnis QRIS Payment Gateway

LazyPay adalah sistem payment gateway mandiri (self-hosted) untuk menerima pembayaran QRIS otomatis melalui akun **DANA Bisnis** tanpa agregator pihak ketiga (Midtrans/Xendit).

## Fitur Utama
- **Dynamic QRIS Generator (EMVCo):** Otomatis mengonversi QRIS Statis DANA menjadi Dynamic QRIS dengan nominal terkunci saat discan.
- **Unique Code Generator:** Alokasi otomatis kode unik transfer (anti-bentrok antar invoice).
- **Flutter Notification Forwarder App:** Background Android Notification Listener Service khusus notifikasi pembayaran DANA.
- **Realtime Webhook & WebSocket:** Sinkronisasi status instan ke halaman checkout pembeli dan dashboard admin.
- **Protected Dashboard:** Dibekali enkripsi password admin (bcrypt + JWT HTTP-only cookie) dan sensor data QRIS.
- **Claude Warm Editorial Theme:** Desain minimalis terinspirasi dari Claude / Anthropic.

## Struktur Project
```
├── server/          # Node.js Express Gateway & Dynamic QRIS Engine
├── client/          # Web Admin Dashboard & Checkout Page
└── forwarder-app/   # Flutter Android Background Notification Listener
```
