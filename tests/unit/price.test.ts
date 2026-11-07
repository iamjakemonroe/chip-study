import { describe, expect, it } from 'vitest';
import { formatPrice, invoiceAmount, minStudents, priceCurrencies, priceCurrencyFor, priceLine, type InstitutionPrices } from '../../src/lib/institutionPrice.ts';

const PRICES: InstitutionPrices = {
  GBP: { per_student_year: 36, min_students: 50 },
  USD: { per_student_year: 45, min_students: 50 },
  EUR: { per_student_year: 42, min_students: 50 },
  NGN: { per_student_year: 45000, min_students: 50 },
};

describe('the price for institutions', () => {
  it('shows the visitor’s currency first, by time zone', () => {
    expect(priceCurrencyFor('Africa/Lagos')).toBe('NGN');
    expect(priceCurrencyFor('Europe/London')).toBe('GBP');
    expect(priceCurrencyFor('Europe/Paris')).toBe('EUR');
    expect(priceCurrencyFor('Europe/Berlin')).toBe('EUR');
    expect(priceCurrencyFor('America/New_York')).toBe('USD');
    expect(priceCurrencyFor('Africa/Accra')).toBe('USD');
    expect(priceCurrencyFor(undefined)).toBe('USD');
  });

  it('formats each currency, without needless pence', () => {
    expect(formatPrice(36, 'GBP')).toBe('£36');
    expect(formatPrice(45, 'USD')).toBe('$45');
    expect(formatPrice(42, 'EUR')).toBe('€42');
    expect(formatPrice(45000, 'NGN')).toBe('₦45,000');
    expect(formatPrice(1912.5, 'GBP')).toBe('£1,912.50');
  });

  it('says it in one line, the visitor’s first and the rest after', () => {
    expect(priceLine(PRICES, 'GBP')).toBe('£36 per student per year (or $45 / €42 / ₦45,000)');
    expect(priceLine(PRICES, 'NGN')).toBe('₦45,000 per student per year (or £36 / $45 / €42)');
    expect(priceCurrencies(PRICES, 'EUR')).toEqual(['EUR', 'GBP', 'USD', 'NGN']);
    expect(priceLine({ USD: PRICES.USD }, 'GBP')).toBe('$45 per student per year');
    expect(priceLine({}, 'GBP')).toBeNull();
    expect(minStudents(PRICES)).toBe(50);
  });

  it('works out an invoice: at least the minimum of students, for the months given', () => {
    expect(invoiceAmount(200, 12, PRICES.GBP, 'GBP')).toBe(7200);
    expect(invoiceAmount(10, 12, PRICES.USD, 'USD')).toBe(2250);
    expect(invoiceAmount(85, 5, PRICES.GBP, 'GBP')).toBe(1275);
    expect(invoiceAmount(77, 7, PRICES.EUR, 'EUR')).toBe(1886.5);
    expect(invoiceAmount(101, 1, PRICES.NGN, 'NGN')).toBe(378750);
    expect(invoiceAmount(0, 12, PRICES.GBP, 'GBP')).toBeNull();
    expect(invoiceAmount(100, 12, undefined, 'GBP')).toBeNull();
  });
});
