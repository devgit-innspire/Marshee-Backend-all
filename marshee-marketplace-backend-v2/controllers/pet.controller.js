const mongoose = require('mongoose');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');
const Pet = require('../models/pet.model');
const User = require('../models/user.model');
// Firebase Storage is handled in utils/imageUpload.js; pet.controller only stores URLs.

/**
 * Check if user is authorized to access/modify a pet
 * User is authorized if they are the owner OR a co-owner
 * @param {Object} pet - Pet document (populated or unpopulated)
 * @param {Object} user - User object from request
 * @returns {Boolean} True if user is authorized
 */
const isUserAuthorized = (pet, user) => {
  if (!pet || !user) return false;
  
  const ownerId = (pet.owner?._id || pet.owner)?.toString();
  const userId = (user?._id || user?.id)?.toString();
  
  if (!ownerId || !userId) return false;
  
  // Check if user is the owner
  if (ownerId === userId) {
    return true;
  }
  
  // Check if user is a co-owner
  const coOwnerIds = (pet.coOwners || []).map(co => 
    (co?._id || co)?.toString()
  ).filter(id => id); // Remove any null/undefined values
  
  return coOwnerIds.includes(userId);
};



// @desc    Create a new pet
// @route   POST /api/v1/pets
// @access  Private (Firebase users only)
exports.createPet = asyncHandler(async (req, res, next) => {
  const {
    name,
    birthday,
    gender,
    imageUrl,
    breed,
    weight,
    healthConditions,
    allergies
  } = req.body;

  // Validate required fields (birthday is optional)
  if (!name || !gender) {
    return next(new ErrorResponse('Please provide name and gender', 400));
  }

  // Use authenticated user from middleware
  const user = await User.findById(req.user.id);
  if (!user) {
    return next(new ErrorResponse('Authenticated user not found', 404));
  }

  // Enforce maximum 5 pets per user
  const existingPetsCount = await Pet.countDocuments({ owner: req.user.id });
  if (existingPetsCount >= 5) {
    return next(new ErrorResponse('Maximum pet limit reached (5 per user)', 400));
  }

  // Birthday is now stored as string in DD/MM/YYYY format (no parsing needed)
  // The virtual age calculation will handle the parsing

  // Do NOT re-upload image. Trust the provided imageUrl as a hosted URL (Firebase Storage or any CDN)
  const trustedImageUrl = imageUrl;

  // Create pet
  const pet = await Pet.create({
    name,
    birthday, // Store as string in DD/MM/YYYY format
    gender,
    imageUrl: trustedImageUrl,
    breed,
    weight,
    healthConditions,
    allergies, // Changed from known_allergies
    firebaseUID: req.user.firebaseUID,
    owner: req.user.id
  });

  // Populate owner details
  await pet.populate('owner', 'firebaseUID phoneNumber role name');

  res.status(201).json({
    success: true,
    message: 'Pet created successfully',
    data: pet
  });
});

// @desc    Get all pets for a user (owned and co-owned)
// @route   GET /api/v1/pets
// @access  Private
exports.getUserPets = asyncHandler(async (req, res, next) => {
  // Get pets where user is owner OR co-owner
  // Handle both req.user._id and req.user.id for compatibility
  const userId = req.user._id || req.user.id;

  console.log("userId in getUserPets:-", userId);

  const pets = await Pet.find({
    $or: [
      { owner: userId },
      { coOwners: userId }
    ]
  })
    .populate('owner', 'firebaseUID phoneNumber role name')
    .populate('coOwners', 'firebaseUID phoneNumber role name')
    .sort('-createdAt');

  res.status(200).json({
    success: true,
    count: pets.length,
    data: pets
  });
});


// @desc    Get single pet
// @route   GET /api/v1/pets/:id
// @access  Private
exports.getPet = asyncHandler(async (req, res, next) => {
  const pet = await Pet.findById(req.params.id)
    .populate('owner', 'firebaseUID phoneNumber role name')
    .populate('coOwners', 'firebaseUID phoneNumber role name');

  console.log("pet in getPet:-", pet);

  if (!pet) {
    return next(new ErrorResponse(`Pet not found with id of ${req.params.id}`, 404));
  }

  // Check if pet belongs to user (owner or co-owner)
  if (!isUserAuthorized(pet, req.user)) {
    return next(new ErrorResponse('Not authorized to access this pet', 403));
  }

  res.status(200).json({
    success: true,
    data: pet
  });
});

// @desc    Update pet
// @route   PUT /api/v1/pets/:id
// @access  Private
exports.updatePet = asyncHandler(async (req, res, next) => {
  let pet = await Pet.findById(req.params.id);

  if (!pet) {
    return next(new ErrorResponse(`Pet not found with id of ${req.params.id}`, 404));
  }

  // Check if pet belongs to user (owner or co-owner)
  if (!isUserAuthorized(pet, req.user)) {
    return next(new ErrorResponse('Not authorized to update this pet', 403));
  }

  // Birthday is now stored as string in DD/MM/YYYY format (no parsing needed)
  // The virtual age calculation will handle the parsing

  // Do NOT re-upload on update; accept provided imageUrl as-is if present

  pet = await Pet.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true
  })
    .populate('owner', 'firebaseUID phoneNumber role name')
    .populate('coOwners', 'firebaseUID phoneNumber role name');

  res.status(200).json({
    success: true,
    message: 'Pet updated successfully',
    data: pet
  });
});

// @desc    Delete pet
// @route   DELETE /api/v1/pets/:id
// @access  Private
exports.deletePet = asyncHandler(async (req, res, next) => {
  const pet = await Pet.findById(req.params.id);

  if (!pet) {
    return next(new ErrorResponse(`Pet not found with id of ${req.params.id}`, 404));
  }

  // Only owner can delete pet (co-owners cannot delete)
  const ownerId = (pet.owner?._id || pet.owner)?.toString();
  const userId = (req.user?._id || req.user?.id)?.toString();
  
  if (ownerId !== userId) {
    return next(new ErrorResponse('Only the owner can delete this pet', 403));
  }


  // Do NOT delete remote images from storage here; images are managed by the app

  await pet.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Pet deleted successfully'
  });
});

// @desc    Add/Update additional pet profile information
// @route   PUT /api/v1/pets/:id/additional-profile
// @access  Private
exports.updateAdditionalProfile = asyncHandler(async (req, res, next) => {
  let pet = await Pet.findById(req.params.id);

  if (!pet) {
    return next(new ErrorResponse(`Pet not found with id of ${req.params.id}`, 404));
  }

  // Check if pet belongs to user (owner or co-owner)
  if (!isUserAuthorized(pet, req.user)) {
    return next(new ErrorResponse('Not authorized to update this pet', 403));
  }


  // Define allowed fields for additional profile information
  const additionalProfileFields = {
    // Health & Medical
    weight: req.body.weight,
    height: req.body.height,
    vaccinationRecords: req.body.vaccinationRecords,
    dewormingRecords: req.body.dewormingRecords,
    microchipped: req.body.microchipped,
    neutered: req.body.neutered,
    pastIllnesses: req.body.pastIllnesses,
    currentMedications: req.body.currentMedications,
    vetVisits: req.body.vetVisits,
    allergies: req.body.allergies, // Changed from known_allergies
    healthConditions: req.body.healthConditions,

    // Nutrition & Lifestyle
    dietType: req.body.dietType,
    feedingFrequency: req.body.feedingFrequency,
    favoriteFoodBrands: req.body.favoriteFoodBrands,
    exerciseLevel: req.body.exerciseLevel,
    dailyActivityHours: req.body.dailyActivityHours,
    trainingLevel: req.body.trainingLevel,

    // Breed & Genetics
    color: req.body.color,
    coatPattern: req.body.coatPattern,
    furLength: req.body.furLength,
    eyeColor: req.body.eyeColor,
    purebred: req.body.purebred,
    parentBreeds: req.body.parentBreeds,

    // Behavior & Environment
    temperament: req.body.temperament,
    socializationLevel: req.body.socializationLevel,
    livingEnvironment: req.body.livingEnvironment,
    favoriteActivities: req.body.favoriteActivities,
    trainingNeeds: req.body.trainingNeeds,

    // Location & Climate
    location: req.body.location,
    climateTolerance: req.body.climateTolerance,

    // Age Group (can be calculated or manually set)
    ageGroup: req.body.ageGroup,

    // Basic info that might need updating
    type: req.body.type,
    breed: req.body.breed,
    imageUrl: req.body.imageUrl
  };

  // Remove undefined fields
  Object.keys(additionalProfileFields).forEach(key => {
    if (additionalProfileFields[key] === undefined) {
      delete additionalProfileFields[key];
    }
  });

  // If no additional fields provided
  if (Object.keys(additionalProfileFields).length === 0) {
    return next(new ErrorResponse('No additional profile data provided', 400));
  }

  // Update the pet with additional profile information
  pet = await Pet.findByIdAndUpdate(
    req.params.id,
    { $set: additionalProfileFields },
    {
      new: true,
      runValidators: true
    }
  )
    .populate('owner', 'firebaseUID phoneNumber role name')
    .populate('coOwners', 'firebaseUID phoneNumber role name');

  res.status(200).json({
    success: true,
    message: 'Additional pet profile information updated successfully',
    data: pet
  });
});

// @desc    Update specific sections of pet profile
// @route   PATCH /api/v1/pets/:id/profile-section
// @access  Private
exports.updateProfileSection = asyncHandler(async (req, res, next) => {
  let pet = await Pet.findById(req.params.id);

  if (!pet) {
    return next(new ErrorResponse(`Pet not found with id of ${req.params.id}`, 404));
  }

  // Check if pet belongs to user
 if (!isUserAuthorized(pet, req.user)) {
  return next(new ErrorResponse('Not authorized to update this pet', 401));
}


  const { section, data } = req.body;

  if (!section || !data) {
    return next(new ErrorResponse('Please provide section and data', 400));
  }

  // Define allowed sections
  const allowedSections = [
    'health', 'nutrition', 'breed', 'behavior', 'location', 'basic'
  ];

  if (!allowedSections.includes(section)) {
    return next(new ErrorResponse(`Invalid section. Allowed sections: ${allowedSections.join(', ')}`, 400));
  }

  const sectionMappings = {
    health: {
      weight: data.weight,
      height: data.height,
      vaccinationRecords: data.vaccinationRecords,
      dewormingRecords: data.dewormingRecords,
      microchipped: data.microchipped,
      neutered: data.neutered,
      pastIllnesses: data.pastIllnesses,
      currentMedications: data.currentMedications,
      vetVisits: data.vetVisits,
      allergies: data.allergies, // Changed from known_allergies
      healthConditions: data.healthConditions
    },
    nutrition: {
      dietType: data.dietType,
      feedingFrequency: data.feedingFrequency,
      favoriteFoodBrands: data.favoriteFoodBrands,
      exerciseLevel: data.exerciseLevel,
      dailyActivityHours: data.dailyActivityHours,
      trainingLevel: data.trainingLevel
    },
    breed: {
      color: data.color,
      coatPattern: data.coatPattern,
      furLength: data.furLength,
      eyeColor: data.eyeColor,
      purebred: data.purebred,
      parentBreeds: data.parentBreeds
    },
    behavior: {
      temperament: data.temperament,
      socializationLevel: data.socializationLevel,
      livingEnvironment: data.livingEnvironment,
      favoriteActivities: data.favoriteActivities,
      trainingNeeds: data.trainingNeeds
    },
    location: {
      location: data.location,
      climateTolerance: data.climateTolerance
    },
    basic: {
      type: data.type,
      breed: data.breed,
      imageUrl: data.imageUrl,
      ageGroup: data.ageGroup
    }
  };

  const updateData = sectionMappings[section];

  // Remove undefined fields
  Object.keys(updateData).forEach(key => {
    if (updateData[key] === undefined) {
      delete updateData[key];
    }
  });

  if (Object.keys(updateData).length === 0) {
    return next(new ErrorResponse('No valid data provided for the section', 400));
  }

  pet = await Pet.findByIdAndUpdate(
    req.params.id,
    { $set: updateData },
    {
      new: true,
      runValidators: true
    }
  )
    .populate('owner', 'firebaseUID phoneNumber role name')
    .populate('coOwners', 'firebaseUID phoneNumber role name');

  res.status(200).json({
    success: true,
    message: `${section.charAt(0).toUpperCase() + section.slice(1)} profile section updated successfully`,
    data: pet
  });
});

// @desc    Add single vaccination record
// @route   POST /api/v1/pets/:id/vaccinations
// @access  Private
exports.addVaccinationRecord = asyncHandler(async (req, res, next) => {
  const pet = await Pet.findById(req.params.id);

  if (!pet) {
    return next(new ErrorResponse(`Pet not found with id of ${req.params.id}`, 404));
  }

  // Check if pet belongs to user (owner or co-owner)
  if (!isUserAuthorized(pet, req.user)) {
    return next(new ErrorResponse('Not authorized to update this pet', 403));
  }


  const { name, date, nextDue } = req.body;

  if (!name || !date) {
    return next(new ErrorResponse('Please provide vaccine name and date', 400));
  }

  const vaccinationRecord = {
    name,
    date: new Date(date),
    nextDue: nextDue ? new Date(nextDue) : undefined
  };

  pet.vaccinationRecords.push(vaccinationRecord);
  await pet.save();

  const updatedPet = await Pet.findById(req.params.id)
    .populate('owner', 'firebaseUID phoneNumber role name')
    .populate('coOwners', 'firebaseUID phoneNumber role name');

  res.status(200).json({
    success: true,
    message: 'Vaccination record added successfully',
    data: updatedPet
  });
});

// @desc    Add single vet visit record
// @route   POST /api/v1/pets/:id/vet-visits
// @access  Private
exports.addVetVisit = asyncHandler(async (req, res, next) => {
  const pet = await Pet.findById(req.params.id);

  if (!pet) {
    return next(new ErrorResponse(`Pet not found with id of ${req.params.id}`, 404));
  }

  // Check if pet belongs to user (owner or co-owner)
  if (!isUserAuthorized(pet, req.user)) {
    return next(new ErrorResponse('Not authorized to update this pet', 403));
  }


  const { date, reason, outcome } = req.body;

  if (!date || !reason) {
    return next(new ErrorResponse('Please provide visit date and reason', 400));
  }

  const vetVisit = {
    date: new Date(date),
    reason,
    outcome: outcome || ''
  };

  pet.vetVisits.push(vetVisit);
  await pet.save();

  const updatedPet = await Pet.findById(req.params.id)
    .populate('owner', 'firebaseUID phoneNumber role name')
    .populate('coOwners', 'firebaseUID phoneNumber role name');

  res.status(200).json({
    success: true,
    message: 'Vet visit record added successfully',
    data: updatedPet
  });
});


// @desc    Add a co-owner to a pet by phone number
// @route   POST /api/v1/pets/:id/coowners
// @access  Private (only main owner)
// @body    { phoneNumber: string } - Phone number of the user to add as co-owner
exports.addCoOwner = asyncHandler(async (req, res, next) => {
  const { phoneNumber } = req.body;

  // Validate phoneNumber is provided
  if (!phoneNumber) {
    return next(new ErrorResponse('Please provide phoneNumber', 400));
  }

  // Normalize phone number: remove spaces, dashes, parentheses, but keep + and digits
  let normalizedPhone = phoneNumber.toString().trim().replace(/[\s\-\(\)]/g, '');

  if (!normalizedPhone || normalizedPhone.length < 10) {
    return next(new ErrorResponse('Please provide a valid phone number (minimum 10 digits)', 400));
  }

  const pet = await Pet.findById(req.params.id);
  if (!pet) {
    return next(new ErrorResponse('Pet not found', 404));
  }

  // Only main owner can add co-owners
  const ownerId = (pet.owner?._id || pet.owner)?.toString();
  const userId = (req.user?._id || req.user?.id)?.toString();
  
  if (ownerId !== userId) {
    return next(new ErrorResponse('Only the main owner can add co-owners', 403));
  }

  // Find user by phone number - try multiple formats
  // Phone numbers in DB are stored in E.164 format (e.g., +919876543210)
  let coOwner = null;
  
  // Try 1: Exact match (as provided, normalized)
  coOwner = await User.findOne({ phoneNumber: normalizedPhone });
  
  // Try 2: With + prefix (E.164 format)
  if (!coOwner && !normalizedPhone.startsWith('+')) {
    coOwner = await User.findOne({ phoneNumber: `+${normalizedPhone}` });
  }
  
  // Try 3: Without + prefix
  if (!coOwner && normalizedPhone.startsWith('+')) {
    coOwner = await User.findOne({ phoneNumber: normalizedPhone.substring(1) });
  }
  
  // Try 4: If phone starts with country code 91 (India), try with +91
  if (!coOwner && normalizedPhone.startsWith('91') && normalizedPhone.length >= 12) {
    coOwner = await User.findOne({ phoneNumber: `+${normalizedPhone}` });
  }
  
  // Try 5: If phone doesn't have country code, try adding +91 (India default)
  if (!coOwner && !normalizedPhone.startsWith('+') && normalizedPhone.length === 10) {
    coOwner = await User.findOne({ phoneNumber: `+91${normalizedPhone}` });
  }

  if (!coOwner) {
    return next(new ErrorResponse(
      `User with phone number ${phoneNumber} not found. Please make sure they have registered on the platform.`,
      404
    ));
  }

  const coOwnerId = coOwner._id.toString();

  // Prevent owner from adding themselves as co-owner
  if (coOwnerId === ownerId) {
    return next(new ErrorResponse('You cannot add yourself as co-owner', 400));
  }

  // Check maximum co-owners limit
  if (pet.coOwners.length >= 5) {
    return next(new ErrorResponse('This pet already has the maximum number of co-owners (5)', 400));
  }

  // Prevent duplicate co-owner
  const coOwnerIds = pet.coOwners.map(id => (id?._id || id)?.toString());
  if (coOwnerIds.includes(coOwnerId)) {
    return next(new ErrorResponse('This user is already a co-owner', 400));
  }

  // Add co-owner
  pet.coOwners.push(coOwner._id);
  await pet.save();

  const updatedPet = await Pet.findById(pet._id)
    .populate('owner', 'firebaseUID phoneNumber role name')
    .populate('coOwners', 'firebaseUID phoneNumber role name');

  res.status(200).json({
    success: true,
    message: `Co-owner added successfully: ${coOwner.name || coOwner.phoneNumber}`,
    data: updatedPet
  });
});


// @desc    Remove a co-owner
// @route   DELETE /api/v1/pets/:id/coowners/:coOwnerId
// @access  Private (only main owner)
exports.removeCoOwner = asyncHandler(async (req, res, next) => {
  const { id, coOwnerId } = req.params;

  // Validate coOwnerId format
  if (!mongoose.Types.ObjectId.isValid(coOwnerId)) {
    return next(new ErrorResponse('Invalid coOwnerId format', 400));
  }

  const pet = await Pet.findById(id);
  if (!pet) {
    return next(new ErrorResponse('Pet not found', 404));
  }

  // Only main owner can remove co-owners
  const ownerId = (pet.owner?._id || pet.owner)?.toString();
  const userId = (req.user?._id || req.user?.id)?.toString();
  
  if (ownerId !== userId) {
    return next(new ErrorResponse('Only the main owner can remove co-owners', 403));
  }

  // Check if co-owner exists
  const coOwnerIds = pet.coOwners.map(co => co.toString());
  if (!coOwnerIds.includes(coOwnerId.toString())) {
    return next(new ErrorResponse('User is not a co-owner of this pet', 404));
  }

  // Remove co-owner
  pet.coOwners = pet.coOwners.filter(
    co => co.toString() !== coOwnerId.toString()
  );

  await pet.save();

  const updatedPet = await Pet.findById(pet._id)
    .populate('owner', 'firebaseUID phoneNumber role name')
    .populate('coOwners', 'firebaseUID phoneNumber role name');

  res.status(200).json({
    success: true,
    message: 'Co-owner removed successfully',
    data: updatedPet
  });
});

