const express = require('express');
const {
  createService,
  getServices,
  getServiceById,
  updateService,
  deleteService,
  getServicesByType,
  getPetNutritionistServices,
  getPetCommunicatorServices,
  getPetCommunicatorServiceById,
  getPetCakeServices,
  getPetCakeServiceById,
  getServicesByCategory,
  searchServices,
  getServicesNearby,
  getServiceStats,
  createPetNutritionistService,
  bookPetNutritionistService,
  createPetCommunicatorService,
  bookPetCommunicatorService,
  createPetCakeService,
  bookPetCakeService,
  getRelocationQuote,
  bookRelocationService
} = require('../controllers/service.controller');
const router = express.Router();

const { protect } = require('../middleware/auth');

/**
 * @swagger
 * /api/v1/services/stats:
 *   get:
 *     summary: Get service statistics
 *     tags: [Services]
 *     responses:
 *       200: { description: Service stats }
 */
router.get('/stats', getServiceStats);

/**
 * @swagger
 * /api/v1/services/search:
 *   get:
 *     summary: Search services
 *     tags: [Services]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Search results }
 */
router.get('/search', searchServices);

/**
 * @swagger
 * /api/v1/services/nearby:
 *   get:
 *     summary: Get services nearby (geospatial)
 *     tags: [Services]
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         schema: { type: number }
 *       - in: query
 *         name: lng
 *         required: true
 *         schema: { type: number }
 *       - in: query
 *         name: maxDistance
 *         schema: { type: number }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Nearby services }
 */
router.get('/nearby', getServicesNearby);

/**
 * @swagger
 * /api/v1/services/type/{serviceType}:
 *   get:
 *     summary: Get services by service type
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: serviceType
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Services by type }
 */
router.get('/type/:serviceType', getServicesByType);
router.get('/pet-nutritionists', getPetNutritionistServices);
router.get('/pet-communicators', getPetCommunicatorServices);
router.get('/pet-communicators/:id', getPetCommunicatorServiceById);
router.get('/pet-cakes', getPetCakeServices);
router.get('/pet-cakes/:id', getPetCakeServiceById);

/**
 * @swagger
 * /api/v1/services/category/{category}:
 *   get:
 *     summary: Get services by category
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Services by category }
 */
router.get('/category/:category', getServicesByCategory);

/**
 * @swagger
 * /api/v1/services:
 *   get:
 *     summary: List all services
 *     tags: [Services]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of services }
 */
router.get('/', getServices);

/**
 * @swagger
 * /api/v1/services/{id}:
 *   get:
 *     summary: Get service by ID or slug
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Service details }
 *       404: { description: Service not found }
 */
router.get('/:id', getServiceById);

/**
 * @swagger
 * /api/v1/services:
 *   post:
 *     summary: Create a service
 *     tags: [Services]
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
 *               description: { type: string }
 *               type: { type: string }
 *               category: { type: string }
 *               location: { type: object }
 *               pricing: { type: object }
 *     responses:
 *       201: { description: Service created }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post('/', protect, createService);
router.post('/pet-nutritionists', protect, createPetNutritionistService);
router.post('/pet-nutritionists/:serviceId/book', protect, bookPetNutritionistService);
router.post('/pet-communicators', protect, createPetCommunicatorService);
router.post('/pet-communicators/:serviceId/book', protect, bookPetCommunicatorService);
router.post('/pet-cakes', protect, createPetCakeService);
router.post('/pet-cakes/:serviceId/book', protect, bookPetCakeService);

/**
 * @swagger
 * /api/v1/services/{id}/relocation/quote:
 *   post:
 *     summary: Compute a dynamic relocation fare from two pincodes
 *     tags: [Services]
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
 *               pickup: { type: object, properties: { pincode: { type: string }, addressLine: { type: string } } }
 *               drop:   { type: object, properties: { pincode: { type: string }, addressLine: { type: string } } }
 *               travelMode: { type: string, enum: [road, train, air, multimodal] }
 *               petType:    { type: string }
 *               petCount:   { type: integer }
 *     responses:
 *       200: { description: Quote with distanceKm and resolved pricing }
 */
router.post('/:id/relocation/quote', getRelocationQuote);
router.post('/:serviceId/relocation/book', protect, bookRelocationService);

/**
 * @swagger
 * /api/v1/services/{id}:
 *   put:
 *     summary: Update service
 *     tags: [Services]
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
 *               description: { type: string }
 *               type: { type: string }
 *               category: { type: string }
 *               location: { type: object }
 *     responses:
 *       200: { description: Service updated }
 *       401: { description: Unauthorized }
 *       404: { description: Service not found }
 */
router.put('/:id', protect, updateService);

/**
 * @swagger
 * /api/v1/services/{id}:
 *   delete:
 *     summary: Delete service
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Service deleted }
 *       401: { description: Unauthorized }
 *       404: { description: Service not found }
 */
router.delete('/:id', protect, deleteService);

module.exports = router;
