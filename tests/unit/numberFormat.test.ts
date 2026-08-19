import { strict as assert } from 'assert';
import { formatNumber, getNumberFormatColor } from '../../webview/src/grid/numberFormat';

describe('formatNumber', () => {
  it('formats a whole-number percentage', () => {
    assert.equal(formatNumber(0.5, '0%'), '50%');
  });

  it('formats a decimal percentage with the right precision', () => {
    assert.equal(formatNumber(0.4567, '0.00%'), '45.67%');
  });

  it('formats currency with two decimals and thousands separators', () => {
    assert.equal(formatNumber(1234.5, '$#,##0.00'), '$1,234.50');
  });

  it('formats a fixed-decimal number', () => {
    assert.equal(formatNumber(3.14159, '0.00'), '3.14');
  });

  it('rounds to an integer for format code "0"', () => {
    assert.equal(formatNumber(7.6, '0'), '8');
  });

  it('falls back to the plain value for an unrecognized format code', () => {
    assert.equal(formatNumber(42, 'some custom code'), '42');
  });

  it('applies the negative-section format for a negative value', () => {
    assert.equal(formatNumber(-5.5, '0.00;-0.00'), '-5.50');
  });

  it('applies the positive-section format for a positive value with the same code', () => {
    assert.equal(formatNumber(5.5, '0.00;-0.00'), '5.50');
  });

  it('auto-prepends a minus sign when no negative section is given', () => {
    assert.equal(formatNumber(-5.5, '0.00'), '-5.50');
  });

  it('uses parentheses-style negative section literally rather than double-signing', () => {
    assert.equal(formatNumber(-1234, '#,##0;(#,##0)'), '(1,234)');
  });

  it('renders an Excel serial date using the well-known 1899-12-30 epoch', () => {
    assert.equal(formatNumber(45658, 'yyyy-mm-dd'), '2025-01-01');
  });

  it('renders a two-digit year format', () => {
    assert.equal(formatNumber(45658, 'yy-mm-dd'), '25-01-01');
  });

  it('does not misfire the date branch on ordinary text formats containing m or d', () => {
    assert.equal(formatNumber(42, 'custom code'), '42');
  });

  it('strips a [Red] color token from a negative section and still formats correctly', () => {
    assert.equal(formatNumber(-1234, '#,##0;[Red]-#,##0'), '-1,234');
  });

  it('does not let a color token containing "d" (e.g. [Red]) misfire date detection', () => {
    assert.equal(formatNumber(1234, '[Red]#,##0'), '1,234');
  });

  it('resolves a [$SYMBOL-LCID] locale-currency token to the literal symbol', () => {
    assert.equal(formatNumber(1234.5, '[$€-407]#,##0.00'), '€1,234.50');
  });

  it('handles the common Excel-generated [$$-409] USD currency token', () => {
    assert.equal(formatNumber(1234.5, '[$$-409]#,##0.00'), '$1,234.50');
  });

  it('falls back to "$" for a bare locale token with no symbol', () => {
    assert.equal(formatNumber(1234, '[$-409]#,##0'), '$1,234');
  });
});

describe('getNumberFormatColor', () => {
  it('returns undefined when no color token is present', () => {
    assert.equal(getNumberFormatColor(1234, '#,##0'), undefined);
  });

  it('resolves a named color token to its CSS hex value', () => {
    assert.equal(getNumberFormatColor(-1234, '#,##0;[Red]-#,##0'), '#FF0000');
  });

  it('picks the color from the correct sign-selected section', () => {
    assert.equal(getNumberFormatColor(1234, '[Blue]#,##0;[Red]-#,##0'), '#0000FF');
    assert.equal(getNumberFormatColor(-1234, '[Blue]#,##0;[Red]-#,##0'), '#FF0000');
  });

  it('returns undefined for an indexed palette color it cannot resolve', () => {
    assert.equal(getNumberFormatColor(1234, '[Color 12]#,##0'), undefined);
  });

  it('is case-insensitive and tolerates a space in "[Color N]"', () => {
    assert.equal(getNumberFormatColor(-1234, '#,##0;[RED]-#,##0'), '#FF0000');
  });
});
