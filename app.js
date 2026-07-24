require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.SUPER_ADMIN_PORT || process.env.PORT || 3001;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bcm_food_hub';
const JWT_SECRET = process.env.SUPER_ADMIN_JWT_SECRET || process.env.JWT_SECRET || 'bcmfoodhub-secret-2024';
const BOOTSTRAP_USERNAME = (process.env.SUPER_ADMIN_USERNAME || 'karabo').trim().toLowerCase();
const BOOTSTRAP_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'karabo';
const ORDER_STATUSES = ['Pending Payment','Paid','Confirmed','Preparing','Packed','Shipped','In Transit','Delivered','Completed','Cancelled','Refunded'];
const PROVINCES = ['Eastern Cape','Free State','Gauteng','KwaZulu-Natal','Limpopo','Mpumalanga','Northern Cape','North West','Western Cape'];

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// --------------------- SHARED BCM FOODHUB MODELS ---------------------
// These models point to the same MongoDB collections used by the customer app.
const UserSchema = new mongoose.Schema({
  username: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: String,
  phone: String,
  role: { type: String, enum: ['customer','store_admin','super_admin'], default: 'customer' },
  avatar: String,
  isVerified: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  loyaltyPoints: { type: Number, default: 0 },
  referralCode: String,
  passwordChangedAt: Date,
  bootstrapAdmin: { type: Boolean, default: false },
  preferences: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
}, { strict: false });
const User = mongoose.models.User || mongoose.model('User', UserSchema);

const StoreSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: String, slug: String, logo: String, banner: String, gallery: [String], description: String,
  email: String, phone: String, address: String, city: String, province: String, shippingRegions: [String],
  preparationDays: Number, shippingDays: Number, shippingCutoffHour: String, minOrder: Number,
  verified: { type: Boolean, default: false },
  approvalStatus: { type: String, default: 'draft' }, submittedAt: Date, approvedAt: Date,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, rejectionReason: String,
  active: { type: Boolean, default: true }, featured: { type: Boolean, default: false },
  commissionRate: Number, rating: Number, reviewCount: Number, totalOrders: Number,
  createdAt: { type: Date, default: Date.now }
}, { strict: false });
const Store = mongoose.models.Store || mongoose.model('Store', StoreSchema);

const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true }, slug: { type: String, unique: true }, description: String, image: String,
  featured: { type: Boolean, default: false }, active: { type: Boolean, default: true }, sortOrder: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
}, { strict: false });
const Category = mongoose.models.Category || mongoose.model('Category', CategorySchema);

const ProductSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, storeId: String,
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' }, collectionId: mongoose.Schema.Types.ObjectId,
  name: String, slug: String, description: String, images: [String], price: Number, salePrice: Number, stock: Number,
  preorder: Boolean, preparationDays: Number, shippingDays: Number, ingredients: [String], allergens: [String],
  featured: { type: Boolean, default: false }, active: { type: Boolean, default: true }, rating: Number, reviewCount: Number,
  badge: String, createdAt: { type: Date, default: Date.now }
}, { strict: false });
const Product = mongoose.models.Product || mongoose.model('Product', ProductSchema);

const CollectionSchema = new mongoose.Schema({
  name: String, slug: { type: String, unique: true }, description: String, image: String, banner: String,
  type: String, featured: { type: Boolean, default: false }, active: { type: Boolean, default: true },
  productIds: [String], storeIds: [String], validFrom: Date, validTo: Date, createdAt: { type: Date, default: Date.now }
}, { strict: false });
const Collection = mongoose.models.Collection || mongoose.model('Collection', CollectionSchema);

const CouponSchema = new mongoose.Schema({
  code: { type: String, unique: true, uppercase: true }, description: String,
  discountType: { type: String, enum: ['percent','fixed'], default: 'percent' }, discountValue: Number,
  minOrderAmount: Number, maxDiscount: Number, maxUses: Number, usedCount: Number, storeId: String,
  applicableProducts: [String], validFrom: Date, validTo: Date, active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
}, { strict: false });
const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', CouponSchema);

const OrderSchema = new mongoose.Schema({
  orderNumber: { type: String, unique: true }, userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  shippingAddress: mongoose.Schema.Types.Mixed,
  items: [{ productId: String, storeId: String, productName: String, storeName: String, quantity: Number, price: Number, fulfillmentStatus: String, image: String }],
  subtotal: Number, shippingFee: Number, discountAmount: Number, couponCode: String, total: Number,
  status: { type: String, enum: ORDER_STATUSES, default: 'Pending Payment' }, paymentStatus: String,
  scheduledShippingDate: Date, trackingNumber: String, courier: String, notes: String,
  createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now }
}, { strict: false });
const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);

const NotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, storeId: String, type: String,
  title: String, message: String, link: String, read: { type: Boolean, default: false }, createdAt: { type: Date, default: Date.now }
}, { strict: false });
const Notification = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);

const SupportTicketSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, storeId: String, orderId: mongoose.Schema.Types.ObjectId,
  subject: String, message: String, status: { type: String, default: 'open' }, priority: { type: String, default: 'medium' },
  responses: [{ sender: String, message: String, createdAt: Date }], createdAt: { type: Date, default: Date.now }
}, { strict: false });
const SupportTicket = mongoose.models.SupportTicket || mongoose.model('SupportTicket', SupportTicketSchema);

const PlatformSettingsSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: mongoose.Schema.Types.Mixed, description: String, updatedAt: { type: Date, default: Date.now } }, { strict: false });
const PlatformSettings = mongoose.models.PlatformSettings || mongoose.model('PlatformSettings', PlatformSettingsSchema);

const AdminAuditSchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, action: String, entityType: String, entityId: String,
  summary: String, createdAt: { type: Date, default: Date.now }
});
const AdminAudit = mongoose.models.AdminAudit || mongoose.model('AdminAudit', AdminAuditSchema);

// --------------------- HELPERS / AUTH ---------------------
const clean = (value, length=500) => typeof value === 'string' ? value.trim().slice(0, length) : '';
const num = (value, fallback=0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
const bool = value => value === true || value === 'true';
const list = value => Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : String(value || '').split(',').map(item => item.trim()).filter(Boolean);
const slugify = text => clean(text, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const userView = user => ({ _id: user._id, username: user.username, name: user.name, email: user.email, role: user.role, avatar: user.avatar, createdAt: user.createdAt });

function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'super_admin') return res.status(403).json({ error: 'Super admin access required.' });
    User.findById(decoded.userId).then(user => {
      if (!user || !user.isActive || user.role !== 'super_admin') return res.status(401).json({ error: 'Your admin session is no longer active.' });
      req.user = user; next();
    }).catch(() => res.status(401).json({ error: 'Unable to verify your session.' }));
  } catch (error) { return res.status(401).json({ error: 'Invalid or expired session.' }); }
}

async function audit(req, action, entityType, entityId, summary) {
  try { await AdminAudit.create({ adminId: req.user?._id, action, entityType, entityId: String(entityId || ''), summary: clean(summary, 500) }); } catch (error) { console.warn('Audit log error:', error.message); }
}
async function uniqueSlug(Model, desired, ignoreId=null) {
  const base = slugify(desired) || 'item'; let candidate = base; let counter = 2;
  while (await Model.exists(ignoreId ? { slug: candidate, _id: { $ne: ignoreId } } : { slug: candidate })) candidate = `${base}-${counter++}`;
  return candidate;
}

// --------------------- LOGIN ONLY ---------------------
app.post('/api/auth/login', async (req, res) => {
  try {
    const username = clean(req.body.username, 80).toLowerCase();
    const password = String(req.body.password || '');
    if (!username || !password) return res.status(400).json({ error: 'Enter your username and password.' });
    const user = await User.findOne({ username });
    if (!user || user.role !== 'super_admin' || !user.isActive) return res.status(401).json({ error: 'Invalid admin credentials.' });
    if (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid admin credentials.' });
    const token = jwt.sign({ userId: user._id, role: 'super_admin' }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: userView(user) });
  } catch (error) { res.status(500).json({ error: 'Could not log in.' }); }
});
app.get('/api/auth/me', adminAuth, (req, res) => res.json(userView(req.user)));
app.put('/api/auth/profile', adminAuth, async (req, res) => {
  const name = clean(req.body.name, 120); const username = clean(req.body.username, 80).toLowerCase();
  if (!name || !username) return res.status(400).json({ error: 'Name and username are required.' });
  const taken = await User.exists({ username, _id: { $ne: req.user._id } });
  if (taken) return res.status(400).json({ error: 'That username is already taken.' });
  req.user.name = name; req.user.username = username; if (req.body.avatar !== undefined) req.user.avatar = clean(req.body.avatar, 500);
  await req.user.save(); await audit(req, 'update_profile', 'admin', req.user._id, 'Updated admin profile');
  res.json(userView(req.user));
});
app.put('/api/auth/password', adminAuth, async (req, res) => {
  const currentPassword = String(req.body.currentPassword || ''); const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must have at least 8 characters.' });
  if (!(await bcrypt.compare(currentPassword, req.user.passwordHash))) return res.status(400).json({ error: 'Current password is incorrect.' });
  req.user.passwordHash = await bcrypt.hash(newPassword, 12); req.user.passwordChangedAt = new Date(); await req.user.save();
  await audit(req, 'change_password', 'admin', req.user._id, 'Changed admin password');
  res.json({ ok: true });
});

// --------------------- DASHBOARD ---------------------
app.get('/api/admin/dashboard', adminAuth, async (req, res) => {
  const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [pendingStores, approvedStores, products, customers, openTickets, paidOrders, recentOrders, pendingList, revenue] = await Promise.all([
    Store.countDocuments({ approvalStatus: 'pending' }), Store.countDocuments({ approvalStatus: 'approved', active: true }),
    Product.countDocuments({ active: true }), User.countDocuments({ role: 'customer', isActive: true }),
    SupportTicket.countDocuments({ status: { $in: ['open','pending'] } }), Order.countDocuments({ paymentStatus: 'paid' }),
    Order.find({}).sort({ createdAt: -1 }).limit(6).populate('userId', 'name email'),
    Store.find({ approvalStatus: 'pending' }).sort({ submittedAt: 1 }).limit(6).populate('ownerId', 'name email'),
    Order.aggregate([{ $match: { paymentStatus: 'paid', createdAt: { $gte: monthStart } } }, { $group: { _id: null, total: { $sum: '$total' } } }])
  ]);
  res.json({ stats: { pendingStores, approvedStores, products, customers, openTickets, paidOrders, monthlyRevenue: revenue[0]?.total || 0 }, recentOrders, pendingStores: pendingList });
});

// --------------------- STORE APPROVAL & MANAGEMENT ---------------------
app.get('/api/admin/stores', adminAuth, async (req, res) => {
  const status = clean(req.query.status || 'all', 30); const search = clean(req.query.search || '', 120);
  const query = status === 'all' ? {} : { approvalStatus: status };
  if (search) query.$or = [{ name: new RegExp(search, 'i') }, { city: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }];
  const stores = await Store.find(query).populate('ownerId', 'name email phone').sort({ submittedAt: 1, createdAt: -1 }).limit(300);
  res.json(stores);
});
app.put('/api/admin/stores/:id/approval', adminAuth, async (req, res) => {
  const store = await Store.findOne({ id: req.params.id }); const action = clean(req.body.action, 20); const reason = clean(req.body.reason, 500);
  if (!store) return res.status(404).json({ error: 'Store not found.' });
  if (action === 'approve') {
    store.approvalStatus = 'approved'; store.verified = true; store.active = true; store.approvedAt = new Date(); store.approvedBy = req.user._id; store.rejectionReason = undefined;
  } else if (action === 'reject') {
    if (!reason) return res.status(400).json({ error: 'A rejection reason is required.' });
    store.approvalStatus = 'rejected'; store.verified = false; store.rejectionReason = reason;
  } else if (action === 'suspend') {
    store.approvalStatus = 'suspended'; store.verified = false; store.active = false; store.rejectionReason = reason || 'Store suspended by BCM FoodHub.';
  } else return res.status(400).json({ error: 'Use approve, reject or suspend.' });
  await store.save();
  if (store.ownerId) await Notification.create({ userId: store.ownerId, storeId: store.id, type: 'approval', title: `Store ${store.approvalStatus}`, message: action === 'approve' ? `${store.name} is now live on BCM FoodHub.` : `Update for ${store.name}: ${store.rejectionReason}`, link: '/seller' });
  await audit(req, action, 'store', store.id, `${store.name}: ${action}`);
  res.json(store);
});
app.put('/api/admin/stores/:id', adminAuth, async (req, res) => {
  const store = await Store.findOne({ id: req.params.id }); if (!store) return res.status(404).json({ error: 'Store not found.' });
  const fields = ['name','description','email','phone','address','city','province','logo','banner','shippingCutoffHour'];
  fields.forEach(key => { if (req.body[key] !== undefined) store[key] = clean(req.body[key], key === 'description' ? 2000 : 500); });
  ['preparationDays','shippingDays','minOrder','commissionRate'].forEach(key => { if (req.body[key] !== undefined) store[key] = Math.max(0, num(req.body[key])); });
  if (req.body.shippingRegions !== undefined) store.shippingRegions = list(req.body.shippingRegions).filter(region => PROVINCES.includes(region) || region === 'Nationwide');
  ['active','featured'].forEach(key => { if (req.body[key] !== undefined) store[key] = bool(req.body[key]); });
  if (store.name && store.name !== req.body.originalName) store.slug = await uniqueSlug(Store, store.name, store._id);
  await store.save(); await audit(req, 'update', 'store', store.id, `Updated ${store.name}`); res.json(store);
});

// --------------------- PRODUCTS ---------------------
app.get('/api/admin/products', adminAuth, async (req, res) => {
  const search = clean(req.query.search || '', 120); const status = clean(req.query.status || 'all', 20); const storeId = clean(req.query.storeId || '', 100);
  const query = {}; if (status === 'active') query.active = true; if (status === 'inactive') query.active = false; if (storeId) query.storeId = storeId;
  if (search) query.$or = [{ name: new RegExp(search, 'i') }, { id: new RegExp(search, 'i') }];
  const products = await Product.find(query).sort({ createdAt: -1 }).limit(400);
  const stores = await Store.find({ id: { $in: [...new Set(products.map(product => product.storeId))] } }).select('id name city approvalStatus');
  const map = Object.fromEntries(stores.map(store => [store.id, store]));
  res.json(products.map(product => ({ ...product.toObject(), store: map[product.storeId] || null })));
});
app.put('/api/admin/products/:id', adminAuth, async (req, res) => {
  const product = await Product.findOne({ id: req.params.id }); if (!product) return res.status(404).json({ error: 'Product not found.' });
  const fields = ['name','description','badge']; fields.forEach(key => { if (req.body[key] !== undefined) product[key] = clean(req.body[key], key === 'description' ? 5000 : 180); });
  ['price','salePrice','stock','preparationDays','shippingDays'].forEach(key => { if (req.body[key] !== undefined && req.body[key] !== '') product[key] = Math.max(0, num(req.body[key])); });
  if (req.body.salePrice === '' || req.body.salePrice === null) product.salePrice = undefined;
  ['active','featured','preorder'].forEach(key => { if (req.body[key] !== undefined) product[key] = bool(req.body[key]); });
  if (req.body.images !== undefined) product.images = list(req.body.images).slice(0, 8);
  await product.save(); await audit(req, 'update', 'product', product.id, `Updated ${product.name}`); res.json(product);
});

// --------------------- ORDERS ---------------------
app.get('/api/admin/orders', adminAuth, async (req, res) => {
  const status = clean(req.query.status || 'all', 40); const search = clean(req.query.search || '', 120);
  const query = status === 'all' ? {} : { status };
  if (search) query.$or = [{ orderNumber: new RegExp(search, 'i') }, { 'items.productName': new RegExp(search, 'i') }];
  const orders = await Order.find(query).populate('userId', 'name email phone').sort({ createdAt: -1 }).limit(400);
  res.json(orders);
});
app.put('/api/admin/orders/:id', adminAuth, async (req, res) => {
  const order = await Order.findById(req.params.id); if (!order) return res.status(404).json({ error: 'Order not found.' });
  const status = clean(req.body.status, 40);
  if (status && !ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid order status.' });
  if (status) { order.status = status; order.items.forEach(item => { item.fulfillmentStatus = status; }); }
  if (req.body.trackingNumber !== undefined) order.trackingNumber = clean(req.body.trackingNumber, 100);
  if (req.body.courier !== undefined) order.courier = clean(req.body.courier, 100);
  if (req.body.notes !== undefined) order.notes = clean(req.body.notes, 1000);
  order.updatedAt = new Date(); await order.save();
  if (order.userId) await Notification.create({ userId: order.userId, type: 'order', title: 'Order update', message: `Your order ${order.orderNumber} is now ${order.status}.`, link: `/orders/${order._id}` });
  await audit(req, 'update_status', 'order', order._id, `${order.orderNumber}: ${order.status}`); res.json(order);
});

// --------------------- CUSTOMERS ---------------------
app.get('/api/admin/users', adminAuth, async (req, res) => {
  const search = clean(req.query.search || '', 120); const role = clean(req.query.role || 'customer', 40);
  const query = role === 'all' ? {} : { role };
  if (search) query.$or = [{ name: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }, { phone: new RegExp(search, 'i') }];
  res.json(await User.find(query).select('-passwordHash').sort({ createdAt: -1 }).limit(400));
});
app.put('/api/admin/users/:id/status', adminAuth, async (req, res) => {
  const user = await User.findById(req.params.id); if (!user) return res.status(404).json({ error: 'User not found.' });
  if (String(user._id) === String(req.user._id)) return res.status(400).json({ error: 'You cannot deactivate your own admin account.' });
  user.isActive = bool(req.body.isActive); await user.save(); await audit(req, user.isActive ? 'activate' : 'deactivate', 'user', user._id, `${user.email} ${user.isActive ? 'activated' : 'deactivated'}`); res.json({ _id: user._id, isActive: user.isActive });
});

// --------------------- CATEGORIES / COLLECTIONS / PROMOTIONS ---------------------
app.get('/api/admin/categories', adminAuth, async (req, res) => res.json(await Category.find({}).sort({ sortOrder: 1, name: 1 })));
app.post('/api/admin/categories', adminAuth, async (req, res) => {
  const name = clean(req.body.name, 120); if (!name) return res.status(400).json({ error: 'Category name is required.' });
  const category = await Category.create({ name, slug: await uniqueSlug(Category, req.body.slug || name), description: clean(req.body.description, 500), image: clean(req.body.image, 500), sortOrder: num(req.body.sortOrder), featured: bool(req.body.featured), active: req.body.active === undefined ? true : bool(req.body.active) });
  await audit(req, 'create', 'category', category._id, `Created ${category.name}`); res.status(201).json(category);
});
app.put('/api/admin/categories/:id', adminAuth, async (req, res) => {
  const category = await Category.findById(req.params.id); if (!category) return res.status(404).json({ error: 'Category not found.' });
  if (req.body.name !== undefined) { category.name = clean(req.body.name, 120); category.slug = await uniqueSlug(Category, req.body.slug || category.name, category._id); }
  ['description','image'].forEach(key => { if (req.body[key] !== undefined) category[key] = clean(req.body[key], 500); });
  if (req.body.sortOrder !== undefined) category.sortOrder = num(req.body.sortOrder); ['featured','active'].forEach(key => { if (req.body[key] !== undefined) category[key] = bool(req.body[key]); });
  await category.save(); await audit(req, 'update', 'category', category._id, `Updated ${category.name}`); res.json(category);
});

app.get('/api/admin/collections', adminAuth, async (req, res) => res.json(await Collection.find({}).sort({ createdAt: -1 })));
app.put('/api/admin/collections/:id', adminAuth, async (req, res) => {
  const collection = await Collection.findById(req.params.id); if (!collection) return res.status(404).json({ error: 'Collection not found.' });
  ['name','description','image','banner','type'].forEach(key => { if (req.body[key] !== undefined) collection[key] = clean(req.body[key], key === 'description' ? 1000 : 500); });
  ['featured','active'].forEach(key => { if (req.body[key] !== undefined) collection[key] = bool(req.body[key]); });
  if (collection.name && req.body.name !== undefined) collection.slug = await uniqueSlug(Collection, collection.name, collection._id);
  await collection.save(); await audit(req, 'update', 'collection', collection._id, `Updated ${collection.name}`); res.json(collection);
});

app.get('/api/admin/coupons', adminAuth, async (req, res) => res.json(await Coupon.find({}).sort({ createdAt: -1 })));
app.post('/api/admin/coupons', adminAuth, async (req, res) => {
  const code = clean(req.body.code, 40).toUpperCase(); if (!code || !['percent','fixed'].includes(req.body.discountType) || num(req.body.discountValue) <= 0) return res.status(400).json({ error: 'Code, discount type and value are required.' });
  if (await Coupon.exists({ code })) return res.status(400).json({ error: 'That coupon code already exists.' });
  const coupon = await Coupon.create({ code, description: clean(req.body.description, 300), discountType: req.body.discountType, discountValue: num(req.body.discountValue), minOrderAmount: Math.max(0, num(req.body.minOrderAmount)), maxDiscount: req.body.maxDiscount === '' ? undefined : Math.max(0, num(req.body.maxDiscount)), maxUses: Math.max(1, num(req.body.maxUses, 100)), validFrom: req.body.validFrom ? new Date(req.body.validFrom) : new Date(), validTo: req.body.validTo ? new Date(req.body.validTo) : undefined, active: req.body.active === undefined ? true : bool(req.body.active) });
  await audit(req, 'create', 'coupon', coupon._id, `Created ${coupon.code}`); res.status(201).json(coupon);
});
app.put('/api/admin/coupons/:id', adminAuth, async (req, res) => {
  const coupon = await Coupon.findById(req.params.id); if (!coupon) return res.status(404).json({ error: 'Coupon not found.' });
  if (req.body.code !== undefined) coupon.code = clean(req.body.code, 40).toUpperCase();
  if (req.body.description !== undefined) coupon.description = clean(req.body.description, 300);
  if (['percent','fixed'].includes(req.body.discountType)) coupon.discountType = req.body.discountType;
  ['discountValue','minOrderAmount','maxDiscount','maxUses'].forEach(key => { if (req.body[key] !== undefined && req.body[key] !== '') coupon[key] = Math.max(0, num(req.body[key])); });
  if (req.body.validFrom !== undefined) coupon.validFrom = req.body.validFrom ? new Date(req.body.validFrom) : undefined;
  if (req.body.validTo !== undefined) coupon.validTo = req.body.validTo ? new Date(req.body.validTo) : undefined;
  if (req.body.active !== undefined) coupon.active = bool(req.body.active);
  await coupon.save(); await audit(req, 'update', 'coupon', coupon._id, `Updated ${coupon.code}`); res.json(coupon);
});

// --------------------- SUPPORT / SETTINGS / AUDIT ---------------------
app.get('/api/admin/support', adminAuth, async (req, res) => res.json(await SupportTicket.find({}).populate('userId','name email phone').sort({ createdAt: -1 }).limit(300)));
app.put('/api/admin/support/:id', adminAuth, async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id); if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
  if (req.body.status) ticket.status = clean(req.body.status, 30); if (req.body.priority) ticket.priority = clean(req.body.priority, 30);
  const message = clean(req.body.message, 2000); if (message) ticket.responses.push({ sender: 'admin', message, createdAt: new Date() });
  await ticket.save(); if (ticket.userId && message) await Notification.create({ userId: ticket.userId, type: 'support', title: 'Support replied', message: `BCM FoodHub replied to: ${ticket.subject}`, link: '/account/messages' });
  await audit(req, 'reply', 'support_ticket', ticket._id, `Updated ${ticket.subject}`); res.json(ticket);
});
app.get('/api/admin/settings', adminAuth, async (req, res) => {
  const settings = await PlatformSettings.find({}); const map = {}; settings.forEach(item => map[item.key] = item.value); res.json(map);
});
app.put('/api/admin/settings', adminAuth, async (req, res) => {
  const allowed = { deliveryFee: 'Nationwide delivery fee', freeDeliveryAbove: 'Free delivery threshold', commissionDefault: 'Default store commission percentage', cutoffHour: 'Default order cutoff time', supportEmail: 'Marketplace support email' };
  const output = {};
  for (const [key, description] of Object.entries(allowed)) {
    if (req.body[key] === undefined) continue;
    const value = ['deliveryFee','freeDeliveryAbove','commissionDefault'].includes(key) ? Math.max(0, num(req.body[key])) : clean(req.body[key], 160);
    const setting = await PlatformSettings.findOneAndUpdate({ key }, { value, description, updatedAt: new Date() }, { upsert: true, new: true, setDefaultsOnInsert: true }); output[key] = setting.value;
  }
  await audit(req, 'update', 'settings', 'platform', 'Updated marketplace settings'); res.json(output);
});
app.get('/api/admin/audit', adminAuth, async (req, res) => res.json(await AdminAudit.find({}).populate('adminId','name username').sort({ createdAt: -1 }).limit(100)));

// --------------------- FRONTEND / PWA ---------------------
app.use(express.static(path.join(__dirname, 'public')));
app.get('/manifest.webmanifest', (req, res) => res.json({ name: 'BCM FoodHub Admin', short_name: 'BCM Admin', start_url: '/', display: 'standalone', background_color: '#0f1720', theme_color: '#0b7a43', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] }));
app.get('/icon.svg', (req, res) => res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0b7a43"/><stop offset="1" stop-color="#1baa61"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><path d="M157 188h198l-19 183H176z" fill="white"/><path d="M212 188c0-52 22-84 44-84s44 32 44 84" fill="none" stroke="white" stroke-width="25" stroke-linecap="round"/><path d="M196 248h120m-112 52h104" stroke="#0b7a43" stroke-width="18" stroke-linecap="round"/><circle cx="366" cy="146" r="56" fill="#f4bd3a"/><path d="m341 147 16 16 31-34" fill="none" stroke="#16351f" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/></svg>'));
app.get('*', (req, res) => {
  const index = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(404).send('Super Admin index.html not found.');
});

async function bootstrapAdmin() {
  let admin = await User.findOne({ $or: [{ username: BOOTSTRAP_USERNAME }, { bootstrapAdmin: true }] });
  if (!admin) {
    const email = `${BOOTSTRAP_USERNAME}@bcmfoodhub.admin`;
    const emailOwner = await User.findOne({ email });
    if (emailOwner) {
      admin = emailOwner; admin.username = BOOTSTRAP_USERNAME; admin.role = 'super_admin'; admin.bootstrapAdmin = true; admin.isActive = true;
      if (!admin.passwordHash) admin.passwordHash = await bcrypt.hash(BOOTSTRAP_PASSWORD, 12);
      await admin.save();
    } else {
      admin = await User.create({ username: BOOTSTRAP_USERNAME, name: 'Karabo', email, passwordHash: await bcrypt.hash(BOOTSTRAP_PASSWORD, 12), role: 'super_admin', bootstrapAdmin: true, isVerified: true, isActive: true });
    }
    console.log(`✅ Bootstrap super admin created: ${BOOTSTRAP_USERNAME}`);
  } else {
    // Keep a changed password intact. Until it is changed in My Admin Profile,
    // the requested initial test password remains available on restarts.
    admin.role = 'super_admin'; admin.bootstrapAdmin = true; admin.isActive = true;
    if (!admin.passwordChangedAt) admin.passwordHash = await bcrypt.hash(BOOTSTRAP_PASSWORD, 12);
    await admin.save();
    console.log(`✅ Bootstrap super admin ready: ${BOOTSTRAP_USERNAME}`);
  }
}

mongoose.connect(MONGO_URI).then(async () => {
  console.log('✅ MongoDB connected — BCM FoodHub Super Admin');
  try { await bootstrapAdmin(); } catch (error) { console.error('Admin bootstrap error:', error.message); }
}).catch(error => console.error('MongoDB connection error:', error.message));

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 BCM FoodHub Super Admin running at http://localhost:${PORT}`));
