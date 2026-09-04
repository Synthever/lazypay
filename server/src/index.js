import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import QRCode from 'qrcode';
import dotenv from 'dotenv';

import { db } from './db.js';
import { InvoiceService } from './services/invoiceService.js';
import { parseDanaNotification } from './utils/parser.js';
import { convertStaticToDynamicQRIS } from './utils/qris.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'guspay_jwt_secret_dev_key';
const QRIS_STATIC_STRING = process.env.QRIS_STATIC_STRING || '';
const MERCHANT_NAME = process.env.MERCHANT_NAME || 'Yumeko Store';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan('dev'));

// Static assets
const clientPublicPath = path.join(__dirname, '../../client/public');
const downloadsPath = path.join(__dirname, '../../downloads');

app.use('/public', express.static(clientPublicPath));
app.use('/downloads', express.static(downloadsPath));

// Broadcast to active WebSocket clients
export function broadcastEvent(event, data) {
  const message = JSON.stringify({ event, data });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ event: 'connected', time: new Date().toISOString() }));
});

// Middleware: Admin JWT Authentication (Cookie or Header)
function requireAdminAuth(req, res, next) {
  const token = req.cookies?.guspay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Session login dibutuhkan' });
    }
    return res.redirect('/login');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Session kadaluarsa' });
    }
    return res.redirect('/login');
  }
}

// Middleware: API Auth for External Merchants
function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey || apiKey !== db.data.settings.secretApiKey) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Invalid API Key' });
  }
  next();
}

// Middleware: Forwarder Auth for Android APK
function authenticateForwarder(req, res, next) {
  const authKey = req.headers['x-forwarder-key'] || req.body.key || req.query.key;
  if (!authKey || authKey !== db.data.settings.forwarderApiKey) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Invalid Forwarder Key' });
  }
  next();
}

// ==================== AUTH ROUTES ====================

// Login API
app.post('/api/v1/auth/login', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, message: 'Password tidak boleh kosong' });
  }

  const currentHash = db.data.auth?.passwordHash || process.env.ADMIN_PASSWORD_HASH;
  const isMatch = bcrypt.compareSync(password, currentHash);

  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Password salah' });
  }

  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('guspay_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  });

  res.json({ success: true, message: 'Login berhasil', token });
});

// Logout API
app.post('/api/v1/auth/logout', (req, res) => {
  res.clearCookie('guspay_token');
  res.json({ success: true, message: 'Logout berhasil' });
});

// Change Password API
app.post('/api/v1/auth/change-password', requireAdminAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Semua kolom password wajib diisi' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'Password baru minimal 6 karakter' });
  }

  const currentHash = db.data.auth?.passwordHash || process.env.ADMIN_PASSWORD_HASH;
  const isMatch = bcrypt.compareSync(oldPassword, currentHash);

  if (!isMatch) {
    return res.status(400).json({ success: false, message: 'Password lama tidak sesuai' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.data.auth = { passwordHash: newHash };
  db.write();

  res.json({ success: true, message: 'Password dashboard berhasil diubah' });
});

// Reveal QRIS String API (Requires Current Password)
app.post('/api/v1/admin/reveal-qris', requireAdminAuth, (req, res) => {
  const { password } = req.body;
  const currentHash = db.data.auth?.passwordHash || process.env.ADMIN_PASSWORD_HASH;
  const isMatch = bcrypt.compareSync(password, currentHash);

  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Password salah. Akses ditolak.' });
  }

  res.json({
    success: true,
    qrisString: QRIS_STATIC_STRING,
    merchantName: MERCHANT_NAME,
    source: '.env (Protected)'
  });
});

// ==================== PUBLIC & CHECKOUT ROUTES ====================

// 1. Get Public Invoice Detail with dynamic QRIS
app.get('/api/v1/invoices/:id', async (req, res) => {
  try {
    const invoice = InvoiceService.getInvoiceById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
    }

    let qrString = '';
    let qrImage = '';

    if (QRIS_STATIC_STRING) {
      try {
        qrString = convertStaticToDynamicQRIS(QRIS_STATIC_STRING, invoice.totalAmount);
        qrImage = await QRCode.toDataURL(qrString, {
          margin: 2,
          width: 320,
          color: { dark: '#000000', light: '#ffffff' }
        });
      } catch (err) {
        console.error('Error generating dynamic QRIS:', err);
      }
    }

    res.json({
      success: true,
      data: {
        ...invoice,
        merchantName: MERCHANT_NAME,
        qrString,
        qrImage,
        hasStaticQrisConfigured: Boolean(QRIS_STATIC_STRING)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== MERCHANT API ROUTES ====================

// 2. Create Invoice
app.post('/api/v1/invoices', authenticateApiKey, (req, res) => {
  try {
    const { orderId, amount, customerName, customerEmail, description, callbackUrl } = req.body;
    const invoice = InvoiceService.createInvoice({
      orderId,
      amount,
      customerName,
      customerEmail,
      description,
      callbackUrl
    });

    broadcastEvent('invoice.created', invoice);

    res.status(201).json({
      success: true,
      message: 'Invoice berhasil dibuat',
      data: {
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        baseAmount: invoice.baseAmount,
        uniqueCode: invoice.uniqueCode,
        totalAmount: invoice.totalAmount,
        status: invoice.status,
        expiredAt: invoice.expiredAt,
        checkoutUrl: `${req.protocol}://${req.get('host')}/pay/${invoice.id}`
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Check Invoice Status (For polling merchants)
app.get('/api/v1/invoices/:id/status', authenticateApiKey, (req, res) => {
  const invoice = InvoiceService.getInvoiceById(req.params.id);
  if (!invoice) {
    return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
  }
  res.json({
    success: true,
    data: {
      invoiceId: invoice.id,
      orderId: invoice.orderId,
      status: invoice.status,
      baseAmount: invoice.baseAmount,
      uniqueCode: invoice.uniqueCode,
      totalAmount: invoice.totalAmount,
      paidAt: invoice.paidAt,
      expiredAt: invoice.expiredAt
    }
  });
});

// ==================== ANDROID FORWARDER WEBHOOK ROUTE ====================

// 3. Webhook from Flutter Forwarder App / Tasker
app.post('/api/v1/webhook/dana', authenticateForwarder, (req, res) => {
  try {
    const { title, body, packageName, rawText, timestamp } = req.body;
    
    // Parse nominal uang dari notif
    const parsed = parseDanaNotification(title, body);

    const logEntry = {
      id: 'LOG-' + Date.now(),
      packageName: packageName || 'id.dana',
      title: title || '',
      body: body || '',
      detectedAmount: parsed.amount,
      timestamp: timestamp || new Date().toISOString()
    };
    db.data.logs.unshift(logEntry);
    if (db.data.logs.length > 200) db.data.logs.pop();
    db.write();

    if (!parsed.detected || parsed.amount <= 0) {
      broadcastEvent('log.new', logEntry);
      return res.json({
        success: true,
        message: 'Notification received but no payment amount detected',
        parsed
      });
    }

    // Match payment with active pending invoices
    const { invoice, mutationRecord } = InvoiceService.matchPayment(parsed.amount, logEntry);

    broadcastEvent('mutation.received', { mutationRecord, invoice });
    if (invoice) {
      broadcastEvent('invoice.paid', invoice);
    }

    res.json({
      success: true,
      message: invoice ? `Payment matched with invoice ${invoice.id}` : 'Payment recorded without invoice match',
      data: {
        matched: Boolean(invoice),
        invoiceId: invoice ? invoice.id : null,
        amount: parsed.amount
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Ping endpoint for forwarder app
app.get('/api/v1/forwarder/ping', authenticateForwarder, (req, res) => {
  res.json({
    success: true,
    message: 'Forwarder connected successfully',
    serverTime: new Date().toISOString()
  });
});

// ==================== ADMIN DASHBOARD ROUTES ====================

// Get Dashboard Overview (Protected)
app.get('/api/v1/admin/overview', requireAdminAuth, (req, res) => {
  InvoiceService.checkExpirations();
  const invoices = db.data.invoices;
  const mutations = db.data.mutations;
  const totalPaid = invoices.filter(i => i.status === 'PAID').reduce((sum, i) => sum + i.totalAmount, 0);
  const totalPending = invoices.filter(i => i.status === 'PENDING').length;
  const totalSuccessCount = invoices.filter(i => i.status === 'PAID').length;

  // Masked QRIS string for security
  const maskedQris = QRIS_STATIC_STRING 
    ? `${QRIS_STATIC_STRING.substring(0, 16)}••••••••••••••••••••••••••••${QRIS_STATIC_STRING.substring(QRIS_STATIC_STRING.length - 8)}`
    : 'Belum terkonfigurasi di .env';

  res.json({
    success: true,
    data: {
      stats: {
        totalPaid,
        totalPending,
        totalSuccessCount,
        totalInvoices: invoices.length,
        totalMutations: mutations.length
      },
      settings: {
        ...db.data.settings,
        merchantName: MERCHANT_NAME,
        staticQrisMasked: maskedQris,
        isQrisConfiguredInEnv: Boolean(QRIS_STATIC_STRING)
      },
      recentInvoices: invoices.slice(0, 50),
      recentMutations: mutations.slice(0, 50),
      recentLogs: db.data.logs.slice(0, 50)
    }
  });
});

// Update Settings (Protected)
app.post('/api/v1/admin/settings', requireAdminAuth, (req, res) => {
  try {
    const { callbackUrl, minUniqueCode, maxUniqueCode, expiryMinutes } = req.body;
    
    if (callbackUrl !== undefined) db.data.settings.callbackUrl = callbackUrl.trim();
    if (minUniqueCode !== undefined) db.data.settings.minUniqueCode = parseInt(minUniqueCode, 10) || 1;
    if (maxUniqueCode !== undefined) db.data.settings.maxUniqueCode = parseInt(maxUniqueCode, 10) || 499;
    if (expiryMinutes !== undefined) db.data.settings.expiryMinutes = parseInt(expiryMinutes, 10) || 15;

    db.write();
    res.json({ success: true, message: 'Settings berhasil disimpan', settings: db.data.settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Regenerate API Keys (Protected)
app.post('/api/v1/admin/keys/regenerate', requireAdminAuth, (req, res) => {
  const { type } = req.body;
  if (type === 'secret') {
    db.data.settings.secretApiKey = 'guspay_sec_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  } else if (type === 'forwarder') {
    db.data.settings.forwarderApiKey = 'fwd_' + Math.random().toString(36).substring(2, 15);
  }
  db.write();
  res.json({ success: true, message: 'Key berhasil diganti', settings: db.data.settings });
});

// Manual Test Mutation Simulator (Protected)
app.post('/api/v1/admin/simulate-payment', requireAdminAuth, (req, res) => {
  const { amount } = req.body;
  const nominal = parseInt(amount, 10);
  if (isNaN(nominal) || nominal <= 0) {
    return res.status(400).json({ success: false, message: 'Nominal tidak valid' });
  }

  const simulatedNotif = {
    title: 'Pembayaran Berhasil! (Simulasi)',
    body: `Kamu menerima Rp ${nominal.toLocaleString('id-ID')} via QRIS DANA Bisnis`,
    packageName: 'id.dana'
  };

  const { invoice, mutationRecord } = InvoiceService.matchPayment(nominal, simulatedNotif);

  broadcastEvent('mutation.received', { mutationRecord, invoice });
  if (invoice) {
    broadcastEvent('invoice.paid', invoice);
  }

  res.json({
    success: true,
    message: invoice ? `Simulasi berhasil! Invoice ${invoice.id} PAID` : `Simulasi mutasi Rp ${nominal} tersimpan (tanpa invoice cocok)`,
    data: { matched: Boolean(invoice), invoice }
  });
});

// ==================== PAGE ROUTING ====================

const sendHtml = (file, res) => {
  const p = path.join(clientPublicPath, file);
  if (fs.existsSync(p)) {
    res.sendFile(p);
  } else {
    res.status(404).send('Page not found');
  }
};

// 1. Landing Page at Root `/`
app.get('/', (req, res) => sendHtml('landing.html', res));

// 2. Public API Docs at `/docs`
app.get('/docs', (req, res) => sendHtml('docs.html', res));

// 3. Login Page
app.get('/login', (req, res) => sendHtml('login.html', res));

// 4. Public Checkout Page
app.get('/pay/:id', (req, res) => sendHtml('pay.html', res));

// 5. Protected Admin Dashboard with Sidebar (/dashboard, /invoices, /mutations, /settings, /forwarder)
app.get('/dashboard', requireAdminAuth, (req, res) => sendHtml('dashboard.html', res));
app.get('/invoices', requireAdminAuth, (req, res) => sendHtml('dashboard.html', res));
app.get('/mutations', requireAdminAuth, (req, res) => sendHtml('dashboard.html', res));
app.get('/settings', requireAdminAuth, (req, res) => sendHtml('dashboard.html', res));
app.get('/forwarder', requireAdminAuth, (req, res) => sendHtml('dashboard.html', res));

// Fallback
app.get('*', (req, res) => res.redirect('/'));

const PORT = process.env.PORT || 8940;
server.listen(PORT, () => {
  console.log(`[GusPay] Server running on http://127.0.0.1:${PORT}`);
});
