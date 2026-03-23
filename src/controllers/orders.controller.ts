import { Request, Response } from 'express';
import { pool, query } from '../config/database';

// Generate order number
const generateOrderNumber = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `AFS-${year}${month}${day}-${random}`;
};

// Create order from cart
export const createOrder = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const userId = req.user?.userId;
    const {
      recipient_name,
      phone,
      shipping_address,
      shipping_cost = 0,
      customer_notes,
      whatsapp_number
    } = req.body;

    if (!recipient_name || !phone || !shipping_address) {
      return res.status(400).json({ message: 'Data pengiriman wajib diisi' });
    }

    await client.query('BEGIN');

    // Get cart with items in one query
    const cartItems = await client.query(
      `SELECT ci.*, p.name, p.price, p.discount_price, p.image_url, p.stock, p.is_available
       FROM carts c
       JOIN cart_items ci ON ci.cart_id = c.id
       JOIN products p ON ci.product_id = p.id
       WHERE c.user_id = $1`,
      [userId]
    );

    if (cartItems.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Keranjang kosong' });
    }

    // Validate stock and availability
    for (const item of cartItems.rows) {
      if (!item.is_available) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `Produk ${item.name} tidak tersedia` });
      }
      if (item.stock < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: `Stok ${item.name} tidak cukup. Stok tersedia: ${item.stock}`
        });
      }
    }

    // Calculate subtotal
    let subtotal = 0;
    cartItems.rows.forEach(item => {
      const itemPrice = item.discount_price || item.price;
      subtotal += itemPrice * item.quantity;
    });

    const total = subtotal + Number(shipping_cost);
    const orderNumber = generateOrderNumber();

    // Create order
    const orderResult = await client.query(
      `INSERT INTO orders
       (user_id, order_number, recipient_name, phone, shipping_address,
        subtotal, shipping_cost, total, customer_notes, whatsapp_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [userId, orderNumber, recipient_name, phone, shipping_address,
       subtotal, shipping_cost, total, customer_notes, whatsapp_number]
    );

    const order = orderResult.rows[0];

    // Batch insert order items
    const itemValues: any[] = [];
    const itemParams: any[] = [];
    let paramIdx = 1;
    for (const item of cartItems.rows) {
      const itemPrice = item.discount_price || item.price;
      const itemSubtotal = itemPrice * item.quantity;
      itemValues.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, $${paramIdx+7})`);
      itemParams.push(order.id, item.product_id, item.name, item.image_url, itemPrice, item.quantity, itemSubtotal, item.notes);
      paramIdx += 8;
    }
    await client.query(
      `INSERT INTO order_items (order_id, product_id, product_name, product_image, price, quantity, subtotal, notes)
       VALUES ${itemValues.join(', ')}`,
      itemParams
    );

    // Batch update product stock
    const stockValues = cartItems.rows.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::int)`).join(', ');
    const stockParams: any[] = [];
    cartItems.rows.forEach(item => stockParams.push(item.product_id, item.quantity));
    await client.query(
      `UPDATE products SET stock = products.stock - data.qty
       FROM (VALUES ${stockValues}) AS data(pid, qty)
       WHERE products.id = data.pid`,
      stockParams
    );

    // Clear cart items
    const cartId = cartItems.rows[0].cart_id;
    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Pesanan berhasil dibuat',
      data: order,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create order error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  } finally {
    client.release();
  }
};

// Get user orders
export const getUserOrders = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { status } = req.query;

    let queryText = `
      SELECT o.*,
             COUNT(oi.id) as total_items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.user_id = $1
    `;

    const params: any[] = [userId];

    if (status) {
      queryText += ` AND o.status = $2`;
      params.push(status);
    }

    queryText += ` GROUP BY o.id ORDER BY o.created_at DESC`;

    const result = await query(queryText, params);

    res.json({
      message: 'Data pesanan berhasil diambil',
      data: result.rows,
    });
  } catch (error) {
    console.error('Get user orders error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Get order detail — single query with JSON aggregation
export const getOrderDetail = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    const result = await query(
      `SELECT o.*,
              COALESCE(json_agg(oi.* ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.id = $1 AND o.user_id = $2
       GROUP BY o.id`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }

    res.json({
      message: 'Detail pesanan berhasil diambil',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Get order detail error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Cancel order (customer)
export const cancelOrder = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    await client.query('BEGIN');

    const orderResult = await client.query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }

    const order = orderResult.rows[0];

    if (order.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'Hanya pesanan dengan status pending yang bisa dibatalkan'
      });
    }

    // Batch restore product stock
    const items = await client.query(
      'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
      [id]
    );

    if (items.rows.length > 0) {
      const stockValues = items.rows.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::int)`).join(', ');
      const stockParams: any[] = [];
      items.rows.forEach(item => stockParams.push(item.product_id, item.quantity));
      await client.query(
        `UPDATE products SET stock = products.stock + data.qty
         FROM (VALUES ${stockValues}) AS data(pid, qty)
         WHERE products.id = data.pid`,
        stockParams
      );
    }

    await client.query(
      `UPDATE orders SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');

    res.json({ message: 'Pesanan berhasil dibatalkan' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Cancel order error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  } finally {
    client.release();
  }
};

// Admin: Get all orders
export const getAllOrders = async (req: Request, res: Response) => {
  try {
    const { status, payment_status, search, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let queryText = `
      SELECT o.*, u.name as customer_name, u.email as customer_email,
             COUNT(oi.id) as total_items
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      queryText += ` AND o.status = $${paramCount}`;
      params.push(status);
    }

    if (payment_status) {
      paramCount++;
      queryText += ` AND o.payment_status = $${paramCount}`;
      params.push(payment_status);
    }

    if (search) {
      paramCount++;
      queryText += ` AND (o.order_number ILIKE $${paramCount} OR u.name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    queryText += ` GROUP BY o.id, u.name, u.email ORDER BY o.created_at DESC`;

    paramCount++;
    queryText += ` LIMIT $${paramCount}`;
    params.push(limit);

    paramCount++;
    queryText += ` OFFSET $${paramCount}`;
    params.push(offset);

    const result = await query(queryText, params);

    res.json({
      message: 'Data pesanan berhasil diambil',
      data: result.rows,
    });
  } catch (error) {
    console.error('Get all orders error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Admin: Get order detail — single query with JSON aggregation
export const getOrderDetailAdmin = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT o.*, u.name as customer_name, u.email as customer_email,
              COALESCE(json_agg(oi.* ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.id = $1
       GROUP BY o.id, u.name, u.email`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }

    res.json({
      message: 'Detail pesanan berhasil diambil',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Get order detail admin error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Admin: Update order status
export const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, payment_status, admin_notes } = req.body;

    const updates: string[] = [];
    const params: any[] = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      updates.push(`status = $${paramCount}`);
      params.push(status);

      if (status === 'confirmed') {
        updates.push(`confirmed_at = CURRENT_TIMESTAMP`);
      } else if (status === 'shipped') {
        updates.push(`shipped_at = CURRENT_TIMESTAMP`);
      } else if (status === 'delivered') {
        updates.push(`delivered_at = CURRENT_TIMESTAMP`);
      } else if (status === 'cancelled') {
        updates.push(`cancelled_at = CURRENT_TIMESTAMP`);
      }
    }

    if (payment_status) {
      paramCount++;
      updates.push(`payment_status = $${paramCount}`);
      params.push(payment_status);

      if (payment_status === 'paid') {
        updates.push(`paid_at = CURRENT_TIMESTAMP`);
      }
    }

    if (admin_notes !== undefined) {
      paramCount++;
      updates.push(`admin_notes = $${paramCount}`);
      params.push(admin_notes);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'Tidak ada data yang diupdate' });
    }

    paramCount++;
    params.push(id);

    const result = await query(
      `UPDATE orders SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }

    res.json({
      message: 'Status pesanan berhasil diupdate',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};
