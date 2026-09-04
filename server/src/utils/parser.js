/**
 * Parser khusus untuk notifikasi DANA Bisnis / DANA Personal
 * 
 * Contoh Notif DANA:
 * "Pembayaran Berhasil! Kamu menerima Rp 50.217 dari 08123456789 via QRIS"
 * "Kamu telah menerima pembayaran sebesar Rp50.217 dari Fulan"
 * "Berhasil! Saldo Rp 50.217 masuk ke DANA Bisnis kamu"
 */
export function parseDanaNotification(title = '', body = '') {
  const fullText = `${title} ${body}`;

  // Regex untuk mencocokkan nominal uang (Rp 50.217 atau Rp50217 atau 50.217)
  // Contoh: Rp 50.217 -> 50217
  const rpRegex = /(?:Rp\.?|IDR)\s*([\d.,]+)/i;
  const match = fullText.match(rpRegex);

  if (match && match[1]) {
    // Bersihkan titik ribuan dan koma desimal
    // Di Indonesia: Rp 50.217,00 atau Rp 50.217
    let cleanStr = match[1].replace(/\s/g, '');
    
    // Jika ada koma sebagai pemisah desimal (misal 50.217,00)
    if (cleanStr.includes(',')) {
      cleanStr = cleanStr.split(',')[0];
    }
    
    // Buang semua titik ribuan
    cleanStr = cleanStr.replace(/\./g, '');
    
    const amount = parseInt(cleanStr, 10);
    if (!isNaN(amount) && amount > 0) {
      return {
        amount,
        detected: true,
        fullText
      };
    }
  }

  // Fallback regex jika kata "Rp" terpotong
  const numRegex = /sebesar\s+([\d.,]+)/i;
  const matchFallback = fullText.match(numRegex);
  if (matchFallback && matchFallback[1]) {
    let cleanStr = matchFallback[1].replace(/\./g, '').replace(/,/g, '');
    const amount = parseInt(cleanStr, 10);
    if (!isNaN(amount) && amount > 0) {
      return {
        amount,
        detected: true,
        fullText
      };
    }
  }

  return {
    amount: 0,
    detected: false,
    fullText
  };
}
