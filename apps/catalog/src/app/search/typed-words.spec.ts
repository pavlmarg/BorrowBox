import { MAX_TYPED_WORDS, typedWords } from './typed-words';

describe('typedWords', () => {
  it('lower-cases Greek and English, keeping accents and final sigma', () => {
    expect(typedWords('ΔΡΆΠΑΝΟΣ Bosch')).toEqual(['δράπανος', 'bosch']);
  });

  it('joins decomposed accents back onto their letters', () => {
    const decomposed = 'δράπ'; // α + combining acute accent
    expect(typedWords(decomposed)).toEqual(['δράπ']);
  });

  it('treats punctuation and search syntax as separators', () => {
    expect(typedWords("dr:* | !ill & (3d)'--")).toEqual(['dr', 'ill', '3d']);
    expect(typedWords('!!! ...')).toEqual([]);
  });

  it(`keeps at most ${MAX_TYPED_WORDS} words`, () => {
    expect(typedWords('a b c d e f g h i j k l')).toHaveLength(MAX_TYPED_WORDS);
  });
});
