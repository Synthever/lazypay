import { db } from '../db.js';

export class InvoiceService {
  /**
   * Cari kode unik yang belum dipakai oleh invoice yang masih aktif/pending
   */
  static getAvailableUniqueCode(amount) {
    const { minUniqueCode, maxUniqueCode } = db.data.settings;
    const now = new Date();

    // Ambil semua invoice pending yang belum expired
    const activeInvoices = db.data.invoices.filter(inv => 
      inv.status === 'PENDING' && new Date(inv.expiredAt) > now
    );

    const usedCodes = new Set(
      activeInvoices
        .filter(inv => inv.baseAmount === amount)
        .map(inv => inv.uniqueCode)
    );

    for (let code = minUniqueCode; code <= maxUniqueCode; code++) {
      if (!usedCodes.has(code)) {
        return code;
      }
    }

    // Jika semua habis, fallback random
    return Math.floor(Math.random() * (maxUniqueCode - minUniqueCode + 1)) + minUniqueCode;
  }

  static createInvoice({ orderId, amount, customerName, customerEmail, description, callbackUrl }) {
    const baseAmount = parseInt(amount, 10);
    if (isNaN(baseAmount) || baseAmount <= 0) {
      throw new Error('Nominal tidak valid');
    }

    const uniqueCode = this.getAvailableUniqueCode(baseAmount);
    const totalAmount = baseAmount + uniqueCode;
    const expiryMinutes = db.data.settings.expiryMinutes || 15;
    const now = new Date();
    const expiredAt = new Date(now.getTime() + expiryMinutes * 60000);

    const invoiceId = 'INV-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    const invoice = {
      id: invoiceId,
      orderId: orderId || invoiceId,
      customerName: customerName || 'Pelanggan',
      customerEmail: customerEmail || '',
      description: description || 'Pembayaran QRIS',
      baseAmount,
      uniqueCode,
      totalAmount,
      status: 'PENDING', // PENDING, PAID, EXPIRED, CANCELLED
      callbackUrl: callbackUrl || db.data.settings.callbackUrl || '',
      callbackStatus: null, // PENDING, SUCCESS, FAILED
      createdAt: now.toISOString(),
      expiredAt: expiredAt.toISOString(),
      paidAt: null,
      matchedMutationId: null
    };

    db.data.invoices.unshift(invoice);
    db.write();

    return invoice;
  }

  static getInvoiceById(id) {
    this.checkExpirations();
    return db.data.invoices.find(inv => inv.id === id || inv.orderId === id);
  }

  static checkExpirations() {
    const now = new Date();
    let updated = false;
    db.data.invoices.forEach(inv => {
      if (inv.status === 'PENDING' && new Date(inv.expiredAt) <= now) {
        inv.status = 'EXPIRED';
        updated = true;
      }
    });
    if (updated) {
      db.write();
    }
  }

  /**
   * Cocokkan mutasi masuk (nominal) dengan invoice yang sedang pending
   */
  static matchPayment(totalAmount, rawNotification) {
    this.checkExpirations();
    const now = new Date();

    // Cari invoice pending dengan nominal persis totalAmount
    const invoice = db.data.invoices.find(inv => 
      inv.status === 'PENDING' && 
      inv.totalAmount === totalAmount &&
      new Date(inv.expiredAt) > now
    );

    const mutationRecord = {
      id: 'MUT-' + Date.now(),
      amount: totalAmount,
      raw: rawNotification,
      matchedInvoiceId: invoice ? invoice.id : null,
      createdAt: now.toISOString()
    };

    db.data.mutations.unshift(mutationRecord);

    if (invoice) {
      invoice.status = 'PAID';
      invoice.paidAt = now.toISOString();
      invoice.matchedMutationId = mutationRecord.id;
      db.write();

      // Trigger callback asynchronously
      if (invoice.callbackUrl) {
        this.sendCallback(invoice);
      }
    } else {
      db.write();
    }

    return { invoice, mutationRecord };
  }

  static async sendCallback(invoice) {
    try {
      const payload = {
        event: 'payment.success',
        data: {
          invoiceId: invoice.id,
          orderId: invoice.orderId,
          baseAmount: invoice.baseAmount,
          uniqueCode: invoice.uniqueCode,
          totalAmount: invoice.totalAmount,
          status: invoice.status,
          paidAt: invoice.paidAt,
          customerName: invoice.customerName
        },
        timestamp: new Date().toISOString()
      };

      const res = await fetch(invoice.callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GusPay-Secret': db.data.settings.secretApiKey
        },
        body: JSON.stringify(payload)
      });

      invoice.callbackStatus = res.ok ? 'SUCCESS' : `HTTP_${res.status}`;
      db.write();
    } catch (err) {
      invoice.callbackStatus = 'FAILED: ' + err.message;
      db.write();
    }
  }
}
