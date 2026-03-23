import { Request, Response } from 'express';
import multer from 'multer';
import { uploadToMinio, deleteFromMinio, getKeyFromUrl } from '../config/minio';

// Use memory storage instead of disk - files go to MinIO
const storage = multer.memoryStorage();

// File filter - only allow images
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Hanya file gambar yang diperbolehkan (JPEG, PNG, GIF, WebP)'));
  }
};

// Configure multer upload (memory storage for MinIO)
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
});

// Upload single product image to MinIO
export const uploadProductImage = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Tidak ada file yang diupload' });
    }

    const ext = req.file.originalname.split('.').pop() || 'jpg';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const key = `products/product-${uniqueSuffix}.${ext}`;

    const imageUrl = await uploadToMinio(req.file.buffer, key, req.file.mimetype);

    res.json({
      message: 'Gambar berhasil diupload',
      data: {
        filename: key,
        url: imageUrl,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Gagal mengupload gambar' });
  }
};

// Delete product image from MinIO
export const deleteProductImage = async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;

    if (!filename) {
      return res.status(400).json({ message: 'Nama file tidak diberikan' });
    }

    // Support both key format (products/product-xxx.jpg) and just filename
    const key = filename.includes('/') ? filename : `products/${filename}`;

    await deleteFromMinio(key);

    res.json({ message: 'Gambar berhasil dihapus' });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ message: 'Gagal menghapus gambar' });
  }
};

