/**
 * EMVCo QRIS TLV Parser & Dynamic Converter
 */
export function calculateCRC16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    crc ^= (c << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Parse full EMVCo QRIS string into Tag-Length-Value objects
 */
export function parseTLVList(qrisString) {
  const items = [];
  let index = 0;
  while (index < qrisString.length) {
    if (index + 4 > qrisString.length) break;
    const tag = qrisString.substring(index, index + 2);
    const length = parseInt(qrisString.substring(index + 2, index + 4), 10);
    if (isNaN(length) || index + 4 + length > qrisString.length) break;
    const value = qrisString.substring(index + 4, index + 4 + length);
    items.push({ tag, length: length.toString().padStart(2, '0'), value });
    index += 4 + length;
  }
  return items;
}

/**
 * Converts Static QRIS string into Dynamic QRIS with exact Amount (Tag 54)
 */
export function convertStaticToDynamicQRIS(staticQris, amount) {
  if (!staticQris || typeof staticQris !== 'string') {
    throw new Error('Invalid QRIS string');
  }

  let cleanQris = staticQris.trim();

  // Strip CRC (Tag 63) if present at the end
  if (cleanQris.includes('6304')) {
    const crcPos = cleanQris.lastIndexOf('6304');
    if (crcPos === cleanQris.length - 8) {
      cleanQris = cleanQris.substring(0, crcPos);
    }
  }

  const tlvs = parseTLVList(cleanQris);
  const amountStr = Math.round(amount).toString();
  const amountLen = amountStr.length.toString().padStart(2, '0');

  let hasTag54 = false;

  const updatedTlvs = tlvs.map(item => {
    // Convert 01 (Point of Initiation Method) from 11 (Static) to 12 (Dynamic)
    if (item.tag === '01') {
      return { tag: '01', length: '02', value: '12' };
    }
    // Replace Tag 54 if exists
    if (item.tag === '54') {
      hasTag54 = true;
      return { tag: '54', length: amountLen, value: amountStr };
    }
    return item;
  });

  // If Tag 54 wasn't present, inject it before Tag 58 (Country Code) or Tag 59 (Merchant Name)
  if (!hasTag54) {
    const injectIndex = updatedTlvs.findIndex(item => item.tag === '58' || item.tag === '59');
    const newTag54 = { tag: '54', length: amountLen, value: amountStr };
    if (injectIndex !== -1) {
      updatedTlvs.splice(injectIndex, 0, newTag54);
    } else {
      updatedTlvs.push(newTag54);
    }
  }

  // Re-build string without CRC
  let payload = '';
  for (const item of updatedTlvs) {
    payload += `${item.tag}${item.length}${item.value}`;
  }

  // Append 6304 and recalculate CRC16
  const payloadWithTag63 = `${payload}6304`;
  const checksum = calculateCRC16(payloadWithTag63);

  return `${payloadWithTag63}${checksum}`;
}
