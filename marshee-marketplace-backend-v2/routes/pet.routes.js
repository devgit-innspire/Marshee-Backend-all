const express = require('express');
const {
  createPet,
  getUserPets,
  getPet,
  updatePet,
  deletePet,
  updateAdditionalProfile,
  updateProfileSection,
  addVaccinationRecord,
  addVetVisit,
  addCoOwner,
  removeCoOwner
} = require('../controllers/pet.controller');

const router = express.Router();

const { protect } = require('../middleware/auth');

router.use(protect);

/**
 * @swagger
 * /api/v1/pets:
 *   post:
 *     summary: Create a pet profile
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               species: { type: string }
 *               breed: { type: string }
 *               dateOfBirth: { type: string, format: date }
 *               gender: { type: string }
 *               weight: { type: number }
 *               additionalProfile: { type: object }
 *     responses:
 *       201: { description: Pet created }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.route('/').post(createPet);

/**
 * @swagger
 * /api/v1/pets:
 *   get:
 *     summary: Get current user's pets
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: List of user pets }
 *       401: { description: Unauthorized }
 */
router.route('/').get(getUserPets);

/**
 * @swagger
 * /api/v1/pets/{id}:
 *   get:
 *     summary: Get pet by ID
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Pet details }
 *       401: { description: Unauthorized }
 *       404: { description: Pet not found }
 */
router.route('/:id').get(getPet);

/**
 * @swagger
 * /api/v1/pets/{id}:
 *   put:
 *     summary: Update pet
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               species: { type: string }
 *               breed: { type: string }
 *               dateOfBirth: { type: string }
 *               gender: { type: string }
 *               weight: { type: number }
 *     responses:
 *       200: { description: Pet updated }
 *       401: { description: Unauthorized }
 *       404: { description: Pet not found }
 */
router.route('/:id').put(updatePet);

/**
 * @swagger
 * /api/v1/pets/{id}:
 *   delete:
 *     summary: Delete pet
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Pet deleted }
 *       401: { description: Unauthorized }
 *       404: { description: Pet not found }
 */
router.route('/:id').delete(deletePet);

/**
 * @swagger
 * /api/v1/pets/{id}/additional-profile:
 *   put:
 *     summary: Update pet additional profile
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Additional profile updated }
 *       401: { description: Unauthorized }
 *       404: { description: Pet not found }
 */
router.route('/:id/additional-profile').put(updateAdditionalProfile);

/**
 * @swagger
 * /api/v1/pets/{id}/profile-section:
 *   patch:
 *     summary: Update a section of pet profile
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               section: { type: string }
 *               data: { type: object }
 *     responses:
 *       200: { description: Profile section updated }
 *       401: { description: Unauthorized }
 *       404: { description: Pet not found }
 */
router.route('/:id/profile-section').patch(updateProfileSection);

/**
 * @swagger
 * /api/v1/pets/{id}/vaccinations:
 *   post:
 *     summary: Add vaccination record
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vaccineName: { type: string }
 *               date: { type: string, format: date }
 *               nextDue: { type: string }
 *               notes: { type: string }
 *     responses:
 *       201: { description: Vaccination record added }
 *       401: { description: Unauthorized }
 *       404: { description: Pet not found }
 */
router.route('/:id/vaccinations').post(addVaccinationRecord);

/**
 * @swagger
 * /api/v1/pets/{id}/vet-visits:
 *   post:
 *     summary: Add vet visit record
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               date: { type: string, format: date }
 *               vetName: { type: string }
 *               reason: { type: string }
 *               notes: { type: string }
 *     responses:
 *       201: { description: Vet visit added }
 *       401: { description: Unauthorized }
 *       404: { description: Pet not found }
 */
router.route('/:id/vet-visits').post(addVetVisit);

/**
 * @swagger
 * /api/v1/pets/{id}/coowners:
 *   post:
 *     summary: Add co-owner to pet
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string }
 *               role: { type: string }
 *     responses:
 *       201: { description: Co-owner added }
 *       401: { description: Unauthorized }
 *       404: { description: Pet not found }
 */
router.route('/:id/coowners').post(addCoOwner);

/**
 * @swagger
 * /api/v1/pets/{id}/coowners/{coOwnerId}:
 *   delete:
 *     summary: Remove co-owner from pet
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: coOwnerId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Co-owner removed }
 *       401: { description: Unauthorized }
 *       404: { description: Pet or co-owner not found }
 */
router.route('/:id/coowners/:coOwnerId').delete(removeCoOwner);

module.exports = router;
