/* Parse the web load-point setting as a 16-bit hexadecimal address. */
function parseLoadPoint(value) {
  if (value === undefined || value === null || value === '') return 0;

  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= 0xffff ? value : null;
  }

  const text = String(value).trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]+$/i.test(text)) return null;
  const parsed = parseInt(text, 16);
  return parsed >= 0 && parsed <= 0xffff ? parsed : null;
}

module.exports = { parseLoadPoint };
