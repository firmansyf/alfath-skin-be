// src/controllers/cart.controller.ts
import { Request, Response } from 'express';
import { query } from '../config/database';

// Get user cart with items
export const getCart = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    // Get or create cart (single upsert query)
    const cart = await query(
      `INSERT INTO carts (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING *`,
      [userId]
    );

    const cartId = cart.rows[0].id;

    // Get cart items with product details
    const items = await query(
      `SELECT ci.*, 
              p.name, p.slug, p.price, p.discount_price, p.image_url, p.stock, p.is_available
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = $1`,
      [cartId]
    );

    // Calculate totals
    let subtotal = 0;
    items.rows.forEach(item => {
      const itemPrice = item.discount_price || item.price;
      subtotal += itemPrice * item.quantity;
    });

    res.json({
      message: 'Data keranjang berhasil diambil',
      data: {
        cart: cart.rows[0],
        items: items.rows,
        summary: {
          subtotal,
          totalItems: items.rows.length,
          totalQuantity: items.rows.reduce((sum, item) => sum + item.quantity, 0),
        },
      },
    });
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Add item to cart
export const addToCart = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { product_id, quantity, notes } = req.body;

    if (!product_id || !quantity) {
      return res.status(400).json({ 
        message: 'Product ID dan quantity wajib diisi' 
      });
    }

    // Check product availability
    const product = await query(
      'SELECT * FROM products WHERE id = $1 AND is_available = true',
      [product_id]
    );

    if (product.rows.length === 0) {
      return res.status(404).json({ message: 'Produk tidak tersedia' });
    }

    if (product.rows[0].stock < quantity) {
      return res.status(400).json({ 
        message: `Stok tidak cukup. Stok tersedia: ${product.rows[0].stock}` 
      });
    }

    // Get or create cart (single upsert query)
    const cart = await query(
      `INSERT INTO carts (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING *`,
      [userId]
    );

    const cartId = cart.rows[0].id;

    // Check if item already in cart
    const existingItem = await query(
      'SELECT * FROM cart_items WHERE cart_id = $1 AND product_id = $2',
      [cartId, product_id]
    );

    let result;
    if (existingItem.rows.length > 0) {
      // Update quantity
      const newQuantity = existingItem.rows[0].quantity + quantity;
      
      if (product.rows[0].stock < newQuantity) {
        return res.status(400).json({ 
          message: `Stok tidak cukup. Stok tersedia: ${product.rows[0].stock}` 
        });
      }

      result = await query(
        `UPDATE cart_items 
         SET quantity = $1, notes = COALESCE($2, notes)
         WHERE cart_id = $3 AND product_id = $4
         RETURNING *`,
        [newQuantity, notes, cartId, product_id]
      );
    } else {
      // Insert new item
      result = await query(
        `INSERT INTO cart_items (cart_id, product_id, quantity, notes)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [cartId, product_id, quantity, notes]
      );
    }

    res.status(201).json({
      message: 'Produk berhasil ditambahkan ke keranjang',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Update cart item
export const updateCartItem = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { quantity, notes } = req.body;

    // Verify cart ownership
    const cartItem = await query(
      `SELECT ci.*, c.user_id, p.stock
       FROM cart_items ci
       JOIN carts c ON ci.cart_id = c.id
       JOIN products p ON ci.product_id = p.id
       WHERE ci.id = $1`,
      [id]
    );

    if (cartItem.rows.length === 0) {
      return res.status(404).json({ message: 'Item tidak ditemukan' });
    }

    if (cartItem.rows[0].user_id !== userId) {
      return res.status(403).json({ message: 'Akses ditolak' });
    }

    if (quantity && cartItem.rows[0].stock < quantity) {
      return res.status(400).json({ 
        message: `Stok tidak cukup. Stok tersedia: ${cartItem.rows[0].stock}` 
      });
    }

    const result = await query(
      `UPDATE cart_items
       SET quantity = COALESCE($1, quantity),
           notes = COALESCE($2, notes)
       WHERE id = $3
       RETURNING *`,
      [quantity, notes, id]
    );

    res.json({
      message: 'Item keranjang berhasil diupdate',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Update cart item error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Remove item from cart
export const removeCartItem = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    // Verify cart ownership
    const cartItem = await query(
      `SELECT ci.*, c.user_id
       FROM cart_items ci
       JOIN carts c ON ci.cart_id = c.id
       WHERE ci.id = $1`,
      [id]
    );

    if (cartItem.rows.length === 0) {
      return res.status(404).json({ message: 'Item tidak ditemukan' });
    }

    if (cartItem.rows[0].user_id !== userId) {
      return res.status(403).json({ message: 'Akses ditolak' });
    }

    await query('DELETE FROM cart_items WHERE id = $1', [id]);

    res.json({ message: 'Item berhasil dihapus dari keranjang' });
  } catch (error) {
    console.error('Remove cart item error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Clear cart
export const clearCart = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    const cart = await query(
      'SELECT id FROM carts WHERE user_id = $1',
      [userId]
    );

    if (cart.rows.length > 0) {
      await query('DELETE FROM cart_items WHERE cart_id = $1', [cart.rows[0].id]);
    }

    res.json({ message: 'Keranjang berhasil dikosongkan' });
  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};