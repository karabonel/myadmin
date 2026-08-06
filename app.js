require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.SUPER_ADMIN_PORT || process.env.PORT || 3001;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bcm_food_hub';
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' || !!process.env.RENDER_EXTERNAL_URL;
const JWT_SECRET = process.env.SUPER_ADMIN_JWT_SECRET || process.env.JWT_SECRET || '';
if (!JWT_SECRET || JWT_SECRET === 'bcmfoodhub-secret-2024') {
  if (IS_PRODUCTION) {
    console.error('FATAL: Set SUPER_ADMIN_JWT_SECRET (or JWT_SECRET) to a strong unique value in production.');
    process.exit(1);
  }
  console.warn('⚠️ Super admin JWT secret is default/missing — OK only for local dev.');
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'bcmfoodhub-super-dev-only';
const BOOTSTRAP_USERNAME = (process.env.SUPER_ADMIN_USERNAME || 'karabomanaga1@gmail.com').trim().toLowerCase();
const BOOTSTRAP_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || '@Karabo1234';
const BOOTSTRAP_IS_EMAIL = BOOTSTRAP_USERNAME.includes('@');
const BOOTSTRAP_EMAIL = BOOTSTRAP_IS_EMAIL
  ? BOOTSTRAP_USERNAME
  : `${BOOTSTRAP_USERNAME}@bcmfoodhub.admin`;

const ORDER_STATUSES = ['Pending Payment','Paid','Confirmed','Preparing','Packed','Shipped','In Transit','Delivered','Completed','Cancelled','Refunded'];
const PROVINCES = ['Eastern Cape','Free State','Gauteng','KwaZulu-Natal','Limpopo','Mpumalanga','Northern Cape','North West','Western Cape'];

const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS blocked'));
  },
  credentials: true
}));
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
const PasswordResetSchema = new mongoose.Schema({
  email: { type: String, unique: true, lowercase: true },
  codeHash: String,
  tokenHash: String,
  attempts: { type: Number, default: 0 },
  verified: Boolean,
  lastSentAt: Date,
  expiresAt: { type: Date, expires: 0 }
}, { strict: false });
const PasswordReset = mongoose.models.PasswordReset || mongoose.model('PasswordReset', PasswordResetSchema);

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

const ReviewSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, productId: String, storeId: String, rating: Number, title: String, comment: String, approved: { type: Boolean, default: true }, storeReply: mongoose.Schema.Types.Mixed, reportedByStore: mongoose.Schema.Types.Mixed, createdAt: { type: Date, default: Date.now } }, { strict: false });
const Review = mongoose.models.Review || mongoose.model('Review', ReviewSchema);

const PayoutSchema = new mongoose.Schema({ storeId: String, storeName: String, periodFrom: Date, periodTo: Date, grossSales: Number, commissionRate: Number, commissionAmount: Number, payoutAmount: Number, status: { type: String, default: 'pending' }, paidAt: Date, reference: String, createdAt: { type: Date, default: Date.now } }, { strict: false });
const Payout = mongoose.models.Payout || mongoose.model('Payout', PayoutSchema);

const RefundRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  orderNumber: String,
  reason: { type: String, default: 'other' },
  details: String,
  photos: [String],
  amountRequested: Number,
  amountApproved: Number,
  status: { type: String, enum: ['open','under_review','approved','rejected','refunded','closed'], default: 'open' },
  adminNotes: String,
  payfastRefundRef: String,
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolvedAt: Date,
  createdAt: { type: Date, default: Date.now }
}, { strict: false });
const RefundRequest = mongoose.models.RefundRequest || mongoose.model('RefundRequest', RefundRequestSchema);


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
const escapeRegex = s => String(s||'').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clean = (value, length=500) => typeof value === 'string' ? value.trim().slice(0, length) : '';
const num = (value, fallback=0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
const bool = value => value === true || value === 'true';
const list = value => Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : String(value || '').split(',').map(item => item.trim()).filter(Boolean);
const slugify = text => clean(text, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function escapeRegExp(string) {
  return String(string || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const userView = user => ({ _id: user._id, username: user.username, name: user.name, email: user.email, role: user.role, avatar: user.avatar, createdAt: user.createdAt });

function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in.' });
  try {
    const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET);
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

async function notifySuperAdmins({ type, title, message, link = '/support', emailSubject }) {
  try {
    const admins = await User.find({ role: 'super_admin', isActive: true }).select('_id email');
    if (admins.length) {
      await Notification.insertMany(
        admins.map(admin => ({
          userId: admin._id,
          type: type || 'support',
          title: title || 'New support ticket',
          message: message || '',
          link: link || '/support',
          read: false,
          createdAt: new Date()
        }))
      );
    }
    // Always try email so admins see critical events outside the panel
    await emailSuperAdmins(
      emailSubject || title || 'BCM FoodHub alert',
      title || 'BCM FoodHub',
      [message || '', link ? `Open Super Admin: ${link}` : ''].filter(Boolean)
    );
  } catch (err) {
    console.error('Notify super admins error:', err.message);
  }
}


// --------------------- EMAIL (Resend + SMTP) ---------------------
function emailConfigured() {
  return Boolean(String(process.env.RESEND_API_KEY || '').trim() || (String(process.env.SMTP_HOST || '').trim() && String(process.env.SMTP_USER || '').trim() && process.env.SMTP_PASS));
}
function defaultFromAddress() {
  return process.env.OTP_EMAIL_FROM || process.env.SMTP_FROM || process.env.EMAIL_FROM || 'BCM FoodHub <noreply@bcmfoodhub.co.za>';
}
async function sendEmail({ to, subject, html, text }) {
  const toAddr = String(to || '').trim().toLowerCase();
  if (!toAddr || !toAddr.includes('@')) return { ok: false, reason: 'invalid_to' };
  const from = defaultFromAddress();
  const bodyText = text || String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const bodyHtml = html || `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${String(bodyText).replace(/</g,'&lt;')}</pre>`;
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (apiKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [toAddr], subject: subject || 'BCM FoodHub', html: bodyHtml, text: bodyText })
      });
      if (response.ok) return { ok: true, provider: 'resend' };
      console.warn('Resend failed:', (await response.text()).slice(0, 180));
    } catch (e) { console.warn('Resend error:', e.message); }
  }
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '');
  if (!host || !user || !pass) return { ok: false, reason: 'email_not_configured' };
  try {
    let nodemailer;
    try { nodemailer = require('nodemailer'); } catch (reqErr) {
      return { ok: false, reason: 'nodemailer_not_installed' };
    }
    const transporter = nodemailer.createTransport({
      host, port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
      auth: { user, pass }
    });
    await transporter.sendMail({ from, to: toAddr, subject: subject || 'BCM FoodHub', text: bodyText, html: bodyHtml });
    return { ok: true, provider: 'smtp' };
  } catch (e) {
    console.warn('SMTP failed:', e.message);
    return { ok: false, reason: e.message };
  }
}
function platformEmailHtml(title, bodyLines) {
  const lines = (Array.isArray(bodyLines) ? bodyLines : [String(bodyLines || '')])
    .map(l => `<p style="margin:0 0 10px;line-height:1.55;color:#24352a">${String(l).replace(/</g,'&lt;')}</p>`).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#17261c">
    <div style="font-size:13px;font-weight:800;letter-spacing:1px;color:#0b7a43;margin-bottom:12px">BCM FOODHUB</div>
    <h2 style="margin:0 0 14px;font-size:22px;color:#0b7a43">${String(title||'').replace(/</g,'&lt;')}</h2>
    ${lines}
    <p style="margin:18px 0 0;font-size:12px;color:#6a7b6f">This is an automated message from BCM FoodHub marketplace.</p>
  </div>`;
}
async function emailUserById(userId, subject, title, bodyLines) {
  try {
    if (!userId) return;
    const user = await User.findById(userId).select('email name isActive');
    if (!user || !user.email || user.isActive === false) return;
    await sendEmail({
      to: user.email,
      subject,
      text: [title].concat(Array.isArray(bodyLines) ? bodyLines : [bodyLines]).filter(Boolean).join('\n'),
      html: platformEmailHtml(title, bodyLines)
    });
  } catch (e) { console.warn('emailUserById:', e.message); }
}
async function emailSuperAdmins(subject, title, bodyLines) {
  try {
    const admins = await User.find({ role: 'super_admin', isActive: true }).select('email name');
    const extra = String(process.env.SUPER_ADMIN_NOTIFY_EMAIL || process.env.PLATFORM_ADMIN_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean);
    const targets = new Set(extra.map(e => e.toLowerCase()));
    admins.forEach(a => { if (a.email) targets.add(String(a.email).toLowerCase()); });
    for (const to of targets) {
      await sendEmail({
        to,
        subject,
        text: [title].concat(Array.isArray(bodyLines) ? bodyLines : [bodyLines]).filter(Boolean).join('\n'),
        html: platformEmailHtml(title, bodyLines)
      });
    }
  } catch (e) { console.warn('emailSuperAdmins:', e.message); }
}


// --------------------- LOGIN ONLY ---------------------
app.post('/api/auth/login', async (req, res) => {
  try {
    const username = clean(req.body.username, 80).toLowerCase();
    const password = String(req.body.password || '');
    if (!username || !password) return res.status(400).json({ error: 'Enter your username and password.' });
    const user = await User.findOne({
      $or: [{ username }, { email: username }],
      role: 'super_admin',
      isActive: true
    });
    if (!user || user.role !== 'super_admin' || !user.isActive) return res.status(401).json({ error: 'Invalid admin credentials.' });
    if (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid admin credentials.' });
    const token = jwt.sign({ userId: user._id, role: 'super_admin' }, EFFECTIVE_JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: userView(user) });
  } catch (error) { res.status(500).json({ error: 'Could not log in.' }); }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const key = clean(req.body.identifier || req.body.email || req.body.username || '', 160).toLowerCase();
    if (!key) return res.status(400).json({ error: 'Enter your admin username or email.' });
    const user = await User.findOne({
      $or: [{ username: key }, { email: new RegExp('^' + escapeRegExp(key) + '$', 'i') }],
      role: 'super_admin',
      isActive: true
    });
    if (!user) return res.status(400).json({ error: 'Username/email and phone number do not match a Super Admin account.' });
    res.json({ ok: true, message: 'Enter your admin username/email and phone number to verify identity.' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not start password reset.' });
  }
});

app.post('/api/auth/verify-reset-identity', async (req, res) => {
  try {
    const key = clean(req.body.identifier || req.body.email || req.body.username || '', 160).toLowerCase();
    const phoneRaw = clean(req.body.phone || '', 40);
    if (!key) return res.status(400).json({ error: 'Username or email is required.' });
    if (!phoneRaw) return res.status(400).json({ error: 'Enter the phone number on your account.' });

    const user = await User.findOne({
      $or: [{ username: key }, { email: new RegExp('^' + escapeRegExp(key) + '$', 'i') }],
      role: 'super_admin',
      isActive: true
    });
    if (!user) {
      return res.status(400).json({ error: 'Username/email and phone number do not match a Super Admin account.' });
    }

    const digits = phoneRaw.replace(/\D/g, '');
    const storedDigits = String(user.phone || '').replace(/\D/g, '');
    if (storedDigits.length >= 7) {
      const match =
        storedDigits === digits ||
        storedDigits.slice(-9) === digits.slice(-9) ||
        storedDigits.slice(-7) === digits.slice(-7);
      if (!match) {
        return res.status(400).json({ error: 'Username/email and phone number do not match a Super Admin account.' });
      }
    }

    const ticket = crypto.randomBytes(32).toString('hex');
    const ticketHash = crypto.createHash('sha256').update(ticket).digest('hex');
    await PasswordReset.findOneAndUpdate(
      { email: user.email || user.username },
      {
        email: user.email || user.username,
        userId: user._id,
        codeHash: ticketHash,
        tokenHash: ticketHash,
        attempts: 0,
        verified: true,
        lastSentAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      ok: true,
      message: 'Identity verified. Choose a new admin password.',
      resetTicket: ticket,
      username: user.username
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not verify identity.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const key = clean(req.body.identifier || req.body.email || req.body.username || '', 160).toLowerCase();
    const ticket = clean(req.body.resetTicket || req.body.token || req.body.resetToken || '', 100);
    const phoneRaw = clean(req.body.phone || '', 40);
    const newPassword = String(req.body.newPassword || req.body.password || '');
    const confirmPassword = String(req.body.confirmPassword || req.body.passwordConfirm || '');

    if (!key) return res.status(400).json({ error: 'Username/email is required.' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (confirmPassword && confirmPassword !== newPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    const user = await User.findOne({
      $or: [{ username: key }, { email: new RegExp('^' + escapeRegExp(key) + '$', 'i') }],
      role: 'super_admin',
      isActive: true
    });
    if (!user) {
      return res.status(400).json({ error: 'Account not found.' });
    }

    let pending = null;
    if (ticket) {
      const ticketHash = crypto.createHash('sha256').update(ticket).digest('hex');
      pending = await PasswordReset.findOne({ email: user.email || user.username, $or: [{ tokenHash: ticketHash }, { codeHash: ticketHash }] });
    }

    if (!pending || pending.expiresAt < new Date() || !pending.verified) {
      if (!phoneRaw) {
        return res.status(400).json({ error: 'Session expired. Go back and verify your admin account again.' });
      }
      const digits = phoneRaw.replace(/\D/g, '');
      const storedDigits = String(user.phone || '').replace(/\D/g, '');
      if (storedDigits.length >= 7) {
        const match =
          storedDigits === digits ||
          storedDigits.slice(-9) === digits.slice(-9) ||
          storedDigits.slice(-7) === digits.slice(-7);
        if (!match) {
          return res.status(400).json({ error: 'Session expired. Go back and verify your admin account again.' });
        }
      }
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.passwordChangedAt = new Date();
    await user.save();
    await PasswordReset.deleteOne({ email: user.email || user.username }).catch(() => {});
    res.json({ ok: true, message: 'Password updated. You can log in.' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not reset password.' });
  }
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
  const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1); const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [stores, products, customers, openTickets, paidOrderDocs, recentOrders, pendingList, payouts, newRegistrations] = await Promise.all([
    Store.find({}), Product.find({ active: true }), User.countDocuments({ role: 'customer', isActive: true }), SupportTicket.countDocuments({ status: { $in: ['open','pending'] } }),
    Order.find({ paymentStatus: 'paid' }).sort({ createdAt: -1 }).limit(1000), Order.find({}).sort({ createdAt: -1 }).limit(10).populate('userId', 'name email'),
    Store.find({ approvalStatus: 'pending' }).sort({ submittedAt: 1 }).limit(6).populate('ownerId', 'name email'), Payout.countDocuments({ status: 'pending' }),
    User.countDocuments({ createdAt: { $gte: monthStart } })
  ]);
  const monthOrders = paidOrderDocs.filter(order => new Date(order.createdAt) >= monthStart); const todayOrders = paidOrderDocs.filter(order => new Date(order.createdAt) >= todayStart);
  const totalSales = monthOrders.reduce((sum, order) => sum + (order.total || 0), 0); const commissionRevenue = monthOrders.reduce((sum, order) => sum + (order.items || []).reduce((inner,item) => { const store = stores.find(s => s.id === item.storeId); return inner + ((item.price || 0) * (item.quantity || 0) * ((store?.commissionRate || 12) / 100)); }, 0), 0);
  const statusCounts = {}; recentOrders.forEach(order => { statusCounts[order.status] = (statusCounts[order.status] || 0) + 1; });
  const productPerformance = {}; const storePerformance = {};
  paidOrderDocs.forEach(order => (order.items || []).forEach(item => { const amount = (item.price || 0) * (item.quantity || 0); productPerformance[item.productId] = productPerformance[item.productId] || { name: item.productName, quantity: 0, revenue: 0 }; productPerformance[item.productId].quantity += item.quantity || 0; productPerformance[item.productId].revenue += amount; storePerformance[item.storeId] = storePerformance[item.storeId] || { name: item.storeName, orders: 0, revenue: 0 }; storePerformance[item.storeId].orders += item.quantity || 0; storePerformance[item.storeId].revenue += amount; }));
  res.json({
    stats: { totalSales, todaySales: todayOrders.reduce((sum, order) => sum + (order.total || 0), 0), totalOrders: paidOrderDocs.length, totalCustomers: customers, totalStores: stores.length, pendingStores: stores.filter(store => store.approvalStatus === 'pending').length, pendingPayouts: payouts, commissionRevenue: Math.round(commissionRevenue), newRegistrations, openTickets, products: products.length },
    statusCounts, bestProducts: Object.values(productPerformance).sort((a,b) => b.quantity - a.quantity).slice(0,5), topStores: Object.values(storePerformance).sort((a,b) => b.revenue - a.revenue).slice(0,5), recentOrders, pendingStores: pendingList
  });
});

// --------------------- STORE APPROVAL & MANAGEMENT ---------------------
app.get('/api/admin/stores', adminAuth, async (req, res) => {
  const status = clean(req.query.status || 'all', 30); const search = clean(req.query.search || '', 120);
  const query = status === 'all' ? {} : { approvalStatus: status };
  if (search) query.$or = [{ name: new RegExp(escapeRegex(search), 'i') }, { city: new RegExp(escapeRegex(search), 'i') }, { email: new RegExp(escapeRegex(search), 'i') }];
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
  const ownerMsg = action === 'approve'
    ? `${store.name} is now live on BCM FoodHub. Customers can discover your products.`
    : action === 'reject'
      ? `Your store ${store.name} was not approved. Reason: ${store.rejectionReason || 'See Super Admin notes.'}`
      : `Your store ${store.name} was suspended. ${store.rejectionReason || ''}`.trim();
  if (store.ownerId) {
    await Notification.create({
      userId: store.ownerId, storeId: store.id, type: 'approval',
      title: `Store ${store.approvalStatus}`,
      message: ownerMsg,
      link: '/store'
    });
    await emailUserById(
      store.ownerId,
      action === 'approve' ? `Approved: ${store.name} is live on BCM FoodHub` :
        action === 'reject' ? `Update on ${store.name} application` :
        `Store suspended: ${store.name}`,
      action === 'approve' ? 'Your store is approved' :
        action === 'reject' ? 'Store application update' :
        'Store suspended',
      [
        ownerMsg,
        store.email ? `Store contact email: ${store.email}` : '',
        'Log in to Store Admin to continue.'
      ].filter(Boolean)
    );
  }
  // Also notify platform if extra admin emails are configured
  if (action === 'approve') {
    await emailSuperAdmins(
      `Store approved: ${store.name}`,
      'Store approved',
      [`${store.name} (${store.city || ''}, ${store.province || ''}) is now live.`, `Store ID: ${store.id}`]
    ).catch(() => {});
  }
  await audit(req, action, 'store', store.id, `${store.name}: ${action}`);
  res.json(store);
});
app.put('/api/admin/stores/:id', adminAuth, async (req, res) => {
  const store = await Store.findOne({ id: req.params.id }); if (!store) return res.status(404).json({ error: 'Store not found.' });
  const fields = ['name','description','email','phone','address','city','province','logo','banner','shippingCutoffHour'];
  fields.forEach(key => { if (req.body[key] !== undefined) store[key] = clean(req.body[key], key === 'description' ? 2000 : 500); });
  ['preparationDays','shippingDays','minOrder','commissionRate','rating'].forEach(key => { if (req.body[key] !== undefined) store[key] = Math.max(0, num(req.body[key])); });
  if (req.body.shippingRegions !== undefined) store.shippingRegions = list(req.body.shippingRegions).filter(region => PROVINCES.includes(region) || region === 'Nationwide');
  ['active','featured','verified'].forEach(key => { if (req.body[key] !== undefined) store[key] = bool(req.body[key]); });
  ['verificationStatus','verificationNotes','bankVerificationStatus'].forEach(key => { if (req.body[key] !== undefined) store[key] = clean(req.body[key], 1000); });
  if (store.name && store.name !== req.body.originalName) store.slug = await uniqueSlug(Store, store.name, store._id);
  await store.save(); await audit(req, 'update', 'store', store.id, `Updated ${store.name}`); res.json(store);
});

app.delete('/api/admin/stores/:id', adminAuth, async (req, res) => {
  const store = await Store.findOne({ id: req.params.id });
  if (!store) return res.status(404).json({ error: 'Store not found.' });
  // Remove store and its catalogue / store-scoped data. Historical orders are kept for records.
  await Promise.all([
    Product.deleteMany({ storeId: store.id }),
    Coupon.deleteMany({ storeId: store.id }),
    Review.deleteMany({ storeId: store.id }),
    Payout.deleteMany({ storeId: store.id }),
    Notification.deleteMany({ storeId: store.id }),
    Store.deleteOne({ _id: store._id })
  ]);
  await audit(req, 'delete', 'store', store.id, `Deleted ${store.name} and its catalogue`);
  res.json({ ok: true });
});

// --------------------- PRODUCTS ---------------------
app.get('/api/admin/products', adminAuth, async (req, res) => {
  const search = clean(req.query.search || '', 120); const status = clean(req.query.status || 'all', 20); const storeId = clean(req.query.storeId || '', 100);
  const query = {}; if (status === 'active') query.active = true; if (status === 'inactive') query.active = false; if (storeId) query.storeId = storeId;
  if (search) query.$or = [{ name: new RegExp(escapeRegex(search), 'i') }, { id: new RegExp(escapeRegex(search), 'i') }];
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

app.delete('/api/admin/products/:id', adminAuth, async (req, res) => {
  const product = await Product.findOneAndDelete({ id: req.params.id }); if (!product) return res.status(404).json({ error: 'Product not found.' });
  await audit(req, 'delete', 'product', product.id, `Removed ${product.name}`); res.json({ ok: true });
});

// --------------------- ORDERS ---------------------
app.get('/api/admin/orders', adminAuth, async (req, res) => {
  const status = clean(req.query.status || 'all', 40); const search = clean(req.query.search || '', 120);
  const query = status === 'all' ? {} : { status };
  if (search) query.$or = [{ orderNumber: new RegExp(escapeRegex(search), 'i') }, { 'items.productName': new RegExp(escapeRegex(search), 'i') }];
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
  if (search) query.$or = [{ name: new RegExp(escapeRegex(search), 'i') }, { email: new RegExp(escapeRegex(search), 'i') }, { phone: new RegExp(escapeRegex(search), 'i') }];
  res.json(await User.find(query).select('-passwordHash').sort({ createdAt: -1 }).limit(400));
});
app.put('/api/admin/users/:id/status', adminAuth, async (req, res) => {
  const user = await User.findById(req.params.id); if (!user) return res.status(404).json({ error: 'User not found.' });
  if (String(user._id) === String(req.user._id)) return res.status(400).json({ error: 'You cannot deactivate your own admin account.' });
  user.isActive = bool(req.body.isActive); await user.save(); await audit(req, user.isActive ? 'activate' : 'deactivate', 'user', user._id, `${user.email} ${user.isActive ? 'activated' : 'deactivated'}`); res.json({ _id: user._id, isActive: user.isActive });
});
app.delete('/api/admin/users/:id', adminAuth, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (String(user._id) === String(req.user._id)) {
    return res.status(400).json({ error: 'You cannot delete your own admin account.' });
  }
  if (user.role === 'super_admin') {
    return res.status(400).json({ error: 'Super admin accounts cannot be permanently deleted. Deactivate them instead.' });
  }
  const email = String(user.email || '').toLowerCase();
  const phone = String(user.phone || '').trim();
  const role = user.role;
  const name = user.name;
  const userId = user._id;

  // Hard delete the user document
  await User.deleteOne({ _id: userId });

  // Clear auth leftovers so email/phone can be used to register again
  const cleanup = [];
  cleanup.push(PasswordReset.deleteMany({ email }).catch(() => {}));
  cleanup.push(
    mongoose.connection.collection('emailotps').deleteMany({ email }).catch(() => {})
  );
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    const variants = [...new Set([
      phone,
      digits,
      digits.startsWith('27') ? '+' + digits : null,
      digits.startsWith('0') ? '+27' + digits.slice(1) : null,
      digits.startsWith('27') ? '0' + digits.slice(2) : null,
      digits.length === 9 ? '+27' + digits : null
    ].filter(Boolean))];
    cleanup.push(
      mongoose.connection.collection('phoneotps').deleteMany({ phone: { $in: variants } }).catch(() => {})
    );
  }
  // Addresses / notifications / wishlist tokens for this user (orders kept for records)
  cleanup.push(mongoose.connection.collection('addresses').deleteMany({ userId }).catch(() => {}));
  cleanup.push(Notification.deleteMany({ userId }).catch(() => {}));
  cleanup.push(mongoose.connection.collection('wishlistshares').deleteMany({ userId }).catch(() => {}));
  cleanup.push(mongoose.connection.collection('devices').updateMany(
    { userIds: userId },
    { $pull: { userIds: userId } }
  ).catch(() => {}));
  await Promise.all(cleanup);

  await audit(req, 'delete', 'user', userId, `Permanently deleted ${name || email} (${role}) — email/phone freed for re-registration`);
  res.json({ ok: true, message: 'Account permanently deleted. That email and phone can register as new.' });
});

// --------------------- PAYOUTS / REVIEWS / ANNOUNCEMENTS ---------------------
app.get('/api/admin/payouts', adminAuth, async (req, res) => res.json(await Payout.find({}).sort({ createdAt: -1 }).limit(300)));
app.post('/api/admin/payouts/calculate', adminAuth, async (req, res) => {
  const store = await Store.findOne({ id: clean(req.body.storeId, 100) }); if (!store) return res.status(404).json({ error: 'Store not found.' });
  const from = req.body.periodFrom ? new Date(req.body.periodFrom) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = req.body.periodTo ? new Date(req.body.periodTo) : new Date();
  // Prevent duplicate payout periods for the same store
  const existing = await Payout.findOne({
    storeId: store.id,
    periodFrom: from,
    periodTo: to,
    status: { $in: ['pending', 'approved', 'paid'] }
  });
  if (existing && !bool(req.body.recalculate)) {
    return res.status(409).json({ error: 'A payout for this store and period already exists. Pass recalculate=true to replace a pending one.', payout: existing });
  }
  // Eligible sales: paid orders that are not cancelled/refunded
  const orders = await Order.find({
    paymentStatus: 'paid',
    status: { $nin: ['Cancelled', 'Refunded'] },
    createdAt: { $gte: from, $lte: to },
    'items.storeId': store.id
  });
  const grossSales = orders.reduce((sum, order) => sum + (order.items || []).filter(item => item.storeId === store.id && !['Cancelled','Refunded'].includes(item.fulfillmentStatus)).reduce((inner,item) => inner + (item.price || 0) * (item.quantity || 0), 0), 0);
  const commissionRate = store.commissionRate || 12;
  const commissionAmount = Math.round(grossSales * commissionRate / 100);
  const payoutAmount = grossSales - commissionAmount;
  let payout;
  if (existing && existing.status === 'pending' && bool(req.body.recalculate)) {
    existing.grossSales = grossSales;
    existing.commissionRate = commissionRate;
    existing.commissionAmount = commissionAmount;
    existing.payoutAmount = payoutAmount;
    await existing.save();
    payout = existing;
  } else {
    payout = await Payout.create({ storeId: store.id, storeName: store.name, periodFrom: from, periodTo: to, grossSales, commissionRate, commissionAmount, payoutAmount, status: 'pending' });
  }
  await audit(req, 'calculate', 'payout', payout._id, `Calculated payout for ${store.name}: R${payoutAmount}`);
  res.status(201).json(payout);
});
app.put('/api/admin/payouts/:id', adminAuth, async (req, res) => {
  const payout = await Payout.findById(req.params.id); if (!payout) return res.status(404).json({ error: 'Payout not found.' });
  const status = clean(req.body.status, 30); if (['pending','approved','paid','failed'].includes(status)) payout.status = status; if (status === 'paid') payout.paidAt = new Date(); if (req.body.reference !== undefined) payout.reference = clean(req.body.reference, 120); await payout.save();
  await audit(req, 'update', 'payout', payout._id, `Payout ${payout.status}`); res.json(payout);
});
app.get('/api/admin/reviews', adminAuth, async (req, res) => res.json(await Review.find({}).populate('userId','name email').sort({ createdAt: -1 }).limit(400)));
app.put('/api/admin/reviews/:id', adminAuth, async (req, res) => {
  const review = await Review.findById(req.params.id); if (!review) return res.status(404).json({ error: 'Review not found.' });
  if (req.body.approved !== undefined) review.approved = bool(req.body.approved); if (req.body.adminResponse !== undefined) review.adminResponse = { message: clean(req.body.adminResponse, 1500), createdAt: new Date(), adminId: req.user._id }; await review.save();
  await audit(req, 'moderate', 'review', review._id, `Review ${review.approved ? 'approved' : 'hidden'}`); res.json(review);
});
app.post('/api/admin/announcements', adminAuth, async (req, res) => {
  const audience = clean(req.body.audience, 30) || 'customers'; const title = clean(req.body.title, 120); const message = clean(req.body.message, 1200); const storeId = clean(req.body.storeId, 100);
  if (!title || !message) return res.status(400).json({ error: 'Announcement title and message are required.' });
  const query = audience === 'stores' ? { role: 'store_admin', isActive: true } : audience === 'all' ? { isActive: true } : { role: 'customer', isActive: true };
  const users = storeId ? await User.find({ _id: (await Store.findOne({ id: storeId }))?.ownerId, isActive: true }).select('_id') : await User.find(query).select('_id');
  if (users.length) await Notification.insertMany(users.map(user => ({ userId: user._id, storeId: storeId || undefined, type: 'announcement', title, message, link: '/' })));
  await audit(req, 'announce', 'notification', storeId || audience, `${title} → ${audience}`); res.json({ ok: true, recipientCount: users.length });
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

// --------------------- REFUNDS / DISPUTES ---------------------
app.get('/api/admin/refunds', adminAuth, async (req, res) => {
  const status = clean(req.query.status || 'all', 30);
  const query = status === 'all' ? {} : { status };
  const items = await RefundRequest.find(query).populate('userId', 'name email phone').populate('orderId', 'orderNumber total status paymentStatus').sort({ createdAt: -1 }).limit(300);
  res.json(items);
});
app.put('/api/admin/refunds/:id', adminAuth, async (req, res) => {
  const item = await RefundRequest.findById(req.params.id);
  if (!item) return res.status(404).json({ error: 'Refund request not found.' });
  const status = clean(req.body.status, 30);
  const allowed = ['open','under_review','approved','rejected','refunded','closed'];
  if (status && !allowed.includes(status)) return res.status(400).json({ error: 'Invalid refund status.' });
  if (status) item.status = status;
  if (req.body.adminNotes !== undefined) item.adminNotes = clean(req.body.adminNotes, 2000);
  if (req.body.amountApproved !== undefined && req.body.amountApproved !== '') item.amountApproved = Math.max(0, num(req.body.amountApproved));
  if (req.body.payfastRefundRef !== undefined) item.payfastRefundRef = clean(req.body.payfastRefundRef, 120);
  if (['approved','rejected','refunded','closed'].includes(item.status)) {
    item.resolvedBy = req.user._id;
    item.resolvedAt = new Date();
  }
  // When marked refunded, sync order status if full refund
  if (item.status === 'refunded' && item.orderId) {
    const order = await Order.findById(item.orderId);
    if (order) {
      order.status = 'Refunded';
      order.paymentStatus = 'refunded';
      order.updatedAt = new Date();
      await order.save();
    }
  }
  await item.save();
  if (item.userId) {
    await Notification.create({
      userId: item.userId,
      type: 'refund',
      title: `Refund ${item.status}`,
      message: item.adminNotes || `Your refund request for order ${item.orderNumber || ''} is now ${item.status}.`,
      link: '/account'
    }).catch(()=>{});
  }
  await audit(req, 'refund_' + (status || 'update'), 'refund', item._id, `Refund ${item.orderNumber || item._id}: ${item.status}`);
  res.json(item);
});

app.get('/api/admin/support', adminAuth, async (req, res) => res.json(await SupportTicket.find({}).populate('userId','name email phone').sort({ createdAt: -1 }).limit(300)));
app.put('/api/admin/support/:id', adminAuth, async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id); if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
  if (req.body.status) ticket.status = clean(req.body.status, 30); if (req.body.priority) ticket.priority = clean(req.body.priority, 30);
  const message = clean(req.body.message, 2000); if (message) ticket.responses.push({ sender: 'admin', message, createdAt: new Date() });
  await ticket.save(); if (ticket.userId && message) await Notification.create({ userId: ticket.userId, type: 'support', title: 'Support replied', message: `BCM FoodHub replied to: ${ticket.subject}`, link: '/account/messages' });
  await audit(req, 'reply', 'support_ticket', ticket._id, `Updated ${ticket.subject}`); res.json(ticket);
});

app.post('/api/support', async (req, res) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    let user = null;
    if (token) {
      try {
        const d = jwt.verify(token, EFFECTIVE_JWT_SECRET);
        user = await User.findById(d.userId);
      } catch(e) {}
    }
    const subject = clean(req.body.subject || 'Support request', 120);
    const message = clean(req.body.message, 2000);
    if (!message) return res.status(400).json({ error: 'Message is required.' });
    const ticket = await SupportTicket.create({
      userId: user ? user._id : undefined,
      storeId: clean(req.body.storeId || '', 80),
      subject,
      message,
      status: 'open',
      priority: clean(req.body.priority || 'medium', 20),
      createdAt: new Date()
    });
    await notifySuperAdmins({
      type: 'support',
      title: 'New Customer Support Ticket',
      message: `${subject}: ${message.slice(0, 100)} ${user ? '(' + user.name + ')' : '(Guest)'}`,
      link: '/support'
    });
    res.status(201).json(ticket);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/support/:id/reply', async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
    const message = clean(req.body.message, 2000);
    if (!message) return res.status(400).json({ error: 'Message is required.' });
    ticket.responses.push({ sender: 'customer', message, createdAt: new Date() });
    ticket.status = 'open';
    await ticket.save();
    await notifySuperAdmins({
      type: 'support',
      title: 'Customer Support Reply',
      message: `Reply on ${ticket.subject}: ${message.slice(0, 100)}`,
      link: '/support'
    });
    res.json(ticket);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// --- Advanced Fraud Detection & System Diagnostics Endpoints ---
app.get('/api/admin/fraud', adminAuth, async (req, res) => {
  const orders = await Order.find({ paymentStatus: 'paid' }).sort({ createdAt: -1 });
  const flagged = [];
  orders.forEach(order => {
    const reasons = [];
    if ((order.total || 0) > 5000) {
      reasons.push('High transaction value (>R5,000)');
    }
    const addr = order.shippingAddress || {};
    const prov = String(addr.province || '').toLowerCase().trim();
    const PROVINCES = ['eastern cape','free state','gauteng','kwazu-natal','kwazulu-natal','limpopo','mpumalanga','northern cape','north west','western cape'];
    if (addr.province && !PROVINCES.includes(prov)) {
      reasons.push(`Unrecognized SA Province: "${addr.province}"`);
    }
    if (order.items && order.items.some(item => (item.quantity || 0) > 30)) {
      reasons.push('Suspicious item quantity (>30 items of same product)');
    }
    if (reasons.length > 0) {
      flagged.push({
        orderNumber: order.orderNumber,
        _id: order._id,
        total: order.total,
        createdAt: order.createdAt,
        customer: addr.recipientName || 'Customer',
        reasons,
        riskScore: reasons.length * 35 + (order.total > 10000 ? 30 : 0)
      });
    }
  });
  res.json(flagged);
});

app.get('/api/admin/backup', adminAuth, async (req, res) => {
  try {
    const collections = {
      users: await mongoose.model('User').countDocuments(),
      stores: await mongoose.model('Store').countDocuments(),
      products: await mongoose.model('Product').countDocuments(),
      orders: await mongoose.model('Order').countDocuments(),
      notifications: await mongoose.model('Notification').countDocuments()
    };
    res.json({
      timestamp: new Date().toISOString(),
      collections,
      version: 'BCM FoodHub Platform Core v2.4-stable',
      status: 'Healthy',
      database: 'MongoDB Connected'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
  // Prefer explicit env credentials. Username may be an email address.
  const username = BOOTSTRAP_USERNAME;
  const email = BOOTSTRAP_EMAIL;
  const password = BOOTSTRAP_PASSWORD;

  let admin = await User.findOne({
    $or: [
      { username },
      { email },
      { bootstrapAdmin: true },
      { role: 'super_admin', email: email }
    ]
  });

  if (!admin) {
    admin = await User.create({
      username,
      name: username.includes('@') ? username.split('@')[0] : username,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'super_admin',
      bootstrapAdmin: true,
      isVerified: true,
      isActive: true
    });
    console.log(`✅ Bootstrap super admin created: ${username}`);
  } else {
    // Migrate legacy bootstrap username (e.g. karabo) to the env identity
    admin.username = username;
    admin.email = email;
    admin.role = 'super_admin';
    admin.bootstrapAdmin = true;
    admin.isActive = true;
    admin.isVerified = true;
    // Apply env password when:
    // - password never changed via profile, OR
    // - SUPER_ADMIN_FORCE_PASSWORD=true (use after rotating Render env)
    const force = String(process.env.SUPER_ADMIN_FORCE_PASSWORD || '').toLowerCase() === 'true';
    if (password && (force || !admin.passwordChangedAt)) {
      admin.passwordHash = await bcrypt.hash(password, 12);
      if (force) admin.passwordChangedAt = undefined;
    }
    await admin.save();
    console.log(`✅ Bootstrap super admin ready: ${username}`);
  }
}


mongoose.connect(MONGO_URI).then(async () => {
  console.log('✅ MongoDB connected — BCM FoodHub Super Admin');
  try { await bootstrapAdmin(); } catch (error) { console.error('Admin bootstrap error:', error.message); }
}).catch(error => console.error('MongoDB connection error:', error.message));


app.get('/api/health', (req, res) => {
  res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({
    ok: mongoose.connection.readyState === 1,
    service: 'super-admin',
    mongo: mongoose.connection.readyState === 1 ? 'up' : 'down',
    time: new Date().toISOString()
  });
});
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 BCM FoodHub Super Admin running at http://localhost:${PORT}`));


