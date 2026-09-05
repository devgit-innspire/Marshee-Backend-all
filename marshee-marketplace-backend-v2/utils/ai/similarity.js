function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a) {
  return Math.sqrt(dot(a, a));
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  if (a.length === 0 || b.length === 0) return null;
  if (a.length !== b.length) return null;
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return null;
  return dot(a, b) / (na * nb);
}

module.exports = { cosineSimilarity };

