/**
 * Detection patterns that run entirely inside the page.
 *
 * The previous content script POSTed the user's raw draft to the local gateway
 * on every keystroke, so the tool that exists to stop text from leaving the
 * machine was itself streaming that text over the network — and the gateway
 * then wrote it into an audit log. Detection is local now; nothing leaves the
 * page unless the user chooses to send it.
 */

(function () {

const PATTERNS = [
  {
    id: 'openai_key',
    name: 'Clave de API de OpenAI',
    regex: /sk-[a-zA-Z0-9_-]{20,64}/g,
    replacement: '[CLAVE_OPENAI_REDACTADA]',
    severity: 'critical'
  },
  {
    id: 'anthropic_key',
    name: 'Clave de API de Anthropic',
    regex: /sk-ant-[a-zA-Z0-9_-]{20,120}/g,
    replacement: '[CLAVE_ANTHROPIC_REDACTADA]',
    severity: 'critical'
  },
  {
    id: 'aws_key',
    name: 'Clave de acceso de AWS',
    regex: /AKIA[0-9A-Z]{16}/g,
    replacement: '[CLAVE_AWS_REDACTADA]',
    severity: 'critical'
  },
  {
    id: 'github_token',
    name: 'Token de GitHub',
    regex: /gh[pousr]_[a-zA-Z0-9]{36,}/g,
    replacement: '[TOKEN_GITHUB_REDACTADO]',
    severity: 'critical'
  },
  {
    id: 'private_key',
    name: 'Clave privada',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END [^-]*-----/g,
    replacement: '[CLAVE_PRIVADA_REDACTADA]',
    severity: 'critical'
  },
  {
    id: 'password_assignment',
    name: 'Contraseña en texto plano',
    regex: /((?:password|passwd|pwd|clave|contraseña)\s*[:=]\s*)(["']?[^\s"',;]{6,})/gi,
    replacement: '$1[CONTRASEÑA_REDACTADA]',
    severity: 'critical'
  },
  {
    id: 'credit_card',
    name: 'Número de tarjeta',
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    validate: match => luhn(match.replace(/[^\d]/g, '')),
    replacement: '[TARJETA_REDACTADA]',
    severity: 'high'
  },
  {
    id: 'iban',
    name: 'Cuenta bancaria (IBAN)',
    regex: /\b[A-Z]{2}\d{2}(?:[ ]?[0-9A-Z]{4}){3,7}(?:[ ]?[0-9A-Z]{1,2})?\b/g,
    validate: match => iban97(match.replace(/\s+/g, '')),
    replacement: '[IBAN_REDACTADO]',
    severity: 'high'
  },
  {
    id: 'us_ssn',
    name: 'SSN (EE. UU.)',
    regex: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    replacement: '[SSN_REDACTADO]',
    severity: 'critical'
  }
];

/** MOD-10 checksum: rejects order numbers and IDs that merely look like cards. */
function luhn(digits) {
  if (!digits || digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (Number.isNaN(digit)) return false;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** MOD-97 checksum for IBANs. */
function iban97(value) {
  const clean = (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length < 15 || clean.length > 34) return false;

  const rearranged = clean.slice(4) + clean.slice(0, 4);
  let numeric = '';
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    numeric += (code >= 65 && code <= 90) ? String(code - 55) : char;
  }

  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = Number(String(remainder) + numeric.substring(i, i + 7)) % 97;
  }
  return remainder === 1;
}

/**
 * @returns {{findings: Array<{id,name,severity,match}>, redacted: string}}
 */
function scan(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { findings: [], redacted: text };
  }

  const findings = [];
  let redacted = text;

  for (const pattern of PATTERNS) {
    const matches = [...new Set(text.match(pattern.regex) ?? [])];

    for (const match of matches) {
      if (pattern.validate && !pattern.validate(match)) continue;

      findings.push({ id: pattern.id, name: pattern.name, severity: pattern.severity, match });
      redacted = redacted.replaceAll(match, m => m.replace(pattern.regex, pattern.replacement));
    }
  }

  return { findings, redacted };
}

// Content scripts do not support ES modules, so the API is published on the
// isolated world's global object and declared before content.js in the manifest.
globalThis.SynapseDLP = { PATTERNS, scan, luhn, iban97 };

})();
