/**
 * Checksum validators for Ibero-American identity documents.
 *
 * These exist because a regex alone produces unusable noise: `B12345678` is the
 * shape of a Spanish company tax id, and so is every eight-digit part number
 * with a letter in front. Without the check digit, a DLP rule for CIF flags
 * invoices, SKUs and ticket references, the operator turns the rule off, and
 * the protection is gone.
 *
 * They are kept in their own module because they are the part of this codebase
 * with actual reuse value: mainstream DLP engines are Anglophone-first and
 * validate SSN and US formats well, while CIF, RFC, CURP and CPF are usually
 * matched by shape only.
 *
 * Every function returns a boolean and never throws.
 */

/** Spanish DNI/NIE — modulo 23 over the numeric part. */
export function validateSpanishDNI(input) {
  if (typeof input !== 'string') return false;

  let dni = input.toUpperCase().trim().replace(/[\s-]/g, '');
  if (!/^[XYZ]?\d{7,8}[A-Z]$/.test(dni)) return false;

  // NIE prefixes stand in for a leading digit: X=0, Y=1, Z=2.
  const niePrefix = { X: '0', Y: '1', Z: '2' }[dni[0]];
  if (niePrefix) dni = niePrefix + dni.slice(1);
  if (dni.length !== 9) return false;

  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
  const number = parseInt(dni.slice(0, 8), 10);
  if (Number.isNaN(number)) return false;

  return letters[number % 23] === dni[8];
}

/**
 * Spanish CIF — company tax identifier.
 *
 * Letter + 7 digits + control. The control is a digit, a letter, or either,
 * depending on the entity type encoded in the leading letter.
 */
export function validateSpanishCIF(input) {
  if (typeof input !== 'string') return false;

  const cif = input.toUpperCase().trim().replace(/[\s-]/g, '');
  if (!/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(cif)) return false;

  const body = cif.slice(1, 8);
  const control = cif[8];

  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const digit = Number(body[i]);
    if (i % 2 === 0) {
      // Odd positions (1-based) are doubled and their digits added.
      const doubled = digit * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    } else {
      sum += digit;
    }
  }

  const expectedDigit = (10 - (sum % 10)) % 10;
  const expectedLetter = 'JABCDEFGHI'[expectedDigit];

  const type = cif[0];
  // Entities that must carry a letter control.
  if ('KPQRSNW'.includes(type)) return control === expectedLetter;
  // Entities that must carry a digit control.
  if ('ABEH'.includes(type)) return control === String(expectedDigit);
  // The rest accept either form.
  return control === String(expectedDigit) || control === expectedLetter;
}

/**
 * Mexican RFC — check digit over the padded identifier.
 *
 * Personal RFCs are 13 characters, company RFCs 12. Both are left-padded to 12
 * characters before the weighted sum, which is why the space is part of the
 * alphabet.
 */
export function validateMexicanRFC(input) {
  if (typeof input !== 'string') return false;

  const rfc = input.toUpperCase().trim().replace(/[\s-]/g, '');
  if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) return false;

  // Reject impossible dates early: they are the most common false positive.
  const digits = rfc.match(/\d{6}/)[0];
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const alphabet = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ  Ñ';
  const body = rfc.slice(0, -1).padStart(12, ' ');
  const control = rfc.slice(-1);

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const value = alphabet.indexOf(body[i]);
    if (value === -1) return false;
    sum += value * (13 - i);
  }

  const remainder = sum % 11;
  const expected = remainder === 0 ? '0' : remainder === 1 ? 'A' : String(11 - remainder);

  return control === expected;
}

/**
 * Mexican CURP — 18 characters ending in a check digit.
 */
export function validateMexicanCURP(input) {
  if (typeof input !== 'string') return false;

  const curp = input.toUpperCase().trim().replace(/[\s-]/g, '');
  if (!/^[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9]\d$/.test(curp)) return false;

  const month = Number(curp.slice(6, 8));
  const day = Number(curp.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  // Two-letter federal entity codes, plus NE for those born abroad.
  const states = ['AS', 'BC', 'BS', 'CC', 'CL', 'CM', 'CS', 'CH', 'DF', 'DG', 'GT', 'GR', 'HG',
    'JC', 'MC', 'MN', 'MS', 'NT', 'NL', 'OC', 'PL', 'QT', 'QR', 'SP', 'SL', 'SR',
    'TC', 'TS', 'TL', 'VZ', 'YN', 'ZS', 'NE'];
  if (!states.includes(curp.slice(11, 13))) return false;

  const alphabet = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const value = alphabet.indexOf(curp[i]);
    if (value === -1) return false;
    sum += value * (18 - i);
  }

  return String((10 - (sum % 10)) % 10) === curp[17];
}

/**
 * Brazilian CPF — eleven digits with two modulo-11 check digits.
 */
export function validateBrazilianCPF(input) {
  if (typeof input !== 'string') return false;

  const cpf = input.replace(/[^\d]/g, '');
  if (cpf.length !== 11) return false;

  // Repeated digits satisfy the arithmetic but are never issued.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const checkDigit = (upTo, startWeight) => {
    let sum = 0;
    for (let i = 0; i < upTo; i++) {
      sum += Number(cpf[i]) * (startWeight - i);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return checkDigit(9, 10) === Number(cpf[9]) && checkDigit(10, 11) === Number(cpf[10]);
}

/**
 * Brazilian CNPJ — company identifier, fourteen digits, two check digits.
 */
export function validateBrazilianCNPJ(input) {
  if (typeof input !== 'string') return false;

  const cnpj = input.replace(/[^\d]/g, '');
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const checkDigit = length => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cnpj[i]) * weights[i];
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return checkDigit(12) === Number(cnpj[12]) && checkDigit(13) === Number(cnpj[13]);
}

/** IBAN — MOD-97 over the rearranged, alphabet-expanded string. */
export function validateIBAN(input) {
  if (typeof input !== 'string') return false;

  const iban = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (iban.length < 15 || iban.length > 34 || !/^[A-Z]{2}\d{2}/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let numeric = '';
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    numeric += (code >= 65 && code <= 90) ? String(code - 55) : char;
  }

  // Chunked so the value never exceeds Number's safe integer range.
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = Number(String(remainder) + numeric.substring(i, i + 7)) % 97;
  }

  return remainder === 1;
}

/** Luhn (MOD-10) — payment card numbers. */
export function validateLuhn(input) {
  if (typeof input !== 'string') return false;

  const digits = input.replace(/[^\d]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }

  return sum % 10 === 0;
}

/**
 * Confirms a dotted base64url triple is really a JWT by decoding the header and
 * checking it is JSON carrying an `alg` field. Without this, any three
 * base64url-looking segments separated by dots would be flagged.
 */
export function looksLikeJWT(token) {
  if (typeof token !== 'string') return false;

  try {
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
    return typeof header === 'object' && header !== null && typeof header.alg === 'string';
  } catch {
    return false;
  }
}
