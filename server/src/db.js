import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const dataDir = path.join(__dirname, '../../data');

dotenv.config({ path: path.join(rootDir, '.env') });

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const defaultAdminHash = process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync('admin123', 10);

const defaultData = {
  auth: {
    passwordHash: defaultAdminHash
  },
  settings: {
    merchantName: process.env.MERCHANT_NAME || 'Yumeko Store',
    secretApiKey: 'lazypay_sec_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
    forwarderApiKey: 'fwd_' + Math.random().toString(36).substring(2, 15),
    callbackUrl: '',
    minUniqueCode: parseInt(process.env.MIN_UNIQUE_CODE, 10) || 1,
    maxUniqueCode: parseInt(process.env.MAX_UNIQUE_CODE, 10) || 499,
    expiryMinutes: parseInt(process.env.INVOICE_EXPIRY_MINUTES, 10) || 15,
  },
  invoices: [],
  mutations: [],
  logs: []
};

const db = await JSONFilePreset(path.join(dataDir, 'db.json'), defaultData);

// Ensure auth object exists in db
if (!db.data.auth || !db.data.auth.passwordHash) {
  db.data.auth = { passwordHash: defaultAdminHash };
  db.write();
}

export { db };
