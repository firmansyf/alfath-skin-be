import { Request, Response } from 'express';
import { pool, query } from '../config/database';
import { createNotification } from './notifications.controller';

// Generate order number
const generateOrderNumber = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `FMB-${year}${month}${day}-${random}`;
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

    // Get cart with items + variant info in one query
    const cartItems = await client.query(
      `SELECT ci.*,
              p.name, p.is_available,
              p.image_url AS product_image_url,
              COALESCE(v.price, p.price) AS price,
              COALESCE(v.discount_price, p.discount_price) AS discount_price,
              COALESCE(v.image_url, p.image_url) AS image_url,
              COALESCE(v.stock, p.stock) AS stock,
              v.name AS variant_name
       FROM carts c
       JOIN cart_items ci ON ci.cart_id = c.id
       JOIN products p ON ci.product_id = p.id
       LEFT JOIN product_variants v ON ci.variant_id = v.id
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
      const label = item.variant_name ? `${item.name} (${item.variant_name})` : item.name;
      if (Number(item.stock) < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: `Stok ${label} tidak cukup. Stok tersedia: ${item.stock}`
        });
      }
    }

    // Calculate subtotal
    let subtotal = 0;
    cartItems.rows.forEach(item => {
      const itemPrice = Number(item.discount_price || item.price);
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

    // Batch insert order items (snapshot variant info)
    const itemValues: any[] = [];
    const itemParams: any[] = [];
    let paramIdx = 1;
    for (const item of cartItems.rows) {
      const itemPrice = Number(item.discount_price || item.price);
      const itemSubtotal = itemPrice * item.quantity;
      itemValues.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, $${paramIdx+7}, $${paramIdx+8}, $${paramIdx+9})`);
      itemParams.push(
        order.id,
        item.product_id,
        item.name,
        item.image_url,
        item.variant_id || null,
        item.variant_name || null,
        itemPrice,
        item.quantity,
        itemSubtotal,
        item.notes
      );
      paramIdx += 10;
    }
    await client.query(
      `INSERT INTO order_items (order_id, product_id, product_name, product_image, variant_id, variant_name, price, quantity, subtotal, notes)
       VALUES ${itemValues.join(', ')}`,
      itemParams
    );

    // Decrement stock — variant.stock when variant_id present, else products.stock
    const variantDecs = cartItems.rows.filter((i) => i.variant_id);
    const productDecs = cartItems.rows.filter((i) => !i.variant_id);

    if (productDecs.length > 0) {
      const stockValues = productDecs.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::int)`).join(', ');
      const stockParams: any[] = [];
      productDecs.forEach(item => stockParams.push(item.product_id, item.quantity));
      await client.query(
        `UPDATE products SET stock = products.stock - data.qty
         FROM (VALUES ${stockValues}) AS data(pid, qty)
         WHERE products.id = data.pid`,
        stockParams
      );
    }

    if (variantDecs.length > 0) {
      const variantStockValues = variantDecs.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::int)`).join(', ');
      const variantStockParams: any[] = [];
      variantDecs.forEach(item => variantStockParams.push(item.variant_id, item.quantity));
      await client.query(
        `UPDATE product_variants SET stock = product_variants.stock - data.qty
         FROM (VALUES ${variantStockValues}) AS data(vid, qty)
         WHERE product_variants.id = data.vid`,
        variantStockParams
      );
    }

    // Clear cart items
    const cartId = cartItems.rows[0].cart_id;
    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);

    await client.query('COMMIT');

    // Fire-and-forget notification
    createNotification(
      'new_order',
      'Pesanan Baru',
      `Pesanan ${orderNumber} dari ${recipient_name} telah masuk`,
      { order_id: order.id, order_number: orderNumber, total }
    );

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
              COALESCE(json_agg(oi.* ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]') as items,
              COALESCE(
                (SELECT json_agg(os.* ORDER BY os.display_order, os.id) FROM order_shipments os WHERE os.order_id = o.id),
                '[]'
              ) as shipments
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

    // Batch restore stock — variant.stock for variant rows, products.stock otherwise
    const items = await client.query(
      'SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1',
      [id]
    );

    const variantRows = items.rows.filter((it: any) => it.variant_id);
    const productRows = items.rows.filter((it: any) => !it.variant_id);

    if (productRows.length > 0) {
      const stockValues = productRows.map((_: any, i: number) => `($${i * 2 + 1}::int, $${i * 2 + 2}::int)`).join(', ');
      const stockParams: any[] = [];
      productRows.forEach((item: any) => stockParams.push(item.product_id, item.quantity));
      await client.query(
        `UPDATE products SET stock = products.stock + data.qty
         FROM (VALUES ${stockValues}) AS data(pid, qty)
         WHERE products.id = data.pid`,
        stockParams
      );
    }

    if (variantRows.length > 0) {
      const variantStockValues = variantRows.map((_: any, i: number) => `($${i * 2 + 1}::int, $${i * 2 + 2}::int)`).join(', ');
      const variantStockParams: any[] = [];
      variantRows.forEach((item: any) => variantStockParams.push(item.variant_id, item.quantity));
      await client.query(
        `UPDATE product_variants SET stock = product_variants.stock + data.qty
         FROM (VALUES ${variantStockValues}) AS data(vid, qty)
         WHERE product_variants.id = data.vid`,
        variantStockParams
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

// Customer: upload QRIS payment proof → moves order to 'waiting_confirmation'
export const uploadPaymentProof = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { payment_proof_url } = req.body;

    if (!payment_proof_url) {
      return res.status(400).json({ message: 'Bukti pembayaran wajib diunggah' });
    }

    // Only accept Cloudinary URLs to prevent arbitrary URL injection
    try {
      const parsed = new URL(payment_proof_url);
      if (!parsed.hostname.endsWith('cloudinary.com') || parsed.protocol !== 'https:') {
        return res.status(400).json({ message: 'URL bukti pembayaran tidak valid' });
      }
    } catch {
      return res.status(400).json({ message: 'URL bukti pembayaran tidak valid' });
    }

    const orderResult = await query(
      'SELECT id, order_number, status, payment_status, recipient_name FROM orders WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }

    const order = orderResult.rows[0];

    if (order.status === 'cancelled') {
      return res.status(400).json({ message: 'Pesanan sudah dibatalkan' });
    }

    if (order.payment_status === 'paid') {
      return res.status(400).json({ message: 'Pesanan sudah dibayar' });
    }

    const result = await query(
      `UPDATE orders
       SET payment_proof_url = $1,
           payment_proof_uploaded_at = CURRENT_TIMESTAMP,
           payment_status = 'waiting_confirmation'
       WHERE id = $2
       RETURNING *`,
      [payment_proof_url, id]
    );

    // Notify admin to verify the payment
    createNotification(
      'payment_proof_uploaded',
      'Bukti Pembayaran Diterima',
      `Pesanan ${order.order_number} dari ${order.recipient_name} mengunggah bukti pembayaran. Menunggu verifikasi.`,
      { order_id: order.id, order_number: order.order_number }
    );

    res.json({
      message: 'Bukti pembayaran berhasil dikirim. Menunggu verifikasi admin.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Upload payment proof error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Customer: confirm order received → moves order to 'delivered' and notifies admin
export const confirmOrderReceived = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    const orderResult = await query(
      'SELECT id, order_number, status, recipient_name FROM orders WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }

    const order = orderResult.rows[0];

    if (order.status === 'delivered') {
      return res.status(400).json({ message: 'Pesanan sudah dikonfirmasi diterima' });
    }

    if (order.status !== 'shipped') {
      return res.status(400).json({
        message: 'Pesanan hanya dapat dikonfirmasi setelah dikirim',
      });
    }

    const result = await query(
      `UPDATE orders
       SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    // Notify admin that the customer has received the order
    createNotification(
      'order_received',
      'Pesanan Diterima',
      `Pesanan ${order.order_number} telah dikonfirmasi diterima oleh ${order.recipient_name}.`,
      { order_id: order.id, order_number: order.order_number }
    );

    res.json({
      message: 'Terima kasih! Pesanan telah dikonfirmasi diterima.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Confirm order received error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
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
              COALESCE(json_agg(oi.* ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]') as items,
              COALESCE(
                (SELECT json_agg(os.* ORDER BY os.display_order, os.id) FROM order_shipments os WHERE os.order_id = o.id),
                '[]'
              ) as shipments
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
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { status, payment_status, admin_notes, shipments } = req.body;

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

    if (updates.length === 0 && shipments === undefined) {
      return res.status(400).json({ message: 'Tidak ada data yang diupdate' });
    }

    await client.query('BEGIN');

    let order;
    if (updates.length > 0) {
      paramCount++;
      params.push(id);

      const result = await client.query(
        `UPDATE orders SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
        params
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
      }
      order = result.rows[0];
    } else {
      const result = await client.query('SELECT * FROM orders WHERE id = $1', [id]);
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
      }
      order = result.rows[0];
    }

    // Replace shipments (resi) list wholesale when provided
    if (Array.isArray(shipments)) {
      await client.query('DELETE FROM order_shipments WHERE order_id = $1', [id]);

      const validShipments = shipments.filter(
        (s: any) => s && (s.product_name || s.tracking_number || s.tracking_url)
      );

      if (validShipments.length > 0) {
        const shipmentValues: string[] = [];
        const shipmentParams: any[] = [];
        let idx = 1;
        validShipments.forEach((s: any, i: number) => {
          shipmentValues.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4})`);
          shipmentParams.push(id, s.product_name || null, s.tracking_number || null, s.tracking_url || null, i);
          idx += 5;
        });
        await client.query(
          `INSERT INTO order_shipments (order_id, product_name, tracking_number, tracking_url, display_order)
           VALUES ${shipmentValues.join(', ')}`,
          shipmentParams
        );
      }
    }

    await client.query('COMMIT');

    res.json({
      message: 'Status pesanan berhasil diupdate',
      data: order,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update order status error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  } finally {
    client.release();
  }
};
