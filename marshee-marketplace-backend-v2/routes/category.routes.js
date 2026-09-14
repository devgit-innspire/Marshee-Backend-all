const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/category.controller');
const { protect, authorize, requirePermission } = require('../middleware/auth');

/**
 * @swagger
 * /api/v1/categories/super:
 *   post:
 *     summary: Create a new super category
 *     tags: [Categories]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - slug
 *             properties:
 *               name:
 *                 type: string
 *               slug:
 *                 type: string
 *               description:
 *                 type: string
 *               displayOrder:
 *                 type: integer
 *               status:
 *                 type: object
 *                 properties:
 *                   isActive:
 *                     type: boolean
 *     responses:
 *       201:
 *         description: Super category created successfully
 */
router.post('/super', protect, requirePermission('categories.manage'), categoryController.createSuperCategory);

/**
 * @swagger
 * /api/v1/categories/service:
 *   post:
 *     summary: Create a new service category
 *     tags: [Categories]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - slug
 *               - superCategory
 *             properties:
 *               name:
 *                 type: string
 *               slug:
 *                 type: string
 *               description:
 *                 type: string
 *               superCategory:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *               displayOrder:
 *                 type: integer
 *               status:
 *                 type: object
 *                 properties:
 *                   isActive:
 *                     type: boolean
 *     responses:
 *       201:
 *         description: Service category created successfully
 */
router.post('/service', protect, requirePermission('categories.manage'), categoryController.createServiceCategory);

/**
 * @swagger
 * /api/v1/categories/sub:
 *   post:
 *     summary: Create a new sub category
 *     tags: [Categories]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - slug
 *               - serviceCategory
 *             properties:
 *               name:
 *                 type: string
 *               slug:
 *                 type: string
 *               serviceCategory:
 *                 type: string
 *               icon:
 *                 type: string
 *               displayOrder:
 *                 type: integer
 *               status:
 *                 type: object
 *                 properties:
 *                   isActive:
 *                     type: boolean
 *     responses:
 *       201:
 *         description: Sub category created successfully
 */
router.post('/sub', protect, requirePermission('categories.manage'), categoryController.createSubCategory);

/**
 * @swagger
 * /api/v1/categories/super:
 *   get:
 *     summary: Get all super categories
 *     tags: [Categories]
 *     responses:
 *       200:
 *         description: List of super categories
 */
router.get('/super', categoryController.getSuperCategories);

/**
 * @swagger
 * /api/v1/categories/service:
 *   get:
 *     summary: Get all service categories
 *     tags: [Categories]
 *     responses:
 *       200:
 *         description: List of service categories
 */
router.get('/service', categoryController.getServiceCategories);

/**
 * @swagger
 * /api/v1/categories/sub:
 *   get:
 *     summary: Get all sub categories
 *     tags: [Categories]
 *     responses:
 *       200:
 *         description: List of sub categories
 */
router.get('/sub', categoryController.getSubCategories);

router.get('/getHierarchy', categoryController.getCategoryHierarchy);

// Admin-only: update/delete categories (dashboard/admin panel)
router.put('/super-category/:id', protect, requirePermission('categories.manage'), categoryController.updateSuperCategory);
router.delete('/super-category/:id', protect, requirePermission('categories.manage'), categoryController.deleteSuperCategory);

router.put('/service-category/:id', protect, requirePermission('categories.manage'), categoryController.updateServiceCategory);
router.delete('/service-category/:id', protect, requirePermission('categories.manage'), categoryController.deleteServiceCategory);

router.put('/sub-category/:id', protect, requirePermission('categories.manage'), categoryController.updateSubCategory);
router.delete('/sub-category/:id', protect, requirePermission('categories.manage'), categoryController.deleteSubCategory);

module.exports = router;
