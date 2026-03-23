import { Router } from 'express';
import {
  upload,
  uploadProductImage,
  deleteProductImage,
} from '../controllers/upload.controller';
import { authenticateToken, authorizeRole } from '../middleware/auth';

const router = Router();

// Upload product image (admin only)
router.post(
  '/product',
  authenticateToken,
  authorizeRole('admin'),
  upload.single('image'),
  uploadProductImage
);

// Delete product image (admin only)
router.delete(
  '/product/:filename',
  authenticateToken,
  authorizeRole('admin'),
  deleteProductImage
);

export default router;
