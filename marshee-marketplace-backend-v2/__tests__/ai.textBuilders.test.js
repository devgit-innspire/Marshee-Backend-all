const { buildPetProfileText, buildProductProfileText } = require('../utils/ai/textBuilders');

test('buildPetProfileText includes key fields without crashing', () => {
  const pet = {
    type: 'Dog',
    gender: 'Male',
    breed: 'Labrador',
    weight: 22.5,
    ageGroup: 'Adult',
    birthday: '01/01/2020',
    microchipped: true,
    allergies: 'chicken, wheat',
    healthConditions: 'skin allergy',
    favoriteFoodBrands: ['BrandA', 'BrandB'],
    temperament: 'Calm',
  };
  const t = buildPetProfileText(pet);
  expect(t).toContain('petType: Dog');
  expect(t).toContain('gender: Male');
  expect(t).toContain('breed: Labrador');
  expect(t).toContain('weightKg: 22.5');
  expect(t).toContain('birthday: 01/01/2020');
  expect(t).toContain('microchipped: true');
  expect(t).toContain('allergies: chicken, wheat');
  expect(t).toContain('favoriteFoodBrands: BrandA, BrandB');
  expect(t).toContain('temperament: Calm');
});

test('buildProductProfileText includes name/tags/petDetails when present', () => {
  const product = {
    name: 'Omega 3 Supplement',
    description: { full: 'Supports skin and coat health' },
    tags: ['supplement', 'skin'],
    petDetails: {
      targetPet: 'Dog',
      ageSuitability: { lifeStages: ['Adult', 'Senior'] },
      weightSuitability: { breedSizes: ['All Sizes'] },
      dietaryInfo: { type: 'Regular', features: ['Natural'], preferences: ['High Protein'] },
      healthConditions: [{ condition: 'Skin' }],
    },
    safety: { allergens: 'fish' },
  };
  const t = buildProductProfileText(product);
  expect(t).toContain('name: Omega 3 Supplement');
  expect(t).toContain('tags: supplement, skin');
  expect(t).toContain('targetPet: Dog');
  expect(t).toContain('lifeStages: Adult, Senior');
  expect(t).toContain('allergens: fish');
});

