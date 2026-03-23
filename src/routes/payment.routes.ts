import { Router } from 'express';
import { createSnapToken, handleNotification } from '../controllers/payment.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Create Snap token for an order (customer)
router.post('/:orderId/token', authenticateToken, createSnapToken);

// Midtrans webhook notification (no auth - called by Midtrans server)
router.post('/notification', handleNotification);

export default router;
