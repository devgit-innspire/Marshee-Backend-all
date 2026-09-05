import { Router } from 'express';
import {
  submitSurvey,
  getAllSurveys,
  getSurveyById,
  getSurveyAnalytics,
  deleteSurvey,
} from '../controllers/surveyController';

const router = Router();
import { auth } from '../middlewares/auth';

/**
 * @openapi
 * /api/v1/survey:
 *   get:
 *     summary: Get all surveys (admin only)
 *     tags: [Surveys]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: petType
 *         schema: { type: string }
 *       - in: query
 *         name: enrollBetaTesting
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: List of surveys
 *   post:
 *     summary: Submit a new survey
 *     tags: [Surveys]
 *     security: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Survey submitted
 */
router.post('/', submitSurvey);
router.get('/', auth, getAllSurveys);

/**
 * @openapi
 * /api/v1/survey/analytics:
 *   get:
 *     summary: Get survey analytics (admin only)
 *     tags: [Surveys]
 *     responses:
 *       200:
 *         description: Analytics data
 */
router.get('/analytics', auth, getSurveyAnalytics);


/**
 * @openapi
 * /api/v1/survey/{id}:
 *   get:
 *     summary: Get survey by ID (admin only)
 *     tags: [Surveys]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Survey details
 *   delete:
 *     summary: Delete survey by ID (admin only)
 *     tags: [Surveys]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Survey deleted
 */
router.get('/:id', auth, getSurveyById);
router.delete('/:id', auth, deleteSurvey);

export default router;