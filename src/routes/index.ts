// src/routes/index.ts
import { Router } from 'express';
import authRoutes from './auth.routes';
import productRoutes from './products.routes';
import cartRoutes from './cart.routes';
import orderRoutes from './orders.routes';
import uploadRoutes from './upload.routes';
import categoryRoutes from './categories.routes';
import userRoutes from './users.routes';
import dashboardRoutes from './dashboard.routes';
import refundRoutes from './refunds.routes';
import bannerRoutes from './banners.routes';
import otpRoutes from './otp.routes';
import paymentRoutes from './payment.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/otp', otpRoutes);
router.use('/products', productRoutes);
router.use('/cart', cartRoutes);
router.use('/orders', orderRoutes);
router.use('/upload', uploadRoutes);
router.use('/categories', categoryRoutes);
router.use('/users', userRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/refunds', refundRoutes);
router.use('/banners', bannerRoutes);
router.use('/payment', paymentRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Alfath Skin API is running',
    timestamp: new Date().toISOString()
  });
});

export default router;