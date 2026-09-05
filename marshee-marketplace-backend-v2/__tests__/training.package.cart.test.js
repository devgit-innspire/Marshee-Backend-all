const mongoose = require('mongoose');
const Cart = require('../models/cart.model');
const { Service } = require('../models/service.model');

describe('training package pricing behavior', () => {
  test('training service requires at least one package', async () => {
    const doc = new Service({
      name: 'Dog Training',
      serviceType: 'training',
      category: 'Training',
      partner: { name: 'Trainer One' },
      pricing: { mrp: 3000, listPrice: 3000 },
      training: {
        programName: 'Basic Obedience'
      }
    });

    await expect(doc.validate()).rejects.toThrow('training.packages must include at least one package');
  });

  test('training service validates when active package exists with unique code', async () => {
    const doc = new Service({
      name: 'Dog Training Plus',
      serviceType: 'training',
      category: 'Training',
      partner: { name: 'Trainer Two' },
      pricing: { mrp: 3000, listPrice: 3000 },
      training: {
        packages: [
          {
            code: 'home-consult',
            name: 'Home Consult',
            sessionsCount: 1,
            isActive: true,
            pricing: { mrp: 3000, listPrice: 3000, billingUnit: 'one-time' }
          }
        ]
      }
    });

    await expect(doc.validate()).resolves.toBeUndefined();
  });

  test('cart keeps separate service lines per package code', () => {
    const serviceId = new mongoose.Types.ObjectId();
    const cart = new Cart({ user: new mongoose.Types.ObjectId(), items: [] });

    cart.addService({
      serviceId,
      quantity: 1,
      price: 3000,
      originalPrice: 3000,
      selectedExtras: [],
      selectedDate: null,
      notes: null,
      servicePackageCode: 'home-consult',
      servicePackageName: 'Home Consult'
    });
    cart.addService({
      serviceId,
      quantity: 1,
      price: 25000,
      originalPrice: 25000,
      selectedExtras: [],
      selectedDate: null,
      notes: null,
      servicePackageCode: 'home-10',
      servicePackageName: '10 Home Sessions'
    });

    expect(cart.items).toHaveLength(2);
    const packageCodes = cart.items.map(i => i.servicePackageCode).sort();
    expect(packageCodes).toEqual(['home-10', 'home-consult']);
  });

  test('updateServiceQuantity updates matching package line only', () => {
    const serviceId = new mongoose.Types.ObjectId();
    const cart = new Cart({ user: new mongoose.Types.ObjectId(), items: [] });

    cart.addService({
      serviceId,
      quantity: 1,
      price: 3000,
      originalPrice: 3000,
      selectedExtras: [],
      selectedDate: null,
      notes: null,
      servicePackageCode: 'home-consult',
      servicePackageName: 'Home Consult'
    });
    cart.addService({
      serviceId,
      quantity: 1,
      price: 25000,
      originalPrice: 25000,
      selectedExtras: [],
      selectedDate: null,
      notes: null,
      servicePackageCode: 'home-10',
      servicePackageName: '10 Home Sessions'
    });

    cart.updateServiceQuantity(serviceId, 3, 'home-10');

    const consultItem = cart.items.find(i => i.servicePackageCode === 'home-consult');
    const tenSessionItem = cart.items.find(i => i.servicePackageCode === 'home-10');
    expect(consultItem.quantity).toBe(1);
    expect(tenSessionItem.quantity).toBe(3);
  });
});
