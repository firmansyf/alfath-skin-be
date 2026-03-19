# Alfath Skin - Backend

REST API server for **Alfath Skin**, a skincare e-commerce platform built with Express.js, TypeScript, and PostgreSQL.

## Tech Stack

- **Framework**: Express.js 4.18.2
- **Language**: TypeScript 5.3.3
- **Database**: PostgreSQL (pg 8.16.3)
- **Authentication**: JWT (jsonwebtoken 9.0.2) + bcrypt 5.1.1
- **Email**: Nodemailer 8.0.3 (SMTP)
- **File Upload**: Multer 2.0.2
- **Security**: Helmet 7.1.0, CORS 2.8.5
- **Logging**: Morgan 1.10.0
- **Compression**: compression 1.7.4

## Project Structure

```
src/
├── server.ts                # Express app setup & entry point
├── config/
│   ├── database.ts          # PostgreSQL connection pool
│   ├── email.ts             # SMTP/Nodemailer config
│   └── payment.config.ts    # QRIS payment config
├── controllers/
│   ├── auth.controller.ts   # Registration, login, OTP verification
│   ├── products.controller.ts
│   ├── categories.controller.ts
│   ├── cart.controller.ts
│   ├── orders.controller.ts
│   ├── refunds.controller.ts
│   ├── upload.controller.ts # Image upload handling
│   ├── dashboard.controller.ts # Admin analytics
│   ├── banners.controller.ts
│   ├── users.controller.ts
│   └── otp.controller.ts
├── middleware/
│   └── auth.ts              # JWT verification & role-based authorization
├── routes/
│   ├── index.ts             # Route aggregator
│   ├── auth.routes.ts
│   ├── products.routes.ts
│   ├── cart.routes.ts
│   ├── orders.routes.ts
│   ├── categories.routes.ts
│   ├── refunds.routes.ts
│   ├── upload.routes.ts
│   ├── dashboard.routes.ts
│   ├── banners.routes.ts
│   ├── users.routes.ts
│   └── otp.routes.ts
└── migrations/              # Database migrations
```

## API Endpoints

| Module       | Base Path            | Description                          |
|-------------|----------------------|--------------------------------------|
| Auth        | `/api/auth`          | Register, login, OTP verification    |
| Products    | `/api/products`      | CRUD, search, filter, pagination     |
| Categories  | `/api/categories`    | Category management                  |
| Cart        | `/api/cart`          | Add, update, remove cart items       |
| Orders      | `/api/orders`        | Create, track, cancel, manage orders |
| Refunds     | `/api/refunds`       | Request, approve, reject, complete   |
| Upload      | `/api/upload`        | Image upload for products/banners    |
| Dashboard   | `/api/dashboard`     | Admin analytics & metrics            |
| Banners     | `/api/banners`       | Promotional banner management        |
| Users       | `/api/users`         | User listing & management            |
| OTP         | `/api/otp`           | OTP generation & validation          |

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Installation

```bash
cd backend
npm install
```

### Environment Variables

Create a `.env` file:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=db_alfath_skin

# JWT
JWT_SECRET=your_jwt_secret

# Email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# Server
PORT=5000
FRONTEND_URL=http://localhost:3100
```

### Database Setup

1. Create a PostgreSQL database:
   ```sql
   CREATE DATABASE db_alfath_skin;
   ```
2. Run any migration scripts in `src/migrations/` if available.

### Development

```bash
npm run dev
```

Server runs at [http://localhost:5000](http://localhost:5000) with auto-reload via nodemon.

### Production Build

```bash
npm run build
npm start
```

## Key Features

- **JWT Authentication** with 24-hour token expiry and role-based access (customer/admin)
- **OTP Email Verification** for new user registration
- **QRIS Payment** integration with configurable payment deadlines
- **Order Lifecycle**: pending -> confirmed -> processing -> shipped -> delivered (with cancellation support)
- **Refund Processing**: request -> approved/rejected -> completed (with transfer proof upload)
- **Stock Management**: auto-deduct on order, restore on cancellation
- **Image Upload**: Multer-based file handling for products, banners, and payment proofs
- **Admin Dashboard**: revenue metrics, order stats, top products, low-stock alerts
- **Security**: Helmet headers, CORS whitelist, password hashing with bcrypt

## Deployment

Deploy to any Node.js hosting platform (Railway, Render, DigitalOcean, AWS, etc.). Ensure:

- PostgreSQL database is accessible
- Environment variables are configured
- `uploads/` directory is writable for image storage
- CORS is configured to allow your frontend domain
