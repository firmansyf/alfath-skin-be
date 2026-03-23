import { Request, Response } from 'express';
import { query } from '../config/database';
import { snap } from '../config/midtrans';

// Create Midtrans Snap token for an order
export const createSnapToken = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { orderId } = req.params;

    // Fetch order with user info
    const orderResult = await query(
      `SELECT o.*, u.name as customer_name, u.email as customer_email, u.phone as customer_phone
       FROM orders o
       JOIN users u ON o.user_id = u.id
       WHERE o.id = $1 AND o.user_id = $2`,
      [orderId, userId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }

    const order = orderResult.rows[0];

    if (order.payment_status !== 'pending') {
      return res.status(400).json({ message: 'Pesanan sudah dibayar atau tidak valid' });
    }

    if (order.status === 'cancelled') {
      return res.status(400).json({ message: 'Pesanan sudah dibatalkan' });
    }

    // Fetch order items for item_details
    const itemsResult = await query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [order.id]
    );

    const item_details = itemsResult.rows.map((item: any) => ({
      id: String(item.product_id),
      price: Math.round(Number(item.price)),
      quantity: item.quantity,
      name: item.product_name.substring(0, 50),
    }));

    // Add shipping cost as item
    if (Number(order.shipping_cost) > 0) {
      item_details.push({
        id: 'SHIPPING',
        price: Math.round(Number(order.shipping_cost)),
        quantity: 1,
        name: 'Ongkos Kirim',
      });
    }

    const parameter = {
      transaction_details: {
        order_id: order.order_number,
        gross_amount: Math.round(Number(order.total)),
      },
      item_details,
      customer_details: {
        first_name: order.customer_name,
        email: order.customer_email,
        phone: order.customer_phone || order.phone,
      },
    };

    const snapToken = await snap.createTransaction(parameter);

    res.json({
      message: 'Snap token berhasil dibuat',
      data: {
        snap_token: snapToken.token,
        redirect_url: snapToken.redirect_url,
      },
    });
  } catch (error) {
    console.error('Create snap token error:', error);
    res.status(500).json({ message: 'Gagal membuat token pembayaran' });
  }
};

// Handle Midtrans payment notification (webhook)
export const handleNotification = async (req: Request, res: Response) => {
  try {
    const notification = req.body;

    // Verify notification from Midtrans
    const statusResponse = await (snap as any).transaction.notification(notification);

    const {
      order_id: orderNumber,
      transaction_status,
      fraud_status,
      payment_type,
    } = statusResponse;

    // Find order by order_number
    const orderResult = await query(
      'SELECT id, payment_status FROM orders WHERE order_number = $1',
      [orderNumber]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: 'Order tidak ditemukan' });
    }

    const order = orderResult.rows[0];

    // Determine payment status from Midtrans response
    let newPaymentStatus = order.payment_status;
    let paidAt: string | null = null;

    if (transaction_status === 'capture') {
      if (fraud_status === 'accept') {
        newPaymentStatus = 'paid';
        paidAt = 'CURRENT_TIMESTAMP';
      }
    } else if (transaction_status === 'settlement') {
      newPaymentStatus = 'paid';
      paidAt = 'CURRENT_TIMESTAMP';
    } else if (
      transaction_status === 'cancel' ||
      transaction_status === 'deny' ||
      transaction_status === 'expire'
    ) {
      newPaymentStatus = 'expired';
    } else if (transaction_status === 'pending') {
      newPaymentStatus = 'pending';
    }

    // Update order payment status
    if (paidAt) {
      await query(
        `UPDATE orders SET payment_status = $1, paid_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [newPaymentStatus, order.id]
      );
    } else {
      await query(
        `UPDATE orders SET payment_status = $1 WHERE id = $2`,
        [newPaymentStatus, order.id]
      );
    }

    console.log(`[Midtrans] Order ${orderNumber}: ${transaction_status} (${payment_type}) → payment_status: ${newPaymentStatus}`);

    res.json({ message: 'Notification processed' });
  } catch (error) {
    console.error('Handle notification error:', error);
    res.status(500).json({ message: 'Gagal memproses notifikasi' });
  }
};
