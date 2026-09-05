const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Pets E-Commerce API',
            version: '1.0.0',
            description: 'API documentation for Pets E-Commerce platform'
        },
        servers: [
            {
                url: 'http://localhost:5001', // Development server
                description: 'Development server'
            },
            {
                url: 'https://osaw.in/v1/dev2', // Production server
                description: 'Production server'
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Enter your JWT token (from login/signup)'
                }
            },
            schemas: {
                CartItem: {
                    type: 'object',
                    properties: {
                        product: { type: 'string', format: 'objectId' },
                        variant: { type: 'string', format: 'objectId' },
                        quantity: { type: 'integer', minimum: 1 },
                        price: { type: 'number' },
                        originalPrice: { type: 'number' },
                        discount: { type: 'number' },
                        totalPrice: { type: 'number' }
                    }
                },
                Cart: {
                    type: 'object',
                    properties: {
                        _id: { type: 'string', format: 'objectId' },
                        user: { type: 'string', format: 'objectId' },
                        items: { type: 'array', items: { $ref: '#/components/schemas/CartItem' } },
                        subtotal: { type: 'number' },
                        totalDiscount: { type: 'number' },
                        shippingCost: { type: 'number' },
                        taxAmount: { type: 'number' },
                        totalAmount: { type: 'number' },
                        appliedCoupon: {
                            type: 'object',
                            properties: {
                                coupon: { type: 'string', format: 'objectId' },
                                code: { type: 'string' },
                                discountAmount: { type: 'number' }
                            }
                        }
                    }
                },
                CartAddRequest: {
                    type: 'object',
                    required: ['productId', 'variantId', 'quantity'],
                    properties: {
                        productId: { type: 'string', format: 'objectId' },
                        variantId: { type: 'string', format: 'objectId' },
                        quantity: { type: 'integer', minimum: 1 }
                    }
                },
                CartUpdateRequest: {
                    type: 'object',
                    required: ['productId', 'variantId', 'quantity'],
                    properties: {
                        productId: { type: 'string', format: 'objectId' },
                        variantId: { type: 'string', format: 'objectId' },
                        quantity: { type: 'integer', minimum: 1 }
                    }
                },
                CartRemoveRequest: {
                    type: 'object',
                    required: ['productId', 'variantId'],
                    properties: {
                        productId: { type: 'string', format: 'objectId' },
                        variantId: { type: 'string', format: 'objectId' }
                    }
                },
                CartResponse: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        message: { type: 'string' },
                        data: { $ref: '#/components/schemas/Cart' }
                    }
                },
                ApplyCouponRequest: {
                    type: 'object',
                    required: ['couponCode'],
                    properties: {
                        couponCode: { type: 'string' }
                    }
                }
            }
        }
    },
    // Update the path to match your project structure
    apis: ['./routes/*.js', './routes/**/*.js']  // This will look for all .js files in routes directory
};

const specs = swaggerJsdoc(options);

module.exports = specs;
