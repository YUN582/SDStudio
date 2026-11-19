import {
  ARTIST_TAG_CATEGORY,
  autocompleteSegment,
  autocompleteTagCategory,
  filterTagsByCategory,
  trimAutocompleteWord,
} from '../promptAutocomplete';

describe('프롬프트 자동완성 문맥', () => {
  it.each([
    'artist:',
    'artist:cil',
    '{artist:cil}',
    '1.2::artist:cil::',
    '1.2::{ ARTIST : cil }::',
  ])('%s 뒤에서는 작가 태그만 요청한다', (word) => {
    expect(autocompleteTagCategory(word)).toBe(ARTIST_TAG_CATEGORY);
  });

  it.each(['cil', '1girl', '{artist}', '<piece>'])(
    '%s는 일반 태그 검색 범위를 유지한다',
    (word) => {
      expect(autocompleteTagCategory(word)).toBeUndefined();
    },
  );

  it('검색어에서 가중치와 artist 접두어만 제거한다', () => {
    expect(trimAutocompleteWord('1.2::{ artist:ciloranko }::')).toBe(
      'ciloranko',
    );
  });

  it('작가 카테고리가 지정되면 다른 후보를 제외한다', () => {
    const tags = [
      { word: 'general', category: 0 },
      { word: 'artist-name', category: 1 },
    ] as any[];
    expect(filterTagsByCategory(tags, ARTIST_TAG_CATEGORY)).toEqual([
      tags[1],
    ]);
    expect(filterTagsByCategory(tags)).toEqual(tags);
  });
});

test('comment boundaries keep the active artist category separate', () => {
  const text = '##ignored, artist:other##artist:cil##tail##';
  const caret = text.indexOf('cil') + 3;
  const segment = autocompleteSegment(text, caret, true);
  expect(segment.word).toBe('artist:cil');
  expect(autocompleteTagCategory(segment.word)).toBe(ARTIST_TAG_CATEGORY);
  expect(trimAutocompleteWord(segment.word)).toBe('cil');
  expect(text.slice(0, segment.start) + 'artist:updated' + text.slice(segment.end))
    .toBe('##ignored, artist:other##artist:updated##tail##');
});

test('comment markers are protected, and an unpaired marker stays literal', () => {
  expect(autocompleteSegment('##note##', 1, true).word).toBe('');
  expect(autocompleteSegment('##note##', 7, true).word).toBe('');
  expect(autocompleteSegment('##unfinished', 12, true).word).toBe('##unfinished');
});
