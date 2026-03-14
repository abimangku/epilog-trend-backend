const { sanitizeString, validateInt, validateDays, validateLimit } = require('../src/middleware/validate');

describe('sanitizeString', () => {
  test('strips HTML tags', () => {
    expect(sanitizeString('<script>alert("xss")</script>Hello'))
      .toBe('alert("xss")Hello');
  });

  test('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  test('truncates to maxLength', () => {
    expect(sanitizeString('a'.repeat(300), 200).length).toBe(200);
  });

  test('returns empty string for null/undefined', () => {
    expect(sanitizeString(null)).toBe('');
    expect(sanitizeString(undefined)).toBe('');
  });
});

describe('validateInt', () => {
  test('parses valid integer string', () => {
    expect(validateInt('42', 1, 100, 10)).toBe(42);
  });

  test('returns default for non-numeric', () => {
    expect(validateInt('abc', 1, 100, 10)).toBe(10);
  });

  test('clamps to min', () => {
    expect(validateInt('0', 1, 100, 10)).toBe(1);
  });

  test('clamps to max', () => {
    expect(validateInt('999', 1, 100, 10)).toBe(100);
  });

  test('returns default for undefined', () => {
    expect(validateInt(undefined, 1, 100, 10)).toBe(10);
  });
});

describe('validateDays', () => {
  test('returns valid days', () => {
    expect(validateDays('7')).toBe(7);
  });

  test('clamps to 1-90 range', () => {
    expect(validateDays('0')).toBe(1);
    expect(validateDays('200')).toBe(90);
  });

  test('returns 14 as default', () => {
    expect(validateDays(undefined)).toBe(14);
  });
});

describe('validateLimit', () => {
  test('returns valid limit', () => {
    expect(validateLimit('50')).toBe(50);
  });

  test('clamps to 1-500 range', () => {
    expect(validateLimit('0')).toBe(1);
    expect(validateLimit('1000')).toBe(500);
  });

  test('returns 100 as default', () => {
    expect(validateLimit(undefined)).toBe(100);
  });
});
