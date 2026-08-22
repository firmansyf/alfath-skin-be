// src/config/migrate.ts
import { pool } from './database';

const schema = `
-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(20) NOT NULL DEFAULT 'customer',
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- 2. CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    image_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);

-- 3. PRODUCTS
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    category_id INTEGER REFERENCES categories(id),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    price DECIMAL(12, 2) NOT NULL,
    discount_price DECIMAL(12, 2),
    stock INTEGER NOT NULL DEFAULT 0,
    unit VARCHAR(50) DEFAULT 'porsi',
    image_url VARCHAR(500),
    images TEXT[] DEFAULT '{}',
    brand VARCHAR(100),
    masa_penyimpanan VARCHAR(100),
    jenis_kulit VARCHAR(255),
    is_available BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    rating DECIMAL(3, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE products ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}';
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand VARCHAR(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS masa_penyimpanan VARCHAR(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS jenis_kulit VARCHAR(255);
ALTER TABLE products ADD COLUMN IF NOT EXISTS referral_link VARCHAR(500);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_is_available ON products(is_available);
CREATE INDEX IF NOT EXISTS idx_products_is_featured ON products(is_featured);
CREATE INDEX IF NOT EXISTS idx_products_available_created ON products(is_available, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_available_featured ON products(is_available, is_featured);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);

-- 4. CARTS
CREATE TABLE IF NOT EXISTS carts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_carts_user_id ON carts(user_id);

-- 5. CART_ITEMS
CREATE TABLE IF NOT EXISTS cart_items (
    id SERIAL PRIMARY KEY,
    cart_id INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id INTEGER,
    quantity INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS variant_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product_id ON cart_items(product_id);
DROP INDEX IF EXISTS idx_cart_items_cart_product;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_items_cart_product_variant ON cart_items (cart_id, product_id, COALESCE(variant_id, 0));

-- 6. ORDERS
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    order_number VARCHAR(30) NOT NULL UNIQUE,
    recipient_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    shipping_address TEXT NOT NULL,
    subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0,
    shipping_cost DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total DECIMAL(12, 2) NOT NULL DEFAULT 0,
    customer_notes TEXT,
    whatsapp_number VARCHAR(20),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
    payment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    admin_notes TEXT,
    confirmed_at TIMESTAMP,
    paid_at TIMESTAMP,
    shipped_at TIMESTAMP,
    delivered_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    payment_proof_url VARCHAR(500),
    payment_proof_uploaded_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Payment is now manual QRIS: customer uploads proof, admin verifies.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_proof_url VARCHAR(500);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_proof_uploaded_at TIMESTAMP;
-- Widen + reset payment_status check to include 'waiting_confirmation' (idempotent: drop then add each boot)
ALTER TABLE orders ALTER COLUMN payment_status TYPE VARCHAR(30);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
    CHECK (payment_status IN ('pending', 'waiting_confirmation', 'paid', 'expired', 'refunded'));
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_payment_created ON orders(status, payment_status, created_at DESC);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_url VARCHAR(500);

-- 6a. ORDER_SHIPMENTS (multiple resi/tracker per order, e.g. one per product/package)
CREATE TABLE IF NOT EXISTS order_shipments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_name VARCHAR(255),
    tracking_number VARCHAR(100),
    tracking_url VARCHAR(500),
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_order_shipments_order_id ON order_shipments(order_id);
-- One-time backfill from the old single tracking_number/tracking_url columns
INSERT INTO order_shipments (order_id, tracking_number, tracking_url)
SELECT o.id, o.tracking_number, o.tracking_url FROM orders o
WHERE (o.tracking_number IS NOT NULL OR o.tracking_url IS NOT NULL)
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id);

-- 7. ORDER_ITEMS
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name VARCHAR(255) NOT NULL,
    product_image VARCHAR(500),
    variant_id INTEGER,
    variant_name VARCHAR(255),
    price DECIMAL(12, 2) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    subtotal DECIMAL(12, 2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id INTEGER;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_name VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- 7a. PRODUCT_VARIANTS
CREATE TABLE IF NOT EXISTS product_variants (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(12, 2) NOT NULL,
    discount_price DECIMAL(12, 2),
    stock INTEGER NOT NULL DEFAULT 0,
    image_url VARCHAR(500),
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_display_order ON product_variants(product_id, display_order);

-- 8. OTP_VERIFICATIONS
CREATE TABLE IF NOT EXISTS otp_verifications (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_verifications(email);
CREATE INDEX IF NOT EXISTS idx_otp_expires_at ON otp_verifications(expires_at);

-- 9. REFUNDS
CREATE TABLE IF NOT EXISTS refunds (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    refund_number VARCHAR(30) NOT NULL UNIQUE,
    reason TEXT NOT NULL,
    refund_amount DECIMAL(12, 2) NOT NULL,
    ewallet_phone VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
    admin_notes TEXT,
    approved_by INTEGER REFERENCES users(id),
    approved_at TIMESTAMP,
    rejected_at TIMESTAMP,
    completed_at TIMESTAMP,
    transfer_proof_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_user_id ON refunds(user_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);
CREATE INDEX IF NOT EXISTS idx_refunds_created_at ON refunds(created_at DESC);

-- 10. BANNERS
CREATE TABLE IF NOT EXISTS banners (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    image_url VARCHAR(500) NOT NULL,
    link_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 0,
    start_date TIMESTAMP,
    end_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_banners_active ON banners(is_active);
CREATE INDEX IF NOT EXISTS idx_banners_dates ON banners(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_banners_order ON banners(display_order);

-- 11. FEEDBACKS
CREATE TABLE IF NOT EXISTS feedbacks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    category VARCHAR(50) NOT NULL DEFAULT 'general'
        CHECK (category IN ('general', 'bug', 'suggestion', 'praise')),
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_feedbacks_user_id ON feedbacks(user_id);
CREATE INDEX IF NOT EXISTS idx_feedbacks_rating ON feedbacks(rating);
CREATE INDEX IF NOT EXISTS idx_feedbacks_is_read ON feedbacks(is_read);
CREATE INDEX IF NOT EXISTS idx_feedbacks_created_at ON feedbacks(created_at DESC);

-- 12. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- 13. SETTINGS (key/value store — e.g. qris_image_url for manual QRIS payment)
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 14. BLOGS
CREATE TABLE IF NOT EXISTS blogs (
    id SERIAL PRIMARY KEY,

    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,

    author VARCHAR(255),
    category VARCHAR(100),

    excerpt TEXT,
    content TEXT NOT NULL,

    featured_image VARCHAR(500),

    tags TEXT[] DEFAULT '{}',

    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'archived')),

    published_at TIMESTAMP,

    view_count INTEGER NOT NULL DEFAULT 0,

    -- SEO
    seo_title VARCHAR(255),
    seo_description TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_blogs_slug
    ON blogs(slug);

CREATE INDEX IF NOT EXISTS idx_blogs_status
    ON blogs(status);

CREATE INDEX IF NOT EXISTS idx_blogs_published_at
    ON blogs(published_at DESC);

CREATE INDEX IF NOT EXISTS idx_blogs_status_published
    ON blogs(status, published_at DESC);
`;

export const runMigrations = async (): Promise<void> => {
  try {
    console.log('🔄 Running database migrations...');
    await pool.query(schema);
    console.log('✅ Database migrations completed successfully');
  } catch (error) {
    console.error('❌ Database migration failed:', error);
    throw error;
  }
};
