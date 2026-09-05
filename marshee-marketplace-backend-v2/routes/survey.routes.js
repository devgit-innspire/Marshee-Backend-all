const express = require('express');
const router = express.Router();
const surveyController = require('../controllers/survey.controller');
const { protect, authorize } = require('../middleware/auth');

/**
 * @swagger
 * /api/v1/survey:
 *   post:
 *     summary: Submit a new survey
 *     tags: [Survey]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string, format: email }
 *               petType: { type: string }
 *               enrollBetaTesting: { type: boolean }
 *               feedback: { type: string }
 *               otherFields: { type: object }
 *     responses:
 *       201: { description: Survey submitted }
 *       400: { description: Validation error }
 */
router.post('/', surveyController.submitSurvey);

/**
 * @swagger
 * /api/v1/survey:
 *   get:
 *     summary: Get all surveys with pagination and filtering
 *     tags: [Survey]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: email
 *         schema: { type: string }
 *       - in: query
 *         name: petType
 *         schema: { type: string }
 *       - in: query
 *         name: enrollBetaTesting
 *         schema: { type: boolean }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200: { description: List of surveys }
 */
router.get('/', protect, authorize('admin'), surveyController.getAllSurveys);

/**
 * @swagger
 * /api/v1/survey/analytics:
 *   get:
 *     summary: Get survey analytics and statistics
 *     tags: [Survey]
 *     responses:
 *       200: { description: Survey analytics }
 */
router.get('/analytics', protect, authorize('admin'), surveyController.getSurveyAnalytics);

/**
 * @swagger
 * /api/v1/survey/email/{email}:
 *   get:
 *     summary: Get surveys by email address
 *     tags: [Survey]
 *     parameters:
 *       - in: path
 *         name: email
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 5 }
 *     responses:
 *       200: { description: Surveys for email }
 *       404: { description: Not found }
 */
router.get('/email/:email', protect, authorize('admin'), surveyController.getSurveysByEmail);

/**
 * @swagger
 * /api/v1/survey/{id}:
 *   get:
 *     summary: Get survey by ID
 *     tags: [Survey]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Survey details }
 *       404: { description: Survey not found }
 */
router.get('/:id', protect, authorize('admin'), surveyController.getSurveyById);

/**
 * @swagger
 * /api/v1/survey/{id}:
 *   delete:
 *     summary: Delete survey by ID
 *     tags: [Survey]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Survey deleted }
 *       404: { description: Survey not found }
 */
router.delete('/:id', protect, authorize('admin'), surveyController.deleteSurvey);

module.exports = router;
