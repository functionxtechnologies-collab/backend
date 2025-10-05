import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import rateLimit from 'express-rate-limit'
import mysql from 'mysql2/promise'
import nodemailer from 'nodemailer'

dotenv.config()
const app = express()
const PORT = process.env.PORT || 5000

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }))
app.use(express.json({ limit: '1mb' }))

const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 })
app.use(limiter)

let pool
async function initDb() {
  pool = await mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'password',
    database: process.env.MYSQL_DATABASE || 'functionx_db',
    connectionLimit: 10
  })
  await pool.query(`CREATE TABLE IF NOT EXISTS contact_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(180) NOT NULL,
    subject VARCHAR(255),
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`)
  console.log('MySQL connected & table ensured.')
}

function getTransporter(){
  if(!process.env.SMTP_HOST || !process.env.SMTP_USER) return null
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  })
}

app.get('/health', async (_, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 + 1 AS result')
    res.json({ ok: true, db: rows[0].result === 2, uptime: process.uptime() })
  } catch (e) {
    res.status(500).json({ ok: false, error: 'DB not ready' })
  }
})

app.post('/api/contact', async (req, res) => {
  const { name, email, subject, message } = req.body || {}
  if(!name || !email || !message){
    return res.status(400).json({ ok:false, message:'Missing required fields.' })
  }
  try{
    const [result] = await pool.query(
      'INSERT INTO contact_messages (name, email, subject, message) VALUES (?,?,?,?)',
      [name, email, subject || null, message]
    )
    const transporter = getTransporter()
    if (transporter){
      const to = process.env.CONTACT_TO || 'info@functionxtechnologies.com'
      await transporter.sendMail({
        from: `"FunctionX Website" <${process.env.SMTP_USER}>`,
        to,
        subject: subject || 'New contact form submission',
        text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
        html: `<p><strong>Name:</strong> ${name}</p>
               <p><strong>Email:</strong> ${email}</p>
               <p><strong>Subject:</strong> ${subject || '(none)'}</p>
               <p>${(message||'').replace(/\n/g,'<br/>')}</p>`,
      })
    }
    res.json({ ok:true, id: result.insertId })
  }catch(err){
    console.error('Insert error', err)
    res.status(500).json({ ok:false, message:'Server error.' })
  }
})

app.get('/api/messages', async (req, res) => {
  const token = req.headers['x-admin-token']
  if(!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN){
    return res.status(401).json({ ok:false, message:'Unauthorized' })
  }
  try{
    const [rows] = await pool.query('SELECT id,name,email,subject,message,created_at FROM contact_messages ORDER BY id DESC LIMIT 200')
    res.json({ ok:true, data: rows })
  }catch(err){
    console.error('Fetch error', err)
    res.status(500).json({ ok:false, message:'Server error.' })
  }
})

initDb().then(()=>{
  app.listen(PORT, ()=> console.log('Server running on port', PORT))
}).catch(err=>{
  console.error('DB init failed', err)
  process.exit(1)
})
