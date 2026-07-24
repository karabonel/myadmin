require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'bcm-foodhub-secret-2024-goldbelly';
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bcm_foodhub';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const ORDER_STATUSES = ['Pending Payment','Paid','Confirmed','Preparing','Packed','Shipped','In Transit','Delivered','Completed','Cancelled','Refunded'];

// Models reuse
const UserSchema = new mongoose.Schema({
  name: String, email: { type: String, unique: true }, passwordHash: String, phone: String,
  role: { type: String, enum: ['customer','store_admin','super_admin'] }, isActive: { type: Boolean, default: true }, isVerified: Boolean, createdAt: { type: Date, default: Date.now }, loyaltyPoints: Number
});
const User = mongoose.models.User || mongoose.model('User', UserSchema);

const StoreSchema = new mongoose.Schema({
  id: { type: String, unique: true }, ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: String, slug: String, logo: String, banner: String, description: String, email: String, phone: String, address: String, city: String, province: String,
  shippingRegions: [String], preparationDays: Number, shippingDays: Number, verified: Boolean, active: Boolean, featured: Boolean, commissionRate: Number, rating: Number, totalOrders: Number, createdAt: Date
});
const Store = mongoose.models.Store || mongoose.model('Store', StoreSchema);

const CategorySchema = new mongoose.Schema({ name: String, slug: { type: String, unique: true }, description: String, image: String, featured: Boolean, active: Boolean, sortOrder: Number });
const Category = mongoose.models.Category || mongoose.model('Category', CategorySchema);

const CollectionSchema = new mongoose.Schema({ name: String, slug: { type: String, unique: true }, description: String, image: String, banner: String, type: String, featured: Boolean, active: Boolean, productIds: [String], storeIds: [String], validFrom: Date, validTo: Date });
const Collection = mongoose.models.Collection || mongoose.model('Collection', CollectionSchema);

const ProductSchema = new mongoose.Schema({
  id: { type: String, unique: true }, storeId: String, categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  name: String, price: Number, salePrice: Number, stock: Number, preorder: Boolean, featured: Boolean, active: Boolean, createdAt: Date
});
const Product = mongoose.models.Product || mongoose.model('Product', ProductSchema);

const OrderSchema = new mongoose.Schema({
  orderNumber: String, userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, items: Array, total: Number, subtotal: Number, status: String, paymentStatus: String, scheduledShippingDate: Date, createdAt: Date
});
const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);

const PaymentSchema = new mongoose.Schema({ orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' }, amount: Number, status: String, method: String, createdAt: Date });
const Payment = mongoose.models.Payment || mongoose.model('Payment', PaymentSchema);

const CouponSchema = new mongoose.Schema({ code: { type: String, unique: true }, discountType: String, discountValue: Number, storeId: String, active: Boolean, usedCount: Number, maxUses: Number, validTo: Date, createdAt: Date });
const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', CouponSchema);

const SupportTicketSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, storeId: String, subject: String, message: String, status: { type: String, default: 'open' }, priority: String, responses: Array, createdAt: Date
});
const SupportTicket = mongoose.models.SupportTicket || mongoose.model('SupportTicket', SupportTicketSchema);

const PlatformSettingsSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: mongoose.Schema.Types.Mixed, description: String, updatedAt: Date });
const PlatformSettings = mongoose.models.PlatformSettings || mongoose.model('PlatformSettings', PlatformSettingsSchema);

// Auth middleware super_admin only
const superAuth = async (req,res,next)=>{
  const h=req.headers.authorization;
  if(!h) return res.status(401).json({ error: 'Unauthorized'});
  try{
    const token=h.split(' ')[1];
    const dec=jwt.verify(token,JWT_SECRET);
    const user=await User.findById(dec.userId);
    if(!user || user.role!=='super_admin') return res.status(403).json({ error: 'Super admin only'});
    req.user=user; next();
  } catch(e){ return res.status(401).json({ error: 'Invalid token'}); }
};

// Public login for super admin
app.post('/api/auth/login', async (req,res)=>{
  const { email, password } = req.body;
  const user=await User.findOne({ email: email.toLowerCase() });
  if(!user || user.role!=='super_admin') return res.status(400).json({ error: 'Invalid super admin credentials'});
  const ok=await bcrypt.compare(password, user.passwordHash);
  if(!ok) return res.status(400).json({ error: 'Invalid'});
  const token=jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user });
});

// Dashboard stats
app.get('/api/stats', superAuth, async (req,res)=>{
  const totalStores=await Store.countDocuments({});
  const pendingVerification=await Store.countDocuments({ verified: false });
  const activeStores=await Store.countDocuments({ active: true, verified: true });
  const featuredStores=await Store.countDocuments({ featured: true });
  const totalUsers=await User.countDocuments({ role: 'customer' });
  const totalStoreAdmins=await User.countDocuments({ role: 'store_admin' });
  const totalProducts=await Product.countDocuments({});
  const lowStock=await Product.countDocuments({ stock: { $lt: 10 } });
  const totalOrders=await Order.countDocuments({ status: { $ne: 'Pending Payment' } });
  const pendingOrders=await Order.countDocuments({ status: 'Paid' });
  const revenueAgg=await Order.aggregate([{ $match: { status: { $nin: ['Pending Payment','Cancelled'] } } }, { $group: { _id: null, total: { $sum: '$total' } } }]);
  const totalRevenue=revenueAgg[0]?.total||0;
  const commissions=await Store.aggregate([{ $group: { _id: null, avgCommission: { $avg: '$commissionRate' } } }]);
  const openTickets=await SupportTicket.countDocuments({ status: { $in: ['open','pending'] } });

  // Revenue last 30 days
  const last30=[];
  for(let i=29;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i); d.setHours(0,0,0,0);
    const n=new Date(d); n.setDate(n.getDate()+1);
    const dayOrders=await Order.find({ createdAt: { $gte: d, $lt: n }, status: { $nin: ['Pending Payment','Cancelled'] } });
    const rev=dayOrders.reduce((s,o)=> s+o.total,0);
    last30.push({ date: d.toISOString().slice(0,10), revenue: rev, orders: dayOrders.length });
  }

  const topStores=await Store.find({}).sort({ totalOrders: -1 }).limit(5);

  res.json({
    totalStores, pendingVerification, activeStores, featuredStores,
    totalUsers, totalStoreAdmins, totalProducts, lowStock,
    totalOrders, pendingOrders, totalRevenue,
    avgCommission: commissions[0]?.avgCommission||12,
    openTickets, last30, topStores
  });
});

// Stores management
app.get('/api/stores', superAuth, async (req,res)=>{
  const { status, search } = req.query;
  let q={};
  if(status==='pending') q.verified=false;
  else if(status==='active') q.active=true;
  else if(status==='suspended') q.active=false;
  if(search) q.name=new RegExp(search,'i');
  const stores=await Store.find(q).sort({ createdAt: -1 }).populate('ownerId','name email');
  res.json(stores);
});
app.put('/api/stores/:id/verify', superAuth, async (req,res)=>{
  const store=await Store.findOne({ id: req.params.id });
  if(!store) return res.status(404).json({ error: 'Not found'});
  store.verified=true; store.active=true;
  await store.save();
  res.json(store);
});
app.put('/api/stores/:id/suspend', superAuth, async (req,res)=>{
  const store=await Store.findOne({ id: req.params.id });
  store.active=false;
  await store.save();
  res.json(store);
});
app.put('/api/stores/:id/activate', superAuth, async (req,res)=>{
  const store=await Store.findOne({ id: req.params.id });
  store.active=true; store.verified=true;
  await store.save();
  res.json(store);
});
app.put('/api/stores/:id/feature', superAuth, async (req,res)=>{
  const store=await Store.findOne({ id: req.params.id });
  store.featured=!store.featured;
  await store.save();
  res.json(store);
});
app.put('/api/stores/:id/commission', superAuth, async (req,res)=>{
  const store=await Store.findOne({ id: req.params.id });
  store.commissionRate=Number(req.body.commissionRate);
  await store.save();
  res.json(store);
});
app.put('/api/stores/:id', superAuth, async (req,res)=>{
  const store=await Store.findOne({ id: req.params.id });
  Object.assign(store, req.body);
  await store.save();
  res.json(store);
});
app.delete('/api/stores/:id', superAuth, async (req,res)=>{
  await Store.deleteOne({ id: req.params.id });
  res.json({ ok: true });
});

// Users management
app.get('/api/users', superAuth, async (req,res)=>{
  const { role, search } = req.query;
  let q={};
  if(role) q.role=role;
  if(search) q.$or=[{ name: new RegExp(search,'i')}, { email: new RegExp(search,'i')}];
  const users=await User.find(q).sort({ createdAt: -1 }).limit(200);
  res.json(users);
});
app.put('/api/users/:id', superAuth, async (req,res)=>{
  const user=await User.findById(req.params.id);
  if(!user) return res.status(404).json({ error: 'Not found'});
  if(req.body.role) user.role=req.body.role;
  if(req.body.isActive!==undefined) user.isActive=req.body.isActive;
  await user.save();
  res.json(user);
});
app.delete('/api/users/:id', superAuth, async (req,res)=>{
  await User.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// Categories CRUD
app.get('/api/categories', superAuth, async (req,res)=>{
  const cats=await Category.find({}).sort({ sortOrder: 1, name: 1 });
  res.json(cats);
});
app.post('/api/categories', superAuth, async (req,res)=>{
  const { name, description, image, featured } = req.body;
  const cat=await Category.create({
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+Date.now().toString(36).slice(-3),
    description, image, featured: !!featured, active: true, sortOrder: 0
  });
  res.json(cat);
});
app.put('/api/categories/:id', superAuth, async (req,res)=>{
  const cat=await Category.findById(req.params.id);
  Object.assign(cat, req.body);
  await cat.save();
  res.json(cat);
});
app.delete('/api/categories/:id', superAuth, async (req,res)=>{
  await Category.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// Collections CRUD
app.get('/api/collections', superAuth, async (req,res)=>{
  const cols=await Collection.find({}).sort({ createdAt: -1 });
  res.json(cols);
});
app.post('/api/collections', superAuth, async (req,res)=>{
  const { name, description, type, image, banner, featured, productIds, storeIds, validFrom, validTo } = req.body;
  const col=await Collection.create({
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+Date.now().toString(36).slice(-4),
    description, type: type||'curated', image, banner, featured: !!featured, active: true,
    productIds: productIds||[], storeIds: storeIds||[],
    validFrom: validFrom?new Date(validFrom):null, validTo: validTo?new Date(validTo):null
  });
  res.json(col);
});
app.put('/api/collections/:id', superAuth, async (req,res)=>{
  const col=await Collection.findById(req.params.id);
  Object.assign(col, req.body);
  await col.save();
  res.json(col);
});
app.delete('/api/collections/:id', superAuth, async (req,res)=>{
  await Collection.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// Orders & reports
app.get('/api/orders', superAuth, async (req,res)=>{
  const { status, storeId } = req.query;
  let q={};
  if(status) q.status=status;
  if(storeId) q['items.storeId']=storeId;
  const orders=await Order.find(q).sort({ createdAt: -1 }).limit(300).populate('userId','name email');
  res.json(orders);
});
app.get('/api/orders/:id', superAuth, async (req,res)=>{
  const order=await Order.findById(req.params.id).populate('userId','name email phone');
  const payment=await Payment.findOne({ orderId: order._id });
  res.json({ order, payment });
});

// Commissions & Payouts
app.get('/api/payouts', superAuth, async (req,res)=>{
  const stores=await Store.find({ verified: true, active: true });
  const result=[];
  for(let store of stores){
    const orders=await Order.find({ 'items.storeId': store.id, status: { $nin: ['Pending Payment','Cancelled'] } });
    const storeRevenue=orders.reduce((sum,o)=> sum + o.items.filter(i=> i.storeId===store.id).reduce((s,i)=> s+ i.price*i.quantity,0),0);
    const commission=storeRevenue * (store.commissionRate/100);
    const payout=storeRevenue - commission;
    result.push({ storeId: store.id, storeName: store.name, totalOrders: orders.length, storeRevenue, commissionRate: store.commissionRate, commission, payout });
  }
  res.json(result.sort((a,b)=> b.payout - a.payout));
});

// Coupons global
app.get('/api/coupons', superAuth, async (req,res)=>{
  const coupons=await Coupon.find({}).sort({ createdAt: -1 }).limit(200);
  res.json(coupons);
});
app.post('/api/coupons', superAuth, async (req,res)=>{
  const { code, discountType, discountValue, storeId, maxUses, validTo } = req.body;
  const coupon=await Coupon.create({
    code: code.toUpperCase(), discountType: discountType||'percent', discountValue: Number(discountValue),
    storeId: storeId||null, maxUses: Number(maxUses||100), usedCount: 0,
    validFrom: new Date(), validTo: validTo? new Date(validTo): new Date(Date.now()+30*86400000), active: true
  });
  res.json(coupon);
});
app.put('/api/coupons/:id', superAuth, async (req,res)=>{
  const c=await Coupon.findById(req.params.id);
  Object.assign(c, req.body);
  if(req.body.code) c.code=req.body.code.toUpperCase();
  await c.save();
  res.json(c);
});
app.delete('/api/coupons/:id', superAuth, async (req,res)=>{
  await Coupon.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// Support tickets
app.get('/api/support', superAuth, async (req,res)=>{
  const tickets=await SupportTicket.find({}).sort({ createdAt: -1 }).limit(200).populate('userId','name email');
  res.json(tickets);
});
app.put('/api/support/:id', superAuth, async (req,res)=>{
  const ticket=await SupportTicket.findById(req.params.id);
  if(req.body.status) ticket.status=req.body.status;
  if(req.body.response){
    ticket.responses.push({ sender: 'super_admin', message: req.body.response, createdAt: new Date() });
  }
  await ticket.save();
  res.json(ticket);
});

// Platform Settings / CMS
app.get('/api/settings', superAuth, async (req,res)=>{
  const settings=await PlatformSettings.find({});
  res.json(settings);
});
app.put('/api/settings', superAuth, async (req,res)=>{
  const { key, value, description } = req.body;
  let setting=await PlatformSettings.findOne({ key });
  if(setting){ setting.value=value; if(description) setting.description=description; setting.updatedAt=new Date(); await setting.save(); }
  else { setting=await PlatformSettings.create({ key, value, description: description||'', updatedAt: new Date() }); }
  res.json(setting);
});
app.delete('/api/settings/:key', superAuth, async (req,res)=>{
  await PlatformSettings.deleteOne({ key: req.params.key });
  res.json({ ok: true });
});

// CMS Pages - stored as settings with prefix cms_
app.get('/api/cms', superAuth, async (req,res)=>{
  const cms=await PlatformSettings.find({ key: { $regex: '^cms_' } });
  res.json(cms);
});

// Export reports (simple JSON -> CSV string)
app.get('/api/reports/orders/csv', superAuth, async (req,res)=>{
  const orders=await Order.find({}).sort({ createdAt: -1 }).limit(1000);
  let csv='orderNumber,total,status,customer,createdAt,scheduledShip,gift\n';
  orders.forEach(o=>{
    csv+=`${o.orderNumber},${o.total},${o.status},${o.userId},${o.createdAt.toISOString()},${o.scheduledShippingDate?.toISOString()||''},${o.giftOrder}\n`;
  });
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="orders.csv"');
  res.send(csv);
});

// Frontend
app.get('/', (req,res)=>{
  const p=path.join(__dirname,'html.html');
  if(fs.existsSync(p)) res.sendFile(p);
  else res.send('Super Admin - html.html missing');
});

mongoose.connect(MONGO_URI).then(()=> console.log('âœ… Super Admin connected Mongo')).catch(console.error);
app.listen(PORT,'0.0.0.0', ()=> console.log(`ðŸš€ Super Admin Portal http://localhost:${PORT} | login: admin@bcmfoodhub.co.za / admin123`));
