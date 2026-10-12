import { excerpt } from './excerpt';

describe('excerpt', () => {
  it('keeps a short text whole, with whitespace collapsed', () => {
    expect(excerpt('  Two batteries,\n\ncharger  ', 50)).toBe(
      'Two batteries, charger',
    );
  });

  it('cuts at the last word that fits and adds an ellipsis', () => {
    const text = 'Δύο μπαταρίες, φορτιστής και θήκη με μύτες.';
    const cut = excerpt(text, 20);
    expect(cut).toBe('Δύο μπαταρίες…');
    expect(Array.from(cut).length).toBeLessThanOrEqual(20);
  });

  it('counts emoji as one character each', () => {
    expect(excerpt('🔨🪚🛠 tools', 9)).toBe('🔨🪚🛠 tools');
    expect(excerpt('🔨🪚🛠 tools galore', 9)).toBe('🔨🪚🛠…');
  });

  it('cuts inside a single word that is too long', () => {
    expect(excerpt('a'.repeat(30), 10)).toBe('a'.repeat(9) + '…');
  });
});
