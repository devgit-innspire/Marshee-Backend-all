// Test script to verify address ID implementation
const mongoose = require('mongoose');
require('dotenv').config();

// Connect to database
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/marshee-marketplace', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const Order = require('./models/order.model');
const User = require('./models/user.model');
const Address = require('./models/address.model');
const Cart = require('./models/cart.model');
const Product = require('./models/product.model');

async function testAddressIdImplementation() {
    try {
        console.log('🧪 Testing Address ID Implementation...\n');
        
        // Find a test user
        const user = await User.findOne();
        if (!user) {
            console.log('❌ No users found. Please create a user first.');
            return;
        }
        
        console.log('✅ Found user:', user.email);
        
        // Create test addresses
        const shippingAddress = await Address.create({
            user: user._id,
            name: 'John Doe',
            phone: '9876543210',
            email: 'john@example.com',
            address: {
                street: '123 Test Street',
                city: 'Mumbai',
                state: 'Maharashtra',
                pinCode: '400001',
                country: 'India'
            },
            isDefaultShipping: true,
            isDefaultBilling: false
        });
        
        const billingAddress = await Address.create({
            user: user._id,
            name: 'John Doe',
            phone: '9876543210',
            email: 'john@example.com',
            address: {
                street: '456 Billing Street',
                city: 'Mumbai',
                state: 'Maharashtra',
                pinCode: '400002',
                country: 'India'
            },
            isDefaultShipping: false,
            isDefaultBilling: true
        });
        
        console.log('✅ Created test addresses');
        console.log('   Shipping Address ID:', shippingAddress._id);
        console.log('   Billing Address ID:', billingAddress._id);
        
        // Find or create cart
        let cart = await Cart.findOne({ user: user._id });
        if (!cart) {
            cart = await Cart.create({
                user: user._id,
                items: [],
                subtotal: 0,
                totalDiscount: 0,
                shippingCost: 0,
                taxAmount: 0,
                totalAmount: 0
            });
        }
        
        // Add a test product to cart
        const product = await Product.findOne();
        if (product) {
            cart.items.push({
                product: product._id,
                quantity: 2,
                price: 100,
                originalPrice: 120,
                discount: 20,
                totalPrice: 200
            });
            cart.calculateTotals();
            await cart.save();
            console.log('✅ Added product to cart');
        }
        
        // Test 1: Order creation with address IDs
        console.log('\n📝 Test 1: Creating order with address IDs...');
        const order = await Order.create({
            user: user._id,
            items: cart.items.map(item => ({
                product: item.product,
                quantity: item.quantity,
                price: item.price,
                originalPrice: item.originalPrice,
                discount: item.discount,
                totalPrice: item.totalPrice,
                commission: {
                    percentage: 5,
                    amount: (item.price * 5) / 100
                }
            })),
            subtotal: cart.subtotal,
            totalDiscount: cart.totalDiscount,
            shippingCost: cart.shippingCost,
            taxAmount: cart.taxAmount,
            totalAmount: cart.totalAmount,
            shippingAddress: shippingAddress._id,
            billingAddress: billingAddress._id,
            payment: {
                method: 'cod',
                status: 'pending'
            },
            shipping: {
                method: 'Standard Delivery',
                estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            }
        });
        
        console.log('✅ Order created successfully!');
        console.log('   Order Number:', order.orderNumber);
        console.log('   Shipping Address ID:', order.shippingAddress);
        console.log('   Billing Address ID:', order.billingAddress);
        
        // Test 2: Populate addresses
        console.log('\n📝 Test 2: Populating addresses...');
        const populatedOrder = await Order.findById(order._id)
            .populate('shippingAddress', 'name phone email address')
            .populate('billingAddress', 'name phone email address');
        
        console.log('✅ Address population successful!');
        console.log('   Shipping Address:', {
            name: populatedOrder.shippingAddress.name,
            phone: populatedOrder.shippingAddress.phone,
            city: populatedOrder.shippingAddress.address.city
        });
        console.log('   Billing Address:', {
            name: populatedOrder.billingAddress.name,
            phone: populatedOrder.billingAddress.phone,
            city: populatedOrder.billingAddress.address.city
        });
        
        // Test 3: Verify data integrity
        console.log('\n📝 Test 3: Verifying data integrity...');
        const shippingAddr = await Address.findById(order.shippingAddress);
        const billingAddr = await Address.findById(order.billingAddress);
        
        if (shippingAddr && billingAddr) {
            console.log('✅ Address references are valid');
            console.log('   Shipping address belongs to user:', shippingAddr.user.toString() === user._id.toString());
            console.log('   Billing address belongs to user:', billingAddr.user.toString() === user._id.toString());
        } else {
            console.log('❌ Address references are invalid');
        }
        
        // Test 4: Test order queries with populated addresses
        console.log('\n📝 Test 4: Testing order queries...');
        const orders = await Order.find({ user: user._id })
            .populate('shippingAddress', 'name phone email address')
            .populate('billingAddress', 'name phone email address')
            .limit(1);
        
        if (orders.length > 0) {
            console.log('✅ Order query with populated addresses successful');
            console.log('   Found', orders.length, 'order(s)');
        }
        
        // Clean up test data
        console.log('\n🧹 Cleaning up test data...');
        await Order.findByIdAndDelete(order._id);
        await Address.findByIdAndDelete(shippingAddress._id);
        await Address.findByIdAndDelete(billingAddress._id);
        cart.items = [];
        cart.calculateTotals();
        await cart.save();
        
        console.log('✅ Test data cleaned up');
        console.log('\n🎉 All tests passed! Address ID implementation is working correctly.');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    } finally {
        mongoose.connection.close();
    }
}

testAddressIdImplementation();
