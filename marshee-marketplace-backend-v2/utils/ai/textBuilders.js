function clean(s) {
  if (!s) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length ? t : null;
}

function list(label, values) {
  const v = (values || []).map(clean).filter(Boolean);
  if (!v.length) return null;
  return `${label}: ${v.join(', ')}`;
}

function kv(label, value) {
  const v = clean(value);
  if (!v) return null;
  return `${label}: ${v}`;
}

function buildPetProfileText(pet) {
  if (!pet) return '';
  // Intentionally exclude PII / identifiers: name, imageUrl, firebaseUID, owner, coOwners, location coordinates.
  const parts = [
    kv('petType', pet.type),
    kv('gender', pet.gender),
    kv('breed', pet.breed),
    pet.weight != null ? `weightKg: ${pet.weight}` : null,
    kv('ageGroup', pet.ageGroup),
    kv('birthday', pet.birthday),
    pet.age != null ? `ageYears: ${pet.age}` : null,
    pet.height != null ? `height: ${pet.height}` : null,

    // Health & medical
    kv('dietType', pet.dietType),
    pet.feedingFrequency != null ? `feedingFrequency: ${pet.feedingFrequency}` : null,
    list('favoriteFoodBrands', pet.favoriteFoodBrands),
    kv('exerciseLevel', pet.exerciseLevel),
    pet.dailyActivityHours != null ? `dailyActivityHours: ${pet.dailyActivityHours}` : null,
    kv('trainingLevel', pet.trainingLevel),
    kv('healthConditions', pet.healthConditions),
    kv('allergies', pet.allergies),

    // Medical background (high-level)
    pet.microchipped != null ? `microchipped: ${pet.microchipped}` : null,
    pet.neutered != null ? `neutered: ${pet.neutered}` : null,
    list('pastIllnesses', pet.pastIllnesses),
    list('currentMedications', pet.currentMedications),

    // Breed & genetics
    kv('color', pet.color),
    kv('coatPattern', pet.coatPattern),
    kv('furLength', pet.furLength),
    kv('eyeColor', pet.eyeColor),
    pet.purebred != null ? `purebred: ${pet.purebred}` : null,
    list('parentBreeds', pet.parentBreeds),

    // Behavior & environment
    kv('temperament', pet.temperament),
    kv('socializationLevel', pet.socializationLevel),
    kv('livingEnvironment', pet.livingEnvironment),
    list('favoriteActivities', pet.favoriteActivities),
    kv('trainingNeeds', pet.trainingNeeds),

    // Climate
    kv('climateTolerance', pet.climateTolerance),
  ].filter(Boolean);
  return parts.join('\n');
}

function buildProductProfileText(product) {
  if (!product) return '';
  const pd = product.petDetails || {};
  const age = pd.ageSuitability || {};
  const weight = pd.weightSuitability || {};

  const healthConds = Array.isArray(pd.healthConditions)
    ? pd.healthConditions.map(h => h && (h.condition || h)).filter(Boolean)
    : [];

  const diet = pd.dietaryInfo || {};
  const features = Array.isArray(diet.features) ? diet.features : [];
  const prefs = Array.isArray(diet.preferences) ? diet.preferences : [];

  const parts = [
    kv('name', product.name),
    kv('description', product.description && product.description.full),
    list('tags', product.tags),

    kv('targetPet', pd.targetPet),
    list('lifeStages', age.lifeStages),
    age.min != null ? `ageMinMonths: ${age.min}` : null,
    age.max != null ? `ageMaxMonths: ${age.max}` : null,

    list('breedSizes', weight.breedSizes),
    weight.min != null ? `weightMinKg: ${weight.min}` : null,
    weight.max != null ? `weightMaxKg: ${weight.max}` : null,

    list('healthConditions', healthConds),
    kv('dietType', diet.type),
    list('dietFeatures', features),
    list('dietPreferences', prefs),

    kv('allergens', product.safety && product.safety.allergens),
  ].filter(Boolean);

  return parts.join('\n');
}

module.exports = { buildPetProfileText, buildProductProfileText };

