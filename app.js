// app.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());

// Serve the admin dashboard static files
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ramsdough', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB Connected to Rams Dough Database'))
  .catch(err => console.log(err));

// -------------------------
// DATABASE SCHEMAS
// -------------------------

const storeSchema = new mongoose.Schema({
  storeName: { type: String, required: true },
  description: { type: String, required: true },
  isApproved: { type: Boolean, default: false }, // Super Admin control
  shippingPolicy: {
    type: String,
    default: 'Scheduled nationwide shipping. No same-day local delivery.'
  },
  products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  createdAt: { type: Date, default: Date.now }
});

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  description: { type: String },
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true }
});

const Store = mongoose.model('Store', storeSchema);
const Product = mongoose.model('Product', productSchema);

// -------------------------
// API ROUTES
// -------------------------

// Vendor: Register Store
app.post('/api/stores/register', async (req, res) => {
  try {
    const { storeName, description } = req.body;
    const newStore = new Store({ storeName, description });
    await newStore.save();
    res.status(201).json({ message: 'Store registered. Pending approval.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to register store' });
  }
});

// Vendor: Add Product to their Store
app.post('/api/stores/:storeId/products', async (req, res) => {
  try {
    const { name, price, description } = req.body;
    const newProduct = new Product({ name, price, description, storeId: req.params.storeId });
    await newProduct.save();
    
    // Link product to the store
    await Store.findByIdAndUpdate(req.params.storeId, { $push: { products: newProduct._id } });
    
    res.status(201).json({ message: 'Product added successfully', product: newProduct });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add product' });
  }
});

// Customer: Get ONLY approved stores
app.get('/api/stores', async (req, res) => {
  try {
    const stores = await Store.find({ isApproved: true }).populate('products');
    res.status(200).json(stores);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stores' });
  }
});

// -------------------------
// SUPER ADMIN ROUTES
// -------------------------

// Admin: Get ALL stores (Pending and Approved)
app.get('/api/admin/stores', async (req, res) => {
  try {
    const stores = await Store.find().sort({ createdAt: -1 }).populate('products');
    res.status(200).json(stores);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch admin stores' });
  }
});

// Admin: Approve a Store
app.patch('/api/admin/stores/:id/approve', async (req, res) => {
  try {
    const store = await Store.findByIdAndUpdate(req.params.id, { isApproved: true }, { new: true });
    res.status(200).json({ message: 'Store approved and is now live', store });
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve store' });
  }
});

// Admin: Revoke/Suspend a Store
app.patch('/api/admin/stores/:id/revoke', async (req, res) => {
  try {
    const store = await Store.findByIdAndUpdate(req.params.id, { isApproved: false }, { new: true });
    res.status(200).json({ message: 'Store suspended from marketplace', store });
  } catch (error) {
    res.status(500).json({ error: 'Failed to suspend store' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Rams Dough Server running on port ${PORT}`);
});
