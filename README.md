# KPHC Dashboard with Authentication

A secure, scalable Revenue Cycle Management (RCM) dashboard with client authentication and admin panel.

## 🚀 Quick Start — Local Development

### Prerequisites
- Node.js 16+ installed
- npm or yarn

### Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Create `.env` file** (copy from `.env.example`):
```bash
cp .env.example .env
```

3. **Update environment variables in `.env`:**
```
PORT=3000
NODE_ENV=development
SESSION_SECRET=your-secret-key-change-this
ADMIN_PASSWORD=admin123
```

4. **Start the server:**
```bash
npm start
```

5. **Access the dashboard:**
   - Dashboard: `http://localhost:3000`
   - Login page: `http://localhost:3000/login`
   - Admin panel: `http://localhost:3000/admin`

## 📋 Default Credentials (Development Only)

### Add clients via Admin Panel
1. Go to `http://localhost:3000/admin`
2. Use admin password from `.env` (`admin123` by default)
3. Add new client accounts

## 🔧 Architecture

```
├── server.js              # Express backend with authentication
├── db.js                  # SQLite database setup
├── package.json           # Dependencies
├── Dockerfile             # Docker container config
├── login.html             # Login page
├── admin.html             # Admin panel
├── index.html             # Main dashboard
├── command-center/        # Module pages
├── denials/
├── infusion/
├── referral-intake/
└── s3-orders/
```

### How It Works

1. **Authentication Flow:**
   - Client visits `http://localhost:3000`
   - Redirected to `/login`
   - Credentials validated against SQLite database
   - Session created with 7-day expiration
   - Client redirected to dashboard

2. **Admin Panel:**
   - Admin password required (from `.env`)
   - Add/remove client accounts
   - View all users
   - User credentials securely hashed with bcryptjs

3. **Dashboard Protection:**
   - All dashboard routes require authentication
   - Static assets served after login
   - Session timeout handling

## 🚢 Deployment to Railway

### Step 1: Setup GitHub Repository

```bash
# Initialize git (if not already)
git init
git add .
git commit -m "Initial deployment"

# Create GitHub repository and push
git remote add origin https://github.com/YOUR_USERNAME/kphc-dashboard.git
git push -u origin main
```

### Step 2: Deploy to Railway

1. **Go to [railway.app](https://railway.app)**
2. **Click "New Project" → "Deploy from GitHub"**
3. **Select your repository**
4. **Configure environment variables:**
   - Click "Add Variable"
   - Add all variables from `.env`:
     - `PORT=3000`
     - `NODE_ENV=production`
     - `SESSION_SECRET=your-super-secure-key-here`
     - `ADMIN_PASSWORD=your-secure-admin-password`

5. **Configure domain:**
   - In Railway Dashboard
   - Go to Settings → Domain
   - Add custom domain: `kphc.sixaparthealthcare.com`
   - Update DNS records (Railway will provide instructions)

6. **Deploy:**
   - Railway automatically deploys on push to main branch
   - Monitor logs in Railway Dashboard

### Step 3: DNS Configuration

Contact your domain registrar and set:
- **Record Type:** CNAME
- **Name:** `kphc`
- **Value:** (provided by Railway)

## 🔐 Security Checklist

- [ ] Change `SESSION_SECRET` in production
- [ ] Change `ADMIN_PASSWORD` to something strong
- [ ] Enable HTTPS (Railway provides free SSL)
- [ ] Database is encrypted (SQLite on server)
- [ ] Passwords hashed with bcryptjs
- [ ] Session cookies are HTTPOnly and Secure
- [ ] CORS properly configured

## 📊 Production Best Practices

### Before Going Live:

1. **Security Headers:**
   - HTTPS enabled (automatic on Railway)
   - HSTS headers
   - XSS protection

2. **Database:**
   - Regular backups
   - Monitor growth
   - SQLite is fine for up to 10,000 requests/day

3. **Scaling (Future):**
   - If outgrowing SQLite, migrate to PostgreSQL
   - Add Redis for session management
   - Implement load balancing

4. **Monitoring:**
   - Railway provides logs
   - Set up error tracking (e.g., Sentry)
   - Monitor authentication failures

## 🐛 Troubleshooting

### "Cannot find module"
```bash
npm install
```

### Port already in use
```bash
# Change PORT in .env or kill process on 3000
lsof -i :3000
kill -9 <PID>
```

### Database not found
```bash
# Database auto-creates on first run
# If issues, delete auth.db and restart
rm auth.db
npm start
```

### Login not working
- Check credentials in database
- Verify `.env` variables
- Check browser console for errors

## 📈 Daily Updates

To update your dashboard:

1. **Update static files** (HTML, CSS, JS)
2. **Commit and push:**
   ```bash
   git add .
   git commit -m "Update dashboard UI"
   git push
   ```
3. **Railway auto-deploys** (usually within 1-2 minutes)

## 📞 Support

For issues:
1. Check Railway logs
2. Review browser console errors
3. Verify environment variables
4. Check database integrity

## 📄 License

© 2026 Sixapart Healthcare LLC

---

**Next Steps:**
1. [ ] Set `SESSION_SECRET` to a random string
2. [ ] Set `ADMIN_PASSWORD` to a strong password
3. [ ] Add clients via admin panel
4. [ ] commit and push to GitHub
5. [ ] Deploy to Railway
6. [ ] Configure DNS for domain
