const { cosineSimilarity } = require('../utils/ai/similarity');

test('cosineSimilarity returns 1 for identical vectors', () => {
  expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
});

test('cosineSimilarity returns 0 for orthogonal vectors', () => {
  expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
});

test('cosineSimilarity returns null for mismatched lengths', () => {
  expect(cosineSimilarity([1, 2], [1])).toBeNull();
});

