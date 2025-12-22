# LORO Enterprise Backend Service 🚀

A powerful NestJS backend service powering location tracking, geofencing, business management, and intelligent route optimization for the LORO platform.

**Developer:** Brandon Nhlanhla Nkawu  
**Company:** Legend Systems  
**Email:** brandon@legendsystems.co.za

## 📋 Overview

Enterprise-grade backend API providing:
- Real-time GPS tracking and geofencing
- Attendance management with automated reporting
- Task, client, and lead management
- Document management with Google Cloud Storage
- Route optimization and analytics
- JWT-based authentication with RBAC

## 🛠️ Tech Stack

- **Framework:** NestJS (TypeScript)
- **Database:** MySQL with TypeORM
- **Storage:** Google Cloud Storage
- **Real-time:** Socket.IO
- **API Docs:** Swagger/OpenAPI
- **Security:** JWT, bcrypt, Helmet, Throttler

## 🚀 Getting Started

### Prerequisites
- Node.js >= 20.19.4
- MySQL database
- Google Cloud Storage account (optional)

### Installation

```bash
# Install dependencies
yarn install

# Configure environment variables
cp .env.example .env
# Update database and API keys in .env

# Run migrations
yarn migration:run

# Start development server
yarn start:dev
# Server runs at http://localhost:4400
```

### Key Environment Variables

```env
API_PORT=4400
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=password
DB_DATABASE=loro
JWT_SECRET=your_jwt_secret
GOOGLE_CLOUD_PROJECT_ID=your_project_id
GOOGLE_MAPS_API_KEY=your_api_key
```

## 📚 API Documentation

Access Swagger docs at: `http://localhost:4400/api`

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

Proprietary - Legend Systems. All rights reserved.

## 👨‍💻 Author

**Brandon Nhlanhla Nkawu**  
[@Brandon-Online01](https://github.com/Brandon-Online01)

## 🙏 Acknowledgments

Built with NestJS, TypeORM, and the open-source community.
