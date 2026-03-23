import { Request, Response } from 'express';
import { query } from '../config/database';

// Get all products with filters
export const getProducts = async (req: Request, res: Response) => {
  try {
    const { 
      category, 
      search, 
      sortBy = 'created_at', 
      order = 'DESC',
      page = 1,
      limit = 12,
      featured
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    
    let queryText = `
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_available = true
    `;
    
    const params: any[] = [];
    let paramCount = 0;

    // Filter by category
    if (category) {
      paramCount++;
      queryText += ` AND c.slug = $${paramCount}`;
      params.push(category);
    }

    // Filter by featured
    if (featured === 'true') {
      queryText += ` AND p.is_featured = true`;
    }

    // Search by name or description
    if (search) {
      paramCount++;
      queryText += ` AND (p.name ILIKE $${paramCount} OR p.description ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    // Sorting
    const validSortFields = ['name', 'price', 'created_at', 'rating'];
    const validOrders = ['ASC', 'DESC'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'created_at';
    const sortOrder = validOrders.includes((order as string).toUpperCase()) ? order : 'DESC';

    // Use effective price (discount_price if available, otherwise price) for price sorting
    if (sortField === 'price') {
      queryText += ` ORDER BY COALESCE(p.discount_price, p.price) ${sortOrder}`;
    } else {
      queryText += ` ORDER BY p.${sortField} ${sortOrder}`;
    }

    // Add total count via window function — single query instead of two
    queryText = `SELECT *, COUNT(*) OVER() AS total_count FROM (${queryText}) sub`;

    // Pagination
    paramCount++;
    queryText += ` LIMIT $${paramCount}`;
    params.push(limit);

    paramCount++;
    queryText += ` OFFSET $${paramCount}`;
    params.push(offset);

    const result = await query(queryText, params);

    const totalItems = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;
    const totalPages = Math.ceil(totalItems / Number(limit));

    res.json({
      message: 'Data produk berhasil diambil',
      data: result.rows,
      pagination: {
        currentPage: Number(page),
        totalPages,
        totalItems,
        itemsPerPage: Number(limit),
      },
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Get product by slug
export const getProductBySlug = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const result = await query(
      `SELECT p.*, c.name as category_name, c.slug as category_slug
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.slug = $1`,
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Produk tidak ditemukan' });
    }

    res.json({
      message: 'Data produk berhasil diambil',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Get product by slug error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Get product by ID (for admin edit)
export const getProductById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT p.*, c.name as category_name, c.slug as category_slug
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Produk tidak ditemukan' });
    }

    res.json({
      message: 'Data produk berhasil diambil',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Get product by id error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Admin: Create product
export const createProduct = async (req: Request, res: Response) => {
  try {
    const {
      category_id,
      name,
      slug,
      description,
      price,
      discount_price,
      stock,
      unit,
      image_url,
      is_featured,
    } = req.body;

    // Validasi
    if (!name || !slug || !price || !stock) {
      return res.status(400).json({ 
        message: 'Nama, slug, harga, dan stok wajib diisi' 
      });
    }

    const result = await query(
      `INSERT INTO products 
       (category_id, name, slug, description, price, discount_price, stock, unit, image_url, is_featured)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [category_id, name, slug, description, price, discount_price, stock, unit || 'porsi', image_url, is_featured || false]
    );

    res.status(201).json({
      message: 'Produk berhasil ditambahkan',
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Create product error:', error);
    
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Slug produk sudah digunakan' });
    }
    
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Admin: Update product
export const updateProduct = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      category_id,
      name,
      slug,
      description,
      price,
      discount_price,
      stock,
      unit,
      image_url,
      is_available,
      is_featured,
    } = req.body;

    const result = await query(
      `UPDATE products
       SET category_id = COALESCE($1, category_id),
           name = COALESCE($2, name),
           slug = COALESCE($3, slug),
           description = COALESCE($4, description),
           price = COALESCE($5, price),
           discount_price = $6,
           stock = COALESCE($7, stock),
           unit = COALESCE($8, unit),
           image_url = COALESCE($9, image_url),
           is_available = COALESCE($10, is_available),
           is_featured = COALESCE($11, is_featured)
       WHERE id = $12
       RETURNING *`,
      [category_id, name, slug, description, price, discount_price, stock, unit, image_url, is_available, is_featured, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Produk tidak ditemukan' });
    }

    res.json({
      message: 'Produk berhasil diupdate',
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Update product error:', error);
    
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Slug produk sudah digunakan' });
    }
    
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Admin: Delete product
export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM products WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Produk tidak ditemukan' });
    }

    res.json({ message: 'Produk berhasil dihapus' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Admin: Get all products with pagination (includes unavailable)
export const getProductsAdmin = async (req: Request, res: Response) => {
  try {
    const {
      category,
      search,
      is_available,
      sortBy = 'created_at',
      order = 'DESC',
      page = 1,
      limit = 10
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    let queryText = `
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramCount = 0;

    // Filter by category
    if (category) {
      paramCount++;
      queryText += ` AND p.category_id = $${paramCount}`;
      params.push(category);
    }

    // Filter by availability
    if (is_available !== undefined && is_available !== '') {
      queryText += ` AND p.is_available = ${is_available === 'true'}`;
    }

    // Search by name
    if (search) {
      paramCount++;
      queryText += ` AND (p.name ILIKE $${paramCount} OR p.slug ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    // Sorting
    const validSortFields = ['name', 'price', 'created_at', 'stock'];
    const validOrders = ['ASC', 'DESC'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'created_at';
    const sortOrder = validOrders.includes((order as string).toUpperCase()) ? order : 'DESC';

    // Use effective price (discount_price if available, otherwise price) for price sorting
    if (sortField === 'price') {
      queryText += ` ORDER BY COALESCE(p.discount_price, p.price) ${sortOrder}`;
    } else {
      queryText += ` ORDER BY p.${sortField} ${sortOrder}`;
    }

    // Add total count via window function — single query instead of two
    queryText = `SELECT *, COUNT(*) OVER() AS total_count FROM (${queryText}) sub`;

    // Pagination
    paramCount++;
    queryText += ` LIMIT $${paramCount}`;
    params.push(limit);

    paramCount++;
    queryText += ` OFFSET $${paramCount}`;
    params.push(offset);

    const result = await query(queryText, params);

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

    res.json({
      message: 'Data produk berhasil diambil',
      data: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get products admin error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

// Get all categories
export const getCategories = async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM categories ORDER BY name ASC'
    );

    res.json({
      message: 'Data kategori berhasil diambil',
      data: result.rows,
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};