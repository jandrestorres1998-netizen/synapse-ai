/**
 * SynapseAI Anti-Evasion & Deobfuscation Engine (Hardened Block 2)
 * High-precision pipeline: Base64 Decoding -> Hex Decoding -> Unicode Homoglyphs -> Invisible Chars -> Spacing Normalization
 */

export class Deobfuscator {
  constructor() {
    // Pure Unicode Homoglyph Map (Cyrillic, Greek, Special Unicode to ASCII Latin)
    this.unicodeHomoglyphs = {
      'а': 'a', 'А': 'A', 'a': 'a', 'A': 'A',
      'с': 'c', 'С': 'C', 'c': 'c', 'C': 'C',
      'е': 'e', 'Е': 'E', 'e': 'e', 'E': 'E',
      'о': 'o', 'О': 'O', 'o': 'o', 'O': 'O',
      'р': 'p', 'Р': 'P', 'p': 'p', 'P': 'P',
      'ѕ': 's', 'Ѕ': 'S', 's': 's', 'S': 'S',
      'х': 'x', 'Х': 'X', 'x': 'x', 'X': 'X',
      'у': 'y', 'У': 'Y', 'y': 'y', 'Y': 'Y',
      'і': 'i', 'І': 'I', 'i': 'i', 'I': 'I',
      'ј': 'j', 'Ј': 'J', 'j': 'j', 'J': 'J',
      'ո': 'n', 'в': 'b', 'В': 'B', 'к': 'k', 'К': 'K',
      'м': 'm', 'М': 'M', 'т': 't', 'Т': 'T', 'ԁ': 'd', 'ԃ': 'd'
    };

    // Zero-width and invisible bypass characters
    this.invisibleCharsRegex = /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD\u2060]/g;

    // Base64 pattern (minimum 20 valid base64 chars)
    this.base64Pattern = /(?:[A-Za-z0-9+/]{4}){4,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;

    // Hex pattern (minimum 16 hex chars)
    this.hexPattern = /\b(?:0x)?[0-9a-fA-F]{16,}\b/g;
  }

  /**
   * Strips zero-width and invisible bypass characters.
   */
  stripInvisibleChars(text) {
    if (!text) return '';
    return text.replace(this.invisibleCharsRegex, '');
  }

  /**
   * Normalizes ONLY Unicode Cyrillic/Greek homoglyphs to standard ASCII Latin.
   */
  normalizeUnicodeHomoglyphs(text) {
    if (!text) return '';
    let normalized = '';
    for (const char of text) {
      normalized += this.unicodeHomoglyphs[char] || char;
    }
    return normalized;
  }

  /**
   * Decodes embedded Base64 strings.
   */
  decodeBase64Strings(text) {
    if (!text) return { text, decodedMatches: [] };
    const decodedMatches = [];

    const processedText = text.replace(this.base64Pattern, (match) => {
      try {
        const decoded = Buffer.from(match, 'base64').toString('utf8');
        if (/^[a-zA-Z0-9_\-\.\:\@\s]{8,}$/.test(decoded)) {
          decodedMatches.push({ raw: match, decoded });
          return `[DECODED_BASE64: ${decoded}]`;
        }
      } catch (e) {
        // Fallback
      }
      return match;
    });

    return { text: processedText, decodedMatches };
  }

  /**
   * Decodes embedded Hex strings.
   */
  decodeHexStrings(text) {
    if (!text) return { text, decodedMatches: [] };
    const decodedMatches = [];

    const processedText = text.replace(this.hexPattern, (match) => {
      try {
        const cleanHex = match.startsWith('0x') ? match.slice(2) : match;
        if (cleanHex.length % 2 === 0) {
          const decoded = Buffer.from(cleanHex, 'hex').toString('utf8');
          if (/^[a-zA-Z0-9_\-\.\:\@\s]{8,}$/.test(decoded)) {
            decodedMatches.push({ raw: match, decoded });
            return `[DECODED_HEX: ${decoded}]`;
          }
        }
      } catch (e) {
        // Fallback
      }
      return match;
    });

    return { text: processedText, decodedMatches };
  }

  /**
   * Normalizes leetspeak specifically in keyword contexts (e.g. p4ssw0rd -> password).
   */
  normalizeLeetKeywords(text) {
    if (!text) return text;
    return text.replace(/\bp[4a@]ss?w[0o]r?d\b/gi, 'password')
               .replace(/\bcl[4a@]v[3e]\b/gi, 'clave')
               .replace(/\bc[0o]ntr[4a@]s[3e][ñn][4a@]\b/gi, 'contraseña');
  }

  /**
   * Normalizes spaced credit cards and spaced tokens while preserving word boundaries.
   */
  normalizeSpacedTokens(text) {
    if (!text) return text;
    const spacedCardRegex = /\b(?:\d[\s_]+){12,18}\d\b/g;
    return text.replace(spacedCardRegex, (match) => {
      const digitsOnly = match.replace(/[\s_]/g, '');
      if (digitsOnly.length >= 13 && digitsOnly.length <= 19) {
        return digitsOnly;
      }
      return match;
    });
  }

  /**
   * Full Anti-Evasion Pipeline.
   */
  normalize(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return { normalizedText: rawText, transformations: [] };
    }

    const transformations = [];

    // 1. Strip invisible zero-width chars
    let cleaned = this.stripInvisibleChars(rawText);
    if (cleaned !== rawText) transformations.push('INVISIBLE_CHARS_STRIPPED');

    // 2. Decode in-flight Base64
    const base64Result = this.decodeBase64Strings(cleaned);
    cleaned = base64Result.text;
    if (base64Result.decodedMatches.length > 0) transformations.push('BASE64_DECODED');

    // 3. Decode in-flight Hex
    const hexResult = this.decodeHexStrings(cleaned);
    cleaned = hexResult.text;
    if (hexResult.decodedMatches.length > 0) transformations.push('HEX_DECODED');

    // 4. Normalize Unicode Homoglyphs (Cyrillic to Latin)
    const homoglyphsCleaned = this.normalizeUnicodeHomoglyphs(cleaned);
    if (homoglyphsCleaned !== cleaned) transformations.push('HOMOGLYPHS_NORMALIZED');
    cleaned = homoglyphsCleaned;

    // 5. Normalize Leet in passwords/keywords
    const leetCleaned = this.normalizeLeetKeywords(cleaned);
    if (leetCleaned !== cleaned) transformations.push('LEET_NORMALIZED');
    cleaned = leetCleaned;

    // 6. Normalize Spaced Credit Cards and Identifiers
    const spacedCleaned = this.normalizeSpacedTokens(cleaned);
    if (spacedCleaned !== cleaned) transformations.push('SPACED_TOKENS_NORMALIZED');
    cleaned = spacedCleaned;

    return {
      normalizedText: cleaned,
      transformations,
      hasEvasionAttempts: transformations.length > 0
    };
  }
}
