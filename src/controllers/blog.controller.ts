// src/controllers/blog.controller.ts

import { Request, Response } from 'express';
import { query } from '../config/database';

// Get all blogs
export const getBlogs = async (req: Request, res: Response) => {
  try {
    const { status, category, search } = req.query;

    let sql = `
      SELECT *
      FROM blogs
      WHERE 1 = 1
    `;

    const params: any[] = [];

    // Filter by status
    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    // Filter by category
    if (category) {
      params.push(category);
      sql += ` AND category = $${params.length}`;
    }

    // Search by title
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND title ILIKE $${params.length}`;
    }

    sql += `
      ORDER BY created_at DESC
    `;

    const result = await query(sql, params);

    res.json({
      message: 'Data blog berhasil diambil',
      data: result.rows,
    });
  } catch (error) {
    console.error('Get blogs error:', error);

    res.status(500).json({
      message: 'Terjadi kesalahan server',
    });
  }
};


// Get blog by ID
export const getBlogById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT *
       FROM blogs
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Blog tidak ditemukan',
      });
    }

    // Increase view count
    await query(
      `UPDATE blogs
       SET view_count = view_count + 1
       WHERE id = $1`,
      [id]
    );

    res.json({
      message: 'Detail blog berhasil diambil',
      data: {
        ...result.rows[0],
        view_count: result.rows[0].view_count + 1,
      },
    });
  } catch (error) {
    console.error('Get blog by ID error:', error);

    res.status(500).json({
      message: 'Terjadi kesalahan server',
    });
  }
};


// Get blog by slug
export const getBlogBySlug = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const result = await query(
      `SELECT *
       FROM blogs
       WHERE slug = $1
       AND status = 'published'`,
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Blog tidak ditemukan',
      });
    }

    // Increase view count
    await query(
      `UPDATE blogs
       SET view_count = view_count + 1
       WHERE id = $1`,
      [result.rows[0].id]
    );

    res.json({
      message: 'Blog berhasil diambil',
      data: {
        ...result.rows[0],
        view_count: result.rows[0].view_count + 1,
      },
    });
  } catch (error) {
    console.error('Get blog by slug error:', error);

    res.status(500).json({
      message: 'Terjadi kesalahan server',
    });
  }
};


// Create blog
export const createBlog = async (req: Request, res: Response) => {
  try {
    const {
      title,
      slug,
      author,
      category,
      excerpt,
      content,
      featured_image,
      tags,
      status,
      published_at,
      seo_title,
      seo_description,
    } = req.body;

    // Required fields
    if (!title || !slug || !content) {
      return res.status(400).json({
        message: 'Title, slug, dan content wajib diisi',
      });
    }

    // Check slug
    const existingBlog = await query(
      `SELECT id
       FROM blogs
       WHERE slug = $1`,
      [slug]
    );

    if (existingBlog.rows.length > 0) {
      return res.status(400).json({
        message: 'Slug sudah digunakan',
      });
    }

    const result = await query(
      `INSERT INTO blogs (
        title,
        slug,
        author,
        category,
        excerpt,
        content,
        featured_image,
        tags,
        status,
        published_at,
        seo_title,
        seo_description
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12
      )
      RETURNING *`,
      [
        title,
        slug,
        author || null,
        category || null,
        excerpt || null,
        content,
        featured_image || null,
        tags || [],
        status || 'draft',
        published_at || null,
        seo_title || null,
        seo_description || null,
      ]
    );

    res.status(201).json({
      message: 'Blog berhasil dibuat',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Create blog error:', error);

    res.status(500).json({
      message: 'Terjadi kesalahan server',
    });
  }
};


// Update blog
export const updateBlog = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const {
      title,
      slug,
      author,
      category,
      excerpt,
      content,
      featured_image,
      tags,
      status,
      published_at,
      seo_title,
      seo_description,
    } = req.body;

    // Check blog
    const existingBlog = await query(
      `SELECT *
       FROM blogs
       WHERE id = $1`,
      [id]
    );

    if (existingBlog.rows.length === 0) {
      return res.status(404).json({
        message: 'Blog tidak ditemukan',
      });
    }

    // Check slug if changed
    if (slug && slug !== existingBlog.rows[0].slug) {
      const slugExists = await query(
        `SELECT id
         FROM blogs
         WHERE slug = $1
         AND id != $2`,
        [slug, id]
      );

      if (slugExists.rows.length > 0) {
        return res.status(400).json({
          message: 'Slug sudah digunakan',
        });
      }
    }

    const result = await query(
      `UPDATE blogs
       SET
         title = COALESCE($1, title),
         slug = COALESCE($2, slug),
         author = COALESCE($3, author),
         category = COALESCE($4, category),
         excerpt = COALESCE($5, excerpt),
         content = COALESCE($6, content),
         featured_image = COALESCE($7, featured_image),
         tags = COALESCE($8, tags),
         status = COALESCE($9, status),
         published_at = COALESCE($10, published_at),
         seo_title = COALESCE($11, seo_title),
         seo_description = COALESCE($12, seo_description),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $13
       RETURNING *`,
      [
        title,
        slug,
        author,
        category,
        excerpt,
        content,
        featured_image,
        tags,
        status,
        published_at,
        seo_title,
        seo_description,
        id,
      ]
    );

    res.json({
      message: 'Blog berhasil diupdate',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Update blog error:', error);

    res.status(500).json({
      message: 'Terjadi kesalahan server',
    });
  }
};


// Delete blog
export const deleteBlog = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existingBlog = await query(
      `SELECT id
       FROM blogs
       WHERE id = $1`,
      [id]
    );

    if (existingBlog.rows.length === 0) {
      return res.status(404).json({
        message: 'Blog tidak ditemukan',
      });
    }

    await query(
      `DELETE FROM blogs
       WHERE id = $1`,
      [id]
    );

    res.json({
      message: 'Blog berhasil dihapus',
    });
  } catch (error) {
    console.error('Delete blog error:', error);

    res.status(500).json({
      message: 'Terjadi kesalahan server',
    });
  }
};


// Publish blog
export const publishBlog = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE blogs
       SET
         status = 'published',
         published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Blog tidak ditemukan',
      });
    }

    res.json({
      message: 'Blog berhasil dipublish',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Publish blog error:', error);

    res.status(500).json({
      message: 'Terjadi kesalahan server',
    });
  }
};


// Archive blog
export const archiveBlog = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE blogs
       SET
         status = 'archived',
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Blog tidak ditemukan',
      });
    }

    res.json({
      message: 'Blog berhasil diarsipkan',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Archive blog error:', error);

    res.status(500).json({
      message: 'Terjadi kesalahan server',
    });
  }
};